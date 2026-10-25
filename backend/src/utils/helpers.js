"use strict";

/** Maps base asset code (e.g. BTC, 1000PEPE) → logo URL from Aster all-asset-logo API */
const logoByAssetCode = new Map();

/**
 * @param {Array<{ assetCode?: string, logoUrl?: string }>} entries
 */
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

/**
 * Returns a per-token logo URL for hip-3 documents (stored as iconUrl).
 * Prefers Aster logos when updateLogoMap has been filled; otherwise Binance CDN; then default.
 */
function getIconUrl(symbol) {
  if (!symbol) return "/hyperliquid.png";
  const base = symbol.replace(/USDT$/i, "").toUpperCase();
  const aster = logoByAssetCode.get(base);
  if (aster) return aster;
  return `https://bin.bnbstatic.com/static/assets/logos/${base}.png`;
}

module.exports = { getIconUrl, updateLogoMap };