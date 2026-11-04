window.__ModuleLoader__.load({id: 'dsh-nextline', factory(require) {
const PACKAGE = 'dsh-nextline';
const SERVICE = 'composerPredictions';
function jsonValue(v, depth = 0) {
  if (depth > 30) throw new Error('JSON nesting exceeds limit');
  if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return v;
  if (Array.isArray(v)) return v.map(x => jsonValue(x, depth + 1));
  if (v && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonValue(x, depth + 1)]));
  }
  throw new Error('Expected a JSON value');
}
const codec = (name, parse) => ({mode: 'strict', typeSymbol: `${PACKAGE}#${name}`, create: () => ({parse})});
const json = codec('Json', jsonValue);
const sessionId = codec('SessionId', v => {if (typeof v !== 'string' || !v || v.length > 200) throw new Error('Invalid sessionId'); return v;});
const sourceSeq = codec('SourceSeq', v => {if (!Number.isSafeInteger(v) || v < 0) throw new Error('Invalid sourceSeq'); return v;});
const MAX_DRAFT_CHARS = 8000;
function normalizeDraft(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > MAX_DRAFT_CHARS) throw new Error(`Invalid draft (string up to ${MAX_DRAFT_CHARS} characters)`);
  return value;
}
const draft = codec('Draft', v => {
  if (typeof v !== 'string' || v.length > MAX_DRAFT_CHARS) throw new Error(`Invalid draft (string up to ${MAX_DRAFT_CHARS} characters)`);
  return v;
});
const string = codec('Provider', v => {if (typeof v !== 'string' || v.length > 200) throw new Error('Invalid provider'); return v;});
const settings = codec('SettingsPatch', v => {const x = jsonValue(v); if (!x || Array.isArray(x) || typeof x !== 'object') throw new Error('Expected settings object'); return x;});
const specs = [
  ['readSettings', []], ['saveSettings', [['patch', settings]]], ['models', [['provider', string]]], ['watchSettings', [], true, true],
  ['predict', [['sessionId', sessionId], ['sourceSeq', sourceSeq]], true],
  ['predictDraft', [['sessionId', sessionId], ['sourceSeq', sourceSeq], ['draft', draft]], true]
];
function descriptors() {
  return specs.map(([method, params, cancellation, stream]) => ({
    id: `${PACKAGE}#${SERVICE}/${method}`, service: SERVICE, namespace: SERVICE, method,
    invocation: {kind: 'direct'}, parameters: params.map(([name, c]) => ({name, wire: name, source: 'json', codec: c})),
    result: json, ...(cancellation ? {cancellation: {parameter: 'signal'}} : {}), ...(stream ? {mode: 'stream'} : {})
  }));
}
function contribution() {return {package: PACKAGE, descriptors: descriptors()};}
function reflection() {
  return {services: [{key: SERVICE, exportName: 'ComposerPredictions', description: 'Next-message predictions and independently selected model settings.', tags: [], members: [
    {kind: 'method', name: 'readSettings', signature: 'readSettings(): object', summary: 'Read prediction configuration and available providers.'},
    {kind: 'method', name: 'saveSettings', signature: 'saveSettings(patch: object): Promise<object>', summary: 'Persist a validated configuration patch.'},
    {kind: 'method', name: 'watchSettings', signature: 'watchSettings(signal: AbortSignal): AsyncIterable<object>', summary: 'Subscribe to versioned settings snapshots for this connection generation.'},
    {kind: 'method', name: 'models', signature: 'models(provider: string): Promise<object[]>', summary: 'List models for an existing DSH provider.'},
    {kind: 'method', name: 'predict', signature: 'predict(sessionId: string, sourceSeq: number, signal: AbortSignal): Promise<object>', summary: 'Generate one whole-message suggestion for an exact completed turn without sending it.'},
    {kind: 'method', name: 'predictDraft', signature: 'predictDraft(sessionId: string, sourceSeq: number, draft: string, signal: AbortSignal): Promise<object>', summary: 'Generate one continuation for the exact given draft text at a completed turn without sending it.'}
  ], types: []}], objects: [], events: []};
}

