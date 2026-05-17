/**
 * PrusaLink API client for Prusa printers (Core One, MK4, XL, MINI).
 * Uses HTTP Digest authentication against the local /api/v1/ REST API.
 */

import { createHash } from "node:crypto";
import type { PrinterState } from "./moonraker";

export type { PrinterState };

export class PrusaLinkClient {
	private baseUrl: string;
	private username: string;
	private password: string;
	private currentJobId: number | null = null;

	constructor(host: string, port: number = 80, username: string, password: string) {
		this.baseUrl = `http://${host}:${port}`;
		this.username = username;
		this.password = password;
	}

	async getStatus(): Promise<PrinterState> {
		try {
			const res = await this.fetch("/api/v1/status");
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();

			const rawState: string = data.printer?.state ?? "ERROR";
			const state = mapState(rawState);

			let progress = 0;
			let etaSeconds: number | null = null;
			let filename: string | null = null;

			if (state === "printing" || state === "paused") {
				try {
					const jobRes = await this.fetch("/api/v1/job");
					if (jobRes.status === 200) {
						const job = await jobRes.json();
						this.currentJobId = job.id ?? null;
						progress = Math.round(job.progress ?? 0);
						etaSeconds = typeof job.time_remaining === "number" ? job.time_remaining : null;
						filename = job.file?.name ?? null;
					}
				} catch {
					// job data unavailable — progress stays 0
				}
			}

			const nozzleTemp:   number | null = data.printer?.temp_nozzle   ?? null;
			const nozzleTarget: number | null = data.printer?.target_nozzle ?? null;
			const bedTemp:      number | null = data.printer?.temp_bed      ?? null;
			const bedTarget:    number | null = data.printer?.target_bed    ?? null;

			const message = formatMessage(state, progress, etaSeconds);
			return { state, progress, filename, etaSeconds, message, nozzleTemp, nozzleTarget, bedTemp, bedTarget };
		} catch {
			return {
				state: "offline", progress: 0, filename: null, etaSeconds: null, message: "Offline",
				nozzleTemp: null, nozzleTarget: null, bedTemp: null, bedTarget: null,
			};
		}
	}

	async pause(): Promise<void> {
		if (this.currentJobId === null) return;
		await this.fetch(`/api/v1/job/${this.currentJobId}/pause`, "PUT");
	}

	async resume(): Promise<void> {
		if (this.currentJobId === null) return;
		await this.fetch(`/api/v1/job/${this.currentJobId}/resume`, "PUT");
	}

	private async fetch(path: string, method = "GET"): Promise<Response> {
		const url = `${this.baseUrl}${path}`;

		// Step 1: unauthenticated request to get the Digest challenge
		const res1 = await fetch(url, {
			method,
			signal: AbortSignal.timeout(5000),
		});

		if (res1.status !== 401) return res1;

		// Step 2: parse challenge and reply with credentials
		const wwwAuth = res1.headers.get("www-authenticate") ?? "";
		const realm   = digestParam(wwwAuth, "realm");
		const nonce   = digestParam(wwwAuth, "nonce");

		const ha1      = md5(`${this.username}:${realm}:${this.password}`);
		const ha2      = md5(`${method}:${path}`);
		const response = md5(`${ha1}:${nonce}:${ha2}`);

		const authHeader =
			`Digest username="${this.username}", realm="${realm}", ` +
			`nonce="${nonce}", uri="${path}", response="${response}"`;

		return fetch(url, {
			method,
			headers: { Authorization: authHeader },
			signal: AbortSignal.timeout(5000),
		});
	}
}

function mapState(s: string): PrinterState["state"] {
	switch (s) {
		case "PRINTING":  return "printing";
		case "PAUSED":
		case "ATTENTION": return "paused";
		case "ERROR":     return "error";
		// IDLE, FINISHED, STOPPED → ready
		default:          return "ready";
	}
}

function formatMessage(
	state: PrinterState["state"],
	progress: number,
	etaSeconds: number | null
): string {
	switch (state) {
		case "printing": {
			const eta = etaSeconds ? ` ~${formatTime(etaSeconds)}` : "";
			return `${progress}%${eta}`;
		}
		case "paused":  return `Paused ${progress}%`;
		case "ready":   return "Ready";
		case "error":   return "Error";
		case "offline": return "Offline";
	}
}

function formatTime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (h > 0) return `${h}h${m}m`;
	return `${m}m`;
}

function md5(str: string): string {
	return createHash("md5").update(str).digest("hex");
}

function digestParam(header: string, key: string): string {
	const m = header.match(new RegExp(`${key}="([^"]+)"`));
	return m?.[1] ?? "";
}
