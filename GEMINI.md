# GEMINI.md

本仓库是 **Ccui 的自用 fork**（基于上游 pi-web-ui v0.95.0，源码级改动；不向上游提交、不发布 npm）。
完整项目指南见 **[`AGENTS.md`](AGENTS.md)**，动手前至少读它的 §1「相对上游删掉了什么」、§5「开发工作流」、§9「常见坑」。

速览：

- 运行：`npm ci && npm run build && node bin/ccui.mjs`（`npm run dev` 起开发态：服务 `:8788` + Vite `:5173`）
- 提交前：`npm run format:check`、`npm run lint`、`npm run typecheck`、`npm test`、`npm run check:protocol`、`npm run build`
- 协议单源：新增 wire 消息只改 `server/protocol.ts`，`server/index.ts` 与 `web/src/use-chat.ts` 两端都要加分支
- 上游已被删掉（别再找）：Electron 桌面壳、DSH 第二引擎、插件市场与远程安装、自更新、语言包/busybox 在线下载、系统服务自启
- 沟通与提交信息用中文；删除类操作、改全局配置、动 `~/.pi-web` 数据前先确认
