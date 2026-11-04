import {randomUUID} from 'node:crypto';
import {DEFAULTS, PROJECTION, SYSTEM, SYSTEM_DRAFT, initialBoundary, foldBoundary, contextFromSession, collectPrediction, validateSettings} from './engine.js';
import {SERVICE, normalizeDraft} from './protocol.js';
import {PredictionFlights} from './host-flight.js';

// Dependency injection keeps Host behavior testable without loading the Desktop runtime.
export function createComposerPredictionsClass({TypertRemoteService, RemoteError, z, createUserMessage}, runtime = {}) {
  const now = runtime.now || (() => performance.now());
  return class ComposerPredictions extends TypertRemoteService {
    constructor(ctx, config) {
      super(ctx, SERVICE);
      this.ownerContext = ctx; this.config = config;
      this.flights = new PredictionFlights(runtime);
      this.active = this.flights.active; this.cache = new Map();
      this.saves = Promise.resolve(); this.closed = false; this.settingsWatchers = new Set();
      this.instanceId = (runtime.randomUUID || randomUUID)(); this.revision = 0;
      this.settingsFingerprint = JSON.stringify(this.values());
      ctx.effect(() => () => {
        this.closed = true; this.flights.cancelAll(); this.cache.clear();
        for (const wake of this.settingsWatchers) wake();
        this.settingsWatchers.clear();
      });
      ctx.sessionProjections.register({key: PROJECTION, stateVersion: 1,
        stateSchema: z.object({turn: z.number(), sourceSeq: z.number(), running: z.boolean(), revision: z.number()}),
        init: initialBoundary, apply: foldBoundary,
        wire: {viewSchema: z.object({turn: z.number(), sourceSeq: z.number(), running: z.boolean(), revision: z.number()}), view: s => s}
      });
      ctx.sessionProjections.onChanged((session, key, state) => {
        if (key !== PROJECTION) return;
        if (this.active.get(session.id)?.sourceSeq !== state.sourceSeq) this.flights.cancel(session.id);
        if (this.cache.get(session.id)?.sourceSeq !== state.sourceSeq) this.cache.delete(session.id);
      });
      ctx.on('session/disposed', session => {this.flights.cancel(session.id); this.cache.delete(session.id);});
      for (const ref of Object.values(config)) if (ref && typeof ref.subscribe === 'function') ctx.effect(() => ref.subscribe(() => this.syncSettings()));
    }
    values() {return Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) => [k, this.config[k]?.get?.() ?? d]));}
    syncSettings() {
      const fingerprint = JSON.stringify(this.values());
      if (fingerprint === this.settingsFingerprint) return false;
      this.settingsFingerprint = fingerprint; this.revision++;
      this.flights.cancelAll(); this.cache.clear();
      for (const wake of this.settingsWatchers) wake();
      return true;
    }
    assertOwner() {
      const principal = this.ctx.invocation?.peer.principal;
      if (principal && principal.kind !== 'owner') throw new RemoteError('remote-access/denied', 'Prediction settings and conversation access require the profile owner.', {action: SERVICE, reason: 'owner-required'});
    }
    readSettings() {
      this.assertOwner(); this.syncSettings();
      const settings = this.values();
      return {settings, providers: this.ctx.llm.listProviders(), configured: !!(settings.provider && settings.model), instanceId: this.instanceId, revision: this.revision};
    }
    async *watchSettings(signal) {
      this.assertOwner();
      let changed = true, wake;
      const notify = () => {changed = true; wake?.();};
      this.settingsWatchers.add(notify); signal.addEventListener('abort', notify);
      try {
        while (!signal.aborted && !this.closed) {
          if (changed) {changed = false; yield this.readSettings();}
          if (signal.aborted || this.closed) break;
          if (!changed) await new Promise(resolve => {wake = resolve;});
          wake = undefined;
        }
      } finally {signal.removeEventListener('abort', notify); this.settingsWatchers.delete(notify);}
    }
    async models(provider) {
      this.assertOwner();
      if (!this.ctx.llm.listProviders().some(p => p.id === provider)) throw new Error('Select an existing DSH provider');
      return this.ctx.llm.listModels(provider);
    }
    async saveSettings(patch) {
      this.assertOwner(); const validated = validateSettings(patch);
      const operation = this.saves.then(async () => {
        const next = {...this.values(), ...validated};
        if (!!next.provider !== !!next.model) throw new Error('Provider and model must be selected together');
        if (JSON.stringify(next) === JSON.stringify(this.values())) return this.readSettings();
        if (next.provider) await this.ctx.llm.resolveModelInfo(next.provider, next.model);
        const entry = this.ownerContext.fiber.entry;
        if (!entry) throw new Error('This plugin has no editable profile entry');
        await this.ctx.configEditor.edit(entry, current => ({...current, ...validated}));
        this.syncSettings(); return this.readSettings();
      });
      this.saves = operation.catch(() => {}); return operation;
    }
    predict(sessionId, sourceSeq, signal) {return this.runPrediction(sessionId, sourceSeq, signal, '');}
    predictDraft(sessionId, sourceSeq, draft, signal) {return this.runPrediction(sessionId, sourceSeq, signal, normalizeDraft(draft));}
    runPrediction(sessionId, sourceSeq, signal, continuation) {
      this.assertOwner(); this.syncSettings();
      const settings = this.values(), start = now();
      const timings = {contextMs: 0, prepareMs: 0, firstTextMs: null, totalMs: 0};
      const result = fields => ({...fields, sourceSeq, ...(continuation ? {draft: continuation} : {}), meta: {timings: {...timings, totalMs: Math.max(0, now() - start)}, cached: false}});
      const none = reason => result({status: 'skipped', reason, text: null});
      if (signal?.aborted) return Promise.resolve(none('cancelled'));
      if (this.closed || !settings.enabled) return Promise.resolve(none('disabled'));
      if (!settings.provider || !settings.model) return Promise.resolve(none('model-not-configured'));
      const session = this.ctx.sessions.get(sessionId);
      if (!session || session.header.origin === 'subagent') return Promise.resolve(none('session-unavailable'));
      const boundary = this.ctx.sessionProjections.stateOf(session, PROJECTION);
      if (!boundary || boundary.running || boundary.sourceSeq !== sourceSeq) return Promise.resolve(none('stale-turn'));
      const fingerprint = JSON.stringify(settings), draftKey = continuation ? `draft\u0000${continuation}` : '';
      const cached = this.cache.get(sessionId);
      if (cached?.sourceSeq === sourceSeq && cached.fingerprint === fingerprint && cached.draftKey === draftKey) return Promise.resolve({...cached.value, meta: {...cached.value.meta, cached: true}});
      const errorResult = error => result({status: 'error', text: null, message: error?.message || 'Prediction failed'});
      return this.flights.run(sessionId, {sourceSeq, fingerprint, draftKey, timeoutMs: settings.timeoutMs,
        cancelResult: () => none('cancelled'),
        timeoutResult: () => result({status: 'error', code: 'timeout', text: null, message: `Prediction timed out after ${settings.timeoutMs} ms. Try again.`}),
        errorResult,
        execute: async lifetime => {
          lifetime.throwIfAborted();
          const contextStart = now();
          const conversation = contextFromSession(session, continuation ? Math.min(settings.contextChars, 4000) : settings.contextChars);
          timings.contextMs = Math.max(0, now() - contextStart);
          const last = conversation.at(-1);
          if (!conversation.some(m => m.role === 'user') || last?.role !== 'assistant') return none('no-completed-answer');
          lifetime.throwIfAborted();
          const prepareStart = now();
          const prepared = await this.ctx.llm.prepareCall({provider: settings.provider, model: settings.model, maxTokens: settings.maxTokens}, lifetime,
            (controls, model) => ({...controls, ...(model.reasoning?.efforts[0] ? {reasoningEffort: model.reasoning.efforts[0].id} : {})}));
          timings.prepareMs = Math.max(0, now() - prepareStart); lifetime.throwIfAborted();
          const payload = continuation === '' ? conversation : [...conversation.slice(0, -1), {role: last.role, text: last.text + '\n\n[The user is now typing this draft:]'}, {role: 'user', text: continuation}];
          const request = {...prepared.config, signal: lifetime, sessionId, system: continuation === '' ? SYSTEM : SYSTEM_DRAFT,
            messages: [createUserMessage({content: [{type: 'text', text: JSON.stringify(payload)}], source: {kind: 'composer-predictions'}})], tools: []};
          async function* measured(stream) {
            for await (const chunk of stream) {
              if (timings.firstTextMs === null && chunk.type === 'text-delta' && chunk.text) timings.firstTextMs = Math.max(0, now() - start);
              yield chunk;
            }
          }
          const text = await collectPrediction(measured(prepared.stream(request)), lifetime);
          lifetime.throwIfAborted();
          const current = this.ctx.sessionProjections.stateOf(session, PROJECTION);
          if (this.closed || current?.running || current?.sourceSeq !== sourceSeq || JSON.stringify(this.values()) !== fingerprint) return none('stale-turn');
          return result({status: text ? 'ready' : 'empty', text, provider: settings.provider, model: settings.model});
        },
        onComplete: value => {
          if (value.status !== 'ready' && value.status !== 'empty') return;
          this.cache.set(sessionId, {sourceSeq, fingerprint, draftKey, value});
          if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value);
        }
      }, signal);
    }
  };
}
