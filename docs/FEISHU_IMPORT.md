# 飞书项目 → Pocket OS 接入（v1.9.10）

## 这一版怎样使用

这是单向、人工确认的导入流程：

1. 你在 Agent 中指定飞书项目，或让它列出候选后手动选择。
2. Agent 读取飞书字段和节点，提交到 Pocket OS 的候选收件箱。
3. 进入 Pocket OS「从飞书项目导入」，选择候选，再手动选择已有项目或新建。
4. 对照 Pocket 当前值、飞书新值和上次读取值，勾选要应用的字段与日期。
5. 确认后保存，并保留绑定和导入记录。后续更新仍重复预览确认，不自动同步。

**不限定飞书自带 Agent**：能通过已授权的飞书 MCP / Meegle CLI 读取项目，并能带 Bearer Token 发起 HTTP 请求的 Agent 均可。只有飞书读取工具、不能调用 Pocket HTTP 接口的 Agent，需要另外接入 HTTP 工具或执行环境。

本版提供 HTTP API 和 OpenAPI 文档，**不是 Pocket OS MCP Server**。Pocket 页面只展示 Agent 已提交的候选，不能直接检索飞书全库；Pocket 也不保存飞书 OAuth 凭证或主动调用飞书。

## 管理员首次配置

1. 在部署环境设置非空的 `POCKET_OS_PASSWORD`，重启 Pocket OS。公网访问必须使用有效 HTTPS，不要直接暴露无密码管理页面。可同时设置不同的 `POCKET_OS_VIEW_PASSWORD` 给只读看板。
2. 用管理密码登录，点击「从飞书项目导入 → Agent 接入设置」。
3. 生成 Agent 凭证，将一次性显示的 Token 存入 Agent 的密钥配置。不要粘贴进公开提示词、URL、代码仓库或日志。
4. 把 Pocket OS 地址和设置页的「给 Agent 的固定指令」交给 Agent。Agent 必须能访问该地址；本机可访问不代表云端 Agent 可访问。

凭证只保存摘要，一次只启用一枚；重新生成立即撤销旧凭证，旧收件箱不删除。新凭证不能读取旧凭证的请求结果，但管理员仍可查看和处理。Token 无法用于管理 API、只读页面、全库读取、直接修改或删除项目，也不能导出或恢复备份。只读密码不能管理导入。

## 给 Agent 的操作要求

设置页已有可复制的完整指令，关键规则如下：

- 飞书授权只需查看权限。不要修改字段、流转节点、完成子任务或发布计划表。
- 用户提供链接时，用飞书工具的 URL 解析能力取得标识，再查询权威空间、工作项类型与实例，不能从链接路径猜 ID。
- 先读取字段元数据、工作流模板和所有节点分页；将枚举 ID 转为已核实的标签。不要把默认返回的字段当作全部字段。
- 先用 `/mappings` 查询该空间、类型、模板的已确认映射，再与当前元数据核对。没有映射时按真实元数据整理候选；含糊或多个对应项时询问用户。`conflicts` 中的条目不可直接套用。
- Pocket 只校验数据结构与来源标识，**不向飞书在线验证 Agent 所报内容**。授权 Agent 有责任保证读取完整、字段含义正确、来源时间真实。
- 只提交用户指定的项目，不因名字相同自动绑定，不读取无关项目全文。
- 飞书节点的实际开始 / 完成与计划日期分开。不能因为实际完成了，就反推或补填计划日期。

## 支持的字段

| Pocket 字段 | 含义 / 规则 |
| --- | --- |
| `title` | 项目名称。新建时以用户在目标选择页确认的名称为准；真实来源名称仍保留作后续对照 |
| `projectCode` | 项目号，保留原文本 |
| `formats` | 数组：`横屏`、`竖屏`，允许两者同时存在 |
| `advertising` | `有广告`、`无广告` 或 `null`（未填写），不要从渠道或项目名推断 |
| `cooperationPlatforms` | 合作渠道数组，与发布平台分开 |
| `platforms` | 发布平台数组 |
| `outlineDocument` / `scriptDocument` | 大纲 / 脚本文档 HTTPS 链接，不是日期；多个文档需先由用户选择，不拼成一个链接 |
| `publishDate` | 发布时间字段对应的日期，可为 `null` |
| `nodes` | `outline`、`script`、`shoot`、`acopy`、`bcopy`、`publish` 的计划日期段与来源状态 |

每个已提交字段须在 `fieldKeys` 中提供真实来源字段 ID（名称可用系统字段 `name`）。节点提供真实 `sourceNodeId` 和 `sourceName`。ID 用字符串传递；不要用名称代替 ID。

时间戳先按来源排期的业务时区转换为 `YYYY-MM-DD`，不要直接截取 UTC 日期。新建 Pocket 项目默认 `Asia/Shanghai`、按日期自动推进；绑定已有项目保留原时区与推进模式。计划结束只按完整结束日计算，不等同于人工验收。

### 日期和空值规则

- **缺失**：未读取、无权限或不确定的字段直接省略，不提交伪造的空值。节点没读全时先补齐分页，不把漏页误报为无排期。
- **确认为空**：字段传 `null`，节点日期传 `ranges: []`；默认不勾选清空，覆盖已有值还需要额外确认。
- 只选择某个节点只会改变它的日期，不倒排、不顺推、不移动其他节点。
- 普通节点最多一段，拍摄最多 30 段、不重叠且保留间隔；发布只允许一天。
- 发布时间字段为空、发布节点有日期时，预览使用发布节点。两者都有值且不同，保留两种来源，由用户选择。应用后项目发布日期与发布节点一致。
- 飞书 `status`、`actualStart`、`actualEnd` 是参考数据，不写入 Pocket 的人工完成、延期、暂停、不适用或归档状态。

