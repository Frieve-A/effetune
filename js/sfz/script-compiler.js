// NKSP is compiled during instrument preparation. No instrument text is executed as JavaScript.
import { SFZ_SCRIPT_PROGRAM_VERSION } from './script-format.js';
export const SFZ_SCRIPT_CALLBACKS = Object.freeze(['init', 'note', 'release', 'controller', 'rpn', 'nrpn']);
export const SFZ_SCRIPT_BUILTINS = Object.freeze([
    'abort', 'acos', 'abs', 'array_equal', 'asin', 'atan', 'callback_status', 'ceil', 'cos', 'dec',
    'exit', 'exp', 'floor', 'fork', 'inc', 'int', 'int_to_real', 'in_range', 'log', 'log10', 'log2',
    'lsb', 'max', 'message', 'min', 'msb', 'num_elements', 'pow', 'random', 'real', 'real_to_int',
    'round', 'search', 'sh_left', 'sh_right', 'sin', 'sort', 'sqrt', 'stop_wait', 'tan', 'wait',
    'by_marks', 'change_amp_lfo_depth', 'change_amp_lfo_freq', 'change_attack', 'change_cutoff',
    'change_cutoff_attack', 'change_cutoff_decay', 'change_cutoff_lfo_depth', 'change_cutoff_lfo_freq',
    'change_cutoff_release', 'change_cutoff_sustain', 'change_decay', 'change_note', 'change_pan',
    'change_pan_curve', 'change_pan_time', 'change_pitch_lfo_depth', 'change_pitch_lfo_freq',
    'change_play_pos', 'change_release', 'change_reso', 'change_sustain', 'change_tune',
    'change_tune_curve', 'change_tune_time', 'change_velo', 'change_vol', 'change_vol_curve',
    'change_vol_time', 'delete_event_mark', 'event_status', 'fade_in', 'fade_out', 'get_event_par',
    'ignore_controller', 'ignore_event', 'note_off', 'play_note', 'set_controller', 'set_event_mark',
    'set_event_par', 'set_nrpn', 'set_rpn'
]);
export const SFZ_SCRIPT_VARIABLES = Object.freeze([
    '$KSP_TIMER', '$NKSP_PERF_TIMER', '%NKSP_CALLBACK_CHILD_ID', '$NKSP_CALLBACK_PARENT_ID',
    '$NKSP_REAL_TIMER', '$NI_CALLBACK_ID', '$NI_CALLBACK_TYPE', '$NKSP_IGNORE_WAIT', '%ALL_EVENTS',
    '$CC_NUM', '%CC', '$EVENT_ID', '$EVENT_NOTE', '$EVENT_VELOCITY', '%KEY_DOWN', '$RPN_ADDRESS',
    '$RPN_VALUE', '$ENGINE_UPTIME'
]);
const OP = Object.freeze({ end: 0, constant: 1, load: 2, store: 3, builtinVariable: 4, reference: 5,
    unary: 6, binary: 7, jump: 8, jumpFalse: 9, builtin: 10, drop: 11, call: 12, ret: 13,
    duplicate: 14, synchronized: 15 });
const BINARY = ['+', '-', '*', '/', 'mod', '=', '#', '<', '>', '<=', '>=', 'and', 'or', '.and.', '.or.', '.xor.', '&'];
const PRECEDENCE = new Map([['or', 1], ['and', 2], ['=', 3], ['#', 3], ['<', 3], ['>', 3],
    ['<=', 3], ['>=', 3], ['.or.', 4], ['.xor.', 4], ['.and.', 5], ['&', 0], ['+', 7], ['-', 7],
    ['*', 8], ['/', 8], ['mod', 8]]);
const CONSTANTS = new Map([
    ['$CALLBACK_STATUS_QUEUE', 1], ['$CALLBACK_STATUS_RUNNING', 2], ['$CALLBACK_STATUS_TERMINATED', 0],
    ['$EVENT_STATUS_INACTIVE', 0], ['$EVENT_STATUS_NOTE_QUEUE', 1], ['$EVENT_PAR_NOTE', 0],
    ['$EVENT_PAR_TUNE', 1], ['$EVENT_PAR_VELOCITY', 2], ['$EVENT_PAR_VOLUME', 3],
    ['$VCC_MONO_AT', 128], ['$VCC_PITCH_BEND', 129], ['$NKSP_LINEAR', 0], ['$NKSP_EASE_IN_EASE_OUT', 1],
    ['$NI_MATH_E', Math.E], ['$NI_MATH_PI', Math.PI],
    ['~NI_MATH_E', Math.E], ['~NI_MATH_PI', Math.PI],
    ...SFZ_SCRIPT_CALLBACKS.map((name, index) => [`$NI_CB_TYPE_${name.toUpperCase()}`, index]),
    ...Array.from({ length: 4 }, (_, i) => [`$EVENT_PAR_${i}`, i + 4]),
    ...Array.from({ length: 28 }, (_, i) => [`$MARK_${i + 1}`, 2 ** i])
]);
const SIGNATURES = new Map([
    ['abort', [1, 1]], ['exit', [0, 0]], ['fork', [0, 2]], ['stop_wait', [1, 2]], ['wait', [1, 1]],
    ['play_note', [1, 4]], ['note_off', [1, 2]], ['ignore_controller', [0, 1]], ['ignore_event', [0, 1]],
    ['fade_in', [2, 2]], ['fade_out', [2, 3]], ['set_event_par', [3, 3]], ['set_rpn', [2, 2]],
    ['set_nrpn', [2, 2]], ['get_event_par', [2, 2]], ['sort', [1, 2]], ['search', [2, 2]],
    ['array_equal', [2, 2]], ['in_range', [3, 3]], ['random', [2, 2]], ['pow', [2, 2]],
    ['min', [2, 2]], ['max', [2, 2]], ['sh_left', [2, 2]], ['sh_right', [2, 2]],
    ['set_controller', [2, 2]], ['set_event_mark', [2, 2]], ['delete_event_mark', [2, 2]],
    ...['change_vol', 'change_tune', 'change_pan'].map(name => [name, [2, 3]])
]);
const encoder = new TextEncoder();

