import { test, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRepo } from '../src/main/db/repo';
import { exportMarkdown } from '../src/main/export/markdown';
import { backupSchema } from '../src/shared/validation';
import type { Item } from '../src/shared/types';

test('composite pagination traverses tied timestamps even if boundary record is deleted', () => {
  const repo = openRepo(':memory:');
  try {
    for (let i = 0; i < 75; i++) repo.create({ content: `batch ${i}`, kind: 'todo' });
    repo.db.prepare('UPDATE items SET created_at = ?').run(1800000000000);
    const first = repo.list({ filter: 'all', limit: 30 });
    const boundary = first.at(-1)!;
    repo.remove(boundary.id);
    const second = repo.list({
      filter: 'all',
      limit: 30,
      cursor: { createdAt: boundary.createdAt, id: boundary.id },
    });
    const last = second.at(-1)!;
    const third = repo.list({ filter: 'all', limit: 30, cursor: { createdAt: last.createdAt, id: last.id } });
    expect([first.length, second.length, third.length]).toEqual([30, 30, 15]);
    expect(new Set([...first, ...second, ...third].map((item) => item.id)).size).toBe(75);
  } finally {
    repo.close();
  }
});

test('literal searches preserve URLs, paths, quotes and wildcard characters', () => {
  const repo = openRepo(':memory:');
  try {
    const item = repo.create({
      content: 'https://example.com API(foo) C:/work say "hello" 50% _a \\tmp',
      kind: 'note',
    });
    for (const q of ['https://example.com', 'API(foo)', 'C:/work', '"hello"', '50%', '_a', '\\tmp']) {
      expect(
        repo.search(q).map((row) => row.id),
        q,
      ).toContain(item.id);
    }
    expect(repo.search('not-present')).toEqual([]);
  } finally {
    repo.close();
  }
});

test('repeated filtered exports preserve previous files and full reminder dates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ticknote-export-regression-'));
  const repo = openRepo(':memory:');
  try {
    repo.create({ content: 'keep this note', kind: 'note' });
    repo.create({ content: 'todo', kind: 'todo', remindAt: new Date(2027, 0, 3, 9).getTime() });
    const complete = exportMarkdown(repo.allForExport(), dir);
    const before = readFileSync(complete.files[0], 'utf8');
    const filtered = exportMarkdown(repo.allForExport('todo'), dir);
    expect(filtered.dir).not.toBe(complete.dir);
    expect(readFileSync(complete.files[0], 'utf8')).toBe(before);
    expect(readFileSync(filtered.files[0], 'utf8')).toContain('2027-01-03 09:00');
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backup restore preserves timestamps, skips existing IDs, and rolls back a failed batch', () => {
  const repo = openRepo(':memory:');
  const source = openRepo(':memory:');
  try {
    const item = source.create({ content: 'recover me', kind: 'todo', remindAt: Date.now() + 3600000 });
    const backup = backupSchema.parse({
      format: 'ticknote-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      items: [item],
    });
    expect(repo.importItems(backup.items)).toBe(1);
    expect(repo.get(item.id)).toEqual(item);
    repo.updateContent(item.id, 'keep newer local version');
    expect(repo.importItems(backup.items)).toBe(0);
    expect(repo.get(item.id)?.content).toBe('keep newer local version');
    const second = source.create({ content: 'batch must roll back', kind: 'note' });
    expect(() =>
      repo.importItems([second, { ...second, id: 'invalid', kind: 'invalid' } as unknown as Item]),
    ).toThrow();
    expect(repo.get(second.id)).toBeNull();
    expect(repo.search('recover')).toEqual([]);
    expect(repo.search('newer local')).toHaveLength(1);
  } finally {
    repo.close();
    source.close();
  }
});
