import { expect, test } from "bun:test";
import { confineTo, failureOf } from "./agent";
import { SIGN_IN_ERROR } from "./types";

const root = "/repo";
const call = (hook: ReturnType<typeof confineTo>, tool: string, path: string) =>
  hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: tool,
      tool_input: { file_path: path },
      tool_use_id: "t",
      session_id: "s",
      transcript_path: "",
      cwd: root,
    } as Parameters<ReturnType<typeof confineTo>>[0],
    "t",
    { signal: new AbortController().signal },
  ) as Promise<{ hookSpecificOutput?: { permissionDecision?: string } }>;
const decision = async (hook: ReturnType<typeof confineTo>, tool: string, path: string) =>
  (await call(hook, tool, path)).hookSpecificOutput?.permissionDecision ?? "allow";

test("files outside the checkout and in .git are refused", async () => {
  const hook = confineTo(root);
  expect(await decision(hook, "Read", "/repo/src/a.ts")).toBe("allow");
  expect(await decision(hook, "Read", "/etc/passwd")).toBe("deny");
  expect(await decision(hook, "Edit", "../other/x.ts")).toBe("deny");
  expect(await decision(hook, "Read", "/repo/.git/config")).toBe("deny");
});

test("reviewing: the checkout's guideline files are refused (read_guideline gives the base's)", async () => {
  const hook = confineTo(root, { guidelinesFromBase: true });
  for (const p of [
    "/repo/AGENTS.md",
    "/repo/apps/x/CLAUDE.md",
    "/repo/.claude/rules/ramp.md",
    "/repo/.github/copilot-instructions.md",
  ])
    expect(await decision(hook, "Read", p)).toBe("deny");
  expect(await decision(hook, "Read", "/repo/src/agents.ts")).toBe("allow");
  expect(await decision(confineTo(root), "Read", "/repo/AGENTS.md")).toBe("allow"); // Apply may read them
});

test("a symlink inside the checkout that points out of it is refused", async () => {
  const { mkdtempSync, symlinkSync, rmSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "nit-link-"));
  const repo = join(dir, "repo");
  mkdirSync(repo);
  symlinkSync("/etc", join(repo, "etc"));
  try {
    const hook = confineTo(repo);
    expect(await decision(hook, "Read", join(repo, "etc/passwd"))).toBe("deny");
    expect(await decision(hook, "Write", join(repo, "etc/new-file"))).toBe("deny");
    expect(await decision(hook, "Write", join(repo, "src/new.ts"))).toBe("allow");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an API error says what to do; normal messages aren't failures", () => {
  type M = Parameters<typeof failureOf>[0];
  const auth = {
    type: "assistant",
    error: "authentication_failed",
    message: { content: [{ type: "text", text: "Invalid API key · Fix external API key" }] },
  } as unknown as M;
  expect(failureOf(auth)).toBe(SIGN_IN_ERROR);
  const other = { ...auth, error: "server_error" } as unknown as M;
  expect(failureOf(other)).toBe("Invalid API key · Fix external API key");
  expect(failureOf({ type: "result", subtype: "success", is_error: true, result: "boom" } as unknown as M)).toBe(
    "boom",
  );
  expect(failureOf({ type: "result", subtype: "success", is_error: false, result: "ok" } as unknown as M)).toBeNull();
  expect(failureOf({ type: "assistant", message: { content: [] } } as unknown as M)).toBeNull();
});

test("Glob patterns and Grep globs that reach outside the checkout are refused", async () => {
  const hook = confineTo(root);
  const decide = async (tool: string, input: Record<string, unknown>) =>
    (
      (await hook(
        {
          hook_event_name: "PreToolUse",
          tool_name: tool,
          tool_input: input,
          tool_use_id: "t",
          session_id: "s",
          transcript_path: "",
          cwd: root,
        } as Parameters<ReturnType<typeof confineTo>>[0],
        "t",
        { signal: new AbortController().signal },
      )) as { hookSpecificOutput?: { permissionDecision?: string } }
    ).hookSpecificOutput?.permissionDecision ?? "allow";
  expect(await decide("Glob", { pattern: "/etc/*" })).toBe("deny");
  expect(await decide("Glob", { pattern: "../other/**/*.ts" })).toBe("deny");
  expect(await decide("Grep", { pattern: "secret", glob: "/Users/me/.ssh/*" })).toBe("deny");
  expect(await decide("Glob", { pattern: "src/**/*.ts" })).toBe("allow");
  expect(await decide("Glob", { pattern: "/repo/src/*.ts" })).toBe("allow");
  expect(await decide("Grep", { pattern: "/etc/passwd" })).toBe("allow"); // a regex, not a path
});
