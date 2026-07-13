# Pocket OS — 智能自媒体操作系统

## 软件搭建计划书（Development Blueprint）

---

## 一、产品定位

面向极致 **J 型（规划型）** 独立自媒体创作者的 **本地优先（Local-First）** 内容全生命周期管理系统。

> 一句话定义：输入一个发布日期，系统自动倒推出从脚本、拍摄、剪辑到发布的全部工序排期，并在时间不够时用红字警告你。

### 核心痛点

| 痛点 | 现有方案的缺陷 |
|------|---------------|
| 多步骤工作流无法根据 Deadline 自动倒排 | Google Calendar / Apple Calendar 只能手动排每一个事件 |
| 在线协作工具（Notion、Trello）过于沉重 | 移动端拖拽体验极差，功能冗余，对独立创作者是负担 |
| 缺乏动态时间冲突预警 | 定下发布日期后，前期准备时间严重不足，直到临期才发现"爆仓" |
| 数据锁死在浏览器缓存或第三方平台 | 清空缓存即丢失全部排期，无法跨设备同步 |

---

## 二、系统架构

### 架构演进路线

```
Phase 1: 纯前端原型（localStorage）  ──验证核心逻辑──>  Phase 2: 全栈容器（Node.js + Docker Volume）
```

### 最终架构（全栈容器版）

```
┌─────────────────────────────────────────────────────────────┐
│                      浏览器前端                              │
│    index.html（Tailwind CSS + Vanilla JavaScript）           │
│                                                             │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ 左侧导航  │  │ 宏观排期日历  │  │ 微观选题卡控制面板     │ │
│  │ Sidebar   │  │ Gantt Chart  │  │ Topic Card Panel      │ │
│  └──────────┘  └──────────────┘  └───────────────────────┘ │
└─────────────────────┬───────────────────────────────────────┘
                      │ Fetch API（GET / POST）
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                 Node.js 后端（Express）                      │
│                                                             │
│  GET /api/data    ─── 读取 schedule_data.json               │
│  POST /api/data   ─── 写入 schedule_data.json               │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  data/                                               │   │
│  │  └── schedule_data.json  ◄── Docker Volume 映射      │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                      │
            Docker Volume 挂载
                      ▼
┌─────────────────────────────────────────────────────────────┐
│             宿主机 / NAS 物理硬盘                             │
│   /volume1/docker/content-os/data/schedule_data.json        │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、数据模型

### 选题卡数据结构（Topic Card Schema）

```json
{
  "id": "topic_20260712_001",
  "title": "我的第一个 Pocket OS 演示视频",
  "tag": "自制内容",
  "publishDate": "2026-07-20",
  "status": "in_progress",

  "preparationTasks": [
    { "id": "prep_1", "text": "确认品牌寄样是否到达", "done": false },
    { "id": "prep_2", "text": "学习 CapCut 关键帧功能", "done": true }
  ],

  "productionSteps": [
    {
      "id": "step_script",
      "name": "脚本",
      "startDate": "2026-07-13",
      "endDate": "2026-07-13",
      "duration": 1,
      "done": false,
      "color": "#A3D9A5"
    },
    {
      "id": "step_shoot",
      "name": "拍摄 (A-Roll)",
      "startDate": "2026-07-14",
      "endDate": "2026-07-16",
      "duration": 3,
      "done": false,
      "color": "#A5C8E1"
    },
    {
      "id": "step_edit1",
      "name": "剪辑 1（粗剪）",
      "startDate": "2026-07-17",
      "endDate": "2026-07-18",
      "duration": 2,
      "done": false,
      "color": "#F2D98B"
    },
    {
      "id": "step_edit2",
      "name": "剪辑 2（精剪）",
      "startDate": "2026-07-19",
      "endDate": "2026-07-19",
      "duration": 1,
      "done": false,
      "color": "#F2D98B"
    },
    {
      "id": "step_package",
      "name": "包装 / 封面",
      "startDate": "2026-07-20",
      "endDate": "2026-07-20",
      "duration": 1,
      "done": false,
      "color": "#D9A5E1"
    },
    {
      "id": "step_copy",
      "name": "文案 / 标题",
      "startDate": "2026-07-20",
      "endDate": "2026-07-20",
      "duration": 1,
      "done": false,
      "color": "#E1A5A5"
    },
    {
      "id": "step_publish",
      "name": "发布",
      "startDate": "2026-07-20",
      "endDate": "2026-07-20",
      "duration": 0,
      "done": false,
      "color": "#FF6B6B"
    }
  ],

  "aiAssist": {
    "assistantRoughCut": false,
    "assistantSubtitles": false
  },

  "conflictWarning": null
}
```

### 全局数据结构

```json
{
  "version": "1.0.0",
  "lastModified": "2026-07-12T20:00:00+08:00",
  "topics": [ /* TopicCard[] */ ],
  "settings": {
    "defaultDurations": {
      "脚本": 1,
      "拍摄": 3,
      "剪辑1": 2,
      "剪辑2": 1,
      "包装": 1,
      "文案": 1,
      "发布": 0
    },
    "theme": "beige-light"
  }
}
```

---

## 四、功能模块设计

### 模块 A：左侧全局导航与选题池（Sidebar）

**职责**：视图切换 + 选题目录 + 数据安全

| 功能点 | 说明 |
|--------|------|
| 视图切换 Tab | 【排期日历】（宏观甘特图）与【选题卡】（微观详情）双标签切换 |
| 选题目录列表 | 显示所有选题的标题、预设发布日期、完成进度百分比，点击进入详情 |
| 新建选题按钮 | 一键创建空白选题卡，自动跳转到编辑界面 |
| 导出备份 | 一键将全部数据下载为 `.json` 文件 |
| 导入恢复 | 上传 `.json` 文件，覆盖或合并当前数据 |
| 主题切换 | 米色系（默认）/ 暗色系 |

### 模块 B：宏观排期日历（Gantt Calendar View）

**职责**：全局视角看所有选题的时间分布和冲突

| 轴线 | 内容 |
|------|------|
| X 轴（横向） | 以天为单位的时间轴，可左右滚动，支持周/月视图切换 |
| Y 轴（纵向） | 每行一个选题，展开后可看到该选题下的各工序行 |

**交互规则**：

- **PC 端**：拖拽工序方块可调整日期，释放后自动更新选题卡数据
- **移动端**：先点击选题卡选择工序 → 再点击目标日期完成移动
- **冲突高亮**：当倒排算法检测到时间溢出（见核心算法 2），对应方块红色闪烁
- **今日标记**：当天日期列高亮显示，方便定位

**工序方块颜色编码**：

| 工序 | 颜色 |
|------|------|
| 脚本 | 🟢 绿色 `#A3D9A5` |
| 拍摄 | 🔵 蓝色 `#A5C8E1` |
| 剪辑 | 🟡 黄色 `#F2D98B` |
| 包装 | 🟣 紫色 `#D9A5E1` |
| 文案 | 🔴 浅红 `#E1A5A5` |
| 发布 | ❤️ 深红 `#FF6B6B` |

