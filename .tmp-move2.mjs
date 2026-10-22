import { readFileSync, writeFileSync } from "node:fs";
const P = "D:/AIagent/PI-WEB/app/web/src/components/SettingsModal.tsx";
const L = readFileSync(P, "utf8").split("\n");
const tabs = (s) => (s.match(/^\t+/) ?? [""])[0].length;

// 1) 定位要搬的两块：壁纸行前面的 <hr> … 面板透明度 set-row 收尾
const wallRow = L.findIndex((l, i) => l.includes('{t("wallpaperTitle")}') && i > 0);
if (wallRow < 0) throw new Error("wallpaperTitle not found");
const start = wallRow - 2; // <div className="set-row"> 与前面的 <hr>
if (L[start].trim() !== '<hr className="set-sep" />' || tabs(L[start]) !== 8) throw new Error("start not hr: " + L[start]);
if (L[start + 1].trim() !== '<div className="set-row">') throw new Error("start+1 not set-row");

const cmt = L.findIndex((l) => l.includes("--wallpaper-panel-alpha"));
if (cmt < 0) throw new Error("panel opacity comment not found");
let end = -1;
for (let i = cmt + 1; i < L.length; i++) {
	if (tabs(L[i]) === 8 && L[i].trim() === "</div>") {
		end = i;
		break;
	}
}
if (end < 0) throw new Error("end not found");
const block = L.slice(start, end + 1);

// 2) 删掉；剩下的两行应是 set-section 收尾 + display 条件收尾
const rest = [...L.slice(0, start), ...L.slice(end + 1)];
const closeIdx = start; // 即原 end+1 那一行被顶到 start
if (rest[closeIdx].trim() !== "</div>" || tabs(rest[closeIdx]) !== 7) throw new Error("set-section close mismatch: " + rest[closeIdx]);
if (rest[closeIdx + 1].trim() !== ")}" || tabs(rest[closeIdx + 1]) !== 6) throw new Error("display close mismatch: " + rest[closeIdx + 1]);

// 3) 在 display 块之后插入新的「界面设置」区块（搬来的两块缩进不变）
const appearance = [
	"",
	"\t\t\t\t\t\t{/* ---- 界面设置（外观）：聊天背景图 + 面板透明度 ------------------- */}",
	'\t\t\t\t\t\t{tab === "appearance" && (',
	'\t\t\t\t\t\t\t<div className="set-section">',
	'\t\t\t\t\t\t\t\t<div className="set-section-title">',
	'\t\t\t\t\t\t\t\t\t<FiImage className="set-section-icon" />',
	'\t\t\t\t\t\t\t\t\t{t("settingsAppearance")}',
	"\t\t\t\t\t\t\t\t</div>",
	...block,
	"\t\t\t\t\t\t\t</div>",
	"\t\t\t\t\t\t)}",
];
const out = [...rest.slice(0, closeIdx + 2), ...appearance, ...rest.slice(closeIdx + 2)];
writeFileSync(P, out.join("\n"));
console.log(`moved lines ${start + 1}-${end + 1} (${block.length} lines) into new appearance tab`);
