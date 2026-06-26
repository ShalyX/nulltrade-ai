const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const dns = require("node:dns");

dns.setDefaultResultOrder("ipv4first");

loadEnv();

const config = {
  port: Number(process.env.PORT || 8787),
  origin: process.env.APP_ORIGIN || "http://localhost:8787",
  appSecret: process.env.APP_SECRET || "dev-only-change-me",
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, "data")),
  databaseUrl: process.env.DATABASE_URL || "",
  nodeEnv: process.env.NODE_ENV || "development",
  liveTradingEnabled: process.env.LIVE_TRADING_ENABLED !== "false",
  liveMaxNotional: Number(process.env.LIVE_MAX_NOTIONAL_USDT || 25),
  allowedSymbols: new Set((process.env.LIVE_ALLOWED_SYMBOLS || "BTCUSDT,ETHUSDT,SOLUSDT").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)),
  bitget: {
    apiKey: process.env.BITGET_API_KEY || "",
    apiSecret: process.env.BITGET_API_SECRET || "",
    passphrase: process.env.BITGET_API_PASSPHRASE || "",
    baseUrl: process.env.BITGET_BASE_URL || "https://api.bitget.com",
    productType: process.env.BITGET_PRODUCT_TYPE || "USDT-FUTURES",
    marginMode: process.env.BITGET_MARGIN_MODE || "isolated",
    marginCoin: process.env.BITGET_MARGIN_COIN || "USDT"
  },
  mcpUrl: process.env.BITGET_MCP_URL || "https://bitget-ai.gitbook.io/hackathon/~gitbook/mcp"
};