### 模块 C：微观选题卡面板（Topic Card Panel）

**职责**：单个选题的全流程精细化控制

每张选题卡包含四个核心区域：

#### 区域 1：基础信息区

- 标签（Tag）：下拉选择，如"自制内容"、"商业合作"、"学习笔记"
- 标题（Title）：可编辑的文本输入框
- 进度条（Progress Bar）：自动计算 `已完成工序数 / 总工序数 × 100%`
- 删除选题按钮（需二次确认）

#### 区域 2：前置准备（个性化 Todo List）

- 动态增删项：用户自由添加不属于标准流程的杂事
- 勾选完成：每项独立打勾
- 典型用途：确认品牌寄样、学习新 AI 工具、预约场地、确认嘉宾档期

#### 区域 3：制作流程（标准化工作流）

固定节点列表，按顺序排列：

```
脚本 → 拍摄 (A-Roll) → 剪辑 1（粗剪）→ 剪辑 2（精剪）→ 包装/封面 → 文案/标题 → 发布
```

每个节点包含：
- 名称（不可修改）
- 自动计算的起止日期（由倒排算法生成）
- 手动完成勾选
- 工序时长（可微调）

**智能助手开关（A/B 流切换）**：

| 开关 | 开启后效果 |
|------|-----------|
| 助手粗剪 | "剪辑 1" 时长从 2 天压缩为 1 天，后续节点相应前移 |
| AI 字幕 | "剪辑 2" 中增加自动字幕工序，时长 +0.5 天 |
| AI 封面生成 | "包装" 时长从 1 天压缩为 0.5 天 |

#### 区域 4：发布日期（触发器）

- 日期选择器：设定最终 Deadline
- **修改此日期 → 立刻触发全流程倒排算法** → 所有工序日期自动刷新
- 冲突预警：红字提示（见核心算法 2）

---

## 五、核心算法

### 算法 1：基准时间倒排算法（Reverse Scheduling）

**触发时机**：用户修改发布日期 `D_Target` 时

**公式**：

