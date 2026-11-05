; LegalLeaves のインストーラ（NSIS 3・Unicode）。py/packaging/build.ps1 から次の値を渡して作る:
;   /DVERSION=5.0.0  /DSRCDIR=<PyInstaller の出力フォルダ>  /DOUTFILE=<作る exe>  /DICON=<icon.ico>
;   /DMANUAL=<操作説明書 PDF>（無ければ省略）
;
; 方針（利用者と合意済み）:
;   - 管理者権限なしで、各自のユーザー領域（%LOCALAPPDATA%\Programs\LegalLeaves）に入れる
;   - アンインストールは Windows の「設定 → アプリ」から普通のアプリと同じようにできる
;   - アンインストール時に「事務所の書き方メモ・履歴・設定も削除しますか？」と確認する
;       はい   … すべて削除（このパソコンに何も残らない）
;       いいえ … メモ・履歴・設定（%APPDATA%\legal-leaves\data）だけ残す
;     一時ファイル・Edge 部品の作業フォルダ・旧版（楽々mints）の控えは、どちらでも消す
;   - 上書きで入れ直す（更新する）ときは、保存データに触れない

Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!define APP "LegalLeaves"
; タスクバーにピン留めしたときのショートカットの置き場所（アンインストールで一緒に消す）
!define TASKBAR_PINS "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP}"

Name "${APP}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
InstallDirRegKey HKCU "Software\${APP}" "InstallDir"
BrandingText "${APP} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1041 "ProductName" "${APP}"
VIAddVersionKey /LANG=1041 "FileDescription" "${APP} インストーラ"
VIAddVersionKey /LANG=1041 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1041 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1041 "LegalCopyright" "MIT License"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "${APP} を起動する"
!define MUI_WELCOMEPAGE_TEXT "${APP} ${VERSION} をこのパソコンに入れます。$\r$\n$\r$\n管理者の権限は必要ありません（あなたのユーザーにだけ入ります）。$\r$\n$\r$\n${APP} が起動中なら、先に終了してください。"
; 最後の画面で、デスクトップのショートカットを作るか選べる（既定はオン。前回の選択を覚えておく）
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT "デスクトップにショートカットを作る"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut

Var DesktopPref ; 1=作る 0=作らない（前回の選択。初回は 1）

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
; MUI_PAGE_CUSTOMFUNCTION_* は「次に入れる画面」に付く。最後の画面の直前に置くこと
; （前に置くと最初の画面に付いてしまい、前回の選択がチェックに反映されなかった）
!define MUI_PAGE_CUSTOMFUNCTION_SHOW FinishShow
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Japanese"

; 起動中は exe を書き込み用に開けない。開けるまで「終了してから再試行」を求める。
!macro ENSURE_CLOSED UN
Function ${UN}EnsureClosed
  retry:
    IfFileExists "$INSTDIR\${APP}.exe" 0 done
    ClearErrors
    FileOpen $0 "$INSTDIR\${APP}.exe" a
    IfErrors busy
    FileClose $0
    Goto done
  busy:
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${APP} が起動中です。終了してから「再試行」を押してください。" IDRETRY retry
    Abort
  done:
FunctionEnd
!macroend
!insertmacro ENSURE_CLOSED ""
!insertmacro ENSURE_CLOSED "un."

Function .onInit
  ; 前回の選択（無ければ「作る」）。画面なしで入れるときは /NODESKTOP で「作らない」にできる
  ClearErrors
  ReadRegDWORD $DesktopPref HKCU "Software\${APP}" "DesktopShortcut"
  ${If} ${Errors}
    StrCpy $DesktopPref 1
  ${EndIf}
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/NODESKTOP" $R2
  ${IfNot} ${Errors}
    StrCpy $DesktopPref 0
  ${EndIf}
FunctionEnd

Function FinishShow
  ${If} $DesktopPref == 0
    ${NSD_Uncheck} $mui.FinishPage.ShowReadme
  ${EndIf}
FunctionEnd

Function CreateDesktopShortcut
  CreateShortCut "$DESKTOP\${APP}.lnk" "$INSTDIR\${APP}.exe"
  WriteRegDWORD HKCU "Software\${APP}" "DesktopShortcut" 1
