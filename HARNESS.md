# 本机 DeepSeek Harness

工具适配修复：Harness 参数 DSL 不接受 JSON Schema 的 `minimum`、`maximum`、`maxItems` 等限制关键字，注册前需转换为说明文字；运行时限制仍由业务工具校验。模型请求发出前检查完整工具列表，缺失即报错；工具执行状态记录为 `harness-tool`，不能仅凭接管启动日志认定工具可用。测试覆盖完整社交工具注册及“查询→模拟发送→回执”，并已用真实模型完成该流程，未发送真实群消息。修改代码后需重新启动大肥鱼。

已安装官方 npm 包 `@deepseek-ai/dsh@0.2.1-rc.2`，独立于大肥鱼的依赖。

- 双击 `start-harness.cmd` 启动 Web 版，默认打开浏览器。
- 地址为 `http://127.0.0.1:3080`，请使用启动终端打印的带认证参数的链接，不要公开分享该链接。
- 如果已有实例占用 3080，不要重复启动；关闭原进程后再启动。
- 安装目录：`harness-runtime/`；配置与会话：`harness-runtime/home/`。整个目录均被 Git 忽略。
- 从独立目录启动，避免读取大肥鱼根目录中与 Harness 格式不兼容的 `.env`。

大肥鱼现已接入 Harness：`start.cmd` 自动启动专用 SDK 进程，沿用本项目 `.env` 中的模型配置及 `data/state.json` 中的聊天历史。`config.json` 的 `runtime` 为 `harness`；改为 `direct` 并重启可回退。

Web UI 与大肥鱼 SDK 是两个入口，共用 `harness-runtime/home` 中的持久化目录。Web UI 中的新手工会话仍需在 Settings → Models 配置模型、Choose workspace 选择工作目录。SDK 自己运行无需 Web UI 常驻，不需要重复启动后台任务。

QQ/B站收发和定时器由本项目负责，所有模型推理、识图及工具循环交给 Harness。工具插件仅提供已有社交能力；保留会话允许范围、每小时额度与去重机制，不开放通用终端或文件工具给社交消息。SDK 轨迹保存在 `harness-runtime/home/sessions`，对应 ID 记入 `data/actions.jsonl`。

接管验证：37 项测试通过，包括实际 Harness SDK 循环调用模拟社交工具；真实模型文字连接成功，生成的 128×128 红色色块识别正确。没有为了验收而发送社交测试消息。

官方说明：https://github.com/deepseek-ai/deepseek-harness
