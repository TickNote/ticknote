import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CONTENT_LIMIT, type ItemKind } from '../../shared/types';
import { api } from './api';
import { errorMessage, useDraft } from './hooks';
import { KINDS } from './utils';
import './styles.css';

function Capture() {
  const draft = useDraft('ticknote.draft.capture');
  const [toast, setToast] = useState('');
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [aiUndo, setAiUndo] = useState<{ text: string; kind: ItemKind } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hideTimer = useRef<number | null>(null);
  const shownAt = useRef(Date.now());
  const submitLock = useRef(false);
  const aiLock = useRef(false);
  const cancelHide = useCallback(() => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, []);
  const cancel = useCallback(() => {
    cancelHide();
    draft.change('');
    setAiUndo(null);
    setToast('');
    api.hideCapture();
  }, [cancelHide, draft.change]);

  useEffect(() => {
    const refresh = () => {
      cancelHide();
      shownAt.current = Date.now();
      draft.version.current++;
      setToast('');
      void api
        .getSettings()
        .then((value) => setAiEnabled(value.aiEnabled))
        .catch(() => setAiEnabled(false));
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    const unsubscribe = api.onCaptureShown(refresh);
    const onBlur = () => {
      draft.version.current++;
      cancelHide();
    };
    window.addEventListener('blur', onBlur);
    refresh();
    return () => {
      unsubscribe();
      cancelHide();
      window.removeEventListener('blur', onBlur);
    };
  }, [cancelHide, draft.version]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    const next = Math.min(textarea.scrollHeight, 96);
    textarea.style.height = `${next}px`;
    api.resizeCapture(202 + next);
  }, [draft.text]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancel]);

  const submit = async () => {
    const content = draft.text.trim();
    if (!content || submitLock.current) return;
    if (content.length > CONTENT_LIMIT) {
      setToast(`最多 ${CONTENT_LIMIT} 字，请缩短内容`);
      return;
    }
    submitLock.current = true;
    setSending(true);
    cancelHide();
    const version = ++draft.version.current;
    const submittedKind = draft.kind;
    try {
      await api.createItem({ content, kind: submittedKind });
      if (draft.version.current === version) {
        draft.change('');
        setAiUndo(null);
        setToast('已记录');
        const savedVersion = draft.version.current;
        hideTimer.current = window.setTimeout(() => {
          if (draft.version.current === savedVersion) api.hideCapture();
          hideTimer.current = null;
        }, 450);
      } else setToast('上一条已记录，当前草稿已保留');
    } catch (error) {
      setToast(errorMessage(error, '记录失败，草稿已保留，请重试'));
    } finally {
      submitLock.current = false;
      setSending(false);
    }
  };

  const runAi = async () => {
    if (!draft.text.trim() || aiLock.current || draft.text.length > CONTENT_LIMIT) return;
    aiLock.current = true;
    setAiBusy(true);
    const version = draft.version.current;
    const original = { ...draft.current.current };
    try {
      const result = await api.aiParse(original.text.trim());
      if (draft.version.current !== version) return;
      if (result) {
        draft.change(result.content, result.kind);
        setAiUndo(original);
        setToast('AI 已润色 · Enter 记录');
      } else setToast('润色失败，原文已保留，可重试');
    } catch (error) {
      if (draft.version.current === version) setToast(errorMessage(error, '润色失败，原文已保留'));
    } finally {
      aiLock.current = false;
      setAiBusy(false);
    }
  };

  return (
    <div className="capture-body">
      <div className="capture">
        <div className="capture-drag">
          <span className="capture-grip" aria-hidden="true">
            ⠿
          </span>
          <button
            type="button"
            className="capture-close"
            aria-label="收起并保留草稿"
            title="收起并保留草稿"
            onClick={() => {
              cancelHide();
              draft.version.current++;
              api.hideCapture();
            }}
          >
            ×
          </button>
        </div>
        <div className="capture-box">
          <textarea
            ref={textareaRef}
            value={draft.text}
            aria-label="速记内容"
            maxLength={CONTENT_LIMIT}
            onChange={(event) => {
              cancelHide();
              draft.changeText(event.target.value);
              setToast('');
              setAiUndo(null);
            }}
            onKeyDown={(event) => {
              if (event.key === ' ' && Date.now() - shownAt.current < 200) {
                event.preventDefault();
                return;
              }
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              ) {
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
                className={`chip${draft.kind === entry.key ? ' on' : ''}`}
                aria-pressed={draft.kind === entry.key}
                onClick={() => {
                  cancelHide();
                  draft.changeKind(entry.key);
                }}
              >
                {entry.label}
              </button>
            ))}
            {aiEnabled && (
              <button
                type="button"
                className="chip ai-chip"
                disabled={aiBusy || sending || !draft.text.trim()}
                aria-busy={aiBusy}
                onClick={() => void runAi()}
              >
                {aiBusy ? '润色中…' : 'AI 润色'}
              </button>
            )}
            {aiUndo && (
              <button
                type="button"
                className="chip"
                onClick={() => {
                  draft.change(aiUndo.text, aiUndo.kind);
                  setAiUndo(null);
                  setToast('已撤销润色');
                }}
              >
                撤销润色
              </button>
            )}
          </div>
          <button
            type="button"
            className="send"
            disabled={sending || !draft.text.trim()}
            onClick={() => void submit()}
          >
            {sending ? '记录中…' : '记录'}
          </button>
        </div>
        <div className="capture-status" role="status">
          {toast ||
            (draft.storageFailed
              ? '草稿暂未备份，请及时记录'
              : `Enter 记录 · Shift+Enter 换行 · Esc 丢弃草稿 · ${draft.text.length}/${CONTENT_LIMIT}`)}
        </div>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Capture />);
