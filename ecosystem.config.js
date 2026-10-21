// PM2: `pm2 start ecosystem.config.js` from the repo root
module.exports = {
  apps: [
    {
      name: 'locoxpatentes',
      script: 'src/index.js',
      // backend/.env is read from here by dotenv
      cwd: './backend',
      env: {
        NODE_ENV: 'production'
      },
      autorestart: true,
      // the server has 1 GB of RAM
      max_memory_restart: '400M'
    }
  ]
}
