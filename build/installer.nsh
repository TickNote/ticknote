; 安装完成时在开始菜单加一个“卸载 TickNote”快捷方式（并清理旧版 QuickNote 快捷方式）
!macro customInstall
  Delete "$SMPROGRAMS\QuickNote.lnk"
  Delete "$SMPROGRAMS\卸载 QuickNote.lnk"
  CreateShortCut "$SMPROGRAMS\卸载 TickNote.lnk" "$INSTDIR\Uninstall TickNote.exe" "/currentuser" "$INSTDIR\TickNote.exe" 0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\卸载 TickNote.lnk"
!macroend
