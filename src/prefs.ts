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
    auth: z.enum(["login", "apiKey"]),
  } satisfies Record<keyof Prefs, z.ZodType>)
  .partial()
  .strict();

/** Saved preferences over the defaults: a field added later starts at its default. */
export function prefsOf(store: Store): Prefs {
  const saved = PrefsPatch.safeParse(store.setting("prefs") ?? {});
  return { ...DEFAULT_PREFS, ...(saved.success ? saved.data : {}) };
}

// Claude credentials nit never takes from its own environment: Bun loads the reviewed repo's .env
// files, so they may be that repo's, not yours.
const ENV_CREDENTIALS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];
const KEY = { service: "nit", name: "anthropic-api-key" };
let key: Promise<string | null> | undefined;

/** The API key saved in nit, from your OS keychain (read once). */
export const savedKey = () => {
  key ??= Bun.secrets.get(KEY).catch(() => null);
  return key;
};

/** Saves (or, with null, removes) nit's API key in your OS keychain. */
export async function saveKey(value: string | null) {
  if (value) await Bun.secrets.set({ ...KEY, value });
  else await Bun.secrets.delete(KEY);
  key = Promise.resolve(value);
}

/**
 * Claude Code's environment: nit's, without any Claude credential in it, so Claude Code uses its
 * own login; with "API key" chosen, the key saved in nit.
 */
export async function claudeEnv(p: Pick<Prefs, "auth">): Promise<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "nit" };
  for (const k of ENV_CREDENTIALS) delete env[k];
  const saved = p.auth === "apiKey" ? await savedKey() : null;
  if (saved) env.ANTHROPIC_API_KEY = saved;
  return env;
}

/** The SDK options the preferences set: only what isn't Claude Code's default. */
export async function claudeOptions(p: Prefs) {
  return {
    env: await claudeEnv(p),
    ...(p.model !== "default" ? { model: p.model } : {}),
    ...(p.effort !== "default" ? { effort: p.effort } : {}),
  };
}