## HTTP 接口

完整规范：管理页面的「查看 / 保存 OpenAPI 接口文档」，或使用 Agent Token 读取 `GET /api/agent/v1/schema`。仓库文件为 [`import-openapi.json`](../import-openapi.json)。

全部 Agent 请求使用 `Authorization: Bearer <Agent Token>`，JSON 正文使用 `Content-Type: application/json`。

| 方法和路径 | 用途 |
| --- | --- |
| `GET /api/agent/v1/schema` | 获取 OpenAPI 3.1 规范 |
| `POST /api/agent/v1/imports` | 提交一条候选，必须携带 `Idempotency-Key` |
| `GET /api/agent/v1/imports/{id}` | 查询当前凭证提交的记录与处理结果 |
| `GET /api/agent/v1/mappings` | 查询已由用户确认的模板映射；参数为 `host`、`projectKey`、`workItemType`、`templateId` |

请求示例（全部标识均为虚构，真实调用须替换）：

```json
{
  "schemaVersion": 1,
  "source": {
    "host": "project.feishu.cn",
    "projectKey": "example_space",
    "workItemType": "example_type",
    "workItemId": "example_item",
    "templateId": "example_template",
    "url": "https://project.feishu.cn/example/story/detail/example_item",
    "updatedAt": "2026-09-13T09:00:00+08:00",
    "fetchedAt": "2026-09-13T10:00:00+08:00"
  },
  "fields": {
    "title": "示例视频项目",
    "projectCode": "DEMO-001",
    "formats": ["横屏"],
    "advertising": "有广告",
    "cooperationPlatforms": ["示例合作渠道"],
    "platforms": [],
    "publishDate": null
  },
  "fieldKeys": {
    "title": "name",
    "projectCode": "field_code",
    "formats": "field_format",
    "advertising": "field_ad",
    "cooperationPlatforms": "field_partner",
    "platforms": "field_platform",
    "publishDate": "field_publish"
  },
  "nodes": [
    {"key":"shoot","sourceNodeId":"state_shoot","sourceName":"拍摄","ranges":[{"start":"2026-09-15","end":"2026-09-16"},{"start":"2026-09-20","end":"2026-09-20"}],"status":"not_started"},
    {"key":"publish","sourceNodeId":"state_publish","sourceName":"发布","ranges":[{"start":"2026-09-25","end":"2026-09-25"}],"status":"not_started"}
  ]
}
```

`updatedAt` 必须是真实来源更新时间，`fetchedAt` 是本次读取时间，均为带时区 ISO 时间；不能把读取时间冒充更新时间。初次提交返回 `201`，含 `id`、`status: pending` 和 `reviewPath`。将 `reviewPath` 拼接到 Pocket OS 站点地址交给用户，**待确认不等于已经写入项目**。

同一次操作重试沿用相同键和相同内容，返回 `200` 且 `repeated: true`；键相同但内容不同返回 `409`。重新读取或修改内容必须生成新键。不得用不断更换键的方式重试同一次失败请求。

单次正文最多 64 KiB，待确认最多 250 条。每个连接 IP 每分钟 240 次、每枚凭证每分钟 90 次；反向代理场景多个调用方可能共享 IP 限制。

常见失败：`400` 输入不合法；`401` Token 缺失或已失效；`403` 权限或跨站限制；`409` 版本 / 唯一绑定 / 请求键冲突或收件箱已满；`413` 请求过大；`429` 限流。冲突时重新读取或请用户处理，不能强行覆盖。

## 后续更新、解绑与撤回

- 来源唯一身份由站点、空间、工作项类型和实例 ID 组成。同一个来源不能重复绑定两个 Pocket 项目；一个 Pocket 项目也不能同时绑定两个来源。
- 预览有效十分钟。预览后项目被另一设备修改，确认返回冲突，必须重新预览；服务器不通过自动重试绕过版本检查。
- 导入记录保留最近 30 次操作及逐项变更。项目内容与提交回执一起写入，收件箱状态在中断后可按回执恢复；重复确认不会重复创建项目。
- 「解除绑定」仅移除来源关系，保留日期、资料、备注和历史。
- 「撤回上次导入」仅在该次导入后项目没有其他保存时可用；先预览，恢复导入前的业务资料与日期。新建项目仍保留，不会删除。已有后续修改时请逐项恢复日期。
- 只读看板可显示项目号、画幅、广告和合作渠道；不返回导入历史、来源绑定详情、文档链接或 Token。

## 数据与备份边界

- 项目及绑定历史：`data/topics/`。
- 候选收件箱：`data/integrations/feishu/`。
- Agent 凭证摘要：`data/integrations/feishu-credentials.json`；明文 Token 不落盘。
- 页面「导出备份」包含项目与绑定历史，不包含候选收件箱或凭证摘要。页面「导入恢复」仅替换项目，不回滚收件箱处理状态。若恢复到导入前或手动删除项目，需要从 Agent 重新读取并提交新候选。
- 完整迁移须停服备份整个持久化 Volume，并单独安全保留部署环境配置。拥有 Volume 或管理密码的人仍应视为管理员。
- 镜像不打包真实项目、收件箱、Token 或 `.env`；升级使用原持久化 Volume，不需要重新导入现有项目。
