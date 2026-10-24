/**
 * 应用图标生成器：一张源图 → 全套图标资产（exe / 任务栏 / PWA / 网页 favicon / 顶栏品牌块同一份）。
 *
 * 用法：
 *   node make-icons.mjs <源图路径> [选项]
 *
 * 选项：
 *   --bg <#rrggbb>   抠底后铺的底色（`--bg none` = 输出透明底；缺省 `--bg keep` 保留源图背景）
 *   --trim 0.1       去底后主体缩到画布的比例（默认 0.92；1 = 满幅）
 *   --radius 0.22    圆角半径占边长比例（默认 0.22）
 *   --pixel          强制像素画模式（默认自动判断：源图有强像素块时才启用）
 *
 * 两种处理模式（自动判断）：
 *   - 像素画（强块状边缘）：按格子平均以抹掉 JPEG 噪点，>48px 最近邻放大保留块感。
 *   - 插画（平滑渐变/描线）：直接高质量缩放；若背景是纯色（边框色近乎一致）则从四边
 *     泛洪去底（容差可调），把主体贴到 --bg 底色上 —— 否则白底插图在深色任务栏里就是
 *     一块白砖。
 *
 * 产出（web/public/）：
 *   icons/icon-{1024,512,256,192,128,96,64,48,32,24,16}.png
 *   icons/maskable-{1024,512,192}.png（内容 78% 安全区）
 *   icons/favicon-{32,64}.png
 *   icon.ico（16/24/32/48/64/128/256，PNG 条目）
 *
 * 依赖 playwright-core + 本机 Chrome（只用 canvas 做像素处理，不联网）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { CHROME_PATH } from "./tests/lib/chrome.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const srcArg = argv.find((a) => !a.startsWith("--") && !/^#[0-9a-f]{6}$/i.test(a));
if (!srcArg) {
	console.error("用法：node make-icons.mjs <源图路径> [--bg #4c1d95|keep] [--trim 0.92] [--radius 0.22] [--pixel]");
	process.exit(1);
}
const srcPath = resolve(srcArg);
if (!existsSync(srcPath)) {
	console.error(`源图不存在：${srcPath}`);
	process.exit(1);
}
const opt = (name, dflt) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const num = (v, dflt) => (Number.isFinite(Number(v)) ? Number(v) : dflt);
const radius = Math.min(0.48, Math.max(0, num(opt("radius", 0.22), 0.22)));
const trim = Math.min(1, Math.max(0.5, num(opt("trim", 0.92), 0.92)));
const bgArg = opt("bg", "keep");
const keepBg = bgArg === "keep"; // 不抠底，源图背景保留
const noBg = bgArg === "none"; // 抠掉纯色底，输出透明底
const forcePixel = argv.includes("--pixel");

const PUB = join(here, "web", "public");
const ICONS = join(PUB, "icons");
mkdirSync(ICONS, { recursive: true });

const SIZES = [1024, 512, 256, 192, 128, 96, 64, 48, 32, 24, 16];
const raw = readFileSync(srcPath).toString("base64");
const mime = raw.startsWith("/9j/") ? "image/jpeg" : raw.startsWith("iVBOR") ? "image/png" : "image/webp";

const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
const page = await browser.newPage();
await page.setContent("<body style='margin:0'></body>");

const result = await page.evaluate(
	async ({ raw, mime, SIZES, radius, trim, keepBg, noBg, bgArg, forcePixel }) => {
		const img = new Image();
		img.src = `data:${mime};base64,${raw}`;
		await img.decode();
		const W = img.naturalWidth;
		const H = img.naturalHeight;
		const src = document.createElement("canvas");
		src.width = W;
		src.height = H;
		const sctx = src.getContext("2d");
		sctx.drawImage(img, 0, 0);
		const sd = sctx.getImageData(0, 0, W, H).data;
		const at = (x, y) => (y * W + x) * 4;

		// ---- 1. 判形态：量化后「与左邻居同色」的比例高 → 像素画 ----
		let same = 0;
		let total = 0;
		for (let y = 0; y < H; y += 3) {
			for (let x = 1; x < W; x += 3) {
				const i = at(x, y);
				const j = at(x - 1, y);
				total++;
				if (
					(sd[i] >> 4) === (sd[j] >> 4) &&
					(sd[i + 1] >> 4) === (sd[j + 1] >> 4) &&
					(sd[i + 2] >> 4) === (sd[j + 2] >> 4)
				)
					same++;
			}
		}
		const blockiness = same / total;
		const pixelMode = forcePixel || blockiness > 0.9;

		// ---- 2. 背景是否纯色（边框 4 条带的标准差小）----
		const borderSamples = [];
		for (let x = 0; x < W; x += 7) {
			borderSamples.push(at(x, 1), at(x, H - 2));
		}
		for (let y = 0; y < H; y += 7) {
			borderSamples.push(at(1, y), at(W - 2, y));
		}
		const avg = [0, 1, 2].map((c) => borderSamples.reduce((s, i) => s + sd[i + c], 0) / borderSamples.length);
		const dev = borderSamples.reduce((s, i) => s + Math.abs(sd[i] - avg[0]) + Math.abs(sd[i + 1] - avg[1]) + Math.abs(sd[i + 2] - avg[2]), 0) / borderSamples.length;
		const flatBg = dev < 12;

		// ---- 3. 画布准备 ----
		let canvas; // 处理后的「主体」，尺寸 W×H（或像素网格 cols×rows）
		let cols = W;
		let rows = H;

		if (pixelMode) {
			// 像素画：按格子平均抹噪点
			const scoreGrid = (g) => {
				let sum = 0;
				let cnt = 0;
				for (let by = 0; by + g <= H; by += g) {
					for (let bx = 0; bx + g <= W; bx += g) {
						const ci = at(bx + (g >> 1), by + (g >> 1));
						let acc = 0;
						for (const [ox, oy] of [[0, 0], [g - 1, 0], [0, g - 1], [g - 1, g - 1], [g >> 1, g >> 1]]) {
							const i = at(bx + ox, by + oy);
							acc += Math.abs(sd[i] - sd[ci]) + Math.abs(sd[i + 1] - sd[ci + 1]) + Math.abs(sd[i + 2] - sd[ci + 2]);
						}
						sum += acc;
						cnt++;
						if (cnt > 4000) return sum / cnt;
					}
				}
				return sum / cnt;
			};
			let best = { g: 16, score: Infinity };
			for (let g = 16; g <= 128; g++) {
				const s = scoreGrid(g);
				if (s < best.score) best = { g, score: s };
			}
			const g = best.g;
			cols = Math.floor(W / g);
			rows = Math.floor(H / g);
			canvas = document.createElement("canvas");
			canvas.width = cols;
			canvas.height = rows;
			const ctx = canvas.getContext("2d");
			const out = ctx.createImageData(cols, rows);
			for (let y = 0; y < rows; y++) {
				for (let x = 0; x < cols; x++) {
					let r = 0;
					let gg = 0;
					let b = 0;
					let n = 0;
					for (let oy = 0; oy < 3; oy++) {
						for (let ox = 0; ox < 3; ox++) {
							const px = Math.min(W - 1, x * g + Math.round(((ox + 1) * g) / 4));
							const py = Math.min(H - 1, y * g + Math.round(((oy + 1) * g) / 4));
							const i = at(px, py);
							r += sd[i];
							gg += sd[i + 1];
							b += sd[i + 2];
							n++;
						}
					}
					const o = (y * cols + x) * 4;
					out.data[o] = Math.round(r / n);
					out.data[o + 1] = Math.round(gg / n);
					out.data[o + 2] = Math.round(b / n);
					out.data[o + 3] = 255;
				}
			}
			ctx.putImageData(out, 0, 0);
		} else if (flatBg && !keepBg) {
			// 插画 + 纯色底：从四边泛洪去底（容差），边缘做 1px 羽化
			const tol = 48;
			const alpha = new Uint8Array(W * H).fill(255);
			const seen = new Uint8Array(W * H);
			const stack = [];
			for (let x = 0; x < W; x++) {
				stack.push(x, 0, x, H - 1);
			}
			for (let y = 0; y < H; y++) {
				stack.push(0, y, W - 1, y);
			}
			while (stack.length) {
				const y = stack.pop();
				const x = stack.pop();
				const p = y * W + x;
				if (seen[p]) continue;
				seen[p] = 1;
				const i = p * 4;
				if (
					Math.abs(sd[i] - avg[0]) > tol ||
					Math.abs(sd[i + 1] - avg[1]) > tol ||
					Math.abs(sd[i + 2] - avg[2]) > tol
				)
					continue;
				alpha[p] = 0;
				if (x > 0) stack.push(x - 1, y);
				if (x < W - 1) stack.push(x + 1, y);
				if (y > 0) stack.push(x, y - 1);
				if (y < H - 1) stack.push(x, y + 1);
			}
			// 羽化：把与透明相邻的不透明像素按 60% 处理，弱化锯齿
			const feathered = alpha.slice();
			for (let y = 1; y < H - 1; y++) {
				for (let x = 1; x < W - 1; x++) {
					const p = y * W + x;
					if (!alpha[p]) continue;
					if (!alpha[p - 1] || !alpha[p + 1] || !alpha[p - W] || !alpha[p + W]) feathered[p] = 150;
				}
			}
			canvas = document.createElement("canvas");
			canvas.width = W;
			canvas.height = H;
			const ctx = canvas.getContext("2d");
			const out = ctx.createImageData(W, H);
			out.data.set(sd);
			for (let p = 0; p < W * H; p++) out.data[p * 4 + 3] = feathered[p];
			ctx.putImageData(out, 0, 0);
		} else {
			canvas = src;
		}

		// ---- 4. 合成：底色（可保留源图底）+ 主体 ----
		const compose = (size, inner, round) => {
			const c = document.createElement("canvas");
			c.width = size;
			c.height = size;
			const ctx = c.getContext("2d");
			if (round) {
				const r = size * radius;
				ctx.beginPath();
				ctx.moveTo(r, 0);
				ctx.arcTo(size, 0, size, size, r);
				ctx.arcTo(size, size, 0, size, r);
				ctx.arcTo(0, size, 0, 0, r);
				ctx.arcTo(0, 0, size, 0, r);
				ctx.closePath();
				ctx.clip();
			}
			if (noBg) {
				// 透明底：什么都不铺
			} else if (!keepBg && flatBg) {
				ctx.fillStyle = bgArg;
				ctx.fillRect(0, 0, size, size);
			} else {
				// 保留源图底：铺一层取样色防透明边
				ctx.fillStyle = `rgb(${Math.round(avg[0])}, ${Math.round(avg[1])}, ${Math.round(avg[2])})`;
				ctx.fillRect(0, 0, size, size);
			}
			const d = size * inner;
			ctx.imageSmoothingEnabled = !(pixelMode && size > 48);
			ctx.imageSmoothingQuality = "high";
			ctx.drawImage(canvas, 0, 0, cols, rows, (size - d) / 2, (size - d) / 2, d, d);
			return c.toDataURL("image/png");
		};

		const files = {};
		for (const s of SIZES) files[`icon-${s}.png`] = compose(s, trim, true);
		for (const s of [1024, 512, 192]) files[`maskable-${s}.png`] = compose(s, Math.min(0.78, trim), false);
		files["favicon-32.png"] = compose(32, trim, true);
		files["favicon-64.png"] = compose(64, trim, true);

		return {
			files,
			mode: pixelMode
				? "pixel"
				: noBg
					? "illustration(transparent)"
					: flatBg && !keepBg
						? "illustration(trimmed)"
						: "illustration(keep-bg)",
			blockiness: Math.round(blockiness * 100),
			flatBg,
			grid: pixelMode ? `${cols}×${rows}` : `${cols}×${rows}`,
			srcAvg: `rgb(${Math.round(avg[0])}, ${Math.round(avg[1])}, ${Math.round(avg[2])})`,
		};
	},
	{ raw, mime, SIZES, radius, trim, keepBg, noBg, bgArg, forcePixel },
);

for (const [name, dataUrl] of Object.entries(result.files)) {
	writeFileSync(join(ICONS, name), Buffer.from(dataUrl.split(",")[1], "base64"));
}

function buildIco(entries) {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(entries.length, 4);
	let offset = 6 + entries.length * 16;
	const dir = [];
	const blobs = [];
	for (const { size, buf } of entries) {
		const e = Buffer.alloc(16);
		e.writeUInt8(size >= 256 ? 0 : size, 0);
		e.writeUInt8(size >= 256 ? 0 : size, 1);
		e.writeUInt16LE(1, 4);
		e.writeUInt16LE(32, 6);
		e.writeUInt32LE(buf.length, 8);
		e.writeUInt32LE(offset, 12);
		offset += buf.length;
		dir.push(e);
		blobs.push(buf);
	}
	return Buffer.concat([header, ...dir, ...blobs]);
}

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
writeFileSync(
	join(PUB, "icon.ico"),
	buildIco(icoSizes.map((size) => ({ size, buf: readFileSync(join(ICONS, `icon-${size}.png`)) }))),
);

await browser.close();
console.log(
	`✔ 图标已更新（${result.mode}，块状度 ${result.blockiness}% ，源图底 ${result.srcAvg}）\n` +
		`  ${Object.keys(result.files).length} 个 PNG + icon.ico（${icoSizes.join("/")}）→ ${ICONS}`,
);
