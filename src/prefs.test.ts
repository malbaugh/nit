import { expect, test } from "bun:test";
import { claudeEnv, claudeOptions, PrefsPatch, prefsOf } from "./prefs";
import { DEFAULT_PREFS } from "./types";

test("model and effort reach the SDK only when set; nit's runs never load your connectors or memory", async () => {
  const { env: _, ...rest } = await claudeOptions(DEFAULT_PREFS);
  expect(rest).toEqual({
    strictMcpConfig: true,
    settings: { disableClaudeAiConnectors: true, autoMemoryEnabled: false },
  });
  const set = await claudeOptions({ ...DEFAULT_PREFS, model: "sonnet", effort: "high" });
  expect([set.model, set.effort]).toEqual(["sonnet", "high"]);
  // Questions default to low effort; your effort setting wins over that.
  expect((await claudeOptions(DEFAULT_PREFS, "ask")).effort).toBe("low");
  expect((await claudeOptions({ ...DEFAULT_PREFS, effort: "max" }, "ask")).effort).toBe("max");
});

test("Claude never gets a credential from nit's environment (a repo's .env); it uses its own login", async () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, oauth: process.env.CLAUDE_CODE_OAUTH_TOKEN };
  process.env.ANTHROPIC_API_KEY = "sk-ant-from-a-repo-env";
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "from-a-repo-env";
  try {
    const env = await claudeEnv({ auth: "login" });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.PATH).toBe(process.env.PATH);
  } finally {
    for (const [k, v] of [
      ["ANTHROPIC_API_KEY", saved.key],
      ["CLAUDE_CODE_OAUTH_TOKEN", saved.oauth],
    ] as const)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});

test("the settings screen can't save bad values; unknown keys are dropped, not saved", () => {
  expect(PrefsPatch.safeParse({ wrap: true, fontSize: 14 }).success).toBe(true);
  expect(PrefsPatch.safeParse({ model: "gpt" }).success).toBe(false);
  expect(PrefsPatch.safeParse({ fontSize: 40 }).success).toBe(false);
  expect(PrefsPatch.parse({ wrap: true, checkout: "rm -rf /" })).toEqual({ wrap: true });
});

test("one stale or broken saved field falls back alone; the rest are kept", () => {
  const store = {
    setting: () => ({ wrap: true, model: "sonnet", apiKey: true, fontSize: 99 }),
  } as unknown as Parameters<typeof prefsOf>[0];
  const p = prefsOf(store);
  expect([p.wrap, p.model, p.fontSize]).toEqual([true, "sonnet", DEFAULT_PREFS.fontSize]);
});
