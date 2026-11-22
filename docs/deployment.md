# 部署自己的麻将牌桌

本示例没有绑定任何现有服务器。请替换下面的路径和域名，并使用自己的账号与数据库。

1. 安装 Node.js 24、pnpm 10.34.9，执行 `pnpm install --frozen-lockfile` 和 `pnpm build`。
2. 将 `.env.example` 复制为 `.env`，设置 `NODE_ENV=production`、`WEB_ORIGIN=https://mahjong.example.com`，并把 `DATABASE_PATH` 指向持久目录的绝对路径。数据库目录应只对服务用户可写。
3. 执行 `pnpm db:migrate`。迁移通过后执行 `pnpm start`，或用进程管理器（如 systemd）长期运行后端。后端默认只监听 127.0.0.1:3020。只运行一个后端进程：计时器与“开着页面”的心跳都在进程内存中。
4. 用 Caddy 等反向代理提供 HTTPS，静态根目录指向 apps/web/dist，并将 /api/* 转发给后端。示例配置见 Caddyfile.example。将域名解析到自己的服务器，并放通公开 HTTP/HTTPS 端口。
5. 验证 /api/health、注册登录退出、四个账号建房/加入/准备开局、出牌与吃碰胡、刷新恢复、超时托管与「我回来了」。生产 HTTP 会关闭账号写入及好友接口；不要绕过此限制。

升级前用 SQLite 在线备份功能备份数据库，并保留旧程序。不要上传数据库、.env 或会话 Cookie 到 GitHub。

页面采用 HTTP 定时同步，不依赖 WebSocket。部署环境需把 Cookie、Origin 请求头正常转发，WEB_ORIGIN 必须与浏览器访问地址一致。
