import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ItemKind } from '../../shared/types';
import { api } from './api';
import './styles.css';

const KINDS: Array<{ key: ItemKind; label: string }> = [
  { key: 'todo', label: '待办' },
  { key: 'note', label: '便签' },
];

const pad = (value: number) => String(value).padStart(2, '0');

function Capture() {
  const [value, setValue] = useState('');
  const [kind, setKind] = useState<ItemKind>('todo');
  const [toast, setToast] = useState('');
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiUndo, setAiUndo] = useState<{ content: string; kind: ItemKind } | null>(null);
  const [aiFailed, setAiFailed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hideTimer = useRef<number | null>(null);
  const shownAt = useRef(Date.now());

  const refreshAiEnabled = () => {
    void api.getSettings().then((settings) => setAiEnabled(settings.aiEnabled));
  };

  useEffect(() => {
    const unsubscribe = api.onCaptureShown(() => {
      shownAt.current = Date.now();
      setValue('');
      setKind('todo');
      setToast('');
      setAiUndo(null);
      setAiFailed(false);
      refreshAiEnabled();
      requestAnimationFrame(() => textareaRef.current?.focus());
    });
    refreshAiEnabled();
    requestAnimationFrame(() => textareaRef.current?.focus());
    return unsubscribe;
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const next = Math.min(textarea.scrollHeight, 96);
    textarea.style.height = `${next}px`;
    // 16(页面 padding) + 24(卡片 padding) + 18(拖动条) + 16(两处 gap) + 24(foot) + 22(输入框 padding/边框)
    api.resizeCapture(120 + next);
  }, [value]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') api.hideCapture();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const finish = () => {
    setValue('');
    setAiUndo(null);
    setAiFailed(false);
    const now = new Date();
    setToast(`已记录 ${pad(now.getHours())}:${pad(now.getMinutes())}`);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setToast('');
      api.hideCapture();
      hideTimer.current = null;
    }, 900);
  };

  const submit = async () => {
    const content = value.trim();
    if (!content) return;
    await api.createItem({ content, kind });
    finish();
  };

  // AI 只负责润色并回显，用户按 Enter 才真正记录；保留原文可撤销
  const runAi = async () => {
    const content = value.trim();
    if (!content || aiBusy) return;
    setAiBusy(true);
    try {
      const result = await api.aiParse(content);
      if (result) {
        setAiUndo({ content, kind });
        setAiFailed(false);
        setValue(result.content);
        setKind(result.kind);
        setToast('AI 已润色 · Enter 保存');
      } else {
        setAiFailed(true);
        setToast('AI 润色失败，已保留原文');
      }
      requestAnimationFrame(() => textareaRef.current?.focus());
    } finally {
      setAiBusy(false);
    }
  };

  const undoAi = () => {
    if (!aiUndo) return;
    setValue(aiUndo.content);
    setKind(aiUndo.kind);
    setAiUndo(null);
    setAiFailed(false);
    setToast('已撤销润色');
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div className="capture-body">
      <div className="capture">
        {/* 无边框窗口的拖动条；除关闭按钮外都可拖动 */}
        <div className="capture-drag">
          <span className="capture-grip" aria-hidden="true">
            ⠿
          </span>
          <button
            type="button"
            className="capture-close"
            aria-label="关闭浮窗"
            title="关闭（Esc）"
            onClick={() => api.hideCapture()}
          >
            ×
          </button>
        </div>
        <div className="capture-box">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              // 热键的最后一个空格可能漏进刚聚焦的输入框，前 200ms 内丢弃
              if (event.key === ' ' && Date.now() - shownAt.current < 200) {
                event.preventDefault();
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="记点什么…"
            spellCheck={false}
          />
        </div>
        <div className="capture-foot">
          <div className="chips">
            {KINDS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={`chip${kind === entry.key ? ' on' : ''}`}
                onClick={() => setKind(entry.key)}
              >
                {entry.label}
              </button>
            ))}
            {aiEnabled ? (
              <button
                type="button"
                className="chip ai-chip"
                disabled={aiBusy || !value.trim()}
                title="用 AI 润色措辞并判定类型；失败时保留原文"
                onClick={() => void runAi()}
              >
                {aiBusy ? '润色中…' : aiFailed ? '重试润色' : 'AI 润色'}
              </button>
            ) : null}
            {aiUndo ? (
              <button type="button" className="chip" onClick={undoAi}>
                撤销润色
              </button>
            ) : null}
          </div>
          <span className="capture-hint">Enter 记录 · Esc 取消</span>
        </div>
        {toast ? <span className="capture-toast">{toast}</span> : null}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Capture />);
