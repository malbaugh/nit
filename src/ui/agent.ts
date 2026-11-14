import type { AgentEvent, AgentRun } from "../types";
import { api } from "./api";
import * as st from "./state";

/**
 * The page's side of an agent pass: start, follow its live stream, and when it ends, reload the
 * review (the files changed) and say what it did.
 */

const MAX_ACTIVITY = 300;

function onRun(run: AgentRun) {
  const prev = st.get().agent;
  const fresh = prev?.id !== run.id;
  st.set((s) => ({ agent: run, agentActivity: fresh ? [] : s.agentActivity }));
  if (prev?.id === run.id && prev.state === "running" && run.state !== "running") void finished(run);
}

async function finished(run: AgentRun) {
  await st.load(); // the agent's edits are in the review's diff now
  if (run.state === "failed") return st.toast(`Claude couldn't finish: ${run.error ?? "unknown error"}`);
  if (run.state === "stopped") return st.toast("Stopped. What Claude changed so far is kept; undo puts it back.");
  const done = run.outcomes.filter((o) => o.status === "done").length;
  const files = run.files.length;
  st.notify(
    `Claude applied ${done} of ${run.drafts.length} comments · ${files} ${files === 1 ? "file" : "files"} changed`,
    files ? { label: "Show changes", run: showChanges } : undefined,
  );
}

/** Follows the server's agent stream for the life of the page; reconnects on its own. */
export function connect() {
  void api.agent().then(
    ({ run }) => st.set({ agent: run }),
    () => {},
  );
  const source = new EventSource("/api/agent/events");
  source.onmessage = (m) => {
    const e = JSON.parse(m.data) as AgentEvent;
    if (e.type === "run") return onRun(e.run);
    const item =
      e.type === "tool"
        ? { kind: "tool" as const, tool: e.tool, target: e.target }
        : { kind: "text" as const, text: e.text };
    st.set((s) => ({ agentActivity: [...s.agentActivity, item].slice(-MAX_ACTIVITY) }));
  };
  return () => source.close();
}

/** Hands the drafts (all, or some) to Claude. */
export async function apply(ids?: string[]) {
  try {
    const { run } = await api.applyAgent(ids);
    st.set({ agent: run, agentActivity: [], agentOpen: true, reviewOpen: false });
  } catch (e) {
    st.toast(e instanceof Error ? e.message : "Couldn't start Claude.");
  }
}

export function stop() {
  void api.stopAgent().catch(() => {});
}

/** Puts back what the last pass changed; files you edited since are kept and named. */
export async function undo() {
  try {
    const r = await api.undoAgent();
    st.set({ view: "review" });
    await st.load();
    st.toast(
      r.kept.length
        ? `Undid ${r.restored.length} files; kept ${r.kept.join(", ")} (edited since)`
        : `Undid Claude's changes to ${r.restored.length} ${r.restored.length === 1 ? "file" : "files"}`,
    );
  } catch (e) {
    st.toast(e instanceof Error ? e.message : "Couldn't undo.");
  }
}

export function showChanges() {
  st.set({ view: "agent", agentOpen: false, browse: null, peek: null });
}
