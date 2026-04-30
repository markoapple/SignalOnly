# SignalOnly tests

Lightweight Node test runner. No bundler.

```
npm run check    # node --check on every .js file
npm test         # node --test tests/
```

`tests/_helpers.js` mirrors the pure functions in `src/background/service-worker.js`. The service worker itself depends on the `chrome.*` global and isn't directly importable into Node, so we keep a parallel copy of the small functions that benefit from unit tests. If you change one of those functions in `service-worker.js`, change it in `_helpers.js` in the same commit.
