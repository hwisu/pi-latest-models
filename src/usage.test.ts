import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { familyUsage, sortModels } from "./sort.ts";
import { countSessionText, UsageTracker } from "./usage.ts";

const assistant = (provider: string, model: string, stopReason = "stop", timestamp = 1000) =>
	JSON.stringify({
		type: "message",
		timestamp: "2026-01-01T00:00:00.000Z",
		message: { role: "assistant", content: [{ type: "text", text: '"provider":"fake"' }], provider, model, stopReason, timestamp },
	});
const user = JSON.stringify({ type: "message", message: { role: "user", content: "assistant" } });

test("countSessionText counts finished assistant responses", () => {
	const text = [
		JSON.stringify({ type: "session" }),
		user,
		assistant("anthropic", "claude-sonnet-5-5", "toolUse", 5),
		assistant("anthropic", "claude-sonnet-5-5", "stop", 9),
		assistant("anthropic", "claude-sonnet-5-5", "error", 20),
		assistant("openai-codex", "gpt-6.1-sol", "aborted"),
		"not json",
	].join("\n");
	assert.deepEqual(countSessionText(text), { "anthropic/claude-sonnet-5-5": [2, 9] });
});

test("UsageTracker scans session folders, caches files, and adds live responses", async () => {
	const dir = mkdtempSync(join(tmpdir(), "latest-models-"));
	try {
		const sessions = join(dir, "sessions");
		mkdirSync(join(sessions, "--project--"), { recursive: true });
		const file = join(sessions, "--project--", "a.jsonl");
		writeFileSync(file, `${assistant("anthropic", "claude-opus-5-5")}\n`);
		writeFileSync(join(sessions, "b.jsonl"), `${assistant("openai-codex", "gpt-6.1-sol")}\n`);
		const cache = join(dir, "cache", "usage.json");

		const tracker = new UsageTracker(cache);
		await tracker.scan([sessions, sessions]);
		assert.equal(tracker.snapshot().get("anthropic/claude-opus-5-5")?.count, 1);
		assert.equal(tracker.snapshot().get("openai-codex/gpt-6.1-sol")?.count, 1);

		tracker.record("anthropic", "claude-opus-5-5", 2000);
		assert.equal(tracker.snapshot().get("anthropic/claude-opus-5-5")?.count, 2);

		// The live response is written to disk; the next scan reads it instead of counting it twice.
		appendFileSync(file, `${assistant("anthropic", "claude-opus-5-5", "stop", 2000)}\n`);
		await tracker.scan([sessions]);
		assert.equal(tracker.snapshot().get("anthropic/claude-opus-5-5")?.count, 2);

		// A new tracker starts from the cache before scanning.
		const fresh = new UsageTracker(cache);
		assert.equal(fresh.snapshot().get("anthropic/claude-opus-5-5")?.count, 2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("familyUsage and sortModels", () => {
	const usage = new Map([
		["anthropic/claude-sonnet-4-5", { count: 4, last: 1 }],
		["anthropic/claude-sonnet-5-5", { count: 1, last: 2 }],
		["openai-codex/gpt-6.1-sol", { count: 3, last: 3 }],
	]);
	assert.deepEqual(
		[...familyUsage(usage)],
		[
			["anthropic/claude-sonnet", 5],
			["openai-codex/gpt-sol", 3],
		],
	);
	const items = [
		{ provider: "openai-codex", id: "gpt-6.1-sol" },
		{ provider: "anthropic", id: "claude-opus-5-5" },
		{ provider: "anthropic", id: "claude-sonnet-5-5" },
		{ provider: "anthropic", id: "claude-haiku-5-5" },
	];
	const none = () => undefined;
	assert.deepEqual(
		sortModels(items, "usage", usage, none).map((m) => m.id),
		["claude-sonnet-5-5", "gpt-6.1-sol", "claude-haiku-5-5", "claude-opus-5-5"],
	);
	assert.deepEqual(
		sortModels(items, "name", usage, none).map((m) => m.id),
		["claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5", "gpt-6.1-sol"],
	);
	assert.deepEqual(sortModels(items, "pi", usage, none), items);
	assert.deepEqual(
		sortModels(items, "name", usage, (m) => (m.id === "gpt-6.1-sol" ? 0 : undefined)).map((m) => m.id)[0],
		"gpt-6.1-sol",
	);
	// Natural number order: 5-10 after 5-9.
	assert.deepEqual(
		sortModels(
			[
				{ provider: "x", id: "m-5-10" },
				{ provider: "x", id: "m-5-9" },
			],
			"name",
			usage,
			none,
		).map((m) => m.id),
		["m-5-9", "m-5-10"],
	);
});
