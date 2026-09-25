/* FlexiMOS Admin Kit — shared shell behaviour for the admin consoles.
   Framework-free. Exposes window.AdminKit. */
(function () {
  const AdminKit = {};

  function hashId() { return (location.hash || "").replace(/^#/, ""); }

  // Hash-routed view switching: show one .view section at a time, sync the
  // sidebar nav + status chips. Deep links (#section) keep working.
  AdminKit.mountViews = function (opts) {
    opts = opts || {};
    const navSelector = opts.navSelector || ".rail nav a";
    const defaultView = opts.defaultView;
    const views = () => [...document.querySelectorAll(".view")];
    const navLinks = () => [...document.querySelectorAll(navSelector)];
    const targetOf = (a) => (a.getAttribute("href") || "").replace(/^#/, "");

    function resolve() {
      const id = hashId();
      if (id && document.getElementById(id)?.classList.contains("view")) return id;
      return defaultView || (views()[0] && views()[0].id);
    }
    function activate(id) {
      views().forEach((v) => v.classList.toggle("view-active", v.id === id));
      navLinks().forEach((a) => a.classList.toggle("active", targetOf(a) === id));
      document.querySelectorAll(".status-grid .stat").forEach((s) =>
        s.classList.toggle("active", targetOf(s) === id));
      window.scrollTo(0, 0);
      if (typeof opts.onChange === "function") opts.onChange(id);
    }
    window.addEventListener("hashchange", () => activate(resolve()));
    activate(resolve());
    return { activate, current: resolve };
  };

  // Filter the sidebar nav (and its group labels) by a search box.
  AdminKit.wireNavSearch = function (input, navSelector) {
    navSelector = navSelector || ".rail nav a";
    if (!input) return;
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      const links = [...document.querySelectorAll(navSelector)];
      links.forEach((a) => {
        const match = !q || a.textContent.toLowerCase().includes(q);
        a.hidden = !match;
      });
      // Hide a group label when all its links are hidden.
      document.querySelectorAll(".nav-group").forEach((g) => {
        let n = g.nextElementSibling, anyVisible = false;
        while (n && !n.classList.contains("nav-group")) {
          if (n.matches(navSelector) && !n.hidden) anyVisible = true;
          n = n.nextElementSibling;
        }
        g.hidden = q && !anyVisible;
      });
    });
  };

  AdminKit.setConnection = function (dotEl, textEl, state, text) {
    if (dotEl) dotEl.className = "conn-dot" + (state === "ok" ? " ok" : state === "bad" ? " bad" : "");
    if (textEl) textEl.textContent = text || "";
  };

  let toastHost = null;
  AdminKit.toast = function (message, kind) {
    if (!toastHost) {
      toastHost = document.createElement("div");
      toastHost.className = "toast-host";
      document.body.appendChild(toastHost);
    }
    const el = document.createElement("div");
    el.className = "toast" + (kind === "error" ? " error" : "");
    el.textContent = message;
    toastHost.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 3200);
    setTimeout(() => el.remove(), 3600);
  };

  // Compact "⋯" row-actions menu. actions = [{label, onClick, danger, href}].
  AdminKit.rowMenu = function (actions) {
    const wrap = document.createElement("div");
    wrap.className = "row-menu";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "row-menu-toggle";
    toggle.setAttribute("aria-label", "Row actions");
    toggle.textContent = "⋯";
    const pop = document.createElement("div");
    pop.className = "row-menu-pop";
    (actions || []).forEach((a) => {
      const item = a.href ? document.createElement("a") : document.createElement("button");
      if (a.href) { item.href = a.href; if (a.target) item.target = a.target; }
      else item.type = "button";
      item.textContent = a.label;
      if (a.danger) item.className = "danger-text";
      if (a.onClick) item.addEventListener("click", (e) => { e.stopPropagation(); close(); a.onClick(e); });
      pop.appendChild(item);
    });
    function close() { wrap.classList.remove("open"); }
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".row-menu.open").forEach((m) => { if (m !== wrap) m.classList.remove("open"); });
      wrap.classList.toggle("open");
    });
    wrap.append(toggle, pop);
    return wrap;
  };
  document.addEventListener("click", () => document.querySelectorAll(".row-menu.open").forEach((m) => m.classList.remove("open")));

  window.AdminKit = AdminKit;
})();
