import assert from "node:assert/strict";
import { test } from "node:test";
import { compareModelIds, latestKeys, matchesAny, parseModelId } from "./family.ts";

const fam = (id: string) => parseModelId(id).family;

test("families ignore versions, dates, and release tags", () => {
	assert.equal(fam("claude-sonnet-4-5"), "claude-sonnet");
	assert.equal(fam("claude-3-5-sonnet-20241022"), "claude-sonnet");
	assert.equal(fam("claude-sonnet-4-5@20250929"), "claude-sonnet");
	assert.equal(fam("claude-3-5-sonnet-latest"), "claude-sonnet");
	assert.equal(fam("gpt-5.6-sol"), "gpt-sol");
	assert.equal(fam("gpt-6.1-sol"), "gpt-sol");
	assert.equal(fam("gpt-4o-2024-08-06"), "gpt-4o");
	assert.equal(fam("gemini-2.5-pro-preview-06-05"), "gemini-pro");
	assert.equal(fam("gemini-3-pro-preview"), "gemini-pro");
	assert.equal(fam("gemini-2.5-flash-lite"), "gemini-flash-lite");
	assert.equal(fam("qwen3-coder-480b-a35b"), "qwen-coder-480b-a35b");
	assert.equal(fam("deepseek-v3.1"), "deepseek");
	assert.equal(fam("mistral-large-2411"), "mistral-large");
	assert.equal(fam("anthropic/claude-sonnet-4.5"), "anthropic/claude-sonnet");
	assert.equal(fam("meta-llama/llama-3.3-70b-instruct:free"), "meta-llama/llama-70b-instruct:free");
	assert.equal(fam("o4-mini"), "o-mini");
});

test("versions and snapshots", () => {
	assert.deepEqual(parseModelId("claude-opus-4-1-20250805"), {
		family: "claude-opus",
		version: [4, 1],
		channel: 2,
		snapshot: "20250805",
	});
	assert.deepEqual(parseModelId("gemini-3.1-pro").version, [3, 1]);
	assert.equal(parseModelId("gemini-3-pro-preview").channel, 1);
});

test("newer versions win", () => {
	assert.ok(compareModelIds("gpt-6.1-sol", "gpt-5.6-sol") > 0);
	assert.ok(compareModelIds("claude-sonnet-4", "claude-3-7-sonnet") > 0);
	assert.ok(compareModelIds("claude-opus-4-1", "claude-opus-4") > 0);
	assert.ok(compareModelIds("claude-sonnet-5-5", "claude-sonnet-5") > 0);
	assert.ok(compareModelIds("gemini-3-pro-preview", "gemini-2.5-pro") > 0);
	assert.ok(compareModelIds("gemini-2.5-pro", "gemini-2.5-pro-preview-06-05") > 0, "stable beats preview");
	assert.ok(compareModelIds("claude-haiku-4-5", "claude-haiku-4-5-20251001") > 0, "alias beats dated");
	assert.ok(compareModelIds("mistral-large-2411", "mistral-large-2407") > 0);
	assert.ok(compareModelIds("mistral-large-latest", "mistral-large-2411") > 0);
});

test("latestKeys keeps one model per provider and family", () => {
	const models = [
		"claude-fable-5", "claude-fable-5-1", "claude-fable-5-2", "claude-haiku-4-5", "claude-haiku-4-5-20251001",
		"claude-haiku-5-5", "claude-opus-4-5", "claude-opus-4-5-20251101", "claude-opus-4-6", "claude-opus-4-7",
		"claude-opus-4-8", "claude-opus-5", "claude-opus-5-5", "claude-sonnet-4-5", "claude-sonnet-4-5-20250929",
		"claude-sonnet-4-6", "claude-sonnet-5", "claude-sonnet-5-5",
	]
		.map((id) => ({ provider: "anthropic", id }))
		.concat(
			["gemini-3.1-pro", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash", "gemini-4-argon", "gemini-4-hydrogen"].map(
				(id) => ({ provider: "antigravity-acp", id }),
			),
			["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-astra", "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol", "gpt-6.1-terra"].map(
				(id) => ({ provider: "openai-codex", id }),
			),
			[{ provider: "openrouter", id: "anthropic/claude-sonnet-4.5" }, { provider: "openrouter", id: "anthropic/claude-sonnet-5" }],
		);
	assert.deepEqual(
		[...latestKeys(models)].sort((a, b) => a.localeCompare(b)),
		[
			"anthropic/claude-fable-5-2",
			"anthropic/claude-haiku-5-5",
			"anthropic/claude-opus-5-5",
			"anthropic/claude-sonnet-5-5",
			"antigravity-acp/gemini-3.1-pro",
			"antigravity-acp/gemini-3.8-flash",
			"antigravity-acp/gemini-4-argon",
			"antigravity-acp/gemini-4-hydrogen",
			"openai-codex/gpt-6-astra",
			"openai-codex/gpt-6-luna",
			"openai-codex/gpt-6.1-sol",
			"openai-codex/gpt-6.1-terra",
			"openrouter/anthropic/claude-sonnet-5",
		],
	);
	assert.equal(latestKeys(models, 2).size, 22);
});

test("keep patterns", () => {
	const model = { provider: "openai-codex", id: "gpt-5.6-sol" };
	assert.ok(matchesAny(model, ["openai-codex/gpt-5.6-sol"]));
	assert.ok(matchesAny(model, ["gpt-5.*"]));
	assert.ok(matchesAny(model, ["openai-codex/*"]));
	assert.ok(!matchesAny(model, ["anthropic/*"]));
	assert.ok(!matchesAny(model, ["gpt-6*"]));
});
