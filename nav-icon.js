import {SPARKLES_PARTS} from './prediction-view.js';
const NAV_ICON_MARKER = 'data-dsh-prediction-nav-icon';
const SVG_NS = 'http://www.w3.org/2000/svg';
// Compatibility adapter requested for hosts with no settings nav icon contract.
// Only direct svg + leaf span children in this plugin's localized nav button qualify.
export function installPredictionNavIcon({document: doc = globalThis.document, Observer = globalThis.MutationObserver,
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
