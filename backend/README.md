# Aster BubbleNexus Backend

A Node.js backend for perpetual markets data scraping and WebSocket broadcasting.

## Structure

- `src/app.js` - Express app setup
- `src/server.js` - Server startup
- `src/controllers/` - Route handlers
- `src/routes/` - Route definitions
- `src/services/` - Business logic (scraper, WS)
- `src/middleware/` - Express middlewares
- `src/db/` - Database connections
- `src/utils/` - Utilities
- `src/config/` - Configuration
- `src/tests/` - Unit tests

## Installation

```bash
npm install
```

## Environment Variables

Create a `.env` file:

```
MONGO_URI=mongodb://localhost:27017
MONGO_DB=bubblenexus
PORT=4000
```

## Running

```bash
npm start
```

## Testing

```bash
npm test
```

## API Endpoints

- `GET /health` - Health check
- `GET /perp/limit` - Get token limit
- `GET /perp/all` - Get all markets
- `GET /perp/dex/:dex` - Get markets by dex
- `GET /perp/dex/:dex/:symbol` - Get specific market

## WebSocket

Broadcasts market updates on `markets_update` event.