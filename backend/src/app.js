"use strict";

const express = require("express");
const corsMiddleware = require("./middleware/cors");
const errorHandler = require("./middleware/errorHandler");
const routes = require("./routes");

const app = express();

// Middleware
app.use(express.json());
app.use(corsMiddleware);

// Routes
app.use(routes);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Error handling
app.use(errorHandler);

module.exports = app;