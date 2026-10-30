import type { MouseEvent } from 'react';
import type { Item } from '../../../shared/types';
import { formatRemindTag, formatTime } from '../utils';

export interface ListItemProps {
  item: Item;
  selected: boolean;
  cursor: boolean;
  highlight: boolean;
  onClick: () => void;
  onToggleStatus: (event: MouseEvent) => void;
}

export function ListItem({ item, selected, cursor, highlight, onClick, onToggleStatus }: ListItemProps) {
  return (
    <div
      className={`row${selected ? ' selected' : ''}${cursor ? ' cursor' : ''}${highlight ? ' highlight' : ''}`}
      onClick={onClick}
    >
      {item.kind === 'todo' ? (
        <input
          type="checkbox"
          className="check"
          checked={item.status === 'done'}
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
      <span className={`text${item.status === 'done' ? ' done' : ''}`}>{item.content}</span>
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
          {formatRemindTag(item.remindAt)}
        </span>
      ) : null}
      <span className="time">{formatTime(item.createdAt)}</span>
    </div>
  );
}
