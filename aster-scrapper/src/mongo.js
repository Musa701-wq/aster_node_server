"use strict";

const { MongoClient } = require("mongodb");
const config = require("./config");
const logger = require("./logger");

let client;
let symbolListCol;
let rawMarketDataCol;

async function connectMongo() {
  client = new MongoClient(config.mongo.uri, {
    serverSelectionTimeoutMS: 5000,
  });

  // Surface driver-level events so silent disconnects are not missed.
  client.on("serverHeartbeatFailed", (ev) => {
    logger.warn(`Mongo heartbeat failed: ${ev.reason?.message || "unknown"}`);
  });
  client.on("topologyClosed", () => logger.error("Mongo topology closed"));
  client.on("topologyDescriptionChanged", (ev) => {
    logger.debug(`Mongo topology changed: ${ev.newDescription?.type || "unknown"}`);
  });
  client.on("error", (err) => logger.error("Mongo client error:", err));

  await client.connect();
  const db = client.db(config.mongo.db);
  logger.info("MongoDB connected");

  await db.createCollection("symbol_list");
  symbolListCol = db.collection("symbol_list");
  await symbolListCol.createIndex({ updatedAt: -1 });

  await db.createCollection("raw_market_data");
  rawMarketDataCol = db.collection("raw_market_data");
  await rawMarketDataCol.createIndex({ dex: 1 }, { unique: true });
  try { await rawMarketDataCol.dropIndex("updatedAt_1"); } catch (_) {}
}

function getSymbolListCollection() {
  if (!symbolListCol) throw new Error("Mongo not initialized");
  return symbolListCol;
}

function getRawMarketDataCollection() {
  if (!rawMarketDataCol) throw new Error("Mongo not initialized");
  return rawMarketDataCol;
}

module.exports = { connectMongo, getSymbolListCollection, getRawMarketDataCollection };