import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileSfzScript, SFZ_SCRIPT_BUILTINS } from '../../js/sfz/script-compiler.js';

test('voice parameter compilation accepts documented units and rejects extra relative arguments', () => {
    assert.doesNotThrow(() => compileSfzScript('on note change_sustain($EVENT_ID,-6dB) change_cutoff_sustain($EVENT_ID,-3dB) change_vol($EVENT_ID,-6dB,1) end on'));
    assert.doesNotThrow(() => compileSfzScript('on note fade_out($EVENT_ID,1ms,0.0) fade_out($EVENT_ID,1ms,1.0) end on'));
    for (const expression of ['change_attack($EVENT_ID,100,1)', 'change_amp_lfo_depth($EVENT_ID,3dB)', 'change_vol_time($EVENT_ID,1ms,1)'])
        assert.throws(() => compileSfzScript(`on note ${expression} end on`), { code: 'script-invalid' });
});

test('ignore_event accepts its documented current-event default and explicit event IDs', () => {
    for (const handler of ['note', 'release', 'controller']) {
        assert.doesNotThrow(() => compileSfzScript(`on ${handler} ignore_event() end on`));
        assert.doesNotThrow(() => compileSfzScript(`on ${handler} ignore_event($EVENT_ID) end on`));
    }
    assert.throws(() => compileSfzScript('on note ignore_event(1,2) end on'), { code: 'script-invalid' });
});

test('compiler checks value types, namespace collisions and array finalness before execution', () => {
    for (const source of [
        'on init declare $n := message(1) end on',
        'on init declare ~n := 1.0 inc(~n) end on',
        'on init if ("text") message(1) end if end on',
        'on init declare $n declare ~n end on',
        'on note declare local $n declare local @n end on',
        'on init declare %a[1] := (!1) end on',
        'on init declare %a[1] %a[0] := !1 end on',
        'on init declare %a[1] %a[0.0] := 1 end on',
        'on init declare %a[1] message(search(%a,1.0)) end on',
        'on init message(lsb(1.0)) end on',
        'on init message(msb(!1)) end on',
        'on init declare %a[1] %a[0] := min(1,!2) end on',
        'on note play_note(60.0) end on',
        'on init select 1 case 3 to 2 message(1) end select end on',
        'function empty end function on init declare $n := call empty end on'
    ]) assert.throws(() => compileSfzScript(source), { code: 'script-invalid' }, source);
    assert.doesNotThrow(() => compileSfzScript(`{
        SET_CONDITION(IGNORED)
        }
        USE_CODE_IF(IGNORED) { a comment after a directive }
        invalid text
        END_USE_CODE
        on init message("SET_CONDITION(TEXT)") end on`));
});

test('compiler retains exact constant sizes and rejects local names that cannot be resolved unambiguously', () => {
    assert.doesNotThrow(() => compileSfzScript('on init declare %a[9007199254740993-9007199254740992] := (1) end on'));
    for (const source of [
        'on note declare local $EVENT_ID end on',
        'function f($value) declare local $value end function',
        'on init declare %a[1.0] end on',
        'on init declare %a[1s] end on',
        'on init declare %a[9223372036854775807*2] end on',
        'on init message($MARK_1[0]) end on'
    ]) assert.throws(() => compileSfzScript(source), { code: 'script-invalid' });
    const mixed = compileSfzScript('on init declare $a := !1 message($a+2) end on');
    assert.deepEqual(mixed.diagnostics.map(item => [item.code, item.severity]), [['mixed-finalness', 'warning']]);
    const alias = compileSfzScript('on note note_off($ALL_EVENTS) end on');
    assert.deepEqual(alias.bytes, compileSfzScript('on note note_off(%ALL_EVENTS) end on').bytes);
    assert.deepEqual(alias.diagnostics.map(item => item.code), ['legacy-array-name']);
});

