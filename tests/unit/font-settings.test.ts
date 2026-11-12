// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
	INTERFACE_FONT_KEY,
	applyInterfaceFont,
	loadInterfaceFont,
	saveInterfaceFont,
} from "../../web/src/font-settings.js";

describe("界面字体设置", () => {
	beforeEach(() => {
		localStorage.clear();
		saveInterfaceFont("system");
	});

	it("缺省使用系统字体，非法存储值安全回退", () => {
		expect(loadInterfaceFont()).toBe("system");
		localStorage.setItem(INTERFACE_FONT_KEY, "unknown");
		expect(loadInterfaceFont()).toBe("system");
	});

	it("只在选中更纱黑体时注入字体样式表，切回系统字体就移除", () => {
		expect(document.getElementById("ccui-interface-font")).toBeNull();
		saveInterfaceFont("sarasa-ui-sc");
		const link = document.getElementById("ccui-interface-font") as HTMLLinkElement | null;
		expect(link?.rel).toBe("stylesheet");
		expect(link?.getAttribute("href")).toContain("/fonts/sarasa-ui-sc/SarasaUiSC-Regular.css");
		saveInterfaceFont("system");
		expect(document.getElementById("ccui-interface-font")).toBeNull();
	});

	it("切换更纱黑体后立即应用并持久化", () => {
		saveInterfaceFont("sarasa-ui-sc");
		expect(localStorage.getItem(INTERFACE_FONT_KEY)).toBe("sarasa-ui-sc");
		expect(document.documentElement.dataset.interfaceFont).toBe("sarasa-ui-sc");
		saveInterfaceFont("system");
		applyInterfaceFont();
		expect(document.documentElement.dataset.interfaceFont).toBe("system");
	});
});
