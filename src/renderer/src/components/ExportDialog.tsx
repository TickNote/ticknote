import type { ExportScope, ListFilter } from '../../../shared/types';
import { FILTERS } from '../utils';
import { useRef } from 'react';
import { useDialogFocus } from '../hooks';

export interface ExportDialogProps {
  filter: ListFilter;
  exportScope: ExportScope;
  onChangeScope: (scope: ExportScope) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ExportDialog({ filter, exportScope, onChangeScope, onCancel, onConfirm }: ExportDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef);
  return (
    <div className="modal-mask" onClick={onCancel}>
      <div
        className="modal-card"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-title" id="export-title">
          导出 Markdown
        </div>
        <label className="radio-row">
          <input
            type="radio"
            name="export-scope"
            checked={exportScope === 'all'}
            onChange={() => onChangeScope('all')}
          />
          <span>全部记录</span>
        </label>
        {filter !== 'all' ? (
          <label className="radio-row">
            <input
              type="radio"
              name="export-scope"
              checked={exportScope === filter}
              onChange={() => onChangeScope(filter as ExportScope)}
            />
            <span>当前筛选（{FILTERS.find((entry) => entry.key === filter)?.label}）</span>
          </label>
        ) : null}
        <label className="radio-row">
          <input
            type="radio"
            name="export-scope"
            checked={exportScope === 'today'}
            onChange={() => onChangeScope('today')}
          />
          <span>仅今天</span>
        </label>
        <div className="modal-hint">
          选择目录后会新建独立文件夹，不覆盖之前的导出。需要可恢复备份，请到设置 → 数据管理。
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={onConfirm}>
            导出
          </button>
        </div>
      </div>
    </div>
  );
}
