/* ==========================================================================
   Story landing page behaviour.
   Re-run by the router on every visit, so everything lives in an IIFE and
   registers a cleanup hook.
   ========================================================================== */

(function () {
  "use strict";

  /* --- 1. Relative upload times ----------------------------------------
     The HTML ships an absolute date inside <time datetime="...">, so the
     page is correct with JS off and never goes stale in a cache. We only
     rewrite the visible text to "3 days ago" here. */

  const UNITS = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];

  function relativeTime(iso) {
    const then = new Date(iso);
    if (isNaN(then)) return null;

    const seconds = Math.round((then - Date.now()) / 1000);
    const abs = Math.abs(seconds);
    if (abs < 60) return "just now";

    const rtf = new Intl.RelativeTimeFormat(
      document.documentElement.lang || "en",
      {
        numeric: "auto",
      },
    );

    for (const [unit, size] of UNITS) {
      if (abs >= size) return rtf.format(Math.round(seconds / size), unit);
    }
    return null;
  }

  document.querySelectorAll("time[datetime]").forEach((el) => {
    const text = relativeTime(el.getAttribute("datetime"));
    if (!text) return;
    el.title = el.textContent.trim(); // keep the exact date on hover
    el.textContent = text;
  });

  /* --- 2. Synopsis: clamp to 4 lines, offer to unfold -------------------
     The button only appears if the text actually overflows, so short
     synopses don't get a pointless toggle. */

  const synopsis = document.querySelector(".story-synopsis");
  const synopsisBtn = document.querySelector(".story-toggle--synopsis");

  if (synopsis && synopsisBtn) {
    const overflows = () => synopsis.scrollHeight > synopsis.clientHeight + 2;

    synopsis.classList.add("is-clamped");
    synopsisBtn.hidden = !overflows();

    synopsisBtn.addEventListener("click", () => {
      const clamped = synopsis.classList.toggle("is-clamped");
      synopsisBtn.textContent = clamped ? "Show more ⬇️" : "Show less 🔼";
      synopsisBtn.setAttribute("aria-expanded", String(!clamped));
    });
  }

  /* --- 3. Chapter table: 9 rows by default ------------------------------ */

  const table = document.querySelector(".chapter-table");
  const tableBtn = document.querySelector(".story-toggle--chapters");

  if (table && tableBtn) {
    const hidden = table.querySelectorAll("tr.is-extra").length;
    tableBtn.hidden = hidden === 0;
    if (hidden) tableBtn.textContent = `Show more (${hidden}) ⬇️`;

    tableBtn.addEventListener("click", () => {
      const expanded = table.classList.toggle("is-expanded");
      tableBtn.textContent = expanded
        ? "Show less 🔼"
        : `Show more (${hidden}) ⬇️`;
      tableBtn.setAttribute("aria-expanded", String(expanded));
    });
  }

  /* --- 4. Cleanup ------------------------------------------------------- */
  // Listeners above are attached to elements inside #page, which the router
  // discards wholesale on navigation, so there is nothing global to undo.
  window.__spaCleanup = null;
})();
