// Applies a saved light or dark choice before first paint; without one the page follows the system.
try {
  const theme = localStorage.getItem("theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {
  // Storage can be unavailable in private windows; the system preference still applies.
}
