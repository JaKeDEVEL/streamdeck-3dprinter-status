# Stream Deck 3D Printer Status

A Stream Deck plugin to monitor and control [Klipper](https://www.klipper3d.org/) 3D printers via the [Moonraker](https://moonraker.readthedocs.io/) API.

## Features

**Printer Control** – Shows a printer icon with color-coded status background. Press to pause/resume a running print.

**Print Progress** – Circular progress ring with percentage in the center and estimated time remaining.

### Status Colors

| Status   | Control (Background) | Progress (Ring) |
|----------|---------------------|-----------------|
| Printing | Green               | Green           |
| Paused   | Orange              | Orange          |
| Ready    | Blue                | Blue            |
| Error    | Red                 | Red             |
| Offline  | Grey                | Grey            |

## Requirements

- Elgato Stream Deck with Stream Deck software 6.9+
- A Klipper 3D printer with Moonraker API accessible on the network

## Installation

### Manual Install

1. Download or clone this repository
2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```
3. Symlink the plugin into the Stream Deck plugins folder:

   **macOS:**
   ```bash
   ln -s "$(pwd)/com.janoskehl.printer-status.sdPlugin" \
     ~/Library/Application\ Support/com.elgato.StreamDeck/Plugins/com.janoskehl.printer-status.sdPlugin
   ```

   **Windows (PowerShell as Admin):**
   ```powershell
   New-Item -ItemType SymbolicLink `
     -Path "$env:APPDATA\Elgato\StreamDeck\Plugins\com.janoskehl.printer-status.sdPlugin" `
     -Target "$(Get-Location)\com.janoskehl.printer-status.sdPlugin"
   ```

4. Restart the Stream Deck application

### Configuration

After adding an action to your Stream Deck, click on it to open the Property Inspector where you can set:

- **Printer Host** – IP address or hostname of your printer (e.g. `192.168.2.54`)
- **Printer Port** – Moonraker API port (default: `7125`)
- **Printer Name** – Display name shown on the control key
- **Poll Interval** – How often to query the printer (2–30 seconds)

## Development

```bash
npm install
npm run build          # One-time build
npm run watch          # Watch mode with auto-restart
```

Requires Node.js 20+ and the Stream Deck application running.

## License

MIT
