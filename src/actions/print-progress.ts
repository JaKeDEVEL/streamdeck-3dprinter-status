import streamDeck, {
	action,
	SingletonAction,
	type JsonObject,
	type WillAppearEvent,
	type WillDisappearEvent,
	type DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import type { PrinterState } from "../moonraker";
import { subscribePrinter } from "../printer-manager";

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

@action({ UUID: "com.janoskehl.printer-status.progress" })
export class PrintProgressAction extends SingletonAction<PrinterSettings> {

	override async onWillAppear(ev: WillAppearEvent<PrinterSettings>): Promise<void> {
		const settings = { ...DEFAULT_SETTINGS, ...ev.payload.settings };
		await ev.action.setSettings(settings);
		const id = ev.action.id;

		const unsub = subscribePrinter(
			settings.printerHost,
			settings.printerPort,
			settings.pollInterval || 5,
			(state) => this.renderKey(ev.action, state)
		);
		unsubMap.set(id, unsub);
	}

	override onWillDisappear(ev: WillDisappearEvent<PrinterSettings>): void {
		const id = ev.action.id;
		unsubMap.get(id)?.();
		unsubMap.delete(id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<PrinterSettings>): Promise<void> {
		const settings = { ...DEFAULT_SETTINGS, ...ev.payload.settings };
		const id = ev.action.id;

		unsubMap.get(id)?.();
		const unsub = subscribePrinter(
			settings.printerHost,
			settings.printerPort,
			settings.pollInterval || 5,
			(state) => this.renderKey(ev.action, state)
		);
		unsubMap.set(id, unsub);
	}

	private async renderKey(
		actionInstance: WillAppearEvent<PrinterSettings>["action"],
		state: PrinterState
	): Promise<void> {
		try {
			const svg = renderProgressImage(state);
			await actionInstance.setImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
			await actionInstance.setTitle("");
		} catch (err) {
			streamDeck.logger.error(`Render failed: ${err}`);
		}
	}
}

function renderProgressImage(state: PrinterState): string {
	const isPrinting = state.state === "printing" || state.state === "paused";
	const progress = isPrinting ? state.progress : 0;
	const bg = "#000000";

	// Circle parameters – centered on 72×72 canvas
	const cx = 36;
	const cy = 36;
	const r = 24;
	const circumference = 2 * Math.PI * r;
	const filled = (progress / 100) * circumference;
	const gap = circumference - filled;

	// Color based on state
	const ringColor = getRingColor(state.state);
	const trackColor = "#333333";

	// ETA text
	const etaText = state.etaSeconds && isPrinting
		? formatTime(state.etaSeconds)
		: "";

	// Status text for non-printing
	const statusText = !isPrinting ? getStatusLabel(state.state) : "";

	return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
	<rect width="72" height="72" rx="8" fill="${bg}"/>

	<!-- Track circle -->
	<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${trackColor}" stroke-width="5"/>

	<!-- Progress arc -->
	<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
		stroke="${ringColor}" stroke-width="5"
		stroke-dasharray="${filled} ${gap}"
		stroke-linecap="round"
		transform="rotate(-90 ${cx} ${cy})"/>

	${isPrinting ? `
	<!-- Percentage -->
	<text x="${cx}" y="${cy + 6}" font-family="Arial,sans-serif" font-size="16" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${progress}%</text>

	<!-- ETA -->
	${etaText ? `<text x="${cx}" y="68" font-family="Arial,sans-serif" font-size="8" fill="#AAAAAA" text-anchor="middle">${etaText}</text>` : ""}
	` : `
	<!-- Status text when not printing -->
	<text x="${cx}" y="${cy + 4}" font-family="Arial,sans-serif" font-size="10" fill="#888888" text-anchor="middle">${statusText}</text>
	`}
</svg>`;
}

function getRingColor(state: PrinterState["state"]): string {
	switch (state) {
		case "printing": return "#4CAF50";
		case "paused": return "#FF9800";
		case "ready": return "#2196F3";
		case "error": return "#F44336";
		case "offline": return "#555555";
	}
}

function getStatusLabel(state: PrinterState["state"]): string {
	switch (state) {
		case "ready": return "Bereit";
		case "error": return "Fehler";
		case "offline": return "Offline";
		default: return "";
	}
}

function formatTime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (h > 0) return `~${h}h ${m}m`;
	return `~${m}m`;
}
