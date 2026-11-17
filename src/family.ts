/**
 * Model ID parsing: split an ID into a family ("claude-sonnet", "gpt-sol", "gemini-flash")
 * and a comparable version, so that only the newest model of each family is listed.
 *
 * Pure functions, no pi imports, so they can be unit tested with `node --test`.
 */

export interface ModelRef {
	provider: string;
	id: string;
}

export interface ParsedModelId {
	/** Family name without version numbers, release tags, or dates. */
	family: string;
	/** Numeric version parts in order of appearance: "claude-opus-4-5" -> [4, 5]. */
	version: number[];
	/** 2 = stable, 1 = preview/beta/rc, 0 = experimental/alpha. */
	channel: number;
	/** Date or snapshot suffix ("20250929", "2411"). Empty for aliases that track the newest build. */
	snapshot: string;
}

const CHANNEL: Record<string, number> = {
	preview: 1,
	beta: 1,
	rc: 1,
	exp: 0,
	experimental: 0,
	alpha: 0,
};

const VERSION_TOKEN = /^v?\d{1,3}(?:\.\d{1,3})*$/;
const SNAPSHOT_TOKEN = /^\d{4,}$/;
const NAME_VERSION_TOKEN = /^([a-z]+)(\d{1,3}(?:\.\d{1,3})*)$/;

function pushVersion(target: number[], text: string): void {
	for (const part of text.replace(/^v/, "").split(".")) target.push(Number(part));
}

export function parseModelId(id: string): ParsedModelId {
	let rest = id.trim().toLowerCase();
	let snapshot = "";
	let channel = 2;

	// "anthropic/claude-sonnet-4.5" (OpenRouter style): the vendor prefix is part of the family.
	const slash = rest.lastIndexOf("/");
	const prefix = slash >= 0 ? rest.slice(0, slash + 1) : "";
	rest = rest.slice(slash + 1);

	// "model:free", "model:thinking": a variant, kept in the family.
	const colon = rest.indexOf(":");
	const variant = colon >= 0 ? rest.slice(colon) : "";
	if (colon >= 0) rest = rest.slice(0, colon);

	// Vertex style "claude-sonnet-4-5@20250929".
	const at = rest.indexOf("@");
	if (at >= 0) {
		snapshot = rest.slice(at + 1).replace(/\D/g, "") || rest.slice(at + 1);
		rest = rest.slice(0, at);
	}

	let m = rest.match(/[-_](\d{4})-(\d{2})-(\d{2})$/); // gpt-4o-2024-08-06
	if (m && !snapshot) {
		snapshot = m[1] + m[2] + m[3];
		rest = rest.slice(0, m.index);
	}
	m = rest.match(/[-_](\d{8})$/); // claude-haiku-4-5-20251001
	if (m && !snapshot) {
		snapshot = m[1];
		rest = rest.slice(0, m.index);
	}
	m = rest.match(/-(preview|exp)-(\d{2})-(\d{2})$/); // gemini-2.5-pro-preview-06-05
	if (m && !snapshot) {
		snapshot = m[2] + m[3];
		rest = rest.slice(0, (m.index ?? 0) + m[1].length + 1);
	}

	const names: string[] = [];
	const version: number[] = [];
	for (const token of rest.split(/[-_\s]+/).filter(Boolean)) {
		if (token === "latest") continue;
		if (token in CHANNEL) {
			channel = Math.min(channel, CHANNEL[token]);
			continue;
		}
		if (VERSION_TOKEN.test(token)) {
			pushVersion(version, token);
			continue;
		}
		if (SNAPSHOT_TOKEN.test(token)) {
			if (!snapshot) snapshot = token;
			continue;
		}
		const nv = token.match(NAME_VERSION_TOKEN); // qwen3, o3, k2, llama3.1
		if (nv) {
			names.push(nv[1]);
			pushVersion(version, nv[2]);
			continue;
		}
		names.push(token);
	}

	return { family: prefix + names.join("-") + variant, version, channel, snapshot };
}

export function compareVersions(a: number[], b: number[]): number {
	const length = Math.max(a.length, b.length);
	for (let i = 0; i < length; i++) {
		const diff = (a[i] ?? 0) - (b[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

/** Positive when `a` is newer than `b`. */
export function compareModelIds(a: string, b: string): number {
	const pa = parseModelId(a);
	const pb = parseModelId(b);
	return (
		compareVersions(pa.version, pb.version) ||
		pa.channel - pb.channel ||
		// An alias without a date tracks the newest snapshot, so it wins over dated IDs.
		Number(pa.snapshot === "") - Number(pb.snapshot === "") ||
		pa.snapshot.localeCompare(pb.snapshot) ||
		b.length - a.length ||
		b.localeCompare(a)
	);
}

export function familyKey(model: ModelRef): string {
	return `${model.provider}/${parseModelId(model.id).family}`;
}

export interface FamilyGroup<T extends ModelRef> {
	key: string;
	/** Newest first. */
	models: T[];
}

/** Groups models by provider and family, newest first. Group order follows first appearance. */
export function groupByFamily<T extends ModelRef>(models: readonly T[]): FamilyGroup<T>[] {
	const groups = new Map<string, T[]>();
	for (const model of models) {
		const key = familyKey(model);
		const list = groups.get(key);
		if (list) list.push(model);
		else groups.set(key, [model]);
	}
	return [...groups].map(([key, list]) => ({
		key,
		models: [...list].sort((a, b) => compareModelIds(b.id, a.id)),
	}));
}

export function modelKey(model: ModelRef): string {
	return `${model.provider}/${model.id}`;
}

/** Returns the keys (`provider/id`) of the newest `perFamily` models of each family. */
export function latestKeys(models: readonly ModelRef[], perFamily = 1): Set<string> {
	const keep = new Set<string>();
	const limit = Math.max(1, Math.floor(perFamily));
	for (const group of groupByFamily(models)) {
		for (const model of group.models.slice(0, limit)) keep.add(modelKey(model));
	}
	return keep;
}

/** Minimal glob: `*` matches any run of characters, `?` one character. Case-insensitive. */
export function globToRegExp(glob: string): RegExp {
	const source = glob
		.split("")
		.map((ch) => (ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[\\^$.+()|[\]{}]/g, "\\$&")))
		.join("");
	return new RegExp(`^${source}$`, "i");
}

export function matchesAny(model: ModelRef, patterns: readonly string[]): boolean {
	const key = modelKey(model);
	return patterns.some((pattern) => {
		const re = globToRegExp(pattern);
		return re.test(key) || (!pattern.includes("/") && re.test(model.id));
	});
}
