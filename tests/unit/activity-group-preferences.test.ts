// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { ActivityGroup } from "../../web/src/components/ActivityGroup.js";
import { LanguageProvider } from "../../web/src/i18n.js";
import type { UiContentBlock } from "../../web/src/types.js";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const blocks: UiContentBlock[] = [
	{ type: "thinking", thinking: "考虑实现方式" },
	{ type: "toolCall", id: "tool-1", name: "read", argumentsText: '{"path":"README.md"}' },
];

function render(toolsWrap = false, thinkingWrap = false) {
	act(() => {
		root!.render(
			createElement(
				LanguageProvider,
				null,
				createElement(ActivityGroup, {
					blocks,
					startedAt: 1000,
					toolResults: new Map(),
					liveOutputs: new Map(),
					toolStatuses: new Map(),
					streaming: false,
					toolsWrap,
					thinkingWrap,
				}),
			),
		);
	});
}

afterEach(() => {
	if (root) act(() => root!.unmount());
	root = null;
	container?.remove();
	container = null;
});

describe("工作记录内的思考与工具设置", () => {
	it("一级记录始终默认折叠，二级思考和工具默认折叠", () => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		render();
		expect(container.querySelector(".activity-timeline")).toBeNull();

		act(() => container!.querySelector<HTMLButtonElement>(".activity-head")!.click());
		expect(container.querySelector(".thinking-head")?.getAttribute("aria-expanded")).toBe("false");
		expect(container.querySelector(".toolcall-head")?.getAttribute("aria-expanded")).toBe("false");
		expect(container.querySelector(".thinking-body")).toBeNull();
		expect(container.querySelector(".toolcall-body")).toBeNull();
	});

	it("展开一级记录后，设置分别控制二级思考和工具的默认展开", () => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		render(true, true);
		act(() => container!.querySelector<HTMLButtonElement>(".activity-head")!.click());
		expect(container.querySelector(".thinking-head")?.getAttribute("aria-expanded")).toBe("true");
		expect(container.querySelector(".toolcall-head")?.getAttribute("aria-expanded")).toBe("true");
		expect(container.querySelector(".thinking-body")?.textContent).toContain("考虑实现方式");
		expect(container.querySelector(".toolcall-body")?.textContent).toContain("README.md");
	});
});
