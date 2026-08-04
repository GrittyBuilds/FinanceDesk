#!/usr/bin/env node
/* Finance Desk — self-hosted sync server.
 *
 * Zero external dependencies: Node's built-in http + crypto only, with a JSON
 * file for storage. Run it yourself to sync across devices and share a family
 * ledger.
 *
 *   node server/server.js
 *   PORT=4000 FD_SECRET=change-me node server/server.js
 *
 * Model
 *   users        email + scrypt-hashed password
 *   workspaces   a dataset (accounts/journal/budgets) with a version counter
 *                kind = "personal" (auto-created per user) or "shared" (family)
 *   memberships  which users belong to which workspace, and their role
 *   invites      one-time-ish codes to join a shared workspace
 *
 * Sync is whole-dataset with optimistic concurrency: PUT includes the version
 * you last saw; if the server moved on, it responds 409 so the client pulls
 * first. Fine for family-scale use.
 *
 * Also serves the static app from the parent folder, so `node server/server.js`
 * can host the whole app + API on one origin (no CORS needed).
 */
"use strict";

var http = require("http");
var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var PORT = process.env.PORT || 4000;
var DB_PATH = process.env.FD_DB || path.join(__dirname, "db.json");
var STATIC_DIR = process.env.FD_STATIC || path.join(__dirname, "..");
var TOKEN_TTL_DAYS = 30;

// ---------- storage ----------
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, "utf8")); }
  catch (e) { return { meta: {}, users: {}, workspaces: {}, memberships: [], invites: {} }; }
}
var db = loadDB();
if (!db.meta) db.meta = {};
if (!db.meta.secret) { db.meta.secret = process.env.FD_SECRET || crypto.randomBytes(32).toString("hex"); }
var SECRET = process.env.FD_SECRET || db.meta.secret;

var saveTimer = null;
function saveDB() {
  // Debounced atomic write (write temp, then rename).
  if (saveTimer) return;
  saveTimer = setTimeout(function () {
    saveTimer = null;
    var tmp = DB_PATH + ".tmp";
    try { fs.writeFileSync(tmp, JSON.stringify(db, null, 2)); fs.renameSync(tmp, DB_PATH); }
    catch (e) { console.error("DB write failed:", e.message); }
  }, 10);
}
function saveNow() { // flush synchronously (used on shutdown)
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); } catch (e) {}
}

