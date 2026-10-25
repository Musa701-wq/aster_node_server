# Backend API Documentation

## Base URL
- `http://<host>:<port>`
- Default port is `4000` unless overridden by `PORT` in `.env`

## HTTP Endpoints

### GET /health
- Description: Server health check.
- Response:
  - `200 OK`
  - Body: `{ "status": "ok" }`

### GET /perp/limit
- Description: Retrieves the configured token limit from the settings collection.
- Response:
  - `200 OK`
  - Body: `{ "success": true, "limit": <number> }`
- Example:
  - `{ "success": true, "limit": 20 }`

### GET /perp/all
- Description: Returns all perpetual market records.
- Query Parameters:
  - `limit` (optional): number of records to return, default `200`
  - `skip` (optional): number of records to skip, default `0`
- Response:
  - `200 OK`
  - Body: `{ "success": true, "data": [ ...markets ] }`

### GET /perp/dex/:dex
- Description: Returns all perpetual markets for a given DEX.
- Path Parameters:
  - `dex`: name of the DEX, for example `aster`
- Response:
  - `200 OK`
  - Body: `{ "success": true, "data": [ ...markets ] }`

### GET /perp/dex/:dex/:symbol
- Description: Returns one perpetual market by DEX and symbol.
- Path Parameters:
  - `dex`: name of the DEX
  - `symbol`: market symbol, case-insensitive
- Response:
  - `200 OK` with `{ "success": true, "data": { ...market } }`
  - `404 Not Found` with `{ "success": false }` if market is not found

## WebSocket
- The server also initializes a WebSocket broadcast service.
- Broadcast event:
  - `type`: `markets_update`
  - `data`: updated market rows array
  - `timestamp`: update timestamp

## Notes
- The route prefix for perp data is now `/perp`.
- `config.perpDexes` defines the DEX list used by the scraper.
