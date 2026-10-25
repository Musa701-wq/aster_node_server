"use strict";

// aster-scrapper - standalone process.
// Refreshes mongo raw_market_data every 3 min. No dependency on the API backend.
const { connectMongo } = require("./src/mongo");
const scraper = require("./src/scraper");
const logger = require("./src/logger");

const MONGO_RETRY_MS = 10000;
const MAX_MONGO_RETRIES = 10;

// ── Global error safety nets ────────────────────────────────────────────────
// Catch anything that would otherwise silently kill the process so we always
// have a trace in the log, and let pm2/supervisor restart us.
process.on("uncaughtException", (err) => {
  logger.error(`UNCAUGHT EXCEPTION: ${err.message}${err.stack ? `\n${err.stack}` : ""}`);
  logger.error("uncaughtException -> exiting (expected restart by pm2)");
  try { scraper.stop(); } catch (_) {}
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const detail = reason instanceof Error ? `${reason.message}${reason.stack ? `\n${reason.stack}` : ""}` : String(reason);
  logger.error(`UNHANDLED REJECTION: ${detail}`);
  logger.error("unhandledRejection -> exiting (expected restart by pm2)");
  try { scraper.stop(); } catch (_) {}
  process.exit(1);
});

process.on("exit", (code) => {
  logger.info(`aster-scrapper process exiting with code ${code}`);
});

// Graceful shutdown for pm2 (SIGINT/SIGTERM)
process.on("SIGINT", () => { logger.info("Received SIGINT, shutting down"); scraper.stop(); process.exit(0); });
process.on("SIGTERM", () => { logger.info("Received SIGTERM, shutting down"); scraper.stop(); process.exit(0); });

// ── Mongo connect with retry ────────────────────────────────────────────────
async function connectMongoWithRetry() {
  let attempt = 0;
  const started = Date.now();
  while (attempt < MAX_MONGO_RETRIES) {
    attempt++;
    try {
      await connectMongo();
      logger.info(`MongoDB connected on attempt ${attempt} (after ${Date.now() - started}ms)`);
      return;
    } catch (err) {
      logger.error(
        `MongoDB connect attempt ${attempt}/${MAX_MONGO_RETRIES} failed: ${err.message}${
          err.stack ? `\n${err.stack}` : ""
        }`
      );
      if (attempt < MAX_MONGO_RETRIES) {
        logger.info(`Retrying MongoDB in ${MONGO_RETRY_MS / 1000}s...`);
        await new Promise((r) => setTimeout(r, MONGO_RETRY_MS));
      }
    }
  }
  throw new Error(`Could not connect to MongoDB after ${MAX_MONGO_RETRIES} attempts`);
}

async function main() {
  logger.info(`aster-scrapper process started (PID ${process.pid}, node ${process.version})`);
  await connectMongoWithRetry();
  scraper.start();
}

main().catch((err) => {
  logger.error(`aster-scrapper failed to start: ${err.message}${err.stack ? `\n${err.stack}` : ""}`);
  process.exit(1);
});