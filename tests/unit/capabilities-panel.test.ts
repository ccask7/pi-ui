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

	it("插件页签合并扩展包和界面插件，并保留各自启停入口", () => {
		const { container, send } = mount();
		const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
		expect(tabs).toHaveLength(3);
		act(() => tabs[1].click());
		expect(container.textContent).toContain("扩展包");
		expect(container.textContent).toContain("界面插件");
		expect(container.textContent).toContain("Demo Extension");
		expect(container.textContent).toContain("Demo UI Plugin");
		const extensionToggle = container.querySelector<HTMLButtonElement>('.capabilities-extension-group [role="switch"]');
		act(() => extensionToggle!.click());
		expect(send).toHaveBeenCalledWith({ type: "set_settings", disabledExtensions: ["npm:demo"] });
		const uiToggle = container.querySelector<HTMLButtonElement>('.capabilities-ui-group [role="switch"]');
		act(() => uiToggle!.click());
		expect(send).toHaveBeenCalledWith({ type: "set_settings", disabledPlugins: ["demo-ui"] });
		expect(container.textContent).toContain("A short plugin summary");
		expect(document.body.querySelector('[role="dialog"]')).toBeNull();
		expect(container.querySelector(".plugin-secondary-section")).toBeNull();
		expect(container.querySelector<HTMLButtonElement>(".plugin-rescan")).not.toBeNull();
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
