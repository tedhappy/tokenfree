#!/usr/bin/env bash
# TokenFree 一键部署/更新脚本 —— 在服务器项目根目录运行
# 首次: ADMIN_PASSWORD=你的强密码 ./deploy.sh
# 之后更新: ./deploy.sh（脚本内会自动 git pull 并保留服务器业务数据）
set -e
cd "$(dirname "$0")"

# ---- [1/4] 拉取代码（业务数据三件套已迁移为运行时文件，服务器与 Git 不再冲突）----
if [ -d .git ]; then
  echo "[1/4] 拉取最新代码..."
  DATA_BAK=$(mktemp -d)
  # 备份全部运行时数据（点击/监测/投稿/审计 + 业务三件套），供 pull/reset 前兜底
  cp -a src/data/. "$DATA_BAK/" 2>/dev/null || true

  # 服务器不应有仓库内本地改动：先 reset --hard 丢弃本地代码差异，再 pull，杜绝"本地修改挡住合并"。
  # （运行时数据三件套已 gitignore，reset 不会触碰它们；业务数据已备份，此时恢复）
  git fetch origin --quiet
  B=$(git rev-parse --abbrev-ref HEAD)
  git reset --hard "origin/${B}" --quiet
  if ! git pull --quiet; then
    echo "  ⚠ pull 失败，请检查网络或远程仓库状态"
    git pull
  fi

  # 恢复服务器上的业务数据（以服务器为准；pull 后三件套已未追踪，恢复即还原服务器数据）
  cp -a "$DATA_BAK/." src/data/ 2>/dev/null || true
  rm -rf "$DATA_BAK"
  echo "✓ 代码已更新，业务数据已保留"
fi

# 1. 检查环境
if ! command -v node >/dev/null; then
  echo "✗ 未安装 Node.js，请先安装 20+："
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs"
  exit 1
fi
echo "✓ Node $(node -v)"
# Node 版本提示（不阻断）：部分依赖要求 >=20.19.5，明显过旧时提醒升级
NODE_MAJOR=$(node -v | sed -n 's/^v\([0-9]*\).*/\1/p')
if [ "$NODE_MAJOR" -lt 20 ] 2>/dev/null; then
  echo "  ⚠ Node 版本过旧（$(node -v)），部分依赖要求 >=20。建议升级到 Node 22 LTS 后重跑 ./deploy.sh"
fi

# 2. 密码：优先命令行传入，其次沿用已有 .env
if [ -n "$ADMIN_PASSWORD" ]; then
  echo "ADMIN_PASSWORD=$ADMIN_PASSWORD" > /tmp/tf.env.new
  grep -v '^ADMIN_PASSWORD=' .env 2>/dev/null >> /tmp/tf.env.new || true
  mv /tmp/tf.env.new .env
  echo "✓ 密码已保存到 .env"
elif [ ! -f .env ] || ! grep -q '^ADMIN_PASSWORD=' .env; then
  echo "✗ 缺少管理密码。首次部署请运行："
  echo "  ADMIN_PASSWORD=你的强密码 ./deploy.sh"
  exit 1
fi

# 安装依赖 + 构建
echo "[2/4] 安装依赖..."
npm install --no-fund --no-audit
echo "[3/4] 构建前台..."
npm run build

# 启动（pm2 优先；每次 reload 会重新读取 .env）
echo "[4/4] 启动服务..."
if command -v pm2 >/dev/null; then
  pm2 startOrReload ecosystem.config.cjs --update-env
  pm2 save >/dev/null
  echo "✓ pm2 已启动（开机自启请执行一次: pm2 startup）"
else
  echo "  （未安装 pm2，建议安装: npm i -g pm2 后重跑本脚本；现用 nohup 启动）"
  pkill -f "node server/index.js" 2>/dev/null || true
  sleep 1
  nohup node server/index.js > tokenfree.log 2>&1 &
  echo "✓ 已启动 PID $!（日志: tokenfree.log）"
fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
# 健康检查用本机回环地址 + 默认端口 4321（端口常量与 ecosystem.config.cjs 一致，不依赖未定义的环境变量）
HEALTH_URL="http://127.0.0.1:4321/api/uptime"
echo ""
echo "=========================================="
echo " 部署完成！"
echo " 前台: http://${IP:-服务器IP}:4321"
echo " 后台: http://${IP:-服务器IP}:4321/admin/"
echo " 健康检查: http://${IP:-服务器IP}:4321/api/uptime"
echo " 修改 .env 后重新运行 ./deploy.sh 即可生效"
echo "=========================================="

# 部署后健康检查：确认服务已就绪，未就绪则醒目告警
sleep 2
if command -v curl >/dev/null; then
  if curl -sf --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "✓ 健康检查通过：$(curl -s --max-time 5 "$HEALTH_URL" | head -c 80)"
  else
    echo "✗ 健康检查失败！请检查服务：pm2 logs tokenfree 或 tail -f tokenfree.log"
    exit 1
  fi
else
  echo "  （未安装 curl，跳过健康检查）"
fi
