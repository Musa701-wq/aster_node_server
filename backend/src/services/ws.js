"use strict";

const logger = require("../utils/logger");
const RawDataService = require("./rawDataService");

function handleClientMessage(ws, rawMessage) {
  let message;

  try {
    message = JSON.parse(rawMessage);
  } catch (err) {
    logger.warn("Received invalid WS message, ignoring");
    return;
  }

  if (message.type === "subscribe") {
    if (message.stream === "raw") {
      ws.isRawClient = true;
      RawDataService.registerClient(ws, message.symbols);
      ws.send(
        JSON.stringify({
          type: "subscribed",
          stream: "raw",
          message: "Connected to raw live data stream",
        })
      );
    } else {
      ws.send(
        JSON.stringify({
          type: "subscribed",
          categories: message.categories || ["all"],
        })
      );
    }
    return;
  }

  if (message.type === "unsubscribe") {
    if (message.stream === "raw") {
      RawDataService.unregisterClient(ws);
      ws.send(JSON.stringify({ type: "unsubscribed", stream: "raw" }));
    } else {
      ws.send(JSON.stringify({ type: "unsubscribed" }));
    }
    return;
  }

  logger.warn(`Unknown WS message type: ${message.type}`);
}

function initWS(server) {
  const WebSocket = require("ws");
  const wss = new WebSocket.Server({ server });

  wss.on("connection", (ws) => {
    logger.info("Client connected");
    ws.isRawClient = false;

    ws.on("message", (message) => handleClientMessage(ws, message));

    ws.on("close", () => {
      if (ws.isRawClient) {
        RawDataService.unregisterClient(ws);
        logger.info("Raw client disconnected");
      } else {
        logger.info("Client disconnected");
      }
    });
  });
}

module.exports = { initWS };