test('NKSP compiler emits bounded versioned callbacks and preserves unit constants', () => {
    const program = compileSfzScript(`on init declare $n := 0 end on
        on note inc($n) wait(1ms) play_note($EVENT_NOTE+12,100,-1,2s) end on`);
    const view = new DataView(program.bytes.buffer);
    assert.equal(view.getUint32(0, true), 0x31534b4e);
    assert.equal(view.getUint32(4, true), 2);
    assert.equal(program.callbacks[0], 0);
    assert.ok(program.callbacks[1] > 0);
    assert.equal(program.callbacks[2], 0xffffffff);
    const constants = [];
    for (let i = 0, offset = 64 + view.getUint32(16, true) * 16; i < view.getUint32(12, true); i++, offset += 144) {
        const flags = view.getUint32(offset + 12, true);
        const exponent = (flags >> 16) & 255;
        const numeric = view.getUint32(offset + 8, true) === 0 ? Number(view.getBigInt64(offset, true)) * 10 ** (exponent < 128 ? exponent : exponent - 256) : view.getFloat64(offset, true);
        constants.push([numeric, flags]);
    }
    assert.ok(constants.some(([number, flags]) => number === .001 && (flags & 3) === 1 && (flags & 512)));
    assert.ok(constants.some(([number, flags]) => number === 2 && flags === 1));
    assert.equal(SFZ_SCRIPT_BUILTINS.length, 84);
});

test('NKSP compiler supports scoped control flow, arrays, functions, strings and preprocessing', () => {
    assert.doesNotThrow(() => compileSfzScript(`
        SET_CONDITION(TEST)
        USE_CODE_IF_NOT(TEST)
        this is excluded text
        END_USE_CODE
        on init
          declare const $size := 3
          declare %pitches[$size] := (60,64,67)
          declare @label := "harmony"
          declare polyphonic $played
        end on
        function harmony
          declare local $i := 0
          while ($i < num_elements(%pitches))
            $played := play_note(%pitches[$i])
            inc($i)
          end while
        end function
        on note
          if ($EVENT_VELOCITY > 60) call harmony else message(@label & " quiet") end if
          select $EVENT_NOTE case 60 to 72 change_note($EVENT_ID, 72) case 1 exit() end select
        end on
    `));
});

test('NKSP compiler rejects unknown executable syntax and finite budget violations with diagnostics', () => {
    for (const source of [
        'on note eval("evil") end on', 'on note play_note() end on',
        'on note $missing := 2 end on', 'on note wait(1) end note',
        'on note declare %huge[257] end on', 'on init declare const $x := 2 inc($x) end on',
        'on init message("' + 'x'.repeat(128) + '") end on',
        'on init declare $a := 1.5 end on',
        'on init declare $a := 1ms $a := 2Hz end on',
        'on note wait(2Hz) end on',
        'on note change_vol($EVENT_ID,2Hz) end on',
        'on note declare local $a declare local $a end on',
        'on note declare polyphonic @text end on',
        'on init declare %a[2] := (1s,2s) end on',
        'USE_CODE_IF(X)\non init end on', 'on note\n' + '('.repeat(100) + '1' + ')'.repeat(100) + '\nend on'
    ]) assert.throws(() => compileSfzScript(source), error => error.code === 'script-invalid' && error.line > 0, source);
});

const nativeRunner = process.env.SFZ_SCRIPT_VM_TEST_RUNNER;
async function execute(source, mode = null, mutate = null, expectedStatus = 0) {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'effetune-nksp-')));
    try {
        const file = path.join(root, 'script.bin');
        const bytes = compileSfzScript(source).bytes;
        await writeFile(file, mutate ? mutate(bytes) : bytes);
        const result = spawnSync(nativeRunner, mode ? [file, mode] : [file], { encoding: 'utf8', timeout: 10000, windowsHide: true });
        assert.equal(result.error, undefined);
        assert.equal(result.status, expectedStatus, result.stderr);
        if (expectedStatus) return [];
        return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 3 }); }
}

