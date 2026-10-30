import { useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import type { Item, ItemKind } from '../../../shared/types';
import {
  KINDS,
  dayLabel,
  eveningReminder,
  formatRemind,
  formatTime,
  kindLabel,
  startOfDay,
  toDateTimeLocal,
  tomorrowAt,
} from '../utils';

export interface DrawerProps {
  item: Item;
  index: number;
  total: number;
  width: number;
  editDraft: string;
  deleteArmed: boolean;
  customReminder: boolean;
  onResizeStart: (event: MouseEvent) => void;
  onResetWidth: () => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onChangeDraft: (value: string) => void;
  onSave: () => Promise<void>;
  onToggleStatus: () => void;
  onChangeKind: (kind: ItemKind) => void;
  onApplyReminder: (remindAt: number | null) => void;
  onToggleCustomReminder: () => void;
  onDelete: () => void;
}

export function Drawer({
  item,
  index,
  total,
  width,
  editDraft,
  deleteArmed,
  customReminder,
  onResizeStart,
  onResetWidth,
  onPrev,
  onNext,
  onClose,
  onChangeDraft,
  onSave,
  onToggleStatus,
  onChangeKind,
  onApplyReminder,
  onToggleCustomReminder,
  onDelete,
}: DrawerProps) {
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = editRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.max(80, element.scrollHeight)}px`;
  }, [editDraft, item.id]);

  return (
    <>
      <div
        className="drawer-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整详情宽度"
        onMouseDown={onResizeStart}
        onDoubleClick={onResetWidth}
      />
      <aside className="drawer" style={{ width, flexBasis: width }}>
        <div className="drawer-head">
          <span className="drawer-title">记录详情</span>
          <div className="drawer-tools">
            <button
              type="button"
              className="icon-btn"
              aria-label="上一条"
              title="上一条"
              disabled={index <= 0}
              onClick={onPrev}
            >
              ‹
            </button>
            <span className="drawer-pos">{`${index + 1} / ${total}`}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="下一条"
              title="下一条"
              disabled={index >= total - 1}
              onClick={onNext}
            >
              ›
            </button>
            <button
              type="button"
              className="icon-btn close-btn"
              aria-label="关闭详情"
              title="关闭（Esc）"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>
        <div className="meta">
          {kindLabel(item.kind)} · {dayLabel(startOfDay(item.createdAt))} {formatTime(item.createdAt)}
        </div>
        <textarea
          ref={editRef}
          className="body-edit"
          value={editDraft}
          onChange={(event) => onChangeDraft(event.target.value)}
          onBlur={() => void onSave()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              void onSave().finally(onClose);
            }
          }}
          placeholder="记录内容"
          spellCheck={false}
        />
        <div className="edit-hint">失焦自动保存</div>
        {item.kind === 'todo' ? (
          <div className="field">
            <span className="k">状态</span>
            <span>{item.status === 'done' ? '已完成' : '未完成'}</span>
          </div>
        ) : null}
        <div className="field">
          <span className="k">类型</span>
          <div className="kind-switch">
            {KINDS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={`chip${item.kind === entry.key ? ' on' : ''}`}
                title={`改为${entry.label}`}
                onClick={() => onChangeKind(entry.key)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="k">提醒</span>
          <span>{item.remindAt ? formatRemind(item.remindAt) : '未设置'}</span>
        </div>
        <div className="remind-chips">
          <button type="button" className="chip" onClick={() => onApplyReminder(eveningReminder())}>
            今天18:00
          </button>
          <button type="button" className="chip" onClick={() => onApplyReminder(tomorrowAt(9))}>
            明天9:00
          </button>
          <button
            type="button"
            className={`chip${customReminder ? ' on' : ''}`}
            onClick={onToggleCustomReminder}
          >
            自定义
          </button>
          {item.remindAt ? (
            <button type="button" className="chip" onClick={() => onApplyReminder(null)}>
              清除
            </button>
          ) : null}
        </div>
        {customReminder ? (
          <input
            type="datetime-local"
            className="remind-input"
            defaultValue={toDateTimeLocal(item.remindAt ?? Date.now() + 3_600_000)}
            onChange={(event) => {
              const ts = new Date(event.target.value).getTime();
              if (Number.isFinite(ts)) onApplyReminder(ts);
            }}
          />
        ) : null}
        <div className="actions">
          {item.kind === 'todo' ? (
            <button type="button" className="btn" onClick={onToggleStatus}>
              {item.status === 'done' ? '取消完成' : '完成'}
            </button>
          ) : null}
          <button type="button" className="btn" onClick={() => void navigator.clipboard.writeText(item.content)}>
            复制
          </button>
          <button type="button" className={`btn${deleteArmed ? ' danger' : ''}`} onClick={onDelete}>
            {deleteArmed ? '确认删除？' : '删除'}
          </button>
        </div>
      </aside>
    </>
  );
}
