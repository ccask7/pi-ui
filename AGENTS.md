# AGENTS.md — Ccui 开发入口

> 本文件只保留常驻规则。完整目录、功能实现与历史坑见 `docs/project-guide.md`；不要默认通读文档或大源码，先用 `rg` 找相关章节、符号和引用，再局部读取。

## 1. 项目与边界

Ccui 是 pi coding agent SDK 的 Web 界面：React 19 + Vite 前端，Node + Express + `ws` 后端，进程内 pi SDK，xterm.js + node-pty 终端。

- 本仓是基于 pi-web-ui v0.95.0 的本地私有 fork；不向上游提交、不发布 npm。
- Node.js >= 22.19.0；数据目录 `~/.pi-web`，pi 会话仍在 `~/.pi/agent/sessions`。
- 主要入口：`server/index.ts`、`server/agent-service.ts`、`web/src/App.tsx`、`web/src/use-chat.ts`。
- 桌面壳在 `desktop/`；插件在 `plugins/`；测试在 `tests/`。

## 2. 修改方式

- 先明确任务和验收范围，只改相关模块；不要顺手重构、全仓审查或重复读取未变化的大文件。
- 小范围修改优先精确 `edit`；批量机械改写、二进制或编码场景才使用脚本，并检查 diff。
- 保留用户已有改动，不覆盖、回退或格式化无关文件。
- 行为或结构变化时同步相关文档；不要把新的实现细节和历史案例继续堆进本文件。

## 3. 不可违反的约定

- **协议单源**：新增/修改 wire 消息只改 `server/protocol.ts` 的类型定义，`web/src/types.ts` 保持 re-export shim；两端 dispatch/onmessage switch 同步处理。
- **i18n**：用户可见文案走 `useT()`；新增 key 同步 `zh`、`en` 和 `locales/*.json` 的 8 个语言包，顺序与 `zh` 对齐。文案 value 只用字符串字面量（可用 `+` 续行），修改后跑 `npm run i18n:diff`。
- **样式**：共享样式在 `web/src/styles.css`，按组件分区并使用已定义的 CSS 变量；主题是完整样式表。已刻意移除手机端适配，不新增移动端断点。
- **URL**：前端新增 `/ws`、`/api/*`、`/plugins/*`、`/themes/*` 地址必须用 `web/src/base-url.ts` 的 `appUrl()`。
- **Agent 工具**：新增可开关工具时同步 `server/tool-manager.ts` 目录、`server/agent-service.ts` 注册及 `tests/unit/tool-registration.test.ts` 工厂清单；不要把大内容放进 toolResult `details`。
- **安全**：不得绕过 loopback/Origin、工作区授权和插件权限边界；provider headers 不下发浏览器。
- **测试隔离**：测试端口 >= 8900、data-dir 用临时目录，只清理自己启动的 PID；禁止 `pkill -f` 等宽泛杀进程，禁止占用或清理全局 8787 服务。
- **Windows**：注意 CRLF、中文编码、路径与进程组差异；Playwright 的仓库根和 Chrome 探测沿用 `tests/lib/` 现有工具。

## 4. 按需文档

| 修改范围 | 先查 |
| --- | --- |
| 完整目录、功能说明、历史坑 | `docs/project-guide.md`（原完整 AGENTS 档案） |
| 开发、测试、提交规范 | `docs/development.md` |
| 快照、协议、安全、多对话、UI 桥 | `docs/architecture-core.md` |
| 插件、UI 扩展点、多根工作区 | `docs/architecture-plugins.md` |
| 附件、图片、上传与预览 | `docs/architecture-attachments.md` |
| 终端、PTY、SCM、终端接管 bash | `docs/architecture-terminal.md` |
| 系统提示词组装 | `docs/architecture-system-prompt.md` |
| 桌面壳与打包 | `desktop/README.md` |
| 部署与环境变量 | `docs/deployment.md`、`docs/env-vars.md` |

## 5. 常用命令与验证

在 `app/` 下执行：

```bash
npm run dev             # 后端 :8788 + 前端 :5173
npm run typecheck
npm run lint
npm run format:check    # 需要格式化时用 npm run format，但避免改写无关文件
npm test
npm run check:protocol  # 协议改动必跑
npm run test:smoke      # 按改动风险执行；协议/共享核心改动不要省略相关回归
npm run i18n:diff       # 文案改动必跑
```

迭代时先跑相关单测或协议测试；收尾按 `docs/development.md` 完成对应检查。测试输出只保留相关错误，完整日志可落临时文件后按需查看。

## 6. 提交与发布

- 正常分次提交，一次改动一个 commit，中文提交信息，不加 `Co-authored-by`；不为压缩历史而 amend/squash/force push。
- 打包、桌面安装包和推送由用户明确发起；不要自行运行 `desktop:dist`、`electron-builder` 或 `git push`。
- 服务运行时不要原地 build/install；相关黑屏、SDK 混装等处理见 `docs/project-guide.md` 常见坑。

_修改本文件后在 pi 中运行 `/reload`；详细规则变化同步更新对应文档。_
