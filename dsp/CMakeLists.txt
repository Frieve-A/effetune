cmake_minimum_required(VERSION 3.24)

project(effetune_dsp VERSION 1.0.0 LANGUAGES C CXX)

include(CTest)

option(ET_SIMD "Build the WebAssembly SIMD128 variant" OFF)
option(ET_DEBUG_STATE "Expose test-only kernel state inspection" OFF)
option(
  ET_NATIVE_TEST_WARNING_CHECK
  "Compile registered native test sources with Emscripten Clang warnings"
  OFF)

if(ET_NATIVE_TEST_WARNING_CHECK AND NOT EMSCRIPTEN)
  message(FATAL_ERROR
    "ET_NATIVE_TEST_WARNING_CHECK requires the Emscripten Clang toolchain")
endif()

if(ET_NATIVE_TEST_WARNING_CHECK)
  include(CheckCXXSourceCompiles)
  set(CMAKE_REQUIRED_FLAGS
      "-Wall -Wextra -Wpedantic -Werror -Wunused-but-set-variable")
  check_cxx_source_compiles(
    "int main() {
       unsigned count = 0;
       ++count;
       return 0;
     }"
    ET_UNUSED_BUT_SET_VARIABLE_COMPILES)
  unset(CMAKE_REQUIRED_FLAGS)
  if(ET_UNUSED_BUT_SET_VARIABLE_COMPILES)
    message(FATAL_ERROR
      "Clang warning check did not reject an unused-but-set variable")
  endif()
endif()

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
  core/graph.cpp
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
list(
  APPEND EFFETUNE_DSP_SOURCES
  "${CMAKE_CURRENT_SOURCE_DIR}/plugins/lofi/gsm_full_rate_simulator/codec.cpp")

if(NOT EMSCRIPTEN)
  # Golden parity requires separate multiply-add rounding in these kernels.
  set_property(
    SOURCE "${CMAKE_CURRENT_SOURCE_DIR}/plugins/dynamics/auto_leveler/kernel.cpp"
           "${CMAKE_CURRENT_SOURCE_DIR}/plugins/lofi/bluetooth_sbc_simulator/kernel.cpp"
           "${CMAKE_CURRENT_SOURCE_DIR}/plugins/lofi/cassette_artifacts/kernel.cpp"
           "${CMAKE_CURRENT_SOURCE_DIR}/plugins/lofi/tape_artifacts/kernel.cpp"
           "${CMAKE_CURRENT_SOURCE_DIR}/plugins/lofi/vinyl_artifacts/kernel.cpp"
           "${CMAKE_CURRENT_SOURCE_DIR}/plugins/restoration/click_remover/kernel.cpp"
           "${CMAKE_CURRENT_SOURCE_DIR}/plugins/restoration/clip_restorer/kernel.cpp"
           "${CMAKE_CURRENT_SOURCE_DIR}/plugins/restoration/noise_reduction/kernel.cpp"
    APPEND
    PROPERTY COMPILE_OPTIONS
             "$<$<COMPILE_LANG_AND_ID:CXX,AppleClang,Clang,GNU>:-ffp-contract=off>")
endif()

if(BUILD_TESTING)
  list(APPEND EFFETUNE_DSP_SOURCES test/test_kernel.cpp)
endif()

add_library(effetune_dsp_core STATIC ${EFFETUNE_DSP_SOURCES})
target_include_directories(
  effetune_dsp_core
  PUBLIC include bindings/generated
  PRIVATE core generated/cpp)
target_link_libraries(effetune_dsp_core PUBLIC pffft)
target_compile_definitions(
  effetune_dsp_core
  PRIVATE $<$<BOOL:${ET_SIMD}>:ET_SIMD=1>
          $<$<BOOL:${ET_DEBUG_STATE}>:ET_DEBUG_STATE=1>
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
  set(ET_EXPORTED_FUNCTIONS_FILE "${CMAKE_CURRENT_SOURCE_DIR}/exports.txt")
  if(ET_DEBUG_STATE)
    file(READ "${ET_EXPORTED_FUNCTIONS_FILE}" ET_EXPORTED_FUNCTIONS_JSON)
    string(
      REGEX REPLACE
      "\][ \t\r\n]*$"
      ",\n  \"_et_instance_debug_state\",\n  \"_et_instance_debug_state_v2\",\n  \"_et_instance_debug_begin_observation\",\n  \"_et_instance_debug_clear_detector_observation\"\n]\n"
      ET_EXPORTED_FUNCTIONS_JSON
      "${ET_EXPORTED_FUNCTIONS_JSON}")
    set(
      ET_EXPORTED_FUNCTIONS_FILE
      "${CMAKE_CURRENT_BINARY_DIR}/exports-debug-state.txt")
    file(WRITE "${ET_EXPORTED_FUNCTIONS_FILE}" "${ET_EXPORTED_FUNCTIONS_JSON}")
  endif()

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
      -sEXPORTED_FUNCTIONS=@${ET_EXPORTED_FUNCTIONS_FILE}
      -fwasm-exceptions
      $<$<CONFIG:Release>:-O3>
      $<$<CONFIG:Release>:-flto>
      $<$<BOOL:${ET_SIMD}>:-msimd128>)
