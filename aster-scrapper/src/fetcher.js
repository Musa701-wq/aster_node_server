"use strict";

const config = require("./config");
const logger = require("./logger");

const logoByAssetCode = new Map();

function updateLogoMap(entries) {
  if (!Array.isArray(entries)) return;
  for (const row of entries) {
    const code = row?.assetCode;
    const url = row?.logoUrl;
    if (!code || !url || typeof url !== "string") continue;
    const trimmed = url.trim();
    if (!trimmed.startsWith("http")) continue;
    logoByAssetCode.set(String(code).trim().toUpperCase(), trimmed);
  }
}

function getIconUrl(symbol) {
  if (!symbol) return "/hyperliquid.png";
  const base = symbol.replace(/USDT$/i, "").toUpperCase();
  const aster = logoByAssetCode.get(base);
  return aster || `https://bin.bnbstatic.com/static/assets/logos/${base}.png`;
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

async function fetchJson(url, timeout = 20000, label = "") {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    const text = await res.text();
    const ms = Date.now() - started;
    if (!text) throw new Error(`Empty response from Aster API (HTTP ${res.status})`);
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error(`JSON parse error: ${text.substring(0, 200)}`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
    logger.debug(`fetchJson ok [${label || url}] ${ms}ms`);
    return data;
  } catch (err) {
    const ms = Date.now() - started;
    logger.error(`fetchJson failed [${label || url}] after ${ms}ms: ${err.message}`);
    throw err;
  } finally {
    clearTimeout(id);
  }
}

async function fetchLogos() {
  try {
    const res = await fetch(config.aster.logoApi, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    const list = data?.data;
    if (Array.isArray(list) && (data.success === true || data.code === "000000")) {
      updateLogoMap(list);
    }
  } catch (err) {
    logger.warn(`Logo fetch failed: ${err.message}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchOpenInterestInBatches(symbols, baseUrl) {
  const BATCH_SIZE = 10;
  const BATCH_DELAY_MS = 200;
  const TIMEOUT_MS = 10000;
  const results = new Map();
  const promises = [];
  let okCount = 0;
  let failCount = 0;
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    promises.push(
      sleep(i === 0 ? 0 : BATCH_DELAY_MS).then(() =>
        Promise.all(
          batch.map((sym) =>
            fetchJson(`${baseUrl}/fapi/v1/openInterest?symbol=${sym}`, TIMEOUT_MS, `openInterest:${sym}`)
              .then((o) => {
                okCount++;
                return o;
              })
              .catch(() => {
                failCount++;
                return null;
              })
          )
        ).then((ois) => {
          for (let j = 0; j < batch.length; j++) {
            if (ois[j]) results.set(batch[j], ois[j]);
          }
        })
      )
    );
  }
  return Promise.all(promises).then(() => {
    logger.info(`OpenInterest batches done: ${okCount} ok, ${failCount} failed (of ${symbols.length})`);
    return results;
  });
}

async function fetchMarketData(symbols, existingExchangeInfo) {
  const { baseUrl } = config.aster;
  const dex = config.dex;

  const exchangeInfoPromise = existingExchangeInfo
    ? Promise.resolve(existingExchangeInfo)
    : fetchJson(`${baseUrl}/fapi/v3/exchangeInfo`);

  await fetchLogos();

  logger.info("fetchMarketData: fetching price/ticker/premium endpoints...");
  const [exchangeInfo, prices, tickers24h, premiums] = await Promise.all([
    exchangeInfoPromise,
    fetchJson(`${baseUrl}/fapi/v3/ticker/price`, 20000, "ticker/price"),
    fetchJson(`${baseUrl}/fapi/v3/ticker/24hr`, 20000, "ticker/24hr"),
    fetchJson(`${baseUrl}/fapi/v3/premiumIndex`, 20000, "premiumIndex"),
  ]);
  logger.info(
    `fetchMarketData: endpoints ok (prices=${Array.isArray(prices) ? prices.length : 1}, ` +
    `tickers=${Array.isArray(tickers24h) ? tickers24h.length : 1}, ` +
    `premiums=${Array.isArray(premiums) ? premiums.length : 1})`
  );

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
  const toFetchOI = Array.from(symbolSet).filter((s) => infoMap.has(s));
  logger.info(`fetchMarketData: fetching open interest for ${toFetchOI.length} symbols...`);
  const oiMap = await fetchOpenInterestInBatches(toFetchOI, baseUrl);
  logger.info(`fetchMarketData: got OI for ${oiMap.size} of ${toFetchOI.length} symbols`);

  const results = [];
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
      dex,
      symbol: info.symbol,
      fullSymbol: `${dex}:${info.symbol}`,
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

  logger.debug(`fetchMarketData: built ${results.length} market rows`);
  return results;
}

module.exports = { fetchJson, fetchMarketData };
