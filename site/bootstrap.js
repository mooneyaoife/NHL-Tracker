(function applySavedTheme() {
  "use strict";
  try {
    document.documentElement.dataset.theme = localStorage.getItem("nhl-theme") || "light";
  } catch (_) {
    document.documentElement.dataset.theme = "light";
  }
}());
