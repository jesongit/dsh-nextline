// DSH routes declared peer dependencies to the running Host installation.
const moduleLoadStart = performance.now();
const [{default: Schema}, {z}, {createUserMessage}, {TypertRemoteService, Remote, RemoteError}] = await Promise.all([
  import('@deepseek-ai/schemastery'), import('zod'),
  import('@deepseek-ai/dsh-llm'), import('@deepseek-ai/dsh-typert-protocol')
]);
// Measures these four imports only; not whole DSH/application startup.
export const moduleLoadMs = Math.max(0, performance.now() - moduleLoadStart);
import {PROJECTION} from './engine.js';
import {createComposerPredictionsClass} from './host-service.js';
import {PACKAGE, SERVICE, descriptors, reflection} from './protocol.js';

export const name = 'dsh-nextline';
export const inject = ['llm', 'sessions', 'sessionProjections', 'typert', 'tools', 'configEditor'];
export const Config = Schema.object({
  enabled: Schema.boolean().default(true).volatile(),
  automatic: Schema.boolean().default(true).volatile(),
  provider: Schema.string().default('').volatile(),
  model: Schema.string().default('').volatile(),
  contextChars: Schema.number().step(1).min(2000).max(64000).default(16000).volatile(),
  maxTokens: Schema.number().step(1).min(128).max(8192).default(1024).volatile(),
  timeoutMs: Schema.number().step(1).min(3000).max(60000).default(20000).volatile()
});
const ComposerPredictions = createComposerPredictionsClass({TypertRemoteService, RemoteError, z, createUserMessage});
// Invoke the public stage-3 decorator initializer in plain JavaScript.
for (const method of ['readSettings', 'saveSettings', 'models', 'predict', 'watchSettings']) {
  const marker = method === 'watchSettings' ? Remote({mode: 'stream'}) : Remote;
  marker(ComposerPredictions.prototype[method], {name: method, private: false, static: false, addInitializer(fn) {fn.call(Object.create(ComposerPredictions.prototype));}});
}
export function apply(ctx, config) {
  const service = new ComposerPredictions(ctx, config);
  ctx.typert.register({package: PACKAGE, face: 'host', schemas: [], model: reflection(), invocations: descriptors()});
  ctx.tools.register({
    name: 'composer_predictions',
    deferLoading: true,
    description: 'Read or change next-message prediction settings, list prediction models, or generate a suggestion for a completed turn. Does not edit the input draft or send messages.',
    parameters: {type: 'object', properties: {
      action: {type: 'string', enum: ['settings', 'configure', 'models', 'predict']},
      patch: {type: 'object', description: 'Settings patch for configure.', properties: {
        enabled: {type: 'boolean'}, automatic: {type: 'boolean'}, provider: {type: 'string'}, model: {type: 'string'},
        contextChars: {type: 'integer', description: '2000–64000 characters.'}, maxTokens: {type: 'integer', description: '128–8192 output tokens.'}, timeoutMs: {type: 'integer', description: '3000–60000 milliseconds.'}
      }, additionalProperties: false},
      provider: {type: 'string', description: 'Provider route for models.'},
      sessionId: {type: 'string', description: 'Session to predict for; defaults to the calling session.'},
      sourceSeq: {type: 'integer', description: 'Nonnegative exact completed-turn sequence; defaults to the current eligible boundary.'}
    }, required: ['action'], additionalProperties: false},
    output: {schema: {type: 'object', additionalProperties: true}, render: (_args, value) => [{type: 'text', text: JSON.stringify(value)}]},
    isConcurrencySafe: args => args.action !== 'configure',
    async execute(args, exec) {
      if (args.action === 'settings') return service.readSettings();
      if (args.action === 'configure') return service.saveSettings(args.patch);
      if (args.action === 'models') return {models: await service.models(args.provider)};
      if (args.action === 'predict') {
        const id = args.sessionId || exec.agent?.id;
        const session = id && ctx.sessions.get(id);
        const boundary = session && ctx.sessionProjections.stateOf(session, PROJECTION);
        if (!session || !boundary || boundary.sourceSeq < 0) return {status: 'skipped', reason: 'no-completed-turn', text: null};
        return service.predict(id, args.sourceSeq ?? boundary.sourceSeq, exec.signal);
      }
      throw new Error('Unknown prediction action');
    }
  });
}