test('compiler-produced native bytecode preserves callbacks, sample waits, polyphony and checkpoint state', { skip: !nativeRunner }, async () => {
    const calls = await execute(`
        on init declare $count := 0 declare polyphonic $note end on
        on note
          inc($count)
          ignore_event($EVENT_ID)
          wait(1ms)
          $note := play_note($EVENT_NOTE+12, 90+$count, -1, 1000)
        end on
        on release note_off($note) end on
        on controller set_controller($CC_NUM, %CC[$CC_NUM]) end on
        on rpn set_rpn($RPN_ADDRESS, $RPN_VALUE) end on
        on nrpn set_nrpn($RPN_ADDRESS, $RPN_VALUE) end on
    `);
    const selected = name => calls.filter(call => call.fn === SFZ_SCRIPT_BUILTINS.indexOf(name));
    assert.deepEqual(selected('play_note').map(call => [call.frame, ...call.args]), [[48, 72, 91, -1, 1000], [144, 76, 92, -1, 1000]]);
    assert.deepEqual(selected('note_off').map(call => call.args), [[100]]);
    assert.deepEqual(selected('set_controller').map(call => call.args), [[1, 73]]);
    assert.deepEqual(selected('set_rpn').map(call => call.args), [[123, 456]]);
    assert.deepEqual(selected('set_nrpn').map(call => call.args), [[123, 456]]);
});

test('native arrays, arithmetic, local scope and user function return execute compiled source', { skip: !nativeRunner }, async () => {
    const calls = await execute(`
        on init
          declare %a[3] := (7, 2, 4)
          declare %b[3] := (2, 4, 7)
          sort(%a)
          message(array_equal(%a,%b))
          message(search(%a,4))
          message("values=" & num_elements(%a))
        end on
        function early message(10) exit() message(999) end function
        on note
          declare local $sum := 0
          declare local $i := 0
          while ($i < 3) $sum := $sum + %a[$i] inc($i) end while
          call early
          message($sum)
        end on
    `);
    assert.deepEqual(calls.map(call => call.args[0]), [1, 1, 'values=3', 10, 13, 10, 13]);
});

test('native detached forks copy local and polyphonic data and stop_wait resumes their frame', { skip: !nativeRunner }, async () => {
    const calls = await execute(`
        on init declare polyphonic $p end on
        on note
          $p := $EVENT_NOTE
          declare local $fork := fork(2,0)
          if ($fork = 0)
            stop_wait(%NKSP_CALLBACK_CHILD_ID[0],1)
          else
            $p := $p + $fork
            wait(1ms)
            play_note($p)
          end if
        end on
    `);
    assert.deepEqual(calls.map(call => [call.frame, call.args[0]]), [[0, 61], [48, 62], [96, 65], [144, 66]]);
});

test('native unit variables preserve integer metric precision and compatible conversion', { skip: !nativeRunner }, async () => {
    const calls = await execute(`
        on init
          declare $a := 1s
          declare $b := 999ms
          declare $delay := $a - $b
          declare ~loudness := 2.0mdB
        end on
        on note
          wait($delay)
          play_note($EVENT_NOTE)
          message(~loudness / 1.0B)
        end on
    `);
    const notes = calls.filter(call => call.fn === SFZ_SCRIPT_BUILTINS.indexOf('play_note'));
    assert.deepEqual(notes.map(call => call.frame), [48, 144]);
    const messages = calls.filter(call => call.fn === SFZ_SCRIPT_BUILTINS.indexOf('message'));
    assert.deepEqual(messages.map(call => call.args[0]), [.0002, .0002]);
});

