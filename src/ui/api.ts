import type { Draft, FileContents, ReviewData } from "../types";

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

export const api = {
  review: () => call<ReviewData>("GET", "/api/review"),
  file: (path: string, prev?: string) =>
    call<FileContents>("GET", `/api/file?${new URLSearchParams({ path, prev: prev ?? "" })}`),
  saveDraft: (d: Draft) => call<Draft>("PUT", "/api/drafts", d),
  deleteDraft: (id: string) => call("DELETE", `/api/drafts/${id}`, {}),
  applySuggestion: (id: string) => call("POST", `/api/drafts/${id}/apply`, {}),
  setViewed: (path: string, viewed: boolean) => call("POST", "/api/viewed", { path, viewed }),
};
