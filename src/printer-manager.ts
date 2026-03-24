import { MoonrakerClient, type PrinterState } from "./moonraker";

interface PrinterEntry {
	client: MoonrakerClient;
	state: PrinterState;
	interval: ReturnType<typeof setInterval>;
	listeners: Set<(state: PrinterState) => void>;
}

/**
 * Shared manager that polls each printer once and notifies all listeners.
 * Key = "host:port"
 */
const printers = new Map<string, PrinterEntry>();

function printerKey(host: string, port: number): string {
	return `${host}:${port}`;
}

export function subscribePrinter(
	host: string,
	port: number,
	pollInterval: number,
	listener: (state: PrinterState) => void
): () => void {
	const key = printerKey(host, port);
	let entry = printers.get(key);

	if (!entry) {
		const client = new MoonrakerClient(host, port);
		const state: PrinterState = {
			state: "offline",
			progress: 0,
			filename: null,
			etaSeconds: null,
			message: "...",
		};

		const update = async () => {
			const newState = await client.getStatus();
			entry!.state = newState;
			entry!.listeners.forEach((cb) => cb(newState));
		};

		const interval = setInterval(update, pollInterval * 1000);
		entry = { client, state, interval, listeners: new Set() };
		printers.set(key, entry);

		// Initial fetch
		update();
	}

	entry.listeners.add(listener);

	// Return unsubscribe function
	return () => {
		const e = printers.get(key);
		if (!e) return;
		e.listeners.delete(listener);
		if (e.listeners.size === 0) {
			clearInterval(e.interval);
			printers.delete(key);
		}
	};
}

export function getPrinterClient(host: string, port: number): MoonrakerClient | undefined {
	return printers.get(printerKey(host, port))?.client;
}
