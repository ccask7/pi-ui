import { useEffect, useState } from "react";
import { FiCheck, FiRefreshCw, FiTrash2 } from "react-icons/fi";
import { unregisterLocale, useI18n, useT, type LocalePackStatus } from "../i18n";
import { appUrl } from "../base-url";
import { withToken } from "../auth-token";

/**
 * 语言 + 语言包管理（设置 → 通用）。
 *
 * 原来是顶栏「语言」下拉（切换语言 + 「获取更多语言」）+ 一个独立弹窗（语言包列表/
 * 删除/刷新）。两处都收进设置页：语言是「设一次就不动」的配置，放顶栏既占宽又不常点。
 *
 * 语言列表 = 内置 zh/en + 已安装的包（`useI18n().packs`，包安装/删除后会自动刷新）；
 * 语言包状态走 `/api/locales`（服务端扫 `<dataDir>/locales`），手工丢进去的 JSON 也认。
 */
export function LanguageSettings() {
	const t = useT();
	const { locale, setLocale, packs, reloadPacks } = useI18n();
	const [status, setStatus] = useState<LocalePackStatus[] | null>(null);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState("");

	async function load() {
		try {
			const res = await fetch(withToken(appUrl("/api/locales")));
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { packs: LocalePackStatus[] };
			setStatus(data.packs ?? []);
			setError("");
		} catch (e) {
			setError(t("localeListFailed", { error: e instanceof Error ? e.message : String(e) }));
		}
	}

	useEffect(() => {
		void load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function remove(code: string) {
		setBusy(code);
		setError("");
		try {
			const res = await fetch(withToken(appUrl(`/api/locales/${code}`)), { method: "DELETE" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			unregisterLocale(code);
			if (locale === code) setLocale("zh");
			await reloadPacks();
			await load();
		} catch (e) {
			setError(t("localeInstallFailed", { error: e instanceof Error ? e.message : String(e) }));
		} finally {
			setBusy("");
		}
	}

	/** 已安装的包才有版本号；内置 zh/en 没有包状态，永远可选。 */
	const installedByCode = new Map((status ?? []).filter((p) => p.installed).map((p) => [p.code, p]));

	return (
		<>
			<div className="set-note">{t("languageHint")}</div>
			<div className="set-list">
				{packs.map((l) => {
					const active = locale === l.code;
					const pack = installedByCode.get(l.code);
					return (
						<div key={l.code} className={`set-row${active ? " active" : ""}`}>
							<div className="set-row-info">
								<div className="set-row-name">
									{l.nativeName} <span className="set-row-desc">{l.code}</span>
									{pack?.version ? <span className="set-row-desc">v{pack.version}</span> : null}
								</div>
							</div>
							{active ? (
								<span className="set-locale-current">
									<FiCheck /> {t("localeCurrent")}
								</span>
							) : (
								<button type="button" className="btn" onClick={() => setLocale(l.code)}>
									{t("localeSwitch")}
								</button>
							)}
						</div>
					);
				})}
			</div>

			<div className="set-section-title" style={{ marginTop: 14 }}>
				{t("localePacks")}
			</div>
			<div className="set-note">{t("localeRemoveHint")}</div>
			{error && <div className="set-empty">{error}</div>}
			{status === null && !error ? (
				<div className="set-empty">{t("loading")}</div>
			) : (
				<div className="set-list">
					{(status ?? []).map((p) => {
						const working = busy === p.code;
						return (
							<div key={p.code} className="set-row">
								<div className="set-row-info">
									<div className="set-row-name">
										{p.nativeName}
										{p.installed && p.version ? <span className="set-row-desc">v{p.version}</span> : null}
									</div>
									<div className="set-row-desc">
										{p.code} · {p.installed ? t("localeInstalled") : t("localeGetMore")}
									</div>
								</div>
								{p.installed && (
									<button
										type="button"
										className="btn set-uninstall"
										disabled={working}
										title={t("localeRemove")}
										onClick={() => void remove(p.code)}
									>
										<FiTrash2 />
										<span>{working ? t("localeRemoving") : t("localeRemove")}</span>
									</button>
								)}
							</div>
						);
					})}
				</div>
			)}
			<button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => void load()}>
				<FiRefreshCw />
				<span>{t("bgTaskRefresh")}</span>
			</button>
		</>
	);
}
