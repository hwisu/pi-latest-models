import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic-write.ts";

/**
 * Model usage = number of assistant responses per `provider/id`, counted from pi's saved session
 * files (JSONL). Per-file results are cached by size and mtime, so only new or changed sessions are
 * read again. Responses in the running session are added live from `message_end`.
 */

export interface UsageStat {
	count: number;
	/** Timestamp (ms) of the latest response. */
	last: number;
}

/** Keyed by `provider/id`. */
export type UsageMap = Map<string, UsageStat>;

interface FileEntry {
	size: number;
	mtimeMs: number;
	models: Record<string, [count: number, last: number]>;
}

interface CacheFile {
	version: 1;
	files: Record<string, FileEntry>;
}

const SKIPPED_STOP_REASONS = new Set(["error", "aborted", "pending"]);

export function usageKey(provider: string, id: string): string {
	return `${provider}/${id}`;
}

function add(map: UsageMap, key: string, count: number, last: number): void {
	const stat = map.get(key);
	if (stat) {
		stat.count += count;
		stat.last = Math.max(stat.last, last);
	} else {
		map.set(key, { count, last });
	}
}

/** Counts assistant responses in one session file's JSONL text. */
export function countSessionText(text: string): FileEntry["models"] {
	const models: FileEntry["models"] = {};
	for (const line of text.split("\n")) {
		if (!line.includes('"assistant"')) continue;
		let entry: any;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		const message = entry?.type === "message" ? entry.message : undefined;
		if (message?.role !== "assistant" || typeof message.provider !== "string" || typeof message.model !== "string") {
			continue;
		}
		if (SKIPPED_STOP_REASONS.has(message.stopReason)) continue;
		const key = usageKey(message.provider, message.model);
		const time = Number(message.timestamp) || Date.parse(entry.timestamp) || 0;
		const prev = models[key];
		models[key] = prev ? [prev[0] + 1, Math.max(prev[1], time)] : [1, time];
	}
	return models;
}

async function listSessionFiles(root: string, depth = 2): Promise<string[]> {
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		return [];
	}
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(root, entry.name);
		if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
		else if (entry.isDirectory() && depth > 1) files.push(...(await listSessionFiles(path, depth - 1)));
	}
	return files;
}

export class UsageTracker {
	private cache: CacheFile = { version: 1, files: {} };
	private totals: UsageMap = new Map();
	private live: UsageMap = new Map();
	private scanning: Promise<void> | undefined;
	private readonly cachePath: string;

	constructor(cachePath: string) {
		this.cachePath = cachePath;
		this.loadCache();
	}

	/** Usage from the last scan plus responses recorded since. */
	snapshot(): UsageMap {
		const map: UsageMap = new Map();
		for (const [key, stat] of this.totals) add(map, key, stat.count, stat.last);
		for (const [key, stat] of this.live) add(map, key, stat.count, stat.last);
		return map;
	}

	record(provider: string, id: string, time = Date.now()): void {
		add(this.live, usageKey(provider, id), 1, time);
	}

	/** Re-reads new or changed session files under `roots`. Concurrent calls share one scan. */
	scan(roots: readonly string[]): Promise<void> {
		this.scanning ??= this.doScan(roots).finally(() => {
			this.scanning = undefined;
		});
		return this.scanning;
	}

	private async doScan(roots: readonly string[]): Promise<void> {
		// Responses written from now on are read from disk by this scan.
		const liveBefore = this.live;
		this.live = new Map();
		try {
			const files = [...new Set((await Promise.all([...new Set(roots)].map((r) => listSessionFiles(r)))).flat())];
			const next: Record<string, FileEntry> = {};
			for (const path of files) {
				try {
					const info = await stat(path);
					const cached = this.cache.files[path];
					next[path] =
						cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs
							? cached
							: { size: info.size, mtimeMs: info.mtimeMs, models: countSessionText(await readFile(path, "utf-8")) };
				} catch {
					// Deleted or unreadable while scanning.
				}
			}
			this.cache = { version: 1, files: next };
			this.totals = totalsOf(this.cache);
			this.saveCache();
		} catch (error) {
			// Keep the previous totals and the responses recorded before the failed scan.
			for (const [key, stat] of liveBefore) add(this.live, key, stat.count, stat.last);
			throw error;
		}
	}

	private loadCache(): void {
		try {
			if (!existsSync(this.cachePath)) return;
			const parsed = JSON.parse(readFileSync(this.cachePath, "utf-8")) as CacheFile;
			if (parsed?.version === 1 && parsed.files && typeof parsed.files === "object") {
				this.cache = parsed;
				this.totals = totalsOf(parsed);
			}
		} catch {
			// A broken cache is rebuilt by the next scan.
		}
	}

	private saveCache(): void {
		try {
			writeFileAtomic(this.cachePath, JSON.stringify(this.cache));
		} catch {
			// Cache only.
		}
	}
}

function totalsOf(cache: CacheFile): UsageMap {
	const map: UsageMap = new Map();
	for (const file of Object.values(cache.files)) {
		for (const [key, [count, last]] of Object.entries(file.models ?? {})) add(map, key, count, last);
	}
	return map;
}
