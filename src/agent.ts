import { isAbsolute, relative, resolve } from "node:path";
import { type HookCallback, query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Snapshots } from "./snapshot";
import type { Store } from "./store";
import type { AgentEvent, AgentOutcome, AgentRun, Draft } from "./types";

/**
 * Applies review comments with the Claude Agent SDK, on the Claude Code login already on this
 * machine. The agent reads and edits files in the checkout and nothing else: no shell, no
 * settings files (a repo's hooks are shell commands), and a hook that refuses any path
 * outside the checkout. Snapshots before and after give its exact changes and undo.
 */

const TOOLS = ["Read", "Edit", "Write", "Glob", "Grep"];

const INSTRUCTIONS = `You are applying code review comments inside a review tool. The reviewer wrote each
comment on lines of a file in this checkout.

For each comment:
- Make the smallest change that addresses it, in the codebase's own style. Read the repo's
  CLAUDE.md, AGENTS.md or contributing notes first if they exist.
- A comment with a <suggestion> gives the exact replacement for its lines: apply that text.
- A question, or a comment you can't act on safely, gets no code change: answer it in the note.
- Change nothing the comments don't ask for. You can't run commands, and you don't commit.

Finish with one outcome per comment: its id, "done", "skipped" or "question", and a one-sentence
note saying what you changed or why not.`;

const OUTCOMES = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      outcomes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string", enum: ["done", "skipped", "question"] },
            note: { type: "string" },
          },
          required: ["id", "status", "note"],
          additionalProperties: false,
        },
      },
    },
    required: ["outcomes"],
    additionalProperties: false,
  },
};

const xml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

/** The drafts as the agent reads them: where, what the lines were, the comment, any suggestion. */
export function promptFor(drafts: Draft[]) {
  const items = drafts.map((d) => {
    const where = d.start === 0 ? "the whole file" : d.start === d.end ? `line ${d.end}` : `lines ${d.start}-${d.end}`;
    const side = d.side === "deletions" ? " (removed in this change)" : "";
    const lines = d.anchor.length ? `\n<lines>\n${xml(d.anchor.join("\n"))}\n</lines>` : "";
    const suggestion = d.suggestion !== null ? `\n<suggestion>\n${xml(d.suggestion)}\n</suggestion>` : "";
    return `<comment id="${d.id}" file="${xml(d.path)}" at="${where}${side}">${lines}\n${xml(d.body.trim())}${suggestion}\n</comment>`;
  });
  return `Apply these ${drafts.length} review comments.\n\n${items.join("\n\n")}`;
}

/**
 * A PreToolUse hook for every file tool, whatever settings say: nothing outside the checkout,
 * nothing in its .git. Shared by Apply and Ask.
 */
export function confineTo(root: string): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const args = (input.tool_input ?? {}) as Record<string, unknown>;
    for (const key of ["file_path", "path", "notebook_path"]) {
      const p = args[key];
      if (typeof p !== "string" || !p) continue;
      const rel = relative(root, resolve(root, p));
      if (rel.startsWith("..") || isAbsolute(rel) || rel === ".git" || rel.startsWith(".git/"))
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `nit only allows files inside the review checkout (${root}), not ${p}.`,
          },
        };
    }
    return {};
  };
}

/** What a tool call is about, for progress: the file it touches or what it looks for. */
export function targetOf(root: string, input: Record<string, unknown>) {
  const p = (input.file_path ?? input.path ?? input.pattern ?? "") as string;
  return isAbsolute(p) ? relative(root, p) || "." : p;
}

