cmake_minimum_required(VERSION 3.24)

project(effetune_python LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

option(
  ET_PYTHON_STABLE_ABI
  "Build a CPython 3.12+ nanobind stable-ABI extension (set wheel.py-api=cp312 too)"
  OFF)

if(ET_PYTHON_STABLE_ABI)
  if(CMAKE_VERSION VERSION_LESS 3.26)
    message(FATAL_ERROR "The Python stable ABI build requires CMake 3.26 or newer")
  endif()
  find_package(
    Python 3.12
    COMPONENTS Interpreter Development.Module Development.SABIModule
    REQUIRED)
else()
  find_package(Python 3.10 COMPONENTS Interpreter Development.Module REQUIRED)
endif()
find_package(nanobind CONFIG REQUIRED)

get_filename_component(ET_DSP_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
set(BUILD_TESTING OFF CACHE BOOL "Do not build DSP core tests for the Python wheel" FORCE)
add_subdirectory("${ET_DSP_ROOT}" "${CMAKE_CURRENT_BINARY_DIR}/dsp-core")

if(ET_PYTHON_STABLE_ABI)
  nanobind_add_module(_native STABLE_ABI NB_STATIC native/module.cpp)
else()
  nanobind_add_module(_native NB_STATIC native/module.cpp)
endif()

foreach(
  target
  IN ITEMS _native effetune_dsp_core pffft nanobind-static nanobind-static-abi3)
  if(TARGET "${target}")
    set_target_properties(
      "${target}"
      PROPERTIES
        C_VISIBILITY_PRESET hidden
        CXX_VISIBILITY_PRESET hidden
        VISIBILITY_INLINES_HIDDEN ON)
  endif()
endforeach()

if(APPLE)
  target_link_options(_native PRIVATE "-Wl,-exported_symbol,_PyInit__native")
elseif(UNIX)
  target_link_options(
    _native
    PRIVATE
      "-Wl,--exclude-libs,ALL"
      "-Wl,--version-script=${CMAKE_CURRENT_SOURCE_DIR}/native/exports.map")
endif()

target_include_directories(
  _native
  PRIVATE
    "${ET_DSP_ROOT}/core"
    "${ET_DSP_ROOT}/include")
target_link_libraries(_native PRIVATE effetune_dsp_core)

if(MSVC)
  target_compile_options(_native PRIVATE /W4 /WX)
else()
  target_compile_options(_native PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

install(TARGETS _native LIBRARY DESTINATION effetune RUNTIME DESTINATION effetune)