const publicDir = path.join(__dirname, "public");
let store;
let bitget;
let rateLimiter;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    if (url.pathname.startsWith("/api/")) {
      if (!rateLimiter.consume(req, url)) {
        sendJson(res, 429, { error: "rate_limited", message: "Too many requests. Please wait a moment and retry." });
        return;
      }
      if (requiresCsrf(req) && !verifyCsrf(req)) {
        sendJson(res, 403, { error: "csrf_failed", message: "Security token expired. Refresh the page and try again." });
        return;
      }
      await handleApi(req, res, url);
      return;
    }
    ensureCsrfCookie(req, res);
    serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: "server_error", message: error.message });
  }
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/csrf") {
    const token = ensureCsrfCookie(req, res);
    sendJson(res, 200, { csrfToken: token });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      liveTradingEnabled: config.liveTradingEnabled,
      publicTickerEnabled: true,
      storage: store.kind,
      allowedSymbols: [...config.allowedSymbols],
      liveMaxNotional: config.liveMaxNotional
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/bitget/mcp/status") {
    const status = await checkMcpStatus();
    sendJson(res, 200, status);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/market/ticker") {
    const symbol = (url.searchParams.get("symbol") || "BTCUSDT").toUpperCase();
    const ticker = await bitget.getTicker(symbol);
    sendJson(res, 200, ticker);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await readJson(req);
    const user = await store.createUser(body.email, body.password);
    setSession(req, res, user.id);
    sendJson(res, 201, publicUser(user));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/guest") {
    const user = await store.createGuestUser();
    setSession(req, res, user.id);
    sendJson(res, 201, publicUser(user));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readJson(req);
    const user = await store.verifyUser(body.email, body.password);
    if (!user) return sendJson(res, 401, { error: "invalid_credentials" });
    setSession(req, res, user.id);
    sendJson(res, 200, publicUser(user));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    clearSession(req, res);
    sendJson(res, 200, { ok: true });
    return;
  }

  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === "GET" && url.pathname === "/api/me") {
    sendJson(res, 200, publicUser(user));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/exchange/status") {
    sendJson(res, 200, {
      connected: await store.hasExchangeCredentials(user.id),
      liveTradingEnabled: config.liveTradingEnabled,
      allowedSymbols: [...config.allowedSymbols],
      liveMaxNotional: config.liveMaxNotional
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/exchange/credentials") {
    const body = await readJson(req);
    const credentials = {
      apiKey: String(body.apiKey || "").trim(),
      apiSecret: String(body.apiSecret || "").trim(),
      passphrase: String(body.passphrase || "").trim()
    };
    const tester = new BitgetClient({ ...config.bitget, ...credentials });
    await tester.validateCredentials();
    await store.saveExchangeCredentials(user.id, credentials);
    sendJson(res, 200, { connected: true, message: "Bitget key saved. Use a restricted key and rotate it regularly." });
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/exchange/credentials") {
    await store.deleteExchangeCredentials(user.id);
    sendJson(res, 200, { connected: false });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    sendJson(res, 200, await store.listLogs(user.id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent/evaluate") {
    const body = await readJson(req);
    const result = evaluateTrade(body);
    const record = await store.appendLog(user.id, {
      mode: body.mode === "live" ? "live" : "paper",
      candidate: sanitizeCandidate(body),
      decision: result,
      execution: { status: "not_submitted" }
    });
    sendJson(res, 200, record);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent/execute") {
    const body = await readJson(req);
    const decision = evaluateTrade(body);
    const candidate = sanitizeCandidate(body);
    const execution = await executeGuardedOrder(user, candidate, decision);
    const record = await store.appendLog(user.id, {
      mode: "live",
      candidate,
      decision,
      execution
    });
    sendJson(res, execution.status === "submitted" ? 201 : 422, record);
    return;
  }

  sendJson(res, 404, { error: "not_found" });
}

function evaluateTrade(input) {
  const strictness = numberInRange(input.strictness, 45, 95, 72);
  const maxSpreadBps = numberInRange(input.maxSpreadBps, 1, 100, 18);
  const maxFundingBps = numberInRange(input.maxFundingBps, 1, 100, 22);
  const minLiquidity = numberInRange(input.minLiquidity, 1, 100, 58);
  const maxDrawdownRisk = numberInRange(input.maxDrawdownRisk, 1, 100, 35);
  const spreadBps = numberInRange(input.spreadBps, 0, 500, 10);
  const fundingBps = numberInRange(input.fundingBps, 0, 500, 8);
  const liquidity = numberInRange(input.liquidity, 0, 100, 70);
  const volatility = numberInRange(input.volatility, 0, 100, 50);
  const technical = numberInRange(input.technical, 0, 100, 70);
  const recentPerformance = numberInRange(input.recentPerformance, 0, 100, 65);
  const newsRegime = numberInRange(input.newsRegime, 0, 100, 65);
  const drawdownRisk = numberInRange(input.drawdownRisk, 0, 100, 25);

  const spreadPenalty = Math.max(0, spreadBps - maxSpreadBps) * 1.25;
  const fundingPenalty = Math.max(0, fundingBps - maxFundingBps) * 1.1;
  const liquidityPenalty = Math.max(0, minLiquidity - liquidity) * 0.9;
  const drawdownPenalty = Math.max(0, drawdownRisk - maxDrawdownRisk) * 1.15;
  const volatilityPenalty = Math.max(0, volatility - 70) * 0.55;
  const positiveScore = technical * 0.28 + liquidity * 0.2 + recentPerformance * 0.22 + newsRegime * 0.18 + (100 - volatility) * 0.12;
  const score = Math.round(Math.max(0, Math.min(100, positiveScore - spreadPenalty - fundingPenalty - liquidityPenalty - drawdownPenalty - volatilityPenalty)));
  const blockers = [];
  if (spreadBps > maxSpreadBps) blockers.push(`spread ${spreadBps}bps above ${maxSpreadBps}bps`);
  if (fundingBps > maxFundingBps) blockers.push(`funding ${fundingBps}bps above ${maxFundingBps}bps`);
  if (liquidity < minLiquidity) blockers.push(`liquidity ${liquidity} below ${minLiquidity}`);
  if (drawdownRisk > maxDrawdownRisk) blockers.push(`drawdown risk ${drawdownRisk} above ${maxDrawdownRisk}`);
  if (newsRegime < 45) blockers.push(`hostile news regime ${newsRegime}`);
  const decision = score >= strictness && blockers.length === 0 ? "TRADE" : "NO_TRADE";
  return {
    decision,
    score,
    confidence: decision === "TRADE" ? Math.min(98, score + 5) : Math.max(10, score - 10),
    reason: decision === "TRADE" ? "Accepted: setup passed risk, liquidity, funding, volatility, and regime checks." : `Rejected: ${blockers.length ? blockers.join("; ") : `score ${score} below strictness ${strictness}`}.`,
    requiredConditions: blockers.length ? blockers : ["Maintain current execution quality through order submission."]
  };
}

async function executeGuardedOrder(user, candidate, decision) {
  if (!config.liveTradingEnabled) return { status: "blocked", reason: "LIVE_TRADING_ENABLED is not true" };
  const credentials = await store.getExchangeCredentials(user.id);
  if (!credentials) return { status: "blocked", reason: "Connect your Bitget API key first" };
  if (decision.decision !== "TRADE") return { status: "blocked", reason: "Agent decision is NO_TRADE" };
  if (!config.allowedSymbols.has(candidate.symbol)) return { status: "blocked", reason: `Symbol ${candidate.symbol} is not in LIVE_ALLOWED_SYMBOLS` };
  const notional = candidate.price * candidate.size;
  if (!Number.isFinite(notional) || notional <= 0) return { status: "blocked", reason: "Invalid order notional" };
  if (notional > config.liveMaxNotional) return { status: "blocked", reason: `Notional ${notional.toFixed(2)} exceeds cap ${config.liveMaxNotional}` };
  const userBitget = new BitgetClient({ ...config.bitget, ...credentials });
  const order = await userBitget.placeOrder({
    symbol: candidate.symbol,
    side: candidate.side === "SHORT" ? "sell" : "buy",
    size: String(candidate.size),
    price: candidate.orderType === "limit" ? String(candidate.price) : undefined,
    orderType: candidate.orderType || "market",
    clientOid: `nulltrade-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`
  });
  return { status: "submitted", exchange: "bitget", order };
}

function sanitizeCandidate(input) {
  return {
    symbol: String(input.symbol || "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, ""),
    side: input.side === "SHORT" ? "SHORT" : "LONG",
    price: numberInRange(input.price, 0.000001, 10000000, 0),
    size: numberInRange(input.size, 0.000001, 10000000, 0),
    orderType: input.orderType === "limit" ? "limit" : "market",
    strictness: numberInRange(input.strictness, 45, 95, 72),
    spreadBps: numberInRange(input.spreadBps, 0, 500, 10),
    fundingBps: numberInRange(input.fundingBps, 0, 500, 8),
    liquidity: numberInRange(input.liquidity, 0, 100, 70),
    volatility: numberInRange(input.volatility, 0, 100, 50),
    technical: numberInRange(input.technical, 0, 100, 70),
    recentPerformance: numberInRange(input.recentPerformance, 0, 100, 65),
    newsRegime: numberInRange(input.newsRegime, 0, 100, 65),
    drawdownRisk: numberInRange(input.drawdownRisk, 0, 100, 25)
  };
}

class BitgetClient {
  constructor(options) {
    this.options = options;
  }

  isConfigured() {
    return Boolean(this.options.apiKey && this.options.apiSecret && this.options.passphrase);
  }

  async getTicker(symbol) {
    const pathName = "/api/v2/mix/market/ticker";
    const query = new URLSearchParams({ symbol, productType: this.options.productType }).toString();
    return this.request("GET", pathName, query, undefined, { auth: false });
  }

  async placeOrder(order) {
    const body = {
      symbol: order.symbol,
      productType: this.options.productType,
      marginMode: this.options.marginMode,
      marginCoin: this.options.marginCoin,
      size: order.size,
      side: order.side,
      tradeSide: "open",
      orderType: order.orderType,
      clientOid: order.clientOid
    };
    if (order.price) body.price = order.price;
    if (order.orderType === "limit") body.force = "gtc";
    return this.request("POST", "/api/v2/mix/order/place-order", "", body, { auth: true });
  }

  async validateCredentials() {
    const pathName = "/api/v2/mix/account/accounts";
    const query = new URLSearchParams({ productType: this.options.productType }).toString();
    return this.request("GET", pathName, query, undefined, { auth: true });
  }

  async request(method, requestPath, query = "", body, options = { auth: true }) {
    const bodyString = body ? JSON.stringify(body) : "";
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": "NullTradeAI/1.0",
      "locale": "en-US"
    };
    if (options.auth) {
      if (!this.isConfigured()) throw new Error("Bitget API credentials are not configured");
      const timestamp = String(Date.now());
      const prehash = query ? `${timestamp}${method}${requestPath}?${query}${bodyString}` : `${timestamp}${method}${requestPath}${bodyString}`;
      const sign = crypto.createHmac("sha256", this.options.apiSecret).update(prehash).digest("base64");
      headers["ACCESS-KEY"] = this.options.apiKey;
      headers["ACCESS-SIGN"] = sign;
      headers["ACCESS-TIMESTAMP"] = timestamp;
      headers["ACCESS-PASSPHRASE"] = this.options.passphrase;
    }
    const url = `${this.options.baseUrl}${requestPath}${query ? `?${query}` : ""}`;
    let response;
    try {
      response = await fetchIPv4(url, { method, headers, body: bodyString || undefined });
    } catch (error) {
      const cause = error.cause ? ` (${error.cause.code || error.cause.message || String(error.cause)})` : "";
      throw new Error(`Bitget network request failed: ${error.message}${cause}`);
    }
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
    if (!response.ok || payload.code && payload.code !== "00000") {
      const message = payload.msg || payload.message || `Bitget request failed with HTTP ${response.status}`;
      const error = new Error(message);
      error.payload = payload;
      throw error;
    }
    return payload;
  }
}

class JsonStore {
  constructor(dir) {
    this.kind = "json";
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.usersPath = path.join(dir, "users.json");
    this.logsPath = path.join(dir, "logs.json");
    this.users = this.read(this.usersPath, []);
    this.logs = this.read(this.logsPath, []);
  }

  read(file, fallback) {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  write(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }

  async init() {}

  async createUser(email, password) {
    email = String(email || "").trim().toLowerCase();
    if (!email.includes("@")) throw new Error("Valid email is required");
    if (String(password || "").length < 10) throw new Error("Password must be at least 10 characters");
    if (this.users.some((u) => u.email === email)) throw new Error("User already exists");
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);
    const user = { id: crypto.randomUUID(), email, salt, passwordHash, createdAt: new Date().toISOString() };
    this.users.push(user);
    this.write(this.usersPath, this.users);
    return user;
  }

  async createGuestUser() {
    const stamp = Date.now().toString(36);
    const suffix = crypto.randomBytes(3).toString("hex");
    const email = `guest-${stamp}-${suffix}@nulltrade.local`;
    const password = crypto.randomBytes(24).toString("base64url");
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);
    const user = { id: crypto.randomUUID(), email, salt, passwordHash, role: "guest", createdAt: new Date().toISOString() };
    this.users.push(user);
    this.write(this.usersPath, this.users);
    return user;
  }

  async saveExchangeCredentials(userId, credentials) {
    if (!credentials.apiKey || !credentials.apiSecret || !credentials.passphrase) {
      throw new Error("Bitget API key, secret, and passphrase are required");
    }
    const user = await this.getUser(userId);
    if (!user) throw new Error("User not found");
    user.exchange = {
      provider: "bitget",
      encryptedCredentials: encryptJson(credentials),
      connectedAt: new Date().toISOString()
    };
    this.write(this.usersPath, this.users);
  }

  async getExchangeCredentials(userId) {
    const user = await this.getUser(userId);
    if (!user?.exchange?.encryptedCredentials) return null;
    return decryptJson(user.exchange.encryptedCredentials);
  }

  async hasExchangeCredentials(userId) {
    const user = await this.getUser(userId);
    return Boolean(user?.exchange?.encryptedCredentials);
  }

  async deleteExchangeCredentials(userId) {
    const user = await this.getUser(userId);
    if (!user) return;
    delete user.exchange;
    this.write(this.usersPath, this.users);
  }

  async verifyUser(email, password) {
    email = String(email || "").trim().toLowerCase();
    const user = this.users.find((u) => u.email === email);
    if (!user) return null;
    const actual = hashPassword(password, user.salt);
    return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(user.passwordHash)) ? user : null;
  }

  async getUser(id) {
    return this.users.find((u) => u.id === id) || null;
  }

  async appendLog(userId, entry) {
    const record = {
      id: crypto.randomUUID(),
      userId,
      createdAt: new Date().toISOString(),
      ...entry
    };
    this.logs.push(record);
    this.write(this.logsPath, this.logs);
    return record;
  }

  async listLogs(userId) {
    return this.logs.filter((log) => log.userId === userId).slice(-200).reverse();
  }
}

class PostgresStore {
  constructor(databaseUrl) {
    this.kind = "postgres";
    const { Pool } = require("pg");
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false }
    });
  }

  async init() {
    await this.pool.query(`
      create table if not exists users (
        id text primary key,
        email text unique not null,
        salt text not null,
        password_hash text not null,
        role text not null default 'user',
        exchange jsonb,
        created_at timestamptz not null default now()
      );
      create table if not exists audit_logs (
        id text primary key,
        user_id text not null references users(id) on delete cascade,
        mode text not null,
        candidate jsonb not null,
        decision jsonb not null,
        execution jsonb not null,
        created_at timestamptz not null default now()
      );
      create index if not exists audit_logs_user_created_idx on audit_logs (user_id, created_at desc);
    `);
  }

  rowToUser(row) {
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      salt: row.salt,
      passwordHash: row.password_hash,
      role: row.role,
      exchange: row.exchange,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
    };
  }

  rowToLog(row) {
    return {
      id: row.id,
      userId: row.user_id,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      mode: row.mode,
      candidate: row.candidate,
      decision: row.decision,
      execution: row.execution
    };
  }

  async createUser(email, password) {
    email = String(email || "").trim().toLowerCase();
    if (!email.includes("@")) throw new Error("Valid email is required");
    if (String(password || "").length < 10) throw new Error("Password must be at least 10 characters");
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);
    const user = { id: crypto.randomUUID(), email, salt, passwordHash, role: "user" };
    try {
      const result = await this.pool.query(
        "insert into users (id, email, salt, password_hash, role) values ($1, $2, $3, $4, $5) returning *",
        [user.id, user.email, user.salt, user.passwordHash, user.role]
      );
      return this.rowToUser(result.rows[0]);
    } catch (error) {
      if (error.code === "23505") throw new Error("User already exists");
      throw error;
    }
  }

  async createGuestUser() {
    const stamp = Date.now().toString(36);
    const suffix = crypto.randomBytes(3).toString("hex");
    const email = `guest-${stamp}-${suffix}@nulltrade.local`;
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(crypto.randomBytes(24).toString("base64url"), salt);
    const result = await this.pool.query(
      "insert into users (id, email, salt, password_hash, role) values ($1, $2, $3, $4, $5) returning *",
      [crypto.randomUUID(), email, salt, passwordHash, "guest"]
    );
    return this.rowToUser(result.rows[0]);
  }

  async saveExchangeCredentials(userId, credentials) {
    if (!credentials.apiKey || !credentials.apiSecret || !credentials.passphrase) {
      throw new Error("Bitget API key, secret, and passphrase are required");
    }
    const exchange = {
      provider: "bitget",
      encryptedCredentials: encryptJson(credentials),
      connectedAt: new Date().toISOString()
    };
    const result = await this.pool.query("update users set exchange = $1 where id = $2 returning *", [exchange, userId]);
    if (!result.rows.length) throw new Error("User not found");
  }

  async getExchangeCredentials(userId) {
    const user = await this.getUser(userId);
    if (!user?.exchange?.encryptedCredentials) return null;
    return decryptJson(user.exchange.encryptedCredentials);
  }

  async hasExchangeCredentials(userId) {
    const user = await this.getUser(userId);
    return Boolean(user?.exchange?.encryptedCredentials);
  }

  async deleteExchangeCredentials(userId) {
    await this.pool.query("update users set exchange = null where id = $1", [userId]);
  }

  async verifyUser(email, password) {
    email = String(email || "").trim().toLowerCase();
    const result = await this.pool.query("select * from users where email = $1", [email]);
    const user = this.rowToUser(result.rows[0]);
    if (!user) return null;
    const actual = hashPassword(password, user.salt);
    return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(user.passwordHash)) ? user : null;
  }

  async getUser(id) {
    const result = await this.pool.query("select * from users where id = $1", [id]);
    return this.rowToUser(result.rows[0]);
  }

  async appendLog(userId, entry) {
    const record = {
      id: crypto.randomUUID(),
      userId,
      createdAt: new Date().toISOString(),
      ...entry
    };
    await this.pool.query(
      "insert into audit_logs (id, user_id, mode, candidate, decision, execution, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
      [record.id, userId, record.mode, record.candidate, record.decision, record.execution, record.createdAt]
    );
    return record;
  }

  async listLogs(userId) {
    const result = await this.pool.query(
      "select * from audit_logs where user_id = $1 order by created_at desc limit 200",
      [userId]
    );
    return result.rows.map((row) => this.rowToLog(row));
  }
}

