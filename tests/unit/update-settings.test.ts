// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { UpdateSettings } from "../../web/src/components/UpdateSettings.js";
import { LanguageProvider } from "../../web/src/i18n.js";
import type { DesktopShellWindow, DesktopUpdater } from "../../web/src/desktop.js";

let root: Root | null = null;
afterEach(() => {
	if (root) act(() => root!.unmount());
	root = null;
	document.body.innerHTML = "";
	delete (window as unknown as DesktopShellWindow).piDesktop;
});

describe("设置 → 通用 → 软件更新", () => {
	it("挂载不联网；检查与下载分别由用户点击触发", async () => {
		const updater: DesktopUpdater = {
			getInfo: vi.fn(async () => ({ supported: true, currentVersion: "0.0.5" })),
			check: vi.fn(async () => ({
				status: "available" as const,
				release: {
					version: "0.1.0",
					notes: "Bug fixes",
					pageUrl: "https://github.com/ccask7/pi-ui/releases/tag/v0.1.0",
				},
			})),
			download: vi.fn(async () => ({ status: "ready" as const })),
			cancel: vi.fn(async () => {}),
			install: vi.fn(async () => null),
			onProgress: vi.fn(() => () => {}),
		};
		(window as unknown as DesktopShellWindow).piDesktop = { isDesktop: true, updater };
		const container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		await act(async () => {
			root!.render(createElement(LanguageProvider, null, createElement(UpdateSettings, { appVersion: "0.0.5" })));
			await Promise.resolve();
		});
		expect(updater.check).not.toHaveBeenCalled();
		expect(updater.download).not.toHaveBeenCalled();
		const check = container.querySelector<HTMLButtonElement>(".update-check-button")!;
		expect(check.disabled).toBe(false);
		await act(async () => {
			check.click();
			await Promise.resolve();
		});
		expect(updater.check).toHaveBeenCalledTimes(1);
		expect(updater.download).not.toHaveBeenCalled();
		expect(document.querySelector(".update-modal")?.textContent).toContain("v0.1.0");
		const update = document.querySelector<HTMLButtonElement>(".update-modal .update-actions .primary")!;
		await act(async () => {
			update.click();
			await Promise.resolve();
		});
		expect(updater.download).toHaveBeenCalledTimes(1);
		expect(document.querySelector(".update-progress")).toBeNull();
		expect(document.querySelector(".update-modal .update-actions .primary")).not.toBeNull();
		expect(updater.install).not.toHaveBeenCalled();
	});
});
