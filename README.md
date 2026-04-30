# SignalOnly Privacy Surface

SignalOnly is a Manifest V3 Chrome extension prototype with two layers:

- Global privacy surface: Tor SOCKS routing, browser privacy controls, WebRTC leak reduction, network header rules, third-party cookie isolation, and fingerprint surface reduction.
- Site profiles: named, reversible profiles with their own cryptographic seed, fingerprint values, storage salts, and optional per-site page cleanup rules.

The design direction is flat, precise, editorial, and control-surface driven: light neutral base, black typography, hard rectangular switches, small mono metadata, and coded accent color per profile.

## Reversibility

SignalOnly avoids destructive site cleanup. It does not delete browsing history, passwords, bookmarks, or site databases.

- Tor routing is reversed by disabling Tor mode, which clears the Chrome proxy setting.
- Browser privacy settings are reversed by disabling the privacy surface, which clears extension-owned Chrome settings.
- Network header rules are reversed by disabling the matching module, which removes dynamic DNR rules.
- Site profiles are reversed by clearing the site assignment, disabling the site profile, or deleting the profile.
- Page-level fingerprint patches are session-page changes. Turn the module off and reload the page to return that page to native browser values.

## Load Unpacked

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Choose `Load unpacked`.
4. Select this folder.
5. Start Tor locally if Tor mode is enabled.

Tor defaults:

- Tor daemon: `127.0.0.1:9050`
- Tor Browser: often `127.0.0.1:9150`

## Files

- `manifest.json`: MV3 entry point.
- `src/background/service-worker.js`: Tor proxy, Chrome privacy settings, DNR rules, randomized profiles, site profile registry.
- `src/content/content.js`: page injection plus reversible site-scoped page cleanup.
- `src/injected/fingerprint.js`: page-world fingerprint, storage, sensor, and PII surface patches.
- `popup/`: compact control module.
- `options/`: full SignalOnly settings surface.
- `store-assets/`: Chrome Web Store campaign artwork.
- `docs/reversibility.md`: operational reversibility notes.
