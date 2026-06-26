const $ = (id) => document.getElementById(id);

const fields = {
  email: $("email"),
  password: $("password"),
  apiKey: $("api-key"),
  apiSecret: $("api-secret"),
  apiPassphrase: $("api-passphrase"),
  riskAck: $("risk-ack"),
  symbol: $("symbol"),
  side: $("side"),
  orderType: $("order-type"),
  price: $("price"),
  size: $("size"),
  strictness: $("strictness"),
  spread: $("spread"),
  funding: $("funding"),
  liquidity: $("liquidity"),
  volatility: $("volatility"),
  technical: $("technical"),
  recent: $("recent"),
  news: $("news"),
  drawdown: $("drawdown")
};

let latestMode = "paper";
let csrfToken = "";

async function api(path, options = {}) {
  const method = options.method || "GET";
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(path, {
    headers,
    credentials: "same-origin",
    ...options
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || payload.error || "Request failed");
  }
  return payload;
}

async function refreshCsrf() {
  const payload = await api("/api/csrf");
  csrfToken = payload.csrfToken;
}

function payload() {
  return {
    symbol: fields.symbol.value,
    side: fields.side.value,
    orderType: fields.orderType.value,
    price: Number(fields.price.value),
    size: Number(fields.size.value),
    strictness: Number(fields.strictness.value),
    maxSpreadBps: 18,
    maxFundingBps: 22,
    minLiquidity: 58,
    maxDrawdownRisk: 35,
    spreadBps: Number(fields.spread.value),
    fundingBps: Number(fields.funding.value),
    liquidity: Number(fields.liquidity.value),
    volatility: Number(fields.volatility.value),
    technical: Number(fields.technical.value),
    recentPerformance: Number(fields.recent.value),
    newsRegime: Number(fields.news.value),
    drawdownRisk: Number(fields.drawdown.value)
  };
}

function loadDemoValues() {
  const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT"];
  const sides = ["LONG", "SHORT"];
  const r = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  
  fields.symbol.value = symbols[r(0, symbols.length - 1)];
  fields.side.value = sides[r(0, 1)];
  fields.orderType.value = "market";
  
  // Set realistic mock prices
  if (fields.symbol.value === "BTCUSDT") fields.price.value = r(60000, 70000);
  else if (fields.symbol.value === "ETHUSDT") fields.price.value = r(3000, 4000);
  else if (fields.symbol.value === "SOLUSDT") fields.price.value = r(120, 180);
  else fields.price.value = (Math.random() * 0.2 + 0.05).toFixed(4); // DOGE

  fields.size.value = (Math.random() * 0.5 + 0.01).toFixed(4);
  fields.strictness.value = r(60, 80);
  
  // Randomize risk metrics (50% chance of generating a clean setup that passes)
  const isGood = Math.random() > 0.5;
  if (isGood) {
    fields.spread.value = r(2, 16);
    fields.funding.value = r(2, 20);
    fields.liquidity.value = r(65, 95);
    fields.volatility.value = r(20, 50);
    fields.technical.value = r(60, 95);
    fields.recent.value = r(60, 95);
    fields.news.value = r(55, 95);
    fields.drawdown.value = r(5, 30);
  } else {
    fields.spread.value = r(15, 40);
    fields.funding.value = r(20, 40);
    fields.liquidity.value = r(20, 65);
    fields.volatility.value = r(40, 95);
    fields.technical.value = r(20, 60);
    fields.recent.value = r(20, 60);
    fields.news.value = r(20, 60);
    fields.drawdown.value = r(25, 75);
  }
  
  $("console-symbol").textContent = fields.symbol.value;
  $("ticker-symbol").textContent = fields.symbol.value;
  updateRiskMeters(payload());
}

