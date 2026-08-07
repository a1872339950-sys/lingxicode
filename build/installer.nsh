!include LogicLib.nsh
!include nsDialogs.nsh

Var LingxiDataDir
Var LingxiDataDirText

Page custom LingxiDataDirPageCreate LingxiDataDirPageLeave

Function LingxiDataDirPageCreate
  StrCpy $LingxiDataDir "$INSTDIR\data"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "请选择灵犀数据储存目录。项目列表、上下文、账本、缓存、记忆等数据会保存在这里。"
  Pop $0

  ${NSD_CreateText} 0 34u 76% 14u "$LingxiDataDir"
  Pop $LingxiDataDirText

  ${NSD_CreateBrowseButton} 79% 33u 21% 16u "浏览..."
  Pop $1
  ${NSD_OnClick} $1 LingxiDataDirBrowse

  ${NSD_CreateLabel} 0 58u 100% 28u "默认跟随软件安装目录。你也可以选择其他磁盘或文件夹作为统一数据储存路径。模型 API 配置不会保存在这里，会单独保存到用户目录 .lingxicode。"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function LingxiDataDirBrowse
  nsDialogs::SelectFolderDialog "选择灵犀数据储存目录" "$LingxiDataDir"
  Pop $0
  ${If} $0 != error
    StrCpy $LingxiDataDir "$0"
    ${NSD_SetText} $LingxiDataDirText "$LingxiDataDir"
  ${EndIf}
FunctionEnd

Function LingxiDataDirPageLeave
  ${NSD_GetText} $LingxiDataDirText $LingxiDataDir
  ${If} $LingxiDataDir == ""
    MessageBox MB_ICONEXCLAMATION "请选择数据储存目录。"
    Abort
  ${EndIf}
FunctionEnd

!macro customInstall
  CreateDirectory "$LingxiDataDir"
  FileOpen $0 "$INSTDIR\lingxi-data-dir.txt" w
  FileWrite $0 "$LingxiDataDir"
  FileClose $0
!macroend

!macro customUnInstall
  Delete "$INSTDIR\lingxi-data-dir.txt"
!macroend
