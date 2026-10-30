import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { Item, ItemKind, ItemStatus, Settings } from '../shared/types';
import { openRepo } from '../main/db/repo';

// MCP 子进程不依赖 App 运行：自己解析数据库路径（兼容更名前的旧目录与旧文件名）
function resolveDbPath(): string {
  const explicit = process.env['TICKNOTE_DB'];
  if (explicit) return explicit;
  const dataDir = process.env['TICKNOTE_DATA'] ?? process.env['QUICKNOTE_DATA'];
  if (dataDir) {
    const current = join(dataDir, 'ticknote.db');
    const old = join(dataDir, 'quicknote.db');
    return existsSync(current) || !existsSync(old) ? current : old;
  }
  const appData = process.env['APPDATA'];
  if (appData) {
    const current = join(appData, 'TickNote', 'ticknote.db');
    const sameDirOld = join(appData, 'TickNote', 'quicknote.db');
    const legacyDir = join(appData, 'QuickNote', 'quicknote.db');
    if (existsSync(current)) return current;
    if (existsSync(sameDirOld)) return sameDirOld;
    if (existsSync(legacyDir)) return legacyDir;
    return current;
  }
  return join(homedir(), '.ticknote', 'ticknote.db');
}

function readDeleteEnabled(settingsPath: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(settingsPath, 'utf8')) as Partial<Settings>;
    return raw.mcpDeleteEnabled === true;
  } catch {
    return false;
  }
}

const dbPath = resolveDbPath();
const settingsPath = join(dirname(dbPath), 'settings.json');
const repo = openRepo(dbPath);
const deleteEnabled = readDeleteEnabled(settingsPath);

const server = new McpServer({ name: 'ticknote', version: '0.1.0' });

const iso = (ts: number | null): string | null => (ts === null ? null : new Date(ts).toISOString());

function serialize(item: Item) {
  return {
    id: item.id,
    content: item.content,
    kind: item.kind,
    status: item.status,
    created_at: iso(item.createdAt),
    updated_at: iso(item.updatedAt),
    remind_at: iso(item.remindAt),
    source: item.source,
  };
}

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

function parseIso(value: string): number {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) throw new Error(`无效时间格式：${value}，请使用 ISO 8601`);
  return ts;
}

server.registerTool(
  'search_items',
  {
    title: '搜索记录',
    description: '按关键词全文检索记录（FTS5 trigram，中文 ≥2 字符）',
    inputSchema: {
      q: z.string().min(1).max(200),
      limit: z.number().int().min(1).max(50).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  ({ q, limit }) => {
    const items = repo.search(q, limit ?? 20);
    return ok({ count: items.length, items: items.map(serialize) });
  },
);

server.registerTool(
  'list_items',
  {
    title: '列出记录',
    description: '按创建时间范围、状态与类型列出记录，倒序返回',
    inputSchema: {
      from: z.string().optional(),
      to: z.string().optional(),
      status: z.enum(['open', 'done']).optional(),
      kind: z.enum(['note', 'todo']).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  ({ from, to, status, kind, limit }) => {
    try {
      const items = repo.listRange({
        from: from ? parseIso(from) : undefined,
        to: to ? parseIso(to) : undefined,
        status: status as ItemStatus | undefined,
        kind: kind as ItemKind | undefined,
        limit: limit ?? 20,
      });
      return ok({ count: items.length, items: items.map(serialize) });
    } catch (error) {
      return fail((error as Error).message);
    }
  },
);

server.registerTool(
  'create_item',
  {
    title: '创建记录',
    description: '新建一条便签或待办，来源标记为 AI',
    inputSchema: {
      content: z.string().min(1).max(2000),
      kind: z.enum(['note', 'todo']).optional(),
      remind_at: z.string().optional(),
    },
  },
  ({ content, kind, remind_at }) => {
    try {
      const aiRunId = randomUUID();
      const item = repo.create(
        { content, kind: (kind as ItemKind | undefined) ?? 'todo', source: 'ai' },
        'ai',
        aiRunId,
      );
      if (remind_at) repo.setReminder(item.id, parseIso(remind_at));
      return ok(serialize(repo.get(item.id) ?? item));
    } catch (error) {
      return fail((error as Error).message);
    }
  },
);

server.registerTool(
  'update_item',
  {
    title: '更新记录',
    description: '局部更新内容、类型、状态或提醒时间',
    inputSchema: {
      id: z.string().min(1),
      content: z.string().min(1).max(2000).optional(),
      kind: z.enum(['note', 'todo']).optional(),
      status: z.enum(['open', 'done']).optional(),
      remind_at: z.string().nullable().optional(),
    },
  },
  ({ id, content, kind, status, remind_at }) => {
    try {
      const patch: {
        content?: string;
        kind?: ItemKind;
        status?: ItemStatus;
        remindAt?: number | null;
      } = {};
      if (content !== undefined) patch.content = content;
      if (kind !== undefined) patch.kind = kind as ItemKind;
      if (status !== undefined) patch.status = status as ItemStatus;
      if (remind_at !== undefined) patch.remindAt = remind_at === null ? null : parseIso(remind_at);

      const item = repo.update(id, patch);
      if (!item) return fail('记录不存在');
      return ok(serialize(item));
    } catch (error) {
      return fail((error as Error).message);
    }
  },
);

server.registerTool(
  'complete_item',
  {
    title: '完成记录',
    description: '把一条待办标记为已完成',
    inputSchema: { id: z.string().min(1) },
  },
  ({ id }) => {
    const item = repo.setStatus(id, true);
    if (!item) return fail('记录不存在');
    return ok(serialize(item));
  },
);

// 默认不注册；设置里开启「MCP 删除工具」后重启应用才生效
if (deleteEnabled) {
  server.registerTool(
    'delete_item',
    {
      title: '删除记录',
      description: '按 id 硬删除一条记录，必须传 confirm: true（无回收站）',
      inputSchema: { id: z.string().min(1), confirm: z.literal(true) },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ id }) => {
      const removed = repo.remove(id);
      if (!removed) return fail('记录不存在');
      return ok({ deleted: true, id });
    },
  );
}

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
  console.error(`[mcp] ticknote server ready, db=${dbPath}, delete=${deleteEnabled}`);
}

process.on('SIGINT', () => {
  void server.close().finally(() => {
    repo.close();
    process.exit(0);
  });
});

main().catch((error) => {
  console.error('[mcp] failed to start', error);
  process.exit(1);
});
