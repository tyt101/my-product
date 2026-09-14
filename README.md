# 我的产品之路

公开阅读的个人产品博客，支持管理员创建主题、发布问答、编辑答案、删除题目及整个主题。

## 内容与权限

内容保存在 Sites D1 数据库中，跨设备读取；首访幂等导入 db/seed.json 中原有 133 道题和 31 条复盘。后续构建不会覆盖已编辑内容或恢复删除内容。

右上角「登录管理」使用 Sites 的 ChatGPT 登录。Worker 依据平台注入的身份头校验创建者邮箱，所有写接口均校验权限和请求来源。公众无需登录即可阅读。删除主题须输入名称确认，连同主题内题目一起隐藏；数据库保留删除标记。编辑有版本冲突保护，发布使用请求编号防止重试重复。

## 开发与验证

使用 Node.js 22 或更高版本，npm ci 后运行 npm run build、npm test。
npm run dev 启动 http://localhost:4173，数据保存在 .wrangler/local。
仅本地界面测试可用 LOCAL_ADMIN_PREVIEW=1 npm run dev 模拟管理员，此开关不进入生产 Worker。

web/ 为浏览器源码，worker/ 为 API 与静态资源服务，db/schema.ts 与 drizzle/ 为数据库结构及迁移。
构建产物 dist/server/index.js 内嵌页面和初始数据，dist/.openai/ 包含 Sites 配置与迁移。
原始复盘来源和不同参考口径保存在题目 reviews 中，编辑主答案不会改动这些材料。
