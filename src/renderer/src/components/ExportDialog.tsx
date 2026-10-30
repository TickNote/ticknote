import type { ExportScope, ListFilter } from '../../../shared/types';
import { FILTERS } from '../utils';

export interface ExportDialogProps {
  filter: ListFilter;
  exportScope: ExportScope;
  onChangeScope: (scope: ExportScope) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ExportDialog({ filter, exportScope, onChangeScope, onCancel, onConfirm }: ExportDialogProps) {
  return (
    <div className="modal-mask" onMouseDown={onCancel}>
      <div className="modal-card" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title">导出 Markdown</div>
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
