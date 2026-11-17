import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { type Config, configPath, getConfig, loadConfig, saveConfig, usageCachePath } from "./config.ts";
import { groupByFamily, type ModelRef } from "./family.ts";
import { patchModelSelector, setHooks } from "./selector-patch.ts";
import { isSortMode, SORT_LABELS, SORT_MODES } from "./sort.ts";
import { UsageTracker } from "./usage.ts";

/**
 * pi-latest-models: the /model list shows only the newest model of each family
 * ("claude-sonnet", "gpt-sol", "gemini-flash", ...) per provider, sorted by usage or name.
 */
export default function (pi: ExtensionAPI) {
	let listModels: () => ModelRef[] = () => [];
	let tracker: UsageTracker | undefined;
	const usage = () => (tracker ??= new UsageTracker(usageCachePath()));

	pi.on("session_start", (_event, ctx) => {
		const { error } = loadConfig(true);
		setHooks({
			config: getConfig,
			theme: () => ctx.ui.theme,
			usage: () => usage().snapshot(),
			setSort: (sort) => saveConfig((c) => ({ ...c, sort })),
		});
		if (!patchModelSelector()) {
			ctx.ui.notify("pi-latest-models: this pi version is not supported; /model lists every model.", "warning");
		}
		if (error) ctx.ui.notify(`pi-latest-models: ${error}`, "warning");
		listModels = () => ctx.modelRegistry.getAvailable();
		// Count usage from saved sessions in the background; cached per file.
		const roots = [join(getAgentDir(), "sessions"), ctx.sessionManager.getSessionDir()];
		usage()
			.scan(roots)
			.catch(() => {});
	});

	pi.on("message_end", (event) => {
		const message = event.message;
		if (message.role !== "assistant") return;
		if (message.stopReason === "error" || message.stopReason === "aborted") return;
		usage().record(message.provider, message.model, message.timestamp);
	});

	const subcommands = ["status", "sort", "on", "off", "per-family", "keep", "unkeep"];

	pi.registerCommand("latest-models", {
		description: "Show or change how /model lists models (newest per family, sort order)",
		getArgumentCompletions: (prefix) => {
			const [sub, arg] = prefix.trimStart().split(/\s+/);
			const options = arg !== undefined && sub === "sort" ? SORT_MODES.map((m) => `sort ${m}`) : subcommands;
			const items = options.filter((s) => s.startsWith(prefix.trim())).map((s) => ({ value: s, label: s }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const [sub = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const value = rest.join(" ");
			const done = (cfg: Config, message: string) => ctx.ui.notify(`${message}\n${describe(cfg)}`, "info");
			switch (sub) {
				case "status":
					ctx.ui.notify(status(getConfig(), listModels(), usage().snapshot()), "info");
					return;
				case "sort":
					if (!isSortMode(value)) return showHelp(ctx);
					done(saveConfig((c) => ({ ...c, sort: value })), `/model is sorted by ${SORT_LABELS[value]}.`);
					return;
				case "on":
				case "off":
					done(saveConfig((c) => ({ ...c, enabled: sub === "on" })), `Latest-only /model list ${sub}.`);
					return;
				case "per-family": {
					const n = Number(value);
					if (!Number.isInteger(n) || n < 1) return showHelp(ctx);
					done(saveConfig((c) => ({ ...c, perFamily: n })), `Showing ${n} per family.`);
					return;
				}
				case "keep":
					if (!value) return showHelp(ctx);
					done(saveConfig((c) => ({ ...c, keep: [...new Set([...c.keep, value])] })), `Always listing ${value}.`);
					return;
				case "unkeep":
					if (!value) return showHelp(ctx);
					done(saveConfig((c) => ({ ...c, keep: c.keep.filter((p) => p !== value) })), `Removed ${value}.`);
					return;
				default:
					showHelp(ctx);
			}
		},
	});
}

function showHelp(ctx: ExtensionContext): void {
	ctx.ui.notify(
		"Usage: /latest-models [status | sort <usage|name|pi> | on | off | per-family <n> | keep <provider/id or glob> | unkeep <pattern>]",
		"warning",
	);
}

function describe(cfg: Config): string {
	const keep = cfg.keep.length > 0 ? cfg.keep.join(", ") : "none";
	return [
		`latest only: ${cfg.enabled ? "on" : "off"} · per family: ${cfg.perFamily} · always listed: ${keep}`,
		`sort: ${cfg.sort} (${SORT_LABELS[cfg.sort]}) · keys in /model: ${cfg.toggleKey} all versions, ${cfg.sortKey} sort`,
		`config: ${configPath()}`,
	].join("\n");
}

function status(cfg: Config, models: readonly ModelRef[], used: Map<string, { count: number }>): string {
	const lines = [describe(cfg)];
	const top = [...used].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
	if (top.length > 0) lines.push(`Most used: ${top.map(([key, s]) => `${key} (${s.count})`).join(", ")}`);
	const groups = groupByFamily(models).filter((g) => g.models.length > cfg.perFamily);
	if (groups.length === 0) {
		lines.push("No family has older versions to hide.");
	} else {
		lines.push("Families with hidden versions (current and default models stay listed):");
		for (const group of groups) {
			const shown = group.models.slice(0, cfg.perFamily).map((m) => m.id);
			lines.push(`  ${group.key}: ${shown.join(", ")} (hides ${group.models.length - shown.length})`);
		}
	}
	return lines.join("\n");
}
