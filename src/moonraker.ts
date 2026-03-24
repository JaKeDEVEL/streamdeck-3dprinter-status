/**
 * Moonraker API client for communicating with Klipper 3D printers.
 */

export interface PrinterState {
	/** Printer state: ready, printing, paused, error, offline */
	state: "ready" | "printing" | "paused" | "error" | "offline";
	/** Print progress 0-100 */
	progress: number;
	/** Currently printing filename or null */
	filename: string | null;
	/** Estimated time remaining in seconds */
	etaSeconds: number | null;
	/** Human-readable status message */
	message: string;
}

export class MoonrakerClient {
	private baseUrl: string;

	constructor(host: string, port: number = 7125) {
		this.baseUrl = `http://${host}:${port}`;
	}

	/**
	 * Fetch printer info and print status in one call.
	 */
	async getStatus(): Promise<PrinterState> {
		try {
			const [infoRes, objectsRes] = await Promise.all([
				this.fetch("/printer/info"),
				this.fetch("/printer/objects/query", {
					method: "POST",
					body: JSON.stringify({
						objects: {
							virtual_sdcard: ["progress", "file_position", "is_active"],
							print_stats: ["state", "filename", "total_duration", "print_duration"],
							display_status: ["progress", "message"],
						},
					}),
				}),
			]);

			const info = await infoRes.json();
			const objects = await objectsRes.json();

			const klippyState = info.result?.state ?? "error";
			const printStats = objects.result?.status?.print_stats;
			const virtualSd = objects.result?.status?.virtual_sdcard;

			const progress = Math.round((virtualSd?.progress ?? 0) * 100);
			const printState = printStats?.state ?? "standby";
			const filename = printStats?.filename || null;

			let state: PrinterState["state"];
			if (klippyState !== "ready") {
				state = "error";
			} else if (printState === "printing") {
				state = "printing";
			} else if (printState === "paused") {
				state = "paused";
			} else {
				state = "ready";
			}

			// Estimate remaining time
			let etaSeconds: number | null = null;
			if (state === "printing" && progress > 0) {
				const elapsed = printStats?.print_duration ?? 0;
				etaSeconds = Math.round((elapsed / progress) * (100 - progress));
			}

			const message = this.formatMessage(state, progress, filename, etaSeconds);

			return { state, progress, filename, etaSeconds, message };
		} catch {
			return {
				state: "offline",
				progress: 0,
				filename: null,
				etaSeconds: null,
				message: "Offline",
			};
		}
	}

	/** Pause the current print. */
	async pause(): Promise<void> {
		await this.fetch("/printer/print/pause", { method: "POST" });
	}

	/** Resume the current print. */
	async resume(): Promise<void> {
		await this.fetch("/printer/print/resume", { method: "POST" });
	}

	private async fetch(path: string, init?: RequestInit): Promise<Response> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 5000);
		try {
			return await fetch(`${this.baseUrl}${path}`, {
				...init,
				headers: { "Content-Type": "application/json", ...init?.headers },
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timeout);
		}
	}

	private formatMessage(
		state: PrinterState["state"],
		progress: number,
		filename: string | null,
		etaSeconds: number | null
	): string {
		switch (state) {
			case "printing": {
				const eta = etaSeconds ? ` ~${this.formatTime(etaSeconds)}` : "";
				return `${progress}%${eta}`;
			}
			case "paused":
				return `Paused ${progress}%`;
			case "ready":
				return "Bereit";
			case "error":
				return "Fehler";
			case "offline":
				return "Offline";
		}
	}

	private formatTime(seconds: number): string {
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		if (h > 0) return `${h}h${m}m`;
		return `${m}m`;
	}
}
