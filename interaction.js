// Decide only after the host's menus, IME and composer routing have passed.
// Suggestions are anchored to the exact draft text the composer showed when the
// prediction was requested: any content change invalidates and re-predicts.
export function draftAnchorKey(draft) {
  const text = typeof draft === 'string' ? draft : '';
  const trimmed = text.trim();
  return trimmed === '' ? '' : text.slice(0, 8000);
}
export function anchorMatches(expected, actual) {
  const e = draftAnchorKey(expected), a = draftAnchorKey(actual);
  // A whole-message suggestion (no anchor) belongs to the empty draft only.
  return e === '' ? a === '' : e === a;
}
export function tabPredictionAction({eligible, status, resultSeq, sourceSeq, dismissed, accepted, pending, anchor, resultAnchor}) {
  if (!eligible) return 'pass';
  if (pending || status === 'loading') return 'wait';
  if (status === 'ready' && resultSeq === sourceSeq && anchorMatches(anchor, resultAnchor) && !dismissed && !accepted) return 'accept';
  return 'request';
}
