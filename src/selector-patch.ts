import { ModelSelectorComponent, type Theme } from "@earendil-works/pi-coding-agent";
import { type KeyId, matchesKey, Text } from "@earendil-works/pi-tui";
import type { Config } from "./config.ts";
import { latestKeys, matchesAny, type ModelRef, modelKey } from "./family.ts";
import { nextSortMode, SORT_LABELS, type SortMode, sortModels } from "./sort.ts";
import type { UsageMap } from "./usage.ts";

/*
 * pi runs its built-in /model command before extension commands, so the command itself cannot be
 * replaced. Instead this wraps a few methods of pi's exported ModelSelectorComponent (used by /model
 * and its shortcut). They are internal: if a pi release changes them, the patch is skipped and pi's
 * normal selector is used.
 *
 * Only the "all" list is collapsed and re-ordered. A "scoped" list (from enabledModels / --models) is
 * an explicit choice and is shown as configured.
 */

// Bump PATCH_VERSION when the patched methods change: /reload after an update then re-installs
// them on top of pi's original methods (kept under ORIGINALS) instead of wrapping the old patch.
const PATCH_VERSION = 2;
const PATCHED = Symbol.for("pi-latest-models.patched");
const ORIGINALS = Symbol.for("pi-latest-models.originals");
const HOOKS = Symbol.for("pi-latest-models.hooks");
const STATE = Symbol.for("pi-latest-models.state");
const REQUIRED = ["sortModels", "loadModelsFromSnapshot", "filterModels", "updateList", "handleInput"] as const;

export interface Hooks {
	config(): Config;
	theme(): Theme | undefined;
	usage(): UsageMap;
	/** Persists a new default order. */
	setSort(mode: SortMode): void;
}

type Item = ModelRef & { model: ModelRef };

interface InstanceState {
	showAll: boolean;
	/** Older models left out of the "all" list. */
	hidden: number;
	/** The uncollapsed "all" list, used for "show all" and search fallback. */
	full?: Item[];
	/** Search found nothing among the latest models and fell back to every version. */
	fallback: boolean;
}

interface Selector {
	[STATE]?: InstanceState;
	currentModel?: ModelRef;
	scope?: string;
	allModels: Item[];
	activeModels: Item[];
	filteredModels: Item[];
	selectedIndex: number;
	listContainer: { addChild(component: unknown): void };
	searchInput: { getValue(): string };
	tui?: { requestRender(): void };
	isDefaultModel?(model: ModelRef): boolean;
	loadModelsFromSnapshot(): void;
	filterModels(query: string, preferredModel?: ModelRef): void;
}

type Method = (this: Selector, ...args: any[]) => any;

// Patched methods outlive the module instance that installed them (/reload loads a fresh copy),
// so they read config and theme through globalThis. Refreshed on every session_start.
const holder = globalThis as { [HOOKS]?: Hooks };

export function setHooks(hooks: Hooks): void {
	holder[HOOKS] = hooks;
}

function config(): Config | undefined {
	try {
		return holder[HOOKS]?.config();
	} catch {
		return undefined;
	}
}

function usage(): UsageMap {
	try {
		return holder[HOOKS]?.usage() ?? new Map();
	} catch {
		return new Map();
	}
}

function paint(color: "dim" | "muted" | "warning", text: string): string {
	try {
		return holder[HOOKS]?.theme()?.fg(color, text) ?? text;
	} catch {
		return text;
	}
}

function state(self: Selector): InstanceState {
	self[STATE] ??= { showAll: false, hidden: 0, fallback: false };
	return self[STATE];
}

function same(a: ModelRef | undefined, b: ModelRef): boolean {
	return a?.provider === b.provider && a.id === b.id;
}

function keyMatches(data: string, key: string): boolean {
	try {
		return matchesKey(data, key as KeyId);
	} catch {
		return false;
	}
}

/** The visible subset of the "all" list: newest per family, plus current, default, and kept models. */
export function collapse<T extends Item>(
	items: readonly T[],
	cfg: Config,
	isPinned: (model: ModelRef) => boolean,
): T[] {
	const keep = latestKeys(items, cfg.perFamily);
	return items.filter(
		(item) => keep.has(modelKey(item)) || isPinned(item.model) || (cfg.keep.length > 0 && matchesAny(item, cfg.keep)),
	);
}

