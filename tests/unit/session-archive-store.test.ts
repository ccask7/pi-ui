import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionArchiveStore } from "../../server/session-archive-store.js";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SessionArchiveStore", () => {
	it("persists archive state without changing the transcript", async () => {
		const root = await mkdtemp(join(tmpdir(), "ccui-archive-"));
		roots.push(root);
		const transcript = join(root, "project", "one.jsonl");
		await mkdir(join(root, "project"), { recursive: true });
		await writeFile(transcript, "transcript", "utf8");
		const store = new SessionArchiveStore(root);
		expect(store.has(transcript)).toBe(false);
		store.set(transcript, true);
		expect(store.has(transcript)).toBe(true);
		expect(store.paths()).toEqual(new Set([resolve(transcript)]));
		expect(await readFile(transcript, "utf8")).toBe("transcript");
		store.set(transcript, false);
		expect(store.has(transcript)).toBe(false);
	});

	it("ignores malformed metadata", async () => {
		const root = await mkdtemp(join(tmpdir(), "ccui-archive-"));
		roots.push(root);
		await writeFile(join(root, "ccui-archived-sessions.json"), "not json", "utf8");
		expect(new SessionArchiveStore(root).paths().size).toBe(0);
	});
});
