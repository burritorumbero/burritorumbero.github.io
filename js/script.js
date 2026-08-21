/* ==========================================================================
   Danmaku flying words (bilibili-style)
   Words are read from words.txt (one word/phrase per line), fly right → left
   across the hero, and loop forever. Several can be on screen at once.
   ========================================================================== */

const SITE_ROOT = (() => {
  const self =
    document.currentScript ||
    [...document.querySelectorAll("script[src]")].find((s) => /js\/script\.js/.test(s.src));
  return self ? new URL("../", self.src).href : "/";
})();

const DANMAKU = {
  wordsUrl: "words.txt",
  spawnEvery: 1300,      // ms between new words (lower = denser)
  minDuration: 8,        // seconds to cross the hero (fastest)
  maxDuration: 14,       // seconds to cross the hero (slowest)
  minFontRem: 1.0,
  maxFontRem: 1.6,
  topBandPercent: [8, 80], // vertical band (in % of hero height) words can occupy

  // Used when words.txt can't be fetched (e.g. the page is opened straight
  // from the file system, where browsers block fetch()). Serve the folder
  // with any local server — `python -m http.server` — and the .txt is used.
  fallbackWords: [
    "hello!!", "so tall", "tiny city", "stomp stomp", "kaiju vibes",
    "great render", "she's back!", "POV: ant", "amazing", "run!!"
  ]
};

async function loadWords() {
  try {
    const res = await fetch(DANMAKU.wordsUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const words = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return words.length ? words : DANMAKU.fallbackWords;
  } catch {
    return DANMAKU.fallbackWords;
  }
}

function spawnWord(layer, word) {
  const el = document.createElement("span");
  el.className = "danmaku__word";
  el.textContent = word;

  // Random lane + size + speed so simultaneous words don't stack
  const [bandTop, bandBottom] = DANMAKU.topBandPercent;
  el.style.top = `${bandTop + Math.random() * (bandBottom - bandTop)}%`;
  el.style.fontSize = `${(DANMAKU.minFontRem +
    Math.random() * (DANMAKU.maxFontRem - DANMAKU.minFontRem)).toFixed(2)}rem`;
  el.style.animationDuration = `${(DANMAKU.minDuration +
    Math.random() * (DANMAKU.maxDuration - DANMAKU.minDuration)).toFixed(2)}s`;

  layer.appendChild(el);

  // Travel the full hero width plus the word's own width, so it fully exits
  const distance = layer.clientWidth + el.offsetWidth;
  el.style.setProperty("--fly-distance", `-${distance}px`);

  el.addEventListener("animationend", () => el.remove());
}

async function startDanmaku() {
  const layer = document.getElementById("danmaku");
  if (!layer) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reducedMotion.matches) return;

  const words = await loadWords();
  let index = 0;

  const spawnNext = () => {
    spawnWord(layer, words[index]);
    index = (index + 1) % words.length; // loop back to the top word
  };

  spawnNext(); // first word right away
  let timer = setInterval(spawnNext, DANMAKU.spawnEvery);

  // Don't pile up words while the tab is in the background
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearInterval(timer);
      timer = null;
    } else if (!timer) {
      timer = setInterval(spawnNext, DANMAKU.spawnEvery);
    }
  });
}

document.addEventListener("DOMContentLoaded", startDanmaku);

/* ==========================================================================
   Mascot behaviour
   - swings once after sliding up
   - tilts again when the pointer moves over it
   - shakes side to side when the visitor reaches the bottom of the page
   ========================================================================== */

const MASCOT = {
  bottomThreshold: 40,  // px from the page bottom that counts as "at the bottom"
  bottomResetGap: 160,  // px you must scroll back up before it can shake again
  hoverCooldown: 900    // ms before hovering can re-trigger the tilt
};

function startMascot() {
  const mascot = document.getElementById("mascot");
  if (!mascot) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let busy = false;

  const play = (className) => {
    if (busy) return;
    busy = true;
    mascot.classList.remove("is-swinging", "is-shaking");
    void mascot.offsetWidth; // restart the animation
    mascot.classList.add(className);
  };

  mascot.addEventListener("animationend", (e) => {
    if (e.target === mascot) return; // that was the slide-up, not a rotation
    mascot.classList.remove("is-swinging", "is-shaking");
    busy = false;
  });

  // 1. Swing once, right after the slide-up finishes.
  mascot.addEventListener("animationend", (e) => {
    if (e.animationName === "mascot-rise") play("is-swinging");
  }, { once: true });

  // 2. Hover tilt. The mascot has pointer-events: none so it never blocks
  //    clicks, so we test the cursor against its box instead of using :hover.
  let inside = false;
  let lastHover = 0;

  window.addEventListener("mousemove", (e) => {
    const box = mascot.getBoundingClientRect();
    const over =
      e.clientX >= box.left && e.clientX <= box.right &&
      e.clientY >= box.top && e.clientY <= box.bottom;

    if (over && !inside && Date.now() - lastHover > MASCOT.hoverCooldown) {
      lastHover = Date.now();
      play("is-swinging");
    }
    inside = over;
  }, { passive: true });

  // 3. Shake at the bottom of the page.
  let shakenAtBottom = false;

  const checkBottom = () => {
    const distanceToBottom =
      document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);

    if (distanceToBottom <= MASCOT.bottomThreshold && !shakenAtBottom) {
      shakenAtBottom = true;
      play("is-shaking");
    } else if (distanceToBottom > MASCOT.bottomResetGap) {
      shakenAtBottom = false; // scrolled back up — arm it again
    }
  };

  window.addEventListener("scroll", checkBottom, { passive: true });
  window.addEventListener("resize", checkBottom, { passive: true });
}

document.addEventListener("DOMContentLoaded", startMascot);
