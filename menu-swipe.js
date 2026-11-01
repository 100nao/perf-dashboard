/* Open and close the dashboard's own phone menu with an edge swipe.
   The drawer is the one created by mOpen / the blue "menu" button.
   Listeners are passive, so vertical scrolling and horizontal card
   carousels keep their normal touch behavior. */
(function () {
  "use strict";
  if (window.__PD_MENU_SWIPE) return;
  window.__PD_MENU_SWIPE = true;

  var EDGE = 30;
  var DIST = 60;
  var tracking = null;

  function mobileMenu() {
    if (!window.matchMedia("(max-width:768px)").matches) return false;
    return !!(document.getElementById("mBtn") || document.getElementById("mDrawer"));
  }

  function drawerOpen() {
    return document.body.classList.contains("mopen");
  }

  function horizontalScroller(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.classList && (el.classList.contains("mcar") || el.classList.contains("mswipe") || el.classList.contains("chartbox"))) return true;
      if (el.tagName === "CANVAS") return true;
      var ox = window.getComputedStyle(el).overflowX;
      if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 4) return true;
      el = el.parentElement;
    }
    return false;
  }

  function openMenu() {
    if (typeof window.mOpen === "function") window.mOpen();
    else {
      var btn = document.getElementById("mBtn");
      if (btn) btn.click();
    }
  }

  function closeMenu() {
    if (typeof window.mClose === "function") window.mClose();
    else {
      var btn = document.getElementById("mX") || document.getElementById("mBack");
      if (btn) btn.click();
    }
  }

  document.addEventListener("touchstart", function (e) {
    tracking = null;
    if (!mobileMenu() || !e.touches || e.touches.length !== 1) return;
    var t = e.touches[0];
    var open = drawerOpen();
    if (!open) {
      if (t.clientX < window.innerWidth - EDGE) return;
      if (horizontalScroller(e.target)) return;
    }
    tracking = { x: t.clientX, y: t.clientY, open: open };
  }, { passive: true });

  document.addEventListener("touchend", function (e) {
    if (!tracking || !e.changedTouches || !e.changedTouches.length) {
      tracking = null;
      return;
    }
    var t = e.changedTouches[0];
    var dx = t.clientX - tracking.x;
    var dy = t.clientY - tracking.y;
    var open = tracking.open;
    tracking = null;
    if (Math.abs(dx) < DIST || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
    if (!open && dx <= -DIST) openMenu();
    else if (open && dx >= DIST) closeMenu();
  }, { passive: true });

  document.addEventListener("touchcancel", function () {
    tracking = null;
  }, { passive: true });
})();
