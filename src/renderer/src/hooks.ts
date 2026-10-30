import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { ItemKind } from '../../shared/types';

export function errorMessage(error: unknown, fallback = '操作失败，请重试'): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
  return /\b(zod|invalid_type|too_big|too_small)\b/i.test(message) ? fallback : message;
}

export function useDraft(key: string) {
  const [draft, setDraft] = useState<{ text: string; kind: ItemKind }>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (stored && typeof stored.text === 'string' && ['todo', 'note'].includes(stored.kind)) return stored;
    } catch {
      /* Start with an empty draft if storage is unavailable. */
    }
    return { text: '', kind: 'todo' };
  });
  const version = useRef(0);
  const current = useRef(draft);
  const [storageFailed, setStorageFailed] = useState(false);
  const change = useCallback(
    (text: string, kind: ItemKind = current.current.kind) => {
      version.current++;
      const next = { text, kind };
      current.current = next;
      setDraft(next);
      try {
        if (text) localStorage.setItem(key, JSON.stringify(next));
        else localStorage.removeItem(key);
        setStorageFailed(false);
      } catch {
        setStorageFailed(true);
      }
    },
    [key],
  );
  return {
    ...draft,
    version,
    current,
    change,
    storageFailed,
    changeText: (text: string) => change(text),
    changeKind: (kind: ItemKind) => change(current.current.text, kind),
  };
}

export function useDialogFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    if (!panel) return;
    const focusable = () =>
      [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ),
      ].filter((element) => element.getClientRects().length > 0);
    (focusable()[0] ?? panel).focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first) {
        event.preventDefault();
        panel.focus();
        return;
      }
      if (!panel.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [ref]);
}
