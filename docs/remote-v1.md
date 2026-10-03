# remote-v1: LAN control API

The desktop app can run a small WebSocket API so another device on the same network can drive
its effect pipeline. The audio stays on the computer; the client only edits the pipeline, the
presets and the IR library. The API speaks EffeTune's own pipeline format and knows nothing
about any particular client. The app also serves a browser client on the same port, so a phone
or another computer needs nothing installed.

It is off by default. The only credential is a random token in the pairing link, and traffic is
plain http/ws, so use it only on a network you trust.

## Enabling

Open **Settings > Remote Control...**. The window has an on/off switch; while it is on it
shows a QR code and the pairing link as text. The switch and the token are saved in
`config.json` in the user-data folder, so the server comes back after a restart. **New token**
replaces the token; clients that are connected are closed with 4401 and must pair again.
Turning the switch off closes all clients (1001) and releases the port.

In the main window, the Effect Pipeline header has a Remote Control icon (broadcast symbol,
tooltip "Remote Control", Electron app only). It is dimmed while the server is off, drawn in the
accent color while it listens, and shows a small badge with the number of connected devices.
Clicking it opens the same Remote Control window.

The port is **47300 unless it is busy**. When another process (for example a previous instance
that is still shutting down) holds it, the app retries the same port 4 times, 750 ms apart, then
moves up to the next free port (47301 ... 47309). The pairing link and QR code always carry the
port that was actually bound, and the Remote Control window shows it (with a note such as
"47300 was busy"). If every port from 47300 to 47309 is taken, the window
reports the error.

Overrides, mainly for tests:

```
set EFFETUNE_REMOTE=1                 (or pass --remote)   start the server regardless of the switch
set EFFETUNE_REMOTE_TOKEN=<token>     use this token instead of the saved one
set EFFETUNE_REMOTE_PORT=<port>       first port to try instead of 47300 (fallback: <port>+1 ... <port>+9)
npm start
```

## Pairing

One link and one QR code serve every client. It is the http URL of the web client the app
hosts:

```
http://<LAN IPv4>:<port>/?t=<token>
```

A browser opens it as is. A native client that speaks WebSocket takes the same link and derives the connection URL from it: same host and port, scheme `ws`, same
`t` (see Connection). The Remote Control window does not ask which kind of client will connect.
**Copy link** puts this link on the system clipboard.