function renderResult(data) {
  $("result").textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  if (data?.decision) {
    renderDecision(data);
  } else if (data?.error) {
    $("decision-card").className = "panel decision-card error";
    $("decision-verdict").textContent = "ERROR";
    $("decision-message").textContent = data.error;
    $("decision-mode-chip").textContent = "SYSTEM";
    $("decision-mode-chip").className = "chip neutral";
    $("risk-score").textContent = "--";
    $("confidence-score").textContent = "--";
    const ring = $("confidence-ring");
    if (ring) {
      ring.style.background = `conic-gradient(var(--brand-red) 0%, rgba(255,255,255,0.05) 0%)`;
      ring.style.boxShadow = `0 0 15px rgba(255,0,0,0.2)`;
    }
  }
}

function renderWaitingDecision() {
  $("decision-card").className = "panel decision-card waiting";
  $("decision-verdict").textContent = "WAITING";
  $("decision-mode-chip").textContent = "PAPER";
  $("decision-mode-chip").className = "chip paper";
  $("decision-message").textContent = "No decision yet. Enter a trade setup and run the refusal engine.";
  $("risk-score").textContent = "--";
  $("confidence-score").textContent = "--";
  const ring = $("confidence-ring");
  if (ring) {
    ring.style.background = `conic-gradient(var(--brand-accent) 0%, rgba(255,255,255,0.05) 0%)`;
    ring.style.boxShadow = `0 0 15px rgba(0,0,0,0.2)`;
  }
  $("recommended-action").textContent = "Run refusal engine";
  $("guardrail-checks").innerHTML = `<span class="check-chip neutral">Waiting for setup</span>`;
  updateRiskMeters(payload());
}

function renderDecision(record) {
  const decision = record.decision || {};
  const candidate = record.candidate || payload();
  const verdict = decision.decision || "WAITING";
  const blocked = record.execution?.status === "blocked";
  const trade = verdict === "TRADE" && !blocked;

  $("decision-card").className = `panel decision-card ${blocked ? "blocked" : trade ? "trade" : verdict === "WAITING" ? "waiting" : "no-trade"}`;
  $("decision-verdict").textContent = blocked ? "BLOCKED" : verdict.replace("_", " ");
  $("decision-mode-chip").textContent = (record.mode || latestMode || "paper").toUpperCase();
  $("decision-mode-chip").className = `chip ${(record.mode || latestMode) === "live" ? "live" : "paper"}`;
  $("decision-message").textContent = blocked ? record.execution.reason : (decision.reason || "No decision yet. Enter a trade setup and run the refusal engine.");
  $("risk-score").textContent = Number.isFinite(decision.score) ? `${decision.score}/100` : "--";
  
  const conf = decision.confidence;
  if (Number.isFinite(conf)) {
    $("confidence-score").textContent = `${conf}%`;
    const color = trade ? "var(--brand-green)" : (blocked ? "var(--brand-accent)" : "var(--brand-red)");
    const glow = trade ? "var(--brand-green-glow)" : (blocked ? "rgba(108, 92, 231, 0.3)" : "var(--brand-red-glow)");
    const ring = $("confidence-ring");
    if (ring) {
      ring.style.background = `conic-gradient(${color} ${conf}%, rgba(255,255,255,0.05) ${conf}%)`;
      ring.style.boxShadow = `0 0 15px ${glow}`;
    }
  } else {
    $("confidence-score").textContent = "--";
    const ring = $("confidence-ring");
    if (ring) {
      ring.style.background = `conic-gradient(var(--brand-accent) 0%, rgba(255,255,255,0.05) 0%)`;
      ring.style.boxShadow = `0 0 15px rgba(0,0,0,0.2)`;
    }
  }
  $("recommended-action").textContent = blocked
    ? "Do not submit. Resolve the blocked execution condition."
    : trade
      ? "Approved by the filter. Execute only within configured caps."
      : verdict === "WAITING"
        ? "Run refusal engine"
        : "Stand down. Wait for cleaner liquidity, cost, or risk conditions.";
  $("guardrail-checks").innerHTML = guardrailChecks(candidate, decision).map((check) =>
    `<span class="check-chip ${check.ok ? "ok" : "fail"}">${check.label}</span>`
  ).join("");
  $("console-symbol").textContent = candidate.symbol || fields.symbol.value;
  $("console-summary").textContent = `${candidate.side || fields.side.value} | ${record.mode || latestMode || "paper"} | ${blocked ? "execution blocked" : verdict.toLowerCase().replace("_", " ")}`;
  updateRiskMeters(candidate);
}

