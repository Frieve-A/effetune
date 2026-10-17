---
title: "Visualizer Guide - Music Visualizer with Spectrum, VU Meters & Album Art - EffeTune"
description: "Combine spectrum, spectrogram, oscilloscope, VU meter, album art, and track info displays into your own music visualizer, or start from built-in presets."
lang: en
---

# Visualizer

Visualizer turns EffeTune's processed audio into a customizable display. It can show a waveform, spectrum, scrolling spectrogram, stereo image, or note spectrogram alongside artwork, video, and track information. Changing the display does not change the sound.

## Open and display

On PC, select **Visualizer** beside **Effect Pipeline** and **Music Library**. On mobile, tap the **Visualizer** icon in the upper-right corner. In the desktop app, choose **View > Visualizer**. In the [browser extension](browser-extension.md), select **Visualizer** in the Pipeline Editor header. You can also set Visualizer as the startup view in **Settings > Config...**.

Choose a built-in preset to start. Presets are grouped by 16:9, 21:9, 4:3, 1:1, and 9:16 proportions. Selecting a preset replaces the current layout. Graphs display the audio signal just before it reaches the output, including all active effects.

Every proportion offers ten shared presets:
- **Mastering Console**: Overlaid left and right spectra, a spectrogram, a stereo display, a loudness meter, and segmented level meters on dark panels.
- **Spectral Studio**: A large high-resolution spectrogram paired with a vertical bar spectrum.
- **Harmony Lab**: A piano-roll view of detected notes with a chroma spiral showing pitch classes.
- **Phosphor Scope**: An oscilloscope and stereo display in the green glow of an analog CRT.
- **Hi-Fi Deck**: Segmented spectrum and level displays styled after a classic hi-fi fluorescent panel.
- **Vintage VU**: Left and right channels on backlit cream-faced VU meters in walnut bezels.
- **Now Playing**: Album art, track information, and spectrum bars over a blurred artwork background.
- **Neon Pulse**: A neon bar spectrum with a reflection and a bass-pulsing background.
- **Phase Galaxy**: The phase map rendered as a glowing, turning star.
- **Chroma Mandala**: The chroma spiral rendered as a kaleidoscope.

Seven additional presets appear in the proportions they suit best:
- **Fretboard** (21:9, 9:16): Detected notes on a guitar neck with a beat indicator; the 21:9 layout adds a piano-roll view above the neck.
- **Power Amp** (21:9, 16:9): Blue-lit VU meters on a black amplifier front panel.
- **Round Dials** (1:1, 9:16): Round VU meters in brass rims.
- **Beat Stage** (16:9, 9:16): Detected tempo inside a large bass-reactive beat circle with neon spectrum bars.
- **Lyric Stage** (16:9, 9:16): Synchronized lyrics over a bass-reactive artwork glow that fills the current line word by word (or a calm artwork screen when no lyrics are present).
- **Cinema Strip** (21:9): A full-width spectrogram, ten-second waveform, and scrolling lyrics line.
- **Meter Bridge** (21:9, 4:3): True Peak, VU, slow RMS, and loudness meters lined up above a level meter and waveform strip so you can compare how each meter responds to the same music.

Hover over or tap the display to reveal **⛶**. Select it to fill the app window while preserving the chosen proportions (edges may be cropped). Select **⛶** again, press **Esc**, or use mobile Back to return. In the desktop app, switching to Mini Player while Visualizer is open places the display above the playback controls.

In the desktop app with two or more displays, **View > Visualizer Clean Feed** shows Visualizer full screen on the selected display without a window frame or controls. The layout keeps its proportions, with black bars filling any remaining space. While Clean Feed is active, the in-app Visualizer preview renders at the feed's resolution so both match. Clean Feed hides automatically while another app is active (unless **Show While Inactive** is enabled in the same menu), while the main window overlaps that display, or during a Double Blind Test. To stop it, select **Off**, or click the feed and press **Esc**. With a single display, this menu item is unavailable.

