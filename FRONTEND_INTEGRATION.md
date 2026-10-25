# Frontend Integration Guide - Aster Raw Data

This guide covers how to integrate the Aster raw data REST API and WebSocket streaming into your frontend application.

---

## API Endpoints

### 1. REST: Get paginated, sorted market data

```
GET http://localhost:4000/perp/raw-full/aster
```

**Query Parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `limit` | number | 50 | Items per page (max 50) |
| `sortBy` | string | `volume24hUSD` | Any field in the response |
| `sortOrder` | string | `desc` | `asc` or `desc` |

**Response**

```json
{
  "success": true,
  "data": [
    {
      "dex": "aster",
      "symbol": "BTCUSDT",
      "status": "TRADING",
      "symbolType": 0,
      "contractType": "PERPETUAL",
      "lastPrice": 67000.5,
      "markPrice": 66998.2,
      "change24hPct": 2.35,
      "funding8hPct": 0.01,
      "volume24hUSD": 50000000,
      "openInterestQty": 1250.5,
      "openInterestUSD": 83997500,
      "iconUrl": "https://bin.bnbstatic.com/static/assets/logos/BTC.png",
      "updatedAt": "2026-07-29T12:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 524,
    "totalPages": 11,
    "hasNext": true,
    "hasPrev": false
  }
}
```

---

### 2. REST: Get raw exchange info (all symbols, no filtering)

```
GET http://localhost:4000/perp/raw/aster
```

Returns the raw `exchangeInfo` response from AsterDEX API — all symbols with status, type, and contract info. No filtering, no caching.

---

### 3. REST: Search markets

```
GET http://localhost:4000/perp/search
```

Searches **every Aster market** (all 619) by symbol, base asset, display name or category, and combines it with the category tabs and the live filter in a single call. Use this for the search box, the tab bar, and the paginated table at once.

**Query Parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| `q` | string | `""` | Search text. Case-insensitive. Multiple words are AND-ed (`q=btc perp`). Matches symbol (`BTCUSDT`), base asset (`BTC`), display name (`BTC-USDT`) and category (`meme`). |
| `category` | string | `null` | One or more tabs: `top`, `meme`, `ai`, `etf`, `semiconductor`, `commodities`, `stock`. Comma-separate for several: `category=meme,ai`. Omit for `All`. |
| `live` | boolean | `false` | `live=1` returns only markets with `status === "TRADING"` (the `LIVE` tab). |
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page (max 50) |
| `sortBy` | string | relevance / `volume24hUSD` | Any field in the response. When `q` is set and `sortBy` is omitted, results are ranked by relevance (exact base asset > prefix > substring) with volume as the tie-breaker. |
| `sortOrder` | string | `desc` | `asc` or `desc`. Only used when `sortBy` is set. |
| `dex` | string | `aster` | Also accepted as a path segment: `GET /perp/search/aster` |

**Response**

```json
{
  "success": true,
  "query": "btc",
  "data": [
    {
      "dex": "aster",
      "symbol": "BTCUSDT",
      "fullSymbol": "aster:BTCUSDT",
      "displayName": "BTC-USDT",
      "categories": ["top"],
      "status": "TRADING",
      "isDelisted": false,
      "lastPrice": 82197.5,
      "markPrice": 82190.1,
      "change24hPct": -0.53,
      "funding8hPct": 0.0055,
      "volume24hUSD": 763410000,
      "openInterestQty": 1000,
      "openInterestUSD": 164395000,
      "iconUrl": "https://bin.bnbstatic.com/static/assets/logos/BTC.png",
      "updatedAt": "2026-10-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  },
  "tabs": [
    { "name": "all", "count": 5 },
    { "name": "top", "count": 1 },
    { "name": "meme", "count": 0 },
    { "name": "ai", "count": 0 },
    { "name": "etf", "count": 0 },
    { "name": "semiconductor", "count": 0 },
    { "name": "commodities", "count": 0 },
    { "name": "stock", "count": 1 },
    { "name": "live", "count": 5 }
  ],
  "totalMarkets": 619,
  "filters": { "q": "btc", "category": null, "live": false }
}
```

**Notes**

