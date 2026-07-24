cmake_minimum_required(VERSION 3.24)

project(effetune_dsp VERSION 1.0.0 LANGUAGES C CXX)

include(CTest)

option(ET_SIMD "Build the WebAssembly SIMD128 variant" OFF)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(
  pffft STATIC
  vendor/pffft/src/pffft.c
  vendor/pffft/src/pffft_common.c)
target_include_directories(
  pffft
  PUBLIC vendor/pffft/include/pffft
  PRIVATE vendor/pffft/src)
target_compile_definitions(
  pffft
  PUBLIC PFFFT_STATIC_DEFINE=1
  PRIVATE $<$<BOOL:${ET_SIMD}>:PFFFT_ENABLE_NEON=1>
          $<$<NOT:$<BOOL:${ET_SIMD}>>:PFFFT_SIMD_DISABLE=1>)
if(ET_SIMD AND EMSCRIPTEN)
  target_compile_options(pffft PRIVATE -msimd128)
endif()
set_target_properties(pffft PROPERTIES POSITION_INDEPENDENT_CODE ON)
if(NOT MSVC)
  target_link_libraries(pffft PUBLIC m)
endif()

set(
  EFFETUNE_DSP_SOURCES
  core/allocation_guard.cpp
  core/abi.cpp
  core/arena.cpp
  core/design_fft.cpp
  core/engine.cpp
  core/partitioned_convolver.cpp
  core/registry.cpp
  core/telemetry.cpp)