## Edit a layout

Select **Edit** to customize the layout. Changes appear immediately and are restored the next time you open EffeTune. Editing alone does not overwrite a saved preset; use **Save** in the preset dialog when you want to keep a named copy.

In Edit mode, the left pane holds overall scene settings, the item list, and **Quality**. The canvas is in the center, and the selected item's controls are on the right. Adjust numeric settings with the slider or enter a value directly.

Zoom in for precise placement using **−** and **+** in the canvas toolbar, or **Ctrl+scroll** (**Cmd+scroll** on Mac) centered on the pointer (10–400%). **Fit** centers the entire frame. Pan with the mouse wheel or trackpad (hold **Shift** for horizontal scroll), or drag with the middle mouse button or **Space+left-drag**. With the canvas focused, **+** and **−** zoom around the center and **0** fits the frame. Panning and zooming do not add **Undo** steps.

Moving or resizing an item beyond the frame crops it at the edge in both Edit and normal view, while keeping its selection handles accessible in the editing area. For example, place a **Shape** partly outside the frame to create a panel flush with the display edge.

- Choose display proportions, background color, or a background image (large images are resized automatically). **Theme colors** lets you customize the graph base, soft graph fill, fine and major grid lines, graph labels, axis titles, and meter ticks for the layout without changing the trace palette. Untouched colors use the default dark theme regardless of EffeTune's UI theme. Click **Use default colors** to reset.
- **Graph scale** (×0.50 to ×3.00, default ×1.00): Graphs scale proportionally from small windows up to 4K. **Graph scale** enlarges or shrinks lines, ticks, peak marks, and graph labels across the layout, while Title, Album, Artist, and Text keep their own font sizes.
- Add an **Oscilloscope**, **Spectrum**, **Spectrogram**, **Stereo**, **Level Meter**, **Analog Meter**, **Notes**, **Guitar**, **Chroma Spiral**, **Phase Map**, or **Rhythm Analyzer** graph, or add **Lyrics**, **Artwork**, **Video**, **Title**, **Album**, **Artist**, **Text**, or **Shape**. Drag an item to move it and drag its handles to resize (**Shift** preserves aspect ratio, **Ctrl**/**Cmd** resizes from center). Use **Snap to grid** for alignment, or hold **Alt** while dragging to bypass snapping. **Move up**, **Move down**, **Bring to front**, and **Send to back** control layering (items lower in the list appear in front). Press **Ctrl+D** (**Cmd+D** on Mac) or **Alt-drag** to duplicate selected items.
- **Shift+click** items on the canvas or list (or **Ctrl/Cmd+click** in the list) to select multiple items, or drag a selection box on empty canvas (**Shift+drag** adds to selection). Where items overlap, **Ctrl+click** (**Cmd+click** on Mac) cycles through items behind the pointer. **Ctrl+A** (**Cmd+A**) selects all; **Esc** clears the selection. Moving, deleting, duplicating, cutting, copying, and pasting apply to all selected items. When all selected items are the same type, edits in the right pane apply to all of them, along with edge and center alignment buttons.
- **Undo** and **Redo** (**Ctrl+Z** / **Ctrl+Y**; **Cmd** on Mac) step through layout edits, preset loads, and link imports during the current session. **Cut items**, **Copy items**, and **Paste items** (**Ctrl+X**, **Ctrl+C**, **Ctrl+V**) move items through the clipboard, and **Paste items** also imports a Visualizer share link on the clipboard. Press **Delete** to remove selected items. Right-click (or long-press) the canvas for quick access to these commands.
- Each graph defaults to output channels 1–2. Selecting a single channel displays it across the graph (or as a single bar/meter in Level Meter and Analog Meter). Either axis can be flipped.
- **Color mode**: **Solid** uses a single color picker. **Gradient** provides editable color stops and 24 presets (select a preset and click **Apply**). **Reverse gradient** flips the stop order. **Hue** cycles colors over time and **Scroll** moves the gradient, with adjustable **Speed** and **Reverse color motion**.

For **Title**, **Album**, and **Artist**, set font, size, horizontal/vertical alignment, letter spacing, case, **Bold**, **Italic**, **Outline**, and **Shadow** independently. **Artwork** and **Video** support **Rounded corners**.

Add **Text** for a static label or room name (up to 4096 characters, multiline supported) using the same typography, outline, and shadow controls as Title.

Add **Lyrics** to display synchronized or plain lyrics for the built-in player's current track (including in Clean Feed). Lyrics load from embedded tags or a matching `.lrc` file in the same folder (for CUE sheets, `Artist - Title.lrc` or `Title.lrc` takes priority over album-level timed lyrics). For music opened or dropped directly in the browser, select or drop the `.lrc` file together with the music; streams have no lyrics. Outside **Edit**, click or tap a timed lyric line to seek to that line.
- Choose **List** or **Single line** (with optional **Show next line**). List view supports **Scroll (vertical)**, **Step (vertical)**, **Scroll (horizontal)**, and **Step (horizontal)** with adjustable **Step transition time** (0–2 s, default 0.18 s) and **Current line position** (0–100%, default 50%). **Word highlight** progressively fills the current line when word timings exist, and **Offset** (−10 to +10 s) fine-tunes sync; positive values show lyrics later. Lyrics without timing always appear as a list that scrolls with track progress, without highlighting.
- **Line spacing** (50–300%, default 100%) adjusts line gaps. **Fade-in time** (0–10 s, default 1 s) and **Fade-out time** (0–10 s, default 3 s) fade the Lyrics item at the start and end of each track; set either to 0 to turn that fade off.

Add **Video** to display the video stream of a file playing in the built-in player (MP4, M4V, MOV, MKV, WebM, 3GP supported by the browser/OS). **Fit** chooses **Fit inside** (default), **Fill and crop**, or **Stretch**. **Show artwork when there is no video** (on by default) falls back to album art for audio-only tracks. Tracks played from a CUE sheet show no video.

Add **Shape** (**Rectangle**, **Ellipse**, **Triangle**, or horizontal **Line**) to create panels, frames, or dividers with adjustable **Fill opacity**, **Border color**, **Border width**, **Border opacity**, and **Corner radius**. Give an **Ellipse** equal width and height for a circle, set **Fill opacity** to 0% for a frame, or set **Border width** to 0 to remove the border.

## Tune and read the graphs

**Spectrum** shows level by frequency with falling peak marks. **Orientation** switches between **Horizontal** (default) and **Vertical**. **Display** selects **Line** or **Bar**. In **Bar**, **Bands** (8–128, default 48) sets the number of bars, **dB per Segment** (0.5–12 dB, default 1 dB, or 0 for **Continuous**) sets the size of each block (smaller values give finer steps), and **Quantize** (on by default) rounds the bars and peaks to whole blocks without changing the measured levels. **Points** sets the analysis size: more points separate nearby frequencies but respond more slowly. **Frequency Scale** selects **Log (HQ)** (default), **Log**, or **Linear**, **Max Frequency** sets the upper limit (1–40 kHz, default 40 kHz), **Smoothing** blends up to 1 octave for a calmer curve (default 0), and **DB Range** sets the quietest level shown (default −96 dB; more negative values reveal quieter content). **Keyboard** adds a piano reference, and **Keyboard Length** sets the key length (default 100% is half a real piano key; 200% matches a real piano). **Keyboard**, **Axes and grid**, and **Axis labels and numbers** start off.

**Spectrogram** scrolls frequency vertically over time, using the same **Points** (default 4096), **Frequency Scale** (default **Log (HQ)**), **DB Range**, **Max Frequency**, **Keyboard**, and axis controls as Spectrum.

**Stereo** shows the stereo image as dots on a diamond (sound shared by both channels spreads vertically, left/right differences horizontally) with a peak outline. **Peak**, **Correlation**, and **Balance** (all on by default) show or hide the peak outline, the correlation bar (+1 when the channels match, −1 when they are opposite in polarity), and the balance bar (which side is louder, in dB). **Window** (10–1000 ms, default 100 ms) sets how much recent audio is shown: shorter windows follow transients, longer ones look steadier.

**Level Meter** displays channel levels (default −96 to 0 dB, **DB Range** −144 to −48 dB) in horizontal or vertical orientation, with continuous or segmented bars (**dB per Segment**), peak hold markers, and a 5-second **OVERLOAD** warning. **Axes and grid**, **Axis labels and numbers**, and **Level values** (held peak readings, or current levels while **Peak** is off) toggle the scale and numeric readouts; all three start off, and **OVERLOAD** is always shown. Supports **Solid**, **Gradient**, and **Heatmap** colors.

**Oscilloscope** plots waveform amplitude over **Display Time** (1–10000 ms, default 10 ms). Short intervals draw a line trace; long intervals draw a min/max envelope band. **Trigger Mode** selects **Auto** (default; keeps updating without a trigger), **Normal** (holds the last trace until the signal crosses **Trigger Level** in the **Trigger Edge** direction), or **Off** (continuous scrolling waveform; trigger settings are ignored). **Trigger Level** (−1 to 1, default 0), **Trigger Edge** (**Rising** (default) / **Falling**), and **Holdoff** (0.1–10 ms, default 0.1 ms; longer values reduce rapid retriggers) set the capture point. **Display Level** (−96 to 0 dB, default 0 dB) makes quieter waveforms larger at lower values, and **Vertical Offset** (−1 to 1, default 0) moves the waveform up with positive values.

**Notes** displays detected pitches over a 1–10 s **Time Span** in **Horizontal** or **Vertical** layout, with **Pitch Resolution** (**1/12 Octave** or **High**), **Volume** (on by default; shows each note's relative volume as bar thickness), **Lowest Note** / **Highest Note**, and optional **Keyboard** and axes.

**Guitar** maps detected pitches onto a fretboard. Choose a preset guitar, bass, or ukulele **Tuning** or enter custom **Open Strings** (up to 10 strings), and set **Lowest Fret**, **Highest Fret**, and **Capo**. **Positions** selects **All Positions** (every matching fret), **One Shape** (one playable position per note, on separate strings with a small stretch near the previous hand position), or **One Shape + Alternatives** (the other positions shown faintly). **Note Labels** selects **None**, **Note Names (♯)**, **Note Names (♭)**, or **Intervals** from **Root**; **Root** follows the lowest detected note with **Auto (Lowest Note)**, and choosing a fixed note enables the **Scale Guide** overlay. **Threshold** (10–90%, default 50%) sets how strong a note must be to appear; raise it if stray notes flicker. **Size by Volume** draws louder notes larger (the quietest at one third size). Also adjust **Fall Time** (0–2 s), **Layout** (horizontal tab or vertical chord chart), **Fretless** (continuous pitch placement for bends, vibrato, and slides), **Realistic Fret Spacing**, **Fretboard Fill**, **Fret Markers**, **Fret Numbers**, **String Names**, and **Flip horizontally**.

**Chroma Spiral** arranges detected pitches around an octave spiral in **Dots** or **Fill** mode, with **Lowest Octave**, **Highest Octave**, **Frequency Tilt**, **Level Range**, and **Display Floor**.

**Phase Map** plots frequency components vertically against left/right **Phase** (0° center, ±180° edges) or **Balance** on the **X Axis**, matching the Phase Select EQ view; brighter, larger dots are stronger. **DB Range** (−96 to −24 dB, default −72 dB) sets the range shown below the strongest component (more negative values reveal quieter content), **Reference Floor** (−120 to −24 dB, default −40 dB) sets the lowest reference level, so dots shrink and fade when even the strongest component is quieter than this, and longer **Persistence** (0.1–2.0 s, default 0.5 s) leaves a fuller trail. Axes start off.

**Analog Meter** provides classic needle meters in **VU** (default), **PPM**, **RMS**, **Sample Peak**, **True Peak**, **Loudness**, or **Custom** mode using the same ballistic and scale controls as the [Analog Meter](plugins/analyzer.md#analog-meter) effect; only the controls that apply to the selected mode appear. **Custom** adds **Detector**, **Needle Response**, **Overshoot**, and **Dial** to choose the measurement, needle speed, needle bounce, and scale; controls that do not apply to the chosen detector or dial stay in place but are disabled. In **Loudness**, a program meter showing Momentary, Short-term, Integrated, LRA, and maximum True Peak comes before the channel meters; Integrated, LRA, and maximum True Peak restart when you close or hide Visualizer, or change the channel, **Mode**, or **Needle**. In addition to measurement settings, appearance controls let you design flat amplifier meters or round vintage dials:
- **Dial geometry**: **Dial curvature** (0% straight to 100% circular), **Dial sweep** (30°–160°, default 100°), and **Pivot below dial** (0–100%).
- **Needle appearance**: **Hidden needle base** (0–90%), **Needle length** (50–120%, default 102%), **Needle width** (0.5–8), **Needle tip** (**Line**, **Tapered**, or **Arrow** with **Arrow tip aspect ratio** 0.25–4.00), and **Pivot hub size** (0–20).
- **Dial labels**: **Secondary % scale** and **Reading unit** in VU modes (100% = 0 VU at the selected **Reference**; 50% ≈ −6 VU, because the percentage is a voltage ratio), plus toggles for **Numeric reading**, **Channel heading**, **Mode heading**, **− / + marks**, **Positive value signs**, and **Red zone**.
- **Meter face**: **Window shape** (**Rectangle**, **Ellipse**, **Circle**), **Face color**, **Face opacity**, **Face border color**, **Face border width**, and **Vignette** (0–100%).

**Rhythm Analyzer** displays tempo, beat-by-beat hit timing, and band micro-timing using the same analysis as the [Rhythm Analyzer](plugins/analyzer.md#rhythm-analyzer) effect; **Metronome Click** is not available here. **Min BPM** (40–192, default 40) and **Max BPM** (50–240, default 240) set the tempo search range, and changing either restarts the analysis. **Span (beats)** (4, 6, 8, 12, or 16; default 8) sets how many beats each row of **Timing lanes** and **Echo rows** covers. The **Tempogram**, **Timing lanes**, **Echo rows**, and **Beat lens** toggles show or hide each panel (**Timing lanes** and **Beat lens** are on by default); a tall item stacks the panels, and a wide item places **Beat lens** beside **Timing lanes**. In addition, Visualizer provides a central **Beat** flash circle and **BPM** text overlay that work even with all four graph panels turned off. BPM and the beat lens show the confirmed analysis about 1–2 seconds behind the sound, and the BPM text uses the same text settings as Title.
- **Beat circle**: Adjust **Circle size** (10–100%, default 90%), **Border width** (0–20, default 2; 0 hides the border), **Fill opacity** (default 30%), **Border opacity** (default 100%), **Use palette colors** (or custom **Fill color** / **Border color**), **Fit BPM inside circle** (shrinks centered BPM text to fit inside the circle), **Beat hold time** (0–1000 ms, default 0 ms; how long the full flash stays before fading), and **Beat decay time** (10–2000 ms, default 90 ms).

For Spectrum, Spectrogram, and Stereo, **Input gain** (−24 to +24 dB) scales only the graph display without affecting audio playback. Spectrum, Level Meter, and Chroma Spiral provide **Fall Time** (0–5 s per 20 dB), and Spectrum, Level Meter, and Stereo provide **Peak**, **Peak Hold** (0–10 s), and **Peak Fall Time** (0.1–10 s per 20 dB; 1–10 s for Stereo).

Under **Color mode**, Spectrum and Chroma Spiral also support fixed **Note Colors** and **Heatmap**; Spectrogram, Level Meter, and Phase Map support **Heatmap**; Notes and Guitar support **Note Colors**; all other items with color settings offer only **Solid** and **Gradient**. Under **Gradient**, Spectrum, Spectrogram, Notes, Guitar, Chroma Spiral, and Phase Map offer **Gradient direction** (**Frequency**, **Intensity** (colors from weaker to stronger signals), or **Radial**); other items offer **Linear** and **Radial**. **Gradient angle (°)** (−180° to +180°, default 0°) rotates any non-radial gradient clockwise for positive values. With **Frequency**, Notes, Guitar, and Chroma Spiral also offer **Full range** or **One octave** color mapping.

## Add motion and effects

Attach visual effects to any item or the background and reorder them to shape the look:
- **Opacity**, **Glow**, **Outline**, **Blur**, **Trail**, **Scale Pulse**, **Symmetry**, **Shake**, **Particles**, **Ken Burns** (for artwork/video/background images), **Flash** (background), and **Backplate** (a customizable plate behind the item with **Fill color**, **Fill opacity**, **Border color**, **Border width**, **Corner radius**, and **Margin**).
- **Edge Fade**: Softens the edges of an item to transparency in **Rectangle** (**Top**, **Bottom**, **Left**, **Right** fade widths, 0–100%) or **Circle** (**Fade width**, 0–100%) shape (defaults: 10% top and bottom, 0% left and right, 20% for Circle), always applied last; it also hides anything outside the item area.
- **Transform**: Scales (**Horizontal scale** / **Vertical scale**, 0–300%, default 100% = unchanged), skews (**Horizontal skew (°)** / **Vertical skew (°)**, −60° to +60°), rotates (**Rotation angle (°)**, −180° to +180°; positive turns clockwise), and shifts (**Horizontal offset** / **Vertical offset**, −100% to +100%; positive moves right or down) an item or the background around its center. Skew, rotation, and offsets start at 0.
- **Trail Feedback**: Resizes (**Zoom**, −2% to +2%, default +2%; positive expands), rotates (**Rotation angle (°)**, −3° to +3°, default 1.15°; positive turns clockwise), and drifts (**Horizontal flow** / **Vertical flow**, −1% to +1%, default 0%; positive moves right or down) repeated trail echoes.

Effects can run steadily or respond to **Time**, overall **Level**, or **Bass**. **Amount** (0–1) sets the effect strength: for **Opacity** it is the item's visibility (1 is fully visible); for **Transform** 0 leaves the item unchanged and 1 applies the settings fully; for **Trail Feedback** 0 stops the resizing, rotation, and drift and leaves only a short trail. **Depth** sets how far **Time**, **Level**, or **Bass** moves the effect away from **Amount**, and **Speed** sets how fast a **Time**-driven change cycles. If animation slows down, lower **Quality** or use **Auto**.

## Presets, sharing, backup, and audio sync

Use the preset dialog to save, reload, rename, or delete named layouts; built-in presets stay available. **Settings > Backup / Restore** backs up saved Visualizer presets and their background images, but not the current working layout.

Select **Share** in the toolbar to copy a link to the current layout (background images are not included in links; use **Backup / Restore** for images). In the desktop app or browser extension, copy a share link and select **Import Link** or press **Ctrl+V** (**⌘V** on Mac) in Visualizer. An imported layout replaces the current one without asking; to go back, open **Edit** and select **Undo**.

In **Settings > Config...**, enable **Sync Visuals to Audio** to align the display with speaker output; audio may be delayed to keep them in sync. If graphs do not move, ensure **Use WebAssembly audio processing** is enabled in **Audio Configuration** and that audio is playing through EffeTune.

[Display Troubleshooting](faq.md#26-display-troubleshooting)

[← Back to README](../README.md)
