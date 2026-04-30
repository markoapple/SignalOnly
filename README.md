# SignalOnly

SignalOnly is a browser extension that stops websites from fingerprinting and tracking you. Most privacy extensions are either placebo or they break the internet. SignalOnly is built to actually work.

It creates isolated cookie profiles per site, spoofs deep fingerprinting vectors, and strips out toxic UI elements like popups, sticky headers, and algorithmic recommendations. 

It's safe by default: sensitive sites like banks and logins are preloaded as editable exclusions so you can bypass extension routing and shields where account access matters.

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