```
D_文案    = D_Target - 0 天
D_包装    = D_Target - 0 天
D_剪辑2   = D_Target - 1 天
D_剪辑1   = D_Target - 3 天
D_拍摄    = D_Target - 6 天
D_脚本    = D_Target - 7 天
```

**伪代码**：

```javascript
function reverseSchedule(publishDate, aiAssist = {}) {
  const D = new Date(publishDate);

  const durations = {
    script:   { offset: 7, duration: 1 },
    shoot:    { offset: 6, duration: 3 },
    edit1:    { offset: 3, duration: 2 },
    edit2:    { offset: 1, duration: 1 },
    package:  { offset: 0, duration: 1 },
    copy:     { offset: 0, duration: 1 },
    publish:  { offset: 0, duration: 0 },
  };

  // AI 助手开关调整时长
  if (aiAssist.assistantRoughCut) {
    durations.edit1.duration = 1;  // 粗剪压缩
    durations.edit1.offset = 2;
    durations.shoot.offset = 5;
    durations.script.offset = 6;
  }

  const steps = [];
  for (const [key, config] of Object.entries(durations)) {
    const startDate = subtractDays(D, config.offset);
    const endDate   = subtractDays(startDate, -(config.duration - 1));
    steps.push({
      id: `step_${key}`,
      name: STEP_NAMES[key],
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      duration: config.duration,
      done: false,
    });
  }

  return steps;
}
```

### 算法 2：时间冲突与边界预警机制

**触发条件**：

```
D_Current（今天） > D_最早工序的理论开始日期  AND  该工序 done === false
```

**系统行为**：

1. **选题卡底部**：弹出红色高亮警告
   > ⚠️ 当前发布日期倒排后有任务落在时间轴开始前；如果尚未完成，需要延后发布日期或压缩流程。
2. **宏观日历上**：冲突的工序方块红色闪烁动画
3. **左侧选题目录**：该选题条目旁显示红色警告图标

**伪代码**：

```javascript
function checkConflict(steps, today) {
  for (const step of steps) {
    if (!step.done && new Date(step.startDate) < today) {
      return {
        hasConflict: true,
        message: `「${step.name}」的计划开始日期已过，但尚未完成。`,
        conflictStepId: step.id,
      };
    }
  }
  return { hasConflict: false };
}
```

### 算法 3：进度自动计算

```javascript
function calcProgress(steps) {
  const doneCount = steps.filter(s => s.done).length;
  return Math.round((doneCount / steps.length) * 100);
}
```

---

## 六、项目文件结构

### 纯前端版（Phase 1 验证用）

```
pocket-os/
├── index.html          ← 单文件，包含全部 HTML + CSS + JS
└── README.md
```

### 全栈容器版（Phase 2 最终形态）

```
pocket-os/
├── server.js           ← Express 后端，两个 API
├── index.html          ← 前端页面（需改 localStorage 为 Fetch API）
├── Dockerfile          ← Node.js 18 Alpine 镜像
├── package.json        ← 依赖声明（仅 express）
├── data/               ← 挂载卷目录（本地开发用）
│   └── schedule_data.json
└── README.md
```

---

## 七、后端 API 设计

### server.js 核心实现

```javascript
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 80;
const DATA_FILE = path.join(__dirname, 'data', 'schedule_data.json');

app.use(express.json());
app.use(express.static(__dirname));

// 初始化数据目录和文件
if (!fs.existsSync(path.dirname(DATA_FILE))) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ version: '1.0.0', topics: [], settings: {} }, null, 2));
}

// GET  读取全部排期数据
app.get('/api/data', (req, res) => {
  const data = fs.readFileSync(DATA_FILE, 'utf-8');
  res.json(JSON.parse(data));
});

// POST 保存全部排期数据
app.post('/api/data', (req, res) => {
  try {
    req.body.lastModified = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2));
    res.json({ success: true, message: '数据已同步到服务器' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Pocket OS running on port ${PORT}`);
});
```

### 前端数据层改造

```javascript
// ── 读取数据 ──
async function loadData() {
  try {
    const res = await fetch('/api/data');
    const data = await res.json();
    window.appState = data;
    renderAll();
  } catch (e) {
    console.error('加载失败，尝试本地缓存', e);
    const cached = localStorage.getItem('pocket_os_backup');
    if (cached) window.appState = JSON.parse(cached);
  }
}

// ── 保存数据（自动防抖） ──
let saveTimer = null;
function saveData() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(window.appState),
      });
      // 同时存一份 localStorage 作为二级缓存
      localStorage.setItem('pocket_os_backup', JSON.stringify(window.appState));
    } catch (e) {
      console.error('保存失败', e);
    }
  }, 500); // 500ms 防抖
}
```

---

## 八、Docker 部署方案

### Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY server.js .
COPY index.html .

RUN mkdir -p /app/data

EXPOSE 80

CMD ["node", "server.js"]
```

