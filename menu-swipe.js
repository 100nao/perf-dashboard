/* Open and close the dashboard's own phone menu with an edge swipe.
   The drawer is the one created by mOpen / the blue "menu" button.
   iOS Safari keeps the outermost pixels, so the start zone is wide
   and a short flick counts. A non-passive touchmove is attached only
   for a touch that can become this gesture, and preventDefault runs
   only after the swipe is recognized. */
(function () {
  "use strict";
  if (window.__PD_MENU_SWIPE) return;
  window.__PD_MENU_SWIPE = true;

  var EDGE = 60;
  var DIST = 35;
  var FLICK_PX = 20;
  var FLICK_V = 0.3;
  var tracking = null;

  function mobileMenu() {
    if (!window.matchMedia("(max-width:768px)").matches) return false;
    return !!(document.getElementById("mBtn") || document.getElementById("mDrawer"));
  }

  function drawerOpen() {
    return document.body.classList.contains("mopen");
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

  function recognized(dx, dy, elapsed) {
    var adx = Math.abs(dx);
    var ady = Math.abs(dy);
    if (adx <= ady) return false;
    if (adx >= DIST) return true;
    return adx >= FLICK_PX && adx / Math.max(1, elapsed) > FLICK_V;
  }

  function onMove(e) {
    if (!tracking || !e.touches || !e.touches.length) return;
    if (tracking.fired) {
      if (e.cancelable) e.preventDefault();
      return;
    }
    var t = e.touches[0];
    var dx = t.clientX - tracking.x;
    var dy = t.clientY - tracking.y;
    var elapsed = Date.now() - tracking.t;
    if (!recognized(dx, dy, elapsed)) return;
    var open = tracking.open && dx > 0;
    var fromEdge = !tracking.open && dx < 0;
    if (!open && !fromEdge) return;
    if (e.cancelable) e.preventDefault();
    tracking.fired = true;
    if (open) closeMenu();
    else openMenu();
  }

  function stopTracking() {
    document.removeEventListener("touchmove", onMove);
    tracking = null;
  }

  document.addEventListener("touchstart", function (e) {
    stopTracking();
    if (!mobileMenu() || !e.touches || e.touches.length !== 1) return;
    var t = e.touches[0];
    var open = drawerOpen();
    var inEdge = t.clientX >= window.innerWidth - EDGE;
    if (!open && !inEdge) return;
    tracking = { x: t.clientX, y: t.clientY, t: Date.now(), open: open, fired: false };
    document.addEventListener("touchmove", onMove, { passive: false });
  }, { passive: true });

  document.addEventListener("touchend", stopTracking, { passive: true });
  document.addEventListener("touchcancel", stopTracking, { passive: true });
})();
