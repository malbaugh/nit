import type {
  AddPullRequestReviewThreadInput,
  PullRequestReviewThread,
  PullRequestReviewThreadConnection,
} from "@octokit/graphql-schema";
import { $ } from "bun";
import { Octokit } from "octokit";
import { childEnv } from "./child-env";
import { parseRemote, type Repo } from "./git";
import type { Check, CheckAnnotation, Draft, GitHubState, PostResult, PullRequest, ReviewEvent, Thread } from "./types";

export { parseRemote };

const out = async (p: ReturnType<typeof $>) => (await p.nothrow().quiet().text()).trim();

// gh reads GH_TOKEN, GITHUB_TOKEN and GH_CONFIG_DIR ahead of its own login, and Bun loads the
// reviewed repo's .env into nit's environment: gh gets only the basics (child-env.ts).
export const ghEnv = childEnv;
const secret = (host: string) => ({ service: "nit", name: `github-token:${host}` });

/** A token saved in nit for `host` (your OS keychain), or null. */
export const savedToken = (host: string) => Bun.secrets.get(secret(host)).catch(() => null);

/** Saves (or, with null, removes) nit's token for `host` in your OS keychain. */
export async function saveToken(host: string, value: string | null) {
  if (value) await Bun.secrets.set({ ...secret(host), value });
  else await Bun.secrets.delete(secret(host));
}

/** Your GitHub login: the token saved in nit, else the GitHub CLI's own (`gh auth token`). */
export async function token(host: string) {
  return (await savedToken(host)) || out($`gh auth token --hostname ${host}`.env(ghEnv()));
}

/** Where the token comes from and whose it is, for the settings screen. */
export async function account(host: string) {
  const saved = await savedToken(host);
  const auth = saved || (await out($`gh auth token --hostname ${host}`.env(ghEnv())));
  if (!auth) return { host, source: null, login: null, saved: false };
  try {
    const octokit = new Octokit({ auth, baseUrl: host === "github.com" ? undefined : `https://${host}/api/v3` });
    const { data } = await octokit.rest.users.getAuthenticated();
    return { host, source: saved ? ("nit" as const) : ("gh" as const), login: data.login, saved: !!saved };
  } catch {
    return { host, source: saved ? ("nit" as const) : ("gh" as const), login: null, saved: !!saved };
  }
}

const THREAD_FIELDS = `
  id isResolved isOutdated path line startLine diffSide subjectType
  comments(first: 100) { nodes { id body createdAt url author { login avatarUrl } } }`;

function toThread(t: PullRequestReviewThread): Thread {
  return {
    id: t.id,
    path: t.path,
    side: t.diffSide === "LEFT" ? "deletions" : "additions",
    line: t.line ?? null,
    startLine: t.startLine ?? null,
    subject: t.subjectType === "FILE" ? "file" : "line",
    resolved: t.isResolved,
    outdated: t.isOutdated,
    comments: (t.comments.nodes ?? []).flatMap((c) =>
      c
        ? [
            {
              id: c.id,
              author: c.author?.login ?? "ghost",
              avatar: c.author?.avatarUrl ?? null,
              body: c.body,
              createdAt: c.createdAt,
              url: c.url,
            },
          ]
        : [],
    ),
  };
}

/** Runs tasks with at most `limit` in flight, keeping result order. */
async function pool<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await run(items[i]);
      }
    }),
  );
  return results;
}

const where = (d: Draft) => (d.start === d.end ? `Line ${d.end}` : `Lines ${d.start}–${d.end}`);
const bodyOf = (d: Draft) =>
  d.suggestion === null ? d.body : `${d.body.trim()}\n\n\`\`\`suggestion\n${d.suggestion}\n\`\`\``.trim();

/**
 * GitHub for one review, through the official SDK (Octokit). Everything is lazy and cached so the
 * page never waits on the network: the pull request and its threads load in the background.
 */
