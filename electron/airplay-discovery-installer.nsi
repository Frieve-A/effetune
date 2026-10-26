Unicode true
!include "LogicLib.nsh"

!ifndef AIRPLAY_DISCOVERY_DIR
  !error "AIRPLAY_DISCOVERY_DIR must name the built discovery runtime directory"
!endif
!ifndef AIRPLAY_DISCOVERY_INSTALLER
  !error "AIRPLAY_DISCOVERY_INSTALLER must name the output executable"
!endif

Name "EffeTune network audio discovery"
OutFile "${AIRPLAY_DISCOVERY_INSTALLER}"
RequestExecutionLevel admin
SilentInstall silent

Section
  ; Recheck after elevation so an existing shared service is never replaced.
  nsExec::ExecToStack '"$SYSDIR\sc.exe" query "Bonjour Service"'
  Pop $0
  Pop $1
  ${If} $0 == 0
    SetErrorLevel 0
    Return
  ${EndIf}
  ${If} $0 != 1060
    SetErrorLevel 1
    Return
  ${EndIf}

  SetShellVarContext all
  SetOutPath "$COMMONFILES64\EffeTune\Bonjour"
  ClearErrors
  File "${AIRPLAY_DISCOVERY_DIR}\mDNSResponder.exe"
  File /nonfatal "${AIRPLAY_DISCOVERY_DIR}\*.dll"
  ${If} ${Errors}
    SetErrorLevel 1
    Return
  ${EndIf}
  ExecWait '"$OUTDIR\mDNSResponder.exe" -install' $0
  ${If} $0 != 0
    SetErrorLevel 1
    Return
  ${EndIf}
  nsExec::ExecToStack '"$SYSDIR\sc.exe" query "Bonjour Service"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    SetErrorLevel 1
    Return
  ${EndIf}
  SetErrorLevel 0
SectionEnd
