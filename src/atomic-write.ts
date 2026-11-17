import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Writes `text` to a temp file next to `path`, then renames it over `path`. */
export function writeFileAtomic(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, text, "utf-8");
	renameSync(tmp, path);
}
