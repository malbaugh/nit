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