function rebuild(self: Selector): void {
	const preferred = self.filteredModels[self.selectedIndex]?.model;
	self.loadModelsFromSnapshot();
	self.filterModels(self.searchInput.getValue(), preferred);
	self.tui?.requestRender();
}

function hint(self: Selector, cfg: Config): string | undefined {
	const own = state(self);
	if (self.scope === "scoped") return undefined;
	const sort = `sort: ${SORT_LABELS[cfg.sort]} · ${cfg.sortKey} change`;
	if (own.fallback) {
		return paint("warning", `  No latest model matches; showing older versions · ${cfg.toggleKey} show all · ${sort}`);
	}
	const parts: string[] = [];
	if (own.showAll) parts.push(`Showing all versions · ${cfg.toggleKey} latest only`);
	else if (own.hidden > 0) parts.push(`${own.hidden} older ${own.hidden === 1 ? "version" : "versions"} hidden · ${cfg.toggleKey} show all`);
	parts.push(sort);
	return paint("dim", `  ${parts.join(" · ")}`);
}

function pinRank(self: Selector, model: ModelRef): number | undefined {
	if (same(self.currentModel, model)) return 0;
	if (self.isDefaultModel?.(model)) return 1;
	return undefined;
}

/** Returns false when this pi version's selector does not have the expected methods. */
export function patchModelSelector(): boolean {
	const proto = ModelSelectorComponent?.prototype as unknown as Record<string | symbol, unknown> | undefined;
	if (!proto) return false;
	if (proto[PATCHED] === PATCH_VERSION) return true;
	if (REQUIRED.some((name) => typeof proto[name] !== "function")) return false;
	type Originals = Record<(typeof REQUIRED)[number], Method>;
	proto[ORIGINALS] ??= Object.fromEntries(REQUIRED.map((name) => [name, proto[name] as Method]));
	const original = proto[ORIGINALS] as Originals;
	proto[PATCHED] = PATCH_VERSION;

	// Builds the "all" list: pi's order, then the configured order, then collapsed.
	proto.sortModels = function (this: Selector, models: Item[]) {
		let sorted: Item[] = original.sortModels.call(this, models);
		const own = state(this);
		const cfg = config();
		own.full = sorted;
		own.hidden = 0;
		if (!cfg) return sorted;
		try {
			sorted = sortModels(sorted, cfg.sort, usage(), (item) => pinRank(this, item.model));
			own.full = sorted;
			if (!cfg.enabled) return sorted;
			const visible = collapse(sorted, cfg, (m) => pinRank(this, m) !== undefined);
			own.hidden = sorted.length - visible.length;
			return own.showAll ? sorted : visible;
		} catch {
			return sorted;
		}
	};

	// Search: when nothing among the latest models matches, search every version instead.
	proto.filterModels = function (this: Selector, query: string, ...rest: unknown[]) {
		const own = state(this);
		own.fallback = false;
		const result = original.filterModels.call(this, query, ...rest);
		if (
			query &&
			this.filteredModels.length === 0 &&
			!own.showAll &&
			own.hidden > 0 &&
			own.full &&
			this.activeModels === this.allModels
		) {
			const active = this.activeModels;
			own.fallback = true;
			this.activeModels = own.full;
			try {
				original.filterModels.call(this, query, ...rest);
			} finally {
				this.activeModels = active;
			}
		}
		return result;
	};

	proto.updateList = function (this: Selector, ...args: unknown[]) {
		const result = original.updateList.apply(this, args);
		try {
			const cfg = config();
			const line = cfg ? hint(this, cfg) : undefined;
			if (line) this.listContainer.addChild(new Text(line, 0, 0));
		} catch {
			// Cosmetic only; never break pi's selector.
		}
		return result;
	};

	proto.handleInput = function (this: Selector, data: string) {
		const cfg = config();
		if (cfg?.enabled && keyMatches(data, cfg.toggleKey)) {
			const own = state(this);
			own.showAll = !own.showAll;
			rebuild(this);
			return;
		}
		if (cfg && this.scope !== "scoped" && keyMatches(data, cfg.sortKey)) {
			try {
				holder[HOOKS]?.setSort(nextSortMode(cfg.sort));
			} catch {
				// Could not save; keep the current order.
			}
			rebuild(this);
			return;
		}
		return original.handleInput.call(this, data);
	};

	return true;
}
