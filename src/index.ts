import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Config, configPath, getConfig, loadConfig, saveConfig } from "./config.ts";
import { groupByFamily, type ModelRef } from "./family.ts";
import { patchModelSelector, setHooks } from "./selector-patch.ts";

/**
 * pi-latest-models: the /model list shows only the newest model of each family
 * ("claude-sonnet", "gpt-sol", "gemini-flash", ...) per provider.
 */
export default function (pi: ExtensionAPI) {
	let listModels: () => ModelRef[] = () => [];

	pi.on("session_start", (_event, ctx) => {
		const { error } = loadConfig(true);
		setHooks({ config: getConfig, theme: () => ctx.ui.theme });
		if (!patchModelSelector()) {
			ctx.ui.notify("pi-latest-models: this pi version is not supported; /model lists every model.", "warning");
		}
		if (error) ctx.ui.notify(`pi-latest-models: ${error}`, "warning");
		listModels = () => ctx.modelRegistry.getAvailable();
	});

	const subcommands = ["status", "on", "off", "per-family", "keep", "unkeep"];

	pi.registerCommand("latest-models", {
		description: "Show or change which models /model lists (newest per family)",
		getArgumentCompletions: (prefix) => {
			const items = subcommands.filter((s) => s.startsWith(prefix.trim())).map((s) => ({ value: s, label: s }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const [sub = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const value = rest.join(" ");
			const done = (cfg: Config, message: string) => ctx.ui.notify(`${message}\n${describe(cfg)}`, "info");
			switch (sub) {
				case "status":
					ctx.ui.notify(status(getConfig(), listModels()), "info");
					return;
				case "on":
				case "off":
					done(saveConfig((c) => ({ ...c, enabled: sub === "on" })), `Latest-only /model list ${sub}.`);
					return;
				case "per-family": {
					const n = Number(value);
					if (!Number.isInteger(n) || n < 1) return usage(ctx);
					done(saveConfig((c) => ({ ...c, perFamily: n })), `Showing ${n} per family.`);
					return;
				}
				case "keep":
					if (!value) return usage(ctx);
					done(saveConfig((c) => ({ ...c, keep: [...new Set([...c.keep, value])] })), `Always listing ${value}.`);
					return;
				case "unkeep":
					if (!value) return usage(ctx);
					done(saveConfig((c) => ({ ...c, keep: c.keep.filter((p) => p !== value) })), `Removed ${value}.`);
					return;
				default:
					usage(ctx);
			}
		},
	});
}

function usage(ctx: ExtensionContext): void {
	ctx.ui.notify(
		"Usage: /latest-models [status | on | off | per-family <n> | keep <provider/id or glob> | unkeep <pattern>]",
		"warning",
	);
}

function describe(cfg: Config): string {
	const keep = cfg.keep.length > 0 ? cfg.keep.join(", ") : "none";
	return `enabled: ${cfg.enabled} · per family: ${cfg.perFamily} · always listed: ${keep} · toggle in /model: ${cfg.toggleKey}\nconfig: ${configPath()}`;
}

function status(cfg: Config, models: readonly ModelRef[]): string {
	const lines = [describe(cfg)];
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
