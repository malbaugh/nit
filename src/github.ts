import type {
  AddPullRequestReviewThreadInput,
  PullRequestReviewThread,
  PullRequestReviewThreadConnection,
} from "@octokit/graphql-schema";
import { $ } from "bun";
import { Octokit } from "octokit";
import { parseRemote, type Repo } from "./git";
import type { Draft, GitHubState, PostResult, PullRequest, ReviewEvent, Thread } from "./types";

export { parseRemote };

const out = async (p: ReturnType<typeof $>) => (await p.nothrow().quiet().text()).trim();

/** The user's existing login: GH_TOKEN / GITHUB_TOKEN, else the GitHub CLI's (`gh auth token`). */
export async function token(host: string) {
  const env = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (env) return env;
  return out($`gh auth token --hostname ${host}`);
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
      if (!auth) return { reason: "Sign in with `gh auth login` (or set GH_TOKEN) to see and post GitHub comments." };
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
    const [threads, headSha, status] = await Promise.all([
      fetchThreads(c),
      out($`git rev-parse HEAD`.cwd(root)),
      out($`git status --porcelain`.cwd(root)),
    ]);
    return { status: "ready", pr: c.pr, viewer: c.viewer, threads, local: { headSha, dirty: status !== "" } };
  }

  return {
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
