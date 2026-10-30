import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { exportMarkdown } from '../src/main/export/markdown';
import type { Item } from '../src/shared/types';

function makeItem(patch: Partial<Item>): Item {
  const createdAt = Date.UTC(2026, 9, 29, 2, 0, 0);
  return {
    id: randomUUID(),
    content: '示例记录',
    kind: 'note',
    status: 'open',
    remindAt: null,
    remindedAt: null,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    source: 'human',
    ...patch,
  };
}

test('Markdown 导出：按日期分文件、待办/便签格式与提醒后缀', () => {
  const dir = join(tmpdir(), `ticknote-export-${randomUUID()}`);
  const items = [
    makeItem({ content: '整理延期事项', kind: 'todo', status: 'open' }),
    makeItem({ content: '已完成的事', kind: 'todo', status: 'done' }),
    makeItem({ content: '一条便签', kind: 'note' }),
    makeItem({
      content: '带提醒的记录',
      remindAt: Date.UTC(2026, 9, 30, 10, 30, 0),
    }),
    makeItem({
      content: '多行\n第二行',
      createdAt: Date.UTC(2026, 9, 28, 3, 0, 0),
    }),
  ];

  try {
    const result = exportMarkdown(items, dir);
    assert.equal(result.count, 5);
    assert.equal(result.files.length, 2, '两天数据应分成两个文件');

    const lines = readFileSync(result.files[0], 'utf8').split('\n');
    assert.ok(lines[0].startsWith('# 2026-'));
    assert.ok(lines.some((line) => line === '- [ ] 整理延期事项'));
    assert.ok(lines.some((line) => line === '- [x] 已完成的事'));
    assert.ok(lines.some((line) => line === '- 一条便签'));
    assert.ok(lines.some((line) => line.startsWith('- 带提醒的记录 · 提醒 ')));

    const multiline = readFileSync(result.files[1], 'utf8');
    assert.ok(multiline.includes('- 多行\n  第二行'), '多行内容应缩进续行');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
