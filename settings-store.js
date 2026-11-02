// Transport-independent settings lifecycle, shared by the real UI and regression tests.
export function settingsKey(settings) {
  return settings ? JSON.stringify(Object.keys(settings).sort().map(k => [k, settings[k]])) : '';
}
export function createSettingsStore({readSettings, watchSettings, onTiming = () => {}, now = () => performance.now(),
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
