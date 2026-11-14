import type { Draft, FileContents, Location, ReviewData, Side, Symbol as Sym } from "../types";

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: method === "GET" ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

const q = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );

export type At = { path: string; side: Side; line: number };

export const api = {
  review: () => call<ReviewData>("GET", "/api/review"),
  file: (path: string, prev?: string) =>
    call<FileContents>("GET", `/api/file?${new URLSearchParams({ path, prev: prev ?? "" })}`),
  saveDraft: (d: Draft) => call<Draft>("PUT", "/api/drafts", d),
  deleteDraft: (id: string) => call("DELETE", `/api/drafts/${id}`, {}),
  applySuggestion: (id: string) => call("POST", `/api/drafts/${id}/apply`, {}),
  setViewed: (path: string, viewed: boolean) => call("POST", "/api/viewed", { path, viewed }),

  symbols: (path: string, prev?: string) =>
    call<{ new: Sym[] | null; old: Sym[] | null }>("GET", `/api/symbols?${q({ path, prev })}`),
  identifiers: (at: At) => call<{ name: string; col: number }[]>("GET", `/api/identifiers?${q(at)}`),
  definition: (at: At, by: { name: string } | { col: number }) =>
    call<{ name: string | null; results: Location[] }>("GET", `/api/definition?${q({ ...at, ...by })}`),
  references: (name: string) =>
    call<{ name: string; changed: Location[]; untouched: Location[]; text: Location[]; truncated: boolean }>(
      "GET",
      `/api/references?${q({ name })}`,
    ),
};
