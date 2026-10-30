import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverPath = resolve(__dirname, '../resources/mcp/server.js');

interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
}

function parse(result: ToolResult): Record<string, unknown> {
  const first = result.content[0];
  if (!first || first.type !== 'text' || !first.text) throw new Error('空响应');
  return JSON.parse(first.text) as Record<string, unknown>;
}

async function startClient(
  env: Record<string, string>,
  command: string = process.execPath,
  extraEnv: Record<string, string> = {},
): Promise<Client> {
  const transport = new StdioClientTransport({
    command,
    args: [serverPath],
    env: { ...process.env, ...env, ...extraEnv } as Record<string, string>,
  });
  const client = new Client({ name: 'ticknote-test', version: '0.0.1' });
  await client.connect(transport);
  return client;
}

async function main() {
  const dir = join(tmpdir(), `ticknote-mcp-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, 'ticknote.db');
  const settingsPath = join(dir, 'settings.json');

  writeFileSync(settingsPath, JSON.stringify({ mcpDeleteEnabled: false }), 'utf8');
  const env = { TICKNOTE_DB: dbPath };

  let client = await startClient(env);
  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((t) => t.name).sort(),
    ['complete_item', 'create_item', 'list_items', 'search_items', 'update_item'],
    '默认不应注册 delete_item',
  );

  const created = parse((await client.callTool({ name: 'create_item', arguments: { content: 'AI 创建的中文记录', kind: 'todo' } })) as ToolResult);
  assert.equal(created.content, 'AI 创建的中文记录');
  assert.equal(created.source, 'ai');
  const id = String(created.id);

  const found = parse((await client.callTool({ name: 'search_items', arguments: { q: '中文记录' } })) as ToolResult);
  assert.equal(found.count, 1);

  const listed = parse((await client.callTool({ name: 'list_items', arguments: { status: 'open' } })) as ToolResult);
  assert.equal(listed.count, 1);

  const updated = parse(
    (await client.callTool({
      name: 'update_item',
      arguments: { id, content: 'AI 更新后的内容', remind_at: new Date(Date.now() + 3_600_000).toISOString() },
    })) as ToolResult,
  );
  assert.equal(updated.content, 'AI 更新后的内容');
  assert.ok(updated.remind_at);

  const completed = parse((await client.callTool({ name: 'complete_item', arguments: { id } })) as ToolResult);
  assert.equal(completed.status, 'done');

  const delAttempt = (await client.callTool({
    name: 'delete_item',
    arguments: { id, confirm: true },
  })) as ToolResult;
  assert.ok(
    delAttempt.isError || /not found|not registered|unknown tool/i.test(delAttempt.content[0]?.text ?? ''),
    'delete_item 关闭时应不可调用',
  );
  await client.close();

  writeFileSync(settingsPath, JSON.stringify({ mcpDeleteEnabled: true }), 'utf8');
  client = await startClient(env);
  const tools2 = await client.listTools();
  assert.ok(tools2.tools.some((t) => t.name === 'delete_item'), '开启后应注册 delete_item');

  const deleted = parse((await client.callTool({ name: 'delete_item', arguments: { id, confirm: true } })) as ToolResult);
  assert.equal(deleted.deleted, true);

  const foundAfter = parse((await client.callTool({ name: 'search_items', arguments: { q: 'AI 更新后的内容' } })) as ToolResult);
  assert.equal(foundAfter.count, 0);

  await client.close();

  // 安装包场景：用 Electron 自带运行时以 Node 模式执行同一份 MCP 单文件
  const electronCli = resolve(__dirname, '../node_modules/electron/dist/electron.exe');
  if (!existsSync(electronCli)) {
    console.warn('[mcp] electron runtime not found, skip electron-runtime check');
  } else {
    client = await startClient(env, electronCli, { ELECTRON_RUN_AS_NODE: '1' });
    const electronTools = await client.listTools();
    assert.equal(electronTools.tools.length, 6, 'Electron 运行时下应注册 6 个工具');
    const viaElectron = parse(
      (await client.callTool({ name: 'create_item', arguments: { content: 'Electron 运行时创建', kind: 'note' } })) as ToolResult,
    );
    assert.equal(viaElectron.content, 'Electron 运行时创建');
    await client.close();
  }

  rmSync(dir, { recursive: true, force: true });
  console.log('mcp tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