set_property(
  SOURCE core/registry.cpp
  APPEND
  PROPERTY OBJECT_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/registry.inc")

file(
  GLOB_RECURSE EFFETUNE_PLUGIN_SOURCES
  CONFIGURE_DEPENDS
  "${CMAKE_CURRENT_SOURCE_DIR}/plugins/*/kernel.cpp")
list(APPEND EFFETUNE_DSP_SOURCES ${EFFETUNE_PLUGIN_SOURCES})

if(BUILD_TESTING)
  list(APPEND EFFETUNE_DSP_SOURCES test/test_kernel.cpp)
endif()

add_library(effetune_dsp_core STATIC ${EFFETUNE_DSP_SOURCES})
target_include_directories(
  effetune_dsp_core
  PUBLIC include
  PRIVATE core generated/cpp)
target_link_libraries(effetune_dsp_core PUBLIC pffft)
target_compile_definitions(
  effetune_dsp_core
  PRIVATE $<$<BOOL:${ET_SIMD}>:ET_SIMD=1>
          $<$<CONFIG:Debug>:ET_DEBUG_BUILD=1>
          $<$<CONFIG:Debug>:ET_ALLOCATION_GUARD=1>
          $<$<AND:$<CONFIG:Debug>,$<NOT:$<CXX_COMPILER_ID:MSVC>>>:ET_WRAP_MALLOC=1>
          $<$<BOOL:${BUILD_TESTING}>:ET_ENABLE_TEST_KERNEL=1>)
target_link_options(
  effetune_dsp_core
  INTERFACE
    $<$<AND:$<CONFIG:Debug>,$<NOT:$<CXX_COMPILER_ID:MSVC>>>:-Wl,--wrap=malloc>)

if(MSVC)
  target_compile_options(effetune_dsp_core PRIVATE /W4 /WX /GR-)
elseif(EMSCRIPTEN)
  target_compile_definitions(
    effetune_dsp_core PRIVATE ET_ENABLE_LIFECYCLE_EXCEPTION_BOUNDARY=1)
  target_compile_options(
    effetune_dsp_core PRIVATE -Wall -Wextra -Wpedantic -Werror
                              -fwasm-exceptions -fno-rtti)
else()
  target_compile_options(
    effetune_dsp_core PRIVATE -Wall -Wextra -Wpedantic -Werror -fno-exceptions
                              -fno-rtti)
endif()

if(EMSCRIPTEN)
  add_executable(effetune-dsp wasm/no_entry.cpp)
  target_link_libraries(effetune-dsp PRIVATE effetune_dsp_core)
  set_target_properties(effetune-dsp PROPERTIES OUTPUT_NAME "effetune-dsp" SUFFIX ".wasm")

  target_compile_options(
    effetune_dsp_core PRIVATE $<$<CONFIG:Release>:-O3> $<$<CONFIG:Release>:-flto>
                              $<$<BOOL:${ET_SIMD}>:-msimd128>)
  target_link_options(
    effetune-dsp
    PRIVATE
      --no-entry
      -sSTANDALONE_WASM=1
      -sALLOW_MEMORY_GROWTH=1
      -sINITIAL_MEMORY=8388608
      -sMAXIMUM_MEMORY=268435456
      -sEXPORTED_FUNCTIONS=@${CMAKE_CURRENT_SOURCE_DIR}/exports.txt
      -fwasm-exceptions
      $<$<CONFIG:Release>:-O3>
      $<$<CONFIG:Release>:-flto>
      $<$<BOOL:${ET_SIMD}>:-msimd128>)
endif()

if(BUILD_TESTING AND NOT EMSCRIPTEN)
  # Declares a native test executable linked against effetune_dsp_core with the
  # standard warnings-as-errors options.
  #   et_add_dsp_test(<target>
  #     SOURCES <src>...
  #     [INCLUDE_DIRS <dir>...]        # extra private include directories
  #     [WRAP_MALLOC]                  # Debug-only -Wl,--wrap=malloc (non-MSVC)
  #     [TEST_NAME <name>]             # CTest name, defaults to the target name
  #     [TEST_ARGS <arg>...])          # extra arguments for the test command
  function(et_add_dsp_test NAME)
    cmake_parse_arguments(
      ET_TEST "WRAP_MALLOC" "TEST_NAME" "SOURCES;INCLUDE_DIRS;TEST_ARGS" ${ARGN})
    if(ET_TEST_UNPARSED_ARGUMENTS)
      message(FATAL_ERROR
        "et_add_dsp_test(${NAME}): unknown arguments: ${ET_TEST_UNPARSED_ARGUMENTS}")
    endif()
    add_executable(${NAME} ${ET_TEST_SOURCES})
    if(ET_TEST_INCLUDE_DIRS)
      target_include_directories(${NAME} PRIVATE ${ET_TEST_INCLUDE_DIRS})
    endif()
    target_link_libraries(${NAME} PRIVATE effetune_dsp_core)
    if(MSVC)
      target_compile_options(${NAME} PRIVATE /W4 /WX)
    else()
      target_compile_options(${NAME} PRIVATE -Wall -Wextra -Wpedantic -Werror)
      if(ET_TEST_WRAP_MALLOC)
        target_link_options(${NAME} PRIVATE $<$<CONFIG:Debug>:-Wl,--wrap=malloc>)
      endif()
    endif()
    if(NOT ET_TEST_TEST_NAME)
      set(ET_TEST_TEST_NAME ${NAME})
    endif()
    add_test(NAME ${ET_TEST_TEST_NAME} COMMAND ${NAME} ${ET_TEST_TEST_ARGS})
  endfunction()

  et_add_dsp_test(
    effetune_dsp_tests
    SOURCES test/test_main.cpp test/abi_test.cpp test/design_fft_test.cpp test/telemetry_test.cpp
    INCLUDE_DIRS core test
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune-dsp-parity-runner
    SOURCES test/parity_runner.cpp
    INCLUDE_DIRS core
    WRAP_MALLOC
    TEST_NAME effetune_dsp_parity_runner_help
    TEST_ARGS --help)
  et_add_dsp_test(effetune_dsp_biquad_tests SOURCES test/biquad_test.cpp)
  et_add_dsp_test(effetune_dsp_halfband_tests SOURCES test/halfband_test.cpp)
  et_add_dsp_test(
    effetune_dsp_partitioned_convolver_tests
    SOURCES test/partitioned_convolver_test.cpp
    INCLUDE_DIRS core
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_phase3b_group_b_descriptor_tests
    SOURCES test/phase3b_group_b_descriptor_test.cpp)
  et_add_dsp_test(
    effetune_dsp_level_meter_tests SOURCES test/level_meter_frame_test.cpp)
  et_add_dsp_test(
    effetune_dsp_oscilloscope_tests SOURCES test/oscilloscope_frame_test.cpp)
  et_add_dsp_test(
    effetune_dsp_spectrum_analyzer_tests
    SOURCES plugins/analyzer/spectrum_analyzer/native_test.cpp)
  et_add_dsp_test(
    effetune_dsp_spectrogram_tests
    SOURCES plugins/analyzer/spectrogram/native_test.cpp)
  et_add_dsp_test(
    effetune_dsp_stereo_meter_tests
    SOURCES plugins/analyzer/stereo_meter/native_test.cpp)
  et_add_dsp_test(
    effetune_dsp_basics_topology_tests
    SOURCES plugins/basics/topology_native_test.cpp)
  et_add_dsp_test(effetune_dsp_primitives_tests SOURCES test/primitives_test.cpp)
  et_add_dsp_test(
    effetune_dsp_dynamics_group_a_tests
    SOURCES test/dynamics_group_a_frame_test.cpp)
  et_add_dsp_test(
    effetune_dsp_dynamics_group_b_tests
    SOURCES test/dynamics_group_b_frame_test.cpp)
  et_add_dsp_test(
    effetune_dsp_power_amp_sag_tests
    SOURCES plugins/dynamics/power_amp_sag/native_test.cpp)
  et_add_dsp_test(
    effetune_dsp_multiband_tests
    SOURCES plugins/dynamics/multiband_native_test.cpp)
  et_add_dsp_test(
    effetune_dsp_wave3c_saturation_descriptor_tests
    SOURCES test/wave3c_saturation_descriptor_test.cpp)
  et_add_dsp_test(
    effetune_dsp_wave3c_sub_synth_state_tests
    SOURCES test/wave3c_sub_synth_state_test.cpp
    INCLUDE_DIRS generated/cpp)
  et_add_dsp_test(
    effetune_dsp_digital_error_emulator_tests
    SOURCES plugins/lofi/digital_error_emulator/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_dsd64_imd_simulator_tests
    SOURCES plugins/lofi/dsd64_imd_simulator/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_five_band_dynamic_eq_tests
    SOURCES plugins/eq/five_band_dynamic_eq/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_doppler_distortion_tests
    SOURCES plugins/modulation/doppler_distortion/native_test.cpp)
  et_add_dsp_test(
    effetune_dsp_pitch_shifter_tests
    SOURCES plugins/modulation/pitch_shifter/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_vinyl_artifacts_tests
    SOURCES plugins/lofi/vinyl_artifacts/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_vinyl_simulator_tests
    SOURCES plugins/lofi/vinyl_simulator/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_wow_flutter_tests
    SOURCES plugins/modulation/wow_flutter/native_test.cpp)
  et_add_dsp_test(
    effetune_dsp_horn_resonator_tests
    SOURCES plugins/resonator/horn_native_test.cpp
    INCLUDE_DIRS core
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_modal_resonator_tests
    SOURCES plugins/resonator/modal_resonator/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_reverb_tests
    SOURCES plugins/reverb/reverb_native_test.cpp
    INCLUDE_DIRS core
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_ir_reverb_tests
    SOURCES plugins/reverb/ir_reverb/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_room_eq_tests
    SOURCES plugins/eq/room_eq/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_multiband_saturation_tests
    SOURCES plugins/saturation/multiband_saturation/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_multiband_balance_tests
    SOURCES plugins/spatial/multiband_balance/native_test.cpp
    INCLUDE_DIRS core
    WRAP_MALLOC)

  if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    add_executable(effetune_dsp_allocation_guard_probe test/allocation_guard_probe.cpp)
    target_include_directories(effetune_dsp_allocation_guard_probe PRIVATE core)
    target_link_libraries(effetune_dsp_allocation_guard_probe PRIVATE effetune_dsp_core)
    if(NOT MSVC)
      target_link_options(
        effetune_dsp_allocation_guard_probe PRIVATE -Wl,--wrap=malloc)
    endif()
    add_test(
      NAME effetune_dsp_allocation_guard
      COMMAND effetune_dsp_allocation_guard_probe)
  endif()

  find_program(ET_NODE_EXECUTABLE node)
  if(ET_NODE_EXECUTABLE)
    add_test(
      NAME effetune_dsp_codegen_tests
      COMMAND ${ET_NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/test/codegen_test.mjs)
  endif()
endif()
