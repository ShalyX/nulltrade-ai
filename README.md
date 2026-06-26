# NullTrade AI

NullTrade AI is a zero-trust, live-capable risk infrastructure layer that sits between your AI trading agents and the Bitget exchange. Instead of generating trades, NullTrade AI acts as a defensive proxy—it intercepts candidate trades, scores their execution quality against strict safety parameters, blocks weak or dangerous setups, and executes only if the risk thresholds are met.

## Features

- **Multi-Tenant Architecture**: Supports isolated user registration, login, and one-click guest accounts.
- **Robust Security**: Includes password hashing with PBKDF2, signed HTTP-only sessions, and strict CSRF protection.
- **Risk Assessment Engine**: Dynamically evaluates spread, funding rate, liquidity, volatility, and drawdown risk before permitting any execution.
- **In-Memory Exchange Execution**: Securely stores encrypted Bitget API keys and strictly decrypts them in-memory only at the moment of approved execution.
- **Hard Guardrails**: Enforces server-side notional caps (`LIVE_MAX_NOTIONAL_USDT`), live-trading kill switches, and allowed-symbol lists.
- **Auditable Records**: Generates exportable, cryptographic audit logs for every decision and blocked execution.
- **Flexible Storage**: Defaults to an ephemeral JSON store for rapid testing, but automatically upgrades to PostgreSQL if `DATABASE_URL` is provided.

## Getting Started

### Prerequisites

- Node.js v18 or higher
- A Bitget account with a restricted futures API key (for live execution)

### Local Installation

1. Clone the repository and navigate to the project root.
2. Copy the example environment variables:
   ```bash
   cp .env.example .env
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the server:
   ```bash
   npm start
   ```
5. Open your browser to `http://localhost:8787`.

## Environment Variables

For production or live execution, configure the following variables:

- `APP_SECRET`: A long, random cryptographic secret used for signing sessions and encrypting API keys.
- `DATABASE_URL`: Your PostgreSQL connection string.
- `LIVE_TRADING_ENABLED`: Set to `true` to allow live order execution.
- `LIVE_MAX_NOTIONAL_USDT`: The absolute maximum size of a single trade (e.g., `25`).
- `LIVE_ALLOWED_SYMBOLS`: A comma-separated list of permitted tickers (e.g., `BTCUSDT,ETHUSDT`).

## Live Trading Guardrails

NullTrade AI enforces a strict multi-layer defense. The server will actively refuse live orders unless **all** of the following conditions are met:

1. `LIVE_TRADING_ENABLED` is set to `true`.
2. The user is authenticated and has connected a valid Bitget API key.
3. The symbol is explicitly listed in `LIVE_ALLOWED_SYMBOLS`.
4. The calculated notional size is strictly at or below `LIVE_MAX_NOTIONAL_USDT`.
5. The Refusal Engine algorithms grade the candidate with a conclusive `TRADE` decision.

Blocked trades are never submitted to the exchange, but are permanently logged for auditing.

## Bitget Integration

NullTrade AI uses Bitget's documented v2 futures endpoints:
- **Execution**: `POST /api/v2/mix/order/place-order`
- **Market Data**: `GET /api/v2/mix/market/ticker`
- **Validation**: `GET /api/v2/mix/account/accounts`

## Deployment

NullTrade AI is designed to be easily deployed to cloud providers like Render, Heroku, or standard VPS environments. Ensure that `DATABASE_URL` is set to a persistent PostgreSQL instance to prevent data loss across container restarts.

**Security Warning**: Never provide a master Bitget API key. Always create a restricted sub-account key with limited withdrawal permissions and IP allowlisting enabled where possible.
