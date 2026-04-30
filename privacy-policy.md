# Privacy Policy

SignalOnly runs locally in Chrome. It does not create accounts, collect analytics, transmit telemetry to an extension server, or sell data.

All configuration — including proxy settings, site assignments, profile randomization seeds, and excluded hosts — is stored using `chrome.storage.local`. This data never leaves the device. Profiles can be rotated or deleted from the options page at any time.

Permissions are used for local controls only:

- `proxy`: route Chrome traffic through a configured local SOCKS endpoint.
- `privacy`: set and clear Chrome privacy preferences owned by the extension.
- `declarativeNetRequest`: block or modify requests without reading request bodies.
- `storage`: save local configuration via `chrome.storage.local`.
- `tabs`: detect the current site and refresh site-scoped profiles.
- Host access: apply local page shields and visual-noise profiles.

No extension-owned remote endpoint is used. No data leaves the device.