test('native core math, integer conversion and bit functions execute independently compiled expressions', { skip: !nativeRunner }, async () => {
    const expressions = [
        ['abs(-4)', 4], ['acos(1.0)', 0], ['asin(0.0)', 0], ['atan(0.0)', 0],
        ['ceil(1.2)', 2], ['cos(0.0)', 1], ['exp(0.0)', 1], ['floor(1.9)', 1],
        ['int(2.9)', 2], ['int_to_real(3)', 3], ['in_range(3,2,4)', 1],
        ['log(1.0)', 0], ['log10(100.0)', 2], ['log2(8.0)', 3],
        ['lsb(257)', 1], ['msb(257)', 2], ['max(3,7)', 7], ['min(3,7)', 3],
        ['pow(2.0,3.0)', 8], ['real(4)', 4], ['real_to_int(-2.9)', -2],
        ['round(1.6)', 2], ['sh_left(3,2)', 12], ['sh_right(12,2)', 3],
        ['sin(0.0)', 0], ['sqrt(9.0)', 3], ['tan(0.0)', 0],
        ['random(5,5)', 5], ['callback_status(99999)', 0]
    ];
    const calls = await execute(`on init ${expressions.map(([expression]) => `message(${expression})`).join('\n')} end on`);
    assert.deepEqual(calls.map(call => call.args[0]), expressions.map(([, expected]) => expected));
});

test('conditional NKSP_NO_MESSAGE removes required host logging and resets deliberately', () => {
    const muted = compileSfzScript('SET_CONDITION(NKSP_NO_MESSAGE)\non init message("hidden") end on');
    assert.ok(!muted.requiredBuiltins.includes('message'));
    const audible = compileSfzScript('SET_CONDITION(NKSP_NO_MESSAGE)\nRESET_CONDITION(NKSP_NO_MESSAGE)\non init message("visible") end on');
    assert.ok(audible.requiredBuiltins.includes('message'));
});

test('native default fork lifetime and abort do not leave detached child callbacks', { skip: !nativeRunner }, async () => {
    const calls = await execute(`
        on note
          declare local $child := fork()
          if ($child # 0) wait(1ms) play_note(12) end if
          abort($NI_CALLBACK_ID)
          play_note(13)
        end on
    `);
    assert.deepEqual(calls, []);
});

test('native user functions preserve bounded recursive locals and typed arguments/results', { skip: !nativeRunner }, async () => {
    const calls = await execute(`
        function factorial($n) -> $value
          if ($n < 2) $value := 1 exit end if
          $value := $n * call factorial($n - 1)
        end function
        function sum($a, $b := 3) -> $value := 10
          $value := $value + $a + $b
        end function
        on init
          message(call factorial(5))
          message(call sum(2))
          message(call sum(call factorial(3),4))
        end on
    `);
    assert.deepEqual(calls.map(call => call.args[0]), [120, 15, 20]);
});

test('native function waits preserve caller expression and local state across checkpoints', { skip: !nativeRunner }, async () => {
    const calls = await execute(`
        function delayed($note, $time := 1ms) -> $value
          wait($time)
          $value := play_note($note)
        end function
        on note
          declare local $voice := call delayed($EVENT_NOTE)
          message($voice)
        end on
    `);
    assert.deepEqual(calls.map(call => [call.frame, call.args[0]]), [[48, 60], [48, 100], [144, 64], [144, 101]]);
});

test('bounded history slices resume large timed loops without shifting deadlines or failing the session', { skip: !nativeRunner }, async () => {
    const calls = await execute(`
        on note
          declare local $i := 0
          while ($i < 1000)
            wait(1s - 999ms)
            inc($i)
            if ($i mod 100 = 0) message($ENGINE_UPTIME) end if
          end while
        end on
    `, 'slices');
    assert.deepEqual(calls.map(call => [call.frame, call.args[0]]),
        Array.from({ length: 10 }, (_, index) => [(index + 1) * 4800, (index + 1) * 100]));
});

