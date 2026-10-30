import type { AutostartStatus, Settings, SettingsPatch } from '../../../shared/types';
import { useRef } from 'react';
import { useDialogFocus } from '../hooks';

export interface SettingsPanelProps {
  settings: Settings | null;
  autostart: AutostartStatus | null;
  recordingHotkey: boolean;
  aiBaseUrlDraft: string;
  aiModelDraft: string;
  aiKeyDraft: string;
  uninstallArmed: boolean;
  uninstallHint: string;
  clearArmed: boolean;
  onClose: () => void;
  onStartRecordingHotkey: () => void;
  onToggleAutostart: (enabled: boolean) => void;
  onPatch: (patch: SettingsPatch) => void;
  onChangeAiBaseUrl: (value: string) => void;
  onChangeAiModel: (value: string) => void;
  onChangeAiKey: (value: string) => void;
  onSaveAiKey: () => void;
  onClearAiKey: () => void;
  onUninstall: () => void;
  onClearAll: () => void;
  connectionBusy: boolean;
  connectionHint: string;
  onTestConnection: () => void;
  backupBusy: boolean;
  onBackup: () => void;
  onRestoreBackup: () => void;
}

export function SettingsPanel({
  settings,
  autostart,
  recordingHotkey,
  aiBaseUrlDraft,
  aiModelDraft,
  aiKeyDraft,
  uninstallArmed,
  uninstallHint,
  clearArmed,
  onClose,
  onStartRecordingHotkey,
  onToggleAutostart,
  onPatch,
  onChangeAiBaseUrl,
  onChangeAiModel,
  onChangeAiKey,
  onSaveAiKey,
  onClearAiKey,
  onUninstall,
  onClearAll,
  connectionBusy,
  connectionHint,
  onTestConnection,
  backupBusy,
  onBackup,
  onRestoreBackup,
}: SettingsPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  useDialogFocus(panelRef);
  return (
    <div className="settings-mask" onClick={onClose}>
      <aside
        className="settings-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-head">
          <span id="settings-title">设置</span>
          <button type="button" className="icon-btn close-btn" aria-label="关闭设置" onClick={onClose}>
            ×
          </button>
        </div>

        {settings ? (
          <>
            <div className="settings-divider">常规</div>
            <div className="setting-row">
              <div className="setting-copy">
                <div className="setting-name">全局热键</div>
                <div className="setting-desc">按一次想用的组合键即可更换；被其他软件占用时会提示</div>
              </div>
              <button
                type="button"
                className={`btn${recordingHotkey ? ' danger' : ''}`}
                onClick={onStartRecordingHotkey}
              >
                {recordingHotkey ? '按下组合键…' : settings.hotkey}
              </button>
            </div>
            {!settings.hotkeyRegistered ? (
              <div className="setting-warn">当前热键注册失败：可能被其他软件占用，请更换</div>
            ) : null}

            <div className="setting-row">
              <div className="setting-copy">
                <div className="setting-name">开机自启</div>
                <div className="setting-desc">登录 Windows 后自动在托盘运行，不弹出主窗口</div>
              </div>
              <input
                type="checkbox"
                aria-label="开机自启"
                className="setting-check"
                checked={autostart?.openAtLogin ?? false}
                onChange={(event) => onToggleAutostart(event.target.checked)}
              />
            </div>
            {autostart?.blocked ? (
              <div className="setting-warn">已开启但被系统阻止：任务管理器 → 启动 里被禁用</div>
            ) : null}
            {autostart && !autostart.packaged ? (
              <div className="setting-hint">开发模式下注册的是 electron.exe，仅安装版生效</div>
            ) : null}

            <div className="setting-row">
              <div className="setting-copy">
                <div className="setting-name">浮窗失焦隐藏</div>
                <div className="setting-desc">点到其他窗口时自动收起，重新打开继续编辑草稿</div>
              </div>
              <input
                type="checkbox"
                className="setting-check"
                checked={settings.hideCaptureOnBlur}
                aria-label="浮窗失焦隐藏"
                onChange={(event) => onPatch({ hideCaptureOnBlur: event.target.checked })}
              />
            </div>

            <div className="settings-divider">MCP 集成</div>
            <div className="setting-row">
              <div className="setting-copy">
                <div className="setting-name">MCP 删除工具</div>
                <div className="setting-desc">
                  允许 AI 客户端删除记录；默认关闭。修改后重启 Claude/Cursor 等 AI 客户端生效，TickNote
                  无需重启
                </div>
              </div>
              <input
                type="checkbox"
                className="setting-check"
                checked={settings.mcpDeleteEnabled}
                aria-label="允许 MCP 删除记录"
                onChange={(event) => onPatch({ mcpDeleteEnabled: event.target.checked })}
              />
            </div>

            <div className="settings-divider">AI 润色</div>
            <div className="setting-row">
              <div className="setting-copy">
                <div className="setting-name">启用 AI 润色</div>
                <div className="setting-desc">只在点击按钮时调用；结果先回显，确认后才保存</div>
              </div>
              <input
                type="checkbox"
                className="setting-check"
                checked={settings.aiEnabled}
                aria-label="启用 AI 润色"
                onChange={(event) => onPatch({ aiEnabled: event.target.checked })}
              />
            </div>

            {settings.aiEnabled ? (
              <>
                <label className="setting-field">
                  <span>接口地址</span>
                  <input
                    value={aiBaseUrlDraft}
                    onChange={(event) => onChangeAiBaseUrl(event.target.value)}
                    onBlur={() =>
                      onPatch({ aiBaseUrl: aiBaseUrlDraft.trim() || 'https://api.deepseek.com/v1' })
                    }
                    spellCheck={false}
                  />
                </label>
                <label className="setting-field">
                  <span>模型</span>
                  <input
                    value={aiModelDraft}
                    onChange={(event) => onChangeAiModel(event.target.value)}
                    onBlur={() => onPatch({ aiModel: aiModelDraft.trim() || 'deepseek-chat' })}
                    spellCheck={false}
                  />
                </label>
                <div className="setting-field">
                  <span>API Key</span>
                  <div className="setting-key">
                    <input
                      value={aiKeyDraft}
                      onChange={(event) => onChangeAiKey(event.target.value)}
                      placeholder={settings.aiApiKeySet ? '已设置（留空可保留）' : '未设置'}
                      type="password"
                      aria-label="AI API Key"
                      spellCheck={false}
                    />
                    <button type="button" className="btn" onClick={onSaveAiKey}>
                      保存
                    </button>
                    {settings.aiApiKeySet ? (
                      <button type="button" className="btn danger" onClick={onClearAiKey}>
                        清除
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="setting-hint">
                  Key 用 Electron safeStorage 加密后存本机
                  settings.json；只发送当前这一行文本，不发送历史记录。
                </div>
                <button type="button" className="btn" disabled={connectionBusy} onClick={onTestConnection}>
                  {connectionBusy ? '测试中…' : '保存配置并测试连接'}
                </button>
                {connectionHint && (
                  <div className="setting-hint" role="status">
                    {connectionHint}
                  </div>
                )}
              </>
            ) : (
              <div className="setting-hint">开启后可配置接口地址、模型与 API Key（Key 加密保存）。</div>
            )}

            <div className="setting-hint">Windows 勿扰 / 专注助手会静默通知，无法绕过。</div>

            <div className="settings-divider">数据管理</div>
            <p className="setting-hint">
              备份包含完整记录、时间和提醒，不包含 API Key。恢复时合并缺失记录，已有内容保持不变。
            </p>
            <div className="backup-actions">
              <button type="button" className="btn" disabled={backupBusy} onClick={onBackup}>
                备份全部记录
              </button>
              <button type="button" className="btn" disabled={backupBusy} onClick={onRestoreBackup}>
                恢复备份
              </button>
            </div>
            <div className="settings-divider">危险操作</div>
            <div className="setting-row">
              <div className="setting-copy">
                <div className="setting-name">清空全部记录</div>
                <div className="setting-desc">删除所有待办与便签，无法恢复；建议先导出备份</div>
              </div>
              <button type="button" className={`btn${clearArmed ? ' danger' : ''}`} onClick={onClearAll}>
                {clearArmed ? '确认清空？' : '清空'}
              </button>
            </div>

            <div className="setting-row">
              <div className="setting-copy">
                <div className="setting-name">卸载 TickNote</div>
                <div className="setting-desc">打开系统卸载程序；卸载不会删除本地记录</div>
              </div>
              <button type="button" className={`btn${uninstallArmed ? ' danger' : ''}`} onClick={onUninstall}>
                {uninstallArmed ? '确认卸载？' : '卸载'}
              </button>
            </div>
            {uninstallHint ? <div className="setting-hint">{uninstallHint}</div> : null}
          </>
        ) : (
          <div className="setting-hint">加载中…</div>
        )}
      </aside>
    </div>
  );
}
