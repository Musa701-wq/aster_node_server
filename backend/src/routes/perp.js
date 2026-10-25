"use strict";

const express = require("express");
const { getLimit, getAll, getDex, getCategory, getDexSymbol, getRawDex, getRawFullDex, getVolumeSummary, getOISummary, getFundingSummary, getTopMovers, getSectorPerformance, getSqueezeScore, getFundingRates, getBubbleNexus, getHeatmap, searchMarkets } = require("../controllers/perpController");

const router = express.Router();

router.get("/limit", getLimit);
router.get("/all", getAll);
router.get("/bubblenexus", getBubbleNexus);
router.get("/category/:category", getCategory);
router.get("/dex/:dex", getDex);
router.get("/dex/:dex/:symbol", getDexSymbol);
router.get("/raw/:dex", getRawDex);
router.get("/raw-full/:dex", getRawFullDex);
router.get("/search", searchMarkets);
router.get("/search/:dex", searchMarkets);
router.get("/volume-summary", getVolumeSummary);
router.get("/oi-summary", getOISummary);
router.get("/funding-summary", getFundingSummary);
router.get("/top-movers", getTopMovers);
router.get("/sector-performance", getSectorPerformance);
router.get("/squeeze-score", getSqueezeScore);
router.get("/funding-rates", getFundingRates);
router.get("/heatmap", getHeatmap);

module.exports = router;