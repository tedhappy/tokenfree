# TokenFree

让每个人都能免费用 Token，实现 Token 自由 —— 编辑实测的 AI API 中转站精选榜：免费额度、低价倍率、实时监测，一站看清。

## 技术栈

- **前台**：Astro 5（纯静态 SSG）+ React Islands（搜索/筛选交互）+ Tailwind CSS
- **后台**：Hono（Node.js，单进程极轻量）+ JSON 文件存储（无数据库）
- **部署**：任意静态托管 + Node 进程，适配 2核2G 低配服务器（总内存占用约 100MB）

## 快速开始

```bash
# 安装依赖
npm install

# 配置：复制示例并修改管理员密码（推荐，启动命令就不用带密码了）
cp .env.example .env
#   编辑 .env：ADMIN_PASSWORD=你的密码
#   可选：SITE_URL=你的域名（影响 sitemap/og 链接）

# 开发前台（http://localhost:4321，热更新，无后台 API）
npm run dev

# 构建前台静态文件到 dist/
npm run build

# 启动生产服务（前台 + 后台 API + 管理页，自动读取 .env）
node server/index.js
```

密码等配置的优先级：**命令行环境变量 > .env 文件**。生产环境必须设置 `ADMIN_PASSWORD`（.env 或环境变量均可），否则服务拒绝启动。全部可用配置见 `.env.example`。

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
- 投稿：审核队列，一键收录/丢弃（**自动采集的候选站也进入这里**，标 `auto:collector`）
- 监测：每 30 分钟自动探测（可配 `MONITOR_INTERVAL_MIN`），延迟/24h 可用率面板，手动触发
- **采集：每 24 小时自动发现新站候选（可配 `COLLECT_INTERVAL_HOURS`）——自动去除推广参数、探测首页与 `/v1/models` 端点验证可用性后写入投稿队列，人工审核后收录；也可在监测面板点「立即采集」**
- **信息自动核验/回填（`server/enrich.js`）：每天自动访问各站公开接口 `/api/pricing`（模型列表+分组倍率）、`/api/notice`（站点公告）并回填——倍率为空自动补全、与编辑值冲突只提醒不覆盖、模型标签只增不减，所有自动写入均在体验日志中注明来源；有变化时自动重建前台（`REBUILD_ON_CHANGE`）**
- **推广链接（affUrl）是唯一需要人工的字段**：后台首页「推广链接待补」卡片列出全部未设置的站点，附"去注册"入口和一键粘贴；站点列表以 AFF✓/AFF待补 标记
- 模型：标签增删（ID/显示名/颜色）
- **设置：公告编辑（实时生效）、社群链接、一键导出全量备份 JSON**
- 重建前台按钮：改完数据一键重新构建

独立运行采集器（不走服务定时）：

```bash
node server/collect.js
```

## 数据说明

站点数据存在 `src/data/sites.json`，支持 Git 版本控制。当前初始数据整理自公开渠道（2026-08-22），已去除推广码。`scripts/import-nav.mjs` 为数据生成脚本。运行时数据（点击/监测/投稿）在 `src/data/*.json`，已被 gitignore，注意服务器端备份。

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
| `COLLECT_INTERVAL_HOURS` | 自动采集间隔（小时，0 关闭） | 24 |
| `REBUILD_ON_CHANGE` | 自动核验有变化时自动重建前台（0 关闭） | 1 |
| `SESSION_SECRET` | 会话密钥 | 随机 |
| `SITE_URL` | 站点 URL（SEO） | 占位 |

## 安全特性

- 管理接口全部鉴权（Bearer token，24h 过期），登录使用时间安全比较
- 登录速率限制：同一 IP 连续失败 5 次锁定 15 分钟
- `/go` 跳转页协议白名单（仅 http/https），防 `javascript:` 注入
- 外链统一 `rel="noopener noreferrer nofollow"`
- JSON 写入使用临时文件 + rename，避免写坏数据文件
- 管理页零外部依赖（无 CDN），断网/被墙不影响使用

## 搜索引擎与 AI 工具收录（SEO/GEO）

本站已内置对搜索引擎和 AI 工具（ChatGPT/Claude/Perplexity 等）的完整友好层：

- `robots.txt`：显式欢迎 GPTBot/ClaudeBot/PerplexityBot 等主要 AI 爬虫
- `sitemap.xml`：含 lastmod，数据每日更新后自动刷新（随重建）
- `llms.txt` / `llms-full.txt`：结构化全量数据 + FAQ 问答，供大模型检索引用
- 结构化数据：WebSite（含站内搜索 SearchAction）/ItemList/FAQPage/BreadcrumbList + 详情页 dateModified 新鲜度信号
- 站内搜索支持 `/?q=关键词` 直达

**部署后需手动完成的收录步骤（一次性，约 30 分钟）：**

1. **Google Search Console**（search.google.com/search-console）：添加资源 `www.tokenfree.wiki` → 提交 sitemap.xml。验证方式可用 DNS TXT，或在 `.env` 配 `PUBLIC_GOOGLE_SITE_VERIFICATION=验证码` 后重建
2. **Bing Webmaster**（bing.com/webmasters）：同上（可一键从 Google 导入），配 `PUBLIC_BING_SITE_VERIFICATION` 同理
3. **百度搜索资源平台**（ziyuan.baidu.com）：添加站点 → 选择"HTML 标签验证"或 CNAME → 提交 sitemap；百度对新站收录慢（1-4 周），持续更新有帮助
4. **获取初始外链**（新域名被收录快慢的决定因素）：在 LinuxDo、V2EX、相关 Telegram/QQ 群等分享站点（带链接的干货帖效果最好）；外链也是搜索排名最重要的信号
5. **可选 IndexNow**（bing/搜索快速收录）：生成 key 文件放 public/ 并在数据更新后 ping，优先级低

**让 AI 更常推荐你**：AI 引用偏好"事实密度高、结构清晰、持续更新"的页面——本站每天自动核验 + sitemap lastmod 更新正是为此设计。在相关社区回答"有哪些中转站"类问题时附上站点链接，会显著提高 AI 工具抓取和引用频率。
