// pm2 部署配置：pm2 start ecosystem.config.cjs
// 密码等写在项目根 .env，由 server/index.js 启动时读取（覆盖 pm2 缓存的旧值）
// 修改 .env 后：./deploy.sh 或 pm2 reload tokenfree --update-env
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
      },
    },
  ],
};
