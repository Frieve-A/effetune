cmake_minimum_required(VERSION 3.24)
project(effetune_g726_state_oracle C)

if(NOT IS_DIRECTORY "${ET_STL_G726_DIR}" OR
   NOT EXISTS "${ET_STL_G726_DIR}/g726.c" OR
   NOT EXISTS "${ET_STL_G726_DIR}/g726.h")
  message(FATAL_ERROR "ET_STL_G726_DIR must name the external STL2024 src/src/g726 directory")
endif()

add_executable(
  effetune-g726-state-oracle
  ../g726-state-oracle-runner.c
  "${ET_STL_G726_DIR}/g726.c")
target_include_directories(effetune-g726-state-oracle PRIVATE "${ET_STL_G726_DIR}")
set_target_properties(
  effetune-g726-state-oracle
  PROPERTIES C_STANDARD 99 C_STANDARD_REQUIRED ON C_EXTENSIONS OFF)
