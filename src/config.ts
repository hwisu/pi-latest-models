import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface Config {
	/** Collapse the /model list to the newest models of each family. */
	enabled: boolean;
	/** How many models of each family to keep. */
	perFamily: number;
	/** Globs (`provider/id` or bare `id`) that are always listed. */
	keep: string[];
	/** Key inside /model that toggles between "latest only" and "all versions". */
	toggleKey: string;
}

export const DEFAULT_CONFIG: Config = {
	enabled: true,
	perFamily: 1,
	keep: [],
	toggleKey: "alt+v",
};

export function configPath(): string {
	return join(getAgentDir(), "latest-models.json");
}

export function normalizeConfig(raw: unknown): Config {
	const value = raw && typeof raw === "object" ? (raw as Partial<Record<keyof Config, unknown>>) : {};
	const perFamily = Number(value.perFamily);
	return {
		enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_CONFIG.enabled,
		perFamily: Number.isFinite(perFamily) && perFamily >= 1 ? Math.floor(perFamily) : DEFAULT_CONFIG.perFamily,
		keep: Array.isArray(value.keep) ? value.keep.filter((p): p is string => typeof p === "string" && p.length > 0) : [],
		toggleKey:
			typeof value.toggleKey === "string" && value.toggleKey.trim() ? value.toggleKey.trim() : DEFAULT_CONFIG.toggleKey,
	};
}

let cached: { config: Config; error?: string } | undefined;

export function loadConfig(force = false): { config: Config; error?: string } {
	if (cached && !force) return cached;
	const path = configPath();
	try {
		cached = existsSync(path)
			? { config: normalizeConfig(JSON.parse(readFileSync(path, "utf-8"))) }
			: { config: { ...DEFAULT_CONFIG } };
	} catch (error) {
		cached = {
			config: { ...DEFAULT_CONFIG },
			error: `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	return cached;
}

export function getConfig(): Config {
	return loadConfig().config;
}

export function saveConfig(update: (config: Config) => Config): Config {
	const next = normalizeConfig(update(getConfig()));
	const path = configPath();
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
	renameSync(tmp, path);
	cached = { config: next };
	return next;
}