function invalid(message, token = { line: 1 }) {
    const error = new Error(`NKSP line ${token.line}: ${message}`);
    error.code = 'script-invalid';
    error.line = token.line;
    return error;
}

function tokenize(source, disabledMessages = new Set()) {
    if (typeof source !== 'string' || source.length > 262144) throw invalid('Script exceeds its source budget.');
    const tokens = [];
    let at = 0, line = 1;
    while (at < source.length) {
        const start = at, c = source[at];
        if (/\s/.test(c)) { if (c === '\n') line++; at++; continue; }
        if (c === '{') {
            at++;
            while (at < source.length && source[at] !== '}') { if (source[at++] === '\n') line++; }
            if (at === source.length) throw invalid('Unterminated comment.', { line });
            at++; continue;
        }
        if (c === '"') {
            let value = '';
            at++;
            while (at < source.length && source[at] !== '"') {
                if (source[at] === '\n') line++;
                value += source[at++];
            }
            if (at === source.length) throw invalid('Unterminated string.', { line });
            at++;
            if (encoder.encode(value).length >= 128) throw invalid('String exceeds 127 UTF-8 bytes.', { line });
            tokens.push({ text: value, kind: 'string', line });
            continue;
        }
        const rest = source.slice(at);
        const match = /^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:[ \t]*(?:da|[umcdhk])){0,2}(?:[ \t]*(?:s|Hz|B))?(?![A-Za-z_0-9])|[$~%@?]?[A-Za-z_][A-Za-z_0-9]*|\.(?:and|or|xor|not)\.|:=|->|<=|>=|[()[\],+*/=<>#!&;\-])/.exec(rest);
        if (!match) throw invalid(`Unexpected character ${c}.`, { line });
        at += match[0].length;
        tokens.push({ text: match[0], disabledMessage: disabledMessages.has(line), kind: /^[\d.]/.test(c) && !match[0].startsWith('.a') &&
            !match[0].startsWith('.o') && !match[0].startsWith('.x') && !match[0].startsWith('.n') ? 'number' : 'token', line });
        if (at === start || tokens.length > 65536) throw invalid('Script exceeds its token budget.', { line });
    }
    tokens.push({ text: '<eof>', line });
    return tokens;
}

class Parser {
    constructor(tokens) { this.tokens = tokens; this.at = 0; this.depth = 0; }
    peek(text) { return this.tokens[this.at].text === text; }
    take() { return this.tokens[this.at++]; }
    accept(text) { if (!this.peek(text)) return false; this.at++; return true; }
    expect(text) { if (!this.accept(text)) throw invalid(`Expected ${text}.`, this.tokens[this.at]); }
    expression(minimum = 0) {
        if (++this.depth > 64) throw invalid('Expression nesting exceeds 64 levels.', this.tokens[this.at]);
        const token = this.take();
        let node;
        if (['-', '+', 'not', '.not.', '!'].includes(token.text)) node = { kind: 'unary', op: token.text, value: this.expression(9), token };
        else if (token.text === '(') { node = this.expression(); this.expect(')'); }
        else if (token.kind === 'number' || token.kind === 'string') node = { kind: token.kind, value: token.text, token };
        else if (token.text === 'call') {
            const name = this.take().text, args = [];
            if (this.accept('(')) {
                if (!this.peek(')')) do { args.push(this.expression()); } while (this.accept(','));
                this.expect(')');
            }
            node = { kind: 'call', name, args, token };
        }
        else if (/^[$~%@?]/.test(token.text)) {
            node = { kind: 'variable', name: token.text === '$ALL_EVENTS' ? '%ALL_EVENTS' : token.text,
                deprecatedArrayName: token.text === '$ALL_EVENTS', token };
            if (this.accept('[')) { node.index = this.expression(); this.expect(']'); }
        } else if (/^[A-Za-z_]/.test(token.text)) {
            const args = [];
            if (token.text === 'exit' && !this.peek('(')) {
                this.depth--;
                return { kind: 'builtin', name: 'exit', args, token };
            }
            this.expect('(');
            if (!this.peek(')')) do { args.push(this.expression()); } while (this.accept(','));
            this.expect(')');
            node = { kind: 'builtin', name: token.text, args, token };
        } else throw invalid('Expected an expression.', token);
        while (PRECEDENCE.has(this.tokens[this.at].text) && PRECEDENCE.get(this.tokens[this.at].text) >= minimum) {
            const op = this.take().text;
            node = { kind: 'binary', op, left: node, right: this.expression(PRECEDENCE.get(op) + 1), token };
        }
        this.depth--;
        return node;
    }
    block(stop = ['end', 'else', 'case']) {
        if (++this.depth > 64) throw invalid('Block nesting exceeds 64 levels.', this.tokens[this.at]);
        const body = [];
        while (!stop.includes(this.tokens[this.at].text) && !this.peek('<eof>')) {
            if (this.accept(';')) continue;
            body.push(this.statement());
        }
        this.depth--;
        return body;
    }
    statement() {
        const token = this.tokens[this.at];
        if (this.accept('declare')) {
            const modifiers = [];
            while (['const', 'local', 'polyphonic', 'patch'].includes(this.tokens[this.at].text)) modifiers.push(this.take().text);
            const name = this.take().text;
            if (!/^[$~%@?][A-Za-z_]\w*$/.test(name)) throw invalid('Invalid variable name.', token);
            let size = null, value = null;
            if (this.accept('[')) { size = this.expression(); this.expect(']'); }
            if (this.accept(':=')) {
                if (size && this.accept('(')) {
                    value = [];
                    if (!this.peek(')')) do { value.push(this.expression()); } while (this.accept(','));
                    this.expect(')');
                } else value = this.expression();
            }
            return { kind: 'declare', modifiers, name, size, value, token };
        }
        if (this.accept('if')) {
            const condition = this.expression();
            const yes = this.block();
            const no = this.accept('else') ? this.block() : [];
            this.expect('end'); this.expect('if');
            return { kind: 'if', condition, yes, no, token };
        }
        if (this.accept('while')) {
            const condition = this.expression(), body = this.block();
            this.expect('end'); this.expect('while');
            return { kind: 'while', condition, body, token };
        }
        if (this.accept('select')) {
            const value = this.expression(), cases = [];
            while (this.accept('case')) {
                const low = this.expression();
                const high = this.accept('to') ? this.expression() : low;
                cases.push({ low, high, body: this.block() });
            }
            this.expect('end'); this.expect('select');
            return { kind: 'select', value, cases, token };
        }
        if (this.accept('synchronized')) {
            const body = this.block(); this.expect('end'); this.expect('synchronized');
            return { kind: 'synchronized', body, token };
        }
        const value = this.expression();
        if (this.accept(':=')) {
            if (value.kind !== 'variable') throw invalid('Assignment requires a variable.', token);
            return { kind: 'assign', target: value, value: this.expression(), token };
        }
        if (value.kind !== 'builtin' && value.kind !== 'call') throw invalid('Expected an assignment or function call.', token);
        return { kind: 'expression', value, token };
    }
    parse() {
        const callbacks = new Map(), functions = new Map(), declarations = [];
        while (!this.peek('<eof>')) {
            if (this.accept(';')) continue;
            if (this.accept('on')) {
                const token = this.take(), name = token.text;
                if (!SFZ_SCRIPT_CALLBACKS.includes(name) || callbacks.has(name)) throw invalid('Unknown or repeated callback.', token);
                callbacks.set(name, this.block()); this.expect('end'); this.expect('on');
            } else if (this.accept('function')) {
                const token = this.take();
                if (functions.has(token.text) || SFZ_SCRIPT_BUILTINS.includes(token.text)) throw invalid('Repeated or reserved function.', token);
                const parameters = [];
                const parameter = () => {
                    const name = this.take().text;
                    if (!/^[$~@][A-Za-z_]\w*$/.test(name)) throw invalid('Function parameters must be scalar variables.', token);
                    return { kind: 'declare', name, modifiers: ['local'], value: this.accept(':=') ? this.expression() : null, token };
                };
                if (this.accept('(')) {
                    if (!this.peek(')')) do { parameters.push(parameter()); } while (this.accept(','));
                    this.expect(')');
                }
                const result = this.accept('->') ? parameter() : null;
                functions.set(token.text, { parameters, result, body: this.block(), token });
                this.expect('end'); this.expect('function');
            } else {
                const statement = this.statement();
                if (statement.kind !== 'declare') throw invalid('Only declarations are allowed outside callbacks.', statement.token);
                declarations.push(statement);
            }
        }
        return { callbacks, functions, declarations };
    }
}

