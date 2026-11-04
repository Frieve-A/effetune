import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileSfzScript } from '../js/sfz/script-compiler.js';

export const SFZ_SCRIPT_FIXTURE_SOURCE = `on note
 ignore_event($EVENT_ID)
 wait(10ms)
 play_note($EVENT_NOTE + 12, 100, -1, 20ms)
end on`;
export const SFZ_SCRIPT_INIT_SOURCE = `on init
 play_note(60, 100, -1, 5ms)
end on`;
export const SFZ_SCRIPT_MESSAGE_SOURCE = `on init
 declare $i := 0
 while ($i < 12)
  message($i)
  inc($i)
 end while
end on`;
export const SFZ_SCRIPT_GAIN_FINAL_SOURCE = `on note
 change_vol($EVENT_ID, !(-6dB))
 wait(5ms)
 change_vol($EVENT_ID, -6dB)
end on`;
export const SFZ_SCRIPT_PAN_FADE_SOURCE = `on note
 change_pan_time($EVENT_ID, 2ms)
 change_pan_curve($EVENT_ID, $NKSP_LINEAR)
 change_pan($EVENT_ID, -1000)
 fade_in($EVENT_ID, 5ms)
 wait(10ms)
 change_pan($EVENT_ID, 1000)
 fade_out($EVENT_ID, 5ms, 1.0)
end on`;
export const SFZ_SCRIPT_AMP_SOURCE = `on note
 change_attack($EVENT_ID, 20ms)
 change_decay($EVENT_ID, 20ms)
 change_sustain($EVENT_ID, 500000)
 change_release($EVENT_ID, 5ms)
end on`;
export const SFZ_SCRIPT_RAMPS_SOURCE = `on note
 change_tune_time($EVENT_ID, 5ms)
 change_tune_curve($EVENT_ID, $NKSP_LINEAR)
 change_vol_time($EVENT_ID, 5ms)
 change_vol_curve($EVENT_ID, $NKSP_LINEAR)
 wait(5ms)
 change_tune($EVENT_ID, 1200000)
 change_vol($EVENT_ID, -12000)
 wait(2ms)
 message(get_event_par($EVENT_ID, $EVENT_PAR_TUNE))
 message(get_event_par($EVENT_ID, $EVENT_PAR_VOLUME))
 change_vol($EVENT_ID, -9223372036854775808)
 wait(6ms)
 message(get_event_par($EVENT_ID, $EVENT_PAR_VOLUME))
 change_vol($EVENT_ID, get_event_par($EVENT_ID, $EVENT_PAR_VOLUME))
end on`;
export const SFZ_SCRIPT_CHILD_SOURCE = `on note
 ignore_event($EVENT_ID)
 declare local $child := play_note($EVENT_NOTE, 127, -1, 20ms)
 change_note($child, 72)
 change_velo($child, 64)
 change_play_pos($child, 0s)
end on`;
export const SFZ_SCRIPT_ORIGINAL_SOURCE = `on note
 change_note($EVENT_ID, 72)
 change_velo($EVENT_ID, 64)
 change_play_pos($EVENT_ID, 0s)
end on`;
export const SFZ_SCRIPT_CHILD_LOOP_SOURCE = SFZ_SCRIPT_CHILD_SOURCE.replace(
  ' change_note($child, 72)',
  ' declare local $i := 0\n while ($i < 2000)\n  inc($i)\n end while\n change_note($child, 72)');
export const SFZ_SCRIPT_ORIGINAL_LOOP_SOURCE = SFZ_SCRIPT_ORIGINAL_SOURCE.replace(
  ' change_note($EVENT_ID, 72)',
  ' declare local $i := 0\n while ($i < 2000)\n  inc($i)\n end while\n change_note($EVENT_ID, 72)');
