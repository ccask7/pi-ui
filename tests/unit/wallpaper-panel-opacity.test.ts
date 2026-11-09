// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { applyWallpaper, saveWallpaperSettings } from "../../web/src/wallpaper.js";

afterEach(() => {
	localStorage.clear();
	document.documentElement.removeAttribute("style");
	document.body.className = "";
});

describe("界面底板不透明度", () => {
	it("只更新底板变量，不改变背景图、压暗和模糊", () => {
		const root = document.documentElement;
		saveWallpaperSettings({ url: "/wallpaper.png", dim: 35, blur: 6, panelOpacity: 62 });

		saveWallpaperSettings({ url: "/wallpaper.png", dim: 35, blur: 6, panelOpacity: 25 });
		expect(root.style.getPropertyValue("--wallpaper-panel-alpha")).toBe("25%");
		expect(root.style.getPropertyValue("--bg-image")).toBe('url("/wallpaper.png")');
		expect(root.style.getPropertyValue("--bg-image-dim")).toBe("0.35");
		expect(root.style.getPropertyValue("--bg-image-blur")).toBe("6px");
		expect(document.body.classList.contains("has-wallpaper")).toBe(true);
	});

	it("旧设置缺少新字段时使用当前默认值 62%", () => {
		saveWallpaperSettings({ url: "", dim: 40, blur: 2 } as Parameters<typeof saveWallpaperSettings>[0]);
		applyWallpaper();
		expect(document.documentElement.style.getPropertyValue("--wallpaper-panel-alpha")).toBe("62%");
	});
});
