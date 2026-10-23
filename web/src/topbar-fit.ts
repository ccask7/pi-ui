/**
 * 顶栏窄屏的「固定位」名单。
 *
 * 历史：本文件原来还放着 `fitTopbar` / `sortOverflowMenuItems` 与 `TopbarFitItem`
 * ——「实测宽度放不下的条目退进 ⋯ 溢出菜单」那套纯函数。顶栏精简后「⋯」溢出菜单
 * 整体删除（声音/语言/主题/版本号/浏览器操作都搬进设置，插件菜单与「新对话」也删了），
 * 空间不够时的出口改成 `.topbar-flow` 横向滚动，于是那套测量/丢弃逻辑一并消失。
 *
 * 只剩这一张名单：手机端把它列出的条目移出横向滚动的直流、钉在整条最右（📁 文件列表）。
 */

/** 手机端钉在整条最右边的固定位：目前只有 📁 文件列表开关（见 TopBar 的 mobileAsideItems）。 */
export const MOBILE_ASIDE_TOPBAR_IDS: ReadonlySet<string> = new Set(["host:files"]);