export function createGitHub(root: string, branch: string, forcedPr: number | null) {
  type Ctx = { octokit: Octokit; repo: Repo; pr: PullRequest & { id: string }; viewer: string };
  let ctx: Promise<Ctx | { reason: string }> | null = null;
  let cache: { at: number; state: Promise<GitHubState> } | null = null;

  function connect() {
    ctx ??= (async () => {
      const remote = parseRemote(await out($`git remote get-url origin`.cwd(root)));
      if (!remote) return { reason: "This repo has no origin remote on GitHub." };
      const auth = await token(remote.host);
      if (!auth)
        return {
          reason: "Sign in with `gh auth login`, or save a token in Settings → GitHub, to see and post comments.",
        };
      const api = remote.host === "github.com" ? undefined : `https://${remote.host}/api/v3`;
      const octokit = new Octokit({ auth, baseUrl: api, userAgent: "nit" });
      let number = forcedPr;
      if (!number) {
        const { data } = await octokit.rest.pulls.list({
          owner: remote.owner,
          repo: remote.name,
          head: `${remote.owner}:${branch}`,
          state: "open",
          per_page: 1,
        });
        number = data[0]?.number ?? null;
      }
      if (!number) return { reason: `No open pull request for ${branch}.` };
      const r = await octokit.graphql<{
        viewer: { login: string };
        repository: {
          pullRequest: { id: string; number: number; title: string; url: string; state: string; headRefOid: string };
        };
      }>(
        `query($owner: String!, $name: String!, $number: Int!) {
          viewer { login }
          repository(owner: $owner, name: $name) { pullRequest(number: $number) { id number title url state headRefOid } }
        }`,
        { owner: remote.owner, name: remote.name, number },
      );
      const p = r.repository.pullRequest;
      return {
        octokit,
        repo: remote,
        viewer: r.viewer.login,
        pr: { id: p.id, number: p.number, title: p.title, url: p.url, state: p.state, headSha: p.headRefOid },
      };
    })().catch((e: unknown) => {
      ctx = null; // a failed sign-in or network error is retried next time
      return { reason: e instanceof Error ? e.message : String(e) };
    });
    return ctx;
  }

  async function ready(): Promise<Ctx> {
    const c = await connect();
    if ("reason" in c) throw new Error(c.reason);
    return c;
  }

  async function fetchThreads(c: Ctx): Promise<Thread[]> {
    const threads: Thread[] = [];
    let cursor: string | null = null;
    do {
      const r: { repository: { pullRequest: { reviewThreads: PullRequestReviewThreadConnection } } } =
        await c.octokit.graphql(
          `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
          repository(owner: $owner, name: $name) { pullRequest(number: $number) {
            reviewThreads(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { ${THREAD_FIELDS} } }
          } }
        }`,
          { owner: c.repo.owner, name: c.repo.name, number: c.pr.number, cursor },
        );
      const page = r.repository.pullRequest.reviewThreads;
      for (const t of page.nodes ?? []) if (t) threads.push(toThread(t));
      cursor = page.pageInfo.hasNextPage ? (page.pageInfo.endCursor ?? null) : null;
    } while (cursor);
    return threads;
  }

  async function load(): Promise<GitHubState> {
    const c = await connect();
    if ("reason" in c) return { status: "unavailable", reason: c.reason };
    const [threads, details, headSha, status] = await Promise.all([
      fetchThreads(c),
      fetchDetails(c),
      out($`git rev-parse HEAD`.cwd(root)),
      out($`git status --porcelain`.cwd(root)),
    ]);
    c.pr = { ...c.pr, ...details.pr };
    return {
      status: "ready",
      pr: c.pr,
      viewer: c.viewer,
      threads,
      body: details.body,
      author: details.author,
      draft: details.draft,
      openedAt: details.openedAt,
      checks: details.checks,
      annotations: details.annotations,
      local: { headSha, dirty: status !== "" },
    };
  }

  /** What changes while you review: the title and description, the head commit and its checks. */
  async function fetchDetails(c: Ctx) {
    const r = await c.octokit.graphql<{ repository: { pullRequest: DetailsNode } }>(
      `query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) { pullRequest(number: $number) {
          title state body headRefOid isDraft createdAt author { login avatarUrl }
          commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
            __typename
            ... on CheckRun { name status conclusion detailsUrl title
              annotations(first: 50) { nodes { path title message annotationLevel location { start { line } end { line } } } } }
            ... on StatusContext { context state targetUrl description }
          } } } } } }
        } }
      }`,
      { owner: c.repo.owner, name: c.repo.name, number: c.pr.number },
    );
    return toDetails(r.repository.pullRequest);
  }

  return {
    /** Forget the connection, after the token changed. */
    reconnect() {
      ctx = null;
      cache = null;
    },

    /** Cached for 30 seconds; `fresh` refetches. Never throws. */
    state(fresh = false): Promise<GitHubState> {
      if (fresh || !cache || Date.now() - cache.at > 30_000) {
        const state = load().catch((e: unknown) => ({ status: "unavailable" as const, reason: String(e) }));
        cache = { at: Date.now(), state };
      }
      return cache.state;
    },

    /** Warm the connection and the thread cache in the background. */
    warm() {
      void this.state();
    },

    async setResolved(threadId: string, resolved: boolean) {
      const c = await ready();
      await c.octokit.graphql(
        resolved
          ? "mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id } } }"
          : "mutation($id: ID!) { unresolveReviewThread(input: { threadId: $id }) { thread { id } } }",
        { id: threadId },
      );
      cache = null;
    },

    /**
     * Posts drafts as one review: a pending review (reused if one exists), one thread or reply
     * per draft, then submit with the verdict. A line GitHub won't accept (outside the PR's diff)
     * is retried as a file comment that names the line. Only what GitHub confirmed counts as posted.
     */
    async postReview(drafts: Draft[], event: ReviewEvent, summary: string): Promise<PostResult> {
      const c = await ready();
      const result: PostResult = { url: null, posted: [], asFileComments: [], failed: [] };

      const existing = await c.octokit.graphql<{
        repository: { pullRequest: { reviews: { nodes: { id: string }[] } } };
      }>(
        `query($owner: String!, $name: String!, $number: Int!, $author: String!) {
          repository(owner: $owner, name: $name) { pullRequest(number: $number) {
            reviews(first: 1, states: PENDING, author: $author) { nodes { id } }
          } }
        }`,
        { owner: c.repo.owner, name: c.repo.name, number: c.pr.number, author: c.viewer },
      );
      const reviewId =
        existing.repository.pullRequest.reviews.nodes[0]?.id ??
        (
          await c.octokit.graphql<{ addPullRequestReview: { pullRequestReview: { id: string } } }>(
            "mutation($pr: ID!) { addPullRequestReview(input: { pullRequestId: $pr }) { pullRequestReview { id } } }",
            { pr: c.pr.id },
          )
        ).addPullRequestReview.pullRequestReview.id;

      const addThread = (input: AddPullRequestReviewThreadInput) =>
        c.octokit.graphql(
          "mutation($input: AddPullRequestReviewThreadInput!) { addPullRequestReviewThread(input: $input) { thread { id } } }",
          { input },
        );

      await pool(drafts, 4, async (d) => {
        try {
          if (d.replyTo) {
            await c.octokit.graphql(
              "mutation($review: ID!, $thread: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewId: $review, pullRequestReviewThreadId: $thread, body: $body }) { comment { id } } }",
              { review: reviewId, thread: d.replyTo, body: bodyOf(d) },
            );
          } else if (d.start === 0) {
            await addThread({ pullRequestReviewId: reviewId, path: d.path, body: bodyOf(d), subjectType: "FILE" });
          } else {
            const side = d.side === "deletions" ? "LEFT" : "RIGHT";
            try {
              await addThread({
                pullRequestReviewId: reviewId,
                path: d.path,
                body: bodyOf(d),
                line: d.end,
                side,
                ...(d.start !== d.end ? { startLine: d.start, startSide: side } : {}),
                subjectType: "LINE",
              });
            } catch (e) {
              // Only a line GitHub can't place falls back; network or permission errors don't.
              if (!/\bline\b|diff|resolve/i.test(e instanceof Error ? e.message : String(e))) throw e;
              await addThread({
                pullRequestReviewId: reviewId,
                path: d.path,
                body: `**${where(d)}${d.side === "deletions" ? " (removed)" : ""}:** ${bodyOf(d)}`,
                subjectType: "FILE",
              });
              result.asFileComments.push(d.id);
            }
          }
          result.posted.push(d.id);
        } catch (e) {
          result.failed.push({ id: d.id, error: e instanceof Error ? e.message : String(e) });
        }
      });

      // Submit even if some drafts failed: what was added is real; failed drafts stay local.
      if (result.posted.length || summary.trim() || event !== "COMMENT") {
        const submitted = await c.octokit.graphql<{ submitPullRequestReview: { pullRequestReview: { url: string } } }>(
          "mutation($review: ID!, $event: PullRequestReviewEvent!, $body: String) { submitPullRequestReview(input: { pullRequestReviewId: $review, event: $event, body: $body }) { pullRequestReview { url } } }",
          { review: reviewId, event, body: summary.trim() || null },
        );
        result.url = submitted.submitPullRequestReview.pullRequestReview.url;
      }
      cache = null;
      return result;
    },
  };
}

