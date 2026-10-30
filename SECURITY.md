> 中文 | [English](SECURITY.en.md)

# 安全策略

TickNote（待办便签）是一个本地优先的 Windows 桌面应用：没有服务端、没有账号、没有云同步。安全边界主要在**本机进程**与**本地数据**上。

## 支持版本

- 只维护**最新 Release**（当前为 `0.1.x`）。
- 旧版本不单独提供安全补丁；发现问题请升级到最新版本后复测。
- 开发分支（`main`）的最新提交也会评估，但不承诺修复时间。

## 报告安全漏洞

**请不要开公开 Issue、不要把细节发到讨论区或社交媒体。**

请通过 GitHub 的私密安全公告报告：

```
https://github.com/TickNote/ticknote/security/advisories/new
```

（也可以在该仓库的 Security 标签页点击 “Report a vulnerability”。）

报告中请尽量包含：

- TickNote 版本（设置面板 / 安装包文件名）；
- 安装方式：Setup 安装包、便携版 zip，还是开发模式；
- Windows 版本与架构；
- 问题类型与影响范围（例如：能否读取记录、能否执行任意代码、是否需要本机用户交互）；
- 复现步骤或最小 PoC（可附代码片段，但**不要附真实 API Key 或私人记录**）；
- 你希望的披露方式与致谢署名（可选）。

维护者会尽快评估并回复；修复发布后会与你确认公开披露的时间与致谢方式。**不承诺固定的响应时限**，但会认真对待每一份报告。

## 安全模型概要

| 项         | 说明                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 进程隔离   | 渲染层开启 `contextIsolation` 与 `sandbox`、关闭 `nodeIntegration`，只能通过 preload 暴露的白名单方法调用主进程；窗口拒绝新窗与页面跳转 |
| CSP        | 两个 HTML 入口均带最小化 Content-Security-Policy，渲染层不加载任何远程资源                                                              |
| IPC 校验   | 主进程每个 handler 用 zod 校验入参（长度、uuid、枚举）                                                                                  |
| 数据存储   | `%APPDATA%\TickNote\ticknote.db` 为**明文** SQLite，未加密                                                                              |
| 数据库访问 | 只有主进程与 MCP 进程打开数据库（WAL + `busy_timeout`）                                                                                 |
| 网络       | 唯一出站请求是用户主动触发的 AI 润色；无遥测、无自动更新                                                                                |
| API Key    | 用 Electron `safeStorage` 加密后存 `settings.json`，渲染层只能看到“是否已设置”                                                          |
| MCP        | 本地 stdio，无网络监听、无鉴权；删除工具默认关闭                                                                                        |
| 代码签名   | 当前**未签名**                                                                                                                          |

## AI Key 的存储方式与注意事项

- 保存时调用 `safeStorage.encryptString()`（Windows 上由 DPAPI 保护），base64 后写入 `%APPDATA%\TickNote\settings.json` 的 `aiApiKeyEncrypted` 字段。
- 解密只发生在主进程；渲染层拿到的只有 `aiApiKeySet: true/false`。
- 若系统上 `safeStorage` 不可用，会降级为 `plain:<base64>`（仅编码、非加密），设置面板会明确提示并可随时清除。
- **风险**：能读取你的 Windows 用户目录、或以你的用户身份运行的程序，可能同样能通过 DPAPI 解出 Key；请保护好账户并开启磁盘加密（BitLocker）。
- Key 只作为 Bearer 头发往你配置的 AI 端点，不写入日志、不写入导出文件。
- 报告问题时请先**清除 Key**再附 `settings.json`，或只贴字段名。

## MCP 的删除风险

- `delete_item` **默认不注册**。只有在设置里打开「MCP 删除工具」（`mcpDeleteEnabled: true`）并重启 AI 客户端后，工具才会出现。
- 即使开启，调用也必须带 `confirm: true`，且是**硬删除**——没有回收站、不可撤销。
- MCP server 以当前 Windows 用户权限运行，没有鉴权层、没有沙箱。任何能启动该进程的本地程序都能读写数据库。
- MCP 进程从**数据库所在目录**的 `settings.json` 读取删除开关；自定义 `TICKNOTE_DB` 时请确认该目录下的设置符合预期。
- 只把你信任的 AI 客户端接入 TickNote；不需要 MCP 时，从客户端配置里移除 `ticknote` 条目即可。
- 安全建议：日常关闭删除工具，需要清理时临时开启、用完再关闭并重启客户端。

## 未签名安装包

- 发布的 `TickNote-x.y.z-Setup.exe` 与便携 zip **没有代码签名**，Windows SmartScreen 会提示「未知发布者」/「Windows 已保护你的电脑」。这是预期现象，不代表文件被篡改，但也意味着**系统无法帮你验证来源**。
- 请只从本仓库的 Releases 页面下载；每个 Release 都附带 `SHA256SUMS.txt`，可自行核对：

  ```powershell
  Get-FileHash .\TickNote-x.y.z-Setup.exe -Algorithm SHA256
  Get-Content .\SHA256SUMS.txt
  ```

- 便携 zip 若来自网络，建议先 `Unblock-File .\TickNote-x.y.z-portable.zip` 再解压。
- 在配置代码签名证书之前，无法从技术上消除 SmartScreen 警告；请自行评估是否信任构建来源。

## 不在范围内的问题

- SmartScreen / 杀软对未签名程序的拦截提示（属分发策略，不是漏洞）。
- 系统勿扰模式、通知被关闭导致提醒不显示。
- 全局热键与其他软件冲突（属功能限制，按普通 Bug 处理）。
- 第三方 AI 服务商（DeepSeek、OpenAI 兼容端点等）的数据处理与可用性问题。
- 已经取得本机用户权限后的攻击（例如直接读取 `ticknote.db`），除非能证明存在越权提升。
- 依赖库的已知漏洞：会通过 Dependabot 跟进；若影响 TickNote 的可利用路径，请按上面的私密渠道报告。

## 加固计划（已知可改进项）

- 继续收紧 CSP 中的 `'unsafe-inline'`（当前为兼容 Vite 注入与内联样式保留，详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#8-安全模型)）。
- 为发布产物配置代码签名。
- 为数据库提供可选的加密存储方案。

---

相关文档：[docs/PRIVACY.md](docs/PRIVACY.md) · [docs/MCP.md](docs/MCP.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
