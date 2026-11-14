#!/usr/bin/env bun
import { join } from "node:path";
import { type createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { $ } from "bun";
import { z } from "zod";
import { createAgent } from "./agent";
import { buildUI, isStale, uiDirFor } from "./build";
import { checkoutPr, parsePrArg } from "./checkout";
import {
  ASK_INSTRUCTIONS,
  askPrompt,
  FINDINGS_SCHEMA,
  type Finding,
  fileDiff,
  proposals,
  REVIEW_INSTRUCTIONS,
  reviewPrompt,
} from "./coreview";
import * as git from "./git";
import { createGitHub } from "./github";
import { changedPaths, type Guidelines, guidelinesBlock, guidelineText, loadGuidelines } from "./guidelines";
import { createNavigator } from "./navigate";
import { createSnapshots } from "./snapshot";
import { openStore } from "./store";
import * as term from "./term";
import { themeBoot } from "./theme-boot";
import type { Draft, FileContents, ReviewData, ReviewEvent, Side } from "./types";

const dev = process.env.NIT_DEV === "1";
const uiDir = uiDirFor(dev);

const fail0 = term.fail;

const here = (await git.repoRoot()) || fail0("not inside a git repository");
// `nit 2227`, `nit #2227` or `nit <pr-url>` reviews a pull request in its own worktree.
const arg = process.argv[2];
const prRef = parsePrArg(arg);
const opened = prRef
  ? await checkoutPr(here, prRef).catch((e: unknown) => fail0(e instanceof Error ? e.message : String(e)))
  : null;
const root = opened?.path ?? here;
const base = opened?.base ?? arg ?? (await git.defaultBase(root));
const forcedPr = opened?.number ?? (Number(process.env.NIT_PR) || null);
const mergeBase = await git.mergeBase(root, base);
if (!mergeBase)
  fail0(`no common history with ${base}. Fetch it first (git fetch origin), or pass the branch to compare against.`);
const branch = await git.currentBranch(root);
const project = await git.projectId(root);
const store = openStore(`${project}:${branch}`);
// A stable port per repo keeps the tab's address (and its local backups) across restarts.
// The diff is read by the page and by navigation; reuse one read for a couple of seconds.
let patchCache: { at: number; text: Promise<string> } | null = null;
function patch() {
  if (!patchCache || Date.now() - patchCache.at > 2000)
    patchCache = { at: Date.now(), text: git.diff(root, mergeBase) };
  return patchCache.text;
}
const nav = await createNavigator(root, mergeBase, patch);
const github = createGitHub(root, branch, forcedPr);
const agent = createAgent(root, createSnapshots(root, project), store);

/** nit's own tools for Claude: guidelines from the base branch, and one file's diff. */
function claudeTools(
  guidelines: Guidelines,
  text: string,
): NonNullable<Parameters<typeof createSdkMcpServer>[0]["tools"]> {
  const reply = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
  return [
    tool(
      "read_guideline",
      "Read one of the project's guidelines in full, as it is on the base branch (from the <guidelines> list).",
      { path: z.string().describe("The guideline's path, as listed") },
      async ({ path }) => {
        const g = guidelineText(guidelines, path);
        return reply(g ? g.text : `No guideline at ${path} applies to this change.`);
      },
    ),
    tool(
      "file_diff",
      "The diff of one file in this pull request.",
      { path: z.string().describe("The file's path in the repo") },
      async ({ path }) => reply(fileDiff(text, path).slice(0, 60_000) || `${path} isn't changed by this pull request.`),
    ),
  ];
}
github.warm(); // sign in, find the PR and load its threads while the page loads

const preferredPort = Number(process.env.NIT_PORT ?? 40000 + (Number.parseInt(project.slice(0, 4), 16) % 10000));

if (dev || isStale(uiDir)) await buildUI(uiDir);

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (status: number, error: string) => json({ error }, status);

let port = 0;

// Only this tab may call the API: blocks DNS rebinding (Host) and cross-site requests (Origin).
function guard(req: Request) {
  const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
  const host = req.headers.get("host") ?? "";
  const origin = req.headers.get("origin");
  if (!allowed.includes(host)) return fail(403, "bad host");
  if (origin && !allowed.some((a) => origin === `http://${a}`)) return fail(403, "bad origin");
  if (req.method !== "GET" && !req.headers.get("content-type")?.startsWith("application/json"))
    return fail(415, "expected JSON");
  return null;
}

type Handler<R extends Request> = (req: R) => Response | Promise<Response>;
const guarded =
  <R extends Request>(h: Handler<R>): Handler<R> =>
  (req) =>
    guard(req) ?? h(req);

function validPath(path: string) {
  try {
    git.safePath(root, path);
    return true;
  } catch {
    return false;
  }
}

const validName = (name: string) => /^[\p{L}\p{N}_$]{1,200}$/u.test(name);

function position(q: URLSearchParams): { path: string; side: Side; line: number } | null {
  const path = q.get("path") ?? "";
  const side = q.get("side");
  const line = Number(q.get("line"));
  if (!validPath(path) || (side !== "additions" && side !== "deletions") || !Number.isInteger(line) || line < 1)
    return null;
  return { path, side, line };
}

function parseDraft(v: unknown): Draft | null {
  const d = v as Partial<Draft>;
  const ok =
    typeof d?.id === "string" &&
    /^[\w-]{6,64}$/.test(d.id) &&
    typeof d.path === "string" &&
    validPath(d.path) &&
    (d.side === "additions" || d.side === "deletions") &&
    Number.isInteger(d.start) &&
    Number.isInteger(d.end) &&
    d.start! >= 0 &&
    d.end! >= d.start! &&
    typeof d.body === "string" &&
    (d.suggestion === null || typeof d.suggestion === "string") &&
    Array.isArray(d.anchor) &&
    d.anchor.every((l) => typeof l === "string") &&
    (d.replyTo == null || (typeof d.replyTo === "string" && /^[\w=-]{1,200}$/.test(d.replyTo)));
  if (!ok) return null;
  // The page may only keep or clear a proposal it was given (accepting clears it), never make one:
  // proposals come from the co-reviewer, which checks them first.
  const stored = store.draft(d.id!);
  const proposal = d.proposal && stored?.proposal ? stored.proposal : null;
  const now = Date.now();
  return {
    ...(d as Draft),
    proposal,
    createdAt: Number(d.createdAt) || now,
    updatedAt: now,
  };
}

async function applySuggestion(d: Draft) {
  if (d.side !== "additions" || d.suggestion === null) return fail(400, "not a suggestion");
  const text = await git.readWorking(root, d.path);
  if (text === null) return fail(409, "The file no longer exists.");
  const lines = text.split("\n");
  const current = lines.slice(d.start - 1, d.end);
  if (current.join("\n") !== d.anchor.join("\n"))
    return fail(409, "These lines changed since the suggestion was written.");
  lines.splice(d.start - 1, d.end - d.start + 1, ...d.suggestion.split("\n"));
  await Bun.write(git.safePath(root, d.path), lines.join("\n"));
  store.deleteDraft(d.id);
  return json({ ok: true });
}

const serve = (p: number) =>
  Bun.serve({
    hostname: "127.0.0.1",
    port: p,
    development: false,
    // The agent's event stream stays open; it sends a heartbeat well inside this.
    idleTimeout: 60,
    // Never send stack traces to the page; log them where the user started nit.
    error(e) {
      term.error(e);
      return fail(500, "Something went wrong in nit. Details are in the terminal where it's running.");
    },
    routes: {
      "/api/review": {
        GET: guarded(async () => {
          const data: ReviewData = {
            repo: root,
            branch,
            base,
            mergeBase,
            patch: await patch(),
            drafts: store.drafts(),
            viewed: store.viewed(),
          };
          return json(data);
        }),
      },
      "/api/file": {
        GET: guarded(async (req) => {
          const url = new URL(req.url);
          const path = url.searchParams.get("path") ?? "";
          const prev = url.searchParams.get("prev") || path;
          try {
            const data: FileContents = {
              old: await git.readAtRef(root, mergeBase, prev),
              new: await git.readWorking(root, path),
            };
            return json(data);
          } catch (e) {
            return fail(400, String(e));
          }
        }),
      },
      "/api/drafts": {
        PUT: guarded(async (req) => {
          const d = parseDraft(await req.json().catch(() => null));
          if (!d) return fail(400, "invalid draft");
          store.saveDraft(d);
          return json(d);
        }),
      },
      "/api/drafts/:id": {
        DELETE: guarded((req) => {
          store.deleteDraft(req.params.id);
          return json({ ok: true });
        }),
      },
      "/api/drafts/:id/apply": {
        POST: guarded(async (req) => {
          const d = store.draft(req.params.id);
          return d ? applySuggestion(d) : fail(404, "draft not found");
        }),
      },
      "/api/symbols": {
        GET: guarded(async (req) => {
          const q = new URL(req.url).searchParams;
          const path = q.get("path") ?? "";
          if (!validPath(path)) return fail(400, "invalid path");
          const prev = q.get("prev");
          return json(await nav.symbols(path, prev && validPath(prev) ? prev : null));
        }),
      },
      "/api/identifiers": {
        GET: guarded(async (req) => {
          const q = new URL(req.url).searchParams;
          const at = position(q);
          if (!at) return fail(400, "invalid position");
          return json(await nav.identifiers(at.path, at.side, at.line));
        }),
      },
      "/api/definition": {
        GET: guarded(async (req) => {
          const q = new URL(req.url).searchParams;
          const at = position(q);
          if (!at) return fail(400, "invalid position");
          // A name, or a column to read the identifier from (⌘-click on a token).
          const col = Number(q.get("col"));
          const name =
            q.get("name") ??
            (Number.isInteger(col) && col >= 0 ? await nav.identifierAt(at.path, at.side, at.line, col) : null);
          if (!name || !validName(name)) return json({ name: null, results: [] });
          return json({ name, results: await nav.definition(name, at) });
        }),
      },
      "/api/references": {
        GET: guarded(async (req) => {
          const name = new URL(req.url).searchParams.get("name") ?? "";
          if (!validName(name)) return fail(400, "invalid name");
          return json({ name, ...(await nav.references(name)) });
        }),
      },
      "/api/search": {
        GET: guarded(async (req) => {
          const p = new URL(req.url).searchParams;
          const q = p.get("q") ?? "";
          if (!q.trim() || q.length > 500) return json({ matches: [], truncated: false, next: null });
          const after = p.get("after") ?? undefined;
          if (after && after.length > 200) return fail(400, "invalid cursor");
          return json(nav.search(q, { regex: p.get("regex") === "1", caseSensitive: p.get("case") === "1", after }));
        }),
      },
      "/api/github": {
        GET: guarded(async (req) => json(await github.state(new URL(req.url).searchParams.has("fresh")))),
      },
      "/api/github/review": {
        POST: guarded(async (req) => {
          const body = (await req.json().catch(() => null)) as {
            event?: unknown;
            summary?: unknown;
            ids?: unknown;
          } | null;
          const events: ReviewEvent[] = ["COMMENT", "APPROVE", "REQUEST_CHANGES"];
          if (!body || !events.includes(body.event as ReviewEvent)) return fail(400, "invalid review");
          const ids = Array.isArray(body.ids)
            ? new Set(body.ids.filter((i): i is string => typeof i === "string"))
            : null;
          const drafts = store
            .drafts()
            // Claude's proposals stay local until the reviewer accepts them.
            .filter((d) => !d.proposal && (d.body.trim() || d.suggestion !== null) && (!ids || ids.has(d.id)));
          try {
            const result = await github.postReview(drafts, body.event as ReviewEvent, String(body.summary ?? ""));
            for (const id of result.posted) store.deleteDraft(id);
            return json(result);
          } catch (e) {
            return fail(502, e instanceof Error ? e.message : String(e));
          }
        }),
      },
      "/api/github/threads/:id/resolve": {
        POST: guarded(async (req) => {
          const body = (await req.json().catch(() => null)) as { resolved?: unknown } | null;
          if (typeof body?.resolved !== "boolean" || !/^[\w=-]{1,200}$/.test(req.params.id))
            return fail(400, "invalid request");
          try {
            await github.setResolved(req.params.id, body.resolved);
            return json({ ok: true });
          } catch (e) {
            return fail(502, e instanceof Error ? e.message : String(e));
          }
        }),
      },
      "/api/agent": {
        GET: guarded(async () => json({ run: agent.state() })),
      },
      "/api/agent/apply": {
        POST: guarded(async (req) => {
          const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
          const ids = Array.isArray(body.ids) ? new Set(body.ids.filter((x) => typeof x === "string")) : null;
          // Replies to GitHub threads are conversation, not code.
          const drafts = store
            .drafts()
            .filter(
              (d) => !d.replyTo && !d.proposal && (d.body.trim() || d.suggestion !== null) && (!ids || ids.has(d.id)),
            );
          if (!drafts.length) return fail(400, "no comments to apply");
          try {
            // The project's rules for the files being changed, from the base branch.
            const guidelines = await loadGuidelines(root, base, [...new Set(drafts.map((d) => d.path))]);
            const text = await patch();
            return json({
              run: await agent.start(drafts, {
                guidelines: guidelinesBlock(guidelines),
                tools: claudeTools(guidelines, text),
              }),
            });
          } catch (e) {
            return fail(409, e instanceof Error ? e.message : String(e));
          }
        }),
      },
      "/api/agent/job": {
        GET: guarded(async () => json({ job: agent.job() })),
      },
      "/api/coreview": {
        // Claude reviews the whole diff; what survives nit's checks becomes proposed drafts.
        POST: guarded(async () => {
          const text = await patch();
          if (!text.trim()) return fail(400, "nothing to review");
          const changed = changedPaths(text);
          const guidelines = await loadGuidelines(root, base, changed);
          const gh = await github.state();
          try {
            const job = await agent.runJob("review", {
              prompt: reviewPrompt({
                patch: text,
                title: gh.status === "ready" ? gh.pr.title : null,
                guidelines,
                maxInline: 120_000,
              }),
              instructions: REVIEW_INSTRUCTIONS,
              guidelines,
              tools: claudeTools(guidelines, text),
              outputFormat: FINDINGS_SCHEMA,
              finish: async (out, j) => {
                const result = out as { findings?: Finding[]; summary?: string } | undefined;
                const { drafts, dropped } = await proposals(result?.findings ?? [], {
                  patch: text,
                  guidelines,
                  existing: store.drafts(),
                  files: (await $`git ls-files`.cwd(root).quiet().text()).split("\n"),
                  text: (side, path) =>
                    side === "additions" ? git.readWorking(root, path) : git.readAtRef(root, mergeBase, path),
                });
                for (const d of drafts) store.saveDraft(d);
                j.found = drafts.length;
                j.dropped = dropped;
                j.summary = result?.summary?.trim() || null;
              },
            });
            return json({ job });
          } catch (e) {
            return fail(409, e instanceof Error ? e.message : String(e));
          }
        }),
      },
      "/api/ask": {
        // A question about lines, answered in place; `followUp` continues the last answer's session.
        POST: guarded(async (req) => {
          const b = (await req.json().catch(() => null)) as {
            path?: unknown;
            side?: unknown;
            start?: unknown;
            end?: unknown;
            question?: unknown;
            followUp?: unknown;
          } | null;
          const side = b?.side === "deletions" ? "deletions" : "additions";
          const start = Number(b?.start);
          const end = Number(b?.end);
          if (
            typeof b?.path !== "string" ||
            !validPath(b.path) ||
            !Number.isInteger(start) ||
            !Number.isInteger(end) ||
            start < 1 ||
            end < start ||
            typeof b.question !== "string" ||
            !b.question.trim() ||
            b.question.length > 4000
          )
            return fail(400, "invalid question");
          const text =
            side === "additions" ? await git.readWorking(root, b.path) : await git.readAtRef(root, mergeBase, b.path);
          if (text === null) return fail(404, "file not found");
          const whole = await patch();
          const guidelines = await loadGuidelines(root, base, [b.path]);
          const at = { path: b.path, side, start, end } as const;
          try {
            const job = await agent.runJob("ask", {
              prompt: askPrompt({
                question: b.question,
                ...at,
                lines: text.split("\n").slice(start - 1, end),
                fileDiff: fileDiff(whole, b.path),
                guidelines,
              }),
              instructions: ASK_INSTRUCTIONS,
              guidelines,
              tools: claudeTools(guidelines, whole),
              at,
              question: b.question,
              resume: typeof b.followUp === "string" && /^[\w-]{8,64}$/.test(b.followUp) ? b.followUp : null,
            });
            return json({ job });
          } catch (e) {
            return fail(409, e instanceof Error ? e.message : String(e));
          }
        }),
      },
      "/api/agent/stop": {
        POST: guarded(async () => {
          agent.stop();
          return json({ ok: true });
        }),
      },
      "/api/agent/undo": {
        POST: guarded(async () => {
          try {
            return json(await agent.undo());
          } catch (e) {
            return fail(409, e instanceof Error ? e.message : String(e));
          }
        }),
      },
      "/api/agent/changes": {
        GET: guarded(async () => new Response(await agent.changes(), { headers: { "content-type": "text/plain" } })),
      },
      "/api/agent/events": {
        // Server-sent events: what already happened in the current run, then everything live.
        GET: guarded(async (req) => {
          let off = () => {};
          let beat: ReturnType<typeof setInterval> | undefined;
          const stream = new ReadableStream({
            start(controller) {
              const send = (e: unknown) => controller.enqueue(`data: ${JSON.stringify(e)}\n\n`);
              for (const e of agent.replay()) send(e);
              off = agent.subscribe(send);
              beat = setInterval(() => controller.enqueue(": keep-alive\n\n"), 20_000);
              req.signal.addEventListener("abort", () => {
                off();
                clearInterval(beat);
              });
            },
            cancel() {
              off();
              clearInterval(beat);
            },
          });
          return new Response(stream, {
            headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
          });
        }),
      },
      "/api/settings": {
        PUT: guarded(async (req) => {
          // User settings shared by every review: the theme and the panel layout.
          const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
          const keys = ["theme", "layout"].filter((k) => body && k in body);
          if (!body || !keys.length || keys.some((k) => typeof body[k] !== "object" || body[k] === null))
            return fail(400, "invalid body");
          if (JSON.stringify(body).length > 64_000) return fail(413, "too large");
          for (const k of keys) store.setSetting(k, body[k]);
          return json({ ok: true });
        }),
      },
      "/api/viewed": {
        POST: guarded(async (req) => {
          const body = (await req.json().catch(() => null)) as {
            path?: unknown;
            viewed?: unknown;
          } | null;
          if (typeof body?.path !== "string" || typeof body.viewed !== "boolean") return fail(400, "invalid body");
          store.setViewed(body.path, body.viewed);
          return json({ ok: true });
        }),
      },
    },
    fetch: guarded(async (req) => {
      const path = new URL(req.url).pathname;
      if (dev && path === "/") await buildUI(uiDir);
      if (path === "/") {
        // The saved theme goes in before first paint, so the page never flashes the default.
        const html = await Bun.file(join(uiDir, "index.html")).text();
        const inline = (v: unknown) => JSON.stringify(v).replaceAll("<", "\\u003c");
        const settings = `window.nitTheme=${inline(store.setting("theme"))};window.nitLayout=${inline(store.setting("layout"))};`;
        return new Response(html.replace("</head>", `<script>${settings}${themeBoot}</script></head>`), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      const file = Bun.file(join(uiDir, path));
      if (!path.includes("..") && (await file.exists())) return new Response(file);
      return fail(404, "not found");
    }),
  });

let server: ReturnType<typeof serve>;
try {
  server = serve(preferredPort);
} catch {
  server = serve(0); // taken, most likely by another review of the same repo
}
port = server.port!;

const url = `http://127.0.0.1:${server.port}`;
const openBrowser = () => Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", url]);
// Counts for the banner, straight from the patch the page shows.
const text = await patch();
const files = text.match(/^diff --git /gm)?.length ?? 0;
const add = text.match(/^\+(?!\+\+ )/gm)?.length ?? 0;
const del = text.match(/^-(?!-- )/gm)?.length ?? 0;
term.banner({ title: opened?.title ?? null, branch, base, files, add, del, url, root });
term.keys({ o: { label: "open", run: openBrowser }, q: { label: "quit", run: () => process.exit(0) } });
if (process.env.NIT_NO_OPEN !== "1") openBrowser();
