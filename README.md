# NullTrade AI Production App

NullTrade AI is a live-capable Bitget trading agent that filters trades instead of generating more trades. It accepts candidate opportunities, scores execution quality, rejects weak setups, stores every decision, and can place guarded Bitget futures orders using each user's own connected Bitget API key.

## What Is Production Ready

- User registration, login, and one-click guest accounts
- Password hashing with PBKDF2
- Signed HTTP-only sessions
- HTTPS-aware secure cookies in production
- CSRF protection for mutating requests
- In-memory route rate limiting
- Persisted user accounts and decision logs
- Live Bitget market ticker ingestion without exchange credentials
- Per-user encrypted Bitget API key storage
- Bitget signed REST client for futures orders
- Live-trading kill switch
- Per-order notional cap
- Allowed-symbol allowlist
- Paper/live mode separation
- Exportable audit logs for judges
- Render Postgres support via `DATABASE_URL`
- Optional Bitget MCP endpoint health check

## What Users Can Do Immediately

After deployment, a public user can:

- Continue as a guest
- Pull live Bitget market data
- Evaluate candidate trades
- Save paper/live-filter audit logs
- Export judging evidence from the saved logs

For actual live order placement, the user connects their own Bitget API key inside the app.

## What You Must Provide For Live Orders

Live trading cannot happen until a user connects their own restricted Bitget API key inside the app. The server does not need a shared Bitget key.

Production environment variables:

```bash
APP_SECRET=long-random-production-secret
DATABASE_URL=postgres-connection-string
LIVE_TRADING_ENABLED=true
```

Use a restricted Bitget futures API key. For judging, keep `LIVE_MAX_NOTIONAL_USDT` small. The Render blueprint enables live mode at the app level, but orders still require a logged-in user, a connected Bitget key, an agent `TRADE` decision, an allowed symbol, and a notional below the cap.

## Run Locally

```bash
cd outputs/nulltrade-ai-production
copy .env.example .env
npm install
node server.js
```

Open `http://localhost:8787`.

## Live Trading Guardrails

The server refuses live orders unless all are true:

- `LIVE_TRADING_ENABLED=true`
- The user has connected Bitget credentials
- The request is submitted by a logged-in or guest user
- The agent decision is `TRADE`
- The symbol is listed in `LIVE_ALLOWED_SYMBOLS`
- The calculated notional is at or below `LIVE_MAX_NOTIONAL_USDT`

Rejected trades are still logged for audit.

## Bitget Integration

The app uses Bitget's documented v2 futures order endpoint:

- `POST /api/v2/mix/order/place-order`
- Required payload fields used by the app: `symbol`, `productType`, `marginMode`, `marginCoin`, `size`, `side`, `tradeSide`, `orderType`, and `clientOid`.

It signs requests using Bitget's documented `ACCESS-KEY`, `ACCESS-SIGN`, `ACCESS-TIMESTAMP`, and `ACCESS-PASSPHRASE` headers.

Market data uses:

- `GET /api/v2/mix/market/ticker`

Credential validation uses:

- `GET /api/v2/mix/account/accounts`

References:

- https://www.bitget.com/api-doc/contract/trade/Place-Order
- https://www.bitget.com/api-doc/contract/account/Get-Account-List

If Bitget changes endpoint behavior, update `server.js` in the `BitgetClient` class.

## Deployment

Deploy this folder to Render from a GitHub/GitLab/Bitbucket repo using the included `render.yaml`. The Blueprint provisions a Postgres database and injects `DATABASE_URL`.

Do not connect a live Bitget key unless it is restricted, IP-allowlisted where possible, and funded only with judge-safe capital.
