import { z } from 'zod';
import { CONTENT_LIMIT } from './types';

const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);
export const itemSchema = z.object({
  id: z.string().uuid(),
  content: z.string().min(1).max(CONTENT_LIMIT),
  kind: z.enum(['note', 'todo']),
  status: z.enum(['open', 'done']),
  remindAt: timestamp.nullable(),
  remindedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  completedAt: timestamp.nullable(),
  source: z.enum(['human', 'ai']),
});
export const backupSchema = z.object({
  format: z.literal('ticknote-backup'),
  version: z.literal(1),
  exportedAt: z.string(),
  items: z.array(itemSchema).max(100000),
});