test('native voice parameter decoding preserves units, relative modes and target timing', { skip: !nativeRunner }, () => {
    const result = spawnSync(nativeRunner, ['--parameters'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});

test('native voice automation preserves fades, retarget continuity, relative destinations and sample-rate clocks', { skip: !nativeRunner }, () => {
    const result = spawnSync(nativeRunner, ['--automation'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('array stores reject indirect final values while scalar reassignment remains valid', { skip: !nativeRunner }, async () => {
    assert.throws(() => compileSfzScript('on init declare $value := 0 declare %a[1] $value := !1 %a[0] := $value end on'), { code: 'script-invalid' });
    const calls = await execute(`on init
      declare $value := !1
      declare %a[1]
      $value := 0
      %a[0] := $value
      message(%a[0])
      $value := !2
      if (1) $value := 3 end if
      %a[0] := $value
      message(%a[0])
    end on`);
    assert.deepEqual(calls.map(call => call.args[0]), [0, 3]);
    await execute('on init declare $value := 0 declare %a[1] if (1) $value := !1 end if %a[0] := $value end on', null, null, 5);
    await execute(`function copy($value) -> $result
      $result := $value
    end function
    on init declare %a[1] %a[0] := call copy(!1) end on`, null, null, 5);
});

test('native inline increment and decrement return values with metric units and finalness', { skip: !nativeRunner }, async () => {
    const calls = await execute(`on init
      declare $time := !1ms
      declare $i := 1
      message(inc($i))
      message(dec($i))
      message(inc($time))
      message(dec($time))
    end on`);
    assert.deepEqual(calls.map(call => call.args[0]), [2, 1, .002, .001]);
});

test('string concatenation follows numeric and comparison expressions', { skip: !nativeRunner }, async () => {
    const calls = await execute('on init message("sum=" & 2+3 & ", relation=" & 3<4) end on');
    assert.deepEqual(calls.map(call => call.args[0]), ['sum=5, relation=1']);
});

test('signed 64-bit arithmetic, comparisons and bit operations remain exact above double precision', { skip: !nativeRunner }, async () => {
    const expressions = [
        ['9007199254740993 + 1', '9007199254740994'],
        ['9223372036854775807 - 1', '9223372036854775806'],
        ['-9223372036854775808 + 1', '-9223372036854775807'],
        ['3037000499 * 3037000499', '9223372030926249001'],
        ['9223372036854775807 / 3', '3074457345618258602'],
        ['9223372036854775807 mod 3', '1'],
        ['9007199254740993 = 9007199254740992', '0'],
        ['9007199254740993 > 9007199254740992', '1'],
        ['sh_left(1,63)', '-9223372036854775808'],
        ['sh_right(-9223372036854775808,63)', '-1'],
        ['.not. 9223372036854775807', '-9223372036854775808'],
        ['9223372036854775807 .and. 9007199254740993', '9007199254740993'],
        ['min(9007199254740993,9007199254740992)', '9007199254740992'],
        ['max(9007199254740993,9007199254740992)', '9007199254740993'],
        ['random(9223372036854775807,9223372036854775807)', '9223372036854775807'],
        ['1 s - 12 ms', '988ms'],
        ['ceil(1.2ms)', '2ms']
    ];
    const calls = await execute(`on init ${expressions.map(([expression]) => `message("" & (${expression}))`).join('\n')} end on`);
    assert.deepEqual(calls.map(call => call.args[0]), expressions.map(([, expected]) => expected));
});

test('signed 64-bit globals, arrays and function locals survive suspended checkpoint restore', { skip: !nativeRunner }, async () => {
    const calls = await execute(`on init
      declare $large := 9007199254740993
      declare %values[2] := (9007199254740993,9007199254740992)
      sort(%values)
      message("" & %values[0])
      message(search(%values,$large))
    end on
    function delayed($value) -> $result
      wait(1ms)
      $result := $value + 1
    end function
    on note message("" & call delayed($large)) end on`);
    assert.deepEqual(calls.filter(call => call.fn === SFZ_SCRIPT_BUILTINS.indexOf('message')).map(call => call.args[0]),
        ['9007199254740992', 1, '9007199254740994', '9007199254740994']);
});

test('integer division scales metric prefixes before truncation without losing signed 64-bit precision', { skip: !nativeRunner }, async () => {
    const expressions = [
        ['1s/500ms', '2'], ['2s/1000ms', '2'], ['2k/1000', '2'], ['1000ms/1s', '1'],
        ['-1s/500ms', '-2'], ['1s/-500ms', '-2'], ['-1s/-500ms', '2'],
        ['1999ms/1s', '1'], ['-1999ms/1s', '-1'], ['1000ms/2', '500ms'],
        ['9007199254740993k/1000', '9007199254740993'],
        ['9223372036854775807k/1000', '9223372036854775807'],
        ['9223372036854775806k/9223372036854775807', '999'],
        ['-9223372036854775808k/1000', '-9223372036854775808'],
        ['-9223372036854775808m/-1', '9223372036854775'],
        ['1kk/1uu', '1000000000000000000'], ['1uu/1kk', '0']
    ];
    const calls = await execute(`on init ${expressions.map(([expression]) => `message("" & (${expression}))`).join('\n')}
      declare %a[2k/1000]
      declare %b[9223372036854775806k/9223372036854775807/100]
      declare %c[-2k/-1000]
      message(num_elements(%a)) message(num_elements(%b)) message(num_elements(%c))
    end on`);
    assert.deepEqual(calls.map(call => call.args[0]), [...expressions.map(([, result]) => result), 2, 9, 2]);
    for (const expression of ['9223372036854775807/1m', '10kk/1uu', '-9223372036854775808/-1', '1s/0ms'])
        await execute(`on init message(${expression}) end on`, null, null, 5);
    assert.throws(() => compileSfzScript('on init declare %a[9223372036854775807/1m] end on'), { code: 'script-invalid' });
});

test('integer literals and arithmetic report signed overflow instead of rounding or invoking undefined behavior', { skip: !nativeRunner }, async () => {
    for (const literal of ['9223372036854775808', '-9223372036854775809'])
        assert.throws(() => compileSfzScript(`on init message(${literal}) end on`), { code: 'script-invalid' });
    for (const expression of ['9223372036854775807+1', '-9223372036854775808-1', '3037000500*3037000500', '-9223372036854775808/-1', 'abs(-9223372036854775808)'])
        await execute(`on init message(${expression}) end on`, null, null, 5);
});

test('marked event references snapshot all IDs before destructive host calls', { skip: !nativeRunner }, async () => {
    const calls = await execute(`on init
      declare $a := play_note(60)
      declare $b := play_note(64)
      set_event_mark($a,$MARK_1)
      set_event_mark($b,$MARK_1)
      set_event_mark($a,$MARK_28)
      message(num_elements(by_marks($MARK_1)))
      delete_event_mark(by_marks($MARK_28),$MARK_28)
      note_off(by_marks($MARK_1))
      message(num_elements(by_marks($MARK_1)))
    end on`);
    assert.deepEqual(calls.filter(call => call.fn === SFZ_SCRIPT_BUILTINS.indexOf('message')).map(call => call.args[0]), [2, 0]);
    assert.deepEqual(calls.filter(call => call.fn === SFZ_SCRIPT_BUILTINS.indexOf('note_off')).map(call => call.args[0]), [100, 101]);
});

test('repeated note callbacks reuse string, local-array, polyphonic and mark storage', { skip: !nativeRunner }, async () => {
    const calls = await execute(`on init declare polyphonic $voice end on
      on note
        declare local @label := "note " & $EVENT_NOTE
        declare local %notes[2] := (60,64)
        $voice := play_note(%notes[1])
        set_event_mark($voice,$MARK_1)
        message(@label & ": " & %notes[1])
      end on
      on release note_off(by_marks($MARK_1)) end on`, 'repeat');
    const messages = calls.filter(call => call.fn === SFZ_SCRIPT_BUILTINS.indexOf('message'));
    assert.equal(messages.length, 1001);
    assert.ok(messages.every(call => call.args[0] === 'note 60: 64'));
    assert.equal(calls.filter(call => call.fn === SFZ_SCRIPT_BUILTINS.indexOf('note_off')).length, 1000);
});

test('new real polyphonic variables begin at typed zero and retain per-note values through checkpoints', { skip: !nativeRunner }, async () => {
    const calls = await execute(`on init declare polyphonic ~pitch end on
      on note message(~pitch+1.0) ~pitch := 0.5 end on
      on release message(~pitch) end on`);
    assert.deepEqual(calls.map(call => call.args[0]), [1, 1, .5]);
});

test('cross-instance checkpoint rate adaptation preserves elapsed seconds, pending waits and script values', { skip: !nativeRunner }, async () => {
    const source = `on init declare $unchanged := 12345 end on
      on note wait(20ms) message($unchanged) wait(10ms) message($ENGINE_UPTIME) end on`;
    for (const rate of [44100, 96000]) {
        const calls = await execute(source, `rescale${rate}`);
        assert.deepEqual(calls.map(call => [call.frame, call.args[0]]), [[rate * .02, 12345], [rate * .03, 30]]);
    }
    const tied = await execute('on init wait(416us) message(1) end on on note wait(395us) message(2) end on', 'rescale-ties');
    assert.deepEqual(tied.map(call => [call.frame, call.args[0]]), [[10, 2], [10, 1]]);
});

test('profiling checkpoint restore includes wall gaps only in real timers, leaving musical waits frozen', { skip: !nativeRunner }, async () => {
    const calls = await execute(`on note
      declare local $real := $NKSP_REAL_TIMER
      declare local $compat := $KSP_TIMER
      declare local $performance := $NKSP_PERF_TIMER
      wait(1ms)
      message($NKSP_REAL_TIMER-$real)
      message($KSP_TIMER-$compat)
      message($NKSP_PERF_TIMER-$performance)
      message($ENGINE_UPTIME)
    end on`, 'profiling');
    const values = calls.map(call => call.args[0]);
    assert.ok(values[0] >= 4000 && values[1] >= 4000);
    assert.ok(values[2] >= 0 && values[2] < values[0]);
    assert.equal(values[3], 1);
    assert.ok(calls.every(call => call.frame === 48));
});

test('native program preparation rejects malformed bytecode and unavailable host capabilities', { skip: !nativeRunner }, async () => {
    const source = 'on init declare $n := 1 message($n) end on';
    const corruptions = [
        bytes => bytes.subarray(0, bytes.length - 1),
        bytes => { new DataView(bytes.buffer).setUint32(36, 999999, true); return bytes; },
        bytes => { new DataView(bytes.buffer).setUint32(72, 999999, true); return bytes; },
        bytes => { const view = new DataView(bytes.buffer); view.setFloat64(80, NaN, true); view.setUint32(88, 1, true); return bytes; },
        bytes => {
            const view = new DataView(bytes.buffer);
            const offset = 64 + view.getUint32(16, true) * 16 + view.getUint32(12, true) * 144;
            view.setUint32(offset + 4, 999999, true); return bytes;
        },
        bytes => {
            const view = new DataView(bytes.buffer);
            const offset = 64 + view.getUint32(16, true) * 16 + view.getUint32(12, true) * 144;
            view.setUint32(offset + 8, 1, true); return bytes;
        },
        bytes => {
            const view = new DataView(bytes.buffer);
            const start = 64 + view.getUint32(16, true) * 16 + view.getUint32(12, true) * 144;
            for (let offset = start; offset < bytes.length; offset += 16) if (view.getUint32(offset, true) === 10) {
                view.setUint32(offset + 8, 0, true); break;
            }
            return bytes;
        }
    ];
    for (const mutate of corruptions) await execute(source, null, mutate, 3);
    await execute('on note change_attack($EVENT_ID, 10) end on', null, null, 4);
    await execute('on init declare %notes[2] end on on note play_note(%notes[$EVENT_NOTE]) end on', null, null, 5);
});
