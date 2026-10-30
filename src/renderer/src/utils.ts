import type { Item, ItemKind, ListFilter, ThemePreference } from '../../shared/types';

export const PAGE = 30;

export const FILTERS: Array<{ key: ListFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '待办' },
  { key: 'note', label: '便签' },
  { key: 'done', label: '已完成' },
  { key: 'reminders', label: '提醒' },
];

export const KINDS: Array<{ key: ItemKind; label: string }> = [
  { key: 'todo', label: '待办' },
  { key: 'note', label: '便签' },
];

export const THEMES: Array<{ key: ThemePreference; label: string; title: string }> = [
  { key: 'system', label: '跟随', title: '跟随系统外观' },
  { key: 'light', label: '浅色', title: '浅色外观' },
  { key: 'dark', label: '深色', title: '深色外观' },
];

const pad = (value: number) => String(value).padStart(2, '0');

export function formatTime(ts: number): string {
  const date = new Date(ts);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function startOfDay(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function dayLabel(key: number): string {
  const today = startOfDay(Date.now());
  if (key === today) return '今天';
  if (key === today - 86_400_000) return '昨天';
  const date = new Date(key);
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatRemind(ts: number): string {
  const today = startOfDay(Date.now());
  const key = startOfDay(ts);
  if (key === today) return `今天 ${formatTime(ts)}`;
  if (key === today + 86_400_000) return `明天 ${formatTime(ts)}`;
  return `${dayLabel(key)} ${formatTime(ts)}`;
}

export function todayAt(hour: number, minute = 0): number {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

export function tomorrowAt(hour: number, minute = 0): number {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

// “今天 18:00” 已过点则顺延到明天，避免设下去立刻弹通知
export function eveningReminder(): number {
  const ts = todayAt(18);
  return ts > Date.now() ? ts : tomorrowAt(18);
}

export function toDateTimeLocal(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 列表里的提醒标记：今天只显示时间，跨天补“明天 / MM-DD”
export function formatRemindTag(ts: number): string {
  const today = startOfDay(Date.now());
  const key = startOfDay(ts);
  if (key === today) return `提醒 ${formatTime(ts)}`;
  if (key === today + 86_400_000) return `提醒 明天 ${formatTime(ts)}`;
  return `提醒 ${dayLabel(key)} ${formatTime(ts)}`;
}

export function reminderStatus(item: Item): string {
  if (item.status === 'done') return '已完成';
  if (item.remindedAt)
    return item.remindAt && item.remindedAt - item.remindAt > 60000 ? '已补提醒' : '已提醒';
  return item.remindAt && item.remindAt <= Date.now() ? '待补提醒' : '待提醒';
}

const SPECIAL_KEYS: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Enter: 'Return',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '-': 'Minus',
  '+': 'Plus',
  ';': 'Semicolon',
  "'": 'Quote',
};

// 把键盘事件转成 Electron accelerator；裸普通键不允许，避免误触
export function acceleratorFromEvent(event: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return null;
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push('Control');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Super');

  let main = SPECIAL_KEYS[event.key];
  if (!main && /^[a-zA-Z0-9]$/.test(event.key)) main = event.key.toUpperCase();
  if (!main && /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.key)) main = event.key;
  if (!main) return null;
  if (modifiers.length === 0 && !main.startsWith('F')) return null;
  return [...modifiers, main].join('+');
}

export interface Group {
  key: number;
  label: string;
  items: Item[];
}

export function groupByDay(items: Item[]): Group[] {
  const groups: Group[] = [];
  for (const item of items) {
    const key = startOfDay(item.createdAt);
    let group = groups.find((entry) => entry.key === key);
    if (!group) {
      group = { key, label: dayLabel(key), items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

export function kindLabel(kind: ItemKind): string {
  return kind === 'todo' ? '待办' : '便签';
}
