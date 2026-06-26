# Bitget Hackathon Production Submission

## Track

Trading Agent

## Project

NullTrade AI: The Agent That Wins by Saying No

## Production Status

This version is no longer a static demo. It is a Node production app with:

- User accounts
- One-click guest accounts
- Saved audit logs
- Live Bitget market ticker ingestion
- Per-user encrypted Bitget API key storage
- Signed Bitget futures order client
- Guarded live execution
- Live-trading kill switch
- Per-order notional caps
- Allowed-symbol list
- Optional Bitget MCP endpoint health check

## Required Live Judging Setup

For a live judging run, deploy the app. Public users can immediately continue as guest, pull live Bitget market data, evaluate candidate trades, and save logs. For actual exchange execution, the judging user connects a restricted Bitget API key inside the app.

Set:

```bash
LIVE_TRADING_ENABLED=true
LIVE_MAX_NOTIONAL_USDT=25
LIVE_ALLOWED_SYMBOLS=BTCUSDT,ETHUSDT,SOLUSDT
```

The judge can register an account, pull a live ticker, submit a candidate trade, and execute only if the agent says `TRADE`. Every accepted, rejected, blocked, or submitted order is saved in the audit log.

## Idea

NullTrade AI is a trade-filtering agent, not a trade-generating agent. It receives candidate trades and decides whether the current execution environment is good enough to risk capital.

The thesis is that most retail and AI systems lose from overtrading. A strategy can generate useful signals and still lose after spread, funding, volatility, liquidity, drawdown, and market regime are considered. NullTrade AI turns refusal into an auditable trading action.

## Progress

Completed:

- Live-capable Bitget adapter
- Account/session system
- Persistent logs
- Agent scoring and risk gates
- Market-data endpoint
- Guarded live execution endpoint
- Production deployment blueprint

Still recommended before serious capital:

- IP allowlist the Bitget API key
- Use a dedicated low-balance judging subaccount
- Add exchange-side reduce-only and leverage controls if the final judging strategy needs them
- Add external database storage if deploying on infrastructure without persistent disk
