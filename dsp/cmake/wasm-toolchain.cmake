if(NOT DEFINED ENV{EMSDK})
  message(FATAL_ERROR "EMSDK must point to the activated emsdk root")
endif()

file(TO_CMAKE_PATH "$ENV{EMSDK}" ET_EMSDK_ROOT)
set(
  ET_EMSCRIPTEN_TOOLCHAIN
  "${ET_EMSDK_ROOT}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake")
if(NOT EXISTS "${ET_EMSCRIPTEN_TOOLCHAIN}")
  message(FATAL_ERROR "Emscripten toolchain not found: ${ET_EMSCRIPTEN_TOOLCHAIN}")
endif()

include("${ET_EMSCRIPTEN_TOOLCHAIN}")
