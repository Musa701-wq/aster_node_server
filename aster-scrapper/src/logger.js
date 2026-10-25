"use strict";

const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "scraper.log");
const MAX_LOG_BYTES = 5 * 1024 * 1024;

function ensureLogFile() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (_) {}
}

function rotateIfNeeded() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > MAX_LOG_BYTES) {
      fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
      fs.writeFileSync(LOG_FILE, "");
    }
  } catch (_) {}
}

function stringifyArg(a) {
  if (a instanceof Error) {
    return `${a.name}: ${a.message}${a.stack ? `\n${a.stack}` : ""}`;
  }
  if (typeof a === "object" && a !== null) {
    try {
      return JSON.stringify(a);
    } catch (_) {
      return String(a);
    }
  }
  return String(a);
}

function write(level, args) {
  const line =
    `[${new Date().toISOString()}] [${level}] [pid:${process.pid}] ` +
    args.map(stringifyArg).join(" ");
  console.log(line);
  try {
    ensureLogFile();
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch (_) {}
}

module.exports = {
  info: (...args) => write("info", args),
  warn: (...args) => write("warn", args),
  error: (...args) => write("error", args),
  debug: (...args) => write("debug", args),
  LOG_FILE,
};
