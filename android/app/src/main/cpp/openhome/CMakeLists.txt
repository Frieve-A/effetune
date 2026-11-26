# In-process OpenHome / UPnP AV renderer: ohNet plus the desktop sidecar's providers.
# The locked ohNet sources are prepared outside the tree by
#   node scripts/build-openhome-sidecar.mjs --android-sources
set(CMAKE_CXX_STANDARD 17)
set(OPENHOME_SIDECAR_ROOT "${EFFETUNE_ROOT}/native/openhome-sidecar")
file(READ "${OPENHOME_SIDECAR_ROOT}/dependencies.lock.json" OPENHOME_LOCK)
string(JSON OPENHOME_ARCHIVE_COUNT LENGTH "${OPENHOME_LOCK}" archives)
math(EXPR OPENHOME_LAST_ARCHIVE "${OPENHOME_ARCHIVE_COUNT} - 1")
foreach(index RANGE ${OPENHOME_LAST_ARCHIVE})
  string(JSON name GET "${OPENHOME_LOCK}" archives ${index} name)
  string(JSON commit GET "${OPENHOME_LOCK}" archives ${index} commit)
  set(OPENHOME_SOURCE_${name} "${EFFETUNE_ROOT}/out/openhome-android/${name}-${commit}")
endforeach()
set(OHNET_ROOT "${OPENHOME_SOURCE_ohNet}")
set(GENERATED_PROVIDER_DIR "${OPENHOME_SOURCE_ohNetGenerated}/OpenHome/Net/Bindings/Cpp/Device/Providers")
if(NOT EXISTS "${OHNET_ROOT}/Build/Include/OpenHome/Net/Private/mDNSEmbeddedAPI.h"
   OR NOT EXISTS "${GENERATED_PROVIDER_DIR}")
  message(FATAL_ERROR "The OpenHome renderer sources are missing. Run "
                      "'node scripts/build-openhome-sidecar.mjs --android-sources' first.")
endif()

# ohNetCore sources for the Posix OS layer, as listed by ohNet's own CMakeLists.txt.
set(OHNET_SOURCES
    OpenHome/Ascii.cpp
    OpenHome/Net/Bindings/C/AsyncC.cpp
    OpenHome/Net/ControlPoint/AsyncPrivate.cpp
    OpenHome/Net/Device/Bonjour/Bonjour.cpp
    OpenHome/Buffer.cpp
    OpenHome/Converter.cpp
    OpenHome/Crc32.cpp
    thirdparty/libb64/cencode.c
    thirdparty/libb64/cdecode.c
    OpenHome/Net/Discovery.cpp
    OpenHome/Debug.cpp
    OpenHome/Net/ControlPoint/CpDeviceCore.cpp
    OpenHome/Net/Bindings/C/ControlPoint/CpDeviceC.cpp
    OpenHome/Net/Bindings/Cpp/ControlPoint/CpDeviceStd.cpp
    OpenHome/Net/Bindings/C/ControlPoint/CpDeviceDvC.cpp
    OpenHome/Net/ControlPoint/CpDeviceUpnpCore.cpp
    OpenHome/Net/Bindings/C/ControlPoint/CpDeviceUpnpC.cpp
    OpenHome/Net/Bindings/Cpp/ControlPoint/CpDeviceUpnpStd.cpp
    OpenHome/Net/ControlPoint/CpiDevice.cpp
    OpenHome/Net/ControlPoint/Dv/CpiDeviceDv.cpp
    OpenHome/Net/ControlPoint/Lpec/CpiDeviceLpec.cpp
    OpenHome/Net/ControlPoint/Upnp/CpiDeviceUpnp.cpp
    OpenHome/Net/ControlPoint/CpiService.cpp
    OpenHome/Net/ControlPoint/CpiStack.cpp
    OpenHome/Net/ControlPoint/CpiSubscription.cpp
    OpenHome/Net/ControlPoint/CpProxy.cpp
    OpenHome/Net/Bindings/C/ControlPoint/CpProxyC.cpp
    OpenHome/Net/Bindings/C/ControlPoint/CpServiceC.cpp
    OpenHome/Net/Device/DvDevice.cpp
    OpenHome/Net/Bindings/Cpp/Device/DvDeviceStd.cpp
    OpenHome/Net/Bindings/C/Device/DvDeviceC.cpp
    OpenHome/Net/Device/DviDevice.cpp
    OpenHome/Net/Bindings/C/Device/DvInvocationC.cpp
    OpenHome/Net/Bindings/Cpp/Device/DvInvocationStd.cpp
    OpenHome/Net/Device/Upnp/DviProtocolUpnp.cpp
    OpenHome/Net/Device/DviServer.cpp
    OpenHome/Net/Device/Upnp/DviServerUpnp.cpp
    OpenHome/Net/Device/Lpec/DviProtocolLpec.cpp
    OpenHome/Net/Device/Lpec/DviServerLpec.cpp
    OpenHome/Net/Device/DviService.cpp
    OpenHome/Net/Device/Upnp/DviSsdpNotifier.cpp
    OpenHome/Net/Device/DviStack.cpp
    OpenHome/Net/Device/DviSubscription.cpp
    OpenHome/Net/Device/DvProvider.cpp
    OpenHome/Net/Bindings/C/Device/DvProviderC.cpp
    OpenHome/Net/Device/DvServerUpnp.cpp
    OpenHome/Net/Bindings/C/Device/DvServerUpnpC.cpp
    OpenHome/Net/ControlPoint/Upnp/DeviceXml.cpp
    OpenHome/Net/Error.cpp
    OpenHome/Net/ControlPoint/Upnp/EventUpnp.cpp
    OpenHome/Exception.cpp
    OpenHome/Fifo.cpp
    OpenHome/FileAnsi.cpp
    OpenHome/FileBrx.cpp
    OpenHome/FileStream.cpp
    OpenHome/Net/Globals.cpp
    OpenHome/Http.cpp
    Build/mDNS/DNSCommon.c
    Build/mDNS/DNSDigest.c
    Build/mDNS/mDNS.c
    Build/mDNS/uDNS.c
    Build/mDNS/dnssd_clientshim.c
    Build/mDNS/dnssd_clientlib.c
    OpenHome/Net/Device/Bonjour/MdnsPlatform.cpp
    OpenHome/Net/Device/Bonjour/MdnsProvider.cpp
    OpenHome/md5.c
    OpenHome/NetworkAdapterList.cpp
    OpenHome/DnsChangeNotifier.cpp
    OpenHome/Network.cpp
    OpenHome/Parser.cpp
    OpenHome/Printer.cpp
    OpenHome/Net/ControlPoint/Upnp/ProtocolUpnp.cpp
    OpenHome/Queue.cpp
    OpenHome/Net/Service.cpp
    OpenHome/Net/Bindings/C/ServiceC.cpp
    OpenHome/sha1.c
    OpenHome/Net/Ssdp.cpp
    OpenHome/Net/SsdpDv.cpp
    OpenHome/Env.cpp
    OpenHome/Stream.cpp
    OpenHome/Net/Subscription.cpp
    OpenHome/Terminal.cpp
    OpenHome/Thread.cpp
    OpenHome/Time.cpp
    OpenHome/Timer.cpp
    OpenHome/TIpAddressUtils.cpp
    OpenHome/Uri.cpp
    OpenHome/Net/XmlParser.cpp
    OpenHome/Net/ControlPoint/Upnp/XmlFetcher.cpp
    OpenHome/Net/OhNet.cpp
    OpenHome/Net/OhNetCp.cpp
    OpenHome/Net/OhNetDv.cpp
    OpenHome/Net/OhNetCombined.cpp
    OpenHome/Net/Bindings/C/OhNetC.cpp
    OpenHome/Net/Bindings/C/OhNetCCp.cpp
    OpenHome/Net/Bindings/C/OhNetCDv.cpp
    OpenHome/Net/Bindings/C/OhNetCCombined.cpp
    Os/OsWrapper.cpp
    OpenHome/Shell/Shell.cpp
    OpenHome/Shell/InfoProvider.cpp
    OpenHome/Shell/ShellCommandDebug.cpp
    OpenHome/Shell/ShellCommandLogMode.cpp
    Os/Posix/Os.c
    Os/Posix/File.cpp
    Os/Posix/TerminalOs.cpp
    Os/Posix/SignalHandlers.cpp)
