import { describe, expect, it } from "vitest";
import { ClientSession } from "../../server/agent-service.js";

function withCurrentCwd(cwd: string, projects: { path: string; lastUsed: number }[]) {
	return Reflect.apply(ClientSession.prototype["withCurrentCwd"], { cwd }, [projects, 3000]);
}

describe("项目树顺序", () => {
	it("选中已有目录时保持原顺序，不刷新时间或置顶", () => {
		const projects = [
			{ path: "/first", lastUsed: 2000 },
			{ path: "/selected", lastUsed: 1000 },
		];
		expect(withCurrentCwd("/selected", projects)).toEqual(projects);
	});

	it("首次出现的目录仍加入列表", () => {
		expect(withCurrentCwd("/new", [{ path: "/existing", lastUsed: 1000 }])).toEqual([
			{ path: "/new", lastUsed: 3000 },
			{ path: "/existing", lastUsed: 1000 },
		]);
	});
});
