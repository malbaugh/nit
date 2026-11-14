import type { LinearIssue, LinearLink } from "./types";

/**
 * The Linear issue a branch is for. A linear.app link in the PR's description says so for sure;
 * an issue key at the start of the branch's last part (Linear's own `you/eng-123-title`) or the
 * title's (`ENG-123: …`) is taken only once Linear confirms it, since `fix/add-2-things` looks
 * the same.
 */
export function linearRef(branch: string, title = "", body = ""): { key: string; url: string | null } | null {
  const link = body.match(/https:\/\/linear\.app\/[\w-]+\/issue\/([A-Za-z][A-Za-z0-9]{0,9}-\d+)[^\s)\]>]*/);
  if (link) return { key: link[1].toUpperCase(), url: link[0] };
  const key =
    branch.match(/(?:^|\/)([a-z][a-z0-9]{0,9}-\d+)(?:-|$)/i)?.[1] ?? title.match(/^\[?([A-Z][A-Z0-9]{0,9}-\d+)\b/)?.[1];
  return key ? { key: key.toUpperCase(), url: null } : null;
}

const SECRET = { service: "nit", name: "linear-api-key" };

export const savedLinearKey = () => Bun.secrets.get(SECRET).catch(() => null);

export async function saveLinearKey(value: string | null) {
  if (value) await Bun.secrets.set({ ...SECRET, value });
  else await Bun.secrets.delete(SECRET);
}

/** One issue by its key, through Linear's API with a personal API key. Null when there's no such issue. */
export async function fetchIssue(key: string, apiKey: string): Promise<LinearIssue | null> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: apiKey },
    body: JSON.stringify({
      query: "query($id: String!) { issue(id: $id) { identifier title description url state { name color } } }",
      variables: { id: key },
    }),
  });
  if (res.status === 401 || res.status === 403) throw new Error("Linear didn't accept the API key.");
  const r = (await res.json()) as { data?: { issue: LinearIssue | null }; errors?: { message: string }[] };
  // An unknown key comes back as an "Entity not found" error, not as null.
  return r.data?.issue ?? null;
}

/** What the page shows about the linked issue, with nit's saved key if there is one. */
export async function linearLink(ref: { key: string; url: string | null } | null): Promise<LinearLink | null> {
  if (!ref) return null;
  const apiKey = await savedLinearKey();
  if (!apiKey) return ref.url ? { ...ref, issue: null, hasKey: false } : null;
  try {
    const issue = await fetchIssue(ref.key, apiKey);
    if (!issue) return ref.url ? { ...ref, issue: null, hasKey: true } : null;
    return { key: issue.identifier, url: issue.url, issue, hasKey: true };
  } catch (e) {
    return { ...ref, issue: null, hasKey: true, error: e instanceof Error ? e.message : String(e) };
  }
}
