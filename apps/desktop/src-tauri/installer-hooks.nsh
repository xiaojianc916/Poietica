; 卸载时的「删除应用数据」。
;
; 数据就在安装目录里，跟程序本体并排 —— 用户在目录页选的那一个位置同时是这两
; 件事的答案，应用侧的判据是「exe 在哪，数据就在哪」，不需要安装期写任何东西。
;
; 平时卸载不会带走数据：卸载器逐个 Delete 它自己装进去的文件，最后那句 RMDir
; 不带 /r，数据文件还在时它删不掉那个目录。所以要清干净，只能是用户明确勾了
; 「删除应用数据」这一种情况。
;
; 模板自带的那一段清的是平台默认目录，对装到自定义位置的安装没有作用，这里补上。
; 升级走的也是卸载流程，UpdateMode 为 1 时一个字节都不能动。

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RMDir /r "$INSTDIR"
  ${EndIf}
!macroend
