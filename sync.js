/* Finance Desk — client sync layer.
 *
 * Backend-agnostic: the same interface drives either a self-hosted Node server
 * (see server/) or a Supabase project (Auth + Postgres via REST — no SDK). The
 * chosen backend is stored in localStorage along with connection config, the
 * active workspace, and last-seen versions.
 *
 * Sync is whole-dataset with optimistic concurrency and merge handled a layer
 * up (app.js fullSync + FD.merge). End-to-end encryption, when on, wraps the
 * data blob before it reaches either backend, so the server only sees
 * ciphertext.
 */
(function (root) {
  "use strict";

  var CONFIG_KEY = "financedesk.sync";
  function load() { try { return JSON.parse(root.localStorage.getItem(CONFIG_KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { root.localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch (e) {} }

  var cfg = load();
  if (!cfg.versions) cfg.versions = {};
  if (!cfg.backend) cfg.backend = "server";

  // Parse a fetch Response as JSON, throwing an Error (with .status/.data) on failure.
  function parse(res) {
    return res.text().then(function (t) {
      var d = null; try { d = t ? JSON.parse(t) : null; } catch (e) {}
      if (!res.ok) {
        var msg = (d && (d.error_description || d.msg || d.message || d.error)) || ("HTTP " + res.status);
        var err = new Error(msg); err.status = res.status; err.data = d; throw err;
      }
      return d;
    });
  }

  // ---------------- Self-hosted Node server provider ----------------
  function serverBase() { return (cfg.url || "").replace(/\/+$/, ""); }
  function serverApi(method, path, body, auth) {
    var headers = { "Content-Type": "application/json" };
    if (auth && cfg.token) headers.Authorization = "Bearer " + cfg.token;
    return fetch(serverBase() + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined }).then(parse);
  }
  var serverProvider = {
    isConfigured: function () { return !!cfg.url; },
    isLoggedIn: function () { return !!cfg.token; },
    health: function () { return serverApi("GET", "/api/health", null, false).then(function (h) { return { ok: true, message: "Connected — " + h.users + " user(s), " + h.workspaces + " workspace(s)." }; }); },
    register: function (email, password) { return serverApi("POST", "/api/register", { email: email, password: password }, false).then(function (r) { cfg.token = r.token; cfg.email = r.user.email; save(); return r; }); },
    login: function (email, password) { return serverApi("POST", "/api/login", { email: email, password: password }, false).then(function (r) { cfg.token = r.token; cfg.email = r.user.email; save(); return r; }); },
    logout: function () { delete cfg.token; delete cfg.email; delete cfg.workspaceId; save(); },
    listWorkspaces: function () { return serverApi("GET", "/api/workspaces", null, true); },
    createWorkspace: function (name) { return serverApi("POST", "/api/workspaces", { name: name }, true); },
    invite: function (ws) { return serverApi("POST", "/api/workspaces/" + ws + "/invite", {}, true); },
    join: function (code) { return serverApi("POST", "/api/workspaces/join", { code: code }, true); },
    pullData: function (ws) { return serverApi("GET", "/api/workspaces/" + ws + "/data", null, true); },
    pushData: function (ws, base, data) { return serverApi("PUT", "/api/workspaces/" + ws + "/data", { baseVersion: base, data: data }, true); },
  };

  // ---------------- Supabase provider (GoTrue Auth + PostgREST RPC) ----------------
  function sbBase() { return (cfg.sbUrl || "").replace(/\/+$/, ""); }
  function sbHeaders(auth) {
    var h = { apikey: cfg.anonKey || "", "Content-Type": "application/json" };
    if (auth && cfg.sb && cfg.sb.access_token) h.Authorization = "Bearer " + cfg.sb.access_token;
    return h;
  }
  function storeSession(r) {
    cfg.sb = { access_token: r.access_token, refresh_token: r.refresh_token, uid: r.user && r.user.id, expires_at: Date.now() + ((r.expires_in || 3600) * 1000) };
    if (r.user && r.user.email) cfg.email = r.user.email;
    save();
  }
  function sbAuth(path, body) {
    return fetch(sbBase() + path, { method: "POST", headers: sbHeaders(false), body: JSON.stringify(body) }).then(parse);
  }
  function sbRefresh() {
    if (!(cfg.sb && cfg.sb.refresh_token)) return Promise.reject(new Error("Session expired — log in again."));
    return sbAuth("/auth/v1/token?grant_type=refresh_token", { refresh_token: cfg.sb.refresh_token }).then(storeSession);
  }
  // Call a Postgres function via PostgREST; refreshes the token once on 401.
  function sbRpc(fn, args) {
    function attempt(retried) {
      return fetch(sbBase() + "/rest/v1/rpc/" + fn, { method: "POST", headers: sbHeaders(true), body: JSON.stringify(args || {}) }).then(function (res) {
        if (res.status === 401 && !retried && cfg.sb && cfg.sb.refresh_token) { return sbRefresh().then(function () { return attempt(true); }); }
        return parse(res);
      });
    }
    return attempt(false);
  }
  var supabaseProvider = {
    isConfigured: function () { return !!(cfg.sbUrl && cfg.anonKey); },
    isLoggedIn: function () { return !!(cfg.sb && cfg.sb.access_token); },
    health: function () {
      return fetch(sbBase() + "/auth/v1/settings", { headers: sbHeaders(false) }).then(function (res) {
        if (!res.ok) throw new Error("Couldn't reach Supabase — check the URL and anon key.");
        return { ok: true, message: "Connected to Supabase." };
      });
    },
    register: function (email, password) {
      return sbAuth("/auth/v1/signup", { email: email, password: password }).then(function (r) {
        if (r && r.access_token) { storeSession(r); return { user: { email: email } }; }
        // Email confirmation is enabled on the project.
        var e = new Error("Account created. Confirm via the email Supabase sent, then Log in."); e.info = true; throw e;
      });
    },
    login: function (email, password) {
      return sbAuth("/auth/v1/token?grant_type=password", { email: email, password: password }).then(function (r) { storeSession(r); return { user: { email: (r.user && r.user.email) || email } }; });
    },
    logout: function () { delete cfg.sb; delete cfg.email; delete cfg.workspaceId; save(); },
    listWorkspaces: function () { return sbRpc("fd_list", {}); },
    createWorkspace: function (name) { return sbRpc("fd_create_ws", { p_name: name }); },
    invite: function (ws) { return sbRpc("fd_invite", { p_ws: ws }); },
    join: function (code) { return sbRpc("fd_join", { p_code: code }); },
    pullData: function (ws) { return sbRpc("fd_pull", { p_ws: ws }); },
    pushData: function (ws, base, data) {
      return sbRpc("fd_push", { p_ws: ws, p_base: base, p_data: data }).then(function (r) {
        if (r && r.ok === false) { var e = new Error("Out of date — pull the latest first."); e.status = 409; e.data = r; throw e; }
        return r;
      });
    },
  };

  var providers = { server: serverProvider, supabase: supabaseProvider };
  function provider() { return providers[cfg.backend] || serverProvider; }

  var Sync = {
    config: function () { return cfg; },
    backend: function () { return cfg.backend; },
    setBackend: function (b) { cfg.backend = (b === "supabase" ? "supabase" : "server"); save(); },
    isConfigured: function () { return provider().isConfigured(); },
    isLoggedIn: function () { return provider().isLoggedIn(); },
    activeWorkspace: function () { return cfg.workspaceId || null; },
    versionFor: function (wsId) { return cfg.versions[wsId] || 0; },

    setServer: function (url) { cfg.url = url; save(); },
    setSupabase: function (url, anonKey) { cfg.sbUrl = url; cfg.anonKey = anonKey; save(); },

    health: function () { return provider().health(); },
    register: function (email, password) { return provider().register(email, password); },
    login: function (email, password) { return provider().login(email, password); },
    logout: function () { provider().logout(); },
    listWorkspaces: function () { return provider().listWorkspaces(); },
    createWorkspace: function (name) { return provider().createWorkspace(name); },
    invite: function (wsId) { return provider().invite(wsId); },
    join: function (code) { return provider().join(code); },
    selectWorkspace: function (wsId) { cfg.workspaceId = wsId; save(); },

    // ---- End-to-end encryption (backend never sees plaintext or passphrase) ----
    isE2EE: function () { return !!(cfg.e2ee && cfg.e2ee.enabled && cfg.e2ee.passphrase); },
    setE2EE: function (passphrase) { cfg.e2ee = { enabled: true, passphrase: passphrase }; save(); },
    disableE2EE: function () { cfg.e2ee = { enabled: false }; save(); },

    isAutoSync: function () { return !!cfg.autoSync; },
    setAutoSync: function (on) { cfg.autoSync = !!on; save(); },

    pull: function (wsId) {
      return provider().pullData(wsId).then(function (r) {
        cfg.versions[wsId] = r.version; save();
        var payload = r.data;
        if (payload && payload.e2ee) {
          if (!Sync.isE2EE()) throw new Error("This data is end-to-end encrypted. Turn on encryption with the passphrase on this device first.");
          return root.FDVault.decryptData(cfg.e2ee.passphrase, payload)
            .then(function (plain) { return { version: r.version, data: plain, updatedAt: r.updatedAt }; })
            .catch(function () { throw new Error("Could not decrypt — check your sync passphrase."); });
        }
        return r;
      });
    },
    push: function (wsId, data) {
      var prep = Sync.isE2EE()
        ? root.FDVault.encryptData(cfg.e2ee.passphrase, data).then(function (env) { env.e2ee = 1; return env; })
        : Promise.resolve(data);
      return prep.then(function (payload) {
        return provider().pushData(wsId, cfg.versions[wsId] || 0, payload).then(function (r) { cfg.versions[wsId] = r.version; save(); return r; });
      });
    },
  };

  root.FDSync = Sync;
  if (typeof module !== "undefined" && module.exports) module.exports = Sync;
})(typeof window !== "undefined" ? window : globalThis);
