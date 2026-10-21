/**
 * 桌面壳（Electron）检测 + 标题栏（WCO）配色同步。
 *
 * `desktop/preload.cts` 经 contextBridge 在主世界挂了
 * `window.piDesktop = { isDesktop: true, pickDirectory, start, setTitleBarOverlay, … }`，
 * 这是主判定；UA 里带 `Electron/` 当兜底（preload 未来改名也不至于全瞎）。
 *
 * 参数注水（`win?`）是为了单测：浏览器里直接调 `isDesktopShell()` 读全局 window 即可。
 */
export interface DesktopShellWindow {
	piDesktop?: {
		isDesktop?: unknown;
		updater?: unknown;
		setTitleBarOverlay?: (color: string, symbolColor: string) => Promise<unknown>;
	};
	navigator?: { userAgent?: unknown };
}

export function isDesktopShell(win?: unknown): boolean {
	const w =
		(win as DesktopShellWindow | undefined) ??
		(typeof window === "undefined" ? undefined : (window as unknown as DesktopShellWindow));
	if (!w) return false;
	if (w.piDesktop?.isDesktop === true) return true;
	const ua = w.navigator?.userAgent;
	return typeof ua === "string" && ua.includes("Electron/");
}

interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

/** 解析颜色串 → 分量（0-255）与不透明度；兼容 `rgb(…)` 与 `color(srgb …)`。 */
function parseColor(color: string): Rgba | null {
	const nums = color.match(/-?[\d.]+/g)?.map(Number);
	if (!nums || nums.length < 3) return null;
	// Chrome 对 oklch()/color-mix() 等现代色彩会回读成
	// `color(srgb 0.07 0.08 0.11 / 0.6)`——分量是 0~1 浮点，不是 0~255。
	const scale = color.startsWith("color(") && color.includes("srgb") ? 255 : 1;
	const [r, g, b] = nums.slice(0, 3).map((v) => v * scale);
	const a = nums.length >= 4 ? nums[3] : 1;
	if ([r, g, b, a].some((v) => !Number.isFinite(v))) return null;
	return { r, g, b, a };
}

/** src 叠在 dst 上（正常混合），返回不透明结果。 */
function blend(dst: { r: number; g: number; b: number }, src: Rgba): { r: number; g: number; b: number } {
	return {
		r: src.r * src.a + dst.r * (1 - src.a),
		g: src.g * src.a + dst.g * (1 - src.a),
		b: src.b * src.a + dst.b * (1 - src.a),
	};
}

/**
 * 桌面壳（WCO）下把当前顶栏背景色同步给系统按钮条（右上角 min/max/close）。
 * 主题切换、初次进主界面时调用；浏览器与旧版壳（无该方法）静默跳过。
 *
 * 取色：`.topbar` 叠在 `body` 上逐层合成（两者常是半透明色，壁纸主题下尤其），
 * 最底层仍透明时垫深色默认底——WCO overlay 不接受 alpha。符号色按亮度选深/浅。
 */
export function syncTitlebarOverlay(): void {
	if (!isDesktopShell()) return;
	const api = (window as unknown as DesktopShellWindow).piDesktop;
	if (typeof api?.setTitleBarOverlay !== "function") return;
	const layers: Rgba[] = [];
	for (const selector of [".topbar", "body"]) {
		const el = document.querySelector(selector);
		if (!el) continue;
		const rgb = parseColor(getComputedStyle(el).backgroundColor);
		if (rgb && rgb.a > 0) layers.push(rgb);
	}
	if (layers.length === 0) return;
	// layers[0] 是顶层（topbar），末尾是最底层（body）
	let base = blend({ r: 26, g: 27, b: 30 }, layers[layers.length - 1]);
	for (let i = layers.length - 2; i >= 0; i--) base = blend(base, layers[i]);
	const { r, g, b } = base;
	const channel = (v: number) =>
		Math.round(Math.min(255, Math.max(0, v)))
			.toString(16)
			.padStart(2, "0");
	const hex = `#${channel(r)}${channel(g)}${channel(b)}`;
	const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	void api.setTitleBarOverlay(hex, luminance > 140 ? "#26262b" : "#e4e4e7");
}
