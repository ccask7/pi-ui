// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { CapabilitiesPanel } from "../../web/src/components/CapabilitiesPanel.js";
import { LanguageProvider } from "../../web/src/i18n.js";
import type { UiSettingsState } from "../../web/src/types.js";

let root: Root | null = null;
afterEach(() => {
	if (root) act(() => root!.unmount());
	root = null;
	document.body.innerHTML = "";
	vi.unstubAllGlobals();
});

function mount() {
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => (key === "ccui:lang" ? "zh" : null),
		setItem: () => {},
	} as unknown as Storage);
	const container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	const send = vi.fn(() => true);
	const settings = {
		skills: [{ name: "review", description: "Review code", enabled: true }],
		disabledSkills: [],
		skillsFullText: [],
		extensions: [{ id: "npm:demo", name: "Demo Extension", path: "/tmp/demo", enabled: true }],
		disabledExtensions: [],
	} as unknown as UiSettingsState;
	const servers = [
		{ name: "echo", status: "running" as const, tools: [{ name: "ping", description: "Ping tool" }] },
		{ name: "broken", status: "error" as const, error: "spawn failed", tools: [] },
	];
	act(() => {
		root!.render(
			createElement(
				LanguageProvider,
				null,
				createElement(CapabilitiesPanel, {
					settings,
					agentPresets: null,
					mcpServers: servers,
					mcpConfigPath: "/tmp/mcp.json",
					plugins: [
						{
							id: "demo-ui",
							name: "Demo UI Plugin",
							description: "A short plugin summary",
							view: true,
							agentTools: [],
						},
					] as never,
					pluginGrants: [
						{ pluginId: "demo-ui", paths: ["/tmp/shared"] },
						{ pluginId: "gone-ui", paths: ["/tmp/orphan"] },
					],
					pluginPermissions: [
						{ pluginId: "demo-ui", family: "net", hosts: ["api.example.com"] },
						{ pluginId: "demo-ui", family: "llm", models: ["gpt-demo"] },
						{ pluginId: "gone-ui", family: "net", hosts: ["old.example.com"] },
					],
					onOpenPluginView: vi.fn(),
					onOpenTools: vi.fn(),
					send,
				}),
			),
		);
	});
	return { container, send };
}

