import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Draft } from "./types";

export function dataDir() {
  return process.env.NIT_DATA_DIR ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"), "nit");
}

type DraftRow = {
  id: string;
  path: string;
  side: Draft["side"];
  start_line: number;
  end_line: number;
  body: string;
  suggestion: string | null;
  anchor: string;
  reply_to: string | null;
  created_at: number;
  updated_at: number;
};

const toDraft = (r: DraftRow): Draft => ({
  id: r.id,
  path: r.path,
  side: r.side,
  start: r.start_line,
  end: r.end_line,
  body: r.body,
  suggestion: r.suggestion,
  anchor: JSON.parse(r.anchor),
  replyTo: r.reply_to,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** All of one review's state, keyed by project + branch so it outlives the worktree. */
export function openStore(review: string) {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, "nit.db"), { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 3000");
  db.run(`create table if not exists draft (
    id text primary key,
    review text not null,
    path text not null,
    side text not null check (side in ('additions', 'deletions')),
    start_line integer not null,
    end_line integer not null,
    body text not null,
    suggestion text,
    anchor text not null,
    reply_to text,
    created_at integer not null,
    updated_at integer not null
  )`);
  db.run("create index if not exists draft_review on draft (review)");
  // Databases created before replies existed get the column added once.
  if (
    !db
      .query<{ name: string }, []>("select name from pragma_table_info('draft')")
      .all()
      .some((c) => c.name === "reply_to")
  )
    db.run("alter table draft add column reply_to text");
  db.run(`create table if not exists viewed (
    review text not null,
    path text not null,
    primary key (review, path)
  )`);

  // User settings (the theme): shared by every review, unlike the rest of this file.
  db.run("create table if not exists setting (key text primary key, value text not null)");
  const getSetting = db.query<{ value: string }, [string]>("select value from setting where key = ?");
  const putSetting = db.query(
    "insert into setting (key, value) values (?, ?) on conflict (key) do update set value = excluded.value",
  );

  const listDrafts = db.query<DraftRow, [string]>("select * from draft where review = ? order by path, start_line");
  const getDraft = db.query<DraftRow, [string, string]>("select * from draft where review = ? and id = ?");
  const upsert =
    db.query(`insert into draft (id, review, path, side, start_line, end_line, body, suggestion, anchor, reply_to, created_at, updated_at)
    values ($id, $review, $path, $side, $start, $end, $body, $suggestion, $anchor, $replyTo, $createdAt, $updatedAt)
    on conflict (id) do update set body = excluded.body, suggestion = excluded.suggestion,
      start_line = excluded.start_line, end_line = excluded.end_line, side = excluded.side,
      anchor = excluded.anchor, updated_at = excluded.updated_at
    where draft.review = excluded.review`);
  const remove = db.query("delete from draft where review = ? and id = ?");
  const listViewed = db.query<{ path: string }, [string]>("select path from viewed where review = ?");
  const addViewed = db.query("insert or ignore into viewed (review, path) values (?, ?)");
  const removeViewed = db.query("delete from viewed where review = ? and path = ?");

  return {
    drafts: () => listDrafts.all(review).map(toDraft),
    draft: (id: string) => {
      const row = getDraft.get(review, id);
      return row ? toDraft(row) : null;
    },
    saveDraft: (d: Draft) => {
      upsert.run({ ...d, review, anchor: JSON.stringify(d.anchor), replyTo: d.replyTo ?? null });
    },
    deleteDraft: (id: string) => {
      remove.run(review, id);
    },
    setting: (key: string): unknown => {
      const row = getSetting.get(key);
      return row ? JSON.parse(row.value) : null;
    },
    setSetting: (key: string, value: unknown) => {
      putSetting.run(key, JSON.stringify(value));
    },
    viewed: () => listViewed.all(review).map((r) => r.path),
    setViewed: (path: string, viewed: boolean) => {
      (viewed ? addViewed : removeViewed).run(review, path);
    },
  };
}

export type Store = ReturnType<typeof openStore>;
