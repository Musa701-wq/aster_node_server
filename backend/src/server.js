"use strict";

const http = require("http");
const app = require("./app");
const config = require("./config");
const { connectMongo } = require("./db/mongo");
const { initWS } = require("./services/ws");
const logger = require("./utils/logger");

async function main() {
  await connectMongo();

  // Create HTTP server
  const server = http.createServer(app);

  server.listen(config.server.port, () => {
    logger.info(`Server running on port ${config.server.port}`);
  });

  // WebSocket server (raw real-time stream only)
  initWS(server);

  // Note: the raw data scraper runs as a SEPARATE process (aster-scrapper via pm2).
  // This API process only reads raw_market_data from mongo and streams WS updates.
}

main().catch((err) => {
  logger.error(`Server failed to start: ${err.message}`);
  process.exit(1);
});