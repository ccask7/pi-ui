import { describe, expect, it } from "vitest";
import { formatActivityDuration } from "../../web/src/components/ActivityGroup.js";

// ActivityGroup 同时渲染 Message / Markdown 等重型依赖；耗时格式保持纯函数直测。
describe("工作记录耗时", () => {
	it("一分钟内只显示秒", () => {
		expect(formatActivityDuration(0)).toBe("0s");
		expect(formatActivityDuration(36.9)).toBe("36s");
	});

	it("长耗时使用紧凑的分钟和小时", () => {
		expect(formatActivityDuration(60)).toBe("1m");
		expect(formatActivityDuration(96)).toBe("1m 36s");
		expect(formatActivityDuration(3600)).toBe("1h");
		expect(formatActivityDuration(3780)).toBe("1h 3m");
	});

	it("异常负值不进入界面", () => {
		expect(formatActivityDuration(-5)).toBe("0s");
	});
});
