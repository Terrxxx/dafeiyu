# 部署与运维

生产环境由账户和管理服务、容器管理服务，以及每位用户独立的 NapCat 和大肥鱼容器组成。管理服务由 systemd 运行，Web 入口通过 Nginx 反向代理。前端构建方式见 [本地开发](development.md)。

| 项目 | 位置 |
| --- | --- |
| 站点管理服务 | [dafeiyu-manager.service](../deploy/dafeiyu-manager.service) |
| 容器管理服务 | [dafeiyu-runtime.service](../deploy/dafeiyu-runtime.service) |
| 大肥鱼容器镜像 | [Dockerfile.agent](../deploy/Dockerfile.agent) |
| Nginx 入口 | [内网配置](../deploy/nginx-multiuser.conf)、[公网示例](../deploy/nginx-public.example.conf) |

配置公网 HTTPS 时，同时对齐 Nginx 域名与站点允许的来源，保留原始 Host 与 HTTPS 协议信息。NapCat WebUI、内部管理服务端口和 Docker socket 应保持在内网或本机。配置 SMTP 后可在站点后台测试发信。 [邮件模板](archive/MAIL-TEMPLATE.md)

## 数据和备份

现有 NAS 部署位于 `/opt/dafeiyu/`。各实例的数据放在 `data/{username}/`，站点账户数据库和加密主密钥放在 `data/.platform/`。备份应包含整个 `data/`，并保存对应代码版本与部署配置。制作一致性备份前应暂停服务及写入数据的用户容器。恢复时核对文件权限、数据库和凭据，再启动服务。

~~~sh
systemctl status dafeiyu-manager dafeiyu-runtime
journalctl -u dafeiyu-manager -u dafeiyu-runtime -n 100 --no-pager
~~~

- [多用户部署与迁移记录](archive/MULTIUSER.md)
- [旧版 NAS 部署记录](archive/DEPLOYMENT.md)
- [初次部署记录](archive/DEPLOYMENT-INITIAL.md)
- [QQ 网络出口记录](archive/QQ-EGRESS.md)