export const SFZ_SCRIPT_ORDER_BEFORE_SOURCE = `on note
 ignore_event($EVENT_ID)
 play_note(60,127,-1,20ms)
 set_controller(1,127)
end on`;
export const SFZ_SCRIPT_ORDER_AFTER_SOURCE = `on note
 ignore_event($EVENT_ID)
 set_controller(1,127)
 play_note(60,127,-1,20ms)
end on`;
export const SFZ_SCRIPT_CACHE_EVICTION_SOURCE = `on note
 if ($EVENT_NOTE = 72)
  change_play_pos($EVENT_ID,85ms)
 end if
end on`;
export const SFZ_SCRIPT_PENDING_SOURCE = `on note
 wait(1s)
 play_note(72,127,-1,10ms)
end on`;
export const SFZ_SCRIPT_RUNTIME_FAILURE_SOURCE = `on init
 declare $zero := 0
end on
on note
 play_note(72,127,-1,1s)
 wait(10ms)
 $zero := 1 / $zero
end on`;
export const SFZ_SCRIPT_IGNORE_CURRENT_SOURCE = `on note
 if ($EVENT_NOTE = 60)
  ignore_event()
 end if
end on
on controller
 ignore_event()
end on`;
export const SFZ_SCRIPT_FINAL_FADE_SOURCE = `on note
 change_vol($EVENT_ID,!(-6dB))
 wait(10ms)
 fade_out($EVENT_ID,20ms,1)
end on`;
export const SFZ_SCRIPT_GAIN_DOMAIN_SOURCE = `on note
 change_vol($EVENT_ID,-6dB)
 change_vol_time($EVENT_ID,20ms)
 wait(10ms)
 change_vol($EVENT_ID,!(-6dB))
 wait(5ms)
 change_vol($EVENT_ID,-12dB)
end on`;
export const SFZ_SCRIPT_TUNE_DOMAIN_SOURCE = `on note
 change_tune($EVENT_ID,-1200000)
 change_tune_time($EVENT_ID,20ms)
 wait(10ms)
 change_tune($EVENT_ID,!(-1200000))
end on`;
export const SFZ_SCRIPT_PAN_DOMAIN_SOURCE = `on note
 change_pan($EVENT_ID,-500)
 change_pan_time($EVENT_ID,20ms)
 wait(10ms)
 change_pan($EVENT_ID,!(-500))
end on`;
export const SFZ_SCRIPT_HYDRATION_SOURCE = `on init
 message(%CC[1])
 message(%CC[128])
 message(%CC[129])
 message(%KEY_DOWN[60])
 message(%CC[98])
 message(%CC[99])
 message(%CC[100])
 message(%CC[101])
 play_note(60,127,-1,20ms)
end on
on note
 message("note")
end on
on release
 message("release")
end on
on controller
 message("controller")
end on
on rpn
 message("rpn")
end on
on nrpn
 message("nrpn")
end on`;
export const SFZ_SCRIPT_MODULATION_CASES = [
  ['Cutoff', 'change_cutoff', '500Hz'],
  ['Resonance', 'change_reso', '200000'],
  ['FilterAttack', 'change_cutoff_attack', '20ms'],
  ['FilterDecay', 'change_cutoff_decay', '20ms'],
  ['FilterSustain', 'change_cutoff_sustain', '500000'],
  ['FilterRelease', 'change_cutoff_release', '5ms'],
  ['AmpLfoDepth', 'change_amp_lfo_depth', '500000'],
  ['AmpLfoFrequency', 'change_amp_lfo_freq', '20Hz'],
  ['PitchLfoDepth', 'change_pitch_lfo_depth', '500000'],
  ['PitchLfoFrequency', 'change_pitch_lfo_freq', '20Hz'],
  ['FilterLfoDepth', 'change_cutoff_lfo_depth', '500000'],
  ['FilterLfoFrequency', 'change_cutoff_lfo_freq', '20Hz']
].map(([name, fn, value]) => [`kScript${name}`, `on note\n ${fn}($EVENT_ID, ${value})\nend on`]);
const filename = fileURLToPath(new URL('../dsp/plugins/others/soundfont_player/script_fixture.h', import.meta.url));

