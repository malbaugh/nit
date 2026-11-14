import { expect, test } from "bun:test";
import { claudeEnv, claudeOptions, PrefsPatch } from "./prefs";
import { DEFAULT_PREFS } from "./types";

test("only what isn't Claude Code's default reaches the SDK", async () => {
  const { env: _, ...rest } = await claudeOptions(DEFAULT_PREFS);
  expect(rest).toEqual({});
  const { env: __, ...set } = await claudeOptions({ ...DEFAULT_PREFS, model: "sonnet", effort: "high" });
  expect(set).toEqual({ model: "sonnet", effort: "high" });
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

test("the settings screen can't save unknown keys or bad values", () => {
  expect(PrefsPatch.safeParse({ wrap: true, fontSize: 14 }).success).toBe(true);
  expect(PrefsPatch.safeParse({ model: "gpt" }).success).toBe(false);
  expect(PrefsPatch.safeParse({ fontSize: 40 }).success).toBe(false);
  expect(PrefsPatch.safeParse({ checkout: "rm -rf /" }).success).toBe(false);
});
