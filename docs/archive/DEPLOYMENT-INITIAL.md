# 服务器 部署记录

- 服务器：`192.168.1.149`，Debian 13 amd64
- 项目目录：`/opt/dafeiyu/`
- 管理面板：<http://192.168.1.149:3081/>
- NapCat：<http://192.168.1.149:6099/webui/>
- 登录凭据：服务器 `/opt/dafeiyu/deploy/server-access.txt`；电脑 `reports/migration-20261027/server-access.txt`，不提交 Git

大肥鱼使用专用 `dafeiyu` 用户和 systemd 服务；NapCat 使用独立容器 `dafeiyu-napcat`，QQ、配置、插件和日志持久化在 `napcat/`。两者均配置开机恢复。OneBot 仅监听本机；内网管理入口经 Nginx 密码认证，保留应用的来源检查。

```sh
sudo systemctl status dafeiyu
sudo systemctl restart dafeiyu
sudo journalctl -u dafeiyu -f
cd /opt/dafeiyu && sudo docker compose ps
```

面板中的“停止/启动”控制社交后台，面板本身保持可用。`systemctl stop dafeiyu` 会连面板一起关闭。电脑原目录保留，但不要与 服务器 同时运行 `start.cmd`，以免双实例收发和记忆分叉。

## 数据与验收

原项目完整备份和部署包同时保存在电脑 `reports/migration-20261027/` 与服务器 `backups/migration-20261027/`。

- `source-full.tar.gz`：包含 Windows 依赖、NapCat 原配置等全部原项目文件
- `deploy-payload.tar.gz`：原始可迁移源码、配置、密钥、业务数据、模型和 Harness 会话
- `source-manifest.json`、`verification.json`：8,417 个文件 SHA256 全部匹配，零差异
- `final-check.json`：管理入口、认证、来源保护与用户记忆检查
- `linux-tests.log`：服务器 上 42 项回归通过

原有 29 位用户资料已保留。声音仍使用 Kokoro `zf_017`，Linux 实测 24000 Hz；Chromium、真实 Harness SDK/模型和 B站登录均已通过验收。Windows 依赖没有当作 Linux 依赖运行，原件完整保留在备份中。浏览器路径设为 `/usr/bin/chromium`；Windows 专属桌面组件在 服务器 上关闭。

活跃数据位于 `data/`，Harness 会话及附件位于 `harness-runtime/home/`。服务器特有的端口、浏览器和认证配置在初次部署时生成，原 `.env` 与配置同时保留在迁移备份中。源码更新后需同步到 服务器 并重启服务，本地修改不会自动发布。

回迁前先停止服务器后台并备份 **服务器 最新数据**，再回迁 `data/`、配置及 Harness 会话；不能直接用迁移前电脑快照代替服务器后来产生的记忆。恢复时应先恢复到新目录核验，保留现有目录与备份，确认只有一个实例运行。