### package.json

```json
{
  "name": "pocket-os",
  "version": "1.0.0",
  "description": "智能自媒体操作系统 - 面向J型创作者的内容全生命周期管理",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2"
  }
}
```

### 构建与运行命令

```bash
# 1. 构建镜像
docker build -t pocket-os:v1 .

# 2. 运行容器（挂载数据卷确保数据持久化）
docker run -d \
  -p 8080:80 \
  --name pocket-os \
  -v ~/pocket-os-data:/app/data \
  --restart always \
  pocket-os:v1

# 3. 访问
# 浏览器打开 http://localhost:8080
```

### NAS 部署（群晖 / 威联通 / Unraid）

```bash
# 将 -v 路径改为 NAS 的实际路径
docker run -d \
  -p 8080:80 \
  --name pocket-os \
  -v /volume1/docker/pocket-os/data:/app/data \
  --restart always \
  pocket-os:v1
```

### 数据持久化说明

| 场景 | 数据是否安全 |
|------|-------------|
| 重启容器 | ✅ 安全（Volume 映射） |
| 删除容器 | ✅ 安全（数据在宿主机硬盘） |
| 升级镜像重建容器 | ✅ 安全（同上） |
| 清空浏览器缓存 | ✅ 安全（数据在服务器端） |
| 换设备访问（同局域网） | ✅ 数据自动同步 |
| 宿主机硬盘损坏 | ❌ 需要定期备份 data 目录 |

---

## 九、UI 设计规范

### 整体风格

- **色调**：米色系（Warm Beige），营造温暖、专注的创作氛围
- **字体**：系统默认字体栈（`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`）
- **布局**：左侧固定 Sidebar（240px）+ 右侧主内容区（自适应）
- **CSS 框架**：Tailwind CSS（通过 CDN 引入，保持单文件特性）

### 色彩定义

| 用途 | 色值 | 说明 |
|------|------|------|
| 背景色 | `#FAF7F2` | 米白色主背景 |
| 侧边栏背景 | `#F0EDE6` | 略深的米色 |
| 卡片背景 | `#FFFFFF` | 纯白 |
| 主文字色 | `#2D2D2D` | 深灰 |
| 次要文字 | `#8C8C8C` | 中灰 |
| 主题色（Brand） | `#FF6B6B` | 暖红，用于按钮、强调 |
| 警告色（Conflict） | `#E53E3E` | 红字冲突提示 |
| 成功色（Done） | `#38A169` | 已完成勾选 |

### 响应式断点

| 设备 | 宽度 | 布局策略 |
|------|------|---------|
| 手机 | < 768px | Sidebar 折叠为汉堡菜单，选题卡全屏显示 |
| 平板 | 768px - 1024px | Sidebar 收窄为图标模式，主内容区自适应 |
| 桌面 | > 1024px | 完整双栏布局 |

---

## 十、研发计划（Milestones）

### Phase 1：UI 骨架与本地存储（1-2 天）

**目标**：看到界面，数据不丢

- [ ] 搭建项目目录结构
- [ ] 使用 Tailwind CSS 实现米色系双栏布局（Sidebar + 主内容区）
- [ ] 实现视图切换 Tab（排期日历 / 选题卡）
- [ ] Sidebar 选题目录列表渲染
- [ ] 打通 localStorage，实现数据的读取、保存、刷新不丢失
- [ ] 实现新建选题 / 删除选题功能

**交付物**：可在浏览器中打开的静态 HTML，能增删选题并持久化

### Phase 2：倒排算法与选题卡逻辑（2-3 天）

**目标**：输入日期，自动排期

- [ ] 实现选题卡四个区域的完整 UI（基础信息、前置准备、制作流程、发布日期）
- [ ] 编写倒排算法（`reverseSchedule`）
- [ ] 实现修改发布日期 → 全部工序日期自动刷新
- [ ] 实现 AI 助手开关（A/B 流切换）对时长的影响
- [ ] 实现前置准备 Todo List 的增删改勾
- [ ] 实现进度条自动计算
- [ ] 实现时间冲突红字预警机制
- [ ] 实现工序手动完成勾选

**交付物**：选题卡功能完整，倒排逻辑正确，冲突预警生效

### Phase 3：宏观日历甘特图（2 天）

**目标**：全局排期一目了然

