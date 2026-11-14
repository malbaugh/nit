import { expect, test } from "bun:test";
import { ghEnv } from "./github";

test("a repo's .env GitHub token never reaches gh, which would prefer it over your login", () => {
  const saved = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "ghp_from_a_repo_env";
  try {
    const env = ghEnv();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.PATH).toBe(process.env.PATH);
  } finally {
    if (saved === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = saved;
  }
});