async function checkMcpStatus() {
  if (!config.mcpUrl) return { configured: false };
  try {
    const response = await fetch(config.mcpUrl, { method: "GET" });
    return { configured: true, url: config.mcpUrl, reachable: response.ok, status: response.status };
  } catch (error) {
    return { configured: true, url: config.mcpUrl, reachable: false, error: error.message };
  }
}

async function requireUser(req, res) {
  const cookies = parseCookies(req.headers.cookie || "");
  const userId = verifySession(cookies.session || "");
  const user = userId ? await store.getUser(userId) : null;
  if (!user) sendJson(res, 401, { error: "auth_required" });
  return user;
}

function publicUser(user) {
  return { id: user.id, email: user.email, role: user.role || "user", createdAt: user.createdAt, exchangeConnected: Boolean(user.exchange?.encryptedCredentials) };
}

function setSession(req, res, userId) {
  const value = signSession(userId);
  appendCookie(res, `session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secureCookieSuffix(req)}`);
}

function clearSession(req, res) {
  appendCookie(res, `session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookieSuffix(req)}`);
}

function signSession(userId) {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", config.appSecret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifySession(token) {
  try {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    const expected = crypto.createHmac("sha256", config.appSecret).update(payload).digest("base64url");
    if (Buffer.byteLength(sig) !== Buffer.byteLength(expected)) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (decoded.exp < Date.now()) return null;
    return decoded.userId;
  } catch {
    return null;
  }
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, 210000, 32, "sha256").toString("hex");
}

