// Staff login gate for the role consoles. Gives managers/finance/supervisors/
// admins a real per-user session (phone + PIN -> hardened session tokens) instead
// of the shared service-token link. Self-contained: include it right after
// flexi-env.js and before the console's app.js. No app.js changes needed — a
// global fetch wrapper injects the live token and refreshes on 401.
(function () {
  "use strict";
  var ACCESS = "flexiStaffAccess";
  var REFRESH = "flexiStaffRefresh";
  var EXPIRY = "flexiStaffExpiry";
  var foundationBase = window.flexiServiceBase("foundation", 4010);
  // Staff sign in with just their username; the domain is baked in and appended
  // on submit, so nobody types "@fleximotion.online". A full email or phone
  // typed in (contains "@") is still passed through unchanged.
  var EMAIL_DOMAIN = "fleximotion.online";

  var script = document.currentScript;
  var allowedRoles = (script && script.dataset.roles ? script.dataset.roles : "")
    .split(",").map(function (r) { return r.trim(); }).filter(Boolean);
  var consoleName = (script && script.dataset.console) || document.title || "this console";

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function del(k) { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } }

  function storeSession(s) {
    set(ACCESS, s.access_token);
    set(REFRESH, s.refresh_token);
    set(EXPIRY, String(Date.now() + (Number(s.expires_in || 3600) * 1000)));
  }
  function clearSession() { del(ACCESS); del(REFRESH); del(EXPIRY); }

  var query = new URLSearchParams(location.search);
  var hasQueryToken = !!query.get("token");
  var isLocal = ["127.0.0.1", "localhost", ""].indexOf(location.hostname) !== -1;

  // --- refresh ---------------------------------------------------------------
  var refreshing = null;
  function refresh() {
    if (refreshing) return refreshing;
    var rt = get(REFRESH);
    if (!rt) return Promise.resolve(false);
    refreshing = fetch(foundationBase + "/identity/v1/auth/refresh", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt })
    }).then(function (r) {
      if (!r.ok) return false;
      return r.json().then(function (s) { storeSession(s); return true; });
    }).catch(function () { return false; }).then(function (ok) {
      refreshing = null;
      if (!ok) { clearSession(); showLogin("Your session expired — please sign in again."); }
      return ok;
    });
    return refreshing;
  }

  // --- global fetch wrapper (API calls only) ---------------------------------
  function isApiUrl(url) {
    try {
      var u = new URL(url, location.href);
      if (u.pathname.indexOf("/services/") !== -1) return true; // deployed proxy layout
      return /^\/(identity|ops|amoeba|payments)\//.test(u.pathname);
    } catch (e) { return false; }
  }
  function installFetchWrapper() {
    var orig = window.fetch.bind(window);
    window.fetch = function (input, init) {
      init = init || {};
      var url = typeof input === "string" ? input : (input && input.url) || "";
      if (typeof input !== "string" || !isApiUrl(url) || !get(ACCESS)) return orig(input, init);
      function withToken() {
        var headers = Object.assign({}, init.headers || {}, { Authorization: "Bearer " + get(ACCESS) });
        return Object.assign({}, init, { headers: headers });
      }
      return orig(url, withToken()).then(function (res) {
        if (res.status !== 401) return res;
        return refresh().then(function (ok) { return ok ? orig(url, withToken()) : res; });
      });
    };
  }

  // --- proactive refresh (so a cached token never goes stale mid-session) -----
  function scheduleRefresh() {
    function tick() {
      var exp = Number(get(EXPIRY) || 0);
      if (exp && Date.now() > exp - 5 * 60 * 1000) refresh();
    }
    setInterval(tick, 60 * 1000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });
  }

  // --- logout ----------------------------------------------------------------
  function logout() {
    var at = get(ACCESS);
    var done = function () { clearSession(); location.reload(); };
    if (!at) return done();
    fetch(foundationBase + "/identity/v1/auth/logout", {
      method: "POST", headers: { Authorization: "Bearer " + at }
    }).then(done, done);
  }
  function injectLogout() {
    var btn = document.createElement("button");
    btn.textContent = "Sign out";
    btn.setAttribute("aria-label", "Sign out");
    btn.style.cssText = "position:fixed;top:10px;right:12px;z-index:9998;font:500 12px/1 sans-serif;" +
      "padding:7px 12px;border-radius:8px;border:1px solid rgba(0,0,0,.15);background:#fff;color:#333;cursor:pointer;";
    btn.addEventListener("click", logout);
    document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(btn); });
    if (document.body) document.body.appendChild(btn);
  }

  // --- login overlay ---------------------------------------------------------
  function showLogin(message) {
    var existing = document.getElementById("flexiLoginOverlay");
    if (existing) { if (message) existing.querySelector("[data-notice]").textContent = message; return; }
    var wrap = document.createElement("div");
    wrap.id = "flexiLoginOverlay";
    wrap.style.cssText = "position:fixed;inset:0;z-index:9999;background:#0f1912;display:flex;" +
      "align-items:center;justify-content:center;padding:16px;font-family:sans-serif;";
    wrap.innerHTML =
      '<form style="width:100%;max-width:340px;background:#fff;border-radius:14px;padding:24px;box-sizing:border-box;">' +
      '<div style="font:500 18px/1.3 sans-serif;color:#13261c;margin-bottom:4px;">Fleximotion sign in</div>' +
      '<div style="font:400 13px/1.5 sans-serif;color:#5f6b63;margin-bottom:16px;">' + esc(consoleName) + '</div>' +
      '<label style="display:block;font:400 13px sans-serif;color:#333;margin-bottom:12px;">Username' +
      '<span style="display:flex;align-items:stretch;margin-top:4px;border:1px solid #cfd6d1;border-radius:8px;overflow:hidden;">' +
      '<input name="username" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" required style="flex:1;min-width:0;box-sizing:border-box;padding:10px;border:0;outline:none;font-size:15px;"/>' +
      '<span aria-hidden="true" style="display:flex;align-items:center;padding:0 10px;background:#f2f5f3;color:#5f6b63;font-size:14px;white-space:nowrap;border-left:1px solid #cfd6d1;">@' + esc(EMAIL_DOMAIN) + '</span>' +
      '</span></label>' +
      '<label style="display:block;font:400 13px sans-serif;color:#333;margin-bottom:16px;">PIN' +
      '<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" required style="width:100%;box-sizing:border-box;margin-top:4px;padding:10px;border:1px solid #cfd6d1;border-radius:8px;font-size:15px;"/></label>' +
      '<button type="submit" style="width:100%;padding:11px;border:0;border-radius:8px;background:#1d9e75;color:#fff;font:500 15px sans-serif;cursor:pointer;">Sign in</button>' +
      '<p data-notice role="status" style="font:400 13px/1.4 sans-serif;color:#c0392b;margin:12px 0 0;min-height:18px;">' + esc(message || "") + '</p>' +
      '</form>';
    var mount = function () { document.body.appendChild(wrap); };
    if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
    wrap.addEventListener("submit", function (e) {
      e.preventDefault();
      var notice = wrap.querySelector("[data-notice]");
      var btn = wrap.querySelector("button[type=submit]");
      var data = new FormData(e.target);
      var typed = String(data.get("username") || "").trim().toLowerCase().replace(/[\s]/g, "");
      var creds = {
        // Append the baked-in domain unless they typed a full email (or anything with "@").
        phone_or_email: !typed ? "" : (typed.indexOf("@") !== -1 ? typed : typed + "@" + EMAIL_DOMAIN),
        pin: String(data.get("pin") || "").trim()
      };
      btn.disabled = true; notice.textContent = "Signing in…";
      fetch(foundationBase + "/identity/v1/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(creds)
      }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error((res.b.error && res.b.error.message) || res.b.message || "Invalid login credentials.");
          return checkRole(res.b);
        })
        .then(function (session) { storeSession(session); location.reload(); })
        .catch(function (err) { btn.disabled = false; notice.textContent = err.message; });
    });
  }

  // Confirm the signed-in user may use this console, else reject before storing.
  function checkRole(session) {
    if (!allowedRoles.length) return Promise.resolve(session);
    return fetch(foundationBase + "/identity/v1/me", {
      headers: { Authorization: "Bearer " + session.access_token }
    }).then(function (r) { return r.json(); }).then(function (me) {
      var roles = (me && me.roles) || [];
      var ok = roles.some(function (role) { return allowedRoles.indexOf(role) !== -1; });
      if (ok) return session;
      // Don't leave a half-session around for a console they can't use.
      fetch(foundationBase + "/identity/v1/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + session.access_token } }).catch(function () {});
      throw new Error("Your account doesn't have access to " + consoleName + ".");
    });
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  window.flexiAuth = { logout: logout, getToken: function () { return get(ACCESS); }, signedIn: function () { return !!get(ACCESS); } };

  // --- mode decision ---------------------------------------------------------
  if (hasQueryToken) return;                 // explicit dev/test token link wins
  if (get(ACCESS)) { installFetchWrapper(); scheduleRefresh(); injectLogout(); return; }
  if (isLocal) return;                       // local dev uses the dev token fallback
  showLogin("");                             // deployed, no session -> require login
})();
