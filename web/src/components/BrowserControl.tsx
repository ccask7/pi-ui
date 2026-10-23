import { useRef, useState } from "react";
import { useT } from "../i18n";
import { openExtensionOptions, pageCitation, useBrowserControl, type BrowserControlPage } from "../browser-control";
import { composeToComposer } from "../composer-bridge";

/**
 * 「浏览器操作」（page-picker 扩展 / `browser_page` 工具）在设置 → 插件 页里的区块。
 *
 * 原先它是顶栏右侧的一个芯片 + 弹窗（能力的发现入口：告诉你扩展在不在、授权了几个
 * 页面、怎么开通、能干什么）。顶栏精简后整体搬进设置，内容是同一套：状态 → 未就绪时
 * 的安装步骤 → 已授权页面列表（可「引用到对话」）→ 可照抄的例子 → 打开扩展设置页。
 *
 * 授权本身仍不在这里做：`permissions.request` 要用户手势，网页点击给不了 —— 只能把
 * 人送到扩展设置页那一次点击。
 */
export function BrowserControlSettings() {
	const t = useT();
	const { status, refresh } = useBrowserControl();
	const [busy, setBusy] = useState(false);
	/** 引用后的轻提示（引用不跳转，得让用户知道东西去哪儿了）。 */
	const [flash, setFlash] = useState<string | null>(null);
	const flashTimer = useRef<number | null>(null);
	const pages = status?.pages ?? [];

	const say = (text: string): void => {
		setFlash(text);
		if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
		flashTimer.current = window.setTimeout(() => setFlash(null), 2600);
	};

	/** 引用一个已授权页面到输入框草稿（不发送，用户补一句话再发）。 */
	const cite = (page: BrowserControlPage): void => {
		const ok = composeToComposer({ attachments: [pageCitation(page)] });
		say(ok ? t("browserControlCited") : t("browserControlCiteFailed"));
	};

	const openOptions = async (): Promise<void> => {
		setBusy(true);
		try {
			const ok = await openExtensionOptions();
			if (!ok) refresh();
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<div className="set-note">{t("browserControlTip")}</div>

			{status === null && <div className="bc-note">{t("browserControlChecking")}</div>}
			{status?.available === false && <div className="bc-note warn">{t("browserControlOffline")}</div>}
			{status?.available === false && (
				<>
					<div className="bc-section">{t("browserControlInstall")}</div>
					<div className="bc-note">{t("browserControlInstallLead")}</div>
					<ol className="bc-steps">
						<li>{t("browserControlInstallStep1")}</li>
						<li>{t("browserControlInstallStep2")}</li>
						<li>{t("browserControlInstallStep3")}</li>
						<li>{t("browserControlInstallStep4")}</li>
					</ol>
				</>
			)}
			{status?.available === true && status.aiControl === false && (
				<div className="bc-note warn">{t("browserControlDisabled")}</div>
			)}
			{status?.available === true && pages.length === 0 && (
				<div className="bc-note warn">{t("browserControlEmpty")}</div>
			)}

			{pages.length > 0 && (
				<>
					<div className="bc-section">{t("browserControlPages")}</div>
					<ul className="bc-pages">
						{pages.map((page) => (
							<li key={page.origin}>
								<span className="bc-title" title={page.title}>
									{page.title}
								</span>
								<span className="bc-origin" title={page.origin}>
									{page.origin}
								</span>
								<span className={`bc-open${page.open ? " on" : ""}`}>
									{page.open ? t("browserControlPageOpen") : t("browserControlPageClosed")}
								</span>
								<button
									type="button"
									className="bc-cite"
									title={t("browserControlCiteTip", { name: page.title || page.origin })}
									onClick={() => cite(page)}
								>
									{t("browserControlCite")}
								</button>
							</li>
						))}
					</ul>
					<div className="bc-note">{t("browserControlCiteNote")}</div>
				</>
			)}

			<div className="bc-section">{t("browserControlExamples")}</div>
			<ul className="bc-examples">
				<li>{t("browserControlExample1")}</li>
				<li>{t("browserControlExample2")}</li>
			</ul>

			{flash && <div className="bc-note">{flash}</div>}
			<div className="bc-actions">
				<button type="button" className="btn primary" disabled={busy} onClick={() => void openOptions()}>
					{t("browserControlOpenOptions")}
				</button>
				<button type="button" className="btn" onClick={refresh}>
					{t("browserControlRefresh")}
				</button>
			</div>
		</>
	);
}
