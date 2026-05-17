import streamDeck, {
	action,
	SingletonAction,
	type JsonObject,
	type WillAppearEvent,
	type WillDisappearEvent,
	type DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import type { PrinterState } from "../moonraker";
import { subscribeMoonraker, subscribePrusaLink } from "../printer-manager";

type TempSettings = JsonObject & {
	printerHost: string;
	printerPort: number;
	pollInterval: number;
	printerType: "moonraker" | "prusalink";
	printerUsername: string;
	printerPassword: string;
};

const DEFAULT_SETTINGS: TempSettings = {
	printerHost: "",
	printerPort: 7125,
	pollInterval: 5,
	printerType: "moonraker",
	printerUsername: "",
	printerPassword: "",
};

// ---------------------------------------------------------------------------
// Shared base
// ---------------------------------------------------------------------------

abstract class TempBase extends SingletonAction<TempSettings> {
	private unsubMap = new Map<string, () => void>();

	abstract renderSvg(state: PrinterState): string;

	override async onWillAppear(ev: WillAppearEvent<TempSettings>): Promise<void> {
		const settings = { ...DEFAULT_SETTINGS, ...ev.payload.settings };
		await ev.action.setSettings(settings);
		this.subscribe(ev.action, settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<TempSettings>): void {
		this.unsubMap.get(ev.action.id)?.();
		this.unsubMap.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<TempSettings>): Promise<void> {
		const settings = { ...DEFAULT_SETTINGS, ...ev.payload.settings };
		this.unsubMap.get(ev.action.id)?.();
		this.subscribe(ev.action, settings);
	}

	private subscribe(actionInstance: WillAppearEvent<TempSettings>["action"], settings: TempSettings): void {
		const cb = (state: PrinterState) => this.renderKey(actionInstance, state);
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
		this.unsubMap.set(actionInstance.id, unsub);
	}

	private async renderKey(actionInstance: WillAppearEvent<TempSettings>["action"], state: PrinterState): Promise<void> {
		try {
			const svg = this.renderSvg(state);
			await actionInstance.setImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
			await actionInstance.setTitle("");
		} catch (err) {
			streamDeck.logger.error(`Temps render failed: ${err}`);
		}
	}
}

// ---------------------------------------------------------------------------
// Action 1: Nozzle temperature
// ---------------------------------------------------------------------------

@action({ UUID: "com.janoskehl.printer-status.nozzle-temp" })
export class NozzleTempAction extends TempBase {
	renderSvg(state: PrinterState): string {
		const label = state.activeExtruderIndex !== null
			? `NOZZLE ${state.activeExtruderIndex + 1}`
			: "NOZZLE";
		return renderTempSvg({
			label,
			labelColor: "#FF8A65",
			current:    state.nozzleTemp,
			target:     state.nozzleTarget,
		});
	}
}

// ---------------------------------------------------------------------------
// Action 2: Bed temperature
// ---------------------------------------------------------------------------

@action({ UUID: "com.janoskehl.printer-status.bed-temp" })
export class BedTempAction extends TempBase {
	renderSvg(state: PrinterState): string {
		return renderTempSvg({
			label:      "BED",
			labelColor: "#64B5F6",
			current:    state.bedTemp,
			target:     state.bedTarget,
		});
	}
}

// ---------------------------------------------------------------------------
// Shared SVG renderer
// ---------------------------------------------------------------------------

interface TempRenderOpts {
	label: string;
	labelColor: string;
	current: number | null;
	target: number | null;
}

function renderTempSvg({ label, labelColor, current, target }: TempRenderOpts): string {
	const cur     = current !== null ? Math.round(current) : null;
	const tgt     = target  !== null ? Math.round(target)  : null;

	const curStr  = cur !== null ? `${cur}°C` : "--";
	const tgtStr  = tgt !== null && tgt > 0 ? `▶ ${tgt}°C` : "";
	const color   = heaterColor(current, target);

	// Status line: AT TARGET / HEATING / OFF
	const statusStr  = heaterStatus(current, target);
	const statusColor = statusStr === "AT TARGET" ? "#81C784"
		: statusStr === "HEATING"    ? "#FFA726"
		: "#555555";

	// Bar: 0–1 fraction of current/target (capped at 1)
	const barFrac = heatingBar(current, target);
	const barW    = Math.round(62 * barFrac);

	return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
	<rect width="72" height="72" rx="8" fill="#111111"/>

	<!-- Label -->
	<text x="36" y="13" font-family="Arial,sans-serif" font-size="10" font-weight="bold" fill="${labelColor}" text-anchor="middle">${label}</text>

	<!-- Current temp (large) -->
	<text x="36" y="40" font-family="Arial,sans-serif" font-size="20" font-weight="bold" fill="${color}" text-anchor="middle">${curStr}</text>

	<!-- Target temp -->
	<text x="36" y="52" font-family="Arial,sans-serif" font-size="10" fill="#666666" text-anchor="middle">${tgtStr}</text>

	<!-- Status -->
	<text x="36" y="62" font-family="Arial,sans-serif" font-size="9" fill="${statusColor}" text-anchor="middle">${statusStr}</text>

	<!-- Heating progress bar -->
	<rect x="5" y="65" width="62" height="4" rx="2" fill="#333"/>
	<rect x="5" y="65" width="${barW}" height="4" rx="2" fill="${color}"/>
</svg>`;
}

function heaterColor(current: number | null, target: number | null): string {
	if (current === null)          return "#555555";
	if (!target || target < 5)     return "#80DEEA"; // off
	if (current >= target - 3)     return "#81C784"; // at target
	if (current > target * 0.5)    return "#FFA726"; // heating
	return "#EF5350";                                 // cold
}

function heaterStatus(current: number | null, target: number | null): string {
	if (current === null)       return "";
	if (!target || target < 5)  return "OFF";
	if (current >= target - 3)  return "AT TARGET";
	return "HEATING";
}

function heatingBar(current: number | null, target: number | null): number {
	if (current === null || !target || target < 5) return 0;
	return Math.min(1, current / target);
}
