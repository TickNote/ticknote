import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CreateItemInput, ExportScope, Item, ItemKind, ItemStatus, ListQuery } from '../../shared/types';
import { SCHEMA, SCHEMA_VERSION } from './schema';

type Row = Record<string, unknown>;

export interface ListRangeQuery {
  from?: number;
  to?: number;
  status?: ItemStatus;
  kind?: ItemKind;
  limit?: number;
}

export interface UpdateItemPatch {
  content?: string;
  kind?: ItemKind;
  status?: ItemStatus;
  remindAt?: number | null;
}

export interface Repo {
  db: DatabaseSync;
  create(input: CreateItemInput, source?: 'human' | 'ai', aiRunId?: string): Item;
  list(query: ListQuery): Item[];
  listRange(query: ListRangeQuery): Item[];
  search(rawQuery: string, limit?: number): Item[];
  get(id: string): Item | null;
  setStatus(id: string, done: boolean): Item | null;
  updateContent(id: string, content: string): Item | null;
  update(id: string, patch: UpdateItemPatch): Item | null;
  remove(id: string): boolean;
  clearAll(): number;
  setReminder(id: string, remindAt: number | null): Item | null;
  dueReminders(now: number): Item[];
  markReminded(ids: string[], at: number): void;
  allForExport(scope?: ExportScope): Item[];
  stats(dayStart: number): { todayOpenTodos: number; pendingReminders: number };
  close(): void;
}

