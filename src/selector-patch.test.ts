import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme, ModelSelectorComponent } from "@earendil-works/pi-coding-agent";
import { type Config, DEFAULT_CONFIG } from "./config.ts";
import { patchModelSelector, setHooks } from "./selector-patch.ts";
import type { UsageMap } from "./usage.ts";

initTheme("dark");
let cfg: Config = { ...DEFAULT_CONFIG };
let usage: UsageMap = new Map();
setHooks({
	config: () => cfg,
	theme: () => undefined,
	usage: () => usage,
	setSort: (sort) => {
		cfg = { ...cfg, sort };
	},
});
assert.ok(patchModelSelector(), "patch applies to this pi version");

const ids: Record<string, string[]> = {
	anthropic: ["claude-sonnet-4-5", "claude-sonnet-4-5-20250929", "claude-sonnet-5", "claude-sonnet-5-5", "claude-opus-4-8", "claude-opus-5-5"],
	"openai-codex": ["gpt-5.6-sol", "gpt-6-sol", "gpt-6.1-sol", "gpt-6-luna"],
};
const models = Object.entries(ids).flatMap(([provider, list]) => list.map((id) => ({ provider, id, name: id })));
const find = (provider: string, id: string) => models.find((m) => m.provider === provider && m.id === id);
const runtime = {
	getAvailableSnapshot: () => models,
	getModel: find,
	refresh: async () => {},
	getError: () => undefined,
};
const tui = { requestRender() {} };

function open(current = find("anthropic", "claude-opus-5-5"), scoped: Array<{ model: unknown }> = []) {
	const Selector = ModelSelectorComponent as unknown as new (...args: unknown[]) => any;
	return new Selector(tui, current, runtime, scoped, () => {}, () => {}, undefined, () => {}, find("openai-codex", "gpt-5.6-sol"));
}
const order = (sel: any) => sel.filteredModels.map((m: { id: string }) => m.id);
const listed = (sel: any) => sel.filteredModels.map((m: { provider: string; id: string }) => `${m.provider}/${m.id}`).sort();
const text = (sel: any) => sel.render(160).join("\n");

test("lists only the newest model per family, plus current and default", () => {
	const sel = open();
	assert.deepEqual(listed(sel), [
		"anthropic/claude-opus-5-5",
		"anthropic/claude-sonnet-5-5",
		"openai-codex/gpt-5.6-sol",
		"openai-codex/gpt-6-luna",
		"openai-codex/gpt-6.1-sol",
	]);
	assert.match(text(sel), /5 older versions hidden · alt\+v show all/);
	sel.dispose();
});

test("toggle key shows every version and back", () => {
	const sel = open();
	sel.handleInput("\x1bv");
	assert.equal(sel.filteredModels.length, models.length);
	assert.match(text(sel), /Showing all versions/);
	sel.handleInput("\x1bv");
	assert.equal(sel.filteredModels.length, 5);
	sel.dispose();
});

test("search falls back to older versions when no latest model matches", () => {
	const sel = open();
	for (const ch of "sonnet-4-5") sel.handleInput(ch);
	assert.ok(listed(sel).includes("anthropic/claude-sonnet-4-5"));
	assert.match(text(sel), /No latest model matches/);
	sel.dispose();
});

test("search among latest models does not fall back", () => {
	const sel = open();
	for (const ch of "sonnet") sel.handleInput(ch);
	assert.deepEqual(listed(sel), ["anthropic/claude-sonnet-5-5"]);
	sel.dispose();
});

test("disabled config and per-family", () => {
	cfg = { ...DEFAULT_CONFIG, enabled: false };
	let sel = open();
	assert.equal(sel.filteredModels.length, models.length);
	sel.dispose();
	cfg = { ...DEFAULT_CONFIG, perFamily: 2, keep: ["anthropic/claude-sonnet-4-5"] };
	sel = open();
	assert.ok(listed(sel).includes("anthropic/claude-sonnet-4-5"));
	assert.ok(listed(sel).includes("openai-codex/gpt-6-sol"));
	sel.dispose();
	cfg = { ...DEFAULT_CONFIG };
});

test("sort by name keeps current and default on top", () => {
	cfg = { ...DEFAULT_CONFIG, sort: "name" };
	const sel = open();
	assert.deepEqual(order(sel), ["claude-opus-5-5", "gpt-5.6-sol", "claude-sonnet-5-5", "gpt-6-luna", "gpt-6.1-sol"]);
	assert.match(text(sel), /sort: name · alt\+s change/);
	sel.dispose();
	cfg = { ...DEFAULT_CONFIG };
});

test("sort by usage ranks families by their total use", () => {
	cfg = { ...DEFAULT_CONFIG, sort: "usage" };
	usage = new Map([
		["openai-codex/gpt-6-luna", { count: 3, last: 1 }],
		["anthropic/claude-sonnet-4-5", { count: 10, last: 2 }], // older version: counts for the family
	]);
	const sel = open();
	assert.deepEqual(order(sel), ["claude-opus-5-5", "gpt-5.6-sol", "claude-sonnet-5-5", "gpt-6-luna", "gpt-6.1-sol"]);
	assert.match(text(sel), /sort: most used/);
	sel.dispose();
	usage = new Map();
});

test("sort key cycles usage → name → pi and saves the choice", () => {
	cfg = { ...DEFAULT_CONFIG, sort: "usage" };
	const sel = open();
	sel.handleInput("\x1bs");
	assert.equal(cfg.sort, "name");
	assert.match(text(sel), /sort: name/);
	sel.handleInput("\x1bs");
	assert.equal(cfg.sort, "pi");
	assert.deepEqual(order(sel).slice(0, 2), ["claude-opus-5-5", "gpt-5.6-sol"]);
	sel.handleInput("\x1bs");
	assert.equal(cfg.sort, "usage");
	sel.dispose();
	cfg = { ...DEFAULT_CONFIG };
});

test("scoped list is left alone", () => {
	const scoped = [{ model: find("anthropic", "claude-sonnet-4-5") }, { model: find("anthropic", "claude-sonnet-5-5") }];
	const sel = open(find("anthropic", "claude-sonnet-5-5"), scoped);
	assert.deepEqual(listed(sel), ["anthropic/claude-sonnet-4-5", "anthropic/claude-sonnet-5-5"]);
	assert.doesNotMatch(text(sel), /older versions? hidden/);
	sel.dispose();
});