list(TRANSFORM OHNET_SOURCES PREPEND "${OHNET_ROOT}/")
add_library(ohnet_core STATIC ${OHNET_SOURCES})
target_include_directories(ohnet_core SYSTEM PUBLIC "${OHNET_ROOT}/Build/Include")
# Flags of ohNet's Android build (OpenHome/Net/Bindings/Android/jni/Android.mk); third-party
# warnings are silenced instead of promoted to errors.
target_compile_definitions(ohnet_core PUBLIC DEFINE_LITTLE_ENDIAN DEFINE_TRACE PRIVATE _GNU_SOURCE _REENTRANT)
target_compile_options(ohnet_core PRIVATE -fexceptions -w)
set_target_properties(ohnet_core PROPERTIES C_VISIBILITY_PRESET hidden CXX_VISIBILITY_PRESET hidden)
target_link_libraries(ohnet_core PUBLIC log)

add_library(effetune_openhome SHARED
    openhome_jni.cpp
    "${OPENHOME_SIDECAR_ROOT}/src/runtime.cpp"
    "${OPENHOME_SIDECAR_ROOT}/src/protocol.cpp"
    "${OPENHOME_SIDECAR_ROOT}/src/providers.cpp"
    "${OPENHOME_SIDECAR_ROOT}/src/av-providers.cpp"
    "${GENERATED_PROVIDER_DIR}/DvAvOpenhomeOrgProduct1Std.cpp"
    "${GENERATED_PROVIDER_DIR}/DvAvOpenhomeOrgPlaylist1Std.cpp"
    "${GENERATED_PROVIDER_DIR}/DvAvOpenhomeOrgInfo1Std.cpp"
    "${GENERATED_PROVIDER_DIR}/DvAvOpenhomeOrgTime1Std.cpp"
    "${GENERATED_PROVIDER_DIR}/DvAvOpenhomeOrgVolume1Std.cpp"
    "${GENERATED_PROVIDER_DIR}/DvUpnpOrgAVTransport1Std.cpp"
    "${GENERATED_PROVIDER_DIR}/DvUpnpOrgRenderingControl1Std.cpp"
    "${GENERATED_PROVIDER_DIR}/DvUpnpOrgConnectionManager1Std.cpp")
target_include_directories(effetune_openhome PRIVATE "${OPENHOME_SIDECAR_ROOT}/src")
target_include_directories(effetune_openhome SYSTEM PRIVATE "${GENERATED_PROVIDER_DIR}")
target_compile_options(effetune_openhome PRIVATE -Wall -Wextra -Werror)
# Only the JNIEXPORT entry points need to be visible.
set_target_properties(effetune_openhome PROPERTIES CXX_VISIBILITY_PRESET hidden VISIBILITY_INLINES_HIDDEN ON)
target_link_libraries(effetune_openhome PRIVATE ohnet_core)
target_link_options(effetune_openhome PRIVATE "-Wl,-z,max-page-size=16384")
