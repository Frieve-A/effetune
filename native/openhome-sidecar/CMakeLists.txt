cmake_minimum_required(VERSION 3.21)
project(effetune_openhome_sidecar LANGUAGES CXX)

if(NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "The OpenHome sidecar requires a 64-bit target")
endif()
foreach(required OHNET_ROOT OHNET_GENERATED_ROOT OHNET_LIBRARY SIDECAR_OUTPUT_DIRECTORY)
  if(NOT DEFINED ${required})
    message(FATAL_ERROR "${required} must be provided by build-openhome-sidecar.mjs")
  endif()
endforeach()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(MSVC)
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded")
endif()

set(GENERATED_PROVIDER_DIR
    "${OHNET_GENERATED_ROOT}/OpenHome/Net/Bindings/Cpp/Device/Providers")
set(GENERATED_PROVIDER_SOURCES
    "${GENERATED_PROVIDER_DIR}/DvAvOpenhomeOrgProduct1Std.cpp"
    "${GENERATED_PROVIDER_DIR}/DvAvOpenhomeOrgPlaylist1Std.cpp"
    "${GENERATED_PROVIDER_DIR}/DvAvOpenhomeOrgInfo1Std.cpp"
    "${GENERATED_PROVIDER_DIR}/DvAvOpenhomeOrgTime1Std.cpp")

add_executable(effetune-openhome-sidecar
    src/main.cpp
    src/protocol.cpp
    src/providers.cpp
    ${GENERATED_PROVIDER_SOURCES})
target_include_directories(effetune-openhome-sidecar PRIVATE src)
target_include_directories(effetune-openhome-sidecar SYSTEM PRIVATE
    "${OHNET_ROOT}/Build/Include"
    "${GENERATED_PROVIDER_DIR}")
target_compile_definitions(effetune-openhome-sidecar PRIVATE DEFINE_LITTLE_ENDIAN)
if(MSVC)
  target_compile_definitions(effetune-openhome-sidecar PRIVATE _CRT_SECURE_NO_WARNINGS)
  target_compile_options(effetune-openhome-sidecar PRIVATE /W4 /utf-8 /EHsc)
  target_link_libraries(effetune-openhome-sidecar PRIVATE
      "${OHNET_LIBRARY}" ws2_32 iphlpapi dbghelp)
else()
  find_package(Threads REQUIRED)
  target_compile_options(effetune-openhome-sidecar PRIVATE -Wall -Wextra -Werror)
  target_link_libraries(effetune-openhome-sidecar PRIVATE "${OHNET_LIBRARY}" Threads::Threads)
  if(APPLE)
    target_link_libraries(effetune-openhome-sidecar PRIVATE
        "-framework CoreFoundation"
        "-framework SystemConfiguration"
        "-framework IOKit")
  else()
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(LIBNL REQUIRED IMPORTED_TARGET libnl-3.0 libnl-genl-3.0)
    target_link_libraries(effetune-openhome-sidecar PRIVATE PkgConfig::LIBNL)
    set_target_properties(effetune-openhome-sidecar PROPERTIES
        BUILD_RPATH "$ORIGIN"
        INSTALL_RPATH "$ORIGIN")
  endif()
endif()
set_target_properties(effetune-openhome-sidecar PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${SIDECAR_OUTPUT_DIRECTORY}")

enable_testing()
add_executable(openhome-protocol-test
    tests/protocol_test.cpp
    src/protocol.cpp)
target_include_directories(openhome-protocol-test PRIVATE src)
if(MSVC)
  target_compile_options(openhome-protocol-test PRIVATE /W4 /utf-8 /EHsc)
else()
  target_compile_options(openhome-protocol-test PRIVATE -Wall -Wextra -Werror)
endif()
set_target_properties(openhome-protocol-test PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/tests")
add_test(NAME openhome-protocol COMMAND openhome-protocol-test)
