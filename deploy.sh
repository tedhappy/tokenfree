#!/usr/bin/env bash
# TokenFree 一键部署/更新脚本 —— 在服务器项目根目录运行
# 首次: ADMIN_PASSWORD=你的强密码 ./deploy.sh
# 之后更新: git pull && ./deploy.sh
set -e
cd "$(dirname "$0")"

# 1. 检查环境
if ! command -v node >/dev/null; then
  echo "✗ 未安装 Node.js，请先安装 20+："
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs"
  exit 1
fi
echo "✓ Node $(node -v)"

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

# 3. 安装依赖 + 构建
echo "[1/3] 安装依赖..."
npm install --no-fund --no-audit
echo "[2/3] 构建前台..."
npm run build

# 4. 启动（pm2 优先）
echo "[3/3] 启动服务..."
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
echo ""
echo "=========================================="
echo " 部署完成！"
echo " 前台: http://${IP:-服务器IP}:4321"
echo " 后台: http://${IP:-服务器IP}:4321/admin/"
echo " 健康检查: http://${IP:-服务器IP}:4321/api/uptime"
echo "=========================================="
