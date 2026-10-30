import type { MouseEvent, ReactNode } from 'react';
import type { Item } from '../../../shared/types';
import { formatRemindTag, formatTime, reminderStatus } from '../utils';

export interface ListItemProps {
  item: Item;
  selected: boolean;
  cursor: boolean;
  highlight: boolean;
  query: string;
  onClick: () => void;
  onToggleStatus: (event: MouseEvent) => void;
  onDelete: () => void;
}

// 把搜索命中的片段包成 <mark>，大小写不敏感、支持多次命中
function renderText(text: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle) return text;

  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let at = lowerText.indexOf(lowerNeedle);

  while (at !== -1) {
    if (at > cursor) nodes.push(text.slice(cursor, at));
    nodes.push(
      <mark key={at} className="hit">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    cursor = at + needle.length;
    at = lowerText.indexOf(lowerNeedle, cursor);
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes.length > 0 ? nodes : text;
}

export function ListItem({
  item,
  selected,
  cursor,
  highlight,
  query,
  onClick,
  onToggleStatus,
  onDelete,
}: ListItemProps) {
  return (
    <div
      className={`row${selected ? ' selected' : ''}${cursor ? ' cursor' : ''}${highlight ? ' highlight' : ''}`}
      data-item-id={item.id}
      role="group"
      aria-label={`${item.kind === 'todo' ? '待办' : '便签'}：${item.content}`}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          event.stopPropagation();
          onClick();
        }
      }}
    >
      {item.kind === 'todo' ? (
        <input
          type="checkbox"
          className="check"
          checked={item.status === 'done'}
          aria-label={`${item.status === 'done' ? '取消完成' : '完成'}：${item.content}`}
          onChange={() => void 0}
          onClick={(event) => onToggleStatus(event)}
        />
      ) : (
        <span className="type-icon" title="便签" aria-label="便签">
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <rect x="2" y="3" width="10" height="8" rx="2" fill="none" stroke="currentColor" />
            <path d="M4.5 6h5M4.5 8.5h3.5" stroke="currentColor" strokeWidth="1" fill="none" />
          </svg>
        </span>
      )}
      <span className={`text${item.status === 'done' ? ' done' : ''}`}>
        {renderText(item.content, query)}
      </span>
      {item.source === 'ai' ? <span className="tag">AI</span> : null}
      {item.remindAt ? (
        <span
          className={`tag remind-tag${
            item.status === 'open' && !item.remindedAt && item.remindAt < Date.now() ? ' overdue' : ''
          }`}
          title={
            item.status === 'open' && !item.remindedAt && item.remindAt < Date.now()
              ? '提醒时间已过，点开详情可改时间'
              : undefined
          }
        >
          {`${reminderStatus(item)} · ${formatRemindTag(item.remindAt).replace(/^提醒 /, '')}`}
        </span>
      ) : null}
      <span className="time">{formatTime(item.createdAt)}</span>
      <button
        type="button"
        className="row-delete"
        title="删除"
        aria-label="删除这条记录"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        ×
      </button>
    </div>
  );
}
