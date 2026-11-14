import { z } from "zod";
import type { Store } from "./store";
import { DEFAULT_PREFS, type Prefs } from "./types";

/** What the settings screen may save; anything else is refused. */
export const PrefsPatch = z
  .object({
    fontSize: z.number().min(10).max(18),
    wrap: z.boolean(),
    indicators: z.enum(["bars", "classic", "none"]),
    inlineChanges: z.enum(["word", "char", "none"]),
    model: z.enum(["default", "opus", "sonnet", "haiku"]),
    effort: z.enum(["default", "low", "medium", "high", "xhigh", "max"]),
    nits: z.boolean(),
  } satisfies Record<keyof Prefs, z.ZodType>)
  .partial()
  .strict();

/** Saved preferences over the defaults: a field added later starts at its default. */
export function prefsOf(store: Store): Prefs {
  const saved = PrefsPatch.safeParse(store.setting("prefs") ?? {});
  return { ...DEFAULT_PREFS, ...(saved.success ? saved.data : {}) };
}

/** The SDK options the preferences set: only what isn't Claude Code's default. */
export function claudeOptions(p: Prefs) {
  return {
    ...(p.model !== "default" ? { model: p.model } : {}),
    ...(p.effort !== "default" ? { effort: p.effort } : {}),
  };
}
