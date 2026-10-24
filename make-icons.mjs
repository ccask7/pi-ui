/**
 * 应用图标生成器：一张源图 → 全套图标资产。
 *
 * 用法：
 *   node make-icons.mjs <源图路径> [--keep-bg] [--radius 0.22]
 *
 * 产出（都写进 web/public/）：
 *   icons/icon-{1024,512,256,192,128,96,64,48,32,24,16}.png   圆角方形（Windows/网页）
 *   icons/maskable-{1024,512,192}.png                          内容缩到 78% 安全区（PWA 圆形裁切）
 *   icons/favicon-{32,64}.png                                  浏览器标签页
 *   icon.ico                                                   16/24/32/48/64/128/256 多尺寸
 *
 * 处理要点（为「像素/插画风头像」这类源图调过的）：
 *   - 自动探测源图的像素网格（默认像素画常见 16–64 格），先把 JPEG 噪点按格子平均掉，
 *     得到干净的像素画布，再用最近邻放大 —— 否则小尺寸下满屏噪点。
 *   - 大尺寸（>48px）最近邻放大保留像素块；小尺寸走高质量平滑，16px 才看得出是张脸。
 *   - 圆角半径按边长比例给（默认 22%，与旧 π 图标的 228/1024 一致）。
 *
 * 依赖 playwright-core + 本机 Chrome（只用 canvas 做图像处理，不联网）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { CHROME_PATH } from "./tests/lib/chrome.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const srcArg = args.find((a) => !a.startsWith("--"));
if (!srcArg) {
	console.error("用法：node make-icons.mjs <源图路径> [--radius 0.22]");
	process.exit(1);
}
const srcPath = resolve(srcArg);
if (!existsSync(srcPath)) {
	console.error(`源图不存在：${srcPath}`);
	process.exit(1);
}
const radiusArg = args.includes("--radius") ? Number(args[args.indexOf("--radius") + 1]) : 0.22;
const radius = Number.isFinite(radiusArg) && radiusArg > 0 && radiusArg < 0.5 ? radiusArg : 0.22;

const PUB = join(here, "web", "public");
const ICONS = join(PUB, "icons");
mkdirSync(ICONS, { recursive: true });

const SIZES = [1024, 512, 256, 192, 128, 96, 64, 48, 32, 24, 16];
const raw = readFileSync(srcPath).toString("base64");
// 后缀不可靠（.png 也可能是 JPEG）——按魔数判
const mime = raw.startsWith("/9j/") ? "image/jpeg" : raw.startsWith("iVBOR") ? "image/png" : "image/webp";

const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
const page = await browser.newPage();
await page.setContent("<body style='margin:0'></body>");

const result = await page.evaluate(
	async ({ raw, mime, SIZES, radius }) => {
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

		// 1) 探测像素网格：挑「块内最平」的格边长（对 JPEG 噪点比游程统计稳）
		const scoreGrid = (g) => {
			let sum = 0;
			let cnt = 0;
			for (let by = 0; by + g <= H; by += g) {
				for (let bx = 0; bx + g <= W; bx += g) {
					const cx = bx + (g >> 1);
					const cy = by + (g >> 1);
					const ci = (cy * W + cx) * 4;
					let acc = 0;
					for (const [ox, oy] of [
						[0, 0],
						[g - 1, 0],
						[0, g - 1],
						[g - 1, g - 1],
						[g >> 1, g >> 1],
					]) {
						const i = ((by + oy) * W + (bx + ox)) * 4;
						acc += Math.abs(sd[i] - sd[ci]) + Math.abs(sd[i + 1] - sd[ci + 1]) + Math.abs(sd[i + 2] - sd[ci + 2]);
					}
					sum += acc;
					cnt++;
					if (cnt > 4000) return sum / cnt;
				}
			}
			return sum / cnt;
		};
		let best = { g: 24, score: Infinity };
		for (let g = 16; g <= 128; g++) {
			const s = scoreGrid(g);
			if (s < best.score) best = { g, score: s };
		}
		const grid = best.g;
		const cols = Math.floor(W / grid);
		const rows = Math.floor(H / grid);

		// 2) 每格取 9 点平均 → 干净像素画布
		const pix = document.createElement("canvas");
		pix.width = cols;
		pix.height = rows;
		const pctx = pix.getContext("2d");
		const out = pctx.createImageData(cols, rows);
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				let r = 0;
				let g2 = 0;
				let b = 0;
				let n = 0;
				for (let oy = 0; oy < 3; oy++) {
					for (let ox = 0; ox < 3; ox++) {
						const px = Math.min(W - 1, x * grid + Math.round(((ox + 1) * grid) / 4));
						const py = Math.min(H - 1, y * grid + Math.round(((oy + 1) * grid) / 4));
						const i = (py * W + px) * 4;
						r += sd[i];
						g2 += sd[i + 1];
						b += sd[i + 2];
						n++;
					}
				}
				const o = (y * cols + x) * 4;
				out.data[o] = Math.round(r / n);
				out.data[o + 1] = Math.round(g2 / n);
				out.data[o + 2] = Math.round(b / n);
				out.data[o + 3] = 255;
			}
		}
		pctx.putImageData(out, 0, 0);
		const bgColor = `rgb(${out.data[0]}, ${out.data[1]}, ${out.data[2]})`;

		// 3) 圆角方形 / 安全区方形
		const rounded = (size) => {
			const c = document.createElement("canvas");
			c.width = size;
			c.height = size;
			const ctx = c.getContext("2d");
			const r = size * radius;
			ctx.beginPath();
			ctx.moveTo(r, 0);
			ctx.arcTo(size, 0, size, size, r);
			ctx.arcTo(size, size, 0, size, r);
			ctx.arcTo(0, size, 0, 0, r);
			ctx.arcTo(0, 0, size, 0, r);
			ctx.closePath();
			ctx.clip();
			ctx.imageSmoothingEnabled = size > 48;
			ctx.imageSmoothingQuality = "high";
			ctx.drawImage(pix, 0, 0, cols, rows, 0, 0, size, size);
			return c.toDataURL("image/png");
		};
		const square = (size, inner) => {
			const c = document.createElement("canvas");
			c.width = size;
			c.height = size;
			const ctx = c.getContext("2d");
			ctx.fillStyle = bgColor;
			ctx.fillRect(0, 0, size, size);
			const d = size * inner;
			ctx.imageSmoothingEnabled = size > 48;
			ctx.imageSmoothingQuality = "high";
			ctx.drawImage(pix, 0, 0, cols, rows, (size - d) / 2, (size - d) / 2, d, d);
			return c.toDataURL("image/png");
		};

		const files = {};
		for (const s of SIZES) files[`icon-${s}.png`] = rounded(s);
		for (const s of [1024, 512, 192]) files[`maskable-${s}.png`] = square(s, 0.78);
		files["favicon-32.png"] = rounded(32);
		files["favicon-64.png"] = rounded(64);
		return { files, grid, cols, rows, bgColor };
	},
	{ raw, mime, SIZES, radius },
);

for (const [name, dataUrl] of Object.entries(result.files)) {
	writeFileSync(join(ICONS, name), Buffer.from(dataUrl.split(",")[1], "base64"));
}

/** ICO 打包：每张图一条 PNG 载荷（Vista+ 支持）。 */
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
const ico = buildIco(icoSizes.map((size) => ({ size, buf: readFileSync(join(ICONS, `icon-${size}.png`)) })));
writeFileSync(join(PUB, "icon.ico"), ico);

await browser.close();
console.log(
	`✔ 图标已更新：网格 ${result.grid}px → ${result.cols}×${result.rows}，背景 ${result.bgColor}\n` +
		`  ${Object.keys(result.files).length} 个 PNG + icon.ico（${icoSizes.join("/")}）→ ${ICONS}`,
);
