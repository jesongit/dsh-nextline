// One live provider operation per session, with independently cancellable callers.
// Provider promises always have rejection handlers, even after detachment/deadline.
export class PredictionFlights {
  constructor({setTimer = setTimeout, clearTimer = clearTimeout, now = () => performance.now()} = {}) {
    this.active = new Map(); this.setTimer = setTimer; this.clearTimer = clearTimer; this.now = now;
  }
  cancel(sessionId) {this.active.get(sessionId)?.cancel();}
  cancelAll() {for (const entry of [...this.active.values()]) entry.cancel();}
  run(sessionId, options, signal) {
    if (signal?.aborted) return Promise.resolve(options.cancelResult());
    let entry = this.active.get(sessionId);
    if (entry && (entry.sourceSeq !== options.sourceSeq || entry.fingerprint !== options.fingerprint)) {entry.cancel(); entry = null;}
    if (!entry) {
      const controller = new AbortController();
      entry = {sourceSeq: options.sourceSeq, fingerprint: options.fingerprint, controller, subscribers: new Set(), done: false, deadline: this.now() + options.timeoutMs};
      const finish = value => {
        if (entry.done) return;
        entry.done = true;
        this.clearTimer(entry.timer);
        if (this.active.get(sessionId) === entry) this.active.delete(sessionId);
        for (const subscriber of [...entry.subscribers]) subscriber.complete(value);
        entry.subscribers.clear();
      };
      entry.cancel = () => {finish(options.cancelResult()); controller.abort();};
      this.active.set(sessionId, entry);
      const timeout = () => {finish(options.timeoutResult()); controller.abort();};
      entry.timer = this.setTimer(timeout, options.timeoutMs);
      // Start after the first subscriber is attached; detached work never caches.
      queueMicrotask(() => {
        if (entry.done) return;
        Promise.resolve().then(() => options.execute(controller.signal)).then(value => {
          if (entry.done) return;
          if (this.now() >= entry.deadline) {timeout(); return;}
          try {options.onComplete?.(value); finish(value);} catch (error) {finish(options.errorResult(error));}
        }, error => {if (!entry.done) {if (this.now() >= entry.deadline) timeout(); else finish(options.errorResult(error));}});
      });
    }
    return new Promise(resolve => {
      const subscriber = {complete: value => {signal?.removeEventListener('abort', abort); entry.subscribers.delete(subscriber); resolve(value);}};
      const abort = () => {
        subscriber.complete(options.cancelResult());
        if (!entry.done && !entry.subscribers.size) entry.cancel();
      };
      entry.subscribers.add(subscriber);
      signal?.addEventListener('abort', abort, {once: true});
      if (signal?.aborted) abort();
    });
  }
}
