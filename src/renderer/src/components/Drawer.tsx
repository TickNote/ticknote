import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { CONTENT_LIMIT, type Item, type ItemKind } from '../../../shared/types';
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
  reminderStatus,
} from '../utils';

export interface DrawerProps {
  item: Item;
  index: number;
  total: number;
  width: number;
  editDraft: string;
  saveHint: string;
  customReminder: boolean;
  onResizeStart: (event: MouseEvent) => void;
  onResetWidth: () => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onChangeDraft: (value: string) => void;
  onSave: () => Promise<boolean>;
  onToggleStatus: () => void;
  onChangeKind: (kind: ItemKind) => void;
  onApplyReminder: (remindAt: number | null) => void;
  onToggleCustomReminder: () => void;
  onDelete: () => void;
  onCopy: () => void;
}
export function Drawer(props: DrawerProps) {
  const {
    item,
    index,
    total,
    width,
    editDraft,
    saveHint,
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
    onCopy,
  } = props;
  const editRef = useRef<HTMLTextAreaElement>(null);
  const [customTime, setCustomTime] = useState('');
  const [reminderError, setReminderError] = useState('');
  useEffect(() => {
    if (customReminder) {
      setCustomTime(
        toDateTimeLocal(item.remindAt && item.remindAt > Date.now() ? item.remindAt : Date.now() + 3600000),
      );
      setReminderError('');
    }
  }, [customReminder, item.id, item.remindAt]);
  useEffect(() => {
    const element = editRef.current;
    if (element) {
      element.style.height = 'auto';
      element.style.height = `${Math.max(100, element.scrollHeight)}px`;
    }
  }, [editDraft, item.id]);
  const saveAnd = async (action: () => void) => {
    if (await onSave()) action();
  };
  return (
    <>
      <div
        className="drawer-resizer"
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label="调整详情宽度，回车重置"
        onMouseDown={onResizeStart}
        onDoubleClick={onResetWidth}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onResetWidth();
          }
        }}
      />
      <aside className="drawer" style={{ width, flexBasis: width }} aria-label="记录详情">
        <div className="drawer-head">
          <span className="drawer-title">记录详情</span>
          <div className="drawer-tools">
            <button
              type="button"
              className="icon-btn"
              aria-label="上一条"
              disabled={index <= 0}
              onClick={() => void saveAnd(onPrev)}
            >
              ‹
            </button>
            <span className="drawer-pos">{index >= 0 ? `${index + 1} / ${total}` : '当前记录'}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="下一条"
              disabled={index < 0 || index >= total - 1}
              onClick={() => void saveAnd(onNext)}
            >
              ›
            </button>
            <button
              type="button"
              className="icon-btn close-btn"
              aria-label="关闭详情"
              title="关闭（Esc）"
              onClick={() => void saveAnd(onClose)}
            >
              ×
            </button>
          </div>
        </div>
        <div className="drawer-scroll">
          <div className="meta">
            {kindLabel(item.kind)} · {dayLabel(startOfDay(item.createdAt))} {formatTime(item.createdAt)}
          </div>
          <textarea
            ref={editRef}
            className="body-edit"
            aria-label="编辑记录内容"
            maxLength={CONTENT_LIMIT}
            value={editDraft}
            onChange={(event) => onChangeDraft(event.target.value)}
            onBlur={() => void onSave()}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.stopPropagation();
                void saveAnd(onClose);
              }
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                void onSave();
              }
            }}
            spellCheck={false}
          />
          <div className="edit-hint" role="status">
            {saveHint} · {editDraft.length}/{CONTENT_LIMIT}
          </div>
          {saveHint.includes('失败') && (
            <button type="button" className="btn" onClick={() => void onSave()}>
              重试保存
            </button>
          )}
          {item.kind === 'todo' && (
            <div className="field">
              <span className="k">状态</span>
              <span>{item.status === 'done' ? '已完成' : '未完成'}</span>
            </div>
          )}
          <div className="field">
            <span className="k">类型</span>
            <div className="kind-switch">
              {KINDS.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className={`chip${item.kind === entry.key ? ' on' : ''}`}
                  aria-pressed={item.kind === entry.key}
                  onClick={() => void saveAnd(() => onChangeKind(entry.key))}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="k">提醒</span>
            <span>
              {item.remindAt ? `${reminderStatus(item)} · ${formatRemind(item.remindAt)}` : '未设置'}
            </span>
          </div>
          <div className="remind-chips">
            <button type="button" className="chip" onClick={() => onApplyReminder(Date.now() + 600000)}>
              10 分钟后
            </button>
            <button type="button" className="chip" onClick={() => onApplyReminder(Date.now() + 3600000)}>
              1 小时后
            </button>
            <button type="button" className="chip" onClick={() => onApplyReminder(eveningReminder())}>
              {startOfDay(eveningReminder()) === startOfDay(Date.now()) ? '今天 18:00' : '明天 18:00'}
            </button>
            <button type="button" className="chip" onClick={() => onApplyReminder(tomorrowAt(9))}>
              明天 9:00
            </button>
            <button
              type="button"
              className={`chip${customReminder ? ' on' : ''}`}
              aria-expanded={customReminder}
              onClick={onToggleCustomReminder}
            >
              自定义
            </button>
            {item.remindAt && (
              <button type="button" className="chip" onClick={() => onApplyReminder(null)}>
                清除
              </button>
            )}
          </div>
          {customReminder && (
            <div className="custom-reminder">
              <label htmlFor="reminder-datetime">提醒日期和时间</label>
              <input
                id="reminder-datetime"
                type="datetime-local"
                className="remind-input"
                value={customTime}
                onChange={(event) => {
                  setCustomTime(event.target.value);
                  setReminderError('');
                }}
              />
              <div className="custom-reminder-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    const timestamp = new Date(customTime).getTime();
                    if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
                      setReminderError('请选择未来的完整日期和时间');
                      return;
                    }
                    onApplyReminder(timestamp);
                  }}
                >
                  应用
                </button>
                <button type="button" className="btn" onClick={onToggleCustomReminder}>
                  取消
                </button>
              </div>
              {reminderError && (
                <div className="setting-warn" role="alert">
                  {reminderError}
                </div>
              )}
            </div>
          )}
          <p className="setting-hint">
            提醒依赖应用在托盘运行。退出期间错过的提醒将在下次启动时补发；Windows 勿扰可能静默通知。
          </p>
        </div>
        <div className="actions drawer-actions">
          {item.kind === 'todo' && (
            <button type="button" className="btn primary" onClick={() => void saveAnd(onToggleStatus)}>
              {item.status === 'done' ? '取消完成' : '完成'}
            </button>
          )}
          <button type="button" className="btn" onClick={onCopy}>
            复制
          </button>
          <button type="button" className="btn danger" title="删除后可撤销" onClick={onDelete}>
            删除
          </button>
        </div>
      </aside>
    </>
  );
}
