/* ==========================================================================
   Fullscreen comic reader.
   Phones: swipe left = next page, swipe right = previous.
   Keyboards + pointers: on-screen arrows and ← / → keys.

   Pages are served responsively: each has AVIF and WebP copies at several
   widths, and the browser picks one to match the screen, so a phone never
   downloads a desktop-sized page. Neighbours are preloaded through the same
   srcset, so the preload fetches the same file the display will use.

   The current page number lives in the URL hash (#3) so a page can be linked,
   refreshed and shared.
   Re-run by the router on every visit → IIFE + __spaCleanup.
   ========================================================================== */

(function () {
  "use strict";

  var host = document.getElementById("reader");
  if (!host) return;

  var pages = JSON.parse(host.dataset.pages || "[]");
  if (!pages.length) return;

  var PRELOAD_AHEAD = 2;   // pages fetched beyond the one on screen
  var PRELOAD_BEHIND = 1;
  var SWIPE_MIN_PX = 45;   // shorter drags are taps or scroll noise
  var SIZES = "100vw";     // the reader fills the viewport

  /* ------------------------------------------------- format choice (once)

     A single <img> can only carry one srcset, so rather than juggling
     <source> elements on every page turn we decide AVIF-vs-WebP once and use
     that format throughout. Deciding up front is also what lets preloading
     work: an off-DOM Image with the same srcset+sizes resolves to the same
     candidate the visible <img> will request, so the preload is a cache hit
     rather than a second download. */

  var AVIF_PROBE =
    "data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIABoAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgABogQEDQgMgkQAAAAB8dSLfI=";

  function pickFormat() {
    return new Promise(function (resolve) {
      // No AVIF variants generated at all? Don't bother probing.
      var anyAvif = pages.some(function (p) { return p.v && p.v.avif; });
      if (!anyAvif) return resolve("webp");

      var probe = new Image();
      probe.onload = function () { resolve("avif"); };
      probe.onerror = function () { resolve("webp"); };
      probe.src = AVIF_PROBE;
    });
  }

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
  img.sizes = SIZES;

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

  var previousOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";

  /* ------------------------------------------------------------------ state */

  var current = 0;
  var format = "webp";
  var preloaded = Object.create(null);

  function srcsetFor(i) {
    var v = pages[i].v || {};
    return v[format] || v.webp || v.avif || "";
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

      var im = new Image();
      im.sizes = SIZES;
      var set = srcsetFor(j);
      // srcset must be set before src, or the browser may commit to src first.
      if (set) im.srcset = set;
      im.src = pages[j].src;   // fallback candidate / no-variant case
      preloaded[j] = im;
    }
  }

  function show(i, replaceHash) {
    current = clamp(i);

    img.classList.add("is-loading");
    spinner.hidden = false;

    var set = srcsetFor(current);
    img.removeAttribute("srcset");
    if (set) img.srcset = set;
    img.src = pages[current].src;

    var done = function () {
      img.classList.remove("is-loading");
      spinner.hidden = true;
    };
    if (img.decode) img.decode().then(done, done);
    else img.onload = done;

    counter.textContent = (current + 1) + " / " + pages.length;
    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === pages.length - 1;

    // replaceState, not pushState: the back button should leave the reader,
    // not retrace every page turned.
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

  function onHashChange() { show(pageFromHash(), false); }
  window.addEventListener("hashchange", onHashChange);

  /* ---------------------------------------------------------------- start */

  pickFormat().then(function (chosen) {
    format = chosen;
    show(pageFromHash());
  });

  window.__spaCleanup = function () {
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("hashchange", onHashChange);
    document.documentElement.style.overflow = previousOverflow;
  };
})();
