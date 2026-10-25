"use strict";

const { getSettingsCollection, getRawMarketDataCollection } = require("../db/mongo");
const cache = require("../utils/cache");
const SUMMARY_CACHE_TTL = 3 * 60 * 1000;

function filterByCategory(rows, categoryParam) {
  if (!categoryParam) return rows;
  const cats = String(categoryParam)
    .split(",")
    .map((cat) => cat.trim().toLowerCase())
    .filter(Boolean);
  if (cats.length === 0) return rows;
  return rows.filter(
    (m) => Array.isArray(m.categories) && m.categories.some((c) => cats.includes(c))
  );
}

async function getLimit(req, res, next) {
  try {
    const settingsCol = getSettingsCollection();
    const settings = await settingsCol.findOne({ id: "global" });
    res.json({ success: true, limit: settings?.tokenLimit || 20 });
  } catch (err) {
    next(err);
  }
}

async function getRawRows(dex) {
  const RawDataService = require("../services/rawDataService");
  return RawDataService.getAllData(dex || "aster");
}

async function getAll(req, res, next) {
  try {
    const limit = parseInt(req.query.limit) || 200;
    const skip = parseInt(req.query.skip) || 0;

    let rows = await getRawRows(req.query.dex);
    rows = rows.filter((m) => !m.isDelisted);
    rows = filterByCategory(rows, req.query.category);
    rows.sort((a, b) => (b.volume24hUSD || 0) - (a.volume24hUSD || 0));

    res.json({ success: true, data: rows.slice(skip, skip + limit) });
  } catch (err) {
    next(err);
  }
}

async function getDex(req, res, next) {
  try {
    const limit = parseInt(req.query.limit) || 200;
    const skip = parseInt(req.query.skip) || 0;

    let rows = await getRawRows(req.params.dex);
    rows = rows.filter((m) => !m.isDelisted && m.dex === req.params.dex);
    rows = filterByCategory(rows, req.query.category);
    rows.sort((a, b) => (b.volume24hUSD || 0) - (a.volume24hUSD || 0));

    res.json({ success: true, data: rows.slice(skip, skip + limit) });
  } catch (err) {
    next(err);
  }
}

async function getCategory(req, res, next) {
  try {
    let rows = await getRawRows(req.query.dex);
    rows = rows.filter((m) => !m.isDelisted);
    rows = filterByCategory(rows, req.params.category);
    if (req.query.dex) rows = rows.filter((m) => m.dex === req.query.dex);
    rows.sort((a, b) => (b.volume24hUSD || 0) - (a.volume24hUSD || 0));

    res.json({ success: true, data: rows.slice(0, parseInt(req.query.limit) || 200) });
  } catch (err) {
    next(err);
  }
}

