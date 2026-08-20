cmake_minimum_required(VERSION 3.24)

project(effetune_dsp_library_phase0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Python 3.10 COMPONENTS Interpreter Development.Module REQUIRED)
find_package(nanobind CONFIG REQUIRED)

get_filename_component(ET_REPOSITORY_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)

# Compile the existing kernel into a private static target. The PoC intentionally
# does not expose or dynamically link the repository's C ABI.
add_library(
  phase0_compressor_kernel STATIC
  "${ET_REPOSITORY_ROOT}/dsp/core/telemetry.cpp"
  "${ET_REPOSITORY_ROOT}/dsp/plugins/dynamics/compressor/kernel.cpp")
set_target_properties(phase0_compressor_kernel PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(
  phase0_compressor_kernel
  PRIVATE
    "${ET_REPOSITORY_ROOT}/dsp/core"
    "${ET_REPOSITORY_ROOT}/dsp/include"
    "${ET_REPOSITORY_ROOT}/dsp/generated/cpp"
    "${ET_REPOSITORY_ROOT}/dsp/plugins/dynamics/compressor")

nanobind_add_module(_native NB_STATIC src/python_module.cpp)
target_include_directories(
  _native
  PRIVATE
    "${ET_REPOSITORY_ROOT}/dsp/include"
    "${ET_REPOSITORY_ROOT}/dsp/generated/cpp")
target_link_libraries(_native PRIVATE phase0_compressor_kernel)

if(MSVC)
  target_compile_options(phase0_compressor_kernel PRIVATE /W4 /WX)
  target_compile_options(_native PRIVATE /W4 /WX)
else()
  target_compile_options(
    phase0_compressor_kernel PRIVATE -Wall -Wextra -Wpedantic -Werror)
  target_compile_options(_native PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

install(
  TARGETS _native
  LIBRARY DESTINATION effetune_phase0
  RUNTIME DESTINATION effetune_phase0)
