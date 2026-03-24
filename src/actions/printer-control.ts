import streamDeck, {
	action,
	SingletonAction,
	type JsonObject,
	type KeyDownEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
	type DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import type { PrinterState } from "../moonraker";
import { subscribePrinter, getPrinterClient } from "../printer-manager";

type PrinterSettings = JsonObject & {
	printerHost: string;
	printerPort: number;
	printerName: string;
	pollInterval: number;
};

const DEFAULT_SETTINGS: PrinterSettings = {
	printerHost: "",
	printerPort: 7125,
	printerName: "My Printer",
	pollInterval: 5,
};

const unsubMap = new Map<string, () => void>();
const stateMap = new Map<string, PrinterState>();

@action({ UUID: "com.janoskehl.printer-status.control" })
export class PrinterControlAction extends SingletonAction<PrinterSettings> {

	override async onWillAppear(ev: WillAppearEvent<PrinterSettings>): Promise<void> {
		const settings = { ...DEFAULT_SETTINGS, ...ev.payload.settings };
		await ev.action.setSettings(settings);
		const id = ev.action.id;

		const unsub = subscribePrinter(
			settings.printerHost,
			settings.printerPort,
			settings.pollInterval || 5,
			(state) => {
				stateMap.set(id, state);
				this.renderKey(ev.action, state, settings.printerName);
			}
		);
		unsubMap.set(id, unsub);
	}

	override onWillDisappear(ev: WillDisappearEvent<PrinterSettings>): void {
		const id = ev.action.id;
		unsubMap.get(id)?.();
		unsubMap.delete(id);
		stateMap.delete(id);
	}

	override async onKeyDown(ev: KeyDownEvent<PrinterSettings>): Promise<void> {
		const settings = { ...DEFAULT_SETTINGS, ...ev.payload.settings };
		const state = stateMap.get(ev.action.id);
		const client = getPrinterClient(settings.printerHost, settings.printerPort);
		if (!client || !state) return;

		try {
			if (state.state === "printing") {
				await client.pause();
			} else if (state.state === "paused") {
				await client.resume();
			}
		} catch (err) {
			streamDeck.logger.error(`Pause/Resume failed: ${err}`);
			await ev.action.showAlert();
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<PrinterSettings>): Promise<void> {
		const settings = { ...DEFAULT_SETTINGS, ...ev.payload.settings };
		const id = ev.action.id;

		// Re-subscribe with new settings
		unsubMap.get(id)?.();
		const unsub = subscribePrinter(
			settings.printerHost,
			settings.printerPort,
			settings.pollInterval || 5,
			(state) => {
				stateMap.set(id, state);
				this.renderKey(ev.action, state, settings.printerName);
			}
		);
		unsubMap.set(id, unsub);
	}

	private async renderKey(
		actionInstance: WillAppearEvent<PrinterSettings>["action"],
		state: PrinterState,
		name: string
	): Promise<void> {
		try {
			const svg = renderControlImage(state, name);
			await actionInstance.setImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
			await actionInstance.setTitle("");
		} catch (err) {
			streamDeck.logger.error(`Render failed: ${err}`);
		}
	}
}

function renderControlImage(state: PrinterState, name: string): string {
	const bg = getBackgroundColor(state.state);

	const statusLabel = getStatusLabel(state.state);

	// Pause overlay when paused
	const pauseOverlay =
		state.state === "paused"
			? `<rect x="27" y="18" width="5" height="14" rx="1" fill="#FFF" opacity="0.85"/>
			   <rect x="36" y="18" width="5" height="14" rx="1" fill="#FFF" opacity="0.85"/>`
			: "";

	return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
	<rect width="72" height="72" rx="8" fill="${bg}"/>
	<!-- Printer icon -->
	<g transform="translate(18, 6)" fill="none" stroke="#FFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
		<rect x="2" y="24" width="32" height="8" rx="2"/>
		<rect x="6" y="12" width="24" height="12" rx="2"/>
		<path d="M10 12 V6 H26 V12"/>
		<line x1="18" y1="32" x2="18" y2="38"/>
	</g>
	${pauseOverlay}
	<!-- Printer name -->
	<text x="36" y="54" font-family="Arial,sans-serif" font-size="8" font-weight="bold" fill="#FFF" text-anchor="middle">${escapeXml(name)}</text>
	<!-- Status -->
	<text x="36" y="65" font-family="Arial,sans-serif" font-size="8" fill="#FFFFFFcc" text-anchor="middle">${statusLabel}</text>
</svg>`;
}

function getStatusLabel(state: PrinterState["state"]): string {
	switch (state) {
		case "printing": return "Druckt";
		case "paused": return "Pausiert";
		case "ready": return "Bereit";
		case "error": return "Fehler";
		case "offline": return "Offline";
	}
}

function getBackgroundColor(state: PrinterState["state"]): string {
	switch (state) {
		case "printing": return "#1B5E20";
		case "paused": return "#E65100";
		case "ready": return "#1A237E";
		case "error": return "#B71C1C";
		case "offline": return "#424242";
	}
}

function escapeXml(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
