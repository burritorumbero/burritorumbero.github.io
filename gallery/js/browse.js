/* ==========================================================================
   Browse grid: thumbnails are all in the HTML, but only a batch at a time is
   shown. Scrolling near the bottom reveals the next batch, with a visible
   loading strip while the newly-revealed images fetch.
   Re-run by the router on every visit → IIFE + __spaCleanup.
   ========================================================================== */

(function () {
  "use strict";

  var grid = document.getElementById("browse");
  var sentinel = document.getElementById("browse-sentinel");
  if (!grid || !sentinel) return;

  var batch = parseInt(grid.dataset.batch, 10) || 12;
  var observer = null;
  var busy = false;

  // The sentinel stays in the layout the whole time — a display:none element
  // has no box and an IntersectionObserver would never fire on it. Only its
  // spinner + label toggle.
  sentinel.hidden = false;

  function pending() {
    return grid.querySelectorAll(".browse-item.is-pending");
  }

  function setLoading(on) {
    sentinel.classList.toggle("is-loading", on);
  }

  function finish() {
    setLoading(false);
    if (observer) observer.disconnect();
    sentinel.hidden = true;
  }

  function revealNext() {
    if (busy) return;
    var items = pending();
    if (!items.length) return finish();

    busy = true;
    setLoading(true);

    var slice = Array.prototype.slice.call(items, 0, batch);
    slice.forEach(function (item) { item.classList.remove("is-pending"); });

    // Keep the strip up until the revealed thumbnails arrive (or error).
    var imgs = slice
      .map(function (item) { return item.querySelector("img"); })
      .filter(function (im) { return im && !im.complete; });

    var settle = function () {
      busy = false;
      if (!pending().length) finish();
      else setLoading(false);
    };

    if (!imgs.length) return settle();

    var left = imgs.length;
    var one = function () { if (--left === 0) settle(); };
    imgs.forEach(function (im) {
      im.addEventListener("load", one, { once: true });
      im.addEventListener("error", one, { once: true });
    });
  }

  if (!pending().length) {
    finish(); // first batch already covers everything
  } else if ("IntersectionObserver" in window) {
    observer = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) revealNext();
    }, { rootMargin: "600px 0px" }); // start well before the viewport edge
    observer.observe(sentinel);
  } else {
    pending().forEach(function (item) { item.classList.remove("is-pending"); });
    finish();
  }

  window.__spaCleanup = function () {
    if (observer) observer.disconnect();
  };
})();
