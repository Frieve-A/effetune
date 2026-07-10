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
  core/engine.cpp
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
      -sMAXIMUM_MEMORY=67108864
      -sEXPORTED_FUNCTIONS=@${CMAKE_CURRENT_SOURCE_DIR}/exports.txt
      -fwasm-exceptions
      $<$<CONFIG:Release>:-O3>
      $<$<CONFIG:Release>:-flto>
      $<$<CONFIG:Debug>:-O1>
      $<$<CONFIG:Debug>:-g>
      $<$<CONFIG:Debug>:-sASSERTIONS=2>
      $<$<CONFIG:Debug>:-sSTACK_OVERFLOW_CHECK=0>
      $<$<CONFIG:Debug>:-Wl,--wrap=malloc>
      $<$<BOOL:${ET_SIMD}>:-msimd128>)
endif()

if(BUILD_TESTING AND NOT EMSCRIPTEN)
  add_executable(
    effetune_dsp_tests
    test/test_main.cpp
    test/abi_test.cpp
    test/telemetry_test.cpp)
  target_include_directories(effetune_dsp_tests PRIVATE core test)
  target_link_libraries(effetune_dsp_tests PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune_dsp_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(effetune_dsp_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
    target_link_options(
      effetune_dsp_tests PRIVATE $<$<CONFIG:Debug>:-Wl,--wrap=malloc>)
  endif()
  add_test(NAME effetune_dsp_tests COMMAND effetune_dsp_tests)

  add_executable(effetune-dsp-parity-runner test/parity_runner.cpp)
  target_include_directories(effetune-dsp-parity-runner PRIVATE core)
  target_link_libraries(effetune-dsp-parity-runner PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune-dsp-parity-runner PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune-dsp-parity-runner PRIVATE -Wall -Wextra -Wpedantic -Werror)
    target_link_options(
      effetune-dsp-parity-runner PRIVATE $<$<CONFIG:Debug>:-Wl,--wrap=malloc>)
  endif()
  add_test(NAME effetune_dsp_parity_runner_help COMMAND effetune-dsp-parity-runner --help)

  add_executable(effetune_dsp_biquad_tests test/biquad_test.cpp)
  target_link_libraries(effetune_dsp_biquad_tests PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune_dsp_biquad_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_biquad_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  add_test(NAME effetune_dsp_biquad_tests COMMAND effetune_dsp_biquad_tests)

  add_executable(
    effetune_dsp_phase3b_group_b_descriptor_tests
    test/phase3b_group_b_descriptor_test.cpp)
  target_link_libraries(
    effetune_dsp_phase3b_group_b_descriptor_tests
    PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(
      effetune_dsp_phase3b_group_b_descriptor_tests
      PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_phase3b_group_b_descriptor_tests
      PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  add_test(
    NAME effetune_dsp_phase3b_group_b_descriptor_tests
    COMMAND effetune_dsp_phase3b_group_b_descriptor_tests)

  add_executable(effetune_dsp_level_meter_tests test/level_meter_frame_test.cpp)
  target_link_libraries(effetune_dsp_level_meter_tests PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune_dsp_level_meter_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_level_meter_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  add_test(
    NAME effetune_dsp_level_meter_tests
    COMMAND effetune_dsp_level_meter_tests)

  add_executable(effetune_dsp_oscilloscope_tests test/oscilloscope_frame_test.cpp)
  target_link_libraries(effetune_dsp_oscilloscope_tests PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune_dsp_oscilloscope_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_oscilloscope_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  add_test(
    NAME effetune_dsp_oscilloscope_tests
    COMMAND effetune_dsp_oscilloscope_tests)

  add_executable(
    effetune_dsp_spectrum_analyzer_tests
    plugins/analyzer/spectrum_analyzer/native_test.cpp)
  target_link_libraries(effetune_dsp_spectrum_analyzer_tests PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune_dsp_spectrum_analyzer_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_spectrum_analyzer_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  add_test(
    NAME effetune_dsp_spectrum_analyzer_tests
    COMMAND effetune_dsp_spectrum_analyzer_tests)

  add_executable(
    effetune_dsp_spectrogram_tests
    plugins/analyzer/spectrogram/native_test.cpp)
  target_link_libraries(effetune_dsp_spectrogram_tests PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune_dsp_spectrogram_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_spectrogram_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  add_test(
    NAME effetune_dsp_spectrogram_tests
    COMMAND effetune_dsp_spectrogram_tests)

  add_executable(
    effetune_dsp_stereo_meter_tests
    plugins/analyzer/stereo_meter/native_test.cpp)
  target_link_libraries(effetune_dsp_stereo_meter_tests PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune_dsp_stereo_meter_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_stereo_meter_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  add_test(
    NAME effetune_dsp_stereo_meter_tests
    COMMAND effetune_dsp_stereo_meter_tests)

  add_executable(
    effetune_dsp_basics_topology_tests
    plugins/basics/topology_native_test.cpp)
  target_link_libraries(effetune_dsp_basics_topology_tests PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune_dsp_basics_topology_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_basics_topology_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  add_test(
    NAME effetune_dsp_basics_topology_tests
    COMMAND effetune_dsp_basics_topology_tests)

  add_executable(effetune_dsp_primitives_tests test/primitives_test.cpp)
  target_link_libraries(effetune_dsp_primitives_tests PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune_dsp_primitives_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_primitives_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  add_test(NAME effetune_dsp_primitives_tests COMMAND effetune_dsp_primitives_tests)

  add_executable(
    effetune_dsp_dynamics_group_a_tests
    test/dynamics_group_a_frame_test.cpp)
  target_link_libraries(effetune_dsp_dynamics_group_a_tests PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune_dsp_dynamics_group_a_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_dynamics_group_a_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  add_test(
    NAME effetune_dsp_dynamics_group_a_tests
    COMMAND effetune_dsp_dynamics_group_a_tests)

  add_executable(
    effetune_dsp_dynamics_group_b_tests
    test/dynamics_group_b_frame_test.cpp)
  target_link_libraries(effetune_dsp_dynamics_group_b_tests PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune_dsp_dynamics_group_b_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_dynamics_group_b_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  add_test(
    NAME effetune_dsp_dynamics_group_b_tests
    COMMAND effetune_dsp_dynamics_group_b_tests)

  add_executable(
    effetune_dsp_power_amp_sag_tests
    plugins/dynamics/power_amp_sag/native_test.cpp)
  target_link_libraries(effetune_dsp_power_amp_sag_tests PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune_dsp_power_amp_sag_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_power_amp_sag_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  add_test(
    NAME effetune_dsp_power_amp_sag_tests
    COMMAND effetune_dsp_power_amp_sag_tests)

  add_executable(
    effetune_dsp_multiband_tests
    plugins/dynamics/multiband_native_test.cpp)
  target_link_libraries(effetune_dsp_multiband_tests PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune_dsp_multiband_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_multiband_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  add_test(
    NAME effetune_dsp_multiband_tests
    COMMAND effetune_dsp_multiband_tests)

  add_executable(
    effetune_dsp_wave3c_saturation_descriptor_tests
    test/wave3c_saturation_descriptor_test.cpp)
  target_link_libraries(
    effetune_dsp_wave3c_saturation_descriptor_tests
    PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(
      effetune_dsp_wave3c_saturation_descriptor_tests
      PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_wave3c_saturation_descriptor_tests
      PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  add_test(
    NAME effetune_dsp_wave3c_saturation_descriptor_tests
    COMMAND effetune_dsp_wave3c_saturation_descriptor_tests)

  add_executable(
    effetune_dsp_wave3c_sub_synth_state_tests
    test/wave3c_sub_synth_state_test.cpp)
  target_link_libraries(
    effetune_dsp_wave3c_sub_synth_state_tests
    PRIVATE effetune_dsp_core)
  target_include_directories(
    effetune_dsp_wave3c_sub_synth_state_tests
    PRIVATE generated/cpp)
  if(MSVC)
    target_compile_options(
      effetune_dsp_wave3c_sub_synth_state_tests
      PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_wave3c_sub_synth_state_tests
      PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  add_test(
    NAME effetune_dsp_wave3c_sub_synth_state_tests
    COMMAND effetune_dsp_wave3c_sub_synth_state_tests)

  add_executable(
    effetune_dsp_digital_error_emulator_tests
    plugins/lofi/digital_error_emulator/native_test.cpp)
  target_link_libraries(
    effetune_dsp_digital_error_emulator_tests
    PRIVATE effetune_dsp_core)
  target_include_directories(
    effetune_dsp_digital_error_emulator_tests
    PRIVATE core generated/cpp)
  if(MSVC)
    target_compile_options(
      effetune_dsp_digital_error_emulator_tests
      PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_digital_error_emulator_tests
      PRIVATE -Wall -Wextra -Wpedantic -Werror)
    target_link_options(
      effetune_dsp_digital_error_emulator_tests
      PRIVATE $<$<CONFIG:Debug>:-Wl,--wrap=malloc>)
  endif()
  add_test(
    NAME effetune_dsp_digital_error_emulator_tests
    COMMAND effetune_dsp_digital_error_emulator_tests)

  add_executable(
    effetune_dsp_dsd64_imd_simulator_tests
    plugins/lofi/dsd64_imd_simulator/native_test.cpp)
  target_link_libraries(
    effetune_dsp_dsd64_imd_simulator_tests
    PRIVATE effetune_dsp_core)
  target_include_directories(
    effetune_dsp_dsd64_imd_simulator_tests
    PRIVATE core generated/cpp)
  if(MSVC)
    target_compile_options(
      effetune_dsp_dsd64_imd_simulator_tests
      PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_dsd64_imd_simulator_tests
      PRIVATE -Wall -Wextra -Wpedantic -Werror)
    target_link_options(
      effetune_dsp_dsd64_imd_simulator_tests
      PRIVATE $<$<CONFIG:Debug>:-Wl,--wrap=malloc>)
  endif()
  add_test(
    NAME effetune_dsp_dsd64_imd_simulator_tests
    COMMAND effetune_dsp_dsd64_imd_simulator_tests)

  add_executable(
    effetune_dsp_five_band_dynamic_eq_tests
    plugins/eq/five_band_dynamic_eq/native_test.cpp)
  target_link_libraries(
    effetune_dsp_five_band_dynamic_eq_tests
    PRIVATE effetune_dsp_core)
  target_include_directories(
    effetune_dsp_five_band_dynamic_eq_tests
    PRIVATE core generated/cpp)
  if(MSVC)
    target_compile_options(
      effetune_dsp_five_band_dynamic_eq_tests
      PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_five_band_dynamic_eq_tests
      PRIVATE -Wall -Wextra -Wpedantic -Werror)
    target_link_options(
      effetune_dsp_five_band_dynamic_eq_tests
      PRIVATE $<$<CONFIG:Debug>:-Wl,--wrap=malloc>)
  endif()
  add_test(
    NAME effetune_dsp_five_band_dynamic_eq_tests
    COMMAND effetune_dsp_five_band_dynamic_eq_tests)

  add_executable(
    effetune_dsp_doppler_distortion_tests
    plugins/modulation/doppler_distortion/native_test.cpp)
  target_link_libraries(effetune_dsp_doppler_distortion_tests PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune_dsp_doppler_distortion_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_doppler_distortion_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  add_test(
    NAME effetune_dsp_doppler_distortion_tests
    COMMAND effetune_dsp_doppler_distortion_tests)

  add_executable(
    effetune_dsp_pitch_shifter_tests
    plugins/modulation/pitch_shifter/native_test.cpp)
  target_link_libraries(
    effetune_dsp_pitch_shifter_tests
    PRIVATE effetune_dsp_core)
  target_include_directories(
    effetune_dsp_pitch_shifter_tests
    PRIVATE core generated/cpp)
  if(MSVC)
    target_compile_options(
      effetune_dsp_pitch_shifter_tests
      PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_pitch_shifter_tests
      PRIVATE -Wall -Wextra -Wpedantic -Werror)
    target_link_options(
      effetune_dsp_pitch_shifter_tests
      PRIVATE $<$<CONFIG:Debug>:-Wl,--wrap=malloc>)
  endif()
  add_test(
    NAME effetune_dsp_pitch_shifter_tests
    COMMAND effetune_dsp_pitch_shifter_tests)

  add_executable(
    effetune_dsp_vinyl_artifacts_tests
    plugins/lofi/vinyl_artifacts/native_test.cpp)
  target_link_libraries(
    effetune_dsp_vinyl_artifacts_tests
    PRIVATE effetune_dsp_core)
  target_include_directories(
    effetune_dsp_vinyl_artifacts_tests
    PRIVATE core generated/cpp)
  if(MSVC)
    target_compile_options(
      effetune_dsp_vinyl_artifacts_tests
      PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_vinyl_artifacts_tests
      PRIVATE -Wall -Wextra -Wpedantic -Werror)
    target_link_options(
      effetune_dsp_vinyl_artifacts_tests
      PRIVATE $<$<CONFIG:Debug>:-Wl,--wrap=malloc>)
  endif()
  add_test(
    NAME effetune_dsp_vinyl_artifacts_tests
    COMMAND effetune_dsp_vinyl_artifacts_tests)

  add_executable(
    effetune_dsp_wow_flutter_tests
    plugins/modulation/wow_flutter/native_test.cpp)
  target_link_libraries(effetune_dsp_wow_flutter_tests PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune_dsp_wow_flutter_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_wow_flutter_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
  add_test(
    NAME effetune_dsp_wow_flutter_tests
    COMMAND effetune_dsp_wow_flutter_tests)

  add_executable(
    effetune_dsp_horn_resonator_tests
    plugins/resonator/horn_native_test.cpp)
  target_include_directories(effetune_dsp_horn_resonator_tests PRIVATE core)
  target_link_libraries(effetune_dsp_horn_resonator_tests PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune_dsp_horn_resonator_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_horn_resonator_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
    target_link_options(
      effetune_dsp_horn_resonator_tests
      PRIVATE $<$<CONFIG:Debug>:-Wl,--wrap=malloc>)
  endif()
  add_test(
    NAME effetune_dsp_horn_resonator_tests
    COMMAND effetune_dsp_horn_resonator_tests)

  add_executable(
    effetune_dsp_modal_resonator_tests
    plugins/resonator/modal_resonator/native_test.cpp)
  target_include_directories(
    effetune_dsp_modal_resonator_tests
    PRIVATE core generated/cpp)
  target_link_libraries(
    effetune_dsp_modal_resonator_tests
    PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(
      effetune_dsp_modal_resonator_tests
      PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_modal_resonator_tests
      PRIVATE -Wall -Wextra -Wpedantic -Werror)
    target_link_options(
      effetune_dsp_modal_resonator_tests
      PRIVATE $<$<CONFIG:Debug>:-Wl,--wrap=malloc>)
  endif()
  add_test(
    NAME effetune_dsp_modal_resonator_tests
    COMMAND effetune_dsp_modal_resonator_tests)

  add_executable(
    effetune_dsp_reverb_tests
    plugins/reverb/reverb_native_test.cpp)
  target_include_directories(effetune_dsp_reverb_tests PRIVATE core)
  target_link_libraries(effetune_dsp_reverb_tests PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune_dsp_reverb_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_reverb_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
    target_link_options(
      effetune_dsp_reverb_tests
      PRIVATE $<$<CONFIG:Debug>:-Wl,--wrap=malloc>)
  endif()
  add_test(
    NAME effetune_dsp_reverb_tests
    COMMAND effetune_dsp_reverb_tests)

  add_executable(
    effetune_dsp_multiband_saturation_tests
    plugins/saturation/multiband_saturation/native_test.cpp)
  target_link_libraries(
    effetune_dsp_multiband_saturation_tests
    PRIVATE effetune_dsp_core)
  target_include_directories(
    effetune_dsp_multiband_saturation_tests
    PRIVATE core generated/cpp)
  if(MSVC)
    target_compile_options(
      effetune_dsp_multiband_saturation_tests
      PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_multiband_saturation_tests
      PRIVATE -Wall -Wextra -Wpedantic -Werror)
    target_link_options(
      effetune_dsp_multiband_saturation_tests
      PRIVATE $<$<CONFIG:Debug>:-Wl,--wrap=malloc>)
  endif()
  add_test(
    NAME effetune_dsp_multiband_saturation_tests
    COMMAND effetune_dsp_multiband_saturation_tests)

  add_executable(
    effetune_dsp_multiband_balance_tests
    plugins/spatial/multiband_balance/native_test.cpp)
  target_include_directories(effetune_dsp_multiband_balance_tests PRIVATE core)
  target_link_libraries(effetune_dsp_multiband_balance_tests PRIVATE effetune_dsp_core)
  if(MSVC)
    target_compile_options(effetune_dsp_multiband_balance_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(
      effetune_dsp_multiband_balance_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
    target_link_options(
      effetune_dsp_multiband_balance_tests
      PRIVATE $<$<CONFIG:Debug>:-Wl,--wrap=malloc>)
  endif()
  add_test(
    NAME effetune_dsp_multiband_balance_tests
    COMMAND effetune_dsp_multiband_balance_tests)

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
