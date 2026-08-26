/* ==========================================================================
   SPA router
   --------------------------------------------------------------------------
   Intercepts same-origin link clicks, fetches the target page, and swaps only
   the contents of #page. Per-section <link rel="stylesheet"> and <script src>
   found in the fetched page are loaded, and unloaded again when you navigate
   away.

   Every page is still a real, complete HTML file, so direct links, refreshes,
   search engines and no-JS visitors all work normally. The router is purely an
   enhancement on top of that.

   Conventions a section page must follow:
   - its swappable content lives inside <main class="page" id="page">
   - its own CSS/JS are declared as normal <link>/<script src> tags in the page
   - its JS is wrapped in an IIFE (it may run more than once per session)
   - if its JS starts timers or global listeners, it sets window.__spaCleanup
     to a function that tears them down
   ========================================================================== */

(() => {
  "use strict";

  const CONTAINER_ID = "page";
  const FADE_MS = 160;

  // fetch() is blocked on file:// URLs, and the History API needs a server.
  // In those cases we simply do nothing and links behave like normal links.
  const supported =
    location.protocol !== "file:" &&
    typeof window.fetch === "function" &&
    !!(window.history && window.history.pushState);

  if (!supported) return;

  const container = document.getElementById(CONTAINER_ID);
  if (!container) return;

  // Assets present on first load belong to the shell and are never removed.
  const shellCss = new Set(
    [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href)
  );
  const shellJs = new Set(
    [...document.querySelectorAll("script[src]")].map((s) => s.src)
  );

  const cache = new Map(); // url -> html, filled by prefetch on hover
  let currentRequest = 0;

  /* ---------------------------------------------------------------- helpers */

  const absolute = (value, base) => new URL(value, base).href;

  // Relative hrefs resolve against the document's *current* URL, and pushState
  // changes that URL. So a nav link written as "stories/index.html" would
  // resolve to /stories/stories/index.html once we are on the stories page.
  // The shell is never re-rendered, so we freeze its links to absolute URLs
  // once, on first load, while the base URL is still correct.
  function freezeShellLinks() {
    document.querySelectorAll("a[href]").forEach((a) => {
      if (container.contains(a)) return;      // swapped content is rewritten separately
      const raw = a.getAttribute("href");
      if (raw.startsWith("#") || /^[a-z]+:/i.test(raw)) return;
      a.setAttribute("href", a.href);         // .href is already resolved correctly
    });
  }

  freezeShellLinks();

  // Content fetched from /stories/ carries URLs relative to /stories/. Once it
  // is injected into the root document those would resolve against the root,
  // so rewrite them against the page they came from.
  function resolveUrls(root, base) {
    root.querySelectorAll("[src]").forEach((el) => {
      el.setAttribute("src", absolute(el.getAttribute("src"), base));
    });

    root.querySelectorAll("[href]").forEach((el) => {
      const href = el.getAttribute("href");
      if (href.startsWith("#") || /^[a-z]+:/i.test(href)) return;
      el.setAttribute("href", absolute(href, base));
    });

    root.querySelectorAll("[srcset]").forEach((el) => {
      const rewritten = el
        .getAttribute("srcset")
        .split(",")
        .map((entry) => {
          const [url, ...rest] = entry.trim().split(/\s+/);
          return [absolute(url, base), ...rest].join(" ");
        })
        .join(", ");
      el.setAttribute("srcset", rewritten);
    });
  }

  const loadCss = (href) =>
    new Promise((resolve) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.dataset.spaCss = "";
      link.onload = link.onerror = () => resolve();
      document.head.appendChild(link);
    });

  const loadJs = (src) =>
    new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = src;
      script.dataset.spaJs = "";
      script.onload = script.onerror = () => resolve();
      document.body.appendChild(script);
    });

  // Swap stylesheets before the DOM changes, so the new content never paints
  // unstyled. Sheets shared with the page we are leaving stay put.
  async function syncCss(doc, base) {
    const wanted = [...doc.querySelectorAll('link[rel="stylesheet"]')]
      .map((l) => absolute(l.getAttribute("href"), base))
      .filter((href) => !shellCss.has(href));

    document.querySelectorAll("link[data-spa-css]").forEach((link) => {
      if (!wanted.includes(link.href)) link.remove();
    });

    const present = new Set(
      [...document.querySelectorAll("link[data-spa-css]")].map((l) => l.href)
    );

    await Promise.all(wanted.filter((h) => !present.has(h)).map(loadCss));
  }

  // Scripts are always torn down and re-added, in document order, so each
  // section gets a clean run. Re-appending a <script> re-executes it even when
  // the file is cached, which is why section scripts must be IIFEs.
  async function syncJs(doc, base) {
    document.querySelectorAll("script[data-spa-js]").forEach((s) => s.remove());

    const wanted = [...doc.querySelectorAll("script[src]")]
      .map((s) => absolute(s.getAttribute("src"), base))
      .filter((src) => !shellJs.has(src));

    for (const src of wanted) await loadJs(src);
  }

  // Which section a URL belongs to: /stories/sundays/ -> "stories", / -> "".
  // Matching on the section rather than the exact URL means deep pages
  // (a story, a chapter) still light up the right nav item.
  function sectionOf(url) {
    const parts = new URL(url, location.href).pathname.split("/").filter(Boolean);
    const first = parts[0] || "";
    return first.endsWith(".html") ? "" : first;
  }

  function setActiveNav(url) {
    const here = sectionOf(url);
    document.querySelectorAll(".site-nav a").forEach((a) => {
      const match = sectionOf(a.href) === here;
      a.classList.toggle("is-current", match);
      if (match) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  /* ------------------------------------------------------------- navigation */

  // Returns { html, url }. The url is the URL *after* any redirect, which
  // matters: a link written as "sundays" makes the server redirect to
  // "sundays/", and resolving relative paths against the pre-redirect URL
  // puts everything one directory too high.
  async function fetchPage(url) {
    if (cache.has(url)) return cache.get(url);
    const res = await fetch(url, { headers: { "X-Requested-With": "spa" } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const page = { html: await res.text(), url: res.url || url };
    cache.set(url, page);
    return page;
  }

  async function navigate(url, { push = true } = {}) {
    const token = ++currentRequest;
    container.setAttribute("aria-busy", "true");
    container.classList.add("is-leaving");

    let page;
    try {
      page = await fetchPage(url);
    } catch (err) {
      // Fall back to a normal page load rather than stranding the visitor.
      window.location.href = url;
      return;
    }

    if (token !== currentRequest) return; // a newer click won

    // Everything downstream uses the post-redirect URL, so "sundays",
    // "sundays/" and "sundays/index.html" all behave identically.
    // fetch() strips #fragments and res.url comes back without them, so the
    // fragment from the clicked link is re-attached — a comic page link like
    // read/index.html#15 must land on page 15, not page 1.
    const fragment = new URL(url, location.href).hash;
    const finalUrl = page.url + fragment;
    const doc = new DOMParser().parseFromString(page.html, "text/html");
    const base = new URL(finalUrl, location.href);
    const next = doc.getElementById(CONTAINER_ID) || doc.querySelector("main");

    if (!next) {
      window.location.href = url;
      return;
    }

    resolveUrls(next, base);

    // Let the outgoing section stop its own timers and listeners.
    if (typeof window.__spaCleanup === "function") {
      try { window.__spaCleanup(); } catch (e) { console.error(e); }
    }
    delete window.__spaCleanup;

    await syncCss(doc, base);
    if (token !== currentRequest) return;

    container.innerHTML = next.innerHTML;
    container.className = next.className;
    document.title = doc.title;

    if (push) history.pushState({ url: finalUrl }, "", finalUrl);
    setActiveNav(base.href);

    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });

    await syncJs(doc, base);
    if (token !== currentRequest) return;

    container.classList.remove("is-leaving");
    container.removeAttribute("aria-busy");

    // Move focus to the new content so keyboard and screen reader users are
    // not left at the top of a page that silently changed underneath them.
    const heading = container.querySelector("h1, h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }

    document.dispatchEvent(new CustomEvent("spa:navigated", { detail: { url } }));
  }

  /* ----------------------------------------------------------- link binding */

  const isInternal = (link) => {
    if (!link || !link.href) return false;
    if (link.origin !== location.origin) return false;
    if (link.hasAttribute("download") || link.hasAttribute("data-no-spa")) return false;
    if (link.target && link.target !== "_self") return false;
    // Pure in-page anchors are left to the browser.
    if (link.hash && link.pathname === location.pathname) return false;
    return true;
  };

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const link = e.target.closest("a");
    if (!isInternal(link)) return;
    if (link.href === location.href) { e.preventDefault(); return; }

    e.preventDefault();
    navigate(link.href);
  });

  // Warm the cache when a link looks like it is about to be clicked.
  const prefetch = (e) => {
    const link = e.target.closest("a");
    if (!isInternal(link) || cache.has(link.href)) return;
    fetchPage(link.href).catch(() => {});
  };

  document.addEventListener("mouseover", prefetch, { passive: true });
  document.addEventListener("touchstart", prefetch, { passive: true });

  window.addEventListener("popstate", (e) => {
    navigate((e.state && e.state.url) || location.href, { push: false });
  });

  history.replaceState({ url: location.href }, "", location.href);
})();
