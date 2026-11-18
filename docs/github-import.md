# GitHub 导入与运行说明

本仓库提供共创设计 AI 工作坊前端、Worker 后端、SKP 转换、AI 接入、师生评审及自动测试源码。

源码基线：2fa3125c8dcfb9bc586f10b13da02526370a12f0（V6 功能及 V7 下载接口补丁）。导入时更新了 README 中的历史功能和测试数量说明。未包含个人项目、上传材料、运行时密钥、仓库访问令牌、node_modules 或 .git。

为了避免嵌套旧源码包，未导入 distribution/ 中的临时源码归档和链接配置。缺少此配置时临时下载接口返回 404，其他网站功能不受影响。

## 安装与构建

推荐 Node.js 22 或更新版本，在项目根目录执行：

```sh
npm ci --ignore-scripts
npm test
npm run build
```

Cloudflare Worker ES module 入口为 dist/server/index.js，需要 R2 存储绑定 BUCKET。源码使用原生 HTML/CSS/JavaScript、Three.js、OpenSKP 和 PDF.js。

GitHub Pages 只能承载静态内容，无法独自运行本站的登录、上传、存储、AI 和跨账号评审后端。

.openai/hosting.json 保留原 Sites 项目 ID，便于维护原站。部署到另一个 Sites 项目时使用平台返回的新 ID。其他平台部署时，需要接入等效的可信身份认证与对象存储，不能信任访问者自行填写的身份请求头。

.env.example 只有配置名称；真实 API Key 和 AI_SECRET_ENCRYPTION_KEY 必须通过安全配置提供，不能写入前端或仓库。旧线上环境的加密主密钥不能随意更换。

最新功能与授权说明见 studio-upgrade.md，DeepSeek 配置见 deepseek-setup.md。src/downloads/ 是早期离线导出示例，不是完整站点。

本次导入仅托管源码，不会自动替换当前网站的部署或 Cloudflare 入口规则。
