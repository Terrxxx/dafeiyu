# 本地开发

后端使用 Node.js 24 或更新版本，Web 管理面板使用 React 和 Vite。在项目根目录安装依赖、运行测试并构建前端。

~~~sh
npm ci
npm ci --prefix frontend
npm test
npm run build:web
~~~

Windows PowerShell 可以调用 `npm.cmd`。`npm start` 启动多用户账户服务，完整的 QQ 容器与后台运行环境依赖部署服务。`npm run dev:web` 启动前端开发服务器。Harness 的依赖独立放在 `harness-runtime/`，相关集成测试会根据该依赖是否安装决定是否执行。 [部署说明](deployment.md)

开发时可参考 [配置示例](../config.example.json)、[环境变量示例](../.env.example) 和 [默认人格提示词](../persona.md)。实际 API Key、登录凭据和运行数据应保存在 Git 忽略的本地配置与数据目录内。

## 维护记录

- [界面规范与历史调整](archive/UI-DESIGN.md)
- [管理面板与自主能力更新](archive/FEATURES-20261028.md)
- [旧版 README](archive/legacy-readme.md)
