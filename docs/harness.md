# Harness 与模型

大肥鱼通过 DeepSeek Harness 执行模型请求和工具调用。QQ、B 站、定时任务及权限校验由项目处理。独立的 Harness Web UI 可以用于手动调试，托管的大肥鱼通过 SDK 运行。

## 模型供应商

在「密钥与安全 → 模型凭据」选择供应商，填写相应的 API Key。保存后重新启动大肥鱼。

默认供应商为 DeepSeek。自定义供应商须支持 OpenAI 兼容的 Chat Completions 接口和流式响应。只填 HTTPS 域名时，程序会请求 `/v1/chat/completions`。供应商使用其他前缀时，请填 API 基址或完整的 Chat Completions 端点。

- DeepSeek 余额在控制台显示。余额不足时程序会停止实例，充值后可重新启动。
- 选择自定义供应商会暂停每日 Token 与费用限额，余额可到供应商后台查看。切回 DeepSeek 后恢复之前保存的限额。
- 费用估算覆盖有可用单价和用量的请求。供应商响应和用量可在后台日志核对。

## 排查

- 启动日志出现 Harness 接管时，可进一步检查后续模型请求和工具回执。
- 提示没有返回流式响应时，核对 API URL 和所选模型的流式支持。
- QQ 或 B 站动作失败时，先检查账号登录、能力组件、权限和平台回执。

[早期本机 Harness 调试记录](archive/HARNESS.md)
