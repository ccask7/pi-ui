# Antigravity-Manager 反代接入

[Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager) 是本机 8045
端口的协议反代：把 Google / Anthropic 的 Web Session 转成标准 API。ccui
把它当成普通的自定义服务商来接——三步通：

1. 顶栏模型下拉 →「⚙ 管理模型」→「新增服务商」
2. 点「填入 Antigravity（OpenAI 通道）」，粘贴反代的 API Key
   （Docker 启动时的 `API_KEY`；桌面版在「API 反代」页查看）
3. 点「自动获取模型列表」→「保存」，即时生效（写 `models.json` + 热重载）

## 双通道

一条自定义供应商记录一次只能有一种 `api` 类型，所以有两个模板：

| 通道                       | 模板按钮                           | `api`                | `baseUrl`                             | 对应反代接口                                      |
| -------------------------- | ---------------------------------- | -------------------- | ------------------------------------- | ------------------------------------------------- |
| OpenAI（推荐先配）         | 填入 Antigravity（OpenAI 通道）    | `openai-completions` | `http://127.0.0.1:8045/v1`            | `POST /v1/chat/completions`、`GET /v1/models`     |
| Anthropic（Claude 全功能） | 填入 Antigravity（Anthropic 通道） | `anthropic-messages` | `http://127.0.0.1:8045`（不带 `/v1`） | `POST /v1/messages`（Tool Use + Thinking 全支持） |

两个通道可共存（供应商 ID 分别为 `antigravity` /
`antigravity-anthropic`，已存在时自动加 `-2` 后缀，不覆盖）。

## 原理与注意事项

- 反代鉴权是 `Authorization: Bearer <API_KEY>`（同时认 `x-api-key` /
  `x-goog-api-key`），模板把「自动添加 Authorization 请求头」保持开启即可。
- `GET /v1/models` 返回标准 OpenAI 格式 `{ data: [{ id }] }`，只有 id
  没有其他元数据——「自动获取」建行后，名字含 `thinking` 的会自动勾选推理
  （全局规则，见下），上下文长度 / 识图按需手补。

> **全局规则**：自动获取解析模型 id 时含 `thinking`（忽略大小写）即勾选推理，
> 适用于所有自定义供应商（Ollama / vLLM / 各类代理）。只增不减：误伤时取消勾选即可
> （下次刷新/获取对该 id 会再次补勾，以端点元数据和手填为准管理即可）。

- 模板永远不碰已填的 API Key；`providerId` 为空时才填，不会覆盖已有手写 ID。
- 反代改了端口（非默认 8045）时，把填好的 `baseUrl` 中的端口改一下即可，
  其余不动。
