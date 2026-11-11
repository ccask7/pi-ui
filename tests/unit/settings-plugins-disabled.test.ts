/**
 * 「界面插件」停用名单的保存口径：
 *  - 名单变了才通知引擎侧（插件 reload 会重 import 全部模块，不能顺手每次都做）；
 *  - 名单没变（例如整份设置回存）不触发 reload。
 */
import { describe, expect, it, vi } from "vitest";
import { SettingsService, type SettingsHost } from "../../server/settings-service.js";
import type { ClientStateStore } from "../../server/client-state.js";

function makeHost(disabledPlugins: string[] = []) {
	const writer = vi.fn();
	const host = {
		clientId: "test-client",
		stateStore: {
			getSettings: () => ({
				promptMode: "append",
				customSystemPrompt: "",
				promptTemplate: "",
				promptOverrides: {},
				disabledSkills: [],
				disabledExtensions: [],
				disabledAgentTools: [],
				disabledPluginTools: [],
				terminalToolsEnabled: false,
				terminalBash: false,
				terminalBashIdleMs: 15_000,
				terminalBashMaxForegroundMs: 60_000,
				editSoftEnabled: false,
				questionnaireEnabled: true,
				goalModeEnabled: true,
				thinkingWrap: false,
				toolsWrap: true,
				skillsFullText: [],
				visionBridgeEnabled: true,
				visionBridgeModel: null,
				visionBridgePromptMode: "append",
				visionBridgePrompt: "",
				subagentDefaultModel: null,
				retryMaxAttempts: 6,
				softCapTokens: 0,
				softCapByModel: {},
				quickPhrases: [],
				quickPhrasesEnabled: true,
				reviewPrompt: "",
				reviewDisabledSkills: [],
				disabledPlugins,
				uiLayout: {},
			}),
			getPresets: () => [],
			getQuickPhrasesSeeded: () => false,
			saveSettings: () => {},
		} as unknown as ClientStateStore,
		emit: () => {},
		flushSnapshot: () => {},
		isDisposed: () => false,
		getSession: () => {
			throw new Error("no session");
		},
		cwd: () => "/tmp",
		agentDir: () => "/tmp",
		isStreaming: () => false,
		reloadSession: async () => {},
		applyRetryOverrides: () => {},
		applyCompactionOverrides: () => {},
		applyToolGating: () => {},
		promptSnapshot: () => ({ full: "", texts: {}, toolsSchema: "" }),
		setPluginsDisabled: writer,
	} as unknown as SettingsHost;
	return { host, writer };
}

const templates = { list: () => [] } as unknown as import("../../server/subagent-templates.js").SubagentTemplatesStore;

describe("停用名单保存", () => {
	it("名单变化 → 交给引擎侧；重复保存同一名单不触发", async () => {
		const { host, writer } = makeHost([]);
		const svc = new SettingsService(host, templates);

		await svc.set({ disabledPlugins: ["memory"] });
		expect(writer).toHaveBeenCalledTimes(1);
		expect(writer).toHaveBeenLastCalledWith(["memory"]);

		await svc.set({ disabledPlugins: ["memory"] });
		expect(writer).toHaveBeenCalledTimes(1);

		await svc.set({ disabledPlugins: [] });
		expect(writer).toHaveBeenCalledTimes(2);
		expect(writer).toHaveBeenLastCalledWith([]);
	});

	it("顺序不同但集合相同（不是真正的变化）不触发", async () => {
		const { host, writer } = makeHost(["a", "b"]);
		const svc = new SettingsService(host, templates);
		await svc.set({ disabledPlugins: ["b", "a"] });
		expect(writer).not.toHaveBeenCalled();
	});
});
