const crypto = require("node:crypto");

function send(res, status, body) {
  res.status(status).json(body);
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return {};
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function sign(payload) {
  const secret = process.env.FIXBYTE_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("FIXBYTE_SESSION_SECRET must be at least 32 characters.");
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return data + "." + mac;
}

function verifyToken(token) {
  try {
    const [data, mac] = String(token || "").split(".");
    if (!data || !mac) return null;
    const secret = process.env.FIXBYTE_SESSION_SECRET;
    if (!secret || secret.length < 32) return null;
    const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url");
    if (!safeEqual(mac, expected)) return null;
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (payload.exp < Date.now() || payload.sub !== "fixbyte-admin") return null;
    return payload;
  } catch (_) { return null; }
}

function cookieValue(req, name) {
  const raw = req.headers && req.headers.cookie || "";
  const item = raw.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
}

function setAdminCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", "fb_admin=" + encodeURIComponent(token) + "; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800" + secure);
}

function clearAdminCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", "fb_admin=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0" + secure);
}

function requireAdmin(req, res) {
  const payload = verifyToken(cookieValue(req, "fb_admin"));
  if (!payload) {
    send(res, 401, { success: false, message: "Admin login required." });
    return null;
  }
  return payload;
}

async function supabase(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server environment is not configured.");
  const response = await fetch(url.replace(/\/$/, "") + "/rest/v1/" + path, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = raw; }
  if (!response.ok) {
    const message = data && (data.message || data.hint || data.details) || "Database request failed.";
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function rpc(name, args) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server environment is not configured.");
  const response = await fetch(url.replace(/\/$/, "") + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = raw; }
  if (!response.ok) throw new Error(data && (data.message || data.details) || "Eligibility calculation failed.");
  return data;
}

function audit(action, entityType, entityId, details = {}) {
  return supabase("audit_logs", {
    method: "POST",
    body: { actor: "FIXBYTE Admin", action, entity_type: entityType, entity_id: entityId ? String(entityId) : null, details }
  }).catch(err => console.error("Audit log error:", err.message));
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function makeId(prefix) {
  return prefix + "-" + new Date().toISOString().slice(2,10).replace(/-/g,"") + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

module.exports = {
  send, readBody, safeEqual, sign, verifyToken, cookieValue,
  setAdminCookie, clearAdminCookie, requireAdmin,
  supabase, rpc, audit, hashToken, makeId
};