export function updateSfzScriptFixture({ check = false } = {}) {
  const fixtures = [
    ['kScriptNoteWait', SFZ_SCRIPT_FIXTURE_SOURCE],
    ['kScriptInit', SFZ_SCRIPT_INIT_SOURCE],
    ['kScriptMessage', SFZ_SCRIPT_MESSAGE_SOURCE],
    ['kScriptGainFinal', SFZ_SCRIPT_GAIN_FINAL_SOURCE],
    ['kScriptPanFade', SFZ_SCRIPT_PAN_FADE_SOURCE],
    ['kScriptAmp', SFZ_SCRIPT_AMP_SOURCE],
    ['kScriptRamps', SFZ_SCRIPT_RAMPS_SOURCE],
    ['kScriptChild', SFZ_SCRIPT_CHILD_SOURCE],
    ['kScriptOriginal', SFZ_SCRIPT_ORIGINAL_SOURCE],
    ['kScriptChildLoop', SFZ_SCRIPT_CHILD_LOOP_SOURCE],
    ['kScriptOriginalLoop', SFZ_SCRIPT_ORIGINAL_LOOP_SOURCE],
    ['kScriptOrderBefore', SFZ_SCRIPT_ORDER_BEFORE_SOURCE],
    ['kScriptOrderAfter', SFZ_SCRIPT_ORDER_AFTER_SOURCE],
    ['kScriptCacheEviction', SFZ_SCRIPT_CACHE_EVICTION_SOURCE],
    ['kScriptPending', SFZ_SCRIPT_PENDING_SOURCE],
    ['kScriptRuntimeFailure', SFZ_SCRIPT_RUNTIME_FAILURE_SOURCE],
    ['kScriptIgnoreCurrent', SFZ_SCRIPT_IGNORE_CURRENT_SOURCE],
    ['kScriptFinalFade', SFZ_SCRIPT_FINAL_FADE_SOURCE],
    ['kScriptGainDomain', SFZ_SCRIPT_GAIN_DOMAIN_SOURCE],
    ['kScriptTuneDomain', SFZ_SCRIPT_TUNE_DOMAIN_SOURCE],
    ['kScriptPanDomain', SFZ_SCRIPT_PAN_DOMAIN_SOURCE],
    ['kScriptHydration', SFZ_SCRIPT_HYDRATION_SOURCE],
    ...SFZ_SCRIPT_MODULATION_CASES
  ].map(([name, source]) => ({ name, source, bytes: compileSfzScript(source).bytes }));
  if (check) {
    const source = fs.readFileSync(filename, 'utf8');
    for (const fixture of fixtures) {
      const match = new RegExp(`${fixture.name}Fixture\\s*\\{([\\s\\S]*?)\\};`).exec(source);
      assert.ok(match, 'native script fixture array is missing');
      const stored = match[1].split(',').map(value => value.trim()).filter(Boolean).map(Number);
      assert.deepEqual(Uint8Array.from(stored), fixture.bytes, 'native script fixture is stale; regenerate it');
      assert.ok(source.includes(fixture.source), 'native script fixture source is stale');
    }
    return;
  }
  const declarations = fixtures.map(({ name, source, bytes }) => {
    const lines = [];
    for (let index = 0; index < bytes.length; index += 24) lines.push(`  ${[...bytes.subarray(index, index + 24)].join(', ')},`);
    return `inline constexpr char ${name}Source[] = R"NKSP(${source})NKSP";
// clang-format off
inline constexpr std::array<std::uint8_t, ${bytes.length}> ${name}Fixture{
${lines.join('\n')}
};
// clang-format on`;
  }).join('\n');
  fs.writeFileSync(filename, `#ifndef EFFETUNE_SFZ_SCRIPT_FIXTURE_H
#define EFFETUNE_SFZ_SCRIPT_FIXTURE_H
#include <array>
#include <cstdint>
// Generated from the authored fixture by tools/generate-sfz-script-fixture.mjs.
${declarations}
#endif
`);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  updateSfzScriptFixture({ check: process.argv.includes('--check') });
}
