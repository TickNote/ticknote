import type { AiParseResult } from '../../shared/types';

export interface AiConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
}

// 只做“整理措辞 + 判定便签/待办”，不解析日期；失败返回 null，由调用方按原文保存
export async function parseNote(content: string, config: AiConfig): Promise<AiParseResult | null> {
  const base = config.baseUrl.replace(/\/+$/, '');
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '你是速记整理助手。只整理措辞并判断是待办还是便签，不解析也不改日期。严格返回 JSON：{"content":"整理后的文本","kind":"todo" 或 "note"}。',
          },
          { role: 'user', content },
        ],
      }),
      signal: AbortSignal.timeout(config.timeoutMs ?? 3000),
    });
    if (!response.ok) return null;

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { content?: unknown; kind?: unknown };
    if (typeof parsed.content !== 'string' || !parsed.content.trim()) return null;
    if (parsed.kind !== 'todo' && parsed.kind !== 'note') return null;
    return { content: parsed.content.trim().slice(0, 2000), kind: parsed.kind };
  } catch (error) {
    console.error('[ai] parse failed', error);
    return null;
  }
}