describe("插件 / 技能 / MCP 面板", () => {
	it("默认展示技能，复用技能开关并请求 MCP 目录", () => {
		const { container, send } = mount();
		expect(container.querySelector('[role="tab"]')?.textContent).toContain("技能");
		expect(container.textContent).toContain("review");
		expect(send).toHaveBeenCalledWith({ type: "list_mcp_servers" });
		const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]');
		act(() => toggle!.click());
		expect(send).toHaveBeenCalledWith({ type: "set_settings", disabledSkills: ["review"] });
	});

	it("插件页签合并扩展包和界面插件；列表行只有简介与开关，详情收进弹窗", () => {
		const { container, send } = mount();
		const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
		expect(tabs).toHaveLength(3);
		act(() => tabs[1].click());
		expect(container.textContent).toContain("扩展包");
		expect(container.textContent).toContain("界面插件");
		expect(container.textContent).toContain("Demo Extension");
		expect(container.textContent).toContain("Demo UI Plugin");
		expect(container.textContent).toContain("A short plugin summary");
		const extensionToggle = container.querySelector<HTMLButtonElement>('.capabilities-extension-group [role="switch"]');
		act(() => extensionToggle!.click());
		expect(send).toHaveBeenCalledWith({ type: "set_settings", disabledExtensions: ["npm:demo"] });

		// 行内开关：点了不打开弹窗
		const row = container.querySelector<HTMLElement>(".plugin-row")!;
		const uiToggle = row.querySelector<HTMLButtonElement>('[role="switch"]')!;
		act(() => uiToggle.click());
		expect(send).toHaveBeenCalledWith({ type: "set_settings", disabledPlugins: ["demo-ui"] });
		expect(document.body.querySelector(".plugin-detail")).toBeNull();

		// 列表里不再常驻授权区块（遗留授权区是另一回事，见下一条用例）
		expect(container.querySelector(".set-list .plugin-auth-section")).toBeNull();
		expect(container.textContent).not.toContain("/tmp/shared");
		expect(container.textContent).not.toContain("api.example.com");

		// 点整行 → 详情弹窗，授权在弹窗里
		act(() => row.click());
		const dialog = document.body.querySelector(".plugin-detail")!;
		expect(dialog).toBeTruthy();
		expect(dialog.textContent).toContain("/tmp/shared");
		expect(dialog.textContent).toContain("api.example.com");
		expect(dialog.textContent).toContain("gpt-demo");
		const revoke = [...dialog.querySelectorAll<HTMLButtonElement>(".btn.danger")];
		const pathRevoke = revoke.find((b) => b.textContent?.includes("撤销")) ?? revoke[0];
		act(() => pathRevoke.click());
		expect(send).toHaveBeenCalledWith({ type: "plugin_path_revoke", pluginId: "demo-ui", path: "/tmp/shared" });
		act(() => container.querySelector<HTMLButtonElement>(".plugin-rescan")!.click());
		expect(send).toHaveBeenCalledWith({ type: "plugins_reload" });
	});

	it("插件目录已不在的遗留授权仍可撤销（否则重装会静默继承）", () => {
		const { container, send } = mount();
		act(() => container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click());
		const section = container.querySelector<HTMLDetailsElement>(".plugin-auth-section")!;
		expect(section.textContent).toContain("遗留授权");
		expect(section.textContent).toContain("/tmp/orphan");
		expect(section.textContent).toContain("old.example.com");
		// 存在的插件的授权只出现在详情弹窗里，不在遗留区
		expect(section.textContent).not.toContain("/tmp/shared");
		const rows = [...section.querySelectorAll<HTMLElement>(".plugin-auth-row")];
		const pathRow = rows.find((r) => r.textContent?.includes("/tmp/orphan"))!;
		act(() => pathRow.querySelector<HTMLButtonElement>("button")!.click());
		expect(send).toHaveBeenCalledWith({ type: "plugin_path_revoke", pluginId: "gone-ui", path: "/tmp/orphan" });
		const hostRow = rows.find((r) => r.textContent?.includes("old.example.com"))!;
		act(() => hostRow.querySelector<HTMLButtonElement>("button")!.click());
		expect(send).toHaveBeenCalledWith({
			type: "plugin_permission_revoke",
			pluginId: "gone-ui",
			family: "net",
			host: "old.example.com",
		});
	});

	it("卸载入口在详情弹窗里，确认框写明会连数据一起删", () => {
		const { container, send } = mount();
		const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
		act(() => tabs[1].click());
		const row = container.querySelector<HTMLElement>(".plugin-row")!;
		expect(row.querySelector(".set-icon-btn.danger")).toBeNull();
		act(() => row.click());
		const uninstall = [...document.body.querySelectorAll<HTMLButtonElement>(".plugin-detail .btn.danger")].find((b) =>
			b.textContent?.includes("卸载"),
		)!;
		expect(uninstall).toBeTruthy();
		act(() => uninstall.click());
		const dialog = document.body.querySelector(".confirm-dialog");
		expect(dialog?.textContent).toContain("会删除整个插件目录");
		expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "plugins_uninstall" }));
		act(() => document.body.querySelector<HTMLButtonElement>(".confirm-dialog .btn.danger")!.click());
		expect(send).toHaveBeenCalledWith({ type: "plugins_uninstall", id: "demo-ui" });
	});

	it("插件页打开时隐藏对话布局，并让插件页占满剩余高度", () => {
		const css = readFileSync(resolve(process.cwd(), "web/src/styles.css"), "utf8");
		expect(css).toMatch(/\.conversation-content\.hidden\s*\{\s*display:\s*none;/);
		expect(css).toMatch(/\.capabilities-panel\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;/);
	});

	it("切换 MCP 后显示服务器状态与工具", () => {
		const { container } = mount();
		const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
		act(() => tabs[2].click());
		expect(container.textContent).toContain("echo");
		expect(container.textContent).toContain("启动失败");
		const server = container.querySelector<HTMLDetailsElement>(".mcp-server");
		act(() => {
			server!.open = true;
		});
		expect(container.textContent).toContain("ping");
	});
});
