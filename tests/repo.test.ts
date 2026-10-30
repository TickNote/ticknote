import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { openRepo } from '../src/main/db/repo';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('repo：增删改查、分页、提醒、类型切换、清空', async () => {
  const dbPath = join(tmpdir(), `ticknote-test-${randomUUID()}.db`);
  const repo = openRepo(dbPath);

  try {
    const note = repo.create({ content: '周会提到的三个风险点', kind: 'note' });
    assert.equal(note.kind, 'note');
    assert.equal(note.status, 'open');
    assert.equal(note.source, 'human');
    assert.ok(note.createdAt > 0);

    const todo = repo.create({ content: '和张工确认接口字段', kind: 'todo' });
    assert.equal(todo.kind, 'todo');

    const all = repo.list({ filter: 'all', limit: 30 });
    assert.equal(all.length, 2);
    const expectedFirst = todo.createdAt === note.createdAt ? [todo.id, note.id].sort().at(-1) : todo.id;
    assert.equal(all[0].id, expectedFirst, '按创建时间和 id 稳定倒序排列');

    assert.equal(repo.list({ filter: 'todo', limit: 30 }).length, 1);
    assert.equal(repo.list({ filter: 'note', limit: 30 }).length, 1);

    const ftsHit = repo.search('风险点');
    assert.equal(ftsHit.length, 1);
    assert.equal(ftsHit[0].content, '周会提到的三个风险点');
    assert.equal(repo.search('风险').length, 1, '少于 3 字的查询应回退到 LIKE');

    const done = repo.setStatus(todo.id, true);
    assert.equal(done?.status, 'done');
    assert.ok(done?.completedAt);
    assert.equal(repo.list({ filter: 'todo' }).length, 0);
    assert.equal(repo.list({ filter: 'done' }).length, 1);
    assert.equal(repo.search('接口字段').length, 1, '状态变更后 FTS 索引应保持可用');

    const restored = repo.setStatus(todo.id, false);
    assert.equal(restored?.status, 'open');
    assert.equal(restored?.completedAt, null);

    for (let i = 0; i < 55; i++) {
      repo.create({ content: `分页测试记录 ${i}`, kind: 'note' });
      await sleep(1);
    }

    const page1 = repo.list({ filter: 'all', limit: 30 });
    assert.equal(page1.length, 30);
    const last = page1[page1.length - 1];
    const page2 = repo.list({ filter: 'all', limit: 30, cursor: { createdAt: last.createdAt, id: last.id } });
    assert.equal(page2.length, 27);
    const ids = new Set([...page1, ...page2].map((i) => i.id));
    assert.equal(ids.size, 57, '分页结果不应重复');

    // 抽屉编辑：改内容后 updated_at 刷新，FTS 同步
    const toEdit = repo.create({ content: '待修改内容', kind: 'note' });
    const edited = repo.updateContent(toEdit.id, '已经改好的内容');
    assert.equal(edited?.content, '已经改好的内容');
    assert.ok((edited?.updatedAt ?? 0) >= toEdit.updatedAt);
    assert.equal(repo.search('已经改好').length, 1, '更新内容后 FTS 索引应同步');

    // 切换类型：待办 ↔ 便签，状态与创建时间保持不变
    const kindItem = repo.create({ content: '类型切换测试', kind: 'todo' });
    const toNote = repo.update(kindItem.id, { kind: 'note' });
    assert.equal(toNote?.kind, 'note');
    assert.equal(toNote?.status, 'open');
    assert.equal(toNote?.createdAt, kindItem.createdAt);
    assert.equal(
      repo.list({ filter: 'note' }).some((item) => item.id === kindItem.id),
      true,
    );
    assert.equal(
      repo.list({ filter: 'todo' }).some((item) => item.id === kindItem.id),
      false,
    );
    assert.equal(repo.update(kindItem.id, { kind: 'todo' })?.kind, 'todo');
    assert.equal(repo.search('类型切换').length, 1, '切换类型不应影响 FTS');

    // 硬删除 + 幂等
    const toDelete = repo.create({ content: '临时记录', kind: 'note' });
    assert.equal(repo.remove(toDelete.id), true);
    assert.equal(repo.get(toDelete.id), null);
    assert.equal(repo.remove(toDelete.id), false, '重复删除应返回 false');
    assert.equal(repo.search('临时记录').length, 0, '删除后 FTS 不应命中');

    // 提醒：未到点不弹、到点命中、标记后不重复、改时间重置 reminded_at
    const remindTodo = repo.create({ content: '明天要交的周报', kind: 'todo' });
    const future = Date.now() + 60_000;
    const scheduled = repo.setReminder(remindTodo.id, future);
    assert.equal(scheduled?.remindAt, future);
    assert.equal(scheduled?.remindedAt, null);
    assert.equal(repo.dueReminders(Date.now()).length, 0, '未到点不应命中');

    repo.setReminder(remindTodo.id, Date.now() - 1000);
    const due = repo.dueReminders(Date.now());
    assert.equal(due.length, 1);
    assert.equal(due[0].content, '明天要交的周报');
    repo.markReminded(
      due.map((item) => item.id),
      Date.now(),
    );
    assert.equal(repo.dueReminders(Date.now()).length, 0, '已提醒不应重复命中');

    const rescheduled = repo.setReminder(remindTodo.id, Date.now() + 5000);
    assert.equal(rescheduled?.remindedAt, null, '改提醒时间应重置 reminded_at');
    assert.equal(repo.dueReminders(Date.now()).length, 0);

    // 已完成任务不再提醒
    repo.setReminder(remindTodo.id, Date.now() - 1000);
    repo.setStatus(remindTodo.id, true);
    assert.equal(repo.dueReminders(Date.now()).length, 0, '已完成任务不参与提醒');
    assert.equal(repo.stats(0).pendingReminders, 0, '已完成任务的提醒不计入待提醒统计');

    // 撤销删除：按原 id / 时间 / 状态 / 提醒完整写回
    const undoItem = repo.create({ content: '撤销删除测试', kind: 'todo' });
    repo.setStatus(undoItem.id, true);
    repo.setReminder(undoItem.id, Date.now() + 3_600_000);
    const snapshot = repo.get(undoItem.id);
    assert.ok(snapshot);
    assert.equal(repo.remove(undoItem.id), true);
    assert.equal(repo.get(undoItem.id), null);
    const restoredFromUndo = repo.restore(snapshot);
    assert.equal(restoredFromUndo?.id, snapshot.id);
    assert.equal(restoredFromUndo?.status, 'done');
    assert.equal(restoredFromUndo?.createdAt, snapshot.createdAt);
    assert.equal(restoredFromUndo?.remindAt, snapshot.remindAt);
    assert.equal(repo.search('撤销删除').length, 1, '撤销后 FTS 应重建');
    assert.equal(repo.restore(snapshot)?.id, snapshot.id, '重复撤销应幂等');

    // 导出用全量查询包含所有记录
    assert.ok(repo.allForExport().length > 50);

    // 清空全部记录：返回删除条数，列表/FTS/统计一起归零
    const cleared = repo.clearAll();
    assert.ok(cleared > 50, '应返回被清空的条数');
    assert.equal(repo.list({ filter: 'all', limit: 50 }).length, 0);
    assert.equal(repo.search('风险点').length, 0, '清空后 FTS 不应命中');
    assert.equal(repo.stats(0).pendingReminders, 0);
    assert.equal(repo.clearAll(), 0, '重复清空应返回 0');
  } finally {
    repo.close();
  }

  const repo2 = openRepo(dbPath);
  try {
    assert.equal(repo2.list({ filter: 'all', limit: 50 }).length, 0, '清空结果应持久化');
  } finally {
    repo2.close();
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }
});
