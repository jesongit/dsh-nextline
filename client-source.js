import {contribution} from './protocol.js';
import {tabPredictionAction} from './interaction.js';
import {createSettingsStore} from './settings-store.js';
import {predictionSurface, SPARKLES_PARTS} from './prediction-view.js';
import {installPredictionNavIcon} from './nav-icon.js';
import en from './locale/en.json' with {type: 'json'};
import zh from './locale/zh.json' with {type: 'json'};
export function clientPlugin(React) {
  const h = React.createElement;
  const {useState, useEffect, useRef, useCallback, useSyncExternalStore} = React;
  return {inject: ['slots', 'remote', 'locale', 'sessions', 'conversation'], async apply(ctx) {
    const activationStarted = performance.now();
    await ctx.remote.$mount(contribution());
    // New owned namespace also avoids dictionaries leaked by <=1.2.1 in an open page.
    const localeNamespace = 'composer-predictions-ui';
    ctx.effect(() => ctx.locale.register(localeNamespace, {en, zh}), 'composer-predictions: dictionaries');
    const t = ctx.locale.bind(localeNamespace);
    ctx.effect(() => installPredictionNavIcon({label: () => t('title'), subscribe: fn => ctx.locale.subscribe(fn)}), 'composer-predictions: settings nav Sparkles');
    const api = ctx.get('remote.composerPredictions');
    const timings = {rpcMountMs: Math.round(performance.now() - activationStarted)};
    const store = createSettingsStore({readSettings: () => call('readSettings'), watchSettings: signal => api.watchSettings(signal),
      onTiming: (name, ms) => {timings[name] = Math.round(ms); if (timings.firstConfigReadyMs === undefined) timings.firstConfigReadyMs = Math.round(performance.now() - activationStarted);}});
    const read = store.getSnapshot;
    const refresh = store.refresh;
    async function call(method, ...args) {
      const result = await api[method](...args);
      if (!result.ok) throw result.error;
      return result.value;
    }
    function useConfig() {return useSyncExternalStore(store.subscribe, read, read);}
    function useLocale() {
      const [locale, setLocale] = useState(ctx.locale.getLocale());
      useEffect(() => ctx.locale.subscribe(() => setLocale(ctx.locale.getLocale())), []);
      return locale;
    }
    // Lucide Sparkles, ISC; see THIRD-PARTY-NOTICES.md (bundled, no CDN).
    const badge = h('svg', {className: 'dsh-predict-glyph', viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true},
      ...SPARKLES_PARTS.map(([tag, attributes], key) => h(tag, {key, ...attributes})));
    const tabHint = h('kbd', {className: 'dsh-predict-key', 'aria-hidden': true}, 'Tab');
    const dismissButton = onClick => h('button', {type: 'button', className: 'dsh-predict-dismiss', onClick, title: t('dismiss'), 'aria-label': t('dismiss')},
      h('svg', {viewBox: '0 0 20 20', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true}, h('path', {d: 'm6 6 8 8m0-8-8 8', strokeLinecap: 'round'})));
    const surface = (text, actions, extra = {}) => predictionSurface(h, {badge, text, actions, ...extra});
    function button(label, onClick, extra = {}) {return h('button', {type: 'button', className: 'dsh-predict-button', onClick, ...extra}, label);}
    function Prediction(props) {
      useLocale();
      const config = useConfig();
      const {settings} = config;
      const draft = props.useInput(s => s.draft);
      const draftRev = props.useInput(s => s.draftRev);
      const inputPhase = props.useInput(s => s.phase);
      const attachmentCount = props.useInput(s => s.attachmentIds.length);
      const sessionRunning = props.useSession(s => s.running);
      const sessionRemoved = props.useSession(s => s.removed);
      const sessionSubagent = props.useSession(s => s.subagent);
      const boundary = props.useProjection('composerPredictions');
      const block = props.usePredictionBlock(s => s);
      const [result, setResult] = useState(null);
      const [manual, setManual] = useState({sourceSeq: -1, nonce: 0});
      const dismissed = useRef(-1), request = useRef(null), accepted = useRef(null);
      const current = useRef(null);
      const sourceSeq = boundary?.sourceSeq ?? -1;
      const eligible = !config.syncing && !!settings?.enabled && !!settings?.provider && !!settings?.model && sourceSeq >= 0 && !boundary?.running &&
        !sessionRunning && !sessionRemoved && !sessionSubagent && !block && inputPhase === 'plain' && draft === '' && attachmentCount === 0;
      current.current = {eligible, sourceSeq, draftRev};
      useEffect(() => {
        if (!eligible || !(settings.automatic || manual.sourceSeq === sourceSeq) || dismissed.current === sourceSeq || accepted.current === sourceSeq) {request.current?.abort(); request.current = null; setResult(null); return;}
        const controller = new AbortController();
        request.current = controller;
        let alive = true;
        setResult({status: 'loading'});
        const timer = setTimeout(() => {
          const started = performance.now();
          call('predict', props.sessionId, sourceSeq, controller.signal).then(value => {
            if (alive && current.current.eligible && current.current.sourceSeq === sourceSeq) {
              timings.predictionRoundTripMs = Math.round(performance.now() - started);
              timings.lastPrediction = value.meta || null;
              setResult(value);
            }
          }, error => {if (alive && !controller.signal.aborted) setResult({status: 'error', message: error.message});})
            .finally(() => {if (request.current === controller) request.current = null;});
        }, manual.sourceSeq === sourceSeq ? 0 : 350);
        return () => {alive = false; clearTimeout(timer); controller.abort(); if (request.current === controller) request.current = null;};
      }, [eligible, sourceSeq, draftRev, settings, manual, props.sessionId, config.generation, config.instanceId]);
      const dismiss = useCallback(() => {dismissed.current = sourceSeq; request.current?.abort(); setResult(null);}, [sourceSeq]);
      const requestPrediction = useCallback(() => {
        if (!current.current?.eligible || request.current || read().settings !== settings || read().syncing) return false;
        const live = props.getPredictionInput();
        const state = live.state.getSnapshot();
        const liveSession = ctx.sessions.binding(props.sessionId)?.session.getSnapshot();
        if (!liveSession || liveSession.running || liveSession.removed || liveSession.subagent || state.draft !== '' || state.phase !== 'plain' || state.attachmentIds.length || props.getPredictionBlock()) return false;
        dismissed.current = -1; accepted.current = null;
        // Immediate latch prevents two Tab events before React's next commit.
        request.current = {abort() {}};
        setResult({status: 'loading', sourceSeq});
        setManual(x => ({sourceSeq, nonce: x.nonce + 1}));
        return true;
      }, [sourceSeq, settings, props.getPredictionInput, props.getPredictionBlock, props.sessionId]);
      const accept = useCallback(() => {
        const now = current.current;
        if (read().settings !== settings || read().syncing) return false;
        if (!now.eligible || now.sourceSeq !== sourceSeq || result?.sourceSeq !== sourceSeq || result?.status !== 'ready' || !result.text) return false;
        const live = props.getPredictionInput();
        const liveState = live.state.getSnapshot();
        const liveSession = ctx.sessions.binding(props.sessionId)?.session.getSnapshot();
        if (!liveSession || liveSession.running || liveSession.removed || liveSession.subagent) return false;
        if (liveState.draft !== '' || liveState.phase !== 'plain' || liveState.attachmentIds.length || props.getPredictionBlock()) return false;
        const span = props.inputActions.captureInsertion();
        if (span.draftRev !== now.draftRev || span.start !== 0 || span.end !== 0) return false;
        if (!props.inputActions.insertText(result.text, span)) {setResult({status: 'error', message: t('draftChanged')}); return false;}
        accepted.current = sourceSeq;
        setResult(null); live.focus(); return true;
      }, [result, sourceSeq, settings, props.inputActions, props.getPredictionInput, props.getPredictionBlock]);
      useEffect(() => {
        const shortcuts = ctx.get('shortcuts');
        if (!shortcuts?.observeFixedInput || !eligible) return;
        return shortcuts.observeFixedInput(event => {
          if (event.type !== 'keydown') return;
          const {gesture: g, context: c} = event;
          if (g.defaultPrevented || g.repeat || g.composing || g.alt || g.control || g.meta || g.shift || c.modal !== null || c.region !== 'editable' || !c.target) return;
          const occurrence = c.target.closest('[data-conversation-session]');
          const region = c.target.closest('[data-conversation-region]');
          if (occurrence?.dataset.conversationSession !== props.sessionId || region?.dataset.conversationRegion !== 'composer' || !occurrence.contains(region) || !c.target.closest('[data-composer-input]') || c.target.closest('[data-approval-key], iframe, .xterm, [inert]')) return;
          if (g.code !== 'Tab') return;
          const action = tabPredictionAction({eligible: current.current.eligible, status: result?.status, resultSeq: result?.sourceSeq, sourceSeq,
            dismissed: dismissed.current === sourceSeq, accepted: accepted.current === sourceSeq, pending: !!request.current});
          if (action === 'wait' || (action === 'accept' && accept()) || (action === 'request' && requestPrediction())) event.consume();
        });
      }, [result, eligible, accept, requestPrediction, sourceSeq, props.sessionId]);
      if ((!settings || config.syncing) && draft === '' && !attachmentCount && !sessionSubagent && !sessionRunning && !block) {
        return surface(t(config.error ? 'configFailed' : 'loading'), config.error && button(t('retry'), () => store.restart()));
      }
      if (!eligible || dismissed.current === sourceSeq || accepted.current === sourceSeq) return null;
      if (!settings.automatic && manual.sourceSeq !== sourceSeq) return surface(t('generate'), tabHint, {onClick: requestPrediction, label: t('generate')});
      if (!result || result.status === 'skipped' || (result.sourceSeq !== undefined && result.sourceSeq !== sourceSeq)) return null;
      if (result.status === 'loading') return surface(t('generating'), dismissButton(dismiss));
      if (result.status === 'empty') return surface(t('noSuggestion'), dismissButton(dismiss));
      if (result.status === 'error') return surface(result.code === 'timeout' ? t('timedOut') : t('failed') + ' ' + result.message,
        h(React.Fragment, null, button(t('retry'), requestPrediction), dismissButton(dismiss)), {error: true});
      return surface(result.text, h(React.Fragment, null, tabHint, dismissButton(dismiss)), {onClick: accept, label: t('insert'), suggestion: t('suggestion')});
    }
    function Settings() {
      useLocale();
      const config = useConfig();
      const [draft, setDraft] = useState(null), [models, setModels] = useState([]), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [modelError, setModelError] = useState('');
      const sequence = useRef(0);
      useEffect(() => {refresh();}, []);
      useEffect(() => {if (config.settings) setDraft({...config.settings});}, [config.settings]);
      const provider = draft?.provider || '';
      useEffect(() => {
        const id = ++sequence.current;
        setModels([]); setModelError('');
        if (provider) call('models', provider).then(value => {if (sequence.current === id) setModels(value);}, error => {if (sequence.current === id) setModelError(error.message);});
        return () => {sequence.current++;};
      }, [provider]);
      async function save(event) {
        event.preventDefault(); setBusy(true); setNotice('');
        const ticket = store.beginSave();
        try {store.acceptSave(await call('saveSettings', draft), ticket); setNotice(t('saved'));}
        catch (error) {setNotice(t('saveFailed') + ' ' + error.message);}
        finally {setBusy(false);}
      }
      const change = (key, value) => {setNotice(''); setDraft(d => ({...d, [key]: value}));};
      const row = (id, title, hint, control) => h('div', {className: 'dsh-predict-row'}, h('div', null, h('label', {htmlFor: id}, title), hint && h('p', null, hint)), control);
      const toggle = key => h('input', {id: 'predict-' + key, type: 'checkbox', checked: draft[key], disabled: busy, onChange: e => change(key, e.target.checked)});
      return h('section', {className: 'dsh-predict-settings'}, h('h2', null, t('title')), h('p', {className: 'dsh-predict-intro'}, t('intro')),
        config.error && h('p', {role: 'alert', className: 'dsh-predict-error'}, config.error),
        !draft ? h('div', {role: 'status'}, t('loading'), button(t('retry'), refresh)) : h('form', {onSubmit: save},
          h('fieldset', {disabled: busy}, h('legend', {className: 'dsh-predict-sr'}, t('title')),
            row('predict-enabled', t('enabled'), t('enabledHint'), toggle('enabled')),
            row('predict-automatic', t('automatic'), t('automaticHint'), toggle('automatic')),
            row('predict-provider', t('provider'), t('providerHint'), h('select', {id: 'predict-provider', value: provider, onChange: e => setDraft(d => ({...d, provider: e.target.value, model: ''}))},
              h('option', {value: ''}, t('chooseProvider')), config.providers.map(p => h('option', {key: p.id, value: p.id}, p.name)))),
            row('predict-model', t('model'), t('modelHint'), h('div', {className: 'dsh-predict-field'},
              h('input', {id: 'predict-model', list: 'predict-model-list', value: draft.model, disabled: !provider, autoComplete: 'off', placeholder: t('chooseModel'), onChange: e => change('model', e.target.value)}),
              h('datalist', {id: 'predict-model-list'}, models.map(m => h('option', {key: m.id, value: m.id}, m.name))),
              modelError && h('span', {className: 'dsh-predict-error'}, modelError))),
            h('details', null, h('summary', null, t('advanced')), ...[
              ['contextChars', 'context', 2000, 64000, 1000], ['maxTokens', 'tokens', 128, 8192, 128], ['timeoutMs', 'timeout', 3000, 60000, 1000]
            ].map(([key, label, min, max, step]) => row('predict-' + key, t(label), '', h('input', {id: 'predict-' + key, type: 'number', min, max, step, required: true, value: draft[key], onChange: e => change(key, Number(e.target.value))})))),
            h('details', null, h('summary', null, t('diagnostics')), h('pre', {style: {whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}, JSON.stringify(timings, null, 2))),
            h('p', {className: 'dsh-predict-note'}, t('privacy')),
            h('div', {className: 'dsh-predict-save'}, button(busy ? t('saving') : t('save'), undefined, {type: 'submit', disabled: busy || (!!draft.provider !== !!draft.model)}), h('span', {role: 'status'}, notice))
          )));
    }
    const StyledSettings = props => h(React.Fragment, null, h('style', null, CSS), h(Settings, props));
    const StyledPrediction = props => h(React.Fragment, null, h('style', null, CSS),
      h('div', {className: 'dsh-predict-alignment', 'data-prediction-layout': 'native-dock-aligned-v3'}, h('div', {className: 'dsh-predict-column'}, h(Prediction, props))));
    ctx.slots.inject('settings.section', () => ctx.slots.register({name: 'settings.section', id: 'composer-predictions', order: 35, label: () => t('title')}, StyledSettings));
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({name: 'conversation.input.dock', id: 'composer-predictions', order: 30,
      inject(sessionId) {
        const input = () => ctx.conversation.input.for(ctx.sessions.scope(sessionId));
        const blocks = ctx.conversation.blocks.storeFor(sessionId);
        return {hooks: {predictionBlock: blocks}, getPredictionInput: input, getPredictionBlock: () => blocks.getSnapshot()};
      }
    }, StyledPrediction));
    ctx.on('connection/reset', () => store.restart());
    ctx.effect(() => {store.start(); return () => store.stop();});

  }};
}
const CSS = `
.dsh-predict-alignment{box-sizing:border-box;width:calc(100% - 2 * var(--dsh-composer-side-clearance,16px) - 4 * var(--dsh-composer-dock-inset,8px));min-width:0;margin-inline:auto}
.dsh-predict-column{box-sizing:border-box;width:100%;max-width:calc(var(--dsh-composer-card-max-width,952px) - 4 * var(--dsh-composer-dock-inset,8px));min-width:0;margin-inline:auto}
.dsh-predict-surface{font:inherit;font-size:13px;line-height:24px;color:var(--dsw-alias-label-secondary);display:grid;grid-template-columns:14px minmax(0,1fr) auto;column-gap:10px;align-items:center;margin:0;width:100%;height:36px;box-sizing:border-box;padding:3px 4px 3px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.dsh-predict-glyph{display:block;width:14px;height:14px;margin:0;color:var(--dsw-alias-label-secondary)}
.dsh-predict-copy{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0;padding:2px 0;line-height:24px}
.dsh-predict-accept{font:inherit;color:inherit;text-align:start;line-height:24px;background:none;border:0;border-radius:4px;cursor:pointer}
.dsh-predict-accept:hover{color:var(--dsw-alias-label-primary)}
.dsh-predict-actions{display:flex;gap:10px;align-items:center;justify-content:flex-end;min-height:28px;max-width:100%;flex-wrap:nowrap}
.dsh-predict-key{font:inherit;font-size:11px;line-height:18px;box-sizing:border-box;flex:none;padding:0 5px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px}
.dsh-predict-dismiss{display:grid;place-items:center;width:28px;height:28px;flex:none;border:0;border-radius:8px;color:var(--dsw-alias-label-secondary);background:none;cursor:pointer;padding:0}
.dsh-predict-surface-error>.dsh-predict-copy{color:var(--dsw-alias-state-error-primary)}
.dsh-predict-surface .dsh-predict-button{min-height:28px;padding:1px 8px}
.dsh-predict-column{container-type:inline-size;container-name:dsh-prediction}
.dsh-predict-dismiss:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.dsh-predict-accept:focus-visible,.dsh-predict-dismiss:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-predict-button{font:inherit;font-size:13px;min-height:32px;padding:5px 10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;cursor:pointer;display:inline-flex;gap:8px;align-items:center;justify-content:center;white-space:nowrap}
.dsh-predict-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.dsh-predict-button:disabled{cursor:not-allowed;color:var(--dsw-alias-label-secondary)}
.dsh-predict-button:focus-visible,.dsh-predict-settings input:focus-visible,.dsh-predict-settings select:focus-visible,.dsh-predict-settings summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
.dsh-predict-button kbd{font:inherit;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsh-predict-settings{font:inherit;color:var(--dsw-alias-label-primary);max-width:760px;padding:8px 0 24px}.dsh-predict-settings h2{font-size:20px;line-height:1.4;font-weight:600;margin:0 0 8px}.dsh-predict-intro{font-size:14px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:0 0 24px}
.dsh-predict-settings fieldset{border:0;padding:0;margin:0;min-width:0}.dsh-predict-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-predict-row label{font-size:14px;font-weight:500}.dsh-predict-row p{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);margin:4px 0 0;max-width:44ch}
.dsh-predict-settings input:not([type=checkbox]),.dsh-predict-settings select{font:inherit;font-size:13px;width:240px;max-width:100%;box-sizing:border-box;min-height:36px;padding:7px 10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;caret-color:var(--dsw-alias-brand-primary)}
.dsh-predict-settings input[type=checkbox]{width:18px;height:18px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer;flex-shrink:0}.dsh-predict-field{max-width:100%;display:flex;flex-direction:column;gap:6px}.dsh-predict-settings details{margin-top:24px}.dsh-predict-settings summary{font-size:14px;cursor:pointer;padding:4px 0}.dsh-predict-settings details input{width:140px!important}
.dsh-predict-note{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:24px 0 16px}.dsh-predict-save{display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:13px}.dsh-predict-save button{padding-inline:18px;min-height:36px}.dsh-predict-error{color:var(--dsw-alias-state-error-primary);font-size:13px;overflow-wrap:anywhere}
.dsh-predict-sr{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:600px){.dsh-predict-row{flex-wrap:wrap;gap:12px}.dsh-predict-row>div:first-child{flex:1;min-width:200px}.dsh-predict-settings input:not([type=checkbox]),.dsh-predict-settings select{width:100%}.dsh-predict-field{width:100%}.dsh-predict-settings{padding-inline:4px}}
`;
