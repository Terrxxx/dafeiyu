# 大肥鱼统一网络出口

QQ 与 agent 容器的互联网 IPv4 TCP 流量统一通过 dfyqq0 → 服务器 127.0.0.1:11080 OpenSSH SOCKS → 公网服务器106.52.17.21。包含 QQ 登录/消息、QQ空间（含账号Cookie）、图片与头像下载、浏览器、B站、天气、网店和模型API。管理网站进程及服务器其他服务未改默认路由/DNS。代理仅监听服务器回环，不开放公共代理端口。

## DNS

独立 dnscrypt-proxy 2.1.8 监听198.18.78.1:53，只允许四个现有受管地址和未来动态登记的QQ/agent地址。使用官方静态 AliDNS DoH 解析器印章，经同一SSH代理发送加密DNS；force_tcp开启、HTTP3关闭、系统DNS忽略、bootstrap_resolvers为空、网络直连探测关闭。独立UID的OUTPUT防火墙只允许连接127.0.0.1:11080及向受管容器返回DNS回复，无法直接访问外网DNS。未开启查询日志。

所有新QQ和agent容器显式配置 --dns198.18.78.1。Docker127.0.0.11仍处理本实例内部容器名称，但外部域名只交给独立DNS；不存在家庭DNS备用项。受管源地址的UDP/TCP53硬编码查询也被DNAT到该DNS，包含指向家庭路由器的查询。

## 隔离与故障

表10078按固定容器源地址选择TUN出口，保留 prohibit default，故障不回落家庭出口。其余外网UDP/未代理协议拒绝。各自QQ-agent网络、本实例网关和专用DNS保留；其他私有网段、链路本地与多播探测被拒绝，容器无法通过家庭路由器UPnP等路径发现家庭公网地址。Docker网络IPv6禁用。

服务 dafeiyu-qq-guard 在Docker启动前载入受管地址防泄漏规则；dafeiyu-qq-routing持续协调规则；runtime helper在创建/启动容器前登记地址。QQ用网关+1、agent用网关+2。dafeiyu-dns依赖TUN和SSH，runtime helper依赖DNS与路由服务。服务自动重启。现有QQ设备网络标识保存在root私有 /var/lib/dafeiyu-qq-egress/devices.json。

## 验证

两个QQ与两个agent网络命名空间均实测出口106.52.17.21；两个agent内Node fetch及真实Chromium页面均验证出口一致。匿名QQ空间HTTP302、公共头像HTTP200、无凭据模型接口HTTP401，验证HTTPS传输正常，未通过测试点赞/发帖/评论或调用计费模型。

四个容器向家庭路由器DNS地址查询也由专用DNS成功解析。实际停止SSH代理后，四个容器的新HTTP请求全部失败，新域名DNS查询超时；恢复SSH后新请求及DNS恢复。两个QQ online/good，两个agent正在运行且OneBot连接建立；公网管理页HTTP200。服务定义、Python脚本及Node helper语法检查通过。

操作前的完整用户目录、账号数据库、原容器定义、原helper和路由程序存于 /opt/dafeiyu/backups/full-egress-20261028/，目录权限700。原容器保留为 dfy-before-egress-*，已停止、关闭自动重启并断开网络；不得同时启动这些备份容器与现有实例，以免共同写用户数据。原记忆用户集合保留，config.json与persona.md与停写快照逐字节一致。

网络中转不等于匿名或不可追溯：腾讯既往登录记录、代理服务器/运营商记录、账号/设备关联仍不由本配置消除。
