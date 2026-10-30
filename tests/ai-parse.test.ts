import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { test } from 'vitest';
import { parseNote } from '../src/main/ai/parse';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

test('AI 润色：成功解析、请求格式与各种失败降级', async () => {
  let lastBody = '';
  let lastAuth = '';

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const body = await readBody(req);
      lastBody = body;
      lastAuth = String(req.headers.authorization ?? '');

      if (req.url?.includes('/slow')) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      if (req.url?.includes('/bad-kind')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '{"content":"x","kind":"weird"}' } }] }));
        return;
      }
      if (req.url?.includes('/bad-json')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '不是 JSON' } }] }));
        return;
      }
      if (req.url?.includes('/error')) {
        res.writeHead(500);
        res.end('boom');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '{"content":"买牛奶","kind":"todo"}' } }] }));
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server port');
  const base = `http://127.0.0.1:${address.port}/v1`;

  try {
    const ok = await parseNote('记得买牛奶', { baseUrl: base, model: 'test-model', apiKey: 'test-key', timeoutMs: 2000 });
    assert.deepEqual(ok, { content: '买牛奶', kind: 'todo' });
    const sent = JSON.parse(lastBody) as {
      model?: string;
      temperature?: number;
      messages?: Array<{ role: string; content: string }>;
    };
    assert.equal(sent.model, 'test-model');
    assert.equal(sent.temperature, 0);
    assert.equal(sent.messages?.[1]?.content, '记得买牛奶');
    assert.equal(lastAuth, 'Bearer test-key');

    assert.equal(
      await parseNote('坏返回', { baseUrl: `${base}/bad-json`, model: 'm', apiKey: 'k', timeoutMs: 2000 }),
      null,
      '非 JSON 返回应降级',
    );
    assert.equal(
      await parseNote('服务错误', { baseUrl: `${base}/error`, model: 'm', apiKey: 'k', timeoutMs: 2000 }),
      null,
      'HTTP 错误应降级',
    );
    assert.equal(
      await parseNote('超时', { baseUrl: `${base}/slow`, model: 'm', apiKey: 'k', timeoutMs: 100 }),
      null,
      '超时应降级',
    );
    assert.equal(
      await parseNote('类型错误', { baseUrl: `${base}/bad-kind`, model: 'm', apiKey: 'k', timeoutMs: 2000 }),
      null,
      'kind 非法时应降级',
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