- [ ] 实现日历矩阵渲染（X 轴时间，Y 轴选题）
- [ ] 将选题卡的工序数据渲染为彩色方块
- [ ] PC 端拖拽调整工序日期
- [ ] 移动端点击交互（先选工序，再点日期）
- [ ] 冲突方块红色闪烁动画
- [ ] 今日列高亮标记
- [ ] 时间轴左右滚动 & 周/月视图切换

**交付物**：日历视图与选题卡数据双向同步

### Phase 4：全栈改造与 Docker 部署（1 天）

**目标**：数据不依赖浏览器，多设备可用

- [ ] 编写 `server.js`（Express 后端，两个 API）
- [ ] 改造前端 localStorage → Fetch API（带 localStorage 二级缓存）
- [ ] 编写 `package.json` 和 `Dockerfile`
- [ ] 本地 Docker 构建 & 运行测试
- [ ] 实现数据导入 / 导出功能（JSON 文件上传下载）
- [ ] 编写 README.md 部署文档

**交付物**：可通过 `docker run` 一键部署的全栈容器

### Phase 5：AI 集成与体验打磨（1 天）

**目标**：智能化 & 使用体验闭环

- [ ] "询问 ChatGPT" 按钮集成（生成当前排期摘要 → 发送给 AI 优化建议）
- [ ] Prompt 工程：让 AI 能读懂导出的 JSON 计划表
- [ ] 响应式适配（手机 / 平板）
- [ ] 键盘快捷键支持（新建 N、删除 Del、保存 Cmd+S）
- [ ] 空状态引导页面
- [ ] 性能优化（大量选题时的虚拟滚动）

**交付物**：功能完整、体验丝滑的 v1.0

---

## 十一、技术栈汇总

| 层级 | 技术选型 | 理由 |
|------|---------|------|
| 前端框架 | Vanilla JavaScript（无框架） | 极致轻量，单文件可运行 |
| CSS 框架 | Tailwind CSS（CDN） | 快速搭建米色系 UI，无需构建步骤 |
| 图标库 | Lucide Icons（CDN） | 轻量、现代、可 tree-shake |
| 后端 | Node.js + Express | 极简两个 API，代码量 < 50 行 |
| 数据存储 | JSON 文件（`schedule_data.json`） | 无需数据库，可直接用文本编辑器查看/修改 |
| 容器化 | Docker（Node.js Alpine） | 镜像 < 50MB，内存占用 < 30MB |
| 数据持久化 | Docker Volume 挂载 | 宿主机硬盘实时同步，容器可随意重建 |
| AI 集成 | OpenAI API（可选） | 一键获取排期优化建议 |

---

## 十二、安全与备份策略

### 数据备份（三级防护）

| 级别 | 方式 | 说明 |
|------|------|------|
| L1 - 实时 | Docker Volume 映射 | 数据实时写入宿主机硬盘 |
| L2 - 本地 | 手动导出 JSON | 左下角【导出备份】按钮，下载 `.json` 文件 |
| L3 - 云端 | 宿主机网盘同步 | 将 Volume 目录设为 iCloud / Dropbox / 群晖同步文件夹 |

### 访问控制（可选增强）

- 当前版本：无认证，局域网内直接访问
- 增强方案：在 Nginx 反向代理层加 Basic Auth，或在 server.js 中加入简单的密码校验

---

## 十三、未来可扩展方向

| 方向 | 说明 | 优先级 |
|------|------|--------|
| 多平台发布追踪 | 标记每个视频在 B站/YouTube/抖音 的发布状态和链接 | P2 |
| 数据统计面板 | 本月产出量、平均制作周期、工序瓶颈分析 | P2 |
| Markdown 笔记集成 | 选题卡内嵌 Markdown 编辑器，用于写脚本 | P3 |
| Webhook 通知 | 排期变更时推送消息到微信 / 飞书 / Telegram | P3 |
| 多用户协作 | 引入 SQLite + 简单登录，支持小团队共用 | P4 |

---

## 附录：快速启动清单

```bash
# 1. 克隆或创建项目目录
mkdir pocket-os && cd pocket-os

# 2. 创建三个核心文件
#    - index.html  （前端页面）
#    - server.js   （后端 API）
#    - Dockerfile  （容器配置）
#    - package.json（依赖声明）

# 3. 本地开发（不使用 Docker）
npm install
node server.js
# 打开 http://localhost:80

# 4. Docker 部署
docker build -t pocket-os:v1 .
docker run -d -p 8080:80 --name pocket-os -v ~/pocket-os-data:/app/data pocket-os:v1
# 打开 http://localhost:8080
```

---

*Pocket OS — 输入 Deadline，排出全部工序，红字告诉你时间够不够。*