function guardrailChecks(candidate, decision) {
  const reason = String(decision.reason || "").toLowerCase();
  return [
    { label: candidate.spreadBps <= 18 ? "Spread within cap" : "Spread above cap", ok: candidate.spreadBps <= 18 && !reason.includes("spread") },
    { label: candidate.fundingBps <= 22 ? "Funding acceptable" : "Funding too high", ok: candidate.fundingBps <= 22 && !reason.includes("funding") },
    { label: candidate.liquidity >= 58 ? "Liquidity sufficient" : "Liquidity too thin", ok: candidate.liquidity >= 58 && !reason.includes("liquidity") },
    { label: candidate.drawdownRisk <= 35 ? "Drawdown controlled" : "Drawdown risk high", ok: candidate.drawdownRisk <= 35 && !reason.includes("drawdown") }
  ];
}

function updateRiskMeters(source) {
  setMeter("spread", Number(source.spreadBps ?? fields.spread.value), 50, true, "bps");
  setMeter("funding", Number(source.fundingBps ?? fields.funding.value), 50, true, "bps");
  setMeter("liquidity", Number(source.liquidity ?? fields.liquidity.value), 100, false, "");
  setMeter("drawdown", Number(source.drawdownRisk ?? fields.drawdown.value), 100, true, "");
}

function setMeter(name, value, max, dangerHigh, suffix) {
  const bar = $(`meter-${name}`);
  const label = $(`meter-${name}-value`);
  if (!bar || !label) return;
  const percentage = Math.max(0, Math.min(100, (value / max) * 100));
  bar.style.width = `${percentage}%`;
  bar.className = dangerHigh ? (percentage > 70 ? "danger-fill" : "safe-fill") : (value < 58 ? "danger-fill" : "safe-fill");
  label.textContent = `${value}${suffix}`;
}

async function refreshHealth() {
  const health = await api("/api/health");
  await api("/api/bitget/mcp/status").catch(() => null);
  $("live-status-pill").textContent = `Live trading: ${health.liveTradingEnabled ? "ON" : "OFF"}`;
  $("live-status-pill").className = `status-chip ${health.liveTradingEnabled ? "ok" : "warn"}`;
  $("ticker-status-pill").textContent = "Public ticker: ON";
  $("mode-status-pill").textContent = `Mode: ${latestMode === "live" ? "Live" : "Paper"}`;
}

async function refreshMe() {
  try {
    const me = await api("/api/me");
    $("account-state").textContent = `Logged in as ${me.email}`;
    await refreshExchange();
    await refreshLogs();
  } catch {
    $("account-state").textContent = "Not logged in";
    $("exchange-state").textContent = "Log in to connect Bitget";
    loadDemoValues();
    renderWaitingDecision();
  }
}

async function refreshExchange() {
  const status = await api("/api/exchange/status");
  if (status.connected) {
    $("exchange-state").className = "state-pill ok";
    $("exchange-state").textContent = `Bitget connected | Live cap ${status.liveMaxNotional} USDT | ${status.liveTradingEnabled ? "live enabled" : "live disabled by server"}`;
    $("api-key").value = "********************************";
    $("api-secret").value = "********************************";
    $("api-passphrase").value = "********************************";
    $("connect-exchange-btn").textContent = "Update";
  } else {
    $("exchange-state").className = "state-pill subtle";
    $("exchange-state").textContent = "Exchange not connected";
    $("api-key").value = "";
    $("api-secret").value = "";
    $("api-passphrase").value = "";
    $("connect-exchange-btn").textContent = "Connect";
  }
}