export function createAgent(root: string, snapshots: Snapshots, store: Store) {
  let current: { run: AgentRun; abort: AbortController; events: AgentEvent[] } | null = null;
  const listeners = new Set<(e: AgentEvent) => void>();
  const emit = (e: AgentEvent) => {
    current?.events.push(e);
    for (const l of listeners) l(e);
  };
  const save = (run: AgentRun) => {
    store.setAgentRun(run);
    emit({ type: "run", run });
  };

  const confine = confineTo(root);

  return {
    /** The run in progress, else the last one for this review. */
    state: (): AgentRun | null => current?.run ?? store.agentRun(),
    /** Events of the run in progress so far, for a page that connects midway. */
    replay: (): AgentEvent[] => current?.events ?? [],
    subscribe(l: (e: AgentEvent) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    stop() {
      current?.abort.abort();
    },

    /** Starts a pass over `drafts`. One at a time; resolves when it has started. */
    async start(drafts: Draft[]): Promise<AgentRun> {
      if (current) throw new Error("The agent is already running.");
      const previous = store.agentRun();
      const run: AgentRun = {
        id: crypto.randomUUID(),
        drafts: drafts.map((d) => d.id),
        startedAt: Date.now(),
        endedAt: null,
        state: "running",
        before: await snapshots.take(),
        after: null,
        files: [],
        outcomes: [],
        error: null,
        costUsd: null,
        // A follow-up pass continues the same conversation, unless the last one was undone.
        sessionId: previous && previous.state !== "undone" ? previous.sessionId : null,
      };
      const abort = new AbortController();
      current = { run, abort, events: [] };
      save(run);
      void this.work(run, drafts, abort);
      return run;
    },

    async work(run: AgentRun, drafts: Draft[], abort: AbortController) {
      try {
        const messages = query({
          prompt: promptFor(drafts),
          options: {
            cwd: root,
            tools: TOOLS,
            allowedTools: TOOLS,
            canUseTool: async (tool) => ({ behavior: "deny", message: `${tool} isn't available in nit.` }),
            settingSources: [],
            systemPrompt: { type: "preset", preset: "claude_code", append: INSTRUCTIONS },
            hooks: { PreToolUse: [{ hooks: [confine] }] },
            outputFormat: OUTCOMES,
            abortController: abort,
            ...(run.sessionId ? { resume: run.sessionId } : {}),
          },
        });
        for await (const m of messages as AsyncIterable<SDKMessage>) this.read(run, m);
        run.state = abort.signal.aborted ? "stopped" : run.error ? "failed" : "done";
      } catch (e) {
        run.state = abort.signal.aborted ? "stopped" : "failed";
        if (!abort.signal.aborted) run.error = e instanceof Error ? e.message : String(e);
      } finally {
        run.after = await snapshots.take().catch(() => null);
        run.files = run.after ? await snapshots.changed(run.before, run.after).catch(() => []) : [];
        run.endedAt = Date.now();
        current = null;
        save(run);
      }
    },

    /** Turns one SDK message into progress events and the run's results. */
    read(run: AgentRun, m: SDKMessage) {
      if ("session_id" in m && m.session_id && run.sessionId !== m.session_id) run.sessionId = m.session_id;
      if (m.type === "assistant") {
        for (const block of m.message.content) {
          if (block.type === "text" && block.text.trim()) emit({ type: "text", text: block.text.trim() });
          // StructuredOutput is how the SDK returns the outcomes, not work on the code.
          if (block.type === "tool_use" && block.name !== "StructuredOutput")
            emit({ type: "tool", tool: block.name, target: targetOf(root, block.input as Record<string, unknown>) });
        }
      } else if (m.type === "result") {
        // On a Claude subscription nothing is billed per token: the SDK's estimate would only
        // alarm. With an API key it's real money, so it's shown.
        run.costUsd = process.env.ANTHROPIC_API_KEY ? m.total_cost_usd : null;
        if (m.subtype === "success") {
          const out = (m.structured_output as { outcomes?: AgentOutcome[] } | undefined)?.outcomes ?? [];
          run.outcomes = out.filter((o) => run.drafts.includes(o.id));
        } else run.error = m.errors.join("; ") || m.subtype;
      }
    },

    /** Puts back what the last pass changed, except files edited since. */
    async undo() {
      const run = store.agentRun();
      if (!run?.after || current) throw new Error("There's no finished agent pass to undo.");
      if (run.state === "undone") throw new Error("That pass is already undone.");
      const result = await snapshots.undo(run.before, run.after);
      run.state = "undone";
      save(run);
      return result;
    },

    /** The last pass's changes as a patch, for the "agent's changes" view. */
    async changes() {
      const run = store.agentRun();
      return run?.after ? snapshots.diff(run.before, run.after) : "";
    },
  };
}

export type Agent = ReturnType<typeof createAgent>;
