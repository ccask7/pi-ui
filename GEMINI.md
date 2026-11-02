# GEMINI.md

本仓库是 **Ccui 的自用 fork**（基于上游 pi-web-ui v0.95.0，源码级改动；不向上游提交、不发布 npm）。
常驻开发规则见 **[`AGENTS.md`](AGENTS.md)**；完整项目指南与历史坑见 **`docs/project-guide.md`**。动手前阅读 `AGENTS.md`，再按其 §4 索引查阅任务相关文档。

速览：

- 运行：`npm ci && npm run build && node bin/ccui.mjs`（`npm run dev` 起开发态：服务 `:8788` + Vite `:5173`）
- 提交前：`npm run format:check`、`npm run lint`、`npm run typecheck`、`npm test`、`npm run check:protocol`、`npm run build`
- 协议单源：新增 wire 消息只改 `server/protocol.ts`，`server/index.ts` 与 `web/src/use-chat.ts` 两端都要加分支
- 上游已被删掉（别再找）：DSH 第二引擎、插件市场与远程安装、自更新、语言包/busybox 在线下载、系统服务自启；Electron 桌面壳已加回 `desktop/`
- 沟通与提交信息用中文；删除类操作、改全局配置、动 `~/.pi-web` 数据前先确认
