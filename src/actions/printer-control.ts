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
import {
	subscribeMoonraker, subscribePrusaLink,
	getMoonrakerClient, getPrusaLinkClient,
} from "../printer-manager";

type PrinterSettings = JsonObject & {
	printerHost: string;
	printerPort: number;
	printerName: string;
	pollInterval: number;
	printerType: "moonraker" | "prusalink";
	printerUsername: string;
	printerPassword: string;
};

const DEFAULT_SETTINGS: PrinterSettings = {
	printerHost: "",
	printerPort: 7125,
	printerName: "My Printer",
	pollInterval: 5,
	printerType: "moonraker",
	printerUsername: "",
	printerPassword: "",
};

const unsubMap = new Map<string, () => void>();
const stateMap = new Map<string, PrinterState>();

@action({ UUID: "com.janoskehl.printer-status.control" })
export class PrinterControlAction extends SingletonAction<PrinterSettings> {

	override async onWillAppear(ev: WillAppearEvent<PrinterSettings>): Promise<void> {
		const settings = { ...DEFAULT_SETTINGS, ...ev.payload.settings };
		await ev.action.setSettings(settings);
		this.subscribe(ev.action, settings);
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
		if (!state) return;

		const client = settings.printerType === "prusalink"
			? getPrusaLinkClient(settings.printerHost, settings.printerPort, settings.printerUsername)
			: getMoonrakerClient(settings.printerHost, settings.printerPort);

		if (!client) return;

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
		unsubMap.get(ev.action.id)?.();
		this.subscribe(ev.action, settings);
	}

	private subscribe(
		actionInstance: WillAppearEvent<PrinterSettings>["action"],
		settings: PrinterSettings
	): void {
		const id = actionInstance.id;
		const cb = (state: PrinterState) => {
			stateMap.set(id, state);
			this.renderKey(actionInstance, state, settings.printerName, settings.printerType);
		};

		const unsub = settings.printerType === "prusalink"
			? subscribePrusaLink(
				settings.printerHost, settings.printerPort,
				settings.printerUsername, settings.printerPassword,
				settings.pollInterval || 5, cb
			)
			: subscribeMoonraker(
				settings.printerHost, settings.printerPort,
				settings.pollInterval || 5, cb
			);

		unsubMap.set(id, unsub);
	}

	private async renderKey(
		actionInstance: WillAppearEvent<PrinterSettings>["action"],
		state: PrinterState,
		name: string,
		printerType: PrinterSettings["printerType"] = "moonraker"
	): Promise<void> {
		try {
			const svg = renderControlImage(state, name, printerType);
			await actionInstance.setImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
			await actionInstance.setTitle("");
		} catch (err) {
			streamDeck.logger.error(`Render failed: ${err}`);
		}
	}
}

function renderControlImage(state: PrinterState, name: string, printerType: PrinterSettings["printerType"] = "moonraker"): string {
	const bg = printerType === "prusalink"
		? getPrusaBackgroundColor(state.state)
		: getBackgroundColor(state.state);
	const statusLabel = getStatusLabel(state.state);

	const pauseOverlay =
		state.state === "paused"
			? `<rect x="27" y="18" width="5" height="14" rx="1" fill="#FFF" opacity="0.85"/>
			   <rect x="36" y="18" width="5" height="14" rx="1" fill="#FFF" opacity="0.85"/>`
			: "";

	// Prusa "L" logo (original viewBox 42.47×42.47), scaled to 36px and centered
	const prusaIcon = `<g transform="translate(18, 4) scale(${(36 / 42.47).toFixed(4)})">
		<path fill="#FFFFFF" fill-rule="nonzero" d="M12.23 34.79h19.71v-6.07H19.29V7.68h-7.06z"/>
	</g>`;

	const printerIcon = `<g transform="translate(18, 6)" fill="none" stroke="#FFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
		<rect x="2" y="24" width="32" height="8" rx="2"/>
		<rect x="6" y="12" width="24" height="12" rx="2"/>
		<path d="M10 12 V6 H26 V12"/>
		<line x1="18" y1="32" x2="18" y2="38"/>
	</g>`;

	const icon = printerType === "prusalink" ? prusaIcon : printerIcon;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
	<rect width="72" height="72" rx="8" fill="${bg}"/>
	${icon}
	${pauseOverlay}
	<text x="36" y="54" font-family="Arial,sans-serif" font-size="8" font-weight="bold" fill="#FFF" text-anchor="middle">${escapeXml(name)}</text>
	<text x="36" y="65" font-family="Arial,sans-serif" font-size="8" fill="#FFFFFFcc" text-anchor="middle">${statusLabel}</text>
</svg>`;
}

function getStatusLabel(state: PrinterState["state"]): string {
	switch (state) {
		case "printing": return "Printing";
		case "paused":   return "Paused";
		case "ready":    return "Ready";
		case "error":    return "Error";
		case "offline":  return "Offline";
	}
}

function getPrusaBackgroundColor(state: PrinterState["state"]): string {
	switch (state) {
		case "printing": return "#C44E10";
		case "paused":   return "#8B3008";
		case "ready":    return "#FA6831";
		case "error":    return "#B71C1C";
		case "offline":  return "#424242";
	}
}

function getBackgroundColor(state: PrinterState["state"]): string {
	switch (state) {
		case "printing": return "#1B5E20";
		case "paused":   return "#E65100";
		case "ready":    return "#1A237E";
		case "error":    return "#B71C1C";
		case "offline":  return "#424242";
	}
}

function escapeXml(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