function mapRow(row: Row): Item {
  return {
    id: String(row.id),
    content: String(row.content),
    kind: row.kind === 'todo' ? 'todo' : 'note',
    status: row.status === 'done' ? 'done' : 'open',
    remindAt: row.remind_at === null || row.remind_at === undefined ? null : Number(row.remind_at),
    remindedAt: row.reminded_at === null || row.reminded_at === undefined ? null : Number(row.reminded_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: row.completed_at === null || row.completed_at === undefined ? null : Number(row.completed_at),
    source: row.source === 'ai' ? 'ai' : 'human',
  };
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as Row | undefined;
  const version = row ? Number(row.user_version ?? 0) : 0;
  if (version >= SCHEMA_VERSION) return;

  db.exec('BEGIN');
  try {
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function openRepo(dbPath: string): Repo {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 3000');
  db.exec('PRAGMA synchronous = NORMAL');
  migrate(db);

  const get = (id: string): Item | null => {
    const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Row | undefined;
    return row ? mapRow(row) : null;
  };

  const create = (
    input: CreateItemInput,
    source: 'human' | 'ai' = input.source ?? 'human',
    aiRunId?: string,
  ): Item => {
    const now = Date.now();
    const id = randomUUID();
    db.prepare(
      'INSERT INTO items (id, content, kind, status, created_at, updated_at, source, ai_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, input.content, input.kind, 'open', now, now, source, aiRunId ?? null);
    const item = get(id);
    if (!item) throw new Error('insert failed');
    return item;
  };

  const list = (query: ListQuery): Item[] => {
    const limit = Math.min(Math.max(Number(query.limit ?? 30), 1), 50);
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (query.filter === 'todo') clauses.push("kind = 'todo' AND status = 'open'");
    if (query.filter === 'note') clauses.push("kind = 'note'");
    if (query.filter === 'done') clauses.push("status = 'done'");
    if (typeof query.cursor === 'number' && Number.isFinite(query.cursor)) {
      clauses.push('created_at < ?');
      params.push(query.cursor);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);
    const rows = db
      .prepare(`SELECT * FROM items ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
      .all(...params) as Row[];
    return rows.map(mapRow);
  };

  const listRange = (query: ListRangeQuery): Item[] => {
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 50);
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (typeof query.from === 'number' && Number.isFinite(query.from)) {
      clauses.push('created_at >= ?');
      params.push(query.from);
    }
    if (typeof query.to === 'number' && Number.isFinite(query.to)) {
      clauses.push('created_at <= ?');
      params.push(query.to);
    }
    if (query.status) clauses.push('status = ?');
    if (query.status) params.push(query.status);
    if (query.kind) clauses.push('kind = ?');
    if (query.kind) params.push(query.kind);

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);
    const rows = db
      .prepare(`SELECT * FROM items ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
      .all(...params) as Row[];
    return rows.map(mapRow);
  };

  const search = (rawQuery: string, limit = 30): Item[] => {
    const text = rawQuery.trim();
    if (!text) return [];
    const capped = Math.min(Math.max(limit, 1), 50);

    if (text.length >= 3) {
      const phrase = text.replace(/["^()*:]/g, ' ').replace(/\s+/g, ' ').trim();
      if (phrase.length >= 3) {
        try {
          const rows = db
            .prepare(
              'SELECT items.* FROM items_fts JOIN items ON items.rowid = items_fts.rowid WHERE items_fts MATCH ? ORDER BY items.created_at DESC LIMIT ?',
            )
            .all(`"${phrase}"`, capped) as Row[];
          return rows.map(mapRow);
        } catch {
          // 查询串包含 FTS 语法字符时退回 LIKE
        }
      }
    }

    const escaped = text.replace(/[%_\\]/g, (m) => `\\${m}`);
    const rows = db
      .prepare("SELECT * FROM items WHERE content LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?")
      .all(`%${escaped}%`, capped) as Row[];
    return rows.map(mapRow);
  };

  const setStatus = (id: string, done: boolean): Item | null => {
    const now = Date.now();
    const result = db
      .prepare('UPDATE items SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
      .run(done ? 'done' : 'open', done ? now : null, now, id);
    if (Number(result.changes) === 0) return null;
    return get(id);
  };

  const updateContent = (id: string, content: string): Item | null => {
    const now = Date.now();
    const result = db.prepare('UPDATE items SET content = ?, updated_at = ? WHERE id = ?').run(content, now, id);
    if (Number(result.changes) === 0) return null;
    return get(id);
  };

  const update = (id: string, patch: UpdateItemPatch): Item | null => {
    const now = Date.now();
    const sets: string[] = ['updated_at = ?'];
    const params: Array<string | number | null> = [now];

    if (patch.content !== undefined) {
      sets.push('content = ?');
      params.push(patch.content);
    }
    if (patch.kind !== undefined) {
      sets.push('kind = ?');
      params.push(patch.kind);
    }
    if (patch.status !== undefined) {
      sets.push('status = ?', 'completed_at = ?');
      params.push(patch.status, patch.status === 'done' ? now : null);
    }
    if (patch.remindAt !== undefined) {
      // 改提醒时间必须清空 reminded_at
      sets.push('remind_at = ?', 'reminded_at = NULL');
      params.push(patch.remindAt);
    }
    if (sets.length === 1) return get(id);

    params.push(id);
    const result = db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    if (Number(result.changes) === 0) return null;
    return get(id);
  };

  const remove = (id: string): boolean => {
    const result = db.prepare('DELETE FROM items WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  };

  const setReminder = (id: string, remindAt: number | null): Item | null => {
    const now = Date.now();
    // 改提醒时间必须清空 reminded_at，否则改到未来后不会再弹
    const result = db
      .prepare('UPDATE items SET remind_at = ?, reminded_at = NULL, updated_at = ? WHERE id = ?')
      .run(remindAt, now, id);
    if (Number(result.changes) === 0) return null;
    return get(id);
  };

  const dueReminders = (now: number): Item[] => {
    const rows = db
      .prepare(
        "SELECT * FROM items WHERE remind_at IS NOT NULL AND remind_at <= ? AND reminded_at IS NULL AND status = 'open' ORDER BY remind_at ASC",
      )
      .all(now) as Row[];
    return rows.map(mapRow);
  };

  const markReminded = (ids: string[], at: number): void => {
    if (ids.length === 0) return;
    const statement = db.prepare('UPDATE items SET reminded_at = ? WHERE id = ?');
    db.exec('BEGIN');
    try {
      for (const id of ids) statement.run(at, id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  const allForExport = (scope: ExportScope = 'all'): Item[] => {
    const clauses: string[] = [];
    const params: number[] = [];
    if (scope === 'todo') clauses.push("kind = 'todo' AND status = 'open'");
    if (scope === 'note') clauses.push("kind = 'note'");
    if (scope === 'done') clauses.push("status = 'done'");
    if (scope === 'today') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      clauses.push('created_at >= ?');
      params.push(start.getTime());
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(`SELECT * FROM items ${where} ORDER BY created_at ASC, rowid ASC`)
      .all(...params) as Row[];
    return rows.map(mapRow);
  };

  const clearAll = (): number => {
    const row = db.prepare('SELECT COUNT(*) AS c FROM items').get() as Row | undefined;
    db.exec('DELETE FROM items');
    return Number(row?.c ?? 0);
  };

  return {
    db,
    create,
    list,
    listRange,
    search,
    get,
    setStatus,
    updateContent,
    update,
    remove,
    clearAll,
    setReminder,
    dueReminders,
    markReminded,
    allForExport,
    stats: (dayStart: number) => {
      const openRow = db
        .prepare("SELECT COUNT(*) AS c FROM items WHERE kind = 'todo' AND status = 'open' AND created_at >= ?")
        .get(dayStart) as Row | undefined;
      const remindRow = db
        .prepare("SELECT COUNT(*) AS c FROM items WHERE status = 'open' AND remind_at IS NOT NULL AND reminded_at IS NULL")
        .get() as Row | undefined;
      return {
        todayOpenTodos: Number(openRow?.c ?? 0),
        pendingReminders: Number(remindRow?.c ?? 0),
      };
    },
    close: () => db.close(),
  };
}
