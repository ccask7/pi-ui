import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ClientSession } from "../../server/agent-service.js";

describe("新建任务草稿提交", () => {
	it("按选中项目依次切换目录、创建空白会话并发送首条消息", async () => {
		const calls: string[] = [];
		const host = {
			cwd: "D:/first",
			setCwd: vi.fn(async (cwd: string) => {
				calls.push(`cwd:${cwd}`);
				host.cwd = cwd;
			}),
			newChat: vi.fn(async () => {
				calls.push("new");
				return true;
			}),
			prompt: vi.fn(async (text: string) => {
				calls.push(`prompt:${text}`);
			}),
		};
		await Reflect.apply(ClientSession.prototype.promptNewTask, host, ["D:/second", "hello", []]);
		expect(calls).toEqual([`cwd:${resolve("D:/second")}`, "new", "prompt:hello"]);
	});

	it("创建失败时不把首条消息误发到旧会话", async () => {
		const host = {
			cwd: resolve("D:/project"),
			setCwd: vi.fn(),
			newChat: vi.fn(async () => false),
			prompt: vi.fn(),
		};
		await Reflect.apply(ClientSession.prototype.promptNewTask, host, ["D:/project", "hello", []]);
		expect(host.setCwd).not.toHaveBeenCalled();
		expect(host.prompt).not.toHaveBeenCalled();
	});

	it("目录切换失败时不继续创建或发送", async () => {
		const host = {
			cwd: "D:/first",
			setCwd: vi.fn(async () => {}),
			newChat: vi.fn(),
			prompt: vi.fn(),
		};
		await Reflect.apply(ClientSession.prototype.promptNewTask, host, ["D:/missing", "hello", []]);
		expect(host.newChat).not.toHaveBeenCalled();
		expect(host.prompt).not.toHaveBeenCalled();
	});
});
