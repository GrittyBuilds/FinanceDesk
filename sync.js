/* Finance Desk — client sync layer for the self-hosted server.
 *
 * Talks to the Node sync server (see server/). Stores connection config in
 * localStorage (server URL, auth token, active workspace, last-seen versions).
 * Sync is whole-dataset with optimistic concurrency: push sends the version you
 * last saw; the server rejects (409) if someone else pushed in the meantime,
 * prompting a pull first.
 */
(function (root) {
  "use strict";

  var CONFIG_KEY = "financedesk.sync";

  function load() {
    try { return JSON.parse(root.localStorage.getItem(CONFIG_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function save(cfg) { try { root.localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch (e) {} }

  var cfg = load();
  if (!cfg.versions) cfg.versions = {};

  function base() { return (cfg.url || "").replace(/\/+$/, ""); }

  function api(method, path, body, auth) {
    var headers = { "Content-Type": "application/json" };
    if (auth && cfg.token) headers.Authorization = "Bearer " + cfg.token;
    return fetch(base() + path, {
      method: method, headers: headers, body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.text().then(function (t) {
        var data = null; try { data = t ? JSON.parse(t) : null; } catch (e) {}
        if (!res.ok) {
          var err = new Error((data && data.error) || ("HTTP " + res.status));
          err.status = res.status; err.data = data; throw err;
        }
        return data;
      });
    });
  }

  var Sync = {
    config: function () { return cfg; },
    isConfigured: function () { return !!cfg.url; },
    isLoggedIn: function () { return !!cfg.token; },
    activeWorkspace: function () { return cfg.workspaceId || null; },
    versionFor: function (wsId) { return cfg.versions[wsId] || 0; },

    setServer: function (url) { cfg.url = url; save(cfg); },

    health: function () { return api("GET", "/api/health", null, false); },

    register: function (email, password) {
      return api("POST", "/api/register", { email: email, password: password }, false)
        .then(function (r) { cfg.token = r.token; cfg.email = r.user.email; save(cfg); return r; });
    },
    login: function (email, password) {
      return api("POST", "/api/login", { email: email, password: password }, false)
        .then(function (r) { cfg.token = r.token; cfg.email = r.user.email; save(cfg); return r; });
    },
    logout: function () { delete cfg.token; delete cfg.email; delete cfg.workspaceId; save(cfg); },

    listWorkspaces: function () { return api("GET", "/api/workspaces", null, true); },
    createWorkspace: function (name) { return api("POST", "/api/workspaces", { name: name }, true); },
    invite: function (wsId) { return api("POST", "/api/workspaces/" + wsId + "/invite", {}, true); },
    join: function (code) { return api("POST", "/api/workspaces/join", { code: code }, true); },

    selectWorkspace: function (wsId) { cfg.workspaceId = wsId; save(cfg); },

    pull: function (wsId) {
      return api("GET", "/api/workspaces/" + wsId + "/data", null, true).then(function (r) {
        cfg.versions[wsId] = r.version; save(cfg); return r; // { version, data, updatedAt }
      });
    },
    push: function (wsId, data) {
      return api("PUT", "/api/workspaces/" + wsId + "/data", { baseVersion: cfg.versions[wsId] || 0, data: data }, true)
        .then(function (r) { cfg.versions[wsId] = r.version; save(cfg); return r; });
    },
  };

  root.FDSync = Sync;
  if (typeof module !== "undefined" && module.exports) module.exports = Sync;
})(typeof window !== "undefined" ? window : globalThis);