FunctionEnd

Section "Install"
  Call EnsureClosed
  SetOutPath "$INSTDIR"
  ; 前の版の部品を残さない（ファイル構成が変わっても古いものが混ざらないように）
  RMDir /r "$INSTDIR\_internal"
  File /r "${SRCDIR}\*.*"
!ifdef MANUAL
  File "/oname=${APP} 操作説明書.pdf" "${MANUAL}"
!endif
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; デスクトップのショートカットは最後の画面の選択で作る（作らない選択なら、前の版のものも消える）。
  ; 画面なしで入れたとき（/S）は最後の画面が出ないので、前回の選択（初回は「作る」）に従ってここで作る。
  Delete "$DESKTOP\${APP}.lnk"
  WriteRegDWORD HKCU "Software\${APP}" "DesktopShortcut" 0
  ${If} ${Silent}
  ${AndIf} $DesktopPref == 1
    Call CreateDesktopShortcut
  ${EndIf}
  CreateShortCut "$SMPROGRAMS\${APP}.lnk" "$INSTDIR\${APP}.exe"
!ifdef MANUAL
  CreateShortCut "$SMPROGRAMS\${APP} 操作説明書.lnk" "$INSTDIR\${APP} 操作説明書.pdf"
!endif

  WriteRegStr HKCU "Software\${APP}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${APP}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP}.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

; %TEMP% に残った作業用のもの（Word 変換の作業フォルダ・プレビュー・LibreOffice の設定など）
Function un.CleanTemp
  StrCpy $R1 "legalleaves-*"
  Call un.RemoveMatches
  StrCpy $R1 "rakuraku-*"
  Call un.RemoveMatches
FunctionEnd

Function un.RemoveMatches
  FindFirst $0 $1 "$TEMP\$R1"
  loop:
    StrCmp $1 "" done
    RMDir /r "$TEMP\$1"
    Delete "$TEMP\$1"
    FindNext $0 $1
    Goto loop
  done:
  FindClose $0
FunctionEnd

; 保存先のうち data（メモ・履歴・設定）以外を消す
Function un.RemoveAllButData
  FindFirst $0 $1 "$APPDATA\legal-leaves\*"
  loop:
    StrCmp $1 "" done
    StrCmp $1 "." next
    StrCmp $1 ".." next
    StrCmp $1 "data" next
    RMDir /r "$APPDATA\legal-leaves\$1"
    Delete "$APPDATA\legal-leaves\$1"
  next:
    FindNext $0 $1
    Goto loop
  done:
  FindClose $0
FunctionEnd

Section "Uninstall"
  Call un.EnsureClosed
  ; ショートカット: デスクトップ・スタートメニュー・タスクバーのピン留め（あれば）
  Delete "$DESKTOP\${APP}.lnk"
  Delete "$SMPROGRAMS\${APP}.lnk"
  Delete "$SMPROGRAMS\${APP} 操作説明書.lnk"
  Delete "${TASKBAR_PINS}\${APP}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${APP}"
  Call un.CleanTemp

  ; /KEEPDATA を付けたときは確認せずに「いいえ」（メモ類を残す）。管理用・動作確認用
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/KEEPDATA" $R2
  IfErrors 0 keepData
  ; 画面なしのアンインストール（/S）は、何も残さない方を選ぶ
  IfSilent deleteAll
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "事務所の書き方メモ・最近使ったフォルダの履歴・画面設定も削除しますか？$\r$\n$\r$\n「はい」 … すべて削除します（このパソコンに何も残りません）。$\r$\n「いいえ」 … これらだけ残します（あとで入れ直したときに引き継がれます）。" IDYES deleteAll
  keepData:
    Call un.RemoveAllButData
    Goto dataDone
  deleteAll:
    RMDir /r "$APPDATA\legal-leaves"
  dataDone:
  ; 旧名（楽々mints）時代の保存先。中身は起動時に legal-leaves へ引き継ぎ済み
  RMDir /r "$APPDATA\rakuraku-mints"
SectionEnd
