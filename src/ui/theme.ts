import {
  type ColorScheme,
  createThemeCatalog,
  createThemeController,
  type ThemeLike,
  type ThemeSelection,
} from "@pierre/theming";
import { colorUtils, normalizeThemeColors } from "@pierre/theming/color";
import { useThemeController } from "@pierre/theming/react";
import { themes } from "@pierre/theming/themes";
import { api } from "./api";

/**
 * Themes come from Pierre's theming kit: every Pierre and Shiki theme (Night Owl, GitHub, …),
 * a light and a dark pick, and a mode. The code takes the theme's syntax colours; the app's
 * surfaces are derived from its editor colours. Pierre Dark and Light keep nit's own tuned
 * tokens. The choice is saved in nit's database, not the browser, because each repo gets
 * its own port (and so its own browser storage).
 */

type Vars = { name: string; values: Record<string, string> } | null;
type Saved = ThemeSelection & { vars?: Partial<Record<ColorScheme, Vars>> };

const saved = (window as { nitTheme?: Saved | null }).nitTheme ?? null;
const NATIVE = new Set(["pierre-dark", "pierre-light"]);

export const catalog = createThemeCatalog({
  themes,
  defaultLightThemeName: "pierre-light",
  defaultDarkThemeName: "pierre-dark",
});

const vars: Partial<Record<ColorScheme, Vars>> = { ...saved?.vars };

function persist(s: ThemeSelection) {
  const { mode, lightThemeName, darkThemeName } = s;
  api.saveTheme({ mode, lightThemeName, darkThemeName, vars }).catch(() => {});
}

export const theme = createThemeController({
  catalog,
  defaultMode: "system",
  preloadInactive: true, // switching light/dark is instant
  persistence: {
    load: () =>
      saved ? { mode: saved.mode, lightThemeName: saved.lightThemeName, darkThemeName: saved.darkThemeName } : null,
    save: persist,
  },
});

export const useTheme = () => useThemeController(theme);
export const nameFor = (s: ThemeSelection, scheme: ColorScheme) =>
  scheme === "dark" ? s.darkThemeName : s.lightThemeName;

/** nit's surface and text tokens from a theme's editor colours (the approach diffshub uses). */
export function chromeVars(t: ThemeLike): Record<string, string> {
  const c = normalizeThemeColors(t).colors ?? {};
  const raw = t.colors ?? {};
  const bg = c["editor.background"] ?? t.bg ?? "#000";
  const side = c["sideBar.background"] ?? bg;
  const fg =
    colorUtils.pickReadableForeground(side, [raw["sideBar.foreground"], raw["editor.foreground"], t.fg]) ?? "#888";
  const mix = (pct: number, base = bg) => `color-mix(in oklch, ${fg} ${pct}%, ${base})`;
  const tint = (color: string, pct: number) => `color-mix(in oklch, ${color} ${pct}%, transparent)`;
  const out: Record<string, string> = {
    "--page": bg,
    "--canvas": colorUtils.surfacesMatch(side, bg) ? mix(3) : side,
    "--surface": mix(6),
    "--inset": mix(4),
    "--field": mix(7),
    "--hover": mix(8),
    "--hover-2": mix(13),
    "--ink": fg,
    "--ink-2": mix(70),
    "--ink-3": colorUtils.deriveMutedFg(fg, bg),
    "--line": mix(13),
    "--line-strong": mix(20),
    "--line-soft": mix(8),
  };
  // Focus borders are often too dark to read (Night Owl's is navy); take the theme's first
  // accent-like colour that is legible on the editor background.
  const accent = colorUtils.pickReadableForeground(bg, [
    c["list.focusOutline"],
    c.focusBorder,
    c["textLink.foreground"],
    c["button.background"],
    c["terminal.ansiBlue"],
  ]);
  if (accent) Object.assign(out, { "--accent": accent, "--accent-ink": accent, "--accent-tint": tint(accent, 18) });
  for (const [name, key] of [
    ["green", "added"],
    ["red", "deleted"],
    ["orange", "modified"],
  ] as const) {
    const color = c[`gitDecoration.${key}ResourceForeground`];
    if (color) Object.assign(out, { [`--${name}`]: color, [`--${name}-tint`]: tint(color, 15) });
  }
  return out;
}

let applied: string[] = [];

function apply() {
  const s = theme.getState();
  const root = document.documentElement;
  root.dataset.scheme = s.resolvedColorScheme;
  root.style.colorScheme = s.resolvedColorScheme;

  // Remember the derived colours of both picks so the next load paints them before any JS.
  let changed = false;
  for (const scheme of ["light", "dark"] as const) {
    const name = nameFor(s, scheme);
    const resolved = theme.resolver.getResolvedTheme(name);
    if (!NATIVE.has(name) && !resolved) continue; // still loading: keep what's showing
    const next: Vars = NATIVE.has(name) || !resolved ? null : { name, values: chromeVars(resolved) };
    if (JSON.stringify(next) !== JSON.stringify(vars[scheme] ?? null)) {
      vars[scheme] = next;
      changed = true;
    }
  }

  const active = vars[s.resolvedColorScheme];
  const values = active && active.name === nameFor(s, s.resolvedColorScheme) ? active.values : null;
  // The boot script may have set properties too; clear every token this file can set.
  for (const k of new Set([
    ...applied,
    ...Object.keys(values ?? {}),
    ...Object.keys(saved?.vars?.dark?.values ?? {}),
    ...Object.keys(saved?.vars?.light?.values ?? {}),
  ]))
    root.style.removeProperty(k);
  applied = [];
  for (const [k, v] of Object.entries(values ?? {})) {
    root.style.setProperty(k, v);
    applied.push(k);
  }
  if (changed) persist(s);
}

apply();
theme.subscribe(apply);