// Decide only after the host's menus, IME and composer routing have passed.
// Suggestions are anchored to the exact draft text the composer showed when the
// prediction was requested: any content change invalidates and re-predicts.
function draftAnchorKey(draft) {
  const text = typeof draft === 'string' ? draft : '';
  const trimmed = text.trim();
  return trimmed === '' ? '' : text.slice(0, 8000);
}
function anchorMatches(expected, actual) {
  const e = draftAnchorKey(expected), a = draftAnchorKey(actual);
  // A whole-message suggestion (no anchor) belongs to the empty draft only.
  return e === '' ? a === '' : e === a;
}
function tabPredictionAction({eligible, status, resultSeq, sourceSeq, dismissed, accepted, pending, anchor, resultAnchor}) {
  if (!eligible) return 'pass';
  if (pending || status === 'loading') return 'wait';
  if (status === 'ready' && resultSeq === sourceSeq && anchorMatches(anchor, resultAnchor) && !dismissed && !accepted) return 'accept';
  return 'request';
}

// Transport-independent settings lifecycle, shared by the real UI and regression tests.
function settingsKey(settings) {
  return settings ? JSON.stringify(Object.keys(settings).sort().map(k => [k, settings[k]])) : '';
}
function createSettingsStore({readSettings, watchSettings, onTiming = () => {}, now = () => performance.now(),
  setTimer = setTimeout, clearTimer = clearTimeout, timeoutMs = 5000, retryMs = 500, maxRetryMs = 5000}) {
  let snapshot = {settings: null, providers: [], error: null, syncing: true, generation: 0};
  const listeners = new Set();
  let generation = 0, serial = 0, stopped = true, controller, readFlight;
  const retiredInstances = new Set();
  const notify = next => {snapshot = next; for (const fn of listeners) fn();};
  function publish(value, epoch, stamp, kind = 'read') {
    if (stopped || epoch !== generation) return false;
    if (kind === 'read' && stamp !== serial) return false;
    if (value.instanceId && retiredInstances.has(value.instanceId)) return false;
    if (snapshot.instanceId && value.instanceId && snapshot.instanceId !== value.instanceId) retiredInstances.add(snapshot.instanceId);
    if (snapshot.instanceId === value.instanceId && Number.isSafeInteger(value.revision) && value.revision < (snapshot.revision ?? -1)) return false;
    // A successful push supersedes reads already in flight. Preserve semantic identities.
    serial++;
    const settings = settingsKey(snapshot.settings) === settingsKey(value.settings) ? snapshot.settings : value.settings;
    const providers = JSON.stringify(snapshot.providers) === JSON.stringify(value.providers) ? snapshot.providers : value.providers;
    const next = {...value, settings, providers, error: null, syncing: false, generation};
    if (snapshot.settings === settings && snapshot.providers === providers && snapshot.error === null && !snapshot.syncing &&
      snapshot.instanceId === next.instanceId && snapshot.revision === next.revision && snapshot.generation === generation) return true;
    notify(next);
    return true;
  }
  function fail(error, epoch) {
    if (!stopped && epoch === generation) notify({...snapshot, error: error?.message || String(error)});
  }
  function bounded(operation, signal, waitMs = timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true; clearTimer(timer); signal.removeEventListener('abort', abort); fn(value);
      };
      const abort = () => finish(reject, new Error('Settings operation cancelled'));
      const timer = waitMs == null ? undefined : setTimer(() => finish(reject, new Error('Settings connection timed out')), waitMs);
      signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) {abort(); return;}
      Promise.resolve().then(operation).then(value => finish(resolve, value), error => finish(reject, error));
    });
  }
  function refresh() {
    if (stopped) return Promise.resolve(false);
    if (readFlight?.epoch === generation) return readFlight.promise;
    const epoch = generation, stamp = serial, start = now(), signal = controller.signal;
    const flight = {epoch};
    flight.promise = bounded(readSettings, signal).then(value => {
      const applied = publish(value, epoch, stamp);
      if (applied) onTiming('settingsReadMs', now() - start);
      return applied;
    }, error => {if (!signal.aborted && stamp === serial) fail(error, epoch); return false;})
      .finally(() => {if (readFlight === flight) readFlight = undefined;});
    readFlight = flight;
    return flight.promise;
  }
  function pause(ms, signal) {
    return new Promise(resolve => {
      const done = () => {clearTimer(timer); signal.removeEventListener('abort', done); resolve();};
      const timer = setTimer(done, ms);
      signal.addEventListener('abort', done, {once: true});
      if (signal.aborted) done();
    });
  }
  async function watch(epoch, lifetime) {
    let delay = retryMs;
    while (!lifetime.aborted && !stopped && epoch === generation) {
      const attempt = new AbortController();
      const abort = () => attempt.abort();
      lifetime.addEventListener('abort', abort, {once: true});
      let handle, first = true;
      const started = now();
      try {
        handle = watchSettings(attempt.signal);
        const iterator = handle[Symbol.asyncIterator]();
        while (!attempt.signal.aborted) {
          const frame = await bounded(() => iterator.next(), attempt.signal, first ? timeoutMs : null);
          if (frame.done || attempt.signal.aborted || lifetime.aborted || stopped || epoch !== generation) break;
          if (first) {first = false; onTiming('settingsFirstFrameMs', now() - started);}
          publish(frame.value, epoch, serial, 'push');
          delay = retryMs;
        }
        if (!lifetime.aborted) throw new Error(first ? 'Settings subscription did not initialize' : 'Settings subscription disconnected');
      } catch (error) {
        if (!lifetime.aborted) fail(error, epoch);
      } finally {
        attempt.abort(); handle?.dispose?.(); lifetime.removeEventListener('abort', abort);
      }
      if (lifetime.aborted || stopped || epoch !== generation) break;
      await pause(delay, lifetime);
      if (lifetime.aborted || stopped || epoch !== generation) break;
      void refresh();
      delay = Math.min(delay * 2, maxRetryMs);
    }
  }
  function restart() {
    controller?.abort();
    stopped = false; generation++; serial++; readFlight = undefined;
    controller = new AbortController();
    notify({...snapshot, syncing: true, error: null, generation});
    void refresh();
    void watch(generation, controller.signal);
  }
  return {
    subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);},
    getSnapshot: () => snapshot,
    start() {if (stopped) restart();}, restart, refresh,
    // Call BEFORE starting a save, so reads from before the mutation cannot win.
    beginSave() {serial++; return {epoch: generation};},
    acceptSave(value, token) {return publish(value, token.epoch, serial, 'save');},
    stop() {stopped = true; generation++; controller?.abort(); readFlight = undefined; listeners.clear();}
  };
}

