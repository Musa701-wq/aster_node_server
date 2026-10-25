"use strict";
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
module.exports = {
  aster: {
    baseUrl: "https://fapi.asterdex.com",
    logoApi: "https://www.asterdex.com/bapi/futures/v1/public/future/asset/ae/all-asset-logo"
  },
  perpDexes: ["aster"],
  mongo: {
    uri: process.env.MONGO_URI,
    db: process.env.MONGO_DB || "bubblenexus",
    collection: "perpetual",
  },
  server: {
    port: process.env.PORT || 4000,
  },
};
