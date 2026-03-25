# Building a Stream Deck Plugin to Monitor Klipper 3D Printers

When you're running multiple 3D printers, keeping an eye on all of them can get tedious. Switching between browser tabs, checking Mainsail or Fluidd dashboards — it adds up. I wanted something faster: a glance at my desk should tell me what every printer is doing. That's why I built a Stream Deck plugin that talks directly to Klipper printers via the Moonraker API.

## The Idea

Two dedicated keys per printer on the Stream Deck MK.2:

**Printer Control** — A key showing a printer icon on a color-coded background. Green means it's printing, orange means paused, blue means idle, red signals an error, grey means offline. Pressing the key toggles pause/resume during a print.

**Print Progress** — A circular progress ring with the percentage in the center and an estimated time remaining below. At a glance, you know exactly how far along a print is.

No webcam feeds — at 72x72 pixels per key, a camera image would be unreadable. Instead, the plugin renders clean SVG graphics dynamically and pushes them to the Stream Deck as data URIs.

## Tech Stack

- **Elgato Stream Deck SDK v2** (Node.js/TypeScript)
- **Moonraker REST API** (the HTTP interface that sits on top of Klipper)
- **Rollup** for bundling
- **SVG** for dynamic key rendering

The plugin runs as a Node.js 20 process managed by the Stream Deck software. Each action is a TypeScript class using TC39 Stage 3 decorators from the SDK.

## Architecture

The core challenge was efficiency: if you place both actions for the same printer on your deck, you don't want two separate polling loops hitting the same API. The solution is a shared **Printer Manager** that uses a subscriber pattern.

When an action appears on the deck, it subscribes to a printer by host and port. The manager either creates a new polling loop or reuses an existing one. Every poll cycle, all subscribers get notified with the latest printer state. When the last subscriber for a printer disappears, the polling stops.

```
Stream Deck Key  →  Action (Control/Progress)
                         ↓
                    Printer Manager  ←  subscribePrinter()
                         ↓
                    MoonrakerClient  →  HTTP REST API
                         ↓
                    Klipper Firmware
```

## Talking to Moonraker

The `MoonrakerClient` makes two parallel HTTP requests per poll:

1. `GET /printer/info` — Klipper's overall state (ready, error, shutdown)
2. `POST /printer/objects/query` — Fetches `virtual_sdcard` (progress), `print_stats` (state, filename, duration), and `display_status`

From these, the plugin derives a unified `PrinterState` object with the current state, progress percentage, filename, and ETA. The ETA is calculated from elapsed print time and current progress — simple but effective.

All requests have a 5-second timeout. If anything fails, the printer shows as "offline" rather than crashing the plugin.

## Rendering the Keys

Both actions render SVG strings and push them to the Stream Deck via `setImage()` with a data URI. No external image files needed for the dynamic states.

**Printer Control** builds an SVG with:
- A rounded rectangle background in the status color
- A stylized printer icon (white stroked paths)
- Two white bars as a pause overlay when paused
- The printer name and status label as text

**Print Progress** builds an SVG with:
- A black background
- A circular track (dark grey) with a progress arc on top
- The arc uses `stroke-dasharray` to show the exact percentage
- The percentage number centered in the circle
- The ETA below the ring

Colors are consistent across both actions: green for printing, orange for paused, blue for ready, red for error, grey for offline.

## Configuration

Each action has a Property Inspector built with Elgato's `sdpi-components` library. Users configure:

- **Printer Host** — IP or hostname
- **Printer Port** — Moonraker's port (default 7125)
- **Printer Name** — What to display on the control key
- **Poll Interval** — 2 to 30 seconds

Changing settings immediately re-subscribes to the printer manager with the new parameters.

## What I Learned

- The Stream Deck SDK v2 uses **TC39 Stage 3 decorators**, not the legacy TypeScript `experimentalDecorators`. Mixing these up causes cryptic build errors.
- The manifest format has specific requirements: a root-level `UUID` field and `Nodejs: { Version: "20" }` — not `NodeVersion`.
- The `ws` module used internally by the SDK is CommonJS, so bundling with Rollup requires `@rollup/plugin-commonjs`.
- SVG rendering quirks: `dominant-baseline` doesn't work reliably in the Stream Deck's renderer. Manual y-offset is the way to go for vertically centered text.

## Try It Yourself

The plugin is open source: [streamdeck-3dprinter-status on GitHub](https://github.com/JaKeDEVEL/streamdeck-3dprinter-status)

Clone it, `npm install`, `npm run build`, symlink the plugin folder into Stream Deck's plugin directory, and you're good to go. Works with any Klipper printer running Moonraker — Voron, Sovol, Ender with Klipper, you name it.

Two keys per printer. Zero browser tabs. Full control at a glance.
