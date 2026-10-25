"use strict";

const logger = {
  info: (message) => console.log(`ℹ️ ${message}`),
  warn: (message) => console.warn(`⚠️ ${message}`),
  error: (message) => console.error(`❌ ${message}`),
};

module.exports = logger;