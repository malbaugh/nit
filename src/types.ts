export type Side = "additions" | "deletions";

export type Draft = {
  id: string;
  path: string;
  side: Side;
  start: number;
  end: number;
  body: string;
  /** Replacement text for lines start..end on the additions side, or null. */
  suggestion: string | null;
  /** The commented lines' text when the draft was written, used to re-anchor it later. */
  anchor: string[];
  /** A reply to an existing GitHub review thread (its id), posted with the review. */
  replyTo?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ReviewData = {
  repo: string;
  branch: string;
  base: string;
  mergeBase: string;
  patch: string;
  drafts: Draft[];
  viewed: string[];
};

export type FileContents = { old: string | null; new: string | null };

/** A definition found by a grammar's tags query. Lines are 1-based. */
export type Symbol = {
  name: string;
  /** function, method, class, interface, module, type, constant… (from the query's capture name) */
  kind: string;
  line: number;
  endLine: number;
  nameLine: number;
  nameCol: number;
};

/** A place in the repo, for definitions and references. */
export type Location = {
  path: string;
  line: number;
  col: number;
  /** The line's text, trimmed. */
  text: string;
  /** The definition's code (up to ~15 lines), when this is a definition. */
  snippet?: string;
  snippetStart?: number;
  kind?: string;
  /** The file is part of this review's diff. */
  inDiff: boolean;
  /** The line itself was added or changed in this diff. */
  changed: boolean;
};

export type ThreadComment = {
  id: string;
  author: string;
  avatar: string | null;
  body: string;
  createdAt: string;
  url: string;
};

/** A review thread already on the pull request. `line` is null for file-level or outdated threads. */
export type Thread = {
  id: string;
  path: string;
  side: Side;
  line: number | null;
  startLine: number | null;
  subject: "line" | "file";
  resolved: boolean;
  outdated: boolean;
  comments: ThreadComment[];
};

export type PullRequest = { number: number; title: string; url: string; state: string; headSha: string };

export type GitHubState =
  | { status: "unavailable"; reason: string }
  | {
      status: "ready";
      pr: PullRequest;
      viewer: string;
      threads: Thread[];
      /** Whether local lines match the PR: same commit and nothing uncommitted. */
      local: { headSha: string; dirty: boolean };
    };

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export type PostResult = {
  url: string | null;
  posted: string[];
  /** Drafts posted as file comments because their lines aren't in the PR's diff. */
  asFileComments: string[];
  failed: { id: string; error: string }[];
};

/** One line matching a repo-wide search. Columns and ranges count UTF-16 units. */
export type SearchMatch = { path: string; line: number; text: string; ranges: [number, number][] };
export type SearchResult = {
  matches: SearchMatch[];
  /** More files are left to search; pass `next` back for the next page. */
  truncated: boolean;
  next: string | null;
  /** Set when a regex didn't compile and fff searched for the literal text instead. */
  regexError?: string;
};

/** What the agent did with one draft comment. */
export type AgentOutcome = { id: string; status: "done" | "skipped" | "question"; note: string };

/** One agent pass over the drafts, kept per review so results and undo outlive a restart. */
export type AgentRun = {
  id: string;
  drafts: string[];
  startedAt: number;
  endedAt: number | null;
  state: "running" | "done" | "stopped" | "failed" | "undone";
  /** Snapshot trees before and after (snapshot.ts). */
  before: string;
  after: string | null;
  files: { status: string; path: string }[];
  outcomes: AgentOutcome[];
  error: string | null;
  costUsd: number | null;
  /** The Agent SDK session, resumed by the next pass. */
  sessionId: string | null;
};

/** The live stream while the agent works. */
export type AgentEvent =
  | { type: "run"; run: AgentRun }
  | { type: "text"; text: string }
  | { type: "tool"; tool: string; target: string };
