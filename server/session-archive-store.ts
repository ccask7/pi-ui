import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** UI-only archive metadata. Transcript files and their pi session records stay untouched. */
export class SessionArchiveStore {
	private readonly file: string;

	constructor(sessionsRoot: string) {
		this.file = join(sessionsRoot, "ccui-archived-sessions.json");
	}

	private read(): Record<string, number> {
		try {
			const raw: unknown = JSON.parse(readFileSync(this.file, "utf8"));
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
			return Object.fromEntries(
				Object.entries(raw).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
			);
		} catch {
			return {};
		}
	}

	private write(records: Record<string, number>): void {
		mkdirSync(dirname(this.file), { recursive: true });
		const temp = `${this.file}.${process.pid}.tmp`;
		writeFileSync(temp, `${JSON.stringify(records, null, 2)}\n`, "utf8");
		renameSync(temp, this.file);
	}

	has(path: string): boolean {
		return this.read()[resolve(path)] !== undefined;
	}

	paths(): Set<string> {
		return new Set(Object.keys(this.read()).map((path) => resolve(path)));
	}

	set(path: string, archived: boolean): void {
		const key = resolve(path);
		const records = this.read();
		if (archived) records[key] = Date.now();
		else delete records[key];
		if (Object.keys(records).length === 0) {
			rmSync(this.file, { force: true });
			return;
		}
		this.write(records);
	}
}