- `tabs` counts are always computed from the **search result** (`q`) *before* the active tab is applied, so `Top (123)` stays correct while the user types regardless of which tab is selected.
- `funding8hPct` is returned in **percent** and `openInterestUSD` is the **2x (long+short)** figure — identical to `/perp/raw-full`.
- The echoed search text is available both as `query` (top level) and `filters.q`.
- Empty result sets return `success: true`, `data: []` and `total: 0` (no error), so the UI can show "no results" without special-casing.

**Examples**

```js
// Search box (debounced)
const r = await fetch("/perp/search?q=btc&limit=20");

// Tab bar with live filter
const meme = await fetch("/perp/search?category=meme&live=1&page=1&limit=50");

// Type-ahead ranking: exact base asset first, then prefixes, then substrings
const s = await fetch("/perp/search?q=sol"); // SOLUSDT before SOLXUSD1
```

---

### 4. WebSocket: Real-time data streaming

**Connect:** `ws://localhost:4000` (same origin as REST)

**Subscribe to raw stream:**

```json
{ "type": "subscribe", "stream": "raw" }
```

**Messages received from server:**

```json
{ "type": "ticker_update", "data": [...] }
```

Each ticker update object contains AsterDEX fields:
- `s` — symbol
- `c` — last price
- `P` — 24h change percent
- `q` — 24h volume

```json
{ "type": "markPrice_update", "data": [...] }
```

Each mark price update object contains:
- `s` — symbol
- `p` — mark price
- `r` — last funding rate

**Unsubscribe:**

```json
{ "type": "unsubscribe", "stream": "raw" }
```

---

## Integration Examples

### Vanilla JS: Combined REST + WebSocket

```js
async function fetchRawMarkets(dex = "aster", page = 1, limit = 50, sortBy = "volume24hUSD", sortOrder = "desc") {
  const params = new URLSearchParams({ page, limit, sortBy, sortOrder });
  const res = await fetch(`http://localhost:4000/perp/raw-full/${dex}?${params}`);
  return await res.json();
}

function connectRawStream(dex = "aster", onTicker, onMarkPrice) {
  const ws = new WebSocket("ws://localhost:4000");

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "subscribe", stream: "raw" }));
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "ticker_update") onTicker(msg.data);
    if (msg.type === "markPrice_update") onMarkPrice(msg.data);
  };

  ws.onclose = () => {
    console.log("WS disconnected, reconnecting...");
    setTimeout(() => connectRawStream(dex, onTicker, onMarkPrice), 3000);
  };

  return ws;
}

// Usage
let marketsMap = new Map();

// Initial load
fetchRawMarkets("aster", 1, 50).then((result) => {
  for (const m of result.data) marketsMap.set(m.symbol, m);
  renderTable(Array.from(marketsMap.values()));
});

// Real-time updates
connectRawStream("aster",
  (tickerUpdates) => {
    for (const u of tickerUpdates) {
      const m = marketsMap.get(u.s);
      if (m) { m.lastPrice = u.c; m.change24hPct = u.P; m.volume24hUSD = u.q; }
    }
    renderTable(Array.from(marketsMap.values()));
  },
  (markPriceUpdates) => {
    for (const u of markPriceUpdates) {
      const m = marketsMap.get(u.s);
      if (m) { m.markPrice = u.p; m.funding8hPct = u.r; }
    }
    renderTable(Array.from(marketsMap.values()));
  }
);
```

---

### React Hook Example

```jsx
import { useState, useEffect, useRef } from "react";

