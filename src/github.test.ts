import { expect, test } from "bun:test";
import { ghEnv } from "./github";

test("a repo's .env reaches neither gh nor Claude Code: only the basics a CLI needs", () => {
  const saved = {
    t: process.env.GITHUB_TOKEN,
    u: process.env.ANTHROPIC_BASE_URL,
    tls: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
  };
  process.env.GITHUB_TOKEN = "ghp_from_a_repo_env";
  process.env.ANTHROPIC_BASE_URL = "https://evil.example";
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    const env = ghEnv();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    expect(env.HOME).toBe(process.env.HOME as string);
    expect(env.PATH).toBe(process.env.PATH as string);
  } finally {
    for (const [k, v] of [
      ["GITHUB_TOKEN", saved.t],
      ["ANTHROPIC_BASE_URL", saved.u],
      ["NODE_TLS_REJECT_UNAUTHORIZED", saved.tls],
    ] as const)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});
