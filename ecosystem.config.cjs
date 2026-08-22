// pm2 部署配置：pm2 start ecosystem.config.cjs
// 首次部署：npm install && npm run build && ADMIN_PASSWORD=xxx pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'tokenfree',
      script: 'server/index.js',
      cwd: __dirname,
      instances: 1, // JSON 文件存储，单实例避免写冲突
      exec_mode: 'fork',
      max_memory_restart: '300M', // 2G 服务器保护
      env: {
        NODE_ENV: 'production',
        PORT: 4321,
        MONITOR_INTERVAL_MIN: 30,
        // ADMIN_PASSWORD 必须设置：pm2 start ecosystem.config.cjs --env production 前 export，或直接改这里
      },
    },
  ],
};
