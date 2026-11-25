# 课堂试点、发布与恢复

## 两条试点任务

邀请 6–8 名未参与开发的学生和 2 名建筑教师。用内容相当的两套题目对照基线和候选版，交替安排版本顺序。给参与者任务书和原始材料，操作时由观察员记录，受试者需要时可主动求助。作品与账号使用试点编号。

| 任务 | 观察操作 | 完成条件 |
| --- | --- | --- |
| 校园阅览亭 | 从任务书开始，保留老树，比较两个入口方案。画轮廓、核对面积、保存体块视角。教师定位提问，学生附改稿，教师复核。 | 面积与比例正确，教师能由问题回到原版及改稿。记录首次有效编辑时间、是否无提示走完、求助次数、误触和撤销。 |
| 成熟作品独立终评 | 直接提交 SKP 和多页 PDF。用同一视角在 SketchUp 中核对模型朝向与比例。教师定位批注，学生补件和替换材料，切换两版评阅并各导出一次。 | 材料、评语和 AI 依据归属正确。撤销后访问失败。档案断网打开仍能辨认版本和关键证据。 |
| 真机与弱网 | 实体平板笔绘图和双指缩放，手机阅读与回应，桌面验证双标签冲突。断网重开、切后台、上传中断后重试。 | 草稿能恢复、另存或重试，无静默覆盖；确认一次 AI 请求只计一次。 |

首次有效编辑由进入任务页面起计，到首次保存成功的有效几何操作为止。无提示完成率按每条任务、每个版本统计，分母为开始该任务的参与者，分子为未接受操作提示且达到完成条件的参与者。试点目标为 80%，面积、版本定位和访问权限以逐条核对为准。教师抽检生产 AI 的引文与原件、证据不足的表述和建议质量。

| 参与编号 | 版本 / 顺序 | 设备 / 输入 | 任务 | 首次有效编辑（秒） | 独立完成 | 求助 / 误触 / 撤销 | 面积比例 / 版位核对 | 失败原因、复现、修复人、复测结果 |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |  |

## 试点日志

在试点环境设置 `STUDIO_PILOT_TELEMETRY=1`，结束后移除该变量并重新启动服务。服务日志以 `studio_pilot` 为类型，记录 `save_conflict`、`conversion_failed`、`ai_failed` 和服务端收到的 `upload_interrupted`。每行包含时间、状态、错误码、发布版本和按登录会话计算的匿名标识。收集范围为已登录请求，行内没有帐户、文件名、作品、提示词或密钥。未到达服务端的断网由观察员记录。日志与课堂观察以时间和设备情境对照，报告只保留任务结果与复现步骤。

## 验证发布候选

```sh
npm run build:railway
npm run build
npm test
npm run test:browser
```

通过 `CHROME_BIN` 指定 Chromium 或 Edge，可用 `STUDIO_SKP_FIXTURE` 指定有权使用的 SKP 样本。浏览器脚本以隔离账号运行概念任务和终评任务，结果在 `artifacts/studio-qa/studio-browser-results.json`。实体设备和教师点评须另外登记。

| 候选 Git 提交 | Railway 部署 ID | 时间 | 构建与回归 | 备份检查 | 只读抽测 | 开放写入验证 | 抽测与未测项 |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |

生产发布得到授权后，复用现有 Railway 服务、单副本、`/data` 卷和密钥。main 的提交可能触发自动部署。先完成下述备份和恢复验证，部署候选时使用 `STUDIO_READ_ONLY=1`，以预先授权的试点账号查看旧项目及两版终评。登录操作照常。工作稿、上传、评阅及 AI 写入暂停。网页上如有本机修改，可下载或在开放写入后重试。

Railway 通过 GitHub 触发部署时提供 `RAILWAY_GIT_COMMIT_SHA`。其他部署方式可设 `STUDIO_RELEASE_REVISION` 为候选提交。用同一提交的构建产物探测部署后的健康状态、登录页和关键资源指纹。[Railway 变量文档](https://docs.railway.com/variables/reference#git-variables)

```sh
node server/release-check.mjs https://YOUR-RAILWAY-ORIGIN YOUR_COMMIT read-only
node server/release-check.mjs https://YOUR-RAILWAY-ORIGIN YOUR_COMMIT writable
```

第一次检查通过且旧项目、旧版评审和附件抽测成功后，移除只读变量并重新部署。第二次检查确认写入开放后，用试点账号走一次保存和版本创建。填写发布记录。

## 一致性备份与隔离恢复

在有权限的终端运行，下例中的 `/secure` 必须指受限且可持久保存的目录。命令要求备份和恢复的目标目录都是新目录。SQLite 在线备份 API 同时包含已提交的 WAL 数据、账号、固定版本、原件和转换结果。

```sh
node server/recovery.mjs backup /data /secure/studio-backup-01
node server/recovery.mjs verify /secure/studio-backup-01
node server/recovery.mjs restore /secure/studio-backup-01 /secure/studio-rehearsal-01
node server/recovery.mjs compare /secure/studio-backup-01 /data
```

卷中的密钥文件随备份保存在受限目录。变量提供的密钥继续保存在原密钥系统，验证和恢复需注入同一值，命令行和输出均不显示值。备份含账号和应用数据，保存在访问受限、加密的独立存储中。工具核对 SQLite 校验和、完整性、外键、项目和共享版本材料的引用，以及已保存 AI 连接能否解密。检查 `missingVersions`、`missingMaterials`、`invalidRecords` 和 `unreadableConnections`，遇到非零先与源环境核对。

以隔离入口和新目录启动恢复演练，用试点账号验证旧快照、终评材料和版本权限。`compare` 按账号、项目状态、评审、材料和 AI 等类别报告自备份后新增、更改与移除的对象数。它不包含对象内容或 ID，也不回写或合并这些变化。

若候选出现兼容问题，先开启只读，在故障现场另做一份备份并运行 `compare`，核对新写入作品。选择已验证能读取现有数据库的数据格式的程序回退。数据恢复先在隔离目录验证，按异常范围单独决定如何处理备份点之后的变化。
