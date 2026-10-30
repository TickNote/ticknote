import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExportResult, Item } from '../../shared/types';

const pad = (value: number) => String(value).padStart(2, '0');

// 本地日期键：YYYY-MM-DD，导出按创建日期分文件
function dateKey(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeKey(ts: number): string {
  const date = new Date(ts);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toLine(item: Item): string {
  const mark = item.kind === 'todo' ? `- [${item.status === 'done' ? 'x' : ' '}]` : '-';
  // 多行内容续行缩进两格，避免打断 Markdown 列表
  const content = item.content.replace(/\r\n/g, '\n').replace(/\n/g, '\n  ');
  const remind = item.remindAt ? ` · 提醒 ${timeKey(item.remindAt)}` : '';
  return `${mark} ${content}${remind}`;
}

export function exportMarkdown(items: Item[], exportDir: string): ExportResult {
  mkdirSync(exportDir, { recursive: true });

  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = dateKey(item.createdAt);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  const files: string[] = [];
  for (const [date, bucket] of groups) {
    const lines = [`# ${date}`, ''];
    for (const item of bucket) lines.push(toLine(item));
    const file = join(exportDir, `notes-${date}.md`);
    writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
    files.push(file);
  }

  return { dir: exportDir, files, count: items.length };
}