async function getRawDex(req, res, next) {
  try {
    const RawDataService = require("../services/rawDataService");
    const data = await RawDataService.fetchJson(
      `${require("../config").aster.baseUrl}/fapi/v3/exchangeInfo`
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function getRawFullDex(req, res, next) {
  try {
    const RawDataService = require("../services/rawDataService");
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 50));
    const sortBy = req.query.sortBy || "volume24hUSD";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const category = req.query.category || null;

    const result = await RawDataService.getRawFullData(
      req.params.dex,
      page,
      limit,
      sortBy,
      sortOrder,
      category
    );

    res.json({ success: true, data: result.data, pagination: result.pagination });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Market search (Aster: all 619 markets + category tabs + live filter)
// ---------------------------------------------------------------------------

const SEARCH_TAB_ORDER = [
  "all",
  "top",
  "meme",
  "ai",
  "etf",
  "semiconductor",
  "commodities",
  "stock",
  "live",
];

// Same presentation rules as getRawFullData: funding in percent, OI doubled.
function presentMarket(m) {
  return {
    ...m,
    funding8hPct: (m.funding8hPct ?? 0) * 100,
    openInterestUSD: (m.openInterestUSD ?? 0) * 2,
  };
}

function baseAsset(symbol) {
  const s = String(symbol || "");
  return s.endsWith("USDT") ? s.slice(0, -4) : s;
}

// Mirrors RawDataService.getCategories() for rows written by older scrapers
// that predate the `categories` field.
function deriveCategories(m) {
  const ut = m.underlyingSubType;
  const st = m.symbolType;
  if (!Array.isArray(ut)) return st === 1 ? ["stock"] : [];
  const cats = [];
  if (ut.includes("Top")) cats.push("top");
  if (ut.includes("Meme")) cats.push("meme");
  if (ut.includes("AI")) cats.push("ai");
  if (ut.includes("ETF")) cats.push("etf");
  if (ut.includes("Semiconductor")) cats.push("semiconductor");
  if (ut.includes("Commodities") || ut.includes("RWA")) cats.push("commodities");
  if (ut.includes("STOCK") || st === 1) cats.push("stock");
  return cats;
}

// Fills in fields missing from older DB documents so search behaves the same
// regardless of which schema wrote the row.
function normalizeMarket(m) {
  const symbol = String(m.symbol || "");
  const categories =
    Array.isArray(m.categories) && m.categories.length > 0 ? m.categories : deriveCategories(m);
  return {
    ...m,
    categories,
    displayName:
      m.displayName ||
      (symbol.endsWith("USDT") ? `${symbol.replace(/USDT$/i, "")}-USDT` : symbol),
    fullSymbol: m.fullSymbol || `${m.dex || "aster"}:${symbol}`,
    isDelisted: typeof m.isDelisted === "boolean" ? m.isDelisted : m.status !== "TRADING",
  };
}

// Returns a relevance score, or null when the token does not match at all.
function tokenScore(m, token) {
  const symbol = String(m.symbol || "").toLowerCase();
  const base = baseAsset(m.symbol).toLowerCase();
  const name = String(m.displayName || "").toLowerCase();
  const cats = Array.isArray(m.categories) ? m.categories : [];
  const sub = Array.isArray(m.underlyingSubType)
    ? m.underlyingSubType.map((x) => String(x).toLowerCase())
    : [];

  // NOTE: fullSymbol ("aster:BTCUSDT") is deliberately not searched — its dex
  // prefix would make every row match a query like "aster".
  if (symbol === token) return 1000;
  if (base === token) return 950;
  if (name === token) return 900;
  if (symbol.startsWith(token) || base.startsWith(token)) return 750;
  if (name.startsWith(token)) return 700;
  if (symbol.includes(token) || base.includes(token)) return 550;
  if (name.includes(token)) return 450;
  if (cats.some((c) => c === token)) return 400;
  if (cats.some((c) => c.startsWith(token))) return 350;
  if (sub.some((s) => s.startsWith(token))) return 300;
  if (cats.some((c) => c.includes(token)) || sub.some((s) => s.includes(token))) return 250;
  return null;
}

function scoreMarket(m, tokens) {
  let total = 0;
  for (const token of tokens) {
    const score = tokenScore(m, token);
    if (score === null) return null;
    total += score;
  }
  return total;
}

function isLive(m) {
  return !m.isDelisted && m.status === "TRADING";
}

async function searchMarkets(req, res, next) {
  try {
    const dex = req.params.dex || req.query.dex || "aster";
    const q = String(req.query.q || req.query.query || "").trim();
    const category = req.query.category || null;
    const live = /^(1|true|yes)$/i.test(String(req.query.live || ""));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

    let rows = await getRawRows(dex);
    rows = Array.isArray(rows) ? rows.map(normalizeMarket) : [];

    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);

    // 1) Text search across symbol / base asset / display name / categories
    let matched = rows.map((m) => ({ m, score: scoreMarket(m, tokens) }));
    matched = tokens.length > 0 ? matched.filter((x) => x.score !== null) : matched;

    // 2) Tab counts (computed on the search result, before tab filtering)
    const counts = { all: matched.length, live: 0 };
    for (const { m } of matched) {
      if (isLive(m)) counts.live++;
      const cats = Array.isArray(m.categories) ? m.categories : [];
      for (const cat of cats) counts[cat] = (counts[cat] || 0) + 1;
    }
    const tabs = SEARCH_TAB_ORDER.map((name) => ({ name, count: counts[name] || 0 }));

    // 3) Tab filters
    if (live) matched = matched.filter(({ m }) => isLive(m));
    if (category) {
      const cats = String(category)
        .split(",")
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
      if (cats.length > 0) {
        matched = matched.filter(
          ({ m }) => Array.isArray(m.categories) && m.categories.some((c) => cats.includes(c))
        );
      }
    }

    // 4) Sorting: relevance when searching, otherwise any requested field
    const sortBy = req.query.sortBy;
    const order = req.query.sortOrder === "asc" ? 1 : -1;

    if (tokens.length > 0 && !sortBy) {
      matched.sort((a, b) => b.score - a.score || (b.m.volume24hUSD || 0) - (a.m.volume24hUSD || 0));
    } else {
      const field = sortBy || "volume24hUSD";
      matched.sort((a, b) => {
        const av = a.m[field];
        const bv = b.m[field];
        if (typeof av === "string" || typeof bv === "string") {
          return order * String(av ?? "").localeCompare(String(bv ?? ""));
        }
        return order * ((av ?? 0) - (bv ?? 0));
      });
    }

    // 5) Paginate
    const total = matched.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const data = matched.slice(start, start + limit).map(({ m }) => presentMarket(m));

    res.json({
      success: true,
      query: q,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      tabs,
      totalMarkets: rows.length,
      filters: {
        q: q || null,
        category: category || null,
        live,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getBubbleNexus(req, res, next) {
  try {
    const limit = parseInt(req.query.limit) || 300;

    let rows = await getRawRows(req.query.dex);
    rows = rows.filter((m) => !m.isDelisted);
    rows = rows.filter((m) => Array.isArray(m.categories) && m.categories.length > 0);
    rows = filterByCategory(rows, req.query.category);
    rows.sort((a, b) => (b.volume24hUSD || 0) - (a.volume24hUSD || 0));

    res.json({ success: true, data: rows.slice(0, limit) });
  } catch (err) {
    next(err);
  }
}

async function getDexSymbol(req, res, next) {
  try {
    const rows = await getRawRows(req.params.dex);
    const market = rows.find(
      (m) => m.dex === req.params.dex && m.symbol === req.params.symbol.toUpperCase()
    );

    if (!market) {
      return res.status(404).json({ success: false });
    }

    res.json({ success: true, data: market });
  } catch (err) {
    next(err);
  }
}

function toDisplayName(symbol) {
  return symbol.endsWith("USDT") ? `${symbol.replace(/USDT$/i, "")}-USDT` : symbol;
}

async function ensureRawData(dex) {
  const rawCol = getRawMarketDataCollection();
  const doc = await rawCol.findOne({ dex });
  if (doc?.data?.length) return { data: doc.data, updatedAt: doc.updatedAt };
  if (doc?.prevData?.length) return { data: doc.prevData, updatedAt: doc.updatedAt };
  return { data: [], updatedAt: null };
}

async function getVolumeSummary(req, res, next) {
  try {
    const dex = req.query.dex || "aster";
    const cacheKey = `vol:${dex}`;
    let result = cache.get(cacheKey);
    if (result) return res.json(result);

    const { data, updatedAt } = await ensureRawData(dex);
    const markets = [...data].sort((a, b) => (b.volume24hUSD || 0) - (a.volume24hUSD || 0));

    const totalVolume24h = markets.reduce((sum, m) => sum + (m.volume24hUSD || 0), 0);
    const count = markets.length;
    const avgVolume = count > 0 ? totalVolume24h / count : 0;

    const topContributors = markets.slice(0, 5).map((m, i) => ({
      rank: i + 1,
      symbol: m.symbol,
      displayName: toDisplayName(m.symbol),
      iconUrl: m.iconUrl,
      volume24hUSD: m.volume24hUSD || 0,
    }));

    const top = markets[0];
    const mostActive = top
      ? {
          symbol: top.symbol,
          displayName: toDisplayName(top.symbol),
          iconUrl: top.iconUrl,
          volume24hUSD: top.volume24hUSD || 0,
          percentageOfTotal: totalVolume24h > 0 ? ((top.volume24hUSD || 0) / totalVolume24h) * 100 : 0,
        }
      : null;

    result = {
      success: true,
      data: {
        totalVolume24h,
        avgVolume,
        count,
        topContributors,
        mostActive,
        updatedAt,
      },
    };
    cache.set(cacheKey, result, SUMMARY_CACHE_TTL);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getOISummary(req, res, next) {
  try {
    const dex = req.query.dex || "aster";
    const cacheKey = `oi:${dex}`;
    let result = cache.get(cacheKey);
    if (result) return res.json(result);

    const { data, updatedAt } = await ensureRawData(dex);
    const markets = data.filter((m) => m.openInterestUSD > 0);

    const totalOpenInterest = markets.reduce((sum, m) => sum + ((m.openInterestUSD || 0) * 2), 0);

    let longOI = 0;
    let shortOI = 0;
    for (const m of markets) {
      const oi = (m.openInterestUSD || 0) * 2;
      if ((m.funding8hPct || 0) > 0) longOI += oi;
      else if ((m.funding8hPct || 0) < 0) shortOI += oi;
      else {
        longOI += oi / 2;
        shortOI += oi / 2;
      }
    }
    const totalForPct = longOI + shortOI;
    const totalLongPercent = totalForPct > 0 ? (longOI / totalForPct) * 100 : 50;
    const totalShortPercent = totalForPct > 0 ? (shortOI / totalForPct) * 100 : 50;

    const sortedByOI = [...markets].sort((a, b) => ((b.openInterestUSD || 0) * 2) - ((a.openInterestUSD || 0) * 2));

    const topByOI = sortedByOI.slice(0, 5).map((m, i) => ({
      rank: i + 1,
      symbol: m.symbol,
      displayName: toDisplayName(m.symbol),
      iconUrl: m.iconUrl,
      openInterestUSD: (m.openInterestUSD || 0) * 2,
      percentageOfTotal: totalOpenInterest > 0 ? (((m.openInterestUSD || 0) * 2) / totalOpenInterest) * 100 : 0,
    }));

    function calcLongShortPct(funding) {
      const f = funding || 0;
      const deviation = Math.min(Math.abs(f) * 5000, 20);
      if (f > 0) return { longPercent: 50 + deviation, shortPercent: 50 - deviation };
      return { longPercent: 50 - deviation, shortPercent: 50 + deviation };
    }

    const withFunding = markets.filter((m) => m.funding8hPct !== 0 && m.funding8hPct !== undefined);
    withFunding.sort((a, b) => Math.abs(a.funding8hPct) - Math.abs(b.funding8hPct));
    const mostBalancedData = withFunding.length > 0 ? withFunding[0] : null;
    const mostBalanced = mostBalancedData ? {
      symbol: mostBalancedData.symbol,
      displayName: toDisplayName(mostBalancedData.symbol),
      iconUrl: mostBalancedData.iconUrl,
      ...calcLongShortPct(mostBalancedData.funding8hPct),
    } : null;

    withFunding.sort((a, b) => (a.funding8hPct || 0) - (b.funding8hPct || 0));
    const mostShortBiasedData = withFunding.length > 0 ? withFunding[0] : null;
    const mostShortBiased = mostShortBiasedData ? {
      symbol: mostShortBiasedData.symbol,
      displayName: toDisplayName(mostShortBiasedData.symbol),
      iconUrl: mostShortBiasedData.iconUrl,
      ...calcLongShortPct(mostShortBiasedData.funding8hPct),
    } : null;

    result = {
      success: true,
      data: {
        totalOpenInterest,
        totalLongPercent,
        totalShortPercent,
        count: markets.length,
        topByOI,
        mostBalanced,
        mostShortBiased,
        updatedAt,
      },
    };
    cache.set(cacheKey, result, SUMMARY_CACHE_TTL);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getFundingSummary(req, res, next) {
  try {
    const dex = req.query.dex || "aster";
    const cacheKey = `fund:${dex}`;
    let result = cache.get(cacheKey);
    if (result) return res.json(result);

    const { data, updatedAt } = await ensureRawData(dex);
    const rates = data.map((m) => m.funding8hPct || 0);

    const pos = rates.filter((r) => r > 0).length;
    const neg = rates.filter((r) => r < 0).length;
    const zero = rates.filter((r) => r === 0).length;
    const avgRate = rates.length > 0 ? rates.reduce((s, r) => s + r, 0) / rates.length : 0;

    const withFunding = data.filter((m) => m.funding8hPct !== 0 && m.funding8hPct !== undefined);

    withFunding.sort((a, b) => (b.funding8hPct || 0) - (a.funding8hPct || 0));
    const topPos = withFunding.length > 0 ? {
      symbol: withFunding[0].symbol,
      displayName: toDisplayName(withFunding[0].symbol),
      iconUrl: withFunding[0].iconUrl,
      rateHourlyPct: ((withFunding[0].funding8hPct || 0) / 8) * 100,
    } : null;

    withFunding.sort((a, b) => (a.funding8hPct || 0) - (b.funding8hPct || 0));
    const topNeg = withFunding.length > 0 ? {
      symbol: withFunding[0].symbol,
      displayName: toDisplayName(withFunding[0].symbol),
      iconUrl: withFunding[0].iconUrl,
      rateHourlyPct: ((withFunding[0].funding8hPct || 0) / 8) * 100,
    } : null;

    const mean = avgRate;
    const variance = rates.length > 0
      ? rates.reduce((s, r) => s + (r - mean) ** 2, 0) / rates.length
      : 0;
    const stdDev = Math.sqrt(variance);
    const volatilityPct = stdDev * 100;

    // Ensure volatility is always returned, default to "none" if calculation fails
    let volatilityValue = "none";
    if (!isNaN(volatilityPct) && isFinite(volatilityPct)) {
      const absVol = Math.abs(volatilityPct);
      const decimals = absVol < 0.1 ? 4 : absVol < 1 ? 2 : 1;
      volatilityValue = `\u00B1${volatilityPct.toFixed(decimals)}%`;
    }

    result = {
      success: true,
      data: {
        avgRatePct: avgRate * 100,
        pos,
        neg,
        zero,
        topPos,
        topNeg,
        volatility: volatilityValue,
        updatedAt,
      },
    };
    cache.set(cacheKey, result, SUMMARY_CACHE_TTL);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getTopMovers(req, res, next) {
  try {
    const dex = req.query.dex || "aster";
    const cacheKey = `movers:${dex}`;
    let result = cache.get(cacheKey);
    if (result) return res.json(result);

    const { data, updatedAt } = await ensureRawData(dex);
    const sorted = [...data].sort((a, b) => (b.change24hPct || 0) - (a.change24hPct || 0));

    const gainers = sorted.slice(0, 3).map((m) => ({
      symbol: m.symbol,
      displayName: toDisplayName(m.symbol),
      iconUrl: m.iconUrl,
      change24hPct: m.change24hPct || 0,
      lastPrice: m.lastPrice || 0,
    }));

    const losers = sorted.reverse().slice(0, 3).map((m) => ({
      symbol: m.symbol,
      displayName: toDisplayName(m.symbol),
      iconUrl: m.iconUrl,
      change24hPct: m.change24hPct || 0,
      lastPrice: m.lastPrice || 0,
    }));

    result = { success: true, data: { gainers, losers, updatedAt } };
    cache.set(cacheKey, result, SUMMARY_CACHE_TTL);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getSectorPerformance(req, res, next) {
  try {
    const dex = req.query.dex || "aster";
    const cacheKey = `sector:${dex}`;
    let result = cache.get(cacheKey);
    if (result) return res.json(result);

    const { data, updatedAt } = await ensureRawData(dex);
    const totalCoins = data.length;

    const sectorMap = new Map();
    const seen = new Set();
    let totalVolume24h = 0;
    let totalOpenInterest = 0;

    for (const m of data) {
      totalVolume24h += m.volume24hUSD || 0;
      totalOpenInterest += m.openInterestUSD || 0;

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

      if (cats.length === 0) continue;
      if (!seen.has(m.symbol)) { seen.add(m.symbol); }

      for (const cat of cats) {
        if (!sectorMap.has(cat)) {
          sectorMap.set(cat, { totalChange: 0, totalVolume: 0, totalOI: 0, coinCount: 0 });
        }
        const s = sectorMap.get(cat);
        s.totalChange += m.change24hPct || 0;
        s.totalVolume += m.volume24hUSD || 0;
        s.totalOI += m.openInterestUSD || 0;
        s.coinCount++;
      }
    }

    const totalSectorCoins = seen.size;

    const sectors = [];
    for (const [name, s] of sectorMap) {
      sectors.push({
        name,
        avgChange24hPct: s.totalChange / s.coinCount,
        volume24hUSD: s.totalVolume,
        volumePct: totalVolume24h > 0 ? (s.totalVolume / totalVolume24h) * 100 : 0,
        openInterestUSD: s.totalOI,
        coinCount: s.coinCount,
      });
    }

    sectors.sort((a, b) => b.avgChange24hPct - a.avgChange24hPct);

    const best = sectors[0] || null;
    const worst = sectors[sectors.length - 1] || null;
    const positiveSectors = sectors.filter((s) => s.avgChange24hPct > 0).length;

    result = {
      success: true,
      data: {
        totalCoins,
        totalSectorCoins,
        totalVolume24hUSD: totalVolume24h,
        totalOpenInterestUSD: totalOpenInterest,
        bestSector: best ? { name: best.name, change24hPct: best.avgChange24hPct } : null,
        worstSector: worst ? { name: worst.name, change24hPct: worst.avgChange24hPct } : null,
        positiveSectors,
        totalSectors: sectors.length,
        sectors,
        updatedAt,
      },
    };
    cache.set(cacheKey, result, SUMMARY_CACHE_TTL);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

function calcSqueezeScore(market) {
  const funding = Math.abs(market.funding8hPct || 0);
  const fundingComp = Math.min(funding * 50000, 40);

  const oi = (market.openInterestUSD || 0);
  const oiComp = Math.min((Math.log10(oi + 1) / 7) * 35, 35);

  const change = market.change24hPct || 0;
  const fundSigned = market.funding8hPct || 0;
  let momentumComp = 0;
  let direction = "NEUTRAL";

  if (fundSigned > 0.00005 && change < -1) {
    momentumComp = 25;
    direction = "SHORT_SQUEEZE";
  } else if (fundSigned < -0.00005 && change > 1) {
    momentumComp = 25;
    direction = "LONG_SQUEEZE";
  } else if (fundSigned > 0.00005 && change < 0) {
    momentumComp = 15;
    direction = "SHORT_PRESSURE";
  } else if (fundSigned < -0.00005 && change > 0) {
    momentumComp = 15;
    direction = "LONG_PRESSURE";
  } else if (funding > 0.0001) {
    momentumComp = 10;
    direction = "HIGH_FUNDING";
  }

  const total = fundingComp + oiComp + momentumComp;
  let riskLevel = "MINIMAL";
  if (total >= 70) riskLevel = "HIGH";
  else if (total >= 40) riskLevel = "MEDIUM";
  else if (total >= 20) riskLevel = "LOW";

  return { fundingComp, oiComp, momentumComp, total, direction, riskLevel };
}

async function getSqueezeScore(req, res, next) {
  try {
    const dex = req.query.dex || "aster";
    const cacheKey = `squeeze:${dex}`;
    let result = cache.get(cacheKey);
    if (result) return res.json(result);

    const { data, updatedAt } = await ensureRawData(dex);

    const scores = data.map((m) => ({
      symbol: m.symbol,
      iconUrl: m.iconUrl,
      ...calcSqueezeScore(m),
    }));

    scores.sort((a, b) => b.total - a.total);

    const pick = (arr) => arr.slice(0, 3).map(({ symbol, iconUrl, total }) => ({ symbol, iconUrl, score: Math.round(total) }));

    result = {
      success: true,
      data: {
        highRisk: pick(scores.filter((s) => s.riskLevel === "HIGH")),
        mediumRisk: pick(scores.filter((s) => s.riskLevel === "MEDIUM")),
        lowRisk: pick(scores.filter((s) => s.riskLevel === "LOW")),
        minimalRisk: pick(scores.filter((s) => s.riskLevel === "MINIMAL")),
        updatedAt,
      },
    };
    cache.set(cacheKey, result, SUMMARY_CACHE_TTL);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getFundingRates(req, res, next) {
  try {
    const dex = req.query.dex || "aster";
    const cacheKey = `fundRates:${dex}`;
    let result = cache.get(cacheKey);
    if (result) return res.json(result);

    const { data, updatedAt } = await ensureRawData(dex);

    const rates = data
      .filter((m) => m.funding8hPct != null)
      .map((m) => ({
        symbol: m.symbol,
        iconUrl: m.iconUrl,
        funding8hPct: m.funding8hPct,
      }));

    const values = rates.map((r) => r.funding8hPct);
    const avgFunding8hPct = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const lowest = values.length > 0 ? Math.min(...values) : 0;
    const highest = values.length > 0 ? Math.max(...values) : 0;

    result = {
      success: true,
      data: {
        rates,
        avgFunding8hPct,
        lowestFunding8hPct: lowest,
        highestFunding8hPct: highest,
        count: rates.length,
        updatedAt,
      },
    };
    cache.set(cacheKey, result, SUMMARY_CACHE_TTL);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getHeatmap(req, res, next) {
  try {
    const { category, q } = req.query;

    let rows = await getRawRows(req.query.dex);
    rows = rows.filter((m) => !m.isDelisted);

    // Apply search filter
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      rows = rows.filter((m) => rx.test(m.symbol) || rx.test(m.displayName));
    }

    // Apply category filter
    if (category) {
      const cats = String(category)
        .split(",")
        .map((cat) => cat.trim().toLowerCase())
        .filter(Boolean);
      if (cats.length > 0) {
        rows = rows.filter(
          (m) => Array.isArray(m.categories) && m.categories.some((c) => cats.includes(c))
        );
      }
    }

    // Build category counts (from unfiltered data, only search-filtered)
    let categorySource = await getRawRows(req.query.dex);
    categorySource = categorySource.filter((m) => !m.isDelisted);
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      categorySource = categorySource.filter((m) => rx.test(m.symbol) || rx.test(m.displayName));
    }

    const categoryCounts = new Map();
    for (const m of categorySource) {
      const cats = Array.isArray(m.categories) ? m.categories : [];
      if (cats.length === 0) {
        categoryCounts.set(null, (categoryCounts.get(null) || 0) + 1);
      } else {
        for (const cat of cats) {
          categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
        }
      }
    }
    const categories = Array.from(categoryCounts.entries())
      .map(([name, count]) => ({ name: name || "uncategorized", count }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Map to heatmap shape and sort by volume descending
    const data = rows
      .map((m) => ({
        symbol: m.symbol,
        name: m.displayName,
        lastPrice: m.lastPrice || 0,
        volume24hUSD: m.volume24hUSD || 0,
        change24hPct: m.change24hPct || 0,
        funding8hPct: m.funding8hPct || 0,
        openInterestUSD: (m.openInterestUSD || 0) * 2,
        iconUrl: m.iconUrl || `https://app.asterdex.com/tokens/${(m.symbol || "").toUpperCase()}.svg`,
        category: Array.isArray(m.categories) && m.categories.length > 0 ? m.categories[0] : null,
      }))
      .sort((a, b) => b.volume24hUSD - a.volume24hUSD);

    res.json({
      success: true,
      count: data.length,
      data,
      categories,
      filters: {
        category: category || null,
        query: q || null,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getLimit,
  getAll,
  getBubbleNexus,
  getDex,
  getCategory,
  getDexSymbol,
  getRawDex,
  getRawFullDex,
  getVolumeSummary,
  getOISummary,
  getFundingSummary,
  getTopMovers,
  getSectorPerformance,
  getSqueezeScore,
  getFundingRates,
  getHeatmap,
  searchMarkets,
};