export type GitHub = ReturnType<typeof createGitHub>;

type DetailsNode = {
  title: string;
  state: string;
  body: string;
  headRefOid: string;
  isDraft: boolean;
  createdAt: string;
  author: { login: string; avatarUrl: string } | null;
  commits: {
    nodes: {
      commit: {
        statusCheckRollup: {
          contexts: {
            nodes: (
              | {
                  __typename: "CheckRun";
                  name: string;
                  status: string;
                  conclusion: string | null;
                  detailsUrl: string | null;
                  title: string | null;
                  annotations: {
                    nodes: {
                      path: string;
                      title: string | null;
                      message: string;
                      annotationLevel: string;
                      location: { start: { line: number }; end: { line: number } };
                    }[];
                  };
                }
              | {
                  __typename: "StatusContext";
                  context: string;
                  state: string;
                  targetUrl: string | null;
                  description: string | null;
                }
            )[];
          };
        } | null;
      };
    }[];
  };
};

const FAILED = new Set(["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);

export function toDetails(p: DetailsNode) {
  const checks: Check[] = [];
  const annotations: CheckAnnotation[] = [];
  for (const n of p.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []) {
    if (n.__typename === "StatusContext") {
      checks.push({
        name: n.context,
        state: n.state === "SUCCESS" ? "success" : FAILED.has(n.state) ? "failure" : "pending",
        url: n.targetUrl,
        summary: n.description,
      });
      continue;
    }
    const state =
      n.status !== "COMPLETED"
        ? "pending"
        : n.conclusion === "SUCCESS"
          ? "success"
          : FAILED.has(n.conclusion ?? "")
            ? "failure"
            : "neutral";
    checks.push({ name: n.name, state, url: n.detailsUrl, summary: n.title });
    n.annotations.nodes.forEach((a, i) => {
      annotations.push({
        id: `${n.name}:${i}`,
        check: n.name,
        path: a.path,
        start: a.location.start.line,
        end: a.location.end.line,
        level: a.annotationLevel === "FAILURE" ? "failure" : a.annotationLevel === "WARNING" ? "warning" : "notice",
        title: a.title,
        message: a.message,
      });
    });
  }
  // Failures first, then what's still running, as GitHub lists them.
  const order = { failure: 0, pending: 1, neutral: 2, success: 3 };
  checks.sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));
  return {
    pr: { title: p.title, state: p.state, headSha: p.headRefOid },
    body: p.body,
    author: p.author ? { login: p.author.login, avatar: p.author.avatarUrl } : null,
    draft: p.isDraft,
    openedAt: Date.parse(p.createdAt),
    checks,
    annotations,
  };
}
