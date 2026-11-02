export const PACKAGE = 'dsh-nextline';
export const SERVICE = 'composerPredictions';
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
const string = codec('Provider', v => {if (typeof v !== 'string' || v.length > 200) throw new Error('Invalid provider'); return v;});
const settings = codec('SettingsPatch', v => {const x = jsonValue(v); if (!x || Array.isArray(x) || typeof x !== 'object') throw new Error('Expected settings object'); return x;});
const specs = [
  ['readSettings', []], ['saveSettings', [['patch', settings]]], ['models', [['provider', string]]], ['watchSettings', [], true, true],
  ['predict', [['sessionId', sessionId], ['sourceSeq', sourceSeq]], true]
];
export function descriptors() {
  return specs.map(([method, params, cancellation, stream]) => ({
    id: `${PACKAGE}#${SERVICE}/${method}`, service: SERVICE, namespace: SERVICE, method,
    invocation: {kind: 'direct'}, parameters: params.map(([name, c]) => ({name, wire: name, source: 'json', codec: c})),
    result: json, ...(cancellation ? {cancellation: {parameter: 'signal'}} : {}), ...(stream ? {mode: 'stream'} : {})
  }));
}
export function contribution() {return {package: PACKAGE, descriptors: descriptors()};}
export function reflection() {
  return {services: [{key: SERVICE, exportName: 'ComposerPredictions', description: 'Next-message predictions and independently selected model settings.', tags: [], members: [
    {kind: 'method', name: 'readSettings', signature: 'readSettings(): object', summary: 'Read prediction configuration and available providers.'},
    {kind: 'method', name: 'saveSettings', signature: 'saveSettings(patch: object): Promise<object>', summary: 'Persist a validated configuration patch.'},
    {kind: 'method', name: 'watchSettings', signature: 'watchSettings(signal: AbortSignal): AsyncIterable<object>', summary: 'Subscribe to versioned settings snapshots for this connection generation.'},
    {kind: 'method', name: 'models', signature: 'models(provider: string): Promise<object[]>', summary: 'List models for an existing DSH provider.'},
    {kind: 'method', name: 'predict', signature: 'predict(sessionId: string, sourceSeq: number, signal: AbortSignal): Promise<object>', summary: 'Generate one suggestion for an exact completed turn without sending it.'}
  ], types: []}], objects: [], events: []};
}
