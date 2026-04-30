# Reversibility

SignalOnly uses reversible controls wherever Chrome exposes a reversible API.

| Layer | Reversal path |
| --- | --- |
| SOCKS proxy | Disable SOCKS proxy route. Extension clears its Chrome proxy setting. |
| Chrome privacy settings | Disable privacy surface. Extension clears settings it controls. |
| DNR header and tracker rules | Disable modules. Extension removes dynamic request rules. Per-site header rules are removed when a site assignment is reset. |
| Site visual filtering | Clear site assignment or disable site profile. CSS and DOM markers are removed. |
| Site profiles | Delete profile. Its site mappings, cookie jars, salts, and storage namespaces are removed. |
| Cookie jars | On profile switch the previous cookies are snapshotted to a jar keyed by {host, profileId}, host cookies are cleared, then the target jar is restored. Session policy clears jar+cookies when the last matching tab closes. |
| Page-world fingerprint / storage / sensor / behavior patches | Content script tries a runtime revert via the page-world shield controller (window message bridge). Patches that captured native descriptors are reverted in place. Patches that cannot be safely reverted (constructor swaps, frozen prototypes, replaced module factories) cause the extension to surface `reload-required` for the tab. |
| Service worker block | Reverted on next page load; cannot un-block within the current page session. |
| chrome.alarms cookie sweep | Disabled by clearing the alarm; survives service-worker restart. |

No browsing data cleanup is performed by default.
