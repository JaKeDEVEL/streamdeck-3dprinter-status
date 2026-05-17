/**
 * Moonraker API client for communicating with Klipper 3D printers.
 */

export interface SystemStats {
	/** CPU temperature in °C, or null if unavailable */
	cpuTemp: number | null;
	/** Overall CPU usage 0-100% */
	cpuUsage: number;
	/** RAM used in MB */
	ramUsedMb: number;
	/** Total RAM in MB */
	ramTotalMb: number;
	/** Stepper driver temperatures (only drivers that report temp) */
	driverTemps: Array<{ label: string; temp: number }>;
	/** Chamber/cavity sensor temperature in °C, or null if unavailable */
	cavityTemp: number | null;
	/** Lowest recorded cavity temperature since Klipper started */
	cavityMinTemp: number | null;
	/** Highest recorded cavity temperature since Klipper started */
	cavityMaxTemp: number | null;
}

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
	/** Nozzle temperature in °C */
	nozzleTemp: number | null;
	/** Nozzle target temperature in °C (0 = off) */
	nozzleTarget: number | null;
	/** Bed temperature in °C */
	bedTemp: number | null;
	/** Bed target temperature in °C (0 = off) */
	bedTarget: number | null;
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
							extruder: ["temperature", "target"],
							heater_bed: ["temperature", "target"],
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

			const extruder  = objects.result?.status?.extruder;
			const heaterBed = objects.result?.status?.heater_bed;
			const nozzleTemp:   number | null = extruder?.temperature  ?? null;
			const nozzleTarget: number | null = extruder?.target       ?? null;
			const bedTemp:      number | null = heaterBed?.temperature ?? null;
			const bedTarget:    number | null = heaterBed?.target      ?? null;

			const message = this.formatMessage(state, progress, filename, etaSeconds);

			return { state, progress, filename, etaSeconds, message, nozzleTemp, nozzleTarget, bedTemp, bedTarget };
		} catch {
			return {
				state: "offline",
				progress: 0,
				filename: null,
				etaSeconds: null,
				message: "Offline",
				nozzleTemp: null,
				nozzleTarget: null,
				bedTemp: null,
				bedTarget: null,
			};
		}
	}

	/**
	 * Fetch system resource stats (CPU, RAM) and stepper driver temperatures.
	 */
	async getSystemStats(): Promise<SystemStats> {
		const empty: SystemStats = {
			cpuTemp: null, cpuUsage: 0, ramUsedMb: 0, ramTotalMb: 0,
			driverTemps: [], cavityTemp: null, cavityMinTemp: null, cavityMaxTemp: null,
		};
		try {
			const procRes = await this.fetch("/machine/proc_stats");
			const proc = await procRes.json();

			const cpuTemp: number | null = proc.result?.cpu_temp ?? null;
			const cpuUsage = Math.round(proc.result?.system_cpu_usage?.cpu ?? 0);
			const mem = proc.result?.system_memory ?? {};
			const ramUsedMb = Math.round((mem.used ?? 0) / 1024);
			const ramTotalMb = Math.round((mem.total ?? 1) / 1024);

			let driverTemps: Array<{ label: string; temp: number }> = [];
			let cavityTemp: number | null = null;
			let cavityMinTemp: number | null = null;
			let cavityMaxTemp: number | null = null;

			try {
				// Known driver objects and their short labels – query all, keep those reporting temps
				const DRIVERS: Array<[string, string]> = [
					["tmc2240 stepper_x", "X"],
					["tmc2240 stepper_y", "Y"],
					["tmc2240 stepper_z", "Z"],
					["tmc2209 stepper_x", "X"],
					["tmc2209 stepper_y", "Y"],
					["tmc2209 stepper_z", "Z"],
					["tmc2209 extruder",  "E0"],
					["tmc2209 extruder1", "E1"],
					["tmc2209 extruder2", "E2"],
					["tmc2209 extruder3", "E3"],
				];
				const SENSORS = [
					"temperature_sensor cavity",
					"temperature_sensor chamber",
				];

				const objects: Record<string, string[]> = {};
				for (const [key] of DRIVERS) objects[key] = ["temperature"];
				for (const key of SENSORS)   objects[key] = ["temperature", "measured_min_temp", "measured_max_temp"];

				const objRes = await this.fetch("/printer/objects/query", {
					method: "POST",
					body: JSON.stringify({ objects }),
				});
				const objData = await objRes.json();
				const status: Record<string, Record<string, unknown>> = objData.result?.status ?? {};

				const seen = new Set<string>();
				for (const [key, label] of DRIVERS) {
					const temp = status[key]?.temperature;
					if (typeof temp === "number" && !seen.has(label)) {
						driverTemps.push({ label, temp });
						seen.add(label);
					}
				}

				for (const key of SENSORS) {
					const temp = status[key]?.temperature;
					if (typeof temp === "number") {
						cavityTemp = temp;
						const min = status[key]?.measured_min_temp;
						const max = status[key]?.measured_max_temp;
						if (typeof min === "number") cavityMinTemp = min;
						if (typeof max === "number") cavityMaxTemp = max;
						break;
					}
				}
			} catch {
				// Driver/sensor data unavailable – proc_stats values are still returned
			}

			return { cpuTemp, cpuUsage, ramUsedMb, ramTotalMb, driverTemps, cavityTemp, cavityMinTemp, cavityMaxTemp };
		} catch {
			return empty;
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
				return "Ready";
			case "error":
				return "Error";
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