// ---------- crypto helpers ----------
function id(prefix) { return prefix + "_" + crypto.randomBytes(9).toString("hex"); }
function hashPassword(pw) {
  var salt = crypto.randomBytes(16);
  var hash = crypto.scryptSync(String(pw), salt, 32);
  return salt.toString("hex") + ":" + hash.toString("hex");
}
function verifyPassword(pw, stored) {
  try {
    var parts = String(stored).split(":");
    var salt = Buffer.from(parts[0], "hex"), expected = Buffer.from(parts[1], "hex");
    var actual = crypto.scryptSync(String(pw), salt, 32);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (e) { return false; }
}
function b64url(buf) { return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function signToken(uid) {
  var payload = b64url(JSON.stringify({ uid: uid, exp: Date.now() + TOKEN_TTL_DAYS * 864e5 }));
  var sig = b64url(crypto.createHmac("sha256", SECRET).update(payload).digest());
  return payload + "." + sig;
}
function verifyToken(token) {
  if (!token) return null;
  var parts = String(token).split(".");
  if (parts.length !== 2) return null;
  var expected = b64url(crypto.createHmac("sha256", SECRET).update(parts[0]).digest());
  var a = Buffer.from(parts[1]), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    var payload = JSON.parse(Buffer.from(parts[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload.uid;
  } catch (e) { return null; }
}

// ---------- membership helpers ----------
function membership(uid, wsId) {
  return db.memberships.find(function (m) { return m.userId === uid && m.wsId === wsId; });
}
function workspacesForUser(uid) {
  return db.memberships.filter(function (m) { return m.userId === uid; }).map(function (m) {
    var ws = db.workspaces[m.wsId];
    return ws ? { id: ws.id, name: ws.name, kind: ws.kind, role: m.role, version: ws.version, updatedAt: ws.updatedAt } : null;
  }).filter(Boolean);
}
function createWorkspace(name, kind, ownerId) {
  var ws = { id: id("ws"), name: name, kind: kind, ownerId: ownerId, version: 0,
    data: { accounts: [], journal: [], budgets: {} }, createdAt: Date.now(), updatedAt: Date.now() };
  db.workspaces[ws.id] = ws;
  db.memberships.push({ userId: ownerId, wsId: ws.id, role: "owner" });
  return ws;
}

// ---------- http plumbing ----------
function send(res, status, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
function cors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Vary", "Origin");
}
function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = "", size = 0;
    req.on("data", function (c) { size += c.length; if (size > 8 * 1024 * 1024) { reject(new Error("Body too large")); req.destroy(); } else chunks += c; });
    req.on("end", function () { if (!chunks) return resolve({}); try { resolve(JSON.parse(chunks)); } catch (e) { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}
function authUid(req) { var h = req.headers.authorization || ""; return verifyToken(h.replace(/^Bearer\s+/i, "")); }
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- static file serving ----------
var MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
function serveStatic(req, res) {
  var urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  var full = path.normalize(path.join(STATIC_DIR, urlPath));
  if (full.indexOf(path.normalize(STATIC_DIR)) !== 0) { send(res, 403, { error: "Forbidden" }); return; }
  fs.readFile(full, function (err, buf) {
    if (err) { send(res, 404, { error: "Not found" }); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
    res.end(buf);
  });
}

// ---------- API routes ----------
function handleApi(req, res, uid, url, body) {
  var m;

  if (url === "/api/health" && req.method === "GET") {
    return send(res, 200, { ok: true, name: "Finance Desk Sync", version: 1,
      users: Object.keys(db.users).length, workspaces: Object.keys(db.workspaces).length });
  }

  if (url === "/api/register" && req.method === "POST") {
    var email = String(body.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return send(res, 400, { error: "A valid email is required." });
    if (String(body.password || "").length < 6) return send(res, 400, { error: "Password must be at least 6 characters." });
    if (Object.keys(db.users).some(function (k) { return db.users[k].email === email; })) return send(res, 409, { error: "That email is already registered." });
    var user = { id: id("usr"), email: email, passHash: hashPassword(body.password), createdAt: Date.now() };
    db.users[user.id] = user;
    createWorkspace("Personal", "personal", user.id);
    saveDB();
    return send(res, 200, { token: signToken(user.id), user: { id: user.id, email: user.email } });
  }

  if (url === "/api/login" && req.method === "POST") {
    var lemail = String(body.email || "").trim().toLowerCase();
    var found = Object.keys(db.users).map(function (k) { return db.users[k]; }).find(function (u) { return u.email === lemail; });
    if (!found || !verifyPassword(body.password, found.passHash)) return send(res, 401, { error: "Wrong email or password." });
    return send(res, 200, { token: signToken(found.id), user: { id: found.id, email: found.email } });
  }

  // Everything below requires auth.
  if (!uid || !db.users[uid]) return send(res, 401, { error: "Not authenticated." });

  if (url === "/api/workspaces" && req.method === "GET") {
    return send(res, 200, workspacesForUser(uid));
  }
  if (url === "/api/workspaces" && req.method === "POST") {
    var name = String(body.name || "").trim() || "Shared";
    var ws = createWorkspace(name, "shared", uid); saveDB();
    return send(res, 200, { id: ws.id, name: ws.name, kind: ws.kind, role: "owner", version: 0 });
  }
  if (url === "/api/workspaces/join" && req.method === "POST") {
    var code = String(body.code || "").trim().toUpperCase();
    var inv = db.invites[code];
    if (!inv) return send(res, 404, { error: "Invalid invite code." });
    var wsJ = db.workspaces[inv.wsId];
    if (!wsJ) return send(res, 404, { error: "Workspace no longer exists." });
    if (!membership(uid, wsJ.id)) db.memberships.push({ userId: uid, wsId: wsJ.id, role: "member" });
    saveDB();
    return send(res, 200, { id: wsJ.id, name: wsJ.name, kind: wsJ.kind, role: "member", version: wsJ.version });
  }

  m = url.match(/^\/api\/workspaces\/([^/]+)\/invite$/);
  if (m && req.method === "POST") {
    var iws = db.workspaces[m[1]];
    if (!iws || !membership(uid, iws.id)) return send(res, 404, { error: "Workspace not found." });
    if (iws.kind !== "shared") return send(res, 400, { error: "Only shared workspaces can be invited to." });
    var code2 = crypto.randomBytes(4).toString("hex").toUpperCase();
    db.invites[code2] = { wsId: iws.id, createdBy: uid, createdAt: Date.now() };
    saveDB();
    return send(res, 200, { code: code2 });
  }

  m = url.match(/^\/api\/workspaces\/([^/]+)\/data$/);
  if (m) {
    var ws2 = db.workspaces[m[1]];
    if (!ws2 || !membership(uid, ws2.id)) return send(res, 404, { error: "Workspace not found." });
    if (req.method === "GET") return send(res, 200, { version: ws2.version, data: ws2.data, updatedAt: ws2.updatedAt });
    if (req.method === "PUT") {
      var baseVersion = Number(body.baseVersion) || 0;
      if (baseVersion !== ws2.version) return send(res, 409, { error: "Out of date — pull the latest first.", version: ws2.version });
      if (!body.data || typeof body.data !== "object") return send(res, 400, { error: "Missing data." });
      // Store the payload opaquely: it may be a plaintext {accounts,journal,budgets}
      // dataset OR an end-to-end-encrypted envelope {e2ee,salt,iv,ct}. The server
      // treats it as an opaque blob and never needs to read inside it.
      ws2.data = body.data;
      ws2.version += 1; ws2.updatedAt = Date.now(); saveDB();
      return send(res, 200, { version: ws2.version, updatedAt: ws2.updatedAt });
    }
  }

  return send(res, 404, { error: "Unknown endpoint." });
}

// ---------- server ----------
var server = http.createServer(function (req, res) {
  cors(res, req.headers.origin);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  var url = req.url.split("?")[0];
  if (url.indexOf("/api/") === 0) {
    var uid = authUid(req);
    readBody(req).then(function (body) {
      try { handleApi(req, res, uid, url, body); }
      catch (e) { console.error(e); send(res, 500, { error: "Server error." }); }
    }).catch(function (e) { send(res, 400, { error: e.message }); });
    return;
  }
  if (req.method === "GET") { serveStatic(req, res); return; }
  send(res, 404, { error: "Not found" });
});

server.listen(PORT, function () {
  console.log("Finance Desk sync server on http://localhost:" + PORT);
  console.log("  DB: " + DB_PATH);
  console.log("  Serving app from: " + STATIC_DIR);
  if (!process.env.FD_SECRET) console.log("  (Generated a token secret; set FD_SECRET to keep sessions across restarts.)");
});
process.on("SIGINT", function () { saveNow(); process.exit(0); });
process.on("SIGTERM", function () { saveNow(); process.exit(0); });

module.exports = server;
