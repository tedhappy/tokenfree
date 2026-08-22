# TokenFree

token中转站合集，让我们实现token自由 —— 收录可用、稳定的 AI API 中转站，帮助用户快速找到免费额度和低价倍率入口。

## 技术栈

- **前台**：Astro 5（纯静态 SSG）+ React Islands（搜索/筛选交互）+ Tailwind CSS
- **后台**：Hono（Node.js，单进程极轻量）+ JSON 文件存储（无数据库）
- **部署**：任意静态托管 + Node 进程，适配 2核2G 低配服务器（总内存占用约 100MB）

## 快速开始

```bash
# 安装依赖
npm install

# 开发前台（http://localhost:4321）
npm run dev

# 构建前台静态文件到 dist/
npm run build

# 启动生产服务（前台 + 后台 API + 管理页，默认 4321 端口）
ADMIN_PASSWORD=你的密码 npm run admin:start
```

生产环境**必须**设置 `ADMIN_PASSWORD` 环境变量，否则服务拒绝启动。可用环境变量见 `.env.example`。

## 前台功能

- 首页：搜索（⌘K 快捷键）、模型筛选、标签筛选、**收藏（★ 我的收藏）**、倍率排序、**卡片/表格双视图**、实时在线状态点
- **公告条**（后台实时配置，可关闭）+ **全站健康度**（Hero 区实时在线率）
- 站点详情页 `/site/[slug]`：完整介绍、模型、工具兼容、直连标注、实时可用率、**体验日志时间线**、收藏
- **帮我选站** `/recommend`：三问推荐（模型/预算/网络）
- **避雷榜** `/blacklist`：失效/跑路/不稳定站点 + 监测不可达名单
- 投稿页 `/submit`（蜜罐 + 限频）、FAQ 新手指南 `/faq`
- 亮/暗主题切换、中英文切换、**AFF 推广链接开关**（页脚，用户可关）
- 社群入口（QQ/Telegram，后台配置）、外链中转跳转 + 点击统计

## 管理后台

访问 `http://your-domain/admin/`，输入 `ADMIN_PASSWORD` 登录。

- 站点：CRUD 全字段（含体验日志、网络可达性、工具兼容、affUrl 返佣）、实时在线标记、疑似失效告警
- 投稿：审核队列，一键收录/丢弃
- 监测：每 30 分钟自动探测（可配 `MONITOR_INTERVAL_MIN`），延迟/24h 可用率面板，手动触发
- 模型：标签增删（ID/显示名/颜色）
- **设置：公告编辑（实时生效）、社群链接、一键导出全量备份 JSON**
- 重建前台按钮：改完数据一键重新构建

## 数据说明

站点数据存在 `src/data/sites.json`，支持 Git 版本控制。当前初始数据（71 个站点含真实 URL）整理自 FreeTokenNav 公开页面（2026-08-22），已去除原站推广码。`scripts/import-nav.mjs` 为数据生成脚本。运行时数据（点击/监测/投稿）在 `src/data/*.json`，已被 gitignore，注意服务器端备份。

## 目录结构

```
├── src/
│   ├── pages/           # 前台页面（/、/about、/go 跳转页）
│   ├── components/      # Astro 组件 + React SiteList
│   ├── layouts/         # 基础布局（暗色主题）
│   ├── data/            # sites.json / models.json / clicks.json
│   └── utils/           # 数据读取工具
├── public/admin/        # 管理后台（纯 HTML+JS，无构建）
├── server/index.js      # Hono API + 静态托管
└── dist/                # 构建产物（gitignore）
```

## 生产部署（2核2G 服务器）

```bash
# 服务器上
git clone <repo> && cd tokenfree
npm install && npm run build

# 用 systemd / pm2 守护
ADMIN_PASSWORD=xxx PORT=4321 node server/index.js
```

Nginx 反代示例（可选，也可直接暴露 Node 端口）：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    location / {
        proxy_pass http://127.0.0.1:4321;
        proxy_set_header Host $host;
    }
}
```

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `ADMIN_PASSWORD` | 管理后台密码（生产必填） | — |
| `PORT` | 服务端口 | 4321 |
| `MONITOR_INTERVAL_MIN` | 可用性监测间隔（分钟，0 关闭） | 30 |
| `SESSION_SECRET` | 会话密钥 | 随机 |
| `SITE_URL` | 站点 URL（SEO） | 占位 |

## 安全特性

- 管理接口全部鉴权（Bearer token，24h 过期），登录使用时间安全比较
- 登录速率限制：同一 IP 连续失败 5 次锁定 15 分钟
- `/go` 跳转页协议白名单（仅 http/https），防 `javascript:` 注入
- 外链统一 `rel="noopener noreferrer nofollow"`
- JSON 写入使用临时文件 + rename，避免写坏数据文件
- 管理页零外部依赖（无 CDN），断网/被墙不影响使用
