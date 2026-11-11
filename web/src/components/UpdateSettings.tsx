import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiDownload, FiExternalLink, FiRefreshCw } from "react-icons/fi";
import type { DesktopShellWindow, DesktopUpdateRelease, DesktopUpdater } from "../desktop";
import { useT } from "../i18n";

type UpdatePhase = "idle" | "checking" | "latest" | "available" | "downloading" | "ready";

export function UpdateSettings({ appVersion }: { appVersion: string | null | undefined }) {
	const t = useT();
	const api = (window as unknown as DesktopShellWindow).piDesktop?.updater;
	const [supported, setSupported] = useState(false);
	const [phase, setPhase] = useState<UpdatePhase>("idle");
	const [release, setRelease] = useState<DesktopUpdateRelease | null>(null);
	const [progress, setProgress] = useState<number | null>(null);
	const [error, setError] = useState("");
	const phaseRef = useRef(phase);
	phaseRef.current = phase;

	useEffect(() => {
		if (!api) return;
		let active = true;
		void api.getInfo().then((info) => {
			if (active) setSupported(info.supported);
		});
		return () => {
			active = false;
		};
	}, [api]);

	useEffect(() => {
		if (!api) return;
		return api.onProgress((percent) => {
			if (phaseRef.current === "downloading") setProgress(percent);
		});
	}, [api]);

	const check = async (updater: DesktopUpdater) => {
		setPhase("checking");
		setError("");
		try {
			const result = await updater.check();
			if (result.status === "available") {
				setRelease(result.release);
				setProgress(null);
				setPhase("available");
			} else if (result.status === "latest") {
				setPhase("latest");
			} else if (result.status === "unsupported") {
				setSupported(false);
				setPhase("idle");
			} else {
				setError(result.message);
				setPhase("idle");
			}
		} catch (cause) {
			setError((cause as Error).message);
			setPhase("idle");
		}
	};

	const download = async () => {
		if (!api) return;
		setPhase("downloading");
		setProgress(null);
		setError("");
		const result = await api.download();
		if (result.status === "ready") setPhase("ready");
		else if (result.status === "cancelled") {
			setRelease(null);
			setPhase("idle");
		} else {
			setError(result.message || t("updateFailed"));
			setPhase("available");
		}
	};

	const install = async () => {
		if (!api) return;
		setError("");
		const installError = await api.install();
		if (installError) setError(installError);
	};

	return (
		<div className="set-section update-settings">
			<div className="set-section-title">
				<FiDownload className="set-section-icon" />
				{t("softwareUpdate")}
			</div>
			<div className="set-row update-settings-row">
				<div>
					<div className="set-label">Cc v{appVersion ?? "…"}</div>
					<div className="set-description">{supported ? t("updateManualHint") : t("updateDesktopOnly")}</div>
				</div>
				<button
					type="button"
					className="set-btn-mini update-check-button"
					disabled={!supported || phase === "checking" || phase === "downloading"}
					onClick={() => api && void check(api)}
				>
					<FiRefreshCw className={phase === "checking" ? "spin" : ""} />
					{phase === "checking" ? t("checkingUpdates") : t("checkUpdates")}
				</button>
			</div>
			{phase === "latest" && <div className="set-note update-latest">{t("updateLatest")}</div>}
			{error && phase !== "available" && phase !== "ready" && <div className="set-note update-error">{error}</div>}
			{release &&
				(phase === "available" || phase === "downloading" || phase === "ready") &&
				createPortal(
					<div
						className="modal-backdrop update-overlay"
						role="presentation"
						onMouseDown={(event) => {
							if (event.target === event.currentTarget && phase !== "downloading") {
								setRelease(null);
								setPhase("idle");
							}
						}}
					>
						<div className="modal update-modal" role="dialog" aria-modal="true" aria-label={t("softwareUpdate")}>
							<div className="modal-title">
								{phase === "ready" ? t("updateReady") : t("updateAvailable", { version: release.version })}
							</div>
							<div className="update-version-line">
								Cc v{appVersion ?? "…"} → v{release.version}
							</div>
							{release.notes && <pre className="update-release-notes">{release.notes}</pre>}
							{phase === "downloading" && (
								<div className="update-progress">
									<progress max="100" value={progress ?? undefined} />
									<span>{progress === null ? t("updateDownloading") : `${t("updateDownloading")} ${progress}%`}</span>
								</div>
							)}
							{phase === "ready" && <p className="set-description">{t("updateReadyDesc")}</p>}
							{error && <div className="set-note update-error">{error}</div>}
							<div className="modal-actions update-actions">
								<a className="set-btn-mini" href={release.pageUrl} target="_blank" rel="noreferrer">
									<FiExternalLink /> {t("updateViewRelease")}
								</a>
								<span className="update-actions-spacer" />
								{phase === "available" && (
									<>
										<button
											type="button"
											className="set-btn-mini"
											onClick={() => {
												setRelease(null);
												setPhase("idle");
											}}
										>
											{t("cancel")}
										</button>
										<button type="button" className="set-btn-mini primary" onClick={() => void download()}>
											<FiDownload /> {t("updateNow")}
										</button>
									</>
								)}
								{phase === "downloading" && (
									<button type="button" className="set-btn-mini" onClick={() => void api?.cancel()}>
										{t("cancel")}
									</button>
								)}
								{phase === "ready" && (
									<>
										<button
											type="button"
											className="set-btn-mini"
											onClick={() => {
												setRelease(null);
												setPhase("idle");
											}}
										>
											{t("close")}
										</button>
										<button type="button" className="set-btn-mini primary" onClick={() => void install()}>
											{t("updateRestart")}
										</button>
									</>
								)}
							</div>
						</div>
					</div>,
					document.body,
				)}
		</div>
	);
}
