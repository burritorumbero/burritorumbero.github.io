/* ==========================================================================
   Fullscreen comic reader.
   Phones: swipe left = next page, swipe right = previous.
   Keyboards + pointers: on-screen arrows and ← / → keys.
   The current page number lives in the URL hash (#3), so a page can be
   linked, refreshed and shared. Neighbouring pages are preloaded so paging
   feels instant.
   Re-run by the router on every visit → IIFE + __spaCleanup.
   ========================================================================== */

(function () {
  "use strict";

  var host = document.getElementById("reader");
  if (!host) return;

  var pages = JSON.parse(host.dataset.pages || "[]");
  var base = host.dataset.base || "";
  if (!pages.length) return;

  var PRELOAD_AHEAD = 2;  // pages fetched beyond the one on screen
  var PRELOAD_BEHIND = 1;
  var SWIPE_MIN_PX = 45;  // shorter drags are taps/scroll noise

  /* ---------------------------------------------------------------- build UI */

  host.innerHTML = "";

  var back = document.createElement("a");
  back.className = "reader__back";
  back.href = host.dataset.exit || "../index.html";
  back.setAttribute("aria-label", "Leave reader");
  back.textContent = "←";

  var img = document.createElement("img");
  img.className = "reader__img";
  img.alt = "";

  var spinner = document.createElement("span");
  spinner.className = "reader__spinner";

  var prevBtn = document.createElement("button");
  prevBtn.className = "reader__arrow reader__arrow--prev";
  prevBtn.type = "button";
  prevBtn.setAttribute("aria-label", "Previous page");
  prevBtn.textContent = "←";

  var nextBtn = document.createElement("button");
  nextBtn.className = "reader__arrow reader__arrow--next";
  nextBtn.type = "button";
  nextBtn.setAttribute("aria-label", "Next page");
  nextBtn.textContent = "→";

  var counter = document.createElement("span");
  counter.className = "reader__counter";
  counter.setAttribute("aria-live", "polite");

  host.append(back, spinner, img, prevBtn, nextBtn, counter);

  // The reader owns the whole viewport; stop the page behind it scrolling.
  var previousOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";

  /* ------------------------------------------------------------------ state */

  var current = 0;                 // 0-based index into pages
  var preloaded = Object.create(null);

  function urlFor(i) {
    return base + pages[i];
  }

  function clamp(i) {
    return Math.max(0, Math.min(pages.length - 1, i));
  }

  function pageFromHash() {
    var n = parseInt((location.hash || "").replace("#", ""), 10);
    return isNaN(n) ? 0 : clamp(n - 1);
  }

  function preloadAround(i) {
    for (var d = -PRELOAD_BEHIND; d <= PRELOAD_AHEAD; d++) {
      var j = i + d;
      if (j < 0 || j >= pages.length || j === i || preloaded[j]) continue;
      preloaded[j] = new Image();
      preloaded[j].src = urlFor(j);
    }
  }

  function show(i, replaceHash) {
    current = clamp(i);

    img.classList.add("is-loading");
    spinner.hidden = false;
    img.src = urlFor(current);

    var done = function () {
      img.classList.remove("is-loading");
      spinner.hidden = true;
    };
    if (img.decode) img.decode().then(done, done);
    else img.onload = done;

    counter.textContent = (current + 1) + " / " + pages.length;
    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === pages.length - 1;

    // replaceState rather than pushState: the browser back button should
    // leave the reader, not retrace every page turned.
    if (replaceHash !== false) {
      history.replaceState(history.state, "", "#" + (current + 1));
    }

    preloadAround(current);
  }

  function step(delta) {
    var target = current + delta;
    if (target >= 0 && target < pages.length) show(target);
  }

  /* ------------------------------------------------------------------ input */

  prevBtn.addEventListener("click", function () { step(-1); });
  nextBtn.addEventListener("click", function () { step(1); });

  function onKey(e) {
    if (e.key === "ArrowRight") { step(1); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { step(-1); e.preventDefault(); }
  }
  document.addEventListener("keydown", onKey);

  // Swipe: horizontal drags only, so vertical pans and pinch-zoom stay native.
  var touchX = null, touchY = null;

  function onTouchStart(e) {
    if (e.touches.length !== 1) { touchX = null; return; }
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }

  function onTouchEnd(e) {
    if (touchX === null || !e.changedTouches.length) return;
    var dx = e.changedTouches[0].clientX - touchX;
    var dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy)) return;
    step(dx < 0 ? 1 : -1); // swipe left → next
  }

  host.addEventListener("touchstart", onTouchStart, { passive: true });
  host.addEventListener("touchend", onTouchEnd, { passive: true });

  // Hash edited by hand, or arriving from a browse-page link.
  function onHashChange() { show(pageFromHash(), false); }
  window.addEventListener("hashchange", onHashChange);

  /* ---------------------------------------------------------------- start */

  show(pageFromHash());

  window.__spaCleanup = function () {
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("hashchange", onHashChange);
    document.documentElement.style.overflow = previousOverflow;
  };
})();
