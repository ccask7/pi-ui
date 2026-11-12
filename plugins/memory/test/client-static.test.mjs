/**
 * 客户端 bundle 的静态自检（无 DOM，不做渲染）。
 *
 * 起因：一次重构把 `updateTrashButton()` 的调用留在了 `load()` 里、定义却删了。
 * `load()` 有 try/catch，浏览器里只表现为 note 栏一句「读取失败」，图谱照画，
 * 单测和服务端测试全绿——很隐蔽。这里用一条便宜的守卫盯住同形状的问题：
 * 调用了看起来像本地辅助函数、却在本文件里没定义也没 import 的名字。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** 剥掉注释：注释里出现 `mount()` 这类字样不该算调用。 */
function stripComments(code) {
	return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SRC = stripComments(readFileSync(new URL("../client/entry.mjs", import.meta.url), "utf8"));

/** 收集"本文件里声明的名字"：函数声明、const/let/var、具名 import。 */
function collectDeclared(code) {
	const names = new Set();
	for (const m of code.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
	for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
	for (const m of code.matchAll(/import\s+\{([^}]*)\}/g)) {
		for (const part of m[1].split(",")) {
			const name = part
				.trim()
				.split(/\s+as\s+/)
				.pop();
			if (name) names.add(name);
		}
	}
	return names;
}

/** 对象字面量里的方法简写（`mount(el, ctx) {`）是定义，不是调用。 */
function collectMethodDefs(code) {
	const names = new Set();
	for (const m of code.matchAll(/(?:^|[{,]\s*)([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/gm)) names.add(m[1]);
	return names;
}

/** 收集"看起来像本地辅助函数的裸调用"（排除 obj.method() 与方法定义）。 */
function collectCalled(code) {
	const names = new Set();
	const methods = collectMethodDefs(code);
	for (const m of code.matchAll(
		/\b((?:render|update|draw|select|toggle|rebuild|apply|sync|mount|load)[A-Za-z0-9_$]*)\s*\(/g,
	)) {
		const name = m[1];
		// 前面紧跟 `.` 的是方法调用，跳过
		const before = code.slice(Math.max(0, m.index - 2), m.index);
		if (before.endsWith(".") || before.endsWith("?.")) continue;
		if (methods.has(name)) continue;
		names.add(name);
	}
	return names;
}

test("entry.mjs 不调用未定义的本地辅助函数", () => {
	const declared = collectDeclared(SRC);
	const missing = [...collectCalled(SRC)].filter((name) => !declared.has(name));
	assert.deepEqual(missing, [], `entry.mjs 调用了未定义的函数：${missing.join(", ")}`);
});

test("守卫本身有效：已知的坏样本必须被抓到", () => {
	const sample = stripComments("function load() { rebuild(); updateTrashButton(); } function rebuild() {}");
	const declared = collectDeclared(sample);
	const missing = [...collectCalled(sample)].filter((name) => !declared.has(name));
	assert.deepEqual(missing, ["updateTrashButton"]);
});
