# 意淼小屋

把想念，放进同一个家。

[进入在线小屋](https://yimiao-little-home.cool-otter-0098.chatgpt.site)

这个仓库公开小屋的程序源码，并通过 GitHub Pages 提供网页入口。入口的「进入小屋」按钮会打开已有的完整网站。登录、相册、日记、信件和上传仍由原网站的服务端处理。

源码中的成员资料和见面日期是虚构示例，不包含线上或本机的私人回忆、照片、视频、数据库、密钥或原项目的 Git 历史。公开仓库不会更改在线小屋中的内容和账号权限。

## GitHub Pages

静态入口在 `github-pages/`，无需安装依赖或编译。仓库默认分支使用 `main`。在仓库 **Settings → Pages → Build and deployment** 将 **Source** 设为 **GitHub Actions**，工作流就会发布入口。推送入口更新后会自动重新部署；也可在 **Actions** 手动运行 **Publish the little home entrance**。

网站打开完整小屋时使用绝对 HTTPS 地址，入口自己的图片和样式使用相对路径，可运行在 GitHub 的项目子目录。GitHub Pages 不运行 Cloudflare Worker，也不提供本程序所需的数据库或私有文件存储。

## 本地运行完整程序

需要 Node.js 22 或更新版本。

```sh
npm ci
npm run db:local
npm run dev
```

打开开发服务输出的地址，通常为 `http://127.0.0.1:5173`。本机预览使用两个体验账号和独立本机数据。真实邮箱、数据库和媒体不会随仓库获取。

```sh
npm run build
npm test
```

前端使用 React 与 Vite，后端使用 Cloudflare Worker、D1 和私有 R2。`npm run build` 输出完整程序构建；它与 Pages 发布入口是两个用途。`tests/` 中的自动化测试使用独立临时数据；浏览器验证和导入脚本使用前先阅读各自代码。

## 部署自己的完整小屋

以 `wrangler.standalone.example.jsonc` 为模板配置自己的 Worker、D1 和私有 R2，并应用 `drizzle/` 中的数据库迁移。实际配置保存为被忽略的 `wrangler.standalone.jsonc`。

服务端需配置 `AUTH_PROVIDER=supabase`、`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` 和 `MEMBER_EMAILS`，并配置验证码邮件服务及两个授权账号。示例见 `.env.example`；不要把服务端配置写入 `VITE_*` 变量。正式环境不启用本机体验账号。

使用 Sites 部署时，复制 `.openai/hosting.example.json` 为被忽略的 `.openai/hosting.json`，再填写自己新建的 Site 标识。此公开副本没有绑定原网站的部署身份。

本仓库包含 React Bits 相关视觉组件，组件保留其来源说明。没有在此仓库另行添加开源许可证。
