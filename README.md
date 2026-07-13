# Pocket OS — 智能自媒体操作系统

面向内容创作者的全生命周期排期管理系统。支持从 [Canbox 通告排期](https://github.com/sexyfeifan/Pocket-OS) 自动导入拍摄日程，以拍摄段 + 发布日双锚点智能倒排全部工序。

## 功能特性

- **双锚点倒排**：以拍摄日程段 + 发布日期两个锚点自动计算全部工序排期
- **Canbox 集成**：从罐头场通告排期系统拉取拍摄安排，一键导入或反向绑定
- **甘特图日历**：无缝横向滚动，合并相邻工序色块，拖拽调整时间
- **选题卡编辑**：工序时间段选择、前置准备、分类标签、进度追踪
- **冲突预警**：工序过期未完成时红字警告
- **工序设置**：自定义标准制作流程，拖拽排序，颜色选择
- **数据持久化**：Docker Volume 挂载，JSON 文件存储

## 快速开始

### Docker Compose（推荐）

创建 `docker-compose.yml`：

```yaml
services:
  pocket-os:
    image: sexyfeifan/pocket-os:latest
    build: .
    ports:
      - "8080:8080"
    volumes:
      - pocket-data:/app/data
    restart: unless-stopped

volumes:
  pocket-data:
```

启动：

```bash
docker compose up -d

# 打开 http://localhost:8080
```

### Docker 直接运行

```bash
docker run -d -p 8080:8080 --name pocket-os \
  -v pocket-os-data:/app/data \
  --restart always \
  sexyfeifan/pocket-os:latest
```

### 本地开发

```bash
git clone https://github.com/sexyfeifan/Pocket-OS.git
cd Pocket-OS
npm install
npm start
# 打开 http://localhost:8080
```

## NAS 部署

### 群晖 DSM

```bash
docker run -d -p 8080:8080 --name pocket-os \
  -v /volume1/docker/pocket-os/data:/app/data \
  --restart always \
  sexyfeifan/pocket-os:latest
```

### 威联通 QTS

```bash
docker run -d -p 8080:8080 --name pocket-os \
  -v /share/CACHEDEV1_DATA/docker/pocket-os/data:/app/data \
  --restart always \
  sexyfeifan/pocket-os:latest
```

## Canbox 通告集成

Pocket OS 支持从 [罐头场通告排期系统](https://github.com/sexyfeifan/Pocket-OS) 自动拉取拍摄安排。

1. 在 Canbox 后台「管理员设置 → API 管理」中启用外部 API
2. 在 Pocket OS 侧边栏点击「从 Canbox 导入」
3. 输入你的 Canbox 服务地址
4. 选择要导入的项目，自动以拍摄段倒排全部工序

支持：
- 按时间轴浏览，自动定位到今天
- 导入时自动关联拍摄地、导演、摄影等信息
- 选题卡可反向绑定 Canbox 通告

## 标准制作流程

| 工序 | 说明 | 默认时长 |
|------|------|----------|
| 大纲 | 内容规划 | 1 天 |
| 脚本 | 文案撰写 | 1 天 |
| 拍摄 | 实际拍摄 | 2 天 |
| 粗剪 | 初步剪辑 | 1 天 |
| A Copy | 粗剪版本 | 1 天 |
| 调色 | 色彩校正 | 1 天 |
| B Copy | 精剪版本 | 1 天 |
| VO | 配音录制 | 1 天 |
| 发布 | 最终发布 | 当天 |

可在「工序设置」中自定义工序名称、颜色、时长、顺序。

## 技术栈

- **前端**：Vanilla JS + Tailwind CSS（CDN）
- **后端**：Node.js + Express
- **存储**：JSON 文件
- **部署**：Docker (Node.js 18 Alpine)，镜像约 45MB

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8080` | 服务端口 |

## 数据备份

数据存储在容器内 `/app/data/schedule_data.json`，通过 Docker Volume 映射到宿主机。

| 场景 | 数据安全 |
|------|----------|
| 重启容器 | ✅ |
| 删除容器 | ✅（数据在 Volume 中） |
| 升级镜像 | ✅ |
| 换设备访问 | ✅（同局域网） |

也可在界面中使用「导出备份」功能下载 JSON 文件。

## 许可证

MIT
