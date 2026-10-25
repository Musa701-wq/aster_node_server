"use strict";

const logger = require("../utils/logger");

module.exports = (err, req, res, next) => {
  logger.error(`Error: ${err.message}`);
  res.status(500).json({ success: false, error: err.message });
};