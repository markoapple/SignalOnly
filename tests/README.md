# SignalOnly tests

Lightweight Node test runner. No bundler.

```
npm run check    # node --check on every .js file
npm test         # node --test tests/
```

Pure functions used by the service worker live in `src/background/pure.js` and are imported directly by `tests/normalize.test.js`. Keep reusable normalization, cookie-jar serialization, and site-profile policy logic there so tests exercise the same code the extension uses.