function encryptionKey() {
  return crypto.createHash("sha256").update(config.appSecret).digest();
}

function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptJson(value) {
  const [ivText, tagText, encryptedText] = String(value || "").split(".");
  if (!ivText || !tagText || !encryptedText) return null;
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

function numberInRange(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function serveStatic(res, urlPath) {
  const cleanPath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(publicDir, cleanPath));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath);
  const type = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json" }[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(res);
}

class RateLimiter {
  constructor() {
    this.buckets = new Map();
  }

  consume(req, url) {
    const ip = clientIp(req);
    const authRoute = url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/api/exchange/");
    const limit = authRoute ? 30 : 180;
    const windowMs = authRoute ? 60_000 : 60_000;
    const key = `${ip}:${authRoute ? "auth" : "api"}`;
    const now = Date.now();
    const bucket = this.buckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    this.buckets.set(key, bucket);
    return bucket.count <= limit;
  }
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function fetchIPv4(url, options) {
  const https = require("node:https");
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(url);
    const isBitget = targetUrl.hostname === "api.bitget.com";
    
    const requestOptions = {
      method: options.method,
      headers: { ...options.headers, "Host": targetUrl.hostname },
      hostname: isBitget ? "104.18.15.166" : targetUrl.hostname,
      port: targetUrl.port || 443,
      path: targetUrl.pathname + targetUrl.search,
      servername: targetUrl.hostname, // SNI support for Cloudflare
      family: 4
    };

    const req = https.request(requestOptions, (res) => {
      let data = [];
      res.on("data", chunk => data.push(chunk));
      res.on("end", () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: () => Promise.resolve(Buffer.concat(data).toString("utf8"))
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error("UND_ERR_CONNECT_TIMEOUT"));
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function requiresCsrf(req) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
}

function ensureCsrfCookie(req, res) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = verifySignedToken(cookies.csrf || "") ? cookies.csrf : signToken(crypto.randomBytes(24).toString("base64url"));
  if (token !== cookies.csrf) {
    appendCookie(res, `csrf=${encodeURIComponent(token)}; SameSite=Lax; Path=/; Max-Age=604800${secureCookieSuffix(req)}`);
  }
  return token;
}

function verifyCsrf(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const header = String(req.headers["x-csrf-token"] || "");
  if (!cookies.csrf || !header || cookies.csrf !== header) return false;
  return Boolean(verifySignedToken(cookies.csrf));
}

function signToken(value) {
  const sig = crypto.createHmac("sha256", config.appSecret).update(value).digest("base64url");
  return `${value}.${sig}`;
}

function verifySignedToken(token) {
  const [value, sig] = String(token || "").split(".");
  if (!value || !sig) return null;
  const expected = crypto.createHmac("sha256", config.appSecret).update(value).digest("base64url");
  if (Buffer.byteLength(sig) !== Buffer.byteLength(expected)) return null;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? value : null;
}

function appendCookie(res, cookie) {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookie);
  } else if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookie]);
  } else {
    res.setHeader("Set-Cookie", [existing, cookie]);
  }
}

function secureCookieSuffix(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "");
  const secure = config.nodeEnv === "production" || forwardedProto.includes("https");
  return secure ? "; Secure" : "";
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(cookieHeader.split(";").filter(Boolean).map((part) => {
    const [key, ...value] = part.trim().split("=");
    return [key, decodeURIComponent(value.join("="))];
  }));
}

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${config.port} is already in use.`);
    console.error(`Open http://localhost:${config.port} if NullTrade AI is already running, or start on another port with:`);
    console.error(`  PowerShell: $env:PORT=8788; node server.js`);
    console.error(`  cmd.exe:    set PORT=8788 && node server.js`);
    process.exit(1);
  }
  throw error;
});

async function boot() {
  store = config.databaseUrl ? new PostgresStore(config.databaseUrl) : new JsonStore(config.dataDir);
  bitget = new BitgetClient(config.bitget);
  rateLimiter = new RateLimiter();
  await store.init();
  server.listen(config.port, () => {
    console.log(`NullTrade AI listening on http://localhost:${config.port}`);
    console.log(`Storage backend: ${store.kind}`);
  });
}

boot().catch((error) => {
  console.error("Failed to start NullTrade AI:", error.message);
  process.exit(1);
});
