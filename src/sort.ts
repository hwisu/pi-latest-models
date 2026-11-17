import { compareModelIds, type ModelRef, parseModelId } from "./family.ts";
import { type UsageMap, usageKey } from "./usage.ts";

export const SORT_MODES = ["usage", "name", "pi"] as const;
export type SortMode = (typeof SORT_MODES)[number];

export const SORT_LABELS: Record<SortMode, string> = {
	usage: "most used",
	name: "name",
	pi: "pi default",
};

export function isSortMode(value: unknown): value is SortMode {
	return typeof value === "string" && (SORT_MODES as readonly string[]).includes(value);
}

export function nextSortMode(mode: SortMode): SortMode {
	return SORT_MODES[(SORT_MODES.indexOf(mode) + 1) % SORT_MODES.length];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function compareByName(a: ModelRef, b: ModelRef): number {
	return collator.compare(a.id, b.id) || collator.compare(a.provider, b.provider);
}

/**
 * Usage of each provider/family: versions of a family share one count, so the newest version
 * inherits the rank its predecessors earned.
 */
export function familyUsage(usage: UsageMap): Map<string, number> {
	const totals = new Map<string, number>();
	for (const [key, stat] of usage) {
		const slash = key.indexOf("/");
		if (slash < 0) continue;
		const family = `${key.slice(0, slash)}/${parseModelId(key.slice(slash + 1)).family}`;
		totals.set(family, (totals.get(family) ?? 0) + stat.count);
	}
	return totals;
}

/**
 * Orders the "all" list. `pinRank` returns 0 for the current model and 1 for the default model;
 * pinned models stay on top in every mode, as in pi. Mode "pi" keeps the order pi produced.
 */
export function sortModels<T extends ModelRef>(
	items: readonly T[],
	mode: SortMode,
	usage: UsageMap,
	pinRank: (model: T) => number | undefined,
): T[] {
	if (mode === "pi") return [...items];
	const families = mode === "usage" ? familyUsage(usage) : undefined;
	const info = new Map(
		items.map((item) => {
			const family = parseModelId(item.id).family;
			const stat = usage.get(usageKey(item.provider, item.id));
			return [
				item,
				{
					pin: pinRank(item) ?? Number.POSITIVE_INFINITY,
					family,
					familyCount: families?.get(`${item.provider}/${family}`) ?? 0,
					count: stat?.count ?? 0,
					last: stat?.last ?? 0,
				},
			] as const;
		}),
	);
	return [...items].sort((a, b) => {
		const x = info.get(a)!;
		const y = info.get(b)!;
		if (x.pin !== y.pin) return x.pin - y.pin;
		if (mode === "name") return compareByName(a, b);
		return (
			y.familyCount - x.familyCount ||
			collator.compare(x.family, y.family) ||
			collator.compare(a.provider, b.provider) ||
			y.count - x.count ||
			y.last - x.last ||
			compareModelIds(b.id, a.id)
		);
	});
}
