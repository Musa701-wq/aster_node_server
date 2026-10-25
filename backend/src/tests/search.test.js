"use strict";

const assert = require("assert");
const app = require("../app");
const rawDataService = require("../services/rawDataService");

// Fixture rows shaped exactly like RawDataService.fetchMarketData output.
function market(overrides) {
  return {
    dex: "aster",
    symbol: "BTCUSDT",
    fullSymbol: "aster:BTCUSDT",
    displayName: "BTC-USDT",
    categories: ["top"],
    status: "TRADING",
    isDelisted: false,
    symbolType: 0,
    contractType: "PERPETUAL",
    underlyingSubType: ["Top"],
    lastPrice: 82197.5,
    markPrice: 82190.1,
    change24hPct: -0.53,
    funding8hPct: 0.000055, // stored as a fraction; the API must expose percent
    volume24hUSD: 763410000,
    openInterestQty: 1000,
    openInterestUSD: 82197500, // the API must double this
    iconUrl: "https://example.com/BTC.png",
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

const FIXTURES = [
  market({}),
  market({
    symbol: "ETHUSDT",
    fullSymbol: "aster:ETHUSDT",
    displayName: "ETH-USDT",
    lastPrice: 2485.28,
    volume24hUSD: 720870000,
    change24hPct: -3.0,
  }),
  market({
    symbol: "XAUUSD1",
    fullSymbol: "aster:XAUUSD1",
    displayName: "XAUUSD1",
    categories: ["commodities"],
    underlyingSubType: ["Commodities"],
    lastPrice: 4189.27,
    volume24hUSD: 299430000,
  }),
  market({
    symbol: "SOLUSDT",
    fullSymbol: "aster:SOLUSDT",
    displayName: "SOL-USDT",
    lastPrice: 109.82,
    volume24hUSD: 146250000,
  }),
  // Higher volume than SOLUSDT, so a volume sort would rank it first.
  market({
    symbol: "SOLXUSD1",
    fullSymbol: "aster:SOLXUSD1",
    displayName: "SOLXUSD1",
    categories: ["stock"],
    underlyingSubType: null,
    symbolType: 1,
    lastPrice: 120.4,
    volume24hUSD: 900000000,
  }),
  market({
    symbol: "DOGEUSDT",
    fullSymbol: "aster:DOGEUSDT",
    displayName: "DOGE-USDT",
    categories: ["meme"],
    underlyingSubType: ["Meme"],
    lastPrice: 0.08,
    volume24hUSD: 23840000,
  }),
  market({
    symbol: "\u9F99\u867EUSDT",
    fullSymbol: "aster:\u9F99\u867EUSDT",
    displayName: "\u9F99\u867E-USDT",
    categories: ["meme"],
    underlyingSubType: ["Meme"],
    lastPrice: 0.05,
    volume24hUSD: 7100000,
    change24hPct: 16.99,
  }),
  market({
    symbol: "FETUSDT",
    fullSymbol: "aster:FETUSDT",
    displayName: "FET-USDT",
    categories: ["ai"],
    underlyingSubType: ["AI"],
    lastPrice: 0.42,
    volume24hUSD: 5000000,
  }),
  market({
    symbol: "SPYUSD1",
    fullSymbol: "aster:SPYUSD1",
    displayName: "SPYUSD1",
    categories: ["etf"],
    underlyingSubType: ["ETF"],
    lastPrice: 610.5,
    volume24hUSD: 4000000,
  }),
  market({
    symbol: "SOUSD1",
    fullSymbol: "aster:SOUSD1",
    displayName: "SOUSD1",
    categories: ["semiconductor"],
    underlyingSubType: ["Semiconductor"],
    lastPrice: 1636.29,
    volume24hUSD: 84660000,
  }),
  market({
    symbol: "METAUSD1",
    fullSymbol: "aster:METAUSD1",
    displayName: "METAUSD1",
    categories: ["stock"],
    underlyingSubType: null,
    symbolType: 1,
    lastPrice: 721.96,
    volume24hUSD: 7150000,
  }),
  market({
    symbol: "OLDUSDT",
    fullSymbol: "aster:OLDUSDT",
    displayName: "OLD-USDT",
    status: "BREAK",
    isDelisted: true,
    categories: ["top"],
    underlyingSubType: ["Top"],
    lastPrice: 1,
    volume24hUSD: 1000,
  }),
];

let server;

function base() {
  return `http://127.0.0.1:${server.address().port}`;
}

async function search(params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();
  const res = await fetch(`${base()}/perp/search${qs ? `?${qs}` : ""}`);
  assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
  return res.json();
}

function tabCount(body, name) {
  const tab = body.tabs.find((t) => t.name === name);
  assert.ok(tab, `tab "${name}" missing`);
  return tab.count;
}

describe("GET /perp/search (Aster markets)", () => {
  before((done) => {
    rawDataService.getAllData = async () => FIXTURES.map((f) => ({ ...f }));
    server = app.listen(0, done);
  });

  after((done) => server.close(done));

  it("returns every market when no query is given, sorted by volume", async () => {
    const body = await search();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.pagination.total, FIXTURES.length);
    assert.strictEqual(body.totalMarkets, FIXTURES.length);
    assert.strictEqual(body.data[0].symbol, "SOLXUSD1"); // highest volume
    assert.strictEqual(body.data[1].symbol, "BTCUSDT");
  });

  it("matches an exact base asset, case-insensitively", async () => {
    const body = await search({ q: "BTC" });
    assert.strictEqual(body.pagination.total, 1);
    assert.strictEqual(body.data[0].symbol, "BTCUSDT");
    assert.strictEqual(body.query, "BTC");
  });

  it("matches a partial symbol", async () => {
    const body = await search({ q: "usdt" });
    const symbols = body.data.map((m) => m.symbol);
    for (const s of ["BTCUSDT", "ETHUSDT", "DOGEUSDT", "\u9F99\u867EUSDT", "FETUSDT", "SOLUSDT"]) {
      assert.ok(symbols.includes(s), `${s} should match "usdt"`);
    }
    assert.ok(!symbols.includes("XAUUSD1"), "XAUUSD1 should not match");
    assert.ok(!symbols.includes("METAUSD1"), "METAUSD1 should not match");
  });

  it("matches a market without the USDT suffix (XAUUSD1)", async () => {
    const body = await search({ q: "xau" });
    assert.strictEqual(body.pagination.total, 1);
    assert.strictEqual(body.data[0].symbol, "XAUUSD1");
  });

  it("matches a CJK market name", async () => {
    const body = await search({ q: "\u9F99\u867E" });
    assert.strictEqual(body.pagination.total, 1);
    assert.strictEqual(body.data[0].symbol, "\u9F99\u867EUSDT");
    assert.strictEqual(body.data[0].displayName, "\u9F99\u867E-USDT");
  });

  it("filters by category tab", async () => {
    const body = await search({ category: "meme" });
    assert.strictEqual(body.pagination.total, 2);
    assert.ok(body.data.every((m) => m.categories.includes("meme")));
  });

  it("combines query and category tab", async () => {
    const hit = await search({ q: "eth", category: "top" });
    assert.strictEqual(hit.pagination.total, 1);
    assert.strictEqual(hit.data[0].symbol, "ETHUSDT");

    const miss = await search({ q: "eth", category: "meme" });
    assert.strictEqual(miss.pagination.total, 0);
    assert.deepStrictEqual(miss.data, []);
  });

  it("filters live markets only", async () => {
    const body = await search({ live: "1" });
    assert.ok(body.data.every((m) => m.status === "TRADING" && !m.isDelisted));
    assert.strictEqual(body.pagination.total, FIXTURES.length - 1);
    assert.strictEqual(tabCount(body, "live"), FIXTURES.length - 1);
  });

  it("returns tab counts in UI order", async () => {
    const body = await search();
    assert.deepStrictEqual(
      body.tabs.map((t) => t.name),
      ["all", "top", "meme", "ai", "etf", "semiconductor", "commodities", "stock", "live"]
    );
    assert.strictEqual(tabCount(body, "all"), 12);
    assert.strictEqual(tabCount(body, "top"), 4); // BTC, ETH, SOL, OLD
    assert.strictEqual(tabCount(body, "meme"), 2);
    assert.strictEqual(tabCount(body, "ai"), 1);
    assert.strictEqual(tabCount(body, "etf"), 1);
    assert.strictEqual(tabCount(body, "semiconductor"), 1);
    assert.strictEqual(tabCount(body, "commodities"), 1);
    assert.strictEqual(tabCount(body, "stock"), 2); // SOLXUSD1, METAUSD1
    assert.strictEqual(tabCount(body, "live"), 11);
  });

  it("keeps tab counts independent of the selected tab", async () => {
    const all = await search({ q: "usd" });
    const meme = await search({ q: "usd", category: "meme" });

    assert.strictEqual(tabCount(all, "all"), FIXTURES.length);
    assert.strictEqual(meme.pagination.total, 2);
    assert.deepStrictEqual(
      meme.tabs.map((t) => t.count),
      all.tabs.map((t) => t.count),
      "tab counts must reflect the query, not the active tab"
    );
  });

  it("applies the same field transforms as /perp/raw-full", async () => {
    const body = await search({ q: "btc" });
    const btc = body.data[0];
    assert.strictEqual(btc.funding8hPct, 0.000055 * 100); // fraction -> percent
    assert.strictEqual(btc.openInterestUSD, 164395000); // 82197500 * 2
  });

  it("paginates", async () => {
    const p1 = await search({ limit: 4, page: 1 });
    const p2 = await search({ limit: 4, page: 2 });
    assert.strictEqual(p1.data.length, 4);
    assert.strictEqual(p1.pagination.hasNext, true);
    assert.strictEqual(p1.pagination.hasPrev, false);
    assert.strictEqual(p2.pagination.page, 2);
    assert.strictEqual(p2.pagination.hasPrev, true);
    assert.strictEqual(p1.pagination.total, FIXTURES.length);
    const overlap = p1.data.filter((m) => p2.data.some((x) => x.symbol === m.symbol));
    assert.strictEqual(overlap.length, 0, "pages must not overlap");
  });

  it("caps limit at 50", async () => {
    const body = await search({ limit: 500 });
    assert.strictEqual(body.pagination.limit, 50);
  });

  it("sorts by an explicit field", async () => {
    const asc = await search({ sortBy: "lastPrice", sortOrder: "asc" });
    const prices = asc.data.map((m) => m.lastPrice);
    assert.deepStrictEqual(prices, [...prices].sort((a, b) => a - b));
  });

  it("ranks a base-asset match above a substring match, ignoring volume", async () => {
    const body = await search({ q: "sol" });
    assert.strictEqual(body.pagination.total, 2);
    assert.strictEqual(
      body.data[0].symbol,
      "SOLUSDT",
      "exact base asset must win even though SOLXUSD1 has more volume"
    );
    assert.strictEqual(body.data[1].symbol, "SOLXUSD1");
  });

  it("does not search the dex prefix inside fullSymbol", async () => {
    // Every row has fullSymbol "aster:SYMBOL"; a naive match would return all.
    const body = await search({ q: "aster" });
    assert.strictEqual(
      body.pagination.total,
      0,
      "the dex prefix must not make every market match"
    );
    assert.strictEqual(tabCount(body, "all"), 0);
  });

  it("returns an empty result set for an unknown query", async () => {
    const body = await search({ q: "zzzznotamarket" });
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.pagination.total, 0);
    assert.deepStrictEqual(body.data, []);
    assert.strictEqual(body.pagination.totalPages, 0);
    assert.strictEqual(tabCount(body, "all"), 0);
  });

  it("does not throw when no market data is loaded", async () => {
    const original = rawDataService.getAllData;
    rawDataService.getAllData = async () => [];
    try {
      const body = await search({ q: "btc" });
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.pagination.total, 0);
      assert.strictEqual(body.totalMarkets, 0);
    } finally {
      rawDataService.getAllData = original;
    }
  });

  it("is reachable as GET /perp/search/:dex", async () => {
    const res = await fetch(`${base()}/perp/search/aster?q=btc`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data[0].symbol, "BTCUSDT");
  });
});
