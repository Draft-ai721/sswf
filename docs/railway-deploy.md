# Railway 部署与维护

## 运行方式

仓库根目录的 Dockerfile 使用 Node.js 24，构建前端和浏览器转换 Worker，再运行 `node server/index.mjs`。服务监听 `0.0.0.0:$PORT`，健康检查为 `/healthz`。`railway.json` 固定单实例并配置重启策略。

服务使用 Railway 持久化卷 `/data` 保存 SQLite 数据库、登录会话、文件、模型结果及自动生成的 AI 加密主密钥。不能用临时容器文件系统代替；在 Railway 环境没有挂载卷时服务会拒绝启动，避免丢失保存的材料。不要配置多个副本。

## 从 GitHub 部署

1. Railway 创建项目和空服务，在服务挂载 Volume，Mount Path 填 `/data`。
2. 配置 `PORT=3000`、`DATA_DIR=/data`、`AI_PROVIDER=deepseek`、`AI_DAILY_LIMIT=10`。
3. 为首次初始化安全配置 `BOOTSTRAP_TOKEN`，建议使用 `openssl rand -hex 32` 生成。该值仅放在 Railway Variables，不进入仓库。若未配置，服务会在卷内生成 `bootstrap-token` 文件，需要部署管理员通过安全终端读取。
4. 连接 GitHub 仓库 `Draft-ai721/sswf` 的 `main` 分支。
5. 生成 Railway 公共域名，设置 `PUBLIC_URL=https://你的域名`（仅 origin，不带路径），然后部署。若未设置且存在 `RAILWAY_PUBLIC_DOMAIN`，服务自动使用该公共域名。
6. 首次使用 `/setup#token=初始化码` 创建管理员账号，自己设置邮箱、称呼和密码。初始化只能完成一次。不要公开分享初始化链接。
7. 后续通过 `/login` 登录；管理员在 `/account` 创建绑定邮箱的账号邀请链接，再私下交给成员。账号邀请不自动发送邮件，7 天内有效，单次激活。学生与教师的项目评审权限仍由评审室所有者单独授予。
8. 个人 DeepSeek API Key 继续通过“AI 连接设置”验证，费用由对应 DeepSeek 账号承担。

## 本地运行

推荐 Node.js 24：

```sh
npm ci --ignore-scripts
npm run build:railway
npm test
PUBLIC_URL=http://localhost:3000 npm start
```

本地数据默认在 `data/`，初始化码在 `data/bootstrap-token`。已有环境必须保留原 `ai-encryption.key`；若显式设置 `AI_SECRET_ENCRYPTION_KEY`，它必须是 32 字节随机数据的 Base64，且以后保持不变。该密钥用于解密个人 API Key。

## 登录与持久化

- Railway 不信任客户端传入的 `oai-*` 身份头，只根据服务器验证过的 HttpOnly 会话 Cookie 生成内部身份。
- 密码使用 scrypt 加盐保存，登录失败有次数限制，公开接口不能自行注册或宣称受邀邮箱。
- 邀请链接在 URL fragment 中携带令牌，数据库仅存其哈希。学生可使用账号邀请，项目教师权限使用独立的评审邀请。
- 所有写请求校验同源，公网 Cookie 启用 Secure、HttpOnly 与 SameSite=Lax。
- SQLite 以 WAL 与原子事务实现原 R2 接口的 ETag 条件写入，原来的不可变快照、模型结果、AI 来源与账号隔离逻辑保留。
- 数据目录不属于静态资源目录；数据库、密钥和服务器代码不能通过静态 URL 下载。

## 旧站数据

这次是运行环境迁移，原 Sites 网站和数据没有删除。新 Railway 数据库不会自动读取旧 R2 数据；旧项目、原文件和旧账号的 AI 连接尚未迁移。若需要搬迁，应先通过受授权的数据导出取得旧文件与记录，再映射到新账号导入，不能仅复制示例数据或假定不同平台账号 ID 相同。

## 维护

- 建议在 Railway 为 `/data` 配置卷备份；恢复时需要同时保留 SQLite 和加密主密钥。
- 备份 SQLite 应使用 SQLite backup API 或先暂停写入，不能只复制正在写入的主数据库文件而漏掉 WAL。
- 卷满、丢失挂载或加密主密钥变化都可能影响保存；先查 Railway 运行日志和卷状态。
- GitHub `main` 的后续提交由 Railway 关联源码触发构建。仓库本身与 GitHub Pages 不代替服务器部署。

本次自动验证包括原有功能与新增的会话登录、邀请激活、伪造身份拒绝、SQLite 并发条件写入、重启持久化、真实 Node HTTP 服务、模拟 DeepSeek 和跨账号师生评审。真实 DeepSeek 计费请求仍需用户自己验证。
