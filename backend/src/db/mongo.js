"use strict";
const { MongoClient } = require("mongodb");
const config = require("../config");
const logger = require("../utils/logger");

let settingsCol;
let symbolListCol;
let rawMarketDataCol;

async function connectMongo() {
  const client = new MongoClient(config.mongo.uri, {
    serverSelectionTimeoutMS: 5000,
  });
  await client.connect();
  const db = client.db(config.mongo.db);
  settingsCol = db.collection("settings");
  logger.info("MongoDB connected");

  await db.createCollection("symbol_list");
  symbolListCol = db.collection("symbol_list");
  await symbolListCol.createIndex({ updatedAt: -1 });

  await db.createCollection("raw_market_data");
  rawMarketDataCol = db.collection("raw_market_data");
  await rawMarketDataCol.createIndex({ dex: 1 }, { unique: true });
  try { await rawMarketDataCol.dropIndex("updatedAt_1"); } catch (_) {}
}

function getSettingsCollection() {
  if (!settingsCol) throw new Error("Mongo settings not initialized");
  return settingsCol;
}

function getSymbolListCollection() {
  if (!symbolListCol) throw new Error("Mongo not initialized");
  return symbolListCol;
}

function getRawMarketDataCollection() {
  if (!rawMarketDataCol) throw new Error("Mongo not initialized");
  return rawMarketDataCol;
}

module.exports = { connectMongo, getSettingsCollection, getSymbolListCollection, getRawMarketDataCollection };
