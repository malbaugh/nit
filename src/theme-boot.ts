/**
 * Runs inline in the page before first paint: picks the colour scheme and applies the chrome
 * colours saved for the selected theme, so a reload never flashes the default. The UI's theme
 * controller takes over once it loads. Plain ES2020: it isn't bundled.
 */
export const themeBoot = `(() => {
  const t = window.nitTheme;
  const mode = t?.mode ?? "system";
  const scheme = mode === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : mode;
  const root = document.documentElement;
  root.dataset.scheme = scheme;
  const saved = t?.vars?.[scheme];
  const name = scheme === "dark" ? t?.darkThemeName : t?.lightThemeName;
  if (saved && saved.name === name) for (const k in saved.values) root.style.setProperty(k, saved.values[k]);
})();`;
