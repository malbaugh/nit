import { expect, test } from "bun:test";
import { confineTo } from "./agent";

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
