/**
 * 真机接线：把仓库里的 `plugins/memory` 原样拷进临时数据目录，用真的 PluginManager 激活。
 * 锁的是「装上就能用」这件事——manifest 解析、权限族、工具注册、两个 UI 槽位（左栏导航 +
 * 隐藏的顶栏视图条目）、以及不带 sdk 拷贝也能跑（本插件只用纯 ESM）。
 */
import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PluginManager } from "../../server/plugins.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("memory 插件真机激活", () => {
	it("激活成功：4 个工具 + 左栏「记忆」入口 + 隐藏的顶栏视图条目", async () => {
		const dir = mkdtempSync(join(tmpdir(), "memory-plugin-"));
		cpSync(join(repoRoot, "plugins", "memory"), join(dir, "plugins", "memory"), { recursive: true });
		const mgr = new PluginManager(dir, dir);
		try {
			const [info] = await mgr.ensureLoaded(() => "zh");
			expect(info?.id).toBe("memory");
			expect(info?.error, `激活错误：${info?.error ?? ""}`).toBeUndefined();
			expect(info?.active).toBe(true);
			expect((info?.agentTools ?? []).map((t) => t.name).sort()).toEqual([
				"memory_forget",
				"memory_search",
				"memory_update",
				"memory_write",
			]);
			const items = info?.ui?.items ?? [];
			// 左栏「记忆」：只换对话区（slot main.panel，不是 view）
			const nav = items.find((i) => i.slot === "main.panel");
			expect(nav?.label).toBe("记忆");
			expect(nav?.kind).toBe("action");
			// 无颜色图标：线条 + currentColor（不吃 emoji 的彩色）
			expect(nav?.iconSvg).toContain('stroke="currentColor"');
			expect(nav?.iconSvg).toContain('fill="none"');
			// 不声明 __view：顶栏不会多出第二个入口（宿主合成的默认就是隐藏）
			expect(items.some((i) => i.id === "__view")).toBe(false);
			// 设置项：index.mjs 读 injectHint / autoRemember，manifest 必须两者都声明，否则面板里改不到
			expect((info?.settingsSchema ?? []).map((s) => s.key)).toEqual(["injectHint", "autoRemember"]);
			// 工具能真跑（写一条 → 查得到）
			const write = mgr.getAgentTools().find((t) => t.name === "memory_write");
			const search = mgr.getAgentTools().find((t) => t.name === "memory_search");
			const text = await write?.execute("c1", { type: "fact", content: "这个仓库用 pnpm 而不是 npm" });
			expect(String(text)).toContain("已记住");
			const found = await search?.execute("c2", { query: "pnpm" });
			expect(String(found)).toContain("pnpm");
		} finally {
			mgr.dispose();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
