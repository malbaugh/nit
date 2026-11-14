import { expect, test } from "bun:test";
import { claudeOptions, PrefsPatch } from "./prefs";
import { DEFAULT_PREFS } from "./types";

test("only what isn't Claude Code's default reaches the SDK", () => {
  expect(claudeOptions(DEFAULT_PREFS)).toEqual({});
  expect(claudeOptions({ ...DEFAULT_PREFS, model: "sonnet", effort: "high" })).toEqual({
    model: "sonnet",
    effort: "high",
  });
});

test("the settings screen can't save unknown keys or bad values", () => {
  expect(PrefsPatch.safeParse({ wrap: true, fontSize: 14 }).success).toBe(true);
  expect(PrefsPatch.safeParse({ model: "gpt" }).success).toBe(false);
  expect(PrefsPatch.safeParse({ fontSize: 40 }).success).toBe(false);
  expect(PrefsPatch.safeParse({ checkout: "rm -rf /" }).success).toBe(false);
});