function useRawMarkets(dex = "aster") {
  const [markets, setMarkets] = useState([]);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const wsRef = useRef(null);
  const marketsRef = useRef(new Map());

  useEffect(() => {
    let isCancelled = false;

    async function init() {
      setLoading(true);
      const result = await fetchRawMarkets(dex, 1, 50);
      if (!isCancelled) {
        setMarkets(result.data);
        setPagination(result.pagination);
        setLoading(false);
        marketsRef.current.clear();
        for (const m of result.data) marketsRef.current.set(m.symbol, m);
      }
    }

    init();

    wsRef.current = new WebSocket("ws://localhost:4000");
    wsRef.current.onopen = () => {
      wsRef.current.send(JSON.stringify({ type: "subscribe", stream: "raw" }));
    };
    wsRef.current.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "ticker_update") {
        for (const u of msg.data) {
          const m = marketsRef.current.get(u.s);
          if (m) { m.lastPrice = u.c; m.change24hPct = u.P; m.volume24hUSD = u.q; }
        }
      }
      if (msg.type === "markPrice_update") {
        for (const u of msg.data) {
          const m = marketsRef.current.get(u.s);
          if (m) { m.markPrice = u.p; m.funding8hPct = u.r; }
        }
      }
      setMarkets(Array.from(marketsRef.current.values()));
    };

    return () => {
      isCancelled = true;
      if (wsRef.current) wsRef.current.close();
    };
  }, [dex]);

  const changePage = async (page, sortBy, sortOrder) => {
    const result = await fetchRawMarkets(dex, page, 50, sortBy, sortOrder);
    marketsRef.current.clear();
    for (const m of result.data) marketsRef.current.set(m.symbol, m);
    setMarkets(result.data);
    setPagination(result.pagination);
  };

  return { markets, pagination, loading, changePage };
}
```

---

### WS Connection from Frontend

**Important:** The `Origin` header is automatically set by the browser based on the domain your frontend is served from. If you serve your frontend from `https://bubblenexus.com`, the browser will automatically include `Origin: https://bubblenexus.com` in the WebSocket handshake, and the server will recognize it as a legitimate client.

If you're developing locally (e.g., `localhost:3000`), the Origin will be `http://localhost:3000` which is NOT in the whitelist. During development, you can add your local origin to the `VALID_ORIGINS` set in `backend/src/services/ws.js` temporarily.

```jsx
function MarketTable() {
  const { markets, pagination, loading, changePage } = useRawMarkets();

  if (loading) return <div>Loading markets...</div>;

  return (
    <table>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Price</th>
          <th>24h Change</th>
          <th>24h Volume</th>
          <th>Funding (8h)</th>
          <th>Open Interest</th>
          <th>Icon</th>
        </tr>
      </thead>
      <tbody>
        {markets.map((m) => (
          <tr key={m.symbol}>
            <td>{m.symbol}</td>
            <td>{m.lastPrice.toLocaleString()}</td>
            <td style={{ color: m.change24hPct >= 0 ? "green" : "red" }}>
              {m.change24hPct?.toFixed(2)}%
            </td>
            <td>{m.volume24hUSD?.toLocaleString()}</td>
            <td>{m.funding8hPct?.toFixed(4)}%</td>
            <td>{m.openInterestUSD?.toLocaleString()}</td>
            <td>
              <img src={m.iconUrl} alt={m.symbol} width="24" height="24" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

---

## Key Architecture Notes

| Concern | Details |
|---|---|
| **REST caching** | Server caches live data for 1 minute in memory. Multiple calls within 1 min return the same cached data. No client-side caching needed. |
| **Symbol list** | Stored in MongoDB (`symbol_list` collection), auto-refreshed every 24 hours by the server. No frontend work needed. |
| **WebSocket** | AsterDEX WS connects to the server when the first raw client subscribes. Disconnects when last raw client unsubscribes. |
| **Reconnection** | Implement 3s retry in `ws.onclose` for WS resilience. |
| **Icons** | Each market has `iconUrl` — AsterDEX logo if available, otherwise Binance CDN fallback (`https://bin.bnbstatic.com/static/assets/logos/{BASE}.png`). |
| **Pagination** | Max 50 items per page. Use `page` + `limit` params. Use `sortBy` + `sortOrder` for any field (`symbol`, `lastPrice`, `change24hPct`, `funding8hPct`, `volume24hUSD`, `openInterestQty`, `openInterestUSD`, etc.). |
| **Data freshness** | REST data is up to 1 minute old (cached). WS updates are real-time from AsterDEX WebSocket stream. |
| **Origin restriction** | Scraper and RawDataService only start when clients connect from `bubblenexus.com` or `www.bubblenexus.com`. Non-whitelisted origins are still accepted for API calls and WS connections, but they do not trigger the scraper or RawDataService lifecycle. Scraper stops when all bubblenexus.com clients disconnect. |