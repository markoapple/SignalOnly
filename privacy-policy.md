# Privacy Policy

SignalOnly runs locally in Chrome. It does not create accounts, collect analytics, transmit telemetry to an extension server, or sell data.

Local configuration is stored with Chrome extension storage. Session fingerprint profiles are stored in session storage and can be rotated from the options page.

Permissions are used for local controls:

- `proxy`: route Chrome traffic through a configured local SOCKS endpoint.
- `privacy`: set and clear Chrome privacy preferences owned by the extension.
- `declarativeNetRequest`: block or modify requests without reading request bodies.
- `storage`: save local configuration.
- `tabs`: detect the current site and refresh site-scoped profiles.
- Host access: apply local page shields and visual-noise profiles.

No extension-owned remote endpoint is used.
