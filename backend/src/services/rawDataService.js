"use strict";

const WebSocket = require("ws");
const config = require("../config");
const cache = require("../utils/cache");
const { getSymbolListCollection, getRawMarketDataCollection } = require("../db/mongo");
const { getIconUrl, updateLogoMap } = require("../utils/helpers");
const logger = require("../utils/logger");

const CACHE_KEY_PREFIX = "raw-full";
const SYMBOL_REFRESH_MS = 24 * 60 * 60 * 1000;
const LIVE_CACHE_MS = 60 * 1000;
const RATE_LIMIT_RETRY_MS = 60 * 1000;

class RateLimitError extends Error {
  constructor(msg, retryAfter = 60000) {
    super(msg);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

async function fetchJson(url, timeout = 20000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!text) {
      throw new Error(`Empty response from Aster API (HTTP ${res.status})`);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error(`JSON parse error: ${text.substring(0, 200)}`);
    }
    if (res.status === 429) {
      throw new RateLimitError(
        `Aster API rate limited: ${text.substring(0, 200)}`,
        parseInt(res.headers.get("retry-after") || "60") * 1000
      );
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
    return data;
  } finally {
    clearTimeout(id);
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getCategories(underlyingSubType, symbolType) {
  if (!underlyingSubType || !Array.isArray(underlyingSubType)) {
    if (symbolType === 1) return ["stock"];
    return [];
  }
  const cats = [];
  if (underlyingSubType.includes("Top")) cats.push("top");
  if (underlyingSubType.includes("Meme")) cats.push("meme");
  if (underlyingSubType.includes("AI")) cats.push("ai");
  if (underlyingSubType.includes("ETF")) cats.push("etf");
  if (underlyingSubType.includes("Semiconductor")) cats.push("semiconductor");
  if (underlyingSubType.includes("Commodities") || underlyingSubType.includes("RWA")) cats.push("commodities");
  if (underlyingSubType.includes("STOCK") || symbolType === 1) cats.push("stock");
  return cats;
}

class RawDataService {
  constructor() {
    this.ws = null;
    this.wsClients = new Set();
    this.wsReconnectDelay = 1000;
    this.started = false;
    this.wsTimer = null;
    this.dexName = config.perpDexes[0] || "aster";
    this.rateLimited = false;
    this.rateLimitRetryTimer = null;
    this.latestTickerBySymbol = new Map();
    this.latestMarkBySymbol = new Map();
  }

  async getSymbolList(dex) {
    const dbCol = getSymbolListCollection();
    const stored = await dbCol.findOne({ dex });

    if (stored && stored.updatedAt && Date.now() - stored.updatedAt.getTime() < SYMBOL_REFRESH_MS) {
      return stored.symbols || [];
    }

    const data = await fetchJson(`${config.aster.baseUrl}/fapi/v3/exchangeInfo`);
    const symbols = (data.symbols || []).map((s) => s.symbol);

    await dbCol.updateOne(
      { dex },
      { $set: { dex, symbols, updatedAt: new Date() } },
      { upsert: true }
    );

    return symbols;
  }

  fetchMarketData(symbols, existingExchangeInfo) {
    const { baseUrl } = config.aster;

    const exchangeInfoPromise = existingExchangeInfo
      ? Promise.resolve(existingExchangeInfo)
      : fetchJson(`${baseUrl}/fapi/v3/exchangeInfo`);

    return Promise.all([
      exchangeInfoPromise,
      fetchJson(`${baseUrl}/fapi/v3/ticker/price`),
      fetchJson(`${baseUrl}/fapi/v3/ticker/24hr`),
      fetchJson(`${baseUrl}/fapi/v3/premiumIndex`),
      this.fetchLogos(),
    ]).then(([exchangeInfo, prices, tickers24h, premiums, logoRes]) => {
      this._updateLogos(logoRes);

      const priceMap = new Map(
        (Array.isArray(prices) ? prices : [prices]).map((x) => [x.symbol, x])
      );

      const tickerMap = new Map(
        (Array.isArray(tickers24h) ? tickers24h : [tickers24h]).map((x) => [x.symbol, x])
      );

      const premiumMap = new Map(
        (Array.isArray(premiums) ? premiums : [premiums]).map((x) => [x.symbol, x])
      );

      const infoMap = new Map(
        (exchangeInfo.symbols || []).map((x) => [x.symbol, x])
      );

      const symbolSet = new Set(symbols);
      const results = [];
      const BATCH_SIZE = 50;

      return this._fetchOpenInterestInBatches(
        Array.from(symbolSet).filter((s) => infoMap.has(s)),
        baseUrl
      ).then((oiMap) => {
        for (const symbol of symbolSet) {
          const info = infoMap.get(symbol);
          if (!info) continue;

          const ticker = tickerMap.get(symbol);
          const price = priceMap.get(symbol);
          const premium = premiumMap.get(symbol);
          const oi = oiMap.get(symbol);

          const lastPrice = num(price?.price);
          const markPrice = num(premium?.markPrice);
          const change24hPct = num(ticker?.priceChangePercent);
          const funding8hPct = num(premium?.lastFundingRate);
          const volume24hUSD = num(ticker?.quoteVolume);
          const openInterestQty = num(oi?.openInterest);
          const priceForOI = markPrice || lastPrice;

          results.push({
            dex: this.dexName,
            symbol: info.symbol,
            fullSymbol: `${this.dexName}:${info.symbol}`,
            displayName: info.symbol.endsWith("USDT")
              ? `${info.symbol.replace(/USDT$/i, "")}-USDT`
              : info.symbol,
            categories: getCategories(info.underlyingSubType, info.symbolType),
            status: info.status,
            isDelisted: info.status !== "TRADING",
            symbolType: info.symbolType,
            contractType: info.contractType,
            underlyingSubType: info.underlyingSubType || null,
            lastPrice,
            markPrice,
            change24hPct,
            funding8hPct,
            volume24hUSD,
            openInterestQty,
            openInterestUSD: openInterestQty * priceForOI,
            openInterestDisplayUSD: openInterestQty * priceForOI * 2,
            iconUrl: getIconUrl(info.symbol),
            updatedAt: new Date(),
          });
        }

        return results;
      });
    });
  }

  _fetchOpenInterestInBatches(symbols, baseUrl) {
    const BATCH_SIZE = 50;
    const results = new Map();

    const promises = [];
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      promises.push(
        Promise.all(
          batch.map((sym) =>
            fetchJson(`${baseUrl}/fapi/v1/openInterest?symbol=${sym}`, 3000).catch(() => null)
          )
        ).then((ois) => {
          for (let j = 0; j < batch.length; j++) {
            if (ois[j]) {
              results.set(batch[j], ois[j]);
            }
          }
        })
      );
    }

    return Promise.all(promises).then(() => results);
  }

  async fetchLogos() {
    try {
      const res = await fetch(config.aster.logoApi, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      return data;
    } catch (err) {
      logger.warn(`Raw data logo fetch failed: ${err.message}`);
      return {};
    }
  }

  _updateLogos(logoRes) {
    const list = logoRes?.data;
    if (Array.isArray(list) && (logoRes.success === true || logoRes.code === "000000")) {
      updateLogoMap(list);
    }
  }

  async _storeRawDataInDB(dex, data) {
    try {
      const col = getRawMarketDataCollection();
      await col.updateOne(
        { dex },
        { $set: { dex, data, updatedAt: new Date() } },
        { upsert: true }
      );
    } catch (err) {
      logger.warn(`Failed to store raw data in DB: ${err.message}`);
    }
  }

  async _loadRawDataFromDB(dex) {
    try {
      const col = getRawMarketDataCollection();
      const doc = await col.findOne({ dex });
      return doc ? doc.data : null;
    } catch (err) {
      logger.warn(`Failed to load raw data from DB: ${err.message}`);
      return null;
    }
  }

  _scheduleRateLimitRetry(dex, cacheKey) {
    if (this.rateLimitRetryTimer) {
      clearTimeout(this.rateLimitRetryTimer);
    }
    this.rateLimitRetryTimer = setTimeout(async () => {
      this.rateLimited = false;
      logger.info(`Rate limit retry: attempting to fetch fresh data for ${dex}`);
      try {
        const symbols = await this.getSymbolList(dex);
        const freshData = await this.fetchMarketData(symbols);
        cache.set(cacheKey, freshData);
        await this._storeRawDataInDB(dex, freshData);
        logger.info(`Rate limit retry: successfully refreshed data for ${dex}`);
      } catch (err) {
        if (err instanceof RateLimitError) {
          logger.warn(`Rate limit retry: still rate limited for ${dex}, retrying later`);
          this.rateLimited = true;
          this._scheduleRateLimitRetry(dex, cacheKey);
        } else {
          logger.warn(`Rate limit retry: fetch failed for ${dex}: ${err.message}`);
        }
      }
    }, RATE_LIMIT_RETRY_MS);
  }

  async getAllData(dex) {
    const cacheKey = `${CACHE_KEY_PREFIX}:${dex}`;
    let allData = cache.get(cacheKey);
    if (allData) return allData;
    allData = await this._loadRawDataFromDB(dex);
    if (allData) cache.set(cacheKey, allData);
    return allData || [];
  }

  async getRawFullData(dex, page, limit, sortBy, sortOrder, category = null) {
    const cacheKey = `${CACHE_KEY_PREFIX}:${dex}`;
    let allData = cache.get(cacheKey);

    if (!allData) {
      allData = await this._loadRawDataFromDB(dex);

      if (!allData) {
        try {
          const symbols = await this.getSymbolList(dex);
          allData = await this.fetchMarketData(symbols);
          cache.set(cacheKey, allData);
          await this._storeRawDataInDB(dex, allData);
        } catch (err) {
          allData = await this._loadRawDataFromDB(dex);
          if (!allData) throw err;
          logger.warn(`Fetch failed, serving stale DB data: ${err.message}`);
        }
      } else {
        cache.set(cacheKey, allData);
      }
    }

    if (!allData || allData.length === 0) {
      return { data: [], pagination: { page: 1, limit: 1, total: 0, totalPages: 0, hasNext: false, hasPrev: false } };
    }

    // Apply category filter if provided
    let filteredData = allData;
    if (category) {
      const categories = String(category)
        .split(",")
        .map((cat) => cat.trim().toLowerCase())
        .filter(Boolean);

      if (categories.length > 0) {
        filteredData = allData.filter((m) => {
          const ut = m.underlyingSubType;
          const st = m.symbolType;
          let cats = [];

          if (ut && Array.isArray(ut)) {
            if (ut.includes("Top")) cats.push("top");
            if (ut.includes("Meme")) cats.push("meme");
            if (ut.includes("AI")) cats.push("ai");
            if (ut.includes("ETF")) cats.push("etf");
            if (ut.includes("Semiconductor")) cats.push("semiconductor");
            if (ut.includes("Commodities") || ut.includes("RWA")) cats.push("commodities");
            if (ut.includes("STOCK") || st === 1) cats.push("stock");
          } else if (st === 1) {
            cats.push("stock");
          }

          return categories.some((cat) => cats.includes(cat));
        });
      }
    }

    const field = sortBy || "volume24hUSD";
    const order = sortOrder;

    filteredData.sort((a, b) => {
      if (typeof a[field] === "string") {
        return order * a[field].localeCompare(b[field]);
      }
      return order * ((a[field] ?? 0) - (b[field] ?? 0));
    });

    const total = filteredData.length;
    const maxLimit = Math.min(50, Math.max(1, limit || 50));
    const pg = Math.max(1, page || 1);
    const totalPages = Math.ceil(total / maxLimit);
    const start = (pg - 1) * maxLimit;
    const data = filteredData
      .slice(start, start + maxLimit)
      .map((m) => ({
        ...m,
        funding8hPct: (m.funding8hPct ?? 0) * 100,
        openInterestUSD: (m.openInterestUSD ?? 0) * 2,
      }));

    return {
      data,
      pagination: {
        page: pg,
        limit: maxLimit,
        total,
        totalPages,
        hasNext: pg < totalPages,
        hasPrev: pg > 1,
      },
    };
  }

  connectWS() {
    if (this.ws) return;
    const url = `wss://fstream.asterdex.com/stream?streams=!markPrice@arr/!ticker@arr`;
    logger.info(`RawDataService: Connecting to AsterDEX WS for ${this.dexName}...`);

    const ws = new WebSocket(url);

    ws.on("open", () => {
      logger.info(`RawDataService: Connected to AsterDEX WS`);
      this.wsReconnectDelay = 1000;
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.stream === "!markPrice@arr" && Array.isArray(msg.data)) {
          const data = msg.data.map((u) => {
            const item = {
              eventTime: u.E,
              symbol: u.s,
              markPrice: u.p,
              estimatedMarkPrice: u.P,
              fundingRate: num(u.r) * 100,
              nextFundingTime: u.T,
            };
            this.latestMarkBySymbol.set(u.s, item);
            const ticker = this.latestTickerBySymbol.get(u.s);
            if (ticker) ticker.fundingRate = item.fundingRate;
            return item;
          });
          this._broadcastFor({ type: "markPrice_update", data });
        } else if (msg.stream === "!ticker@arr" && Array.isArray(msg.data)) {
          const data = msg.data.map((u) => {
            const item = {
              eventTime: u.E,
              symbol: u.s,
              lastPrice: num(u.c),
              change24hPct: num(u.P),
              fundingRate: this.latestMarkBySymbol.get(u.s)?.fundingRate ?? 0,
            };
            this.latestTickerBySymbol.set(u.s, item);
            return item;
          });
          this._broadcastFor({ type: "ticker_update", data });
        }
      } catch (_) {}
    });

    ws.on("close", () => {
      logger.info("RawDataService: AsterDEX WS disconnected");
      this.ws = null;
      if (this.started) {
        this.wsTimer = setTimeout(() => this.connectWS(), this.wsReconnectDelay);
        this.wsReconnectDelay = Math.min(this.wsReconnectDelay * 2, 30000);
      }
    });

    ws.on("error", (err) => logger.error(`RawDataService WS error: ${err.message}`));
    this.ws = ws;
  }

  _broadcastFor(payload) {
    const { data, ...rest } = payload;
    for (const client of this.wsClients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      const watch = client.watchSymbols;
      const filtered = watch ? data.filter((x) => watch.has(x.symbol)) : data;
      if (filtered.length === 0) continue;
      client.send(JSON.stringify({ ...rest, data: filtered }));
    }
  }

  _sendSnapshot(ws) {
    const watch = ws.watchSymbols;
    const pick = (arr) =>
      watch ? arr.filter((x) => watch.has(x.symbol)) : arr;

    const tickers = pick(Array.from(this.latestTickerBySymbol.values()));
    if (tickers.length > 0) {
      ws.send(JSON.stringify({ type: "ticker_update", data: tickers }));
    }

    const marks = pick(Array.from(this.latestMarkBySymbol.values()));
    if (marks.length > 0) {
      ws.send(JSON.stringify({ type: "markPrice_update", data: marks }));
    }
  }

  registerClient(ws, symbols) {
    ws.watchSymbols = Array.isArray(symbols) && symbols.length > 0
      ? new Set(symbols.map((s) => String(s).toUpperCase()))
      : null;
    this.wsClients.add(ws);
    this._sendSnapshot(ws);
    if (!this.started) {
      this.started = true;
      this.connectWS();
    }
  }

  unregisterClient(ws) {
    this.wsClients.delete(ws);
    if (this.wsClients.size === 0 && this.ws) {
      this.ws.close();
      this.ws = null;
      this.started = false;
    }
  }

  static getInstance() {
    if (!global._rawDataService) {
      global._rawDataService = new RawDataService();
    }
    return global._rawDataService;
  }
}

module.exports = RawDataService.getInstance();
module.exports.fetchJson = fetchJson;