// Lucide Sparkles, ISC: shared verbatim by prediction strip and settings navigation.
const SPARKLES_PARTS = [
  ['path', {d: 'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z'}],
  ['path', {d: 'M20 2v4M22 4h-4'}], ['circle', {cx: 4, cy: 20, r: 2}],
];
// Identical glyph/text/action columns in every prediction state.
function predictionSurface(h, {badge, text, actions, onClick, label, suggestion, error = false}) {
  return h('div', {className: 'dsh-predict-surface' + (error ? ' dsh-predict-surface-error' : ''),
    role: onClick ? 'region' : 'status', ...(onClick ? {'aria-label': suggestion || label} : {})},
    badge,
    onClick ? h('button', {type: 'button', className: 'dsh-predict-copy dsh-predict-accept', onClick, title: text, 'aria-label': label ? label + ': ' + text : text}, text)
      : h('span', {className: 'dsh-predict-copy', title: text}, text),
    actions && h('div', {className: 'dsh-predict-actions'}, actions));
}

const NAV_ICON_MARKER = 'data-dsh-prediction-nav-icon';
const SVG_NS = 'http://www.w3.org/2000/svg';
// Compatibility adapter requested for hosts with no settings nav icon contract.
// Only direct svg + leaf span children in this plugin's localized nav button qualify.
function installPredictionNavIcon({document: doc = globalThis.document, Observer = globalThis.MutationObserver,
  label, subscribe = () => () => {}, schedule = fn => setTimeout(fn, 50), cancel = clearTimeout} = {}) {
  if (!doc?.body || !Observer) return () => {};
  const owned = new Map(); let stopped = false, pending = false, timer;
  const restore = (cell, record) => {
    if (record.icon.parentElement === cell) record.icon.replaceWith(record.original);
    if (cell.getAttribute(NAV_ICON_MARKER) === 'sparkles') cell.removeAttribute(NAV_ICON_MARKER);
  };
  const run = () => {
    pending = false; timer = undefined;
    if (stopped) return;
    // Don't retain closed dialogs or restore over a host rerender.
    for (const [cell, record] of owned) if (!cell.isConnected || record.icon.parentElement !== cell) {
      restore(cell, record); owned.delete(cell);
    }
    const text = label();
    for (const nav of doc.querySelectorAll('[data-shortcut-modal="settings"][role="dialog"] > nav')) {
      for (const cell of nav.querySelectorAll('button')) {
        const children = Array.from(cell.children);
        if (!cell.isConnected || children.length !== 2 || children[0].localName !== 'svg' || children[1].localName !== 'span' ||
            children[1].childElementCount !== 0 || children[1].textContent !== text || owned.has(cell)) continue;
        const original = children[0];
        const icon = doc.createElementNS(SVG_NS, 'svg');
        for (const [key, value] of Object.entries({width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
          stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false'})) icon.setAttribute(key, String(value));
        const layout = original.getAttribute('class'); if (layout) icon.setAttribute('class', layout);
        for (const [tag, attributes] of SPARKLES_PARTS) {
          const part = doc.createElementNS(SVG_NS, tag);
          for (const [key, value] of Object.entries(attributes)) part.setAttribute(key, String(value));
          icon.appendChild(part);
        }
        owned.set(cell, {original, icon}); cell.setAttribute(NAV_ICON_MARKER, 'sparkles'); original.replaceWith(icon);
      }
    }
  };
  const request = () => {if (!stopped && !pending) {pending = true; timer = schedule(run);}};
  const observer = new Observer(request);
  observer.observe(doc.body, {childList: true, subtree: true, characterData: true});
  const unsubscribe = subscribe(request);
  run();
  return () => {
    if (stopped) return; stopped = true; observer.disconnect(); unsubscribe();
    if (pending) cancel(timer);
    for (const [cell, record] of owned) restore(cell, record);
    owned.clear();
  };
}

const en = {
  "meta":{"title":"Nextline — Input Predictions","description":"Suggests your next message after a completed reply and continues a draft in progress, with an independently selected model. Never sends automatically."},
  "title":"Input predictions","intro":"After a reply finishes, suggest one useful next message. Accept it into an editable draft; sending is always up to you.",
  "enabled":"Enable predictions","enabledHint":"Suggestions never replace your text or send a message.","automatic":"Generate after replies","automaticHint":"When off, press Tab in the focused composer or click to predict: an empty composer suggests a whole message, existing text continues your draft. Press Tab again to accept; any edit re-predicts.",
  "provider":"Prediction provider","providerHint":"Reuse a provider already configured in Models.","chooseProvider":"Select a provider","model":"Prediction model","modelHint":"Independent of the model used in your conversation.","chooseModel":"Select or enter a model ID",
  "advanced":"Limits and performance","context":"Context characters","tokens":"Maximum output tokens","timeout":"Timeout (milliseconds)",
  "privacy":"Only recent text from the current conversation is sent to the selected prediction provider; pressing Tab on a non-empty draft also sends that draft to continue it. No reasoning, file contents, or tool results are included. Normal provider charges may apply. Suggestions may be wrong; review before sending.",
  "save":"Save settings","saving":"Saving…","saved":"Saved","saveFailed":"Could not save settings.","loading":"Loading settings…","configFailed":"Prediction settings are unavailable. Reconnecting automatically.","noSuggestion":"No useful next-message suggestion right now.","timedOut":"Prediction timed out. Retry or adjust the timeout in settings.","diagnostics":"Performance diagnostics (ms, this page only)","retry":"Retry","dismiss":"Dismiss","generate":"Suggest a next message","generating":"Predicting your next message…","suggestion":"Suggested next message","insert":"Use suggestion","failed":"Prediction failed.","draftChanged":"Your draft changed. Press Tab to predict again."
}
;
const zh = {
  "meta":{"title":"Nextline — 输入预测","description":"回复结束后预测下一条消息，输入已有文字时续写当前草稿；可独立选择预测模型。仅填入草稿，绝不自动发送。"},
  "title":"输入预测","intro":"回复结束后，建议一条有用的下一步消息。接受后填入可编辑草稿，仍由你决定是否发送。",
  "enabled":"启用输入预测","enabledHint":"建议不会覆盖你已输入的文字，也不会自动发送。","automatic":"回复后自动预测","automaticHint":"关闭后，聚焦输入框按 Tab 或点击按钮请求预测：空输入框预测整条消息，已有文字则续写当前草稿；有建议时再按 Tab 填入，文字一变即作废重测。",
  "provider":"预测提供商","providerHint":"复用「模型」中已配置的提供商和凭据。","chooseProvider":"选择提供商","model":"预测模型","modelHint":"独立于当前会话模型，不会修改主模型。","chooseModel":"选择或输入模型 ID",
  "advanced":"用量与性能限制","context":"上下文字符上限","tokens":"输出 Token 上限","timeout":"超时（毫秒）",
  "privacy":"仅将当前会话近期的对话文本发送至所选预测提供商；对已有文字按 Tab 续写时，会一并发送该草稿原文。不发送思考过程、文件内容或工具结果。模型请求可能产生正常费用。建议可能不符合你的意图，请检查后再发送。",
  "save":"保存设置","saving":"正在保存…","saved":"已保存","saveFailed":"保存失败。","loading":"正在加载设置…","configFailed":"输入预测配置暂不可用，正在自动重连。","noSuggestion":"当前没有合适的下一条消息建议。","timedOut":"预测超时，请重试或在设置中调整超时。","diagnostics":"性能诊断（毫秒，仅本次页面）","retry":"重试","dismiss":"忽略","generate":"预测下一条消息","generating":"正在预测下一条消息…","suggestion":"下一条消息建议","insert":"填入草稿","failed":"预测失败。","draftChanged":"草稿已改变，请重新按 Tab 预测。"
}
;
function clientPlugin(React) {
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
    const timings = {rpcMountMs: Math.round(performance.now() - activationStarted), build: 'draft-anchor-v2'};
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
      const [manual, setManual] = useState({sourceSeq: -1, nonce: 0, anchor: null});
      const dismissed = useRef(-1), request = useRef(null), accepted = useRef(null);
      const current = useRef(null);
      const sourceSeq = boundary?.sourceSeq ?? -1;
      const anchor = draftAnchorKey(draft);
      const eligible = !config.syncing && !!settings?.enabled && !!settings?.provider && !!settings?.model && sourceSeq >= 0 && !boundary?.running &&
        !sessionRunning && !sessionRemoved && !sessionSubagent && !block && inputPhase === 'plain' && attachmentCount === 0;
      current.current = {eligible, sourceSeq, draftRev, anchor};
      useEffect(() => {
        if (!eligible || !(settings.automatic && anchor === '' || manual.sourceSeq === sourceSeq && manual.anchor === anchor) || dismissed.current === sourceSeq || accepted.current === sourceSeq) {request.current?.abort(); request.current = null; setResult(null); return;}
        const controller = new AbortController();
        request.current = controller;
        let alive = true;
        setResult({status: 'loading', anchor});
        const timer = setTimeout(() => {
          const started = performance.now();
          // Empty composer predicts a whole message; a draft continues that exact text.
          // Cancellation signal always travels after the declared business arguments.
          const whole = anchor === '';
          call(whole ? 'predict' : 'predictDraft', props.sessionId, sourceSeq, ...(whole ? [controller.signal] : [anchor, controller.signal])).then(value => {
            if (alive && current.current.eligible && current.current.sourceSeq === sourceSeq && current.current.anchor === anchor) {
              timings.predictionRoundTripMs = Math.round(performance.now() - started);
              timings.lastPrediction = value.meta || null;
              setResult(anchor === '' ? value : {...value, anchor});
            }
          }, error => {if (alive && !controller.signal.aborted) setResult({status: 'error', message: error.message, anchor});})
            .finally(() => {if (request.current === controller) request.current = null;});
        }, manual.sourceSeq === sourceSeq ? 0 : 350);
        return () => {alive = false; clearTimeout(timer); controller.abort(); if (request.current === controller) request.current = null;};
      }, [eligible, sourceSeq, anchor, draftRev, settings, manual, props.sessionId, config.generation, config.instanceId]);
      const dismiss = useCallback(() => {dismissed.current = sourceSeq; request.current?.abort(); setResult(null);}, [sourceSeq]);
      const requestPrediction = useCallback(() => {
        if (!current.current?.eligible || request.current || read().settings !== settings || read().syncing) return false;
        const live = props.getPredictionInput();
        const state = live.state.getSnapshot();
        const liveSession = ctx.sessions.binding(props.sessionId)?.session.getSnapshot();
        if (!liveSession || liveSession.running || liveSession.removed || liveSession.subagent || state.phase !== 'plain' || state.attachmentIds.length || props.getPredictionBlock()) return false;
        const liveAnchor = draftAnchorKey(state.draft);
        dismissed.current = -1; accepted.current = null;
        // Immediate latch prevents two Tab events before React's next commit.
        request.current = {abort() {}};
        setResult({status: 'loading', sourceSeq, anchor: liveAnchor});
        setManual(x => x.sourceSeq === sourceSeq && x.anchor === liveAnchor ? {sourceSeq, anchor: liveAnchor, nonce: x.nonce + 1} : {sourceSeq, anchor: liveAnchor, nonce: 0});
        return true;
      }, [sourceSeq, settings, manual, props.getPredictionInput, props.getPredictionBlock, props.sessionId]);
      const accept = useCallback(() => {
        const now = current.current;
        if (read().settings !== settings || read().syncing) return false;
        if (!now.eligible || now.sourceSeq !== sourceSeq || result?.sourceSeq !== sourceSeq || result?.status !== 'ready' || !result.text) return false;
        const live = props.getPredictionInput();
        const liveState = live.state.getSnapshot();
        const liveSession = ctx.sessions.binding(props.sessionId)?.session.getSnapshot();
        if (!liveSession || liveSession.running || liveSession.removed || liveSession.subagent) return false;
        if (liveState.phase !== 'plain' || liveState.attachmentIds.length || props.getPredictionBlock()) return false;
        // The suggestion is anchored to the draft the request was made from:
        // accept only while the composer still shows exactly that content.
        if (!anchorMatches(result.anchor ?? '', draftAnchorKey(liveState.draft))) return false;
        const span = props.inputActions.captureInsertion();
        if (span.draftRev !== now.draftRev) return false;
        if (!props.inputActions.insertText(result.text, span)) {setResult({status: 'error', message: t('draftChanged'), anchor: result.anchor}); return false;}
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
            dismissed: dismissed.current === sourceSeq, accepted: accepted.current === sourceSeq, pending: !!request.current,
            anchor: current.current.anchor, resultAnchor: result?.anchor});
          if (action === 'wait' || (action === 'accept' && accept()) || (action === 'request' && requestPrediction())) event.consume();
        });
      }, [result, eligible, accept, requestPrediction, sourceSeq, props.sessionId]);
      if ((!settings || config.syncing) && draft === '' && !attachmentCount && !sessionSubagent && !sessionRunning && !block) {
        return surface(t(config.error ? 'configFailed' : 'loading'), config.error && button(t('retry'), () => store.restart()));
      }
      if (!eligible || dismissed.current === sourceSeq || accepted.current === sourceSeq) return null;
      if (!settings.automatic && !(manual.sourceSeq === sourceSeq && manual.anchor === anchor) && !anchorMatches(result?.anchor, anchor)) return surface(t('generate'), tabHint, {onClick: requestPrediction, label: t('generate')});
      if (!result || result.status === 'skipped' || (result.sourceSeq !== undefined && result.sourceSeq !== sourceSeq)) return null;
      if (!anchorMatches(result.anchor ?? '', anchor)) return null;
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

return clientPlugin(require('react'));
}});
