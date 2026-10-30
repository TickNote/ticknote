import { useEffect, useRef, useState } from 'react';
import type { ThemePreference } from '../../../shared/types';
import { THEMES } from '../utils';

export interface TopBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  theme: ThemePreference;
  onChangeTheme: (next: ThemePreference) => void;
  onOpenExport: () => void;
  onOpenSettings: () => void;
}

export function TopBar({
  query,
  onQueryChange,
  theme,
  onChangeTheme,
  onOpenExport,
  onOpenSettings,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: globalThis.MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header className="topbar">
      <div className="search">
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索全部记录"
          aria-label="搜索全部记录"
          maxLength={200}
          spellCheck={false}
        />
      </div>
      <div className="top-actions">
        <button
          type="button"
          className="chip"
          title="更多"
          aria-label="更多操作"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((value) => !value)}
        >
          ⋯
        </button>
        <button type="button" className="chip" title="设置" onClick={() => void onOpenSettings()}>
          设置
        </button>

        {menuOpen ? (
          <div className="menu" ref={menuRef}>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setMenuOpen(false);
                onOpenExport();
              }}
            >
              导出 Markdown
            </button>
            <div className="menu-label">外观</div>
            <div className="menu-themes" role="group" aria-label="外观">
              {THEMES.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className={`chip${theme === entry.key ? ' on' : ''}`}
                  aria-pressed={theme === entry.key}
                  title={entry.title}
                  onClick={() => {
                    setMenuOpen(false);
                    void onChangeTheme(entry.key);
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
