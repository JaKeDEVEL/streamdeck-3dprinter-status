import streamDeck, {
	action,
	SingletonAction,
	type JsonObject,
	type WillAppearEvent,
	type WillDisappearEvent,
	type DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import type { SystemStats } from "../moonraker";
import { subscribeSystemStats } from "../printer-manager";

type SystemStatsSettings = JsonObject & {
	printerHost: string;
	printerPort: number;
	pollInterval: number;
};

const DEFAULT_SETTINGS: SystemStatsSettings = {
	printerHost: "",
	printerPort: 7125,
	pollInterval: 5,
};

// ---------------------------------------------------------------------------
// Shared base class – handles subscription lifecycle for all system stat actions
// ---------------------------------------------------------------------------

abstract class SystemStatsBase extends SingletonAction<SystemStatsSettings> {
	private unsubMap = new Map<string, () => void>();

	abstract renderSvg(stats: SystemStats): string;

	override async onWillAppear(ev: WillAppearEvent<SystemStatsSettings>): Promise<void> {
		const settings = { ...DEFAULT_SETTINGS, ...ev.payload.settings };
		await ev.action.setSettings(settings);
		this.subscribe(ev.action, settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<SystemStatsSettings>): void {
		this.unsubMap.get(ev.action.id)?.();
		this.unsubMap.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<SystemStatsSettings>): Promise<void> {
		const settings = { ...DEFAULT_SETTINGS, ...ev.payload.settings };
		this.unsubMap.get(ev.action.id)?.();
		this.subscribe(ev.action, settings);
	}

	private subscribe(
		actionInstance: WillAppearEvent<SystemStatsSettings>["action"],
		settings: SystemStatsSettings
	): void {
		const unsub = subscribeSystemStats(
			settings.printerHost,
			settings.printerPort,
			settings.pollInterval || 5,
			(stats) => this.renderKey(actionInstance, stats)
		);
		this.unsubMap.set(actionInstance.id, unsub);
	}

	private async renderKey(
		actionInstance: WillAppearEvent<SystemStatsSettings>["action"],
		stats: SystemStats
	): Promise<void> {
		try {
			const svg = this.renderSvg(stats);
			await actionInstance.setImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
			await actionInstance.setTitle("");
		} catch (err) {
			streamDeck.logger.error(`System stats render failed: ${err}`);
		}
	}
}

// ---------------------------------------------------------------------------
// Action 1: CPU + RAM
// ---------------------------------------------------------------------------

@action({ UUID: "com.janoskehl.printer-status.cpu-ram" })
export class CpuRamAction extends SystemStatsBase {
	renderSvg(stats: SystemStats): string {
		const ramPercent = stats.ramTotalMb > 0
			? Math.round((stats.ramUsedMb / stats.ramTotalMb) * 100)
			: 0;

		const cpuTempStr    = stats.cpuTemp !== null ? `${Math.round(stats.cpuTemp)}°C` : "--";
		const cpuPctStr     = `${stats.cpuUsage}%`;
		const ramUsedStr    = `${stats.ramUsedMb} MB`;
		const ramPctStr     = `${ramPercent}%`;

		const cpuTempColor  = tempColor(stats.cpuTemp);
		const cpuUsageColor = usageColor(stats.cpuUsage);
		const ramColor      = usageColor(ramPercent);

		const cpuBarW = Math.round(62 * stats.cpuUsage / 100);
		const ramBarW = Math.round(62 * ramPercent / 100);

		return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
	<rect width="72" height="72" rx="8" fill="#111111"/>

	<!-- CPU section: header row, then big %, then bar -->
	<text x="5" y="11" font-family="Arial,sans-serif" font-size="9" font-weight="bold" fill="#4FC3F7">CPU</text>
	<text x="67" y="11" font-family="Arial,sans-serif" font-size="9" fill="${cpuTempColor}" text-anchor="end">${cpuTempStr}</text>

	<text x="5" y="30" font-family="Arial,sans-serif" font-size="20" font-weight="bold" fill="${cpuUsageColor}">${cpuPctStr}</text>

	<rect x="5" y="34" width="62" height="3" rx="1" fill="#333"/>
	<rect x="5" y="34" width="${cpuBarW}" height="3" rx="1" fill="${cpuUsageColor}"/>

	<!-- Divider -->
	<line x1="5" y1="43" x2="67" y2="43" stroke="#333" stroke-width="1"/>

	<!-- RAM section: header row, then used MB, then bar -->
	<text x="5" y="54" font-family="Arial,sans-serif" font-size="9" font-weight="bold" fill="#81C784">RAM</text>
	<text x="67" y="54" font-family="Arial,sans-serif" font-size="9" fill="${ramColor}" text-anchor="end">${ramPctStr}</text>

	<text x="5" y="65" font-family="Arial,sans-serif" font-size="12" fill="#CCCCCC">${ramUsedStr}</text>

	<rect x="5" y="68" width="62" height="3" rx="1" fill="#333"/>
	<rect x="5" y="68" width="${ramBarW}" height="3" rx="1" fill="${ramColor}"/>
</svg>`;
	}
}

// ---------------------------------------------------------------------------
// Action 2: Stepper driver temperatures
// ---------------------------------------------------------------------------

@action({ UUID: "com.janoskehl.printer-status.drivers" })
export class DriverTempsAction extends SystemStatsBase {
	renderSvg(stats: SystemStats): string {
		const drivers = stats.driverTemps;

		if (drivers.length === 0) {
			return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
	<rect width="72" height="72" rx="8" fill="#111111"/>
	<text x="36" y="16" font-family="Arial,sans-serif" font-size="9" font-weight="bold" fill="#FFB74D" text-anchor="middle">DRIVERS</text>
	<text x="36" y="42" font-family="Arial,sans-serif" font-size="11" fill="#555555" text-anchor="middle">–</text>
</svg>`;
		}

		// Each row: label + temp on one line, bar on the line below
		const rowCount  = drivers.length;
		const startY    = 20;
		const available = 68 - startY;
		const rowHeight = Math.floor(available / rowCount);

		const rows = drivers.map((d, i) => {
			const rowTop = startY + i * rowHeight;
			const textY  = rowTop + Math.round(rowHeight * 0.55);
			const barY   = textY + 6;
			const color  = tempColor(d.temp);
			// Bar width scaled: 0°C=0, 120°C=full
			const barW   = Math.round(62 * Math.min(d.temp, 120) / 120);

			return `
	<text x="5" y="${textY}" font-family="Arial,sans-serif" font-size="13" font-weight="bold" fill="#AAAAAA">${d.label}</text>
	<text x="67" y="${textY}" font-family="Arial,sans-serif" font-size="13" font-weight="bold" fill="${color}" text-anchor="end">${Math.round(d.temp)}°C</text>
	<rect x="5" y="${barY}" width="62" height="3" rx="1" fill="#333"/>
	<rect x="5" y="${barY}" width="${barW}" height="3" rx="1" fill="${color}"/>`;
		}).join("");

		return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
	<rect width="72" height="72" rx="8" fill="#111111"/>
	<text x="36" y="13" font-family="Arial,sans-serif" font-size="9" font-weight="bold" fill="#FFB74D" text-anchor="middle">DRIVERS</text>
	${rows}
</svg>`;
	}
}

// ---------------------------------------------------------------------------
// Action 3: Cavity / chamber temperature
// ---------------------------------------------------------------------------

@action({ UUID: "com.janoskehl.printer-status.cavity" })
export class CavityTempAction extends SystemStatsBase {
	renderSvg(stats: SystemStats): string {
		const temp    = stats.cavityTemp;
		const color   = tempColor(temp);
		const tempStr = temp !== null ? `${Math.round(temp)}°C` : "--";

		const minStr = stats.cavityMinTemp !== null ? `${Math.round(stats.cavityMinTemp)}°` : "?";
		const maxStr = stats.cavityMaxTemp !== null ? `${Math.round(stats.cavityMaxTemp)}°` : "?";

		return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
	<rect width="72" height="72" rx="8" fill="#111111"/>

	<text x="36" y="14" font-family="Arial,sans-serif" font-size="9" font-weight="bold" fill="#CE93D8" text-anchor="middle">CHAMBER</text>

	<text x="36" y="44" font-family="Arial,sans-serif" font-size="24" font-weight="bold" fill="${color}" text-anchor="middle">${tempStr}</text>

	<text x="10" y="62" font-family="Arial,sans-serif" font-size="8" fill="#777777" text-anchor="middle">Min</text>
	<text x="10" y="70" font-family="Arial,sans-serif" font-size="9" fill="#80DEEA" text-anchor="middle">${minStr}</text>

	<text x="62" y="62" font-family="Arial,sans-serif" font-size="8" fill="#777777" text-anchor="middle">Max</text>
	<text x="62" y="70" font-family="Arial,sans-serif" font-size="9" fill="#EF5350" text-anchor="middle">${maxStr}</text>
</svg>`;
	}
}

// ---------------------------------------------------------------------------
// Shared color helpers
// ---------------------------------------------------------------------------

function tempColor(temp: number | null): string {
	if (temp === null) return "#888888";
	if (temp >= 80)   return "#EF5350";
	if (temp >= 60)   return "#FFA726";
	if (temp >= 40)   return "#FFEE58";
	return "#80DEEA";
}

function usageColor(pct: number): string {
	if (pct >= 85) return "#EF5350";
	if (pct >= 60) return "#FFA726";
	return "#81C784";
}
