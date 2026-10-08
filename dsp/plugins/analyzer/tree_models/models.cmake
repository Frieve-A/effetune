find_package(Python3 3.10 REQUIRED COMPONENTS Interpreter)

set(ET_TREE_MODEL_SOURCE_DIR "${CMAKE_CURRENT_LIST_DIR}")
set(ET_TREE_MODEL_BUILD_DIR "${CMAKE_CURRENT_BINARY_DIR}/tree-models")
if(MSVC)
  if(CMAKE_C_COMPILER_ARCHITECTURE_ID STREQUAL "ARM64")
    set(ET_TREE_MODEL_TARGET coff-arm64)
  elseif(CMAKE_C_COMPILER_ARCHITECTURE_ID STREQUAL "x64")
    set(ET_TREE_MODEL_TARGET coff-x64)
  else()
    message(FATAL_ERROR "Binary tree models require an x64 or ARM64 MSVC target")
  endif()
  set(ET_TREE_MODEL_EXTENSION obj)
else()
  if(EMSCRIPTEN)
    set(CMAKE_ASM_COMPILER "${CMAKE_C_COMPILER}")
    set(ET_TREE_MODEL_TARGET wasm)
  elseif(APPLE)
    set(ET_TREE_MODEL_TARGET macho)
  else()
    set(ET_TREE_MODEL_TARGET elf)
  endif()
  enable_language(ASM)
  set(ET_TREE_MODEL_EXTENSION S)
endif()

get_filename_component(ET_ANALYZER_SOURCE_DIR "${ET_TREE_MODEL_SOURCE_DIR}/.." ABSOLUTE)
set(ET_TREE_MODEL_OUTPUTS)
# Each entry is <plugin folder>/<model>: the Rhythm Analyzer's onset-lane models.
# The model name sets the embedded symbol namespace, so names stay unique across folders.
foreach(entry IN ITEMS rhythm_analyzer/rhythm_d_low rhythm_analyzer/rhythm_d_mid rhythm_analyzer/rhythm_d_high)
  get_filename_component(name "${entry}" NAME)
  set(manifest "${ET_ANALYZER_SOURCE_DIR}/${entry}.json")
  set(data "${ET_ANALYZER_SOURCE_DIR}/${entry}.bin")
  set(header "${ET_TREE_MODEL_BUILD_DIR}/${name}.generated.h")
  set(embedded "${ET_TREE_MODEL_BUILD_DIR}/${name}.${ET_TREE_MODEL_EXTENSION}")
  add_custom_command(
    OUTPUT "${header}" "${embedded}"
    COMMAND Python3::Interpreter "${ET_TREE_MODEL_SOURCE_DIR}/embed_models.py"
            "${manifest}" "${ET_TREE_MODEL_BUILD_DIR}" --target "${ET_TREE_MODEL_TARGET}"
    DEPENDS "${manifest}" "${data}" "${ET_TREE_MODEL_SOURCE_DIR}/embed_models.py"
    COMMENT "Embedding analyzer model ${entry}"
    VERBATIM)
  if(MSVC)
    set_source_files_properties("${embedded}" PROPERTIES EXTERNAL_OBJECT TRUE)
  endif()
  list(APPEND ET_TREE_MODEL_OUTPUTS "${header}" "${embedded}")
endforeach()

add_library(effetune_tree_models STATIC ${ET_TREE_MODEL_OUTPUTS})
set_target_properties(effetune_tree_models PROPERTIES LINKER_LANGUAGE C)
target_include_directories(effetune_tree_models
                          INTERFACE "${ET_TREE_MODEL_BUILD_DIR}" "${ET_TREE_MODEL_SOURCE_DIR}")
if(BUILD_TESTING AND NOT EMSCRIPTEN)
  add_test(NAME effetune_tree_model_embedding_tests
           COMMAND Python3::Interpreter "${ET_TREE_MODEL_SOURCE_DIR}/embed_models_test.py")
endif()
