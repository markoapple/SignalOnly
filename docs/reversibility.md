# Reversibility

SignalOnly uses reversible controls wherever Chrome exposes a reversible API.

| Layer | Reversal path |
| --- | --- |
| SOCKS proxy | Disable SOCKS proxy route. Extension clears its Chrome proxy setting. |
| Chrome privacy settings | Disable privacy surface. Extension clears settings it controls. |
| DNR header and tracker rules | Disable modules. Extension removes dynamic request rules. |
| Site visual filtering | Clear site assignment or disable site profile. CSS and DOM markers are removed. |
| Site profiles | Delete profile. Its site mappings, salts, storage namespaces, and tracker-rule references are removed. |
| Fingerprint page patches | Disable module and reload affected pages. Page-world JavaScript patches are page-session scoped. |

No browsing data cleanup is performed by default.
