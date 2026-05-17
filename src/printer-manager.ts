import { MoonrakerClient, type PrinterState, type SystemStats } from "./moonraker";
import { PrusaLinkClient } from "./prusalink";

interface PrinterEntry<T> {
	client: T;
	state: PrinterState;
	interval: ReturnType<typeof setInterval>;
	listeners: Set<(state: PrinterState) => void>;
}

interface SystemStatsEntry {
	client: MoonrakerClient;
	stats: SystemStats;
	interval: ReturnType<typeof setInterval>;
	listeners: Set<(stats: SystemStats) => void>;
}

// ---------------------------------------------------------------------------
// Moonraker (Klipper) printers
// ---------------------------------------------------------------------------

const moonrakerPrinters = new Map<string, PrinterEntry<MoonrakerClient>>();

function printerKey(host: string, port: number, suffix = ""): string {
	return suffix ? `${host}:${port}:${suffix}` : `${host}:${port}`;
}

export function subscribeMoonraker(
	host: string,
	port: number,
	pollInterval: number,
	listener: (state: PrinterState) => void
): () => void {
	const key = printerKey(host, port);
	let entry = moonrakerPrinters.get(key);

	if (!entry) {
		const client = new MoonrakerClient(host, port);
		const state: PrinterState = { state: "offline", progress: 0, filename: null, etaSeconds: null, message: "...", nozzleTemp: null, nozzleTarget: null, bedTemp: null, bedTarget: null, activeExtruderIndex: null };

		const update = async () => {
			const next = await client.getStatus();
			entry!.state = next;
			entry!.listeners.forEach((cb) => cb(next));
		};

		const interval = setInterval(update, pollInterval * 1000);
		entry = { client, state, interval, listeners: new Set() };
		moonrakerPrinters.set(key, entry);
		update();
	}

	entry.listeners.add(listener);
	return () => {
		const e = moonrakerPrinters.get(key);
		if (!e) return;
		e.listeners.delete(listener);
		if (e.listeners.size === 0) { clearInterval(e.interval); moonrakerPrinters.delete(key); }
	};
}

export function getMoonrakerClient(host: string, port: number): MoonrakerClient | undefined {
	return moonrakerPrinters.get(printerKey(host, port))?.client;
}

// ---------------------------------------------------------------------------
// PrusaLink printers
// ---------------------------------------------------------------------------

const prusaLinkPrinters = new Map<string, PrinterEntry<PrusaLinkClient>>();

export function subscribePrusaLink(
	host: string,
	port: number,
	username: string,
	password: string,
	pollInterval: number,
	listener: (state: PrinterState) => void
): () => void {
	const key = printerKey(host, port, username);
	let entry = prusaLinkPrinters.get(key);

	if (!entry) {
		const client = new PrusaLinkClient(host, port, username, password);
		const state: PrinterState = { state: "offline", progress: 0, filename: null, etaSeconds: null, message: "...", nozzleTemp: null, nozzleTarget: null, bedTemp: null, bedTarget: null, activeExtruderIndex: null };

		const update = async () => {
			const next = await client.getStatus();
			entry!.state = next;
			entry!.listeners.forEach((cb) => cb(next));
		};

		const interval = setInterval(update, pollInterval * 1000);
		entry = { client, state, interval, listeners: new Set() };
		prusaLinkPrinters.set(key, entry);
		update();
	}

	entry.listeners.add(listener);
	return () => {
		const e = prusaLinkPrinters.get(key);
		if (!e) return;
		e.listeners.delete(listener);
		if (e.listeners.size === 0) { clearInterval(e.interval); prusaLinkPrinters.delete(key); }
	};
}

export function getPrusaLinkClient(host: string, port: number, username: string): PrusaLinkClient | undefined {
	return prusaLinkPrinters.get(printerKey(host, port, username))?.client;
}

// ---------------------------------------------------------------------------
// Backwards-compat alias (used by existing Moonraker-only callers)
// ---------------------------------------------------------------------------

export const subscribePrinter = subscribeMoonraker;
export const getPrinterClient = getMoonrakerClient;

// ---------------------------------------------------------------------------
// System stats (Moonraker / Klipper only)
// ---------------------------------------------------------------------------

const systemStatsPollers = new Map<string, SystemStatsEntry>();

export function subscribeSystemStats(
	host: string,
	port: number,
	pollInterval: number,
	listener: (stats: SystemStats) => void
): () => void {
	const key = printerKey(host, port);
	let entry = systemStatsPollers.get(key);

	if (!entry) {
		const client = new MoonrakerClient(host, port);
		const stats: SystemStats = {
			cpuTemp: null, cpuUsage: 0, ramUsedMb: 0, ramTotalMb: 0,
			driverTemps: [], cavityTemp: null, cavityMinTemp: null, cavityMaxTemp: null,
		};

		const update = async () => {
			const next = await client.getSystemStats();
			entry!.stats = next;
			entry!.listeners.forEach((cb) => cb(next));
		};

		const interval = setInterval(update, pollInterval * 1000);
		entry = { client, stats, interval, listeners: new Set() };
		systemStatsPollers.set(key, entry);
		update();
	}

	entry.listeners.add(listener);
	return () => {
		const e = systemStatsPollers.get(key);
		if (!e) return;
		e.listeners.delete(listener);
		if (e.listeners.size === 0) { clearInterval(e.interval); systemStatsPollers.delete(key); }
	};
}
