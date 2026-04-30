![SignalOnly preview](assets/readme-hero.png)

# SignalOnly

SignalOnly is a local Chromium extension for privacy profiles, SOCKS routing, WebRTC leak protection, browser fingerprint reduction, storage isolation, and reversible site rules. It can also serve as an alt-manager.

SignalOnly is built to reduce browser tracking surfaces without turning every site into a broken page.

It creates isolated cookie profiles per site, spoofs deep fingerprinting vectors, and strips out toxic UI elements like popups, sticky headers, and algorithmic recommendations. 

It's safe by default: sensitive sites like banks and logins are preloaded as editable exclusions so you can bypass extension routing and shields where account access matters.

## Isolated Identity Profiles

SignalOnly includes an identity-profile system for isolated browsing environments. Each profile carries its own randomized browser surface, storage namespace, tracker salts, and site rules, making it useful for controlled alt/profile workflows, privacy testing, and separated account contexts.

Profiles are local, reversible, and tied to explicit site rules, so you can test account environments or privacy profiles without changing the core browser setup.

## What it actually does

 **Fingerprint Spoofing**: Feeds fake but consistent data to scripts checking Canvas, WebGL, AudioContext, DOMRects, Math precision, screen posture, plugins, and hardware concurrency.
 **Cookie Isolation**: Enforces per-site cookie profiles. You can set cookies to keep, clear on tab close, or clear on profile switch. It also automatically sweeps known tracking cookies and caps first-party cookie lifetimes.
 **UI Cleanup**: Visually removes algorithmic recommendations, vanity metrics, overlays, and sticky headers using safe, non-destructive DOM tagging.
 **Network Routing**: Built-in SOCKS proxy support and WebRTC leak protection.
 **Header Stripping**: Blocks declarative tracking headers (ETag, Last-Modified) on third-party requests.

## Why it doesn't break everything

Other anti-tracking tools aggressively block scripts or rewrite `localStorage`, which breaks form submissions, OAuth, and checkout flows. 

SignalOnly takes a different approach. It leaves the core functionality intact but poisons the telemetry data websites try to extract. For extremely fragile domains (like payment gateways or SSO providers), it ships editable exclusions that bypass extension routing and shields so you can avoid fraud alerts and broken account flows.

## Installation

Load the `project` folder as an unpacked extension in your Chromium-based browser.

1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the extension directory.
