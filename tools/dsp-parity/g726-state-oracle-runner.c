// Build this adapter only against an external, unmodified ITU-T G.191 STL G.726
// tree. The STL source and vectors remain outside this repository under their
// own license.
#define _CRT_SECURE_NO_WARNINGS

#include "g726.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static uint64_t add_byte(uint64_t hash, uint8_t value) {
  return (hash ^ value) * UINT64_C(1099511628211);
}

static uint64_t add_u16(uint64_t hash, uint16_t value) {
  hash = add_byte(hash, (uint8_t)value);
  return add_byte(hash, (uint8_t)(value >> 8));
}

static uint64_t add_u32(uint64_t hash, uint32_t value) {
  unsigned int shift;
  for (shift = 0; shift < 32; shift += 8) {
    hash = add_byte(hash, (uint8_t)(value >> shift));
  }
  return hash;
}

static uint64_t state_digest(const G726_state *state) {
  const short b[6] = {state->b1r, state->b2r, state->b3r,
                      state->b4r, state->b5r, state->b6r};
  const short dq[6] = {state->dq0, state->dq1, state->dq2,
                       state->dq3, state->dq4, state->dq5};
  uint64_t hash = UINT64_C(14695981039346656037);
  size_t index;
  hash = add_u32(hash, (uint32_t)state->ylp);
  hash = add_u16(hash, (uint16_t)state->yup);
  hash = add_u16(hash, (uint16_t)state->dmsp);
  hash = add_u16(hash, (uint16_t)state->dmlp);
  hash = add_u16(hash, (uint16_t)state->apr);
  hash = add_u16(hash, (uint16_t)state->a1r);
  hash = add_u16(hash, (uint16_t)state->a2r);
  for (index = 0; index < 6; ++index)
    hash = add_u16(hash, (uint16_t)b[index]);
  hash = add_u16(hash, (uint16_t)state->pk0);
  hash = add_u16(hash, (uint16_t)state->pk1);
  for (index = 0; index < 6; ++index)
    hash = add_u16(hash, (uint16_t)dq[index]);
  hash = add_u16(hash, (uint16_t)state->sr0);
  hash = add_u16(hash, (uint16_t)state->sr1);
  return add_u16(hash, (uint16_t)state->tdr);
}

static int read_le_short(FILE *file, short *value) {
  unsigned char bytes[2];
  const size_t count = fread(bytes, 1, sizeof(bytes), file);
  if (count == 0 && feof(file))
    return 0;
  if (count != sizeof(bytes))
    return -1;
  *value = (short)((uint16_t)bytes[0] | ((uint16_t)bytes[1] << 8));
  return 1;
}

static int make_path(char *output, size_t capacity, const char *root,
                     const char *name) {
  const size_t length = strlen(root);
  const char separator =
      length > 0 && (root[length - 1] == '/' || root[length - 1] == '\\') ? '\0'
                                                                          : '/';
  const int written =
      separator == '\0'
          ? snprintf(output, capacity, "%s%s", root, name)
          : snprintf(output, capacity, "%s%c%s", root, separator, name);
  return written > 0 && (size_t)written < capacity;
}