endif()

if((BUILD_TESTING AND NOT EMSCRIPTEN) OR ET_NATIVE_TEST_WARNING_CHECK)
  # Declares a native test executable linked against effetune_dsp_core with the
  # standard warnings-as-errors options. The Emscripten warning check reuses
  # the same sources, include paths, and definitions as compile-only objects.
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
    if(ET_NATIVE_TEST_WARNING_CHECK)
      add_library(${NAME} OBJECT ${ET_TEST_SOURCES})
      set_property(
        GLOBAL APPEND PROPERTY ET_NATIVE_TEST_WARNING_TARGETS ${NAME})
    else()
      add_executable(${NAME} ${ET_TEST_SOURCES})
    endif()
    if(ET_TEST_INCLUDE_DIRS)
      target_include_directories(${NAME} PRIVATE ${ET_TEST_INCLUDE_DIRS})
    endif()
    target_link_libraries(${NAME} PRIVATE effetune_dsp_core)
    if(MSVC)
      target_compile_options(${NAME} PRIVATE /W4 /WX)
    else()
      target_compile_options(${NAME} PRIVATE -Wall -Wextra -Wpedantic -Werror)
      if(ET_NATIVE_TEST_WARNING_CHECK)
        target_compile_options(
          ${NAME} PRIVATE -Wunused-but-set-variable -fwasm-exceptions)
      elseif(ET_TEST_WRAP_MALLOC)
        target_link_options(${NAME} PRIVATE $<$<CONFIG:Debug>:-Wl,--wrap=malloc>)
      endif()
    endif()
    if(NOT ET_NATIVE_TEST_WARNING_CHECK)
      if(NOT ET_TEST_TEST_NAME)
        set(ET_TEST_TEST_NAME ${NAME})
      endif()
      add_test(NAME ${ET_TEST_TEST_NAME} COMMAND ${NAME} ${ET_TEST_TEST_ARGS})
    endif()
  endfunction()

  et_add_dsp_test(
    effetune_dsp_tests
    SOURCES test/test_main.cpp test/abi_test.cpp test/design_fft_test.cpp test/telemetry_test.cpp
    INCLUDE_DIRS core test
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_graph_tests
    SOURCES test/graph_test.cpp
    INCLUDE_DIRS core
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune-dsp-parity-runner
    SOURCES test/parity_runner.cpp
    INCLUDE_DIRS core
    WRAP_MALLOC
    TEST_NAME effetune_dsp_parity_runner_help
    TEST_ARGS --help)
  et_add_dsp_test(
    effetune_dsp_pffft_incremental_tests
    SOURCES test/pffft_incremental_test.cpp
    INCLUDE_DIRS include)
  set_property(
    TARGET effetune_dsp_pffft_incremental_tests
    PROPERTY LINK_LIBRARIES pffft)
  et_add_dsp_test(
    effetune_dsp_ar_interpolator_tests SOURCES test/ar_interpolator_test.cpp)
  et_add_dsp_test(effetune_dsp_biquad_tests SOURCES test/biquad_test.cpp)
  et_add_dsp_test(effetune_dsp_halfband_tests SOURCES test/halfband_test.cpp)
  et_add_dsp_test(
    effetune_dsp_partitioned_convolver_tests
    SOURCES test/partitioned_convolver_test.cpp
    INCLUDE_DIRS core
    WRAP_MALLOC)
  target_compile_definitions(
    effetune_dsp_partitioned_convolver_tests PRIVATE ET_ENABLE_TEST_KERNEL=1)
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
  et_add_dsp_test(
    effetune_dsp_fir_crossover_tests
    SOURCES plugins/basics/fir_crossover/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
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
    effetune_dsp_bluetooth_sbc_simulator_tests
    SOURCES plugins/lofi/bluetooth_sbc_simulator/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_bluetooth_sbc_conformance_tests
    SOURCES plugins/lofi/bluetooth_sbc_simulator/conformance_test.cpp
    TEST_ARGS --self-test)
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
    effetune_dsp_fm_radio_simulator_tests
    SOURCES plugins/lofi/fm_radio_simulator/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_g726_adpcm_simulator_tests
    SOURCES plugins/lofi/g726_adpcm_simulator/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_gsm_full_rate_conformance_tests
    SOURCES plugins/lofi/gsm_full_rate_simulator/native_test.cpp
            plugins/lofi/gsm_full_rate_simulator/codec.cpp)
  target_compile_definitions(
    effetune_dsp_gsm_full_rate_conformance_tests
    PRIVATE EFFETUNE_GSM_FR_DIAGNOSTICS=1)
  et_add_dsp_test(
    effetune_dsp_gsm_full_rate_simulator_tests
    SOURCES plugins/lofi/gsm_full_rate_simulator/kernel_native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_mp3_codec_simulator_tests
    SOURCES plugins/lofi/mp3_codec_simulator/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_md_simulator_tests
    SOURCES plugins/lofi/md_simulator/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_five_band_dynamic_eq_tests
    SOURCES plugins/eq/five_band_dynamic_eq/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_auto_filter_tests
    SOURCES plugins/modulation/auto_filter/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_auto_pan_tests
    SOURCES plugins/modulation/auto_pan/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_chorus_tests
    SOURCES plugins/modulation/chorus/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_doppler_distortion_tests
    SOURCES plugins/modulation/doppler_distortion/native_test.cpp)
  et_add_dsp_test(
    effetune_dsp_frequency_shifter_tests
    SOURCES plugins/modulation/frequency_shifter/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_phaser_tests
    SOURCES plugins/modulation/phaser/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_pitch_shifter_tests
    SOURCES plugins/modulation/pitch_shifter/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_pitch_shifter_hq_tests
    SOURCES plugins/modulation/pitch_shifter_hq/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_rotary_speaker_tests
    SOURCES plugins/modulation/rotary_speaker/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_am_radio_simulator_tests
    SOURCES plugins/lofi/am_radio_simulator/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_sw_radio_simulator_tests
    SOURCES plugins/lofi/sw_radio_simulator/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_cassette_artifacts_tests
    SOURCES plugins/lofi/cassette_artifacts/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_tape_artifacts_tests
    SOURCES plugins/lofi/tape_artifacts/native_test.cpp
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
    effetune_dsp_click_remover_tests
    SOURCES plugins/restoration/click_remover/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_clip_restorer_tests
    SOURCES plugins/restoration/clip_restorer/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_hum_remover_tests
    SOURCES plugins/restoration/hum_remover/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_noise_reduction_tests
    SOURCES plugins/restoration/noise_reduction/native_test.cpp
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
    effetune_dsp_five_band_fir_peq_tests
    SOURCES plugins/eq/five_band_fir_peq/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_group_delay_eq_tests
    SOURCES plugins/eq/group_delay_eq/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_group_delay_peq_tests
    SOURCES plugins/eq/group_delay_peq/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_bandwidth_extender_tests
    SOURCES plugins/saturation/bandwidth_extender/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_multiband_saturation_tests
    SOURCES plugins/saturation/multiband_saturation/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_tube_simulator_tests
    SOURCES plugins/saturation/tube_simulator/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  file(
    SHA256
    "${CMAKE_CURRENT_SOURCE_DIR}/plugins/saturation/tube_simulator/kernel.cpp"
    ET_TUBE_NATIVE_TEST_KERNEL_SHA256)
  file(
    SHA256
    "${CMAKE_CURRENT_SOURCE_DIR}/plugins/saturation/tube_simulator/native_test.cpp"
    ET_TUBE_NATIVE_TEST_HARNESS_SHA256)
  file(
    SHA256
    "${CMAKE_CURRENT_SOURCE_DIR}/generated/cpp/TubeSimulatorPluginParams.h"
    ET_TUBE_NATIVE_TEST_PARAMS_SHA256)
  file(
    SHA256
    "${CMAKE_CURRENT_SOURCE_DIR}/plugins/saturation/tube_simulator/fir_coefficients.generated.h"
    ET_TUBE_NATIVE_TEST_FIR_SHA256)
  file(
    SHA256
    "${CMAKE_CURRENT_SOURCE_DIR}/plugins/saturation/tube_simulator/tube_feedback_table.generated.h"
    ET_TUBE_NATIVE_TEST_FEEDBACK_TABLE_SHA256)
  file(
    SHA256
    "${CMAKE_CURRENT_SOURCE_DIR}/plugins/saturation/tube_simulator/phase_c_tables.generated.h"
    ET_TUBE_NATIVE_TEST_PHASE_C_TABLE_SHA256)
  string(
    SHA256
    ET_TUBE_NATIVE_TEST_BUILD_SHA256
    "${ET_TUBE_NATIVE_TEST_KERNEL_SHA256}:${ET_TUBE_NATIVE_TEST_HARNESS_SHA256}:${ET_TUBE_NATIVE_TEST_PARAMS_SHA256}:${ET_TUBE_NATIVE_TEST_FIR_SHA256}:${ET_TUBE_NATIVE_TEST_FEEDBACK_TABLE_SHA256}:${ET_TUBE_NATIVE_TEST_PHASE_C_TABLE_SHA256}")
  target_compile_definitions(
    effetune_dsp_tube_simulator_tests
    PRIVATE
      ET_TUBE_NATIVE_TEST_KERNEL_SHA256="${ET_TUBE_NATIVE_TEST_KERNEL_SHA256}"
      ET_TUBE_NATIVE_TEST_HARNESS_SHA256="${ET_TUBE_NATIVE_TEST_HARNESS_SHA256}"
      ET_TUBE_NATIVE_TEST_PARAMS_SHA256="${ET_TUBE_NATIVE_TEST_PARAMS_SHA256}"
      ET_TUBE_NATIVE_TEST_FIR_SHA256="${ET_TUBE_NATIVE_TEST_FIR_SHA256}"
      ET_TUBE_NATIVE_TEST_FEEDBACK_TABLE_SHA256="${ET_TUBE_NATIVE_TEST_FEEDBACK_TABLE_SHA256}"
      ET_TUBE_NATIVE_TEST_PHASE_C_TABLE_SHA256="${ET_TUBE_NATIVE_TEST_PHASE_C_TABLE_SHA256}"
      ET_TUBE_NATIVE_TEST_BUILD_SHA256="${ET_TUBE_NATIVE_TEST_BUILD_SHA256}"
      ET_TUBE_STANDARD_V1_GOLDEN_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../tests/fixtures/tube-simulator/p3-baseline-v1/golden")
  et_add_dsp_test(
    effetune_dsp_multiband_balance_tests
    SOURCES plugins/spatial/multiband_balance/native_test.cpp
    INCLUDE_DIRS core
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_crosstalk_cancellation_tests
    SOURCES plugins/spatial/crosstalk_cancellation/native_test.cpp
    INCLUDE_DIRS core generated/cpp
    WRAP_MALLOC)
  et_add_dsp_test(
    effetune_dsp_phase_select_eq_tests
    SOURCES plugins/spatial/phase_select_eq/native_test.cpp
    INCLUDE_DIRS core generated/cpp
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

  if(ET_NATIVE_TEST_WARNING_CHECK)
    get_property(
      ET_NATIVE_TEST_WARNING_TARGETS
      GLOBAL PROPERTY ET_NATIVE_TEST_WARNING_TARGETS)
    add_custom_target(
      effetune_dsp_native_test_warning_check
      DEPENDS ${ET_NATIVE_TEST_WARNING_TARGETS})
  else()
    find_program(ET_NODE_EXECUTABLE node)
    if(ET_NODE_EXECUTABLE)
      add_test(
        NAME effetune_dsp_codegen_tests
        COMMAND ${ET_NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/test/codegen_test.mjs)
      add_test(
        NAME effetune_dsp_tube_simulator_standard_v1_projection
        COMMAND
          ${CMAKE_COMMAND} -E env
          "ET_TUBE_NATIVE_RUNNER=$<TARGET_FILE:effetune-dsp-parity-runner>"
          ${ET_NODE_EXECUTABLE} --test
          ${CMAKE_CURRENT_SOURCE_DIR}/../tests/esm/dsp-tube-simulator-standard-v1-fixture.test.mjs)
    endif()
  endif()
endif()
