/* ==========================================================================
   Stories section script
   --------------------------------------------------------------------------
   Two rules for any section script, because the router re-runs it every time
   the section is entered:

   1. Wrap everything in an IIFE. A bare `const FOO = ...` at top level would
      throw "already declared" on the second visit.
   2. If you attach anything global (timers, window/document listeners), set
      window.__spaCleanup to remove it. The router calls that before swapping
      the section out, otherwise listeners pile up on every visit.

   Anything scoped to elements inside #page needs no cleanup — those elements
   are discarded with the swap.
   ========================================================================== */

(() => {
  "use strict";

  const cards = document.querySelectorAll(".story-card");
  if (!cards.length) return;

  // Stagger the cards in. Scoped to #page contents, so no cleanup needed.
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!reduced) {
    cards.forEach((card, i) => {
      card.style.opacity = "0";
      card.style.transform = "translateY(12px)";
      card.style.transition = "opacity .35s ease, transform .35s ease";
      setTimeout(() => {
        card.style.opacity = "";
        card.style.transform = "";
      }, 60 + i * 55);
    });
  }

  // Example of something that DOES need cleanup: a global listener.
  const onKey = (e) => {
    if (e.key !== "/" || e.target.matches("input, textarea")) return;
    e.preventDefault();
    cards[0].querySelector("a").focus();
  };

  document.addEventListener("keydown", onKey);

  window.__spaCleanup = () => {
    document.removeEventListener("keydown", onKey);
  };
})();