async function refreshLogs() {
  const logs = await api("/api/logs");
  if (!logs.length) {
    loadDemoValues();
    renderWaitingDecision();
  } else if ($("decision-verdict").textContent === "WAITING") {
    renderDecision(logs[0]);
  }
  $("logs-list").innerHTML = logs.map((log) => `
    <article class="receipt-card">
      <div class="receipt-head">
        <strong>${log.candidate.symbol}</strong>
        <span class="chip ${verdictClass(log)}">${receiptVerdict(log)}</span>
      </div>
      <div class="receipt-meta">
        <span>${log.candidate.side}</span>
        <span>${new Date(log.createdAt).toLocaleString()}</span>
      </div>
      <div class="receipt-meta">
        <span class="chip ${log.mode === "live" ? "live" : "paper"}">${(log.mode || "paper").toUpperCase()}</span>
        <span>${log.execution?.status || "not_submitted"}</span>
      </div>
      <p>${shortReason(log)}</p>
    </article>
  `).join("") || "<p class=\"muted\">No saved receipts yet. A demo decision is loaded in the center card.</p>";
}

function receiptVerdict(log) {
  if (log.execution?.status === "blocked") return "BLOCKED";
  return (log.decision?.decision || "WAITING").replace("_", " ");
}

function verdictClass(log) {
  if (log.execution?.status === "blocked") return "blocked";
  return log.decision?.decision === "TRADE" ? "trade" : "no-trade";
}

function shortReason(log) {
  const reason = log.execution?.status === "blocked" ? log.execution.reason : log.decision?.reason;
  return String(reason || "No reason recorded.").slice(0, 150);
}

$("register-btn").addEventListener("click", async () => {
  try {
    const user = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email: fields.email.value, password: fields.password.value }) });
    renderResult(user);
    await refreshMe();
  } catch (error) {
    renderResult({ error: error.message });
  }
});

$("login-btn").addEventListener("click", async () => {
  try {
    const user = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: fields.email.value, password: fields.password.value }) });
    renderResult(user);
    await refreshMe();
  } catch (error) {
    renderResult({ error: error.message });
  }
});

$("guest-btn").addEventListener("click", async () => {
  try {
    const user = await api("/api/auth/guest", { method: "POST" });
    renderResult(user);
    await refreshMe();
  } catch (error) {
    renderResult({ error: error.message });
  }
});

$("logout-btn").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  renderResult({ loggedOut: true });
  await refreshMe();
});

$("connect-exchange-btn").addEventListener("click", async () => {
  const confirmed = window.confirm("Connect or rotate this Bitget API key? Use a restricted futures key with a small balance and IP allowlist where possible.");
  if (!confirmed) return;
  try {
    $("exchange-state").textContent = "Validating Bitget credentials...";
    const result = await api("/api/exchange/credentials", {
      method: "POST",
      body: JSON.stringify({
        apiKey: fields.apiKey.value,
        apiSecret: fields.apiSecret.value,
        passphrase: fields.apiPassphrase.value
      })
    });
    fields.apiKey.value = "";
    fields.apiSecret.value = "";
    fields.apiPassphrase.value = "";
    renderResult(result);
    await refreshExchange();
  } catch (error) {
    $("exchange-state").textContent = `Credential check failed: ${error.message}`;
    renderResult({ error: error.message });
  }
});

$("disconnect-exchange-btn").addEventListener("click", async () => {
  const confirmed = window.confirm("Remove the saved Bitget API key from this account? You can reconnect or rotate a new key later.");
  if (!confirmed) return;
  try {
    const result = await api("/api/exchange/credentials", { method: "DELETE" });
    renderResult(result);
    await refreshExchange();
  } catch (error) {
    renderResult({ error: error.message });
  }
});

$("demo-btn").addEventListener("click", () => {
  loadDemoValues();
  renderWaitingDecision();
});

