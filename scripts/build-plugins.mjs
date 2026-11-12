/**
 * 构建时把随包发行的插件拷进 `dist/plugins/`（只拷要内置的那几个，且去掉 test/eval）。
 * 这个位置与 `server/plugin-seed.ts` 的解析一致：dist/server/../plugins。
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = ["memory"];
const skip = new Set(["test", "eval", "data", "node_modules"]);

const outRoot = join(root, "dist", "plugins");
mkdirSync(outRoot, { recursive: true });

for (const id of bundled) {
	const src = join(root, "plugins", id);
	const dest = join(outRoot, id);
	if (!existsSync(join(src, "manifest.json"))) {
		console.warn(`[build:plugins] 跳过 ${id}：源目录没有 manifest.json`);
		continue;
	}
	rmSync(dest, { recursive: true, force: true });
	cpSync(src, dest, {
		recursive: true,
		filter: (path) => {
			const rel = path.slice(src.length + 1);
			if (!rel) return true;
			const first = rel.split(String.fromCharCode(92)).join("/").split("/")[0];
			return !skip.has(first);
		},
	});
	console.log(`[build:plugins] ${id} → dist/plugins/${id}`);
}
