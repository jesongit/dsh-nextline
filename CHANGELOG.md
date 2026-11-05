# Changelog

## 1.1.1 — 2026-11-06

- Compatibility only: widened the declared Host range from the exact `engines.dsh: 0.2.1-rc.5` to `^0.2.1-rc.5` (the two `@deepseek-ai/dsh-*` peer ranges likewise), so DSH desktop versions through `0.2.2-rc.1` pass the platform's `evaluatePluginCompatibility` check instead of being rejected as `incompatible-version` and refusing to enable.
- Verified the Host/Client APIs this plugin consumes are unchanged in `0.2.2-rc.1` (`sessionProjections` legacy read path, typert `Remote` decorator, `llm.prepareCall`/`createUserMessage`, `conversation.input`/`blocks`, `shortcuts.observeFixedInput`, and the `settings.section` / `conversation.input.dock` slots).
- No functional, UI, or settings changes; prediction behavior is identical to 1.1.0.

## 1.1.0 — 2026-11-04

- Tab while the composer already has text now continues the current draft instead of only whole-message suggestions. Suggestions are anchored to the exact draft content at request time: any edit invalidates the pending suggestion and Tab re-predicts from the new content; acceptance appends the continuation at the caret.
- `predict` gained an optional draft parameter (dedicated continuation system prompt, per-draft cache and flight keys, tightened 4000-character context budget, drafts capped at 8000 characters); the `composer_predictions` tool exposes it as `draft`.
- Content-anchored Tab decisions, per-draft caching/regressions, and updated privacy and usage copy in both locales.

## 1.0.0 — 2026-11-02

First public release as **dsh-nextline**, based on the locally tested Composer Predictions 1.2.4 implementation.

- Predict a complete next human message with an independently configured DSH provider/model.
- Draft-only acceptance by click or Tab; no automatic sending or draft replacement.
- Automatic and explicit prediction, cancellation, bounded context, per-turn memory cache and deadlines.
- Versioned/reconnecting settings, lifecycle-owned locale resources and unload/reload regressions.
- Single-line ellipsis, hover full text, shared Lucide Sparkles artwork and localized settings.
- Settings navigation SVG compatibility adapter with reversible, localized, narrowly scoped DOM replacement.
- Portable declared Host peers; no hard-coded user paths or installation scripts.
- Compatibility declared only for DSH 0.2.1-rc.5. Not independently verified by dsh.so.
