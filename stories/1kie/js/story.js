/* Per-story script. Same two rules as every section script: wrap in an IIFE,
   and register window.__spaCleanup for anything global. */

(() => {
  "use strict";

  const body = document.querySelector(".story-body");
  if (!body) return;

  // Trivial example: a reading-time estimate, injected into the meta line.
  const words = body.textContent.trim().split(/\s+/).length;
  const minutes = Math.max(1, Math.round(words / 220));
  const meta = document.querySelector(".story-meta");

  if (meta && !meta.dataset.timed) {
    meta.dataset.timed = "true";
    meta.textContent += ` · ${minutes} min read`;
  }
})();