function preprocess(source) {
    const conditions = new Set(), stack = [], disabledMessages = new Set();
    let enabled = true, comment = false, string = false;
    const text = source.split(/\r?\n/).map((line, index) => {
        const startsInString = string;
        let visible = '';
        for (const character of line) {
            if (!string && !comment && character === '{') comment = true;
            else if (comment && character === '}') { comment = false; visible += ' '; continue; }
            else if (!comment && character === '"') string = !string;
            visible += comment ? ' ' : character;
        }
        const match = !startsInString && /^\s*(SET_CONDITION|RESET_CONDITION|USE_CODE_IF|USE_CODE_IF_NOT|END_USE_CODE)\b(?:\s*\(\s*([A-Za-z_]\w*)\s*\))?\s*$/.exec(visible);
        if (!match) {
            if (conditions.has('NKSP_NO_MESSAGE')) disabledMessages.add(index + 1);
            return enabled ? visible : '';
        }
        const [, directive, name] = match;
        if (directive === 'END_USE_CODE') {
            if (!stack.length) throw invalid('Unmatched END_USE_CODE.', { line: index + 1 });
            enabled = stack.pop();
        } else if (directive.startsWith('USE_CODE')) {
            if (!name || stack.length >= 32) throw invalid('Invalid conditional compilation block.', { line: index + 1 });
            stack.push(enabled);
            enabled = enabled && (conditions.has(name) === (directive === 'USE_CODE_IF'));
        } else if (enabled) {
            if (!name) throw invalid('Missing condition name.', { line: index + 1 });
            if (directive === 'SET_CONDITION') conditions.add(name); else conditions.delete(name);
        }
        return '';
    }).join('\n');
    if (comment) throw invalid('Unterminated comment.');
    if (stack.length) throw invalid('Unterminated conditional compilation block.');
    return { text, disabledMessages };
}

