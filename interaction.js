// Decide only after the host's menus, IME and composer routing have passed.
export function tabPredictionAction({eligible, status, resultSeq, sourceSeq, dismissed, accepted, pending}) {
  if (!eligible) return 'pass';
  if (pending || status === 'loading') return 'wait';
  if (status === 'ready' && resultSeq === sourceSeq && !dismissed && !accepted) return 'accept';
  return 'request';
}