The address is the computer's private IPv4 address (192.168.x, 10.x, 172.16-31.x). Virtual
adapters (VirtualBox, Hyper-V, VMware, WSL, Docker, Tailscale's 100.64/10, VPNs) are left out
where they can be recognised by name or MAC prefix. If several addresses remain, the window
offers a choice between them.

## Connection

- `ws://<host>:<port>/?t=<token>`
- A missing or wrong token: the socket is closed with code **4401**.
- At most 16 authenticated clients; extra ones are closed with **1013**.
- Frames are JSON text, at most 4 MB.
- Requests that arrive while the window is still starting (or reloading) are held for up to
  20 s, then answered with `renderer-unavailable`.

## Pipeline format

Items use the "short" serialization, the same one used by `?p=` share links and undo history
(`getSerializablePluginStateShort` in `js/utils/serialization-utils.js`):

```json
[{"nm":"Volume","en":true,"vl":-3},
 {"nm":"5Band PEQ","en":true,"f0":100,"ch":"L","ib":1,"ob":2}]
```

`nm` is the effect's display name, and the other keys are the parameter keys from each
effect's `params.json`. IR Reverb refers to its impulse response by library id: `"ir":"<24 hex>"`.

## Requests (client → app)

Any request may carry `"seq": <integer>`. When it does, the app answers with
`{"op":"ack","seq":n,"ok":true}` or `{"op":"ack","seq":n,"ok":false,"error":"..."}`. For
requests that also return data, the ack comes first and the data message carries the same
`seq` (except `getIR`, see below).

| Request | Effect |
|---|---|
| `{"op":"hello","v":1,"app":"MyRemote","version":"1.0","build":"12"}` | Replies with `state`, which also carries `"features":["origin","savePreset","irSync","sync1"]`, `"appName"` and `"effects"`. Any other `v` is rejected. `app`, `version` and `build` are optional strings naming the client; they are shown in the Remote Control window (control characters removed, cut to 48 characters). Other extra fields are ignored. |
| `{"op":"get"}` | Replies with `state`. |
| `{"op":"chain","pipeline":[...]}` | Replaces the whole pipeline (at most 256 items). If any `nm` is unknown, the request fails and nothing changes. Master bypass keeps its state. |
| `{"op":"params","index":i,"params":{...}}` | Applies the keys to stage `i` (0-based) of the current pipeline. Keys that are not given stay as they are. |
| `{"op":"bypass","on":true}` | Sets master bypass. |
| `{"op":"listPresets"}` | Replies `{"op":"presets","names":[...]}`: the presets whose effects all exist in this build. |
| `{"op":"getPreset","name":"..."}` | Replies `{"op":"preset","name":"...","pipeline":[...]}` in the short format. |
| `{"op":"savePreset","name":"...","pipeline":[...]}` | Saves the pipeline as a preset under `name`, overwriting one with the same name. Same file and format as the preset dialog's Save. Fails if any `nm` is unknown or the name is empty. The live pipeline does not change. |
| `{"op":"listIRs"}` | Replies `{"op":"irs","items":[{"id","name","bytes","ext","channels","sampleRate","frames"}]}`. |
| `{"op":"getIR","id":"..."}` | Sends the IR file (see IR transfer). Unknown id: `ok:false`. |
| `{"op":"putIR", ...}` | Uploads an IR file into the library (see IR transfer). |

## Pushes (app → client)

```json
{"op":"state","rev":12,"app":"2.12.0","masterBypass":false,"pipeline":[...],"origin":"local"}
```

Sent in reply to `hello` and `get`, and pushed to every authenticated client whenever the
pipeline changes for any reason, at most 10 times per second. `rev` goes up only when the
content changes.

`origin` says where the change came from:

- `"local"`: made on the computer (the app's UI, undo, loading a preset there, ...).
- `"remote"`: caused by a client's `chain`, `params` or `bypass`. The copy sent to the client
  that issued the command also carries that command's `"seq"`; the other clients get no `seq`
  and should treat the change like an external one.

Changes that arrive within 300 ms after a command finished are counted as that command's.
When one push covers changes of several origins, it is `"local"` if any of them was local,
and it carries no `seq` if they came from different clients. A client can therefore follow
the computer by applying every push that does not carry one of its own `seq` values.

A client that cannot keep up with the pushes (its socket buffer is full) skips some and receives
one coalesced `state` once it has drained. That state keeps the same rule: when everything it
covers was that client's own commands it is `"remote"` with the `seq` of the latest of them, and
otherwise it carries no `seq`.

Replies to `hello` and `get` carry the request's `seq` and `"origin":"remote"`. They are
snapshots, not echoes of an edit: always apply them. A command that leaves the pipeline as it
was produces no push, so do not wait for one to confirm a command; the ack does that.

Since the `sync1` extension every `state` also carries `epoch`, `ids`, `slot` and `host` (see
Sync extension). Clients that do not know them ignore them.

The reply to `hello` also carries `"appName"` (`"EffeTune"`) next to `"app"`, which is the
version string. They are for display. Clients decide what they can do from `features`, never
from `app` or the version.

It also carries `"effects"`, the sorted names (`nm`) of every effect this app can load. A client
compares `effects` with its own effect set before sending a chain: an effect that is not listed
makes `chain` fail as a whole (`unknown effect`), so the client should leave such stages out and
say so.

## IR transfer

IRs are identified the same way as in the app's IR library (`js/ir-library/ir-library-id.js`):
the first 24 hex characters of the SHA-256 of the file's bytes. Files are sent as they are
(WAV, FLAC, AIFF, ...), base64 encoded, in chunks of at most 512 KiB of raw data. Files may
be up to 64 MiB and up to 16 channels.

Download:

```
→ {"op":"getIR","id":"6fc4…","seq":7}
← {"op":"irChunk","id":"6fc4…","name":"Hall.wav","ext":"wav","index":0,"total":3,"bytes":1234567,"data":"<base64>","seq":7}
← ... index 1, 2 ...
← {"op":"ack","seq":7,"ok":true}
```

All chunks come before the ack.

Upload: send the chunks in order on one connection, starting at `index` 0:

```
→ {"op":"putIR","id":"6fc4…","name":"Hall.wav","ext":"wav","index":0,"total":3,"bytes":1234567,"data":"<base64>","seq":8}
← {"op":"ack","seq":8,"ok":true}
→ ... index 1, 2 ...
```

Every chunk that carries `seq` is acked. After the last chunk the app checks that the bytes
hash to `id` and imports the file through the same call as the library's Import button, so the
id and name are registered as usual; the last ack says whether that worked (`id mismatch`,
`unsupported file type`, `import failed`, ...). A chunk out of order, or a size that does not
add up, cancels the upload. At most two uploads can be in progress per connection. `name` is
the file name; `ext` is added when `name` does not already end with it. Uploading a file that
is already in the library succeeds and changes nothing.

Only single-file IRs are listed and transferred. A true-stereo pair (two stereo files named
L/R) has a combined id and is left out.

## Browser clients

The desktop app also serves the EffeTune web client on the remote port, over plain http:

```
http://<LAN IPv4>:<port>/?t=<token>
```

The Remote Control window shows this link and its QR code (the same ones apps use). The page is `remote.html`: the real effect list and pipeline editor
of EffeTune, without the player, library, audio settings or measurement tools. It keeps the token
in `localStorage`, removes `t` from the address bar and opens `ws://<same host:port>/?t=<token>`.
The hosted web version (https) cannot do this: a browser refuses `ws://` to a LAN address from an
https page, which is why the desktop app serves the page itself. The desktop app can also join
another one: **Join another EffeTune** in the same window opens a client window for a pasted link.

- Static files: `GET` and `HEAD` only. Only the files the web version precaches
  (`sw-precache.js`, without `effetune.html`, `sw.js`, `sw-precache.js` and `manifest.json`) are
  served; everything else, including `config.json` and the app's own `electron/` code, is 404.
  They are public application code, so they need no token; the WebSocket still does, unchanged.
- `Host` header (static files, and WebSocket upgrades that carry an `Origin`): an IPv4 literal,
  `localhost`, `[ipv6]` or `*.local`, optionally with a port. Anything else gets 403 (DNS-rebinding
  defence). A WebSocket upgrade without `Origin` is not a browser request, so its `Host` is not
  checked: native clients and scripts may connect through any host name (NetBIOS, MagicDNS).
- `Origin` header (WebSocket upgrade only): an `http:`/`https:` origin must be exactly
  `http://<Host>`. A missing `Origin` (native clients, scripts) is accepted; `Origin: null` and other
  schemes get 403.
- `remote.html` is sent with `Content-Security-Policy: connect-src 'self' ws://<Host>`.
- The page is served from one origin per port. If the port falls back (47300 busy, 47301 used),
  the origin changes and the QR code must be scanned again.

## Sync extension (sync1)

Advertised as `"sync1"` in `features`. It lets every participant (the app itself, browser clients,
native clients) edit the same pipeline and see each other's edits live. Everything is additive: a client
that ignores it keeps working with `chain`, `params` and `bypass` exactly as before.

### State fields

Every `state` message (replies and pushes) also carries:

| Field | Meaning |
|---|---|
| `epoch` | 8 hex characters, new whenever the app's window is (re)loaded. Ids and `rev` are comparable only within one epoch. |
| `ids` | `string[]`, parallel to `pipeline`: the stage id of every item. It is not inside the items, because clients echo items back unchanged. |
| `slot` | `"A"` or `"B"`: the active pipeline. |
| `host` | the computer's host name, for display. |

`hello` may carry `"sync":1` (and `"build":"browser"` or `"desktop-client"` for the web client). It
only makes the connection receive `presetsChanged` and `irsChanged`.

### Stage ids

A stage id is an opaque string matching `^[A-Za-z0-9_.-]{1,40}$` that belongs to one plugin
*instance*. The app gives `h.<n>` to every stage it creates (adds, preset loads, undo, `chain`, A/B).
A client names the stages it creates `c<random>.<n>` and may propose the id in `ins`; ids starting
with `h.` cannot be proposed. A loaded preset, `chain` or undo replaces every id.

### Ops

`edit` carries a batch of ops that address stages by id:

```
{"t":"set",    "id", "p":{<shortKey>:value,...}, "d":["ib"|"ob"|"ch",...]}  // d: optional keys to unset
{"t":"ins",    "id", "after": id|null, "at": int, "item":{"nm":..., ...short state}}
{"t":"del",    "id"}
{"t":"mov",    "id", "after": id|null, "at": int}
{"t":"bypass", "on": bool}
```

Position rule, the same everywhere: `after:null` puts the stage at the head; otherwise, if the
`after` stage exists, right after it; otherwise at `min(at, length)`. `set`, `del` and `mov` on a
missing id are skipped, `ins` of an existing id is skipped, `set` is last-writer-wins per key in the
order the app receives them. A changed effect (`nm`) is a `del` plus an `ins`, never a `set`.

```
→ {"op":"edit","seq":5,"epoch":"9f3a01cc","base":41,"slot":"A","ops":[...]}
← {"op":"ack","seq":5,"ok":true,"rev":42,"skipped":[1]}
```

The whole batch is validated before anything is applied. Errors (`ok:false`): `stale-epoch`,
`slot-mismatch`, `invalid-op` (malformed op or id), `unknown-effect`, `too-long` (more than 512 ops
or a result over 256 stages). `base` (the client's confirmed `rev`) is informational and never makes
an edit fail.

`slot` is the pipeline (`"A"` or `"B"`) the client made the batch against, taken from the `state` it
had adopted. Stage ids belong to one pipeline: when `slot` differs from the host's active slot (the
A/B button was pressed in the meantime) the host answers `slot-mismatch` and applies nothing, so an
`ins` can never land in the other pipeline. The client then fetches the state (`get`) and shows the
active pipeline. A malformed `slot` is `invalid-op`; an `edit` without `slot` is applied to the
active pipeline as before (clients written before this field).

`rev` on acks: every ack of `edit`, `history`, `slot`, `copySlot`, `loadPreset` and also of the older
`chain`, `params` and `bypass` carries `rev`, the app's revision after the command took effect. A
`state` with `rev >= ack.rev` contains the command. `skipped` lists the indexes of ops that did not
apply.

### Other ops

| Op | Effect |
|---|---|
| `{"op":"history","dir":"undo"}` / `"redo"` | The app's own undo or redo. It is global: it reverts the last change by anyone. |
| `{"op":"slot","slot":"B"}` | Switches the active pipeline like the A/B button, including its short fade. No-op when already active. |
| `{"op":"copySlot","from":"A","to":"B"}` | Same as the copy A to B / B to A buttons. |
| `{"op":"presets"}` | Replies `{"op":"presets","presets":{name:preset,...}}` (loadable presets, stored format). |
| `{"op":"loadPreset","name":"..."}` | Loads a stored preset as if the user picked it on the computer (message, preset name, history). |
| `{"op":"deletePreset","name":"..."}` | Deletes a stored preset. |

`{"op":"presetsChanged"}` (no `seq`) is pushed to `sync` connections whenever the stored presets
change.

`{"op":"irsChanged"}` (no `seq`) is pushed to `sync` connections whenever the IR library gains or
loses an entry (an import in the app, an upload with `putIR`, a backup restore, a removal). It
carries no payload: the client calls `listIRs` and fetches what it is missing with `getIR`. The
host waits for a pause of 400 ms before sending (at most 3 s while imports keep coming), so a
folder import produces a few notices, not one per file. The notice also reaches the connection
whose `putIR` caused it; re-listing then finds nothing new. Connections without `"sync":1` never
receive it.
A removal also sends it, so a client that uploads its own IRs should only send what was added on
its side since its last listing: uploading everything the host lacks would undo the removal at once.

### Transport details

- A connection whose send buffer holds more than 1 MiB skips state pushes and gets the latest state
  once it drains (a full state replaces any earlier one).
- Pushes never carry a `seq`, except the copy for the client that issued the command, as before.

### Client algorithm

The app broadcasts full states; a client keeps `confirmed` (the last state it adopted) and a list of
`pending` batches it sent. What it shows is `apply(confirmed, pending)`.

1. On a state: if the epoch changed, drop `pending` and adopt it; if `rev` went backwards, ignore it;
   otherwise adopt it. Drop every pending batch whose ack `rev` is `<=` the adopted `rev`. Redraw
   from `apply(confirmed, pending)`.
2. On a local edit: diff the editor against `apply(confirmed, pending)` into ops, send them as one
   `edit` (at most every 33 ms) and add them to `pending`.
3. On an ack: remember its `rev`; a failed ack removes the batch and the editor snaps back.
4. After 10 s without an ack, drop the batch and send `get`.
5. On disconnect, drop `pending`; the state received after reconnecting is adopted as a whole. An
   edit whose ack was lost is never resent, because it could undo a newer change by someone else.

Conflicts:

| Case | Outcome |
|---|---|
| Same key edited at once | The app's arrival order wins; everyone adopts it. |
| Different keys of one stage | Both are kept. |
| `set`/`mov` on a deleted stage | Skipped. |
| `ins`/`mov` after a deleted stage | Placed at the clamped `at`. |
| Preset load, `chain` or undo racing an edit | New ids; later ops on old ids are skipped. |
| App restart or window reload | New epoch; `pending` is dropped and the state adopted. |

## Limitations

- Only the active pipeline (A or B) is exposed.
- `chain` goes through the preset loader: it adds an undo entry, shows the "preset loaded"
  message, and clears the current preset name. With master bypass on, the effects may be
  heard for a moment before bypass is restored.
- Effects whose filters are designed in the app (FIR EQ, group-delay EQ, Room EQ) take their
  parameters as given. IR Reverb finds its file by id, so upload the IR before sending a chain
  that uses it; an IR Reverb that is already showing "IR not found" does not pick up a later
  upload by itself.
- Analyzer readings, effect overlays and meters are not sent to clients.
- The IR library window does not refresh while it is open when an IR arrives.
- Browser clients do not show analyzers (they render idle), the IR picker, or MIDI and clipboard
  features. Undo and redo are global, not per client.
- A client whose plugin rewrites its own parameters without a user gesture is not allowed to send
  that change (the app's value is restored); only edits made within 2 s of a touch, key or pointer
  event are sent.
- No discovery (mDNS). Pair with the QR code or enter the address by hand.
