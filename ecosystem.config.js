// pm2 ecosystem - two separate processes:
//   aster-api      -> REST + WebSocket server (reads raw_market_data from mongo)
//   aster-scrapper -> refreshes raw_market_data every 3 min (writes mongo)
//
// Run:  pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "aster-api",
      script: "backend/src/server.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: "300M",
      env: { NODE_ENV: "production" },
    },
    {
      name: "aster-scrapper",
      script: "aster-scrapper/index.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: "300M",
      env: { NODE_ENV: "production" },
    },
  ],
};