/** A bounded, versioned binary consumed by the same native VM in desktop and WASM. */
export function compileSfzScript(source) {
    if (typeof source !== 'string' || source.length > 262144) throw invalid('Script exceeds its source budget.');
    const prepared = preprocess(source);
    const ast = new Parser(tokenize(prepared.text, prepared.disabledMessages)).parse();
    const instructions = [], constants = [], variables = [], globals = new Map(), initialization = [], diagnostics = [];
    const warned = new Set();
    const cells = [0, 0, 0], entries = Array(6).fill(0xffffffff), functionEntries = new Map(), calls = [];
    let currentFunction = null;
    const emit = (op, a = 0, b = 0, c = 0) => {
        if (instructions.length >= 8192) throw invalid('Script exceeds its instruction budget.');
        instructions.push([OP[op], a, b, c]); return instructions.length - 1;
    };
    function literal(node, negative = false) {
        if (node.kind === 'string') return { number: 0, kind: 2, flags: 0, text: node.value };
        const match = /^((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)((?:da|[umcdhk]){0,2})(s|Hz|B)?$/.exec(node.value.replace(/[ \t]/g, ''));
        if (!match) throw invalid('Invalid numeric literal.', node.token);
        const kind = /[.eE]/.test(match[1]) ? 1 : 0;
        const integer = kind ? 0n : BigInt(match[1]) * (negative ? -1n : 1n);
        if (integer < -(1n << 63n) || integer > (1n << 63n)) throw invalid('Integer literal exceeds signed 64-bit storage.', node.token);
        let number = Number(match[1]) * (negative ? -1 : 1), flags = match[3] === 's' ? 1 : match[3] === 'Hz' ? 2 : match[3] === 'B' ? 3 : 0;
        let exponent = 0;
        for (const prefix of match[2].match(/da|[umcdhk]/g) || []) exponent += { u: -6, m: -3, c: -2, d: -1, da: 1, h: 2, k: 3 }[prefix];
        number *= 10 ** exponent;
        if (match[2]) flags |= 512 | ((exponent & 255) << 16);
        if (!Number.isFinite(number)) throw invalid('Invalid numeric literal.', node.token);
        return { number, integer, kind, flags, text: '' };
    }
    function constant(value) {
        value.integer ??= value.kind === 0 ? BigInt(value.number) : 0n;
        if (value.kind === 0 && value.integer > (1n << 63n) - 1n) throw invalid('Integer literal exceeds signed 64-bit storage.');
        const index = constants.findIndex(item => item.number === value.number && item.integer === value.integer && item.kind === value.kind && item.flags === value.flags && item.text === value.text);
        if (index >= 0) return index;
        if (constants.length >= 512) throw invalid('Script exceeds its constant budget.');
        constants.push(value); return constants.length - 1;
    }
    const numeric = number => constant({ number, kind: 0, flags: 0, text: '' });
    function staticCoefficient(node, depth = 0) {
        if (depth > 64) throw invalid('Constant expression is recursive or too deeply nested.', node.token);
        const checked = (integer, exponent) => {
            if (integer < -(1n << 63n) || integer > (1n << 63n) - 1n || exponent < -12 || exponent > 12) throw invalid('Constant arithmetic exceeds its numeric budget.', node.token);
            return { integer, exponent };
        };
        if (node.kind === 'number' || (node.kind === 'unary' && node.op === '-' && node.value.kind === 'number')) {
            const value = literal(node.kind === 'number' ? node : node.value, node.kind === 'unary');
            if (value.kind !== 0 || (value.flags & 3) || value.integer > (1n << 63n) - 1n) throw invalid('A constant unitless integer is required.', node.token);
            const exponent = (value.flags >> 16) & 255;
            return checked(value.integer, exponent < 128 ? exponent : exponent - 256);
        }
        if (node.kind === 'unary' && node.op === '-') {
            const value = staticCoefficient(node.value, depth + 1);
            return checked(-value.integer, value.exponent);
        }
        if (node.kind === 'variable') {
            if (CONSTANTS.has(node.name) && Number.isInteger(CONSTANTS.get(node.name))) return { integer: BigInt(CONSTANTS.get(node.name)), exponent: 0 };
            const variable = globals.get(node.name);
            if (variable?.constant && variable.declaration.value) return staticCoefficient(variable.declaration.value, depth + 1);
        }
        if (node.kind === 'binary') {
            const a = staticCoefficient(node.left, depth + 1), b = staticCoefficient(node.right, depth + 1);
            if (node.op === '*' || node.op === '/') {
                if (node.op === '/' && b.integer === 0n) throw invalid('Constant division by zero.', node.token);
                if (node.op === '*') return checked(a.integer * b.integer, a.exponent + b.exponent);
                const difference = a.exponent - b.exponent;
                const numerator = difference > 0 ? a.integer * 10n ** BigInt(difference) : a.integer;
                const denominator = difference < 0 ? b.integer * 10n ** BigInt(-difference) : b.integer;
                return checked(numerator / denominator, 0);
            }
            const exponent = Math.min(a.exponent, b.exponent);
            const left = a.integer * 10n ** BigInt(a.exponent - exponent), right = b.integer * 10n ** BigInt(b.exponent - exponent);
            if (node.op === '+') return checked(left + right, exponent);
            if (node.op === '-') return checked(left - right, exponent);
        }
        throw invalid('A constant integer expression is required.', node.token);
    }
    function staticNumber(node) {
        const value = staticCoefficient(node);
        if (value.exponent < -12 || value.exponent > 12) throw invalid('Constant metric precision exceeds its budget.', node.token);
        const scale = 10n ** BigInt(Math.abs(value.exponent));
        if (value.exponent < 0 && value.integer % scale !== 0n) throw invalid('A whole constant integer is required.', node.token);
        return value.exponent < 0 ? value.integer / scale : value.integer * scale;
    }
    function declare(node, scope) {
        if (variables.length >= 128) throw invalid('Script exceeds its variable budget.', node.token);
        if (node.modifiers.includes('local') && node.modifiers.includes('polyphonic')) throw invalid('Variable has conflicting scopes.', node.token);
        if ([...CONSTANTS.keys(), ...SFZ_SCRIPT_VARIABLES].some(name => name.slice(1) === node.name.slice(1))) throw invalid('Reserved variable name.', node.token);
        const array = /^[%?]/.test(node.name);
        if (scope === 2 && (array || node.name.startsWith('@'))) throw invalid('Polyphonic variables must be numeric scalars.', node.token);
        if (array !== Boolean(node.size)) throw invalid('Array declarations require a size.', node.token);
        const length = array ? Number(staticNumber(node.size)) : 1;
        if (!Number.isInteger(length) || length < 1 || cells[scope] + length > [256, 64, 16][scope]) throw invalid('Variable storage exceeds its budget.', node.token);
        const variable = { id: variables.length, scope, type: node.name[0] === '@' ? 2 : /[~?]/.test(node.name[0]) ? 1 : 0,
            offset: cells[scope], length, array, constant: node.modifiers.includes('const'), declaration: node };
        variables.push(variable); cells[scope] += length;
        return variable;
    }
    function collect(body) {
        for (const node of body) {
            if (node.kind === 'declare' && !node.modifiers.includes('local')) {
                if ([...globals.keys(), ...CONSTANTS.keys(), ...SFZ_SCRIPT_VARIABLES].some(name => name.slice(1) === node.name.slice(1))) throw invalid('Repeated or reserved variable.', node.token);
                const variable = declare(node, node.modifiers.includes('polyphonic') ? 2 : 0);
                globals.set(node.name, variable);
                if (variable.scope === 0) initialization.push(node);
                else if (node.value) throw invalid('Polyphonic variables cannot have an initializer.', node.token);
            }
            if (node.body) collect(node.body);
            if (node.yes) { collect(node.yes); collect(node.no); }
            if (node.cases) for (const item of node.cases) collect(item.body);
        }
    }
    collect(ast.declarations);
    for (const body of ast.callbacks.values()) collect(body);
    for (const fn of ast.functions.values()) collect(fn.body);
    for (const fn of ast.functions.values()) {
        fn.locals = new Map();
        fn.variables = [];
        fn.firstLocal = cells[1];
        for (const node of [...fn.parameters, ...(fn.result ? [fn.result] : [])]) {
            if ([...fn.locals.keys()].some(name => name.slice(1) === node.name.slice(1))) throw invalid('Repeated function parameter or result.', node.token);
            const variable = declare(node, 1);
            fn.locals.set(node.name, variable); fn.variables.push(variable);
        }
        const allocateLocals = body => {
            for (const node of body) {
                if (node.kind === 'declare' && node.modifiers.includes('local')) node.variable = declare(node, 1);
                if (node.body) allocateLocals(node.body);
                if (node.yes) { allocateLocals(node.yes); allocateLocals(node.no); }
                if (node.cases) for (const item of node.cases) allocateLocals(item.body);
            }
        };
        allocateLocals(fn.body);
        fn.localCount = cells[1] - fn.firstLocal;
    }
    function lookup(node, locals) {
        if (!locals.has(node.name) && [...locals.keys()].some(name => name.slice(1) === node.name.slice(1))) throw invalid('Local variable was referenced with a different type prefix.', node.token);
        const variable = locals.get(node.name) || globals.get(node.name);
        if (!variable) throw invalid(`Unknown variable ${node.name}.`, node.token);
        return variable;
    }
    const type = (kind = 0, unit = 0, array = false, final = false) => ({ kind, unit, array, final });
    // Track only finalness known in the current straight-line execution. Shared
    // callback state and function results remain checked at the native array store.
    const currentFinal = new Map();
    function variableType(variable, locals, depth) {
        if (variable.unit === undefined) {
            if (variable.resolvingType) throw invalid('Variable initializer is recursive.', variable.declaration.token);
            variable.resolvingType = true;
            const value = variable.declaration.value;
            const initial = value && !Array.isArray(value) ? typeOf(value, locals, depth + 1) : type();
            variable.unit = initial.unit;
            variable.final = initial.final;
            variable.resolvingType = false;
        }
        return type(variable.type, variable.unit, variable.array, variable.final);
    }
    function typeOf(node, locals, depth = 0) {
        if (depth > 64) throw invalid('Type expression exceeds its nesting budget.', node.token);
        if (node.kind === 'number' || node.kind === 'string') { const v = literal(node); return type(v.kind, v.flags & 3); }
        if (node.kind === 'variable') {
            if (node.deprecatedArrayName && !warned.has(node)) {
                diagnostics.push({ code: 'legacy-array-name', severity: 'warning', line: node.token.line,
                    message: 'Use %ALL_EVENTS for the NKSP event array.' });
                warned.add(node);
            }
            if (CONSTANTS.has(node.name)) {
                if (node.index) throw invalid('A scalar constant cannot be indexed.', node.token);
                return type(/NI_MATH_(?:E|PI)$/.test(node.name) ? 1 : 0);
            }
            if (SFZ_SCRIPT_VARIABLES.includes(node.name)) {
                const array = node.name.startsWith('%');
                if (node.index) {
                    const index = typeOf(node.index, locals, depth + 1);
                    if (!array || index.kind !== 0 || index.unit || index.array) throw invalid('Invalid built-in variable index.', node.token);
                }
                return type(0, 0, array && !node.index);
            }
            const variable = lookup(node, locals);
            const result = variableType(variable, locals, depth);
            if (!variable.constant) result.final = currentFinal.get(variable.id) || false;
            if (node.index) {
                const index = typeOf(node.index, locals, depth + 1);
                if (index.kind !== 0 || index.unit || index.array || !result.array) throw invalid('Array index must be a unitless integer.', node.token);
                return { ...result, array: false };
            }
            return result;
        }
        if (node.kind === 'unary') {
            const result = typeOf(node.value, locals, depth + 1);
            if (result.array || result.kind > 1) throw invalid('Numeric unary operator requires a number.', node.token);
            if (['not', '.not.'].includes(node.op) && (result.kind !== 0 || result.unit)) throw invalid('Boolean and bit operators require unitless integers.', node.token);
            return ['not', '.not.'].includes(node.op) ? type() : { ...result, final: result.final || node.op === '!' };
        }
        if (node.kind === 'binary') {
            const left = typeOf(node.left, locals, depth + 1), right = typeOf(node.right, locals, depth + 1);
            if (['+', '-', '*', '/'].includes(node.op) && left.final !== right.final && !warned.has(node)) {
                diagnostics.push({ code: 'mixed-finalness', severity: 'warning', line: node.token.line,
                    message: 'Combining final and relative values produces a final result.' });
                warned.add(node);
            }
            if (left.array || right.array || left.kind === 3 || right.kind === 3) throw invalid('Operator requires scalar values.', node.token);
            if (node.op === '&') return type(2);
            if (left.kind !== right.kind || left.kind === 2) throw invalid('Numeric operands must have matching types; use an explicit cast.', node.token);
            let unit = left.unit;
            if (node.op === '*') {
                if (left.unit && right.unit) throw invalid('Multiplication cannot combine two units.', node.token);
                unit |= right.unit;
            } else if (node.op === '/') {
                if (right.unit && left.unit !== right.unit) throw invalid('Division has incompatible units.', node.token);
                if (right.unit) unit = 0;
            } else if (left.unit !== right.unit) throw invalid('Operands have different units.', node.token);
            if (['and', 'or', '.and.', '.or.', '.xor.', 'mod'].includes(node.op) && (left.kind !== 0 || unit)) throw invalid('Integer operation requires unitless integers.', node.token);
            return ['=', '#', '<', '>', '<=', '>=', 'and', 'or'].includes(node.op) ? type() : type(left.kind, unit, false, left.final || right.final);
        }
        if (node.kind === 'call') {
            const fn = ast.functions.get(node.name);
            if (!fn) throw invalid(`Unknown user function ${node.name}.`, node.token);
            if (node.args.length > fn.parameters.length) throw invalid('Too many user function arguments.', node.token);
            for (let i = 0; i < fn.parameters.length; i++) {
                const argument = node.args[i] || fn.parameters[i].value;
                if (!argument) throw invalid('Missing user function argument.', node.token);
                const actual = typeOf(argument, node.args[i] ? locals : new Map(), depth + 1);
                const expected = variableType(fn.variables[i], new Map(), depth + 1);
                if (actual.array || actual.kind !== expected.kind || actual.unit !== expected.unit) throw invalid('User function argument type or unit does not match.', node.token);
            }
            currentFinal.clear();
            return fn.result ? { ...variableType(fn.variables.at(-1), new Map(), depth + 1), final: false } : type(3);
        }
        const args = node.args.map(arg => typeOf(arg, locals, depth + 1));
        const first = args[0] || type();
        const requireNumeric = (index, units = [0]) => {
            const arg = args[index];
            if (arg && (arg.kind > 1 || arg.array || !units.includes(arg.unit))) throw invalid(`Invalid numeric argument for ${node.name}.`, node.token);
        };
        const requireInteger = (index, allowFinal = false) => {
            requireNumeric(index);
            if (args[index] && (args[index].kind !== 0 || (!allowFinal && args[index].final))) throw invalid(`Argument requires a plain integer for ${node.name}.`, node.token);
        };
        if (['num_elements', 'array_equal', 'search', 'sort'].includes(node.name)) {
            if (!first.array || (node.name === 'array_equal' && !args[1]?.array)) throw invalid('Array argument required.', node.token);
            if (node.name === 'array_equal' && first.kind !== args[1].kind) throw invalid('Array element types must match.', node.token);
            if (node.name === 'search' && (!args[1] || args[1].array || args[1].kind !== first.kind || args[1].unit)) throw invalid('Search value must match the array element type.', node.token);
            if (node.name === 'sort') {
                if (node.args[0].kind !== 'variable' || lookup(node.args[0], locals).constant) throw invalid('Sorting requires a writable array.', node.token);
                requireNumeric(1);
                if (args[1] && args[1].kind !== 0) throw invalid('Sort direction must be an integer.', node.token);
            }
            return type(node.name === 'sort' ? 3 : 0);
        }
        if (node.name === 'by_marks') { requireInteger(0); return type(0, 0, true); }
        if (['sh_left', 'sh_right'].includes(node.name)) {
            requireInteger(0, true); requireInteger(1);
            return first;
        }
        if (node.name === 'message') { if (first.array || first.kind === 3) throw invalid('Message requires a scalar value.', node.token); return type(3); }
        if (['inc', 'dec'].includes(node.name)) {
            requireNumeric(0, [0, 1, 2, 3]);
            if (first.kind !== 0 || node.args[0]?.kind !== 'variable') throw invalid('Increment/decrement requires an integer variable.', node.token);
            return first;
        }
        if (['int', 'real_to_int', 'real', 'int_to_real', 'abs', 'ceil', 'floor', 'round'].includes(node.name)) {
            requireNumeric(0, [0, 1, 2, 3]);
            if (['ceil', 'floor', 'round', 'int', 'real_to_int'].includes(node.name) && first.kind !== 1) throw invalid('Function requires a real number.', node.token);
            if (['real', 'int_to_real'].includes(node.name) && first.kind !== 0) throw invalid('Function requires an integer number.', node.token);
            return type(['real', 'int_to_real'].includes(node.name) ? 1 : ['int', 'real_to_int'].includes(node.name) ? 0 : first.kind, first.unit, false, first.final);
        }
        if (['acos', 'asin', 'atan', 'cos', 'sin', 'tan', 'sqrt', 'exp', 'log', 'log2', 'log10', 'pow'].includes(node.name)) {
            requireNumeric(0, [0, 1, 2, 3]);
            if (first.kind !== 1) throw invalid('Function requires real arguments.', node.token);
            if (node.name === 'pow') { requireNumeric(1); if (args[1]?.kind !== 1) throw invalid('Power requires a real exponent.', node.token); }
            return first;
        }
        if (['min', 'max', 'random', 'in_range'].includes(node.name)) {
            for (let i = 0; i < args.length; i++) {
                requireNumeric(i, [first.unit]);
                if (args[i].kind !== first.kind) throw invalid('Function argument types must match.', node.token);
            }
            return node.name === 'in_range' ? type() : { ...first, final: args.some(arg => arg.final) };
        }
        if (node.name === 'wait') { requireNumeric(0, [0, 1]); return type(3); }
        if (node.name === 'play_note') {
            requireInteger(0); requireInteger(1); requireNumeric(2, [0, 1]); requireNumeric(3, [0, 1]); return type();
        }
        if (node.name.startsWith('change_') || ['fade_in', 'fade_out'].includes(node.name)) {
            if (!first.array) requireInteger(0);
            else if (first.kind !== 0) throw invalid('Note IDs require an integer array.', node.token);
            const units = /(?:attack|decay|release|_time|play_pos)$/.test(node.name) || node.name.startsWith('fade_') ? [0, 1]
                : /(?:_freq|cutoff)$/.test(node.name) ? [0, 2]
                    : ['change_vol', 'change_sustain', 'change_cutoff_sustain'].includes(node.name) ? [0, 3] : [0];
            requireNumeric(1, units);
            if (['change_note', 'change_velo', 'change_pan', 'change_reso', 'change_pitch_lfo_depth', 'change_cutoff_lfo_depth'].includes(node.name) || node.name.endsWith('_curve')) requireInteger(1, !['change_note', 'change_velo'].includes(node.name) && !node.name.endsWith('_curve'));
            if (['change_tune', 'fade_out'].includes(node.name)) requireNumeric(2); else requireInteger(2);
            return type(3);
        }
        for (let i = 0; i < args.length; i++) {
            if (i === 0 && first.array && first.kind === 0 && ['note_off', 'ignore_event', 'set_event_mark', 'delete_event_mark', 'set_event_par'].includes(node.name)) continue;
            requireInteger(i);
        }
        return type(['abort', 'exit', 'stop_wait', 'ignore_controller', 'ignore_event', 'note_off', 'set_event_mark', 'delete_event_mark', 'set_event_par'].includes(node.name) ? 3 : 0);
    }
    function reference(node, locals) {
        if (node.kind !== 'variable') throw invalid('A variable is required.', node.token);
        const variable = lookup(node, locals);
        if (variable.constant) throw invalid('A constant cannot be modified.', node.token);
        if (node.index) expression(node.index, locals); else emit('constant', numeric(0));
        emit('reference', variable.id, node.index ? 0 : variable.length);
        return variable;
    }
    function expression(node, locals) {
        typeOf(node, locals);
        if (node.kind === 'call') {
            const fn = ast.functions.get(node.name);
            for (let i = 0; i < fn.parameters.length; i++) {
                emit('constant', numeric(0));
                expression(node.args[i] || fn.parameters[i].value, node.args[i] ? locals : new Map());
            }
            calls.push([emit('call', 0, fn.firstLocal | (fn.parameters.length << 16), fn.localCount), node]);
            currentFinal.clear();
            if (!fn.result) emit('constant', numeric(0));
            return fn.result ? fn.variables.at(-1).type : 0;
        }
        if (node.kind === 'number' || node.kind === 'string') {
            const value = literal(node); emit('constant', constant(value)); return value.kind;
        }
        if (node.kind === 'unary') {
            if (node.op === '-' && node.value.kind === 'number') {
                const value = literal(node.value, true); emit('constant', constant(value)); return value.kind;
            }
            const type = expression(node.value, locals); emit('unary', ['-', '+', 'not', '.not.', '!'].indexOf(node.op)); return type;
        }
        if (node.kind === 'binary') {
            const left = expression(node.left, locals), right = expression(node.right, locals);
            emit('binary', BINARY.indexOf(node.op));
            return node.op === '&' ? 2 : left === 1 || right === 1 ? 1 : 0;
        }
        if (node.kind === 'variable') {
            if (CONSTANTS.has(node.name)) {
                const kind = /NI_MATH_(?:E|PI)$/.test(node.name) ? 1 : 0;
                emit('constant', constant({ number: CONSTANTS.get(node.name), kind, flags: 0, text: '' })); return kind;
            }
            const builtin = SFZ_SCRIPT_VARIABLES.indexOf(node.name);
            if (builtin >= 0) {
                if (node.index) expression(node.index, locals); else emit('constant', numeric(0));
                emit('builtinVariable', builtin, node.index ? 0 : node.name.startsWith('%') ? 1 : 0); return 0;
            }
            const variable = lookup(node, locals);
            if (node.index && !variable.array) throw invalid('Scalar variable cannot be indexed.', node.token);
            if (variable.array && !node.index) { emit('constant', numeric(0)); emit('reference', variable.id, variable.length); }
            else { if (node.index) expression(node.index, locals); else emit('constant', numeric(0)); emit('load', variable.id); }
            return variable.type;
        }
        const id = SFZ_SCRIPT_BUILTINS.indexOf(node.name);
        if (id < 0) throw invalid(`Unknown function ${node.name}.`, node.token);
        const [min, max] = SIGNATURES.get(node.name) || (node.name.startsWith('change_') ? [2, 2] : [1, 1]);
        if (node.args.length < min || node.args.length > max) throw invalid(`Invalid argument count for ${node.name}.`, node.token);
        if (node.name === 'message' && node.token.disabledMessage) { emit('constant', numeric(0)); return 0; }
        for (let i = 0; i < node.args.length; i++) {
            if ((node.name === 'inc' || node.name === 'dec') && i === 0) reference(node.args[i], locals);
            else expression(node.args[i], locals);
        }
        emit('builtin', id, node.args.length);
        if (['wait', 'fork', 'stop_wait'].includes(node.name)) currentFinal.clear();
        return ['real', 'int_to_real', 'acos', 'asin', 'atan', 'cos', 'sin', 'tan', 'sqrt', 'pow', 'exp', 'log', 'log2', 'log10'].includes(node.name) ? 1 : 0;
    }
    function initialize(node, variable, locals) {
        const values = Array.isArray(node.value) ? node.value : [node.value];
        if (values.length > variable.length) throw invalid('Too many array initializers.', node.token);
        for (let index = 0; index < variable.length; index++) {
            emit('constant', numeric(index));
            if (values[index]) {
                const actual = typeOf(values[index], locals), expected = variableType(variable, locals, 0);
                if (actual.array || actual.kind !== expected.kind || (variable.array && (actual.unit || actual.final))) throw invalid('Initializer type does not match the declared variable.', node.token);
                expression(values[index], locals);
            }
            else emit('constant', constant({ number: 0, kind: variable.type, flags: 0, text: '' }));
            emit('store', variable.id, variable.array ? 1 : 0);
        }
        if (!variable.array) currentFinal.set(variable.id, values[0] ? typeOf(values[0], locals).final : false);
    }
    function block(body, inherited = new Map()) {
        const locals = new Map(inherited);
        const declared = new Set(currentFunction && inherited === currentFunction.locals ? [...inherited.keys()].map(name => name.slice(1)) : []);
        for (const node of body) {
            if (node.kind === 'declare') {
                if (node.modifiers.includes('local')) {
                    if (declared.has(node.name.slice(1))) throw invalid('Repeated local variable in the same block.', node.token);
                    declared.add(node.name.slice(1));
                    const variable = node.variable || declare(node, 1); locals.set(node.name, variable); initialize(node, variable, locals);
                }
            } else if (node.kind === 'assign') {
                const variable = lookup(node.target, locals);
                typeOf(node.target, locals);
                if (variable.constant || (variable.array && !node.target.index)) throw invalid('Assignment target is not writable.', node.token);
                const actual = typeOf(node.value, locals), expected = variableType(variable, locals, 0);
                if (actual.array || actual.kind !== expected.kind || actual.unit !== expected.unit || (variable.array && actual.final)) throw invalid('Assignment type or unit does not match the variable.', node.token);
                if (node.target.index) expression(node.target.index, locals); else emit('constant', numeric(0));
                expression(node.value, locals); emit('store', variable.id, variable.array ? 1 : 0);
                if (!variable.array) currentFinal.set(variable.id, actual.final);
            } else if (node.kind === 'expression') {
                if (currentFunction && node.value.kind === 'builtin' && node.value.name === 'exit') {
                    if (node.value.args.length) throw invalid('Exit does not accept arguments.', node.token);
                    currentFunction.exits.push(emit('jump'));
                } else { expression(node.value, locals); emit('drop'); }
            }
            else if (node.kind === 'if') {
                const condition = typeOf(node.condition, locals);
                if (condition.array || condition.kind > 1) throw invalid('Condition requires a numeric scalar.', node.token);
                expression(node.condition, locals); const branch = emit('jumpFalse');
                currentFinal.clear(); block(node.yes, locals); const done = emit('jump');
                currentFinal.clear(); instructions[branch][1] = instructions.length; block(node.no, locals); instructions[done][1] = instructions.length;
                currentFinal.clear();
            } else if (node.kind === 'while') {
                const condition = typeOf(node.condition, locals);
                if (condition.array || condition.kind > 1) throw invalid('Condition requires a numeric scalar.', node.token);
                const start = instructions.length; expression(node.condition, locals); const done = emit('jumpFalse');
                currentFinal.clear(); block(node.body, locals); emit('jump', start); instructions[done][1] = instructions.length;
                currentFinal.clear();
            } else if (node.kind === 'synchronized') { emit('synchronized', 1); block(node.body, locals); emit('synchronized', 0); }
            else if (node.kind === 'select') {
                const selected = typeOf(node.value, locals);
                if (selected.kind !== 0 || selected.array || selected.unit) throw invalid('Select requires a unitless integer.', node.token);
                expression(node.value, locals);
                const ends = [];
                for (const item of node.cases) {
                    currentFinal.clear();
                    const low = staticNumber(item.low), high = staticNumber(item.high);
                    for (const bound of [item.low, item.high]) {
                        const value = typeOf(bound, locals);
                        if (value.kind !== 0 || value.array || value.unit) throw invalid('Case bounds require constant unitless integers.', node.token);
                    }
                    if (low > high) throw invalid('Case range is reversed.', node.token);
                    emit('duplicate'); expression(item.low, locals); expression(item.high, locals); emit('builtin', SFZ_SCRIPT_BUILTINS.indexOf('in_range'), 3);
                    const next = emit('jumpFalse'); emit('drop'); block(item.body, locals); ends.push(emit('jump')); instructions[next][1] = instructions.length;
                }
                emit('drop'); for (const end of ends) instructions[end][1] = instructions.length;
                currentFinal.clear();
            }
        }
    }
    entries[0] = 0;
    for (const declaration of initialization) initialize(declaration, globals.get(declaration.name), new Map());
    block(ast.callbacks.get('init') || []); emit('end');
    for (let i = 1; i < 6; i++) if (ast.callbacks.has(SFZ_SCRIPT_CALLBACKS[i])) {
        currentFinal.clear();
        entries[i] = instructions.length; block(ast.callbacks.get(SFZ_SCRIPT_CALLBACKS[i])); emit('end');
    }
    for (const [name, fn] of ast.functions) {
        currentFinal.clear();
        functionEntries.set(name, instructions.length);
        currentFunction = fn; fn.exits = [];
        for (let i = fn.parameters.length - 1; i >= 0; i--) emit('store', fn.variables[i].id);
        if (fn.result) initialize(fn.result, fn.variables.at(-1), fn.locals);
        block(fn.body, fn.locals);
        for (const exit of fn.exits) instructions[exit][1] = instructions.length;
        emit('ret', fn.result ? fn.variables.at(-1).id + 1 : 0);
        currentFunction = null;
    }
    for (const [index, node] of calls) {
        if (!functionEntries.has(node.name)) throw invalid(`Unknown user function ${node.name}.`, node.token);
        instructions[index][1] = functionEntries.get(node.name);
    }
    const bytes = new Uint8Array(64 + variables.length * 16 + constants.length * 144 + instructions.length * 16);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    const u32 = value => { view.setUint32(offset, value, true); offset += 4; };
    [0x31534b4e, SFZ_SCRIPT_PROGRAM_VERSION, instructions.length, constants.length, variables.length, 0, ...cells, ...entries, 0].forEach(u32);
    for (const variable of variables) [variable.scope, variable.type, variable.offset, variable.length].forEach(u32);
    for (const value of constants) {
        if (value.kind === 0) view.setBigInt64(offset, value.integer, true);
        else view.setFloat64(offset, value.number, true);
        offset += 8; u32(value.kind); u32(value.flags);
        bytes.set(encoder.encode(value.text), offset); offset += 128;
    }
    for (const instruction of instructions) instruction.forEach(u32);
    const requiredBuiltins = [...new Set(instructions.filter(instruction => instruction[0] === OP.builtin)
        .map(instruction => SFZ_SCRIPT_BUILTINS[instruction[1]]))];
    return { version: SFZ_SCRIPT_PROGRAM_VERSION, bytes, callbacks: entries, requiredBuiltins, diagnostics };
}
