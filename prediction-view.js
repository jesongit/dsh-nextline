// Lucide Sparkles, ISC: shared verbatim by prediction strip and settings navigation.
export const SPARKLES_PARTS = [
  ['path', {d: 'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z'}],
  ['path', {d: 'M20 2v4M22 4h-4'}], ['circle', {cx: 4, cy: 20, r: 2}],
];
// Identical glyph/text/action columns in every prediction state.
export function predictionSurface(h, {badge, text, actions, onClick, label, suggestion, error = false}) {
  return h('div', {className: 'dsh-predict-surface' + (error ? ' dsh-predict-surface-error' : ''),
    role: onClick ? 'region' : 'status', ...(onClick ? {'aria-label': suggestion || label} : {})},
    badge,
    onClick ? h('button', {type: 'button', className: 'dsh-predict-copy dsh-predict-accept', onClick, title: text, 'aria-label': label ? label + ': ' + text : text}, text)
      : h('span', {className: 'dsh-predict-copy', title: text}, text),
    actions && h('div', {className: 'dsh-predict-actions'}, actions));
}
