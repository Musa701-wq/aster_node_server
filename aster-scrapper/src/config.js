"use strict";
require("dotenv").config();

module.exports = {
  aster: {
    baseUrl: "https://fapi.asterdex.com",
    logoApi: "https://www.asterdex.com/bapi/futures/v1/public/future/asset/ae/all-asset-logo",
  },
  dex: "aster",
  mongo: {
    uri: process.env.MONGO_URI,
    db: process.env.MONGO_DB || "bubblenexus",
  },
  intervalMs: 3 * 60 * 1000,
};