static int run_series(FILE *report, const char *root, int rate,
                      const char *law_name, int overload) {
  char input_name[16];
  char code_name[32];
  char output_name[32];
  char input_path[4096];
  char code_path[4096];
  char output_path[4096];
  const char law_suffix = strcmp(law_name, "a") == 0 ? 'a' : 'm';
  const char *workload = overload ? "overload" : "normal";
  const char *prefix = overload ? "rv" : "rn";
  char law[2] = {law_suffix == 'a' ? '1' : '0', '\0'};
  FILE *input;
  FILE *codes;
  FILE *outputs;
  G726_state encoder_state;
  G726_state decoder_state;
  uint64_t encoder_checkpoint = 0;
  uint64_t decoder_checkpoint = 0;
  size_t sample_count = 0;
  int ok = 1;

  snprintf(input_name, sizeof(input_name), "%s.%c", overload ? "ovr" : "nrm",
           law_suffix);
  snprintf(code_name, sizeof(code_name), "%s%df%c.i", prefix, rate, law_suffix);
  snprintf(output_name, sizeof(output_name), "%s%df%c.o", prefix, rate,
           law_suffix);
  if (!make_path(input_path, sizeof(input_path), root, input_name) ||
      !make_path(code_path, sizeof(code_path), root, code_name) ||
      !make_path(output_path, sizeof(output_path), root, output_name)) {
    return 0;
  }
  input = fopen(input_path, "rb");
  codes = fopen(code_path, "rb");
  outputs = fopen(output_path, "rb");
  if (input == NULL || codes == NULL || outputs == NULL) {
    fprintf(stderr, "Unable to open official STL vectors for %d %s %s\n", rate,
            law_name, workload);
    if (input != NULL)
      fclose(input);
    if (codes != NULL)
      fclose(codes);
    if (outputs != NULL)
      fclose(outputs);
    return 0;
  }

  for (;;) {
    short input_sample;
    short expected_code;
    short expected_output;
    short actual_code = 0;
    short actual_output = 0;
    const int input_status = read_le_short(input, &input_sample);
    const int code_status = read_le_short(codes, &expected_code);
    const int output_status = read_le_short(outputs, &expected_output);
    if (input_status == 0 && code_status == 0 && output_status == 0)
      break;
    if (input_status != 1 || code_status != 1 || output_status != 1) {
      ok = 0;
      break;
    }
    G726_encode(&input_sample, &actual_code, 1, law, (short)(rate / 8),
                sample_count == 0 ? 1 : 0, &encoder_state);
    G726_decode(&expected_code, &actual_output, 1, law, (short)(rate / 8),
                sample_count == 0 ? 1 : 0, &decoder_state);
    ++sample_count;
    if (actual_code != expected_code || actual_output != expected_output) {
      fprintf(stderr,
              "Official STL conformance failed for %d %s %s at sample %zu: "
              "code %d/%d, "
              "output %d/%d\n",
              rate, law_name, workload, sample_count, actual_code,
              expected_code, actual_output, expected_output);
      ok = 0;
      break;
    }
    if (sample_count == 256) {
      encoder_checkpoint = state_digest(&encoder_state);
      decoder_checkpoint = state_digest(&decoder_state);
    }
  }
  fclose(input);
  fclose(codes);
  fclose(outputs);
  if (!ok || sample_count < 256)
    return 0;

  fprintf(report, "%d %s %s encoder 256 %016llx\n", rate, law_name, workload,
          (unsigned long long)encoder_checkpoint);
  fprintf(report, "%d %s %s decoder 256 %016llx\n", rate, law_name, workload,
          (unsigned long long)decoder_checkpoint);
  fprintf(report, "%d %s %s encoder %zu %016llx\n", rate, law_name, workload,
          sample_count, (unsigned long long)state_digest(&encoder_state));
  fprintf(report, "%d %s %s decoder %zu %016llx\n", rate, law_name, workload,
          sample_count, (unsigned long long)state_digest(&decoder_state));
  return 1;
}

int main(int argc, char **argv) {
  static const int rates[] = {16, 24, 32, 40};
  static const char *laws[] = {"mu", "a"};
  FILE *report;
  size_t rate_index;
  size_t law_index;
  int overload;
  if (argc != 3) {
    fprintf(stderr, "Usage: g726-state-oracle-runner <external-stl-test-data> "
                    "<digest-file>\n");
    return 2;
  }
  report = fopen(argv[2], "wb");
  if (report == NULL) {
    fprintf(stderr, "Unable to create state digest output\n");
    return 2;
  }
  fprintf(report, "g726-state-digest-v1\n");
  for (rate_index = 0; rate_index < sizeof(rates) / sizeof(rates[0]);
       ++rate_index) {
    for (law_index = 0; law_index < sizeof(laws) / sizeof(laws[0]);
         ++law_index) {
      for (overload = 0; overload <= 1; ++overload) {
        if (!run_series(report, argv[1], rates[rate_index], laws[law_index],
                        overload)) {
          fclose(report);
          return 1;
        }
      }
    }
  }
  if (fclose(report) != 0)
    return 1;
  return 0;
}
