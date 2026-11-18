# 共创 · 设计 AI 工作坊

依据用户提供的《多元主体共创设计 AI 工作坊网站设计计划》制作。网站包含项目材料、个人汇报、示例点评与回应、预答辩、模型批注和版本档案。

## SKP 转换已启用

上传 `.skp` 后，原文件先保存在当前账户的私人云端空间。浏览器独立 Web Worker 使用 **OpenSKP 1.5.0（MIT）** 读取真实几何并生成带嵌入贴图的 GLB，再将转换结果存入同一网站。无需 SketchUp 桌面程序、SDK 授权或商业转换服务密钥，也不将文件发往其他转换商。

转换保留可解析的组件层级、实例变换、基础材质和 PNG/JPEG 贴图，输出统一为米、Y-up。网页支持旋转、平移、缩放、标准视角、全屏、下载原文件和 GLB、空间批注及相机恢复。批注同时绑定原文件 ID 与不可变转换结果 ID。

- 显示实际阶段与解析器报告的记录数量，不模拟百分比。
- 可取消、失败重试；取消后的旧任务不能覆盖新任务。
- 关闭或刷新页面会中断尚未完成的转换；原文件保留，可重试。
- 转换完成与浏览器加载成功分别显示，加载失败不会丢弃转换结果。
- 模型状态使用独立 R2 记录与条件写入，避免与汇报自动保存争抢状态版本。
- 归档快照由服务器读取当时的真实转换状态，旧档案不随之后的处理改变。

### 当前限制

上传上限 20 MB；GLB 输出上限 32 MB；ZIP 预检累计解压上限 96 MB；转换进程 120 秒超时；最多 20,000 节点、200 万独立几何三角形、400 万实例绘制三角形。以上为当前资源预算，**不表示已验证所有达到上限的模型**。

图层可见性、文字与尺寸标注、特殊样式、全部 SU 年份和大型实际学生模型仍需单独检查。不能把程序化教学示例当作上传文件的转换结果。

### 采用的源码与修复

- [OpenSKP](https://github.com/iamahsanmehmood/openskp)，npm 固定 `1.5.0`。
- 对照源码提交：`c98561147ea502c6d4d53a257fa4581d0c6cde1d`。
- 修复上游按 JS 字符数而非 UTF-8 字节补齐 GLB JSON 的问题，中文组件名按字节重新打包。
- 构建时补丁把贴图去重改为完整字节比较，并修复实例材质变体的贴图区分。补丁检查固定版本的源码匹配，版本变化时构建失败，避免静默遗漏修复。
- GLB 入库前验证结构、嵌入资源、层级、节点与网格预算；拒绝外部贴图 URI。
- 原文件 SHA-256 绑定转换任务；上传结果必须属于当前用户、当前文件和仍有效的任务。

OpenSKP 是库，不是 Codex skill。GitHub 技能调研还找到 [sketchup-session](https://github.com/dcc-mcp/dcc-mcp-sketchup/blob/main/src/dcc_mcp_sketchup/skills/sketchup-session/SKILL.md) 与 [sketchup-usage](https://github.com/NeoNexAI/sketchup-mcp/blob/main/skills/sketchup-usage/SKILL.md)，它们需要桌面 SketchUp，未作为本站运行依赖。

## 其他功能与边界

已实现中文响应式页面、项目搜索、文件上传下载、图纸预览、汇报与改写理由保存、点评回应历史、课堂问题与修改任务、版本对照、文本导出和课程要求编辑。

**DeepSeek AI 接口已实现**：登录后可在“AI 连接设置”验证个人 API Key，生成真实的汇报候选稿和结构化点评。密钥后端加密保存、按账号隔离；生成先审阅再写入，保留引用与生成记录。未连接时仍提供明确标注的结构参考和教学示例。详细使用、配置与验证边界见 `docs/deepseek-setup.md`。**跨账号快照评审已实现**：所有者可邀请指定邮箱的教师或只读访客，支持提问、回应、复核、到期和撤销。顶部角色切换仍为演示，真实权限由后端授权决定。机构身份和全班名册尚未接入。

## 构建与数据

```sh
npm ci --ignore-scripts
npm test
npm run build
```

前端是原生 HTML/CSS/ES modules，Three.js 0.160.1。构建使用 esbuild 将独立转换 Worker 和网站资源打包进 Cloudflare Worker，线上不依赖脚本 CDN。许可证位于 `src/vendor/`。

运行时使用 R2 `BUCKET`。项目状态位于 `users/<userId>/state.json`，原文件在同一用户目录的 `files/<id>`，模型状态与输出位于 `models/<fileId>/`。服务器对每次读取与写入使用平台登录身份隔离；跨站写入受检；阶段快照不可由普通编辑覆盖。

API：

- `GET /api/state` / `PUT /api/state`：ETag 条件保存。
- `POST /api/files?name=...&project=...` / `GET /api/files/:id`：原文件上传与下载。
- `GET /api/models/:id`：持久化转换状态。
- `POST /api/models/:id/retry`：创建转换任务，已有成功结果时返回原结果。
- `POST /api/models/:id/progress` / `cancel`：按任务 ID 更新或取消。
- `PUT /api/models/:id/complete`：校验任务、源文件摘要和 GLB，保存不可变结果。
- `GET /api/models/:id/results/:resultId`：有所有权校验的 GLB 下载。
- `POST /api/snapshots`：保存阶段快照及服务器确认的模型状态。

## 验证结果与可复现方式

`npm test`：59 项自动测试，覆盖原有存储、权限和版本行为，以及中文 GLB 对齐、非法模型、跨用户结果隔离、取消后晚到回调、立即重试、结果幂等和快照中的模型版本。

12 组 SKP 转换样本检查通过（11 份仓库样本 + 1 份由真实样本修改中文组件名的输入）。头部包含版本 6、13、17、20、25；文件名中的年份不能当作实际版本。验证了嵌套组件层级、0.01 缩放与 0.508m 平移、中文组件名对齐、贴图数量和嵌入数据。详细记录在 `docs/skp-validation.json`。

```sh
node scripts/verify-skp.mjs /path/to/openskp/packages/typescript/tests/fixtures
```

另完成一份 217,563 字节、3 贴图的真实 SKP 的完整链路测试：上传 → 隔离进程执行网站转换 bundle → 保存 GLB → 重新读取 → 创建不可变快照；该测试使用 Node Worker 与内存 R2 模拟，不等于生产浏览器测试。原有 DOM 编辑、提交与课堂流程回归通过。

当前会话没有可调用的 `cua_repl.js`，遵照 Sites 运行要求没有启动替代浏览器。浏览器 WebGL 显示、移动端性能与对照 SketchUp 原视口的全面视觉保真验收仍待人工验证。DeepSeek 接入的受控响应与 DOM 检查通过；仍需用户验证自己的 API Key 后完成一次真实线上生成。

材料分类、PDF 选页、AI 追问、视图书签、模型对照及跨账号评审室的使用和授权说明见 [工作台改进说明](docs/studio-upgrade.md)。该扩展沿用现有存储和密钥，不需要迁移旧项目。


导入来源、运行及部署要求见 [GitHub 导入说明](docs/github-import.md)。
