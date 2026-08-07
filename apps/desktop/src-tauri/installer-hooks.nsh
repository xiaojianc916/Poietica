; 安装期指定数据目录。
;
; 装完在可执行文件旁边留一行绝对路径，应用启动时读它。没有这个文件时应用
; 用平台默认位置，所以不传这个开关的安装与此前完全一致。
;
; 用命令行开关而不是加一个目录选择页：Tauri 的 installer.nsi 把 MUI 页面
; 序列写死在模板里，installerHooks 是在那之后插入的，插不进第二个
; MUI_PAGE_DIRECTORY。一个假的、点了不生效的选择页比没有更糟。
;
;   Poietica_0.1.5_x64-setup.exe /DATA=D:\Poietica

!macro NSIS_HOOK_POSTINSTALL
  ${GetOptions} $CMDLINE "/DATA=" $R9

  ${IfNot} ${Errors}
  ${AndIf} $R9 != ""
    CreateDirectory "$R9"

    FileOpen $R8 "$INSTDIR\data-directory" w
    FileWrite $R8 "$R9"
    FileClose $R8
  ${EndIf}
!macroend

; 声明文件是安装产物，不是用户数据。用户的数据留在他选的那个目录里。
!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\data-directory"
!macroend