let tickerInterval = null;

async function fetchTicker() {
  try {
    $("ticker-state").textContent = "Syncing...";
    const ticker = await api(`/api/market/ticker?symbol=${encodeURIComponent(fields.symbol.value)}`);
    const data = Array.isArray(ticker.data) ? ticker.data[0] : ticker.data;
    const price = Number(data?.lastPr || data?.last || data?.markPrice || data?.indexPrice);
    if (Number.isFinite(price)) fields.price.value = price;
    $("ticker-price").textContent = Number.isFinite(price) ? price.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "--";
    $("ticker-symbol").textContent = fields.symbol.value.toUpperCase();
    $("ticker-state").textContent = "Live";
  } catch (error) {
    $("ticker-state").textContent = error.message === "auth_required" ? "Click Guest, then retry" : `Ticker unavailable: ${error.message}`;
    if (tickerInterval) {
      clearInterval(tickerInterval);
      tickerInterval = null;
      $("ticker-btn").textContent = "Auto: OFF";
      $("ticker-btn").className = "secondary";
    }
  }
}

$("ticker-btn").addEventListener("click", () => {
  if (tickerInterval) {
    clearInterval(tickerInterval);
    tickerInterval = null;
    $("ticker-btn").textContent = "Auto: OFF";
    $("ticker-btn").className = "secondary";
    $("ticker-state").textContent = "Paused";
  } else {
    $("ticker-btn").textContent = "Auto: ON";
    $("ticker-btn").className = "primary";
    fetchTicker();
    tickerInterval = setInterval(fetchTicker, 3000);
  }
});

$("evaluate-btn").addEventListener("click", async () => {
  try {
    latestMode = "paper";
    $("mode-status-pill").textContent = "Mode: Paper";
    const result = await api("/api/agent/evaluate", { method: "POST", body: JSON.stringify(payload()) });
    renderResult(result);
    await refreshLogs();
  } catch (error) {
    renderResult({ error: error.message });
  }
});

$("execute-btn").addEventListener("click", async () => {
  if (!fields.riskAck.checked) {
    renderResult({ error: "Acknowledge the live futures trading risk notice before execution." });
    return;
  }
  const confirmed = window.confirm("Live trading risk notice: this can submit a real Bitget futures order using your connected API key. Use a restricted key, small size, and funds you can afford to lose. Continue?");
  if (!confirmed) return;
  try {
    latestMode = "live";
    $("mode-status-pill").textContent = "Mode: Live";
    const result = await api("/api/agent/execute", { method: "POST", body: JSON.stringify(payload()) });
    renderResult(result);
    await refreshLogs();
  } catch (error) {
    renderResult({ error: error.message });
  }
});

$("logs-btn").addEventListener("click", async () => {
  try {
    await refreshLogs();
  } catch (error) {
    renderResult({ error: error.message });
  }
});

$("export-logs-btn").addEventListener("click", async () => {
  try {
    const logs = await api("/api/logs");
    const blob = new Blob([JSON.stringify({ project: "NullTrade AI", exportedAt: new Date().toISOString(), logs }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `nulltrade-ai-audit-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    renderResult({ error: error.message });
  }
});

renderWaitingDecision();
refreshCsrf()
  .then(() => Promise.all([
    refreshHealth().catch((error) => renderResult({ error: error.message })),
    refreshMe()
  ]))
  .catch((error) => renderResult({ error: error.message }));


// Tour binding
if ($("start-tour-btn")) {
  $("start-tour-btn").addEventListener("click", () => {
    if (window.TourManager) window.TourManager.start();
  });
}

// Auto-prompt tour for new visitors
window.addEventListener("DOMContentLoaded", () => {
  if (window.TourManager && !localStorage.getItem("nulltrade_tour_seen")) {
    setTimeout(() => {
      window.TourManager.start();
      localStorage.setItem("nulltrade_tour_seen", "true");
    }, 1000); // Give the UI a second to render
  }
});
