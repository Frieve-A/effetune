!macro customInstall
  ; Only the discovery helper elevates; per-user application installs stay available.
  nsExec::ExecToStack '"$SYSDIR\sc.exe" query "Bonjour Service"'
  Pop $0
  Pop $1
  ${If} $0 == 1060
    ${StdUtils.ExecShellWaitEx} $0 $1 "$INSTDIR\resources\airplay\discovery\install-discovery.exe" "runas" ""
    ${If} $0 == "ok"
      ${StdUtils.WaitForProcEx} $0 $1
    ${EndIf}
    ${If} $0 != 0
      DetailPrint "Network audio discovery could not be installed. Run the installer again and allow the setup request to enable AirPlay."
    ${EndIf}
  ${EndIf}
  ; Discovery is shared with other applications and remains installed on uninstall.
!macroend
