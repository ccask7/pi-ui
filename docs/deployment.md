# 部署

ccui 是纯 Web 服务（Node + Express + WebSocket）。需要“独立窗口”体验时，用浏览器自带的“安装为应用”（PWA：包里自带 `manifest.webmanifest` 与 `sw.js`）。

## CLI

```bash
ccui [--port 9000] [--cwd /path] [--data-dir DIR] [--host ADDR] [--agent-dir DIR] [--no-browser]
```

本 fork 只保留**前台启动**：`bin/ccui.mjs` 解析上面的 flag（也接受同名环境变量，
flag 优先），然后直接加载 `dist/server/index.js`。启动后 Ctrl-C 退出。

```bash
ccui --port 9000 --cwd /path/to/project   # 前台运行
node dist/server/index.js                      # 等价（直接跑构建产物）
```

> 上游原有的 `pi-web-ui install / plugins / server install|start|stop|restart|status|
> quiesce|unquiesce|shortcut / upgrade-sdk` 等子命令在本 fork 中已删除：本仓库不写
> launchd/systemd/Windows 计划任务、不托管后台服务、不下载远端插件。

## 当成自己的服务跑

本 fork 不做服务托管，但你可以用系统自带的方式把它拉起来（重启后需要它自己回来时）：

```ini
# /etc/systemd/system/ccui.service
[Unit]
Description=ccui
After=network.target
[Service]
Type=simple
User=you
WorkingDirectory=/home/you/projects
ExecStart=/usr/bin/env node /path/to/ccui/bin/ccui.mjs --port 8787 --cwd /home/you/projects
Restart=always
Environment=PI_WEB_TOKEN=s3cret
[Install]
WantedBy=default.target
```

```xml
<!-- ~/Library/LaunchAgents/com.example.ccui.plist（macOS，自己起个 label） -->
<key>ProgramArguments</key>
<array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/ccui/bin/ccui.mjs</string>
    <string>--port</string><string>8787</string>
</array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
```

Windows 可以用 `nssm`、任务计划程序，或自己的 `while ($true) { node …; Start-Sleep 10 }`
看门狗脚本 —— 这些都由你决定，ccui 本身不再生成任何自启资产。

`PI_WEB_TOKEN` 只能通过环境变量给（没有命令行 flag），别把它写进仓库或命令历史。
环境变量不是秘密存储：systemd 的管理接口及服务进程仍可能暴露环境。
监听 `0.0.0.0` 前请确认网络访问范围；公网部署应使用 TLS 反代，HTTP 本身不加密口令。


## 子路径反代（nginx 挂在 /pi/ 等路径下）

页面挂在 `https://example.com/pi/` 而非根路径时，nginx 需要**剥离前缀**转发。
浏览器侧会自动从页面 baseURI 推导应用根（/pi/），插件 bundle、WebSocket、
`/api`、`/themes` 全部请求都会带上 `/pi/` 前缀，因此只需一条转发规则，无需
额外配置：

```nginx
server {
    listen 80;
    server_name example.com;

    # 关键是 proxy_pass 末尾的 /：剥离 /pi 前缀后透传给后端（8787 为默认端口）
    location /pi/ {
        proxy_pass http://127.0.0.1:8787/;
        proxy_http_version 1.1;
        # WebSocket 升级头必须透传
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        # 保持 Host/Origin 一致（服务端同源校验依赖它）
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

注意：

- 官方 dist 的静态资源是根绝对路径（`/assets/...`），与 JS 里的应用根推导无关。
  要让 HTML 在 /pi/ 下渲染，二选一：① 另加一条 `location /assets/ { proxy_pass
  http://127.0.0.1:8787; }` 转发静态资源；② 用 `vite build --base=/pi/` 重新构建
  （产物里 assets 引用与 `import.meta.env.BASE_URL` 均为 /pi/，与 baseURI 推导
  结果一致，两种方式可混用）。
- 插件目录（`<dataDir>/plugins/`）不需要在 nginx 单独配置——客户端请求
  `/pi/plugins/...`，剥离前缀后由后端标准路由处理。
