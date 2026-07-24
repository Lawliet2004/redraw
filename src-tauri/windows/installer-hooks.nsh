; Desktop shortcut on install; remove on uninstall
!macro NSIS_HOOK_POSTINSTALL
  CreateShortCut "$DESKTOP\Redraw.lnk" "$INSTDIR\redraw.exe" "" "$INSTDIR\redraw.exe" 0 SW_SHOWNORMAL "" ""
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$DESKTOP\Redraw.lnk"
!macroend
