/**
 * server/locales.ts 单测：pack 校验、本地安装（手工放文件）、删除。
 * 磁盘隔离：mkdtempSync 临时 data-dir；端口：无（纯函数 + stub 网络）。
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	isKnownPack,
	listPacks,
	loadServerStrings,
	packPath,
	readPackFile,
	removePack,
	unloadServerStrings,
	validatePack,
} from "../../server/locales.js";
import { getServerString } from "../../server/i18n.js";

const PACK = {
	code: "ja",
	nativeName: "日本語",
	version: "0.68.1",
	strings: { cancel: "キャンセル", ok: "OK" },
};

describe("locales", () => {
	it("isKnownPack 只认 manifest 里的 8 个包", () => {
		expect(isKnownPack("ja")).toBe(true);
		expect(isKnownPack("it")).toBe(true);
		expect(isKnownPack("zh")).toBe(false);
		expect(isKnownPack("en")).toBe(false);
		expect(isKnownPack("../evil")).toBe(false);
		expect(isKnownPack("")).toBe(false);
	});

	it("validatePack 拒绝坏包", () => {
		expect(validatePack(null, "ja").ok).toBe(false);
		expect(validatePack({}, "ja").ok).toBe(false);
		expect(validatePack({ ...PACK, code: "ko" }, "ja").ok).toBe(false);
		expect(validatePack({ ...PACK, strings: { a: 1 } }, "ja").ok).toBe(false);
		expect(validatePack({ ...PACK, strings: {} }, "ja").ok).toBe(false);
		const good = validatePack(PACK, "ja");
		expect(good.ok).toBe(true);
		if (good.ok) expect(good.pack.version).toBe("0.68.1");
	});

	it("validatePack 透传 serverStrings；坏表拒绝", () => {
		const withTable = validatePack({ ...PACK, serverStrings: { "a.b": "エー", empty: "" } }, "ja");
		expect(withTable.ok).toBe(true);
		if (withTable.ok) expect(withTable.pack.serverStrings).toEqual({ "a.b": "エー" });
		expect(validatePack({ ...PACK, serverStrings: { "a.b": 1 } }, "ja").ok).toBe(false);
		expect(validatePack({ ...PACK, serverStrings: [] }, "ja").ok).toBe(false);
		// 无 serverStrings 的老包照常通过
		expect(validatePack(PACK, "ja").ok).toBe(true);
	});

	it("loadServerStrings 注册 dataDir 包表；unload 摘除（落盘隔离）", () => {
		const dir = mkdtempSync(join(tmpdir(), "piweb-srvstr-"));
		try {
			mkdirSync(dirname(packPath(dir, "ja")), { recursive: true });
			writeFileSync(
				packPath(dir, "ja"),
				JSON.stringify({
					code: "ja",
					nativeName: "日本語",
					version: "x",
					strings: { ok: "OK" },
					serverStrings: { "k.1": "あ" },
				}),
			);
			writeFileSync(packPath(dir, "pt"), JSON.stringify({ code: "pt", strings: { ok: "OK" } }));
			writeFileSync(packPath(dir, "de"), "{broken");
			expect(loadServerStrings(dir)).toEqual(["ja"]);
			expect(getServerString("ja", "k.1")).toBe("あ");
			unloadServerStrings("ja");
			expect(getServerString("ja", "k.1")).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("手工放入 pack 文件 → list/read → remove 全链路（落盘隔离）", async () => {
		const dir = mkdtempSync(join(tmpdir(), "piweb-locales-"));
		try {
			expect(listPacks(dir).find((p) => p.code === "ja")).toMatchObject({ installed: false });
			mkdirSync(join(dir, "locales"), { recursive: true });
			writeFileSync(packPath(dir, "ja"), JSON.stringify(PACK));
			expect(listPacks(dir).find((p) => p.code === "ja")).toMatchObject({ installed: true, version: "0.68.1" });
			expect(readPackFile(dir, "ja")).toMatchObject({ code: "ja" });
			expect(removePack(dir, "ja")).toBe(true);
			expect(removePack(dir, "ja")).toBe(false);
			expect(readPackFile(dir, "ja")).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("坏文件不炸 list（readPackFile 返回 null）", () => {
		const dir = mkdtempSync(join(tmpdir(), "piweb-locales-"));
		try {
			mkdirSync(dirname(packPath(dir, "ja")), { recursive: true });
			writeFileSync(packPath(dir, "ja"), "{broken");
			expect(readPackFile(dir, "ja")).toBeNull();
			expect(listPacks(dir).find((p) => p.code === "ja")).toMatchObject({ installed: false });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
