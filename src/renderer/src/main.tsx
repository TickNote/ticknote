import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { MouseEvent } from 'react';
import type {
  AutostartStatus,
  ExportScope,
  Item,
  ItemKind,
  ListFilter,
  Settings,
  SettingsPatch,
  ThemePreference,
} from '../../shared/types';
import { api } from './api';
import { Drawer } from './components/Drawer';
import { ExportDialog } from './components/ExportDialog';
import { ListItem } from './components/ListItem';
import { SettingsPanel } from './components/SettingsPanel';
import { Toast, type ToastAction } from './components/Toast';
import { TopBar } from './components/TopBar';
import { FILTERS, KINDS, PAGE, acceleratorFromEvent, formatRemind, groupByDay, kindLabel } from './utils';
import './styles.css';

export function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<ListFilter>('all');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Item[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState<ItemKind>('todo');
  const [sending, setSending] = useState(false);
  const [stats, setStats] = useState({ todayOpenTodos: 0, pendingReminders: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [theme, setThemeState] = useState<ThemePreference>('system');
  const [drawerWidth, setDrawerWidth] = useState(() => {
    const saved = Number(
      window.localStorage.getItem('ticknote.drawerWidth') ?? window.localStorage.getItem('quicknote.drawerWidth'),
    );
    return Number.isFinite(saved) && saved >= 260 ? Math.min(560, saved) : 360;
  });
  const [editDraft, setEditDraft] = useState('');
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [customReminder, setCustomReminder] = useState(false);
  const [toast, setToast] = useState('');
  const [toastAction, setToastAction] = useState<ToastAction | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsData, setSettingsData] = useState<Settings | null>(null);
  const [autostart, setAutostart] = useState<AutostartStatus | null>(null);
  const [recordingHotkey, setRecordingHotkey] = useState(false);
  const [aiBaseUrlDraft, setAiBaseUrlDraft] = useState('');
  const [aiModelDraft, setAiModelDraft] = useState('');
  const [aiKeyDraft, setAiKeyDraft] = useState('');
  const [uninstallArmed, setUninstallArmed] = useState(false);
  const [uninstallHint, setUninstallHint] = useState('');
  const [clearArmed, setClearArmed] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiBusyComposer, setAiBusyComposer] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<ExportScope>('all');
  const [aiUndoText, setAiUndoText] = useState<string | null>(null);
  const [aiFailed, setAiFailed] = useState(false);
  const [collapsedDays, setCollapsedDays] = useState<number[]>(() => {
    try {
      const raw = JSON.parse(window.localStorage.getItem('ticknote.collapsedDays') ?? '[]') as unknown;
      return Array.isArray(raw) ? raw.filter((value): value is number => typeof value === 'number') : [];
    } catch {
      return [];
    }
  });

  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const deleteTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);
  const uninstallTimer = useRef<number | null>(null);
  const clearTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const rows = await api.listItems({ filter, limit: PAGE });
    setItems(rows);
    setHasMore(rows.length === PAGE);
  }, [filter]);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await api.stats());
    } catch {
      // 统计失败不影响主流程
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  useEffect(() => {
    void api.getSettings().then((value) => {
      setThemeState(value.theme);
      setAiEnabled(value.aiEnabled);
    });
  }, []);

  const changeTheme = useCallback(async (next: ThemePreference) => {
    setThemeState(next);
    await api.setTheme(next);
  }, []);

  const startDrawerResize = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = drawerWidth;
      const maxWidth = Math.min(560, Math.max(260, window.innerWidth - 360));
      let current = startWidth;

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (moveEvent: globalThis.MouseEvent) => {
        current = Math.min(maxWidth, Math.max(260, startWidth + (startX - moveEvent.clientX)));
        setDrawerWidth(current);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.localStorage.setItem('ticknote.drawerWidth', String(Math.round(current)));
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [drawerWidth],
  );

  useEffect(() => {
    setSelectedId(null);
    setCursorId(null);
  }, [filter]);

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api.searchItems(text, 50).then((rows) => {
        if (!cancelled) setResults(rows);
      });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, [draft]);

  useEffect(() => {
    const unsubscribe = api.onItemsChanged(() => {
      void load();
      void refreshStats();
    });
    return unsubscribe;
  }, [load, refreshStats]);

  const submit = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const created = await api.createItem({ content, kind });
      setDraft('');
      setAiUndoText(null);
      setAiFailed(false);
      setHighlightId(created.id);
      window.setTimeout(() => setHighlightId(null), 1200);
      const text = query.trim();
      if (text) {
        setResults(await api.searchItems(text, 50));
      } else {
        await load();
      }
      await refreshStats();
      listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      textareaRef.current?.focus();
    } finally {
      setSending(false);
    }
  }, [draft, kind, load, query, refreshStats, sending]);

  const toggleStatus = useCallback(
    async (target: Item, event?: MouseEvent) => {
      event?.stopPropagation();
      const updated = target.status === 'done' ? await api.restoreItem(target.id) : await api.completeItem(target.id);
      if (!updated) return;

      setItems((previous) => {
        if (filter === 'todo' && updated.status === 'done') return previous.filter((item) => item.id !== updated.id);
        if (filter === 'done' && updated.status === 'open') return previous.filter((item) => item.id !== updated.id);
        return previous.map((item) => (item.id === updated.id ? updated : item));
      });
      setResults((previous) =>
        previous ? previous.map((item) => (item.id === updated.id ? updated : item)) : previous,
      );
      await refreshStats();
    },
    [filter, refreshStats],
  );

  const loadMore = useCallback(async () => {
    const last = items[items.length - 1];
    if (!last) return;
    const rows = await api.listItems({ filter, cursor: last.createdAt, limit: PAGE });
    setItems((previous) => [...previous, ...rows]);
    setHasMore(rows.length === PAGE);
  }, [filter, items]);

  const visible = results ?? items;
  const groups = groupByDay(visible);
  const selected = visible.find((item) => item.id === selectedId) ?? null;
  const selectedIndex = selected ? visible.findIndex((item) => item.id === selected.id) : -1;

  const stepSelection = useCallback(
    (delta: number) => {
      if (selectedIndex < 0) return;
      const next = visible[selectedIndex + delta];
      if (next) setSelectedId(next.id);
    },
    [selectedIndex, visible],
  );

  // 键盘：↑↓ 移动选中，Enter 打开抽屉；Esc 按“模态 → 搜索 → 抽屉”顺序退出
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable = Boolean(
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable),
      );

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        textareaRef.current?.focus();
        return;
      }

      if (event.key === 'Escape') {
        if (exportOpen) {
          setExportOpen(false);
          return;
        }
        if (settingsOpen) {
          setSettingsOpen(false);
          setRecordingHotkey(false);
          return;
        }
        if (query.trim()) {
          setQuery('');
          return;
        }
        if (selectedId) {
          setSelectedId(null);
          return;
        }
        if (cursorId) setCursorId(null);
        return;
      }

      if (editable || settingsOpen || exportOpen) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (visible.length === 0) return;
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const current = cursorId ?? selectedId;
        let index = current ? visible.findIndex((item) => item.id === current) : -1;
        if (index < 0) index = delta > 0 ? -1 : visible.length;
        const next = visible[Math.min(visible.length - 1, Math.max(0, index + delta))];
        if (next) setCursorId(next.id);
        return;
      }

      if (event.key === 'Enter' && (cursorId || selectedId)) {
        event.preventDefault();
        setSelectedId(cursorId ?? selectedId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cursorId, exportOpen, query, selectedId, settingsOpen, visible]);

  const toggleGroup = useCallback((key: number) => {
    setCollapsedDays((previous) => {
      const next = previous.includes(key) ? previous.filter((value) => value !== key) : [...previous, key];
      window.localStorage.setItem('ticknote.collapsedDays', JSON.stringify(next));
      return next;
    });
  }, []);

  const showToast = useCallback((text: string, action: ToastAction | null = null, duration = 2600) => {
    setToast(text);
    setToastAction(action);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setToast('');
      setToastAction(null);
    }, duration);
  }, []);

  const updateLocal = useCallback((updated: Item) => {
    setItems((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
    setResults((previous) =>
      previous ? previous.map((item) => (item.id === updated.id ? updated : item)) : previous,
    );
  }, []);

  // 已记录条目可切换待办 / 便签；列表由 items:changed 广播后按当前筛选自动刷新
  const changeKind = useCallback(
    async (next: ItemKind) => {
      if (!selected || selected.kind === next) return;
      const updated = await api.setItemKind(selected.id, next);
      if (!updated) return;
      updateLocal(updated);
      showToast(`已改为${kindLabel(next)}`);
    },
    [selected, showToast, updateLocal],
  );

  // 行内删除 + 5 秒撤销；撤销按原 id / 时间写回
  const restoreDeleted = useCallback(
    async (target: Item) => {
      const restored = await api.restoreDeletedItem(target);
      if (!restored) return;
      await load();
      const text = query.trim();
      if (text) setResults(await api.searchItems(text, 50));
      await refreshStats();
      showToast('已恢复');
    },
    [load, query, refreshStats, showToast],
  );

  const deleteFromList = useCallback(
    async (target: Item) => {
      const removed = await api.deleteItem(target.id);
      if (!removed) return;
      setItems((previous) => previous.filter((item) => item.id !== target.id));
      setResults((previous) => (previous ? previous.filter((item) => item.id !== target.id) : previous));
      if (selectedId === target.id) setSelectedId(null);
      if (cursorId === target.id) setCursorId(null);
      await refreshStats();
      showToast('已删除', { label: '撤销', onClick: () => void restoreDeleted(target) }, 5000);
    },
    [cursorId, refreshStats, restoreDeleted, selectedId, showToast],
  );

  // 抽屉切换选中项时重置编辑内容与删除确认
  useEffect(() => {
    setEditDraft(selected?.content ?? '');
    setDeleteArmed(false);
    setCustomReminder(false);
  }, [selected?.id, selected?.content]);

  useEffect(
    () => () => {
      if (deleteTimer.current) window.clearTimeout(deleteTimer.current);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      if (uninstallTimer.current) window.clearTimeout(uninstallTimer.current);
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
    },
    [],
  );

  // 点击提醒通知后定位到对应记录
  useEffect(() => {
    return api.onItemsFocus((id) => {
      setQuery('');
      setCursorId(id);
      setSelectedId(id);
      void api.getItem(id).then((item) => {
        if (!item) return;
        setItems((previous) =>
          previous.some((entry) => entry.id === item.id)
            ? previous.map((entry) => (entry.id === item.id ? item : entry))
            : [item, ...previous],
        );
        setHighlightId(item.id);
        window.setTimeout(() => setHighlightId(null), 1200);
      });
    });
  }, []);

  const saveContent = useCallback(async () => {
    if (!selected) return;
    const next = editDraft.trim();
    if (!next) {
      setEditDraft(selected.content);
      return;
    }
    if (next === selected.content) return;
    const updated = await api.updateItem(selected.id, next);
    if (updated) {
      updateLocal(updated);
      showToast('已保存');
    }
  }, [editDraft, selected, showToast, updateLocal]);

  const applyReminder = useCallback(
    async (remindAt: number | null) => {
      if (!selected) return;
      const updated = await api.setReminder(selected.id, remindAt);
      if (!updated) return;
      updateLocal(updated);
      setCustomReminder(false);
      showToast(remindAt ? `提醒已设为 ${formatRemind(remindAt)}` : '已清除提醒');
    },
    [selected, showToast, updateLocal],
  );

  const onDelete = useCallback(async () => {
    if (!selected) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      if (deleteTimer.current) window.clearTimeout(deleteTimer.current);
      deleteTimer.current = window.setTimeout(() => setDeleteArmed(false), 3000);
      return;
    }
    const removed = await api.deleteItem(selected.id);
    if (!removed) return;
    setItems((previous) => previous.filter((item) => item.id !== selected.id));
    setResults((previous) =>
      previous ? previous.filter((item) => item.id !== selected.id) : previous,
    );
    setSelectedId(null);
    showToast('已删除');
  }, [deleteArmed, selected, showToast]);

  const doExport = useCallback(
    async (scope: ExportScope = 'all') => {
      try {
        const result = await api.exportMarkdown(scope);
        if (!result) {
          showToast('已取消导出');
          return;
        }
        showToast(`已导出 ${result.count} 条到 ${result.dir}`);
      } catch {
        showToast('导出失败，请重试');
      }
    },
    [showToast],
  );

  const openExportDialog = useCallback(() => {
    setExportScope(filter === 'all' ? 'all' : (filter as ExportScope));
    setExportOpen(true);
  }, [filter]);

  // 主窗 AI 润色：只回显到输入框，用户再按 Enter / 点「记录」才落库；保留原文可撤销
  const runComposerAi = useCallback(async () => {
    const content = draft.trim();
    if (!content || aiBusyComposer) return;
    setAiBusyComposer(true);
    try {
      const result = await api.aiParse(content);
      if (result) {
        setAiUndoText(content);
        setAiFailed(false);
        setDraft(result.content);
        setKind(result.kind);
        showToast('AI 已润色，按 Enter 记录');
        textareaRef.current?.focus();
      } else {
        setAiUndoText(content);
        setAiFailed(true);
        showToast('AI 润色失败，已保留原文');
      }
    } finally {
      setAiBusyComposer(false);
    }
  }, [aiBusyComposer, draft, showToast]);

  const undoComposerAi = useCallback(() => {
    if (aiUndoText === null) return;
    setDraft(aiUndoText);
    setAiUndoText(null);
    setAiFailed(false);
    showToast('已撤销润色');
    textareaRef.current?.focus();
  }, [aiUndoText, showToast]);

  const openSettingsPanel = useCallback(async () => {
    setSettingsOpen(true);
    const [value, auto] = await Promise.all([api.getSettings(), api.getAutostart()]);
    setSettingsData(value);
    setAutostart(auto);
    setAiBaseUrlDraft(value.aiBaseUrl);
    setAiModelDraft(value.aiModel);
    setAiKeyDraft('');
    setUninstallArmed(false);
    setUninstallHint('');
    setClearArmed(false);
  }, []);

  const patchSettings = useCallback(
    async (patch: SettingsPatch) => {
      const value = await api.updateSettings(patch);
      setSettingsData(value);
      setThemeState(value.theme);
      setAiEnabled(value.aiEnabled);
      if (!value.hotkeyRegistered) showToast('快捷键注册失败，可能被其他软件占用');
      return value;
    },
    [showToast],
  );

  const toggleAutostart = useCallback(
    async (enabled: boolean) => {
      const status = await api.setAutostart(enabled);
      setAutostart(status);
      showToast(enabled ? '已开启开机自启' : '已关闭开机自启');
    },
    [showToast],
  );

  const saveAiKey = useCallback(async () => {
    const key = aiKeyDraft.trim();
    if (!key) return;
    await patchSettings({ aiApiKey: key });
    setAiKeyDraft('');
    showToast('API Key 已加密保存');
  }, [aiKeyDraft, patchSettings, showToast]);

  const clearAiKey = useCallback(async () => {
    await patchSettings({ aiApiKey: null });
    showToast('已清除 API Key');
  }, [patchSettings, showToast]);

  // 卸载入口：安装版打开 NSIS 卸载程序，便携版提示直接删目录
  const runUninstall = useCallback(async () => {
    if (!uninstallArmed) {
      setUninstallArmed(true);
      setUninstallHint('');
      if (uninstallTimer.current) window.clearTimeout(uninstallTimer.current);
      uninstallTimer.current = window.setTimeout(() => setUninstallArmed(false), 3000);
      return;
    }
    setUninstallArmed(false);
    setUninstallHint('');
    const result = await api.uninstallApp();
    if (result.available && result.opened) {
      setSettingsOpen(false);
      showToast('已打开卸载程序');
      return;
    }
    if (result.reason === 'dev') {
      setUninstallHint('开发模式下不可用；请用安装版或在开始菜单/系统设置里卸载');
    } else if (result.reason === 'portable') {
      setUninstallHint('便携版没有卸载程序：直接删除解压目录即可，数据仍在 %APPDATA%\\TickNote');
    } else {
      setUninstallHint('打开卸载程序失败，请到系统「设置 → 应用」里卸载');
    }
  }, [showToast, uninstallArmed]);

  // 清空全部记录：二次确认，确认后列表、选中与统计一起刷新
  const clearAllRecords = useCallback(async () => {
    if (!clearArmed) {
      setClearArmed(true);
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
      clearTimer.current = window.setTimeout(() => setClearArmed(false), 3000);
      return;
    }
    setClearArmed(false);
    const removed = await api.clearAllItems();
    setItems([]);
    setResults(null);
    setSelectedId(null);
    setCursorId(null);
    setQuery('');
    await refreshStats();
    showToast(removed > 0 ? `已清空 ${removed} 条记录` : '没有可清空的记录');
  }, [clearArmed, refreshStats, showToast]);

  useEffect(() => {
    return api.onOpenSettings(() => {
      void openSettingsPanel();
    });
  }, [openSettingsPanel]);

  // 录制热键：捕获一次组合键并立即注册
  useEffect(() => {
    if (!recordingHotkey) return;
    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecordingHotkey(false);
        return;
      }
      const accelerator = acceleratorFromEvent(event);
      if (!accelerator) {
        showToast('请按包含 Ctrl / Alt / Shift 的组合键，或 F1-F24');
        return;
      }
      setRecordingHotkey(false);
      void patchSettings({ hotkey: accelerator });
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recordingHotkey, patchSettings, showToast]);

  return (
    <div className="app">
      <TopBar
        query={query}
        onQueryChange={setQuery}
        theme={theme}
        onChangeTheme={(next) => void changeTheme(next)}
        onOpenExport={openExportDialog}
        onOpenSettings={() => void openSettingsPanel()}
      />

      <div className="filters">
        <div className="chips">
          {FILTERS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={`chip${filter === entry.key ? ' on' : ''}`}
              onClick={() => setFilter(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <span className="stat">今天未完成 {stats.todayOpenTodos} 条</span>
      </div>

      <div className="content">
        <div className="list" ref={listRef}>
          {groups.map((group) => {
            // 搜索时结果少，不折叠；折叠状态按日期持久化
            const collapsed = !results && collapsedDays.includes(group.key);
            return (
              <section key={group.key}>
                <button
                  type="button"
                  className="group-head"
                  aria-expanded={!collapsed}
                  title={collapsed ? '展开这一天' : '折叠这一天'}
                  onClick={() => toggleGroup(group.key)}
                >
                  <span>
                    <span className="group-chevron">{collapsed ? '▸' : '▾'}</span>
                    {group.label}
                  </span>
                  <span className="count">{group.items.length} 条</span>
                </button>
                {collapsed
                  ? null
                  : group.items.map((item) => (
                      <ListItem
                        key={item.id}
                        item={item}
                        selected={selectedId === item.id}
                        cursor={cursorId === item.id && selectedId !== item.id}
                        highlight={highlightId === item.id}
                        onClick={() => {
                          setCursorId(item.id);
                          setSelectedId(item.id);
                        }}
                        onToggleStatus={(event) => void toggleStatus(item, event)}
                        onDelete={() => void deleteFromList(item)}
                      />
                    ))}
              </section>
            );
          })}

          {visible.length === 0 ? (
            <div className="empty">
              {query.trim()
                ? '没有匹配的记录'
                : '还没有记录，用底部输入框或快捷键记下第一条'}
            </div>
          ) : null}

          {!results && hasMore ? (
            <div className="load-more">
              <button type="button" onClick={() => void loadMore()}>
                加载更多
              </button>
            </div>
          ) : null}
        </div>

        {selected ? (
          <Drawer
            item={selected}
            index={selectedIndex}
            total={visible.length}
            width={drawerWidth}
            editDraft={editDraft}
            deleteArmed={deleteArmed}
            customReminder={customReminder}
            onResizeStart={startDrawerResize}
            onResetWidth={() => {
              setDrawerWidth(360);
              window.localStorage.setItem('ticknote.drawerWidth', '360');
            }}
            onPrev={() => stepSelection(-1)}
            onNext={() => stepSelection(1)}
            onClose={() => setSelectedId(null)}
            onChangeDraft={setEditDraft}
            onSave={saveContent}
            onToggleStatus={() => void toggleStatus(selected)}
            onChangeKind={(next) => void changeKind(next)}
            onApplyReminder={(remindAt) => void applyReminder(remindAt)}
            onToggleCustomReminder={() => setCustomReminder((value) => !value)}
            onDelete={() => void onDelete()}
          />
        ) : null}
      </div>

      <footer className="composer">
        <div className="composer-box">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="记点什么…"
            spellCheck={false}
          />
          <div className="composer-foot">
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
                  disabled={aiBusyComposer || !draft.trim() || sending}
                  title="用 AI 润色措辞并判定类型；失败时保留原文"
                  onClick={() => void runComposerAi()}
                >
                  {aiBusyComposer ? '润色中…' : aiFailed ? '重试润色' : 'AI 润色'}
                </button>
              ) : null}
              {aiUndoText !== null ? (
                <button type="button" className="chip" onClick={undoComposerAi}>
                  撤销润色
                </button>
              ) : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="composer-hint">Enter 记录 · Shift+Enter 换行</span>
              <button type="button" className="send" disabled={!draft.trim() || sending} onClick={() => void submit()}>
                记录
              </button>
            </div>
          </div>
        </div>
      </footer>

      {settingsOpen ? (
        <SettingsPanel
          settings={settingsData}
          autostart={autostart}
          recordingHotkey={recordingHotkey}
          aiBaseUrlDraft={aiBaseUrlDraft}
          aiModelDraft={aiModelDraft}
          aiKeyDraft={aiKeyDraft}
          uninstallArmed={uninstallArmed}
          uninstallHint={uninstallHint}
          clearArmed={clearArmed}
          onClose={() => {
            setSettingsOpen(false);
            setRecordingHotkey(false);
          }}
          onStartRecordingHotkey={() => setRecordingHotkey(true)}
          onToggleAutostart={(enabled) => void toggleAutostart(enabled)}
          onPatch={(patch) => void patchSettings(patch)}
          onChangeAiBaseUrl={setAiBaseUrlDraft}
          onChangeAiModel={setAiModelDraft}
          onChangeAiKey={setAiKeyDraft}
          onSaveAiKey={() => void saveAiKey()}
          onClearAiKey={() => void clearAiKey()}
          onUninstall={() => void runUninstall()}
          onClearAll={() => void clearAllRecords()}
        />
      ) : null}

      {exportOpen ? (
        <ExportDialog
          filter={filter}
          exportScope={exportScope}
          onChangeScope={setExportScope}
          onCancel={() => setExportOpen(false)}
          onConfirm={() => {
            setExportOpen(false);
            void doExport(exportScope);
          }}
        />
      ) : null}

      <Toast text={toast} action={toastAction} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
