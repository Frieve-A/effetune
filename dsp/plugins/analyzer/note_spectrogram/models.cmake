find_package(Python3 3.10 REQUIRED COMPONENTS Interpreter)

set(ET_NOTE_MODEL_SOURCE_DIR "${CMAKE_CURRENT_LIST_DIR}")
set(ET_NOTE_MODEL_BUILD_DIR "${CMAKE_CURRENT_BINARY_DIR}/note-models")
if(MSVC)
  if(CMAKE_C_COMPILER_ARCHITECTURE_ID STREQUAL "ARM64")
    set(ET_NOTE_MODEL_TARGET coff-arm64)
  elseif(CMAKE_C_COMPILER_ARCHITECTURE_ID STREQUAL "x64")
    set(ET_NOTE_MODEL_TARGET coff-x64)
  else()
    message(FATAL_ERROR "Binary note models require an x64 or ARM64 MSVC target")
  endif()
  set(ET_NOTE_MODEL_EXTENSION obj)
else()
  if(EMSCRIPTEN)
    set(CMAKE_ASM_COMPILER "${CMAKE_C_COMPILER}")
    set(ET_NOTE_MODEL_TARGET wasm)
  elseif(APPLE)
    set(ET_NOTE_MODEL_TARGET macho)
  else()
    set(ET_NOTE_MODEL_TARGET elf)
  endif()
  enable_language(ASM)
  set(ET_NOTE_MODEL_EXTENSION S)
endif()

set(ET_NOTE_MODEL_OUTPUTS)
foreach(name IN ITEMS learned_model fine_model octave_model)
  set(manifest "${ET_NOTE_MODEL_SOURCE_DIR}/${name}.json")
  set(data "${ET_NOTE_MODEL_SOURCE_DIR}/${name}.bin")
  set(header "${ET_NOTE_MODEL_BUILD_DIR}/${name}.generated.h")
  set(embedded "${ET_NOTE_MODEL_BUILD_DIR}/${name}.${ET_NOTE_MODEL_EXTENSION}")
  add_custom_command(
    OUTPUT "${header}" "${embedded}"
    COMMAND Python3::Interpreter "${ET_NOTE_MODEL_SOURCE_DIR}/embed_models.py"
            "${manifest}" "${ET_NOTE_MODEL_BUILD_DIR}" --target "${ET_NOTE_MODEL_TARGET}"
    DEPENDS "${manifest}" "${data}" "${ET_NOTE_MODEL_SOURCE_DIR}/embed_models.py"
    COMMENT "Embedding Note Spectrogram ${name}"
    VERBATIM)
  if(MSVC)
    set_source_files_properties("${embedded}" PROPERTIES EXTERNAL_OBJECT TRUE)
  endif()
  list(APPEND ET_NOTE_MODEL_OUTPUTS "${header}" "${embedded}")
endforeach()

add_library(effetune_note_models STATIC ${ET_NOTE_MODEL_OUTPUTS})
set_target_properties(effetune_note_models PROPERTIES LINKER_LANGUAGE C)
target_include_directories(effetune_note_models
                          INTERFACE "${ET_NOTE_MODEL_BUILD_DIR}" "${ET_NOTE_MODEL_SOURCE_DIR}")
if(BUILD_TESTING AND NOT EMSCRIPTEN)
  add_test(NAME effetune_note_model_embedding_tests
           COMMAND Python3::Interpreter "${ET_NOTE_MODEL_SOURCE_DIR}/embed_models_test.py")
endif()
