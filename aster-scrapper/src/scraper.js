"use strict";

const config = require("./config");
const { getRawMarketDataCollection, getSymbolListCollection } = require("./mongo");
const fetcher = require("./fetcher");
const logger = require("./logger");

let scraperTimer = null;
let running = false;
let consecutiveFailures = 0;
let lastRunAt = null;
let lastSuccessAt = null;
let lastFailedAt = null;
let totalRunRuns = 0;
let totalSuccessRuns = 0;
const MAX_CONSECUTIVE_FAILURES = 5;
const TICK_TIMEOUT_MS = 60 * 1000;

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  // Critical: consume the timeout rejection so it never becomes an unhandled
  // rejection if the main promise wins the race. This previously crashed the process.
  timeout.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function tick() {
  const dex = config.dex;
  const rawCol = getRawMarketDataCollection();
  const startTime = Date.now();
  lastRunAt = new Date();

  logger.info("tick: starting run");
  try {
    // Fetch exchange info
    const exchangeInfo = await withTimeout(
      fetcher.fetchJson(`${config.aster.baseUrl}/fapi/v3/exchangeInfo`, 30000, "exchangeInfo"),
      TICK_TIMEOUT_MS,
      "tick"
    );
    const symbols = (exchangeInfo.symbols || []).map((s) => s.symbol);
    logger.info(`tick: exchangeInfo returned ${symbols.length} symbols`);

    if (!symbols || symbols.length === 0) {
      throw new Error("No symbols received from exchangeInfo");
    }

    // Update symbol list
    await getSymbolListCollection().updateOne(
      { dex },
      { $set: { dex, symbols, updatedAt: new Date() } },
      { upsert: true }
    );
    logger.info(`tick: symbol_list updated (${symbols.length} symbols)`);

    // Fetch market data
    const data = await withTimeout(
      fetcher.fetchMarketData(symbols, exchangeInfo),
      TICK_TIMEOUT_MS,
      "fetchMarketData"
    );

    if (!data || data.length === 0) {
      throw new Error("Fetched empty data");
    }

    // Get previous data for comparison
    const doc = await rawCol.findOne({ dex });
    const prevData = doc?.data || [];

    // Update database
    await rawCol.updateOne(
      { dex },
      { $set: { dex, data, prevData, updatedAt: new Date() } },
      { upsert: true }
    );

    const duration = Date.now() - startTime;
    consecutiveFailures = 0;
    lastSuccessAt = new Date();
    totalRunRuns++;
    logger.info(`tick: updated ${data.length} markets (took ${duration}ms)`);
    return data.length;
  } catch (err) {
    consecutiveFailures++;
    lastFailedAt = new Date();
    logger.error(
      `tick failed (attempt ${consecutiveFailures}): ${err.message}${err.stack ? `\n${err.stack}` : ""}`
    );

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      logger.warn(
        `⚠️ ${consecutiveFailures} consecutive failures! Check network, API, or database.`
      );
    }
    return null;
  }
}

async function runLoop() {
  if (running) {
    logger.warn("runLoop: already running, skipping this cycle");
    return;
  }

  running = true;
  const loopStart = Date.now();
  try {
    await tick();
  } catch (err) {
    logger.error(`runLoop critical error: ${err.message}${err.stack ? `\n${err.stack}` : ""}`);
  } finally {
    running = false;
    logger.debug(`runLoop cycle finished in ${Date.now() - loopStart}ms`);

    // Always reschedule the next run, even if there was an error.
    // Schedule relative to when this cycle started so the cadence stays fixed
    // at intervalMs (otherwise a slow tick drifts the next run later and later).
    if (scraperTimer) {
      clearTimeout(scraperTimer);
      scraperTimer = null;
    }
    const nextDelay = Math.max(0, config.intervalMs - (Date.now() - loopStart));
    scraperTimer = setTimeout(runLoop, nextDelay);
    logger.info(`Next scraper run scheduled in ${(nextDelay / 1000).toFixed(0)}s`);
  }
}

function start() {
  if (scraperTimer) {
    logger.info("Raw data scraper already running");
    return;
  }

  consecutiveFailures = 0;
  logger.info(`Starting raw data scraper (every ${config.intervalMs / 1000}s)`);

  // Start the first run immediately
  scraperTimer = setTimeout(runLoop, 0);
}

function stop() {
  if (scraperTimer) {
    clearTimeout(scraperTimer);
    scraperTimer = null;
    running = false;
    logger.info("Raw data scraper stopped");
  } else {
    logger.warn("Raw data scraper is not running");
  }
}

function getStatus() {
  return {
    running,
    timerActive: !!scraperTimer,
    consecutiveFailures,
    lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
    lastSuccessAt: lastSuccessAt ? lastSuccessAt.toISOString() : null,
    lastFailedAt: lastFailedAt ? lastFailedAt.toISOString() : null,
    healthy: lastSuccessAt !== null && (lastFailedAt === null || lastFailedAt < lastSuccessAt),
  };
}

module.exports = {
  start,
  stop,
  getStatus,
};