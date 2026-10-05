#!/usr/bin/env python3
"""Learn the Tonal Balance EQ target tables from the Free Music Archive (FMA).

Three subcommands, each resumable and deterministic:

  select     Filter fma_metadata/tracks.csv (licence, bitrate, genre) into a sorted
             track list with the licence of every track and counts per genre_top.
  analyse    Decode the selected MP3 clips straight from fma_large.zip and append one
             checkpoint row per track (band levels and presence read at the clip end).
  aggregate  Turn the checkpoint rows into target_tables.h and
             target_tables.provenance.json (per-style mean, spread and standard error).

Every input and output path comes from the command line.
"""
import os

# Single-threaded numerics keep memory small and the sums reproducible.
for _name in ("OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "OMP_NUM_THREADS"):
    os.environ.setdefault(_name, "1")

import argparse
import collections
import csv
import hashlib
import io
import json
import math
import re
import sys
import time
import zipfile
from pathlib import Path

import numpy as np

BAND_COUNT = 41
MIN_BITRATE = 256000
MIN_TRACKS_PER_STYLE = 144
MIN_PRESENCE_SUM = 2.0  # a band with less summed presence has no target (R 2.5)
# genre_top categories that do not name a production style (R 2.5).
EXCLUDED_GENRES = frozenset(
    ["Experimental", "Instrumental", "International", "Old-Time / Historic", "Spoken"]
)
ALIGN_TOLERANCE_DB = 1e-10
ALIGN_MAX_ITERATIONS = 100000
JND_DB = 0.5  # smoothing tolerance (S-35): the level difference limen of broadband noise
SMOOTH_BISECTIONS = 60
FMA_METADATA_LINK = "https://github.com/mdeff/fma"
SELECTION_FILE = "selected_tracks.tsv"
SUMMARY_FILE = "selection_summary.json"
STYLE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 /&+-]*$")

# CC BY of any version and country: "Attribution" or "Creative Commons Attribution",
# optionally followed by a version number and jurisdiction, never by NC, ND or SA terms.
CC_BY_PATTERN = re.compile(r"^(?:Creative Commons )?Attribution(?: [0-9]\.[0-9](?: .*)?)?\s*$")


def licence_class(licence):
    """Return the accepted licence class of an FMA licence string, or None."""
    if CC_BY_PATTERN.match(licence):
        return "CC BY"
    if licence.startswith("CC0"):
        return "CC0"
    if licence.startswith("Public Domain"):
        return "Public Domain"
    return None


def sha_of_file(path, algorithm):
    digest = hashlib.new(algorithm)
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


# --------------------------------------------------------------------------- select

def select_tracks(tracks_csv):
    """Return (rows, licence_class_counts); rows are (id, genre_top, licence) sorted by id."""
    csv.field_size_limit(1 << 30)
    rows = []
    with open(tracks_csv, newline="", encoding="utf-8") as handle:
        reader = csv.reader(handle)
        groups, names = next(reader), next(reader)
        next(reader)  # the "track_id" header row
        column = {pair: index for index, pair in enumerate(zip(groups, names))}
        bit_rate = column[("track", "bit_rate")]
        genre = column[("track", "genre_top")]
        licence = column[("track", "license")]
        for row in reader:
            if not row[genre] or not row[bit_rate].isdigit() or int(row[bit_rate]) < MIN_BITRATE:
                continue
            if licence_class(row[licence]) is not None:
                rows.append((int(row[0]), row[genre], row[licence]))
    rows.sort()
    return rows


def command_select(args):
    tracks_csv = Path(args.metadata) / "tracks.csv"
    rows = select_tracks(tracks_csv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / SELECTION_FILE, "w", encoding="utf-8", newline="\n") as handle:
        for track_id, genre, licence in rows:
            handle.write(f"{track_id}\t{genre}\t{licence}\n")
    summary = {
        "source": str(tracks_csv.name),
        "source_sha1": sha_of_file(tracks_csv, "sha1"),
        "filter": filter_description(),
        "track_count": len(rows),
        "per_genre_top": dict(sorted(collections.Counter(r[1] for r in rows).items())),
        "per_licence_class": dict(sorted(collections.Counter(licence_class(r[2]) for r in rows).items())),
        "per_licence": dict(sorted(collections.Counter(r[2] for r in rows).items())),
    }
    (out / SUMMARY_FILE).write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(f"{len(rows)} tracks selected")
    for name, count in summary["per_genre_top"].items():
        print(f"  {name}: {count}")


def filter_description():
    return {
        "licence": "CC BY (any version), CC0 or Public Domain; no NC, ND or SA variant",
        "minimum_bitrate": MIN_BITRATE,
        "genre_top": "set",
    }


def read_selection(selection_dir):
    """Return {id: (genre_top, licence)} in id order."""
    selection = {}
    with open(Path(selection_dir) / SELECTION_FILE, encoding="utf-8", newline="") as handle:
        for line in handle:
            track_id, genre, licence = line.rstrip("\n").split("\t")
            selection[int(track_id)] = (genre, licence)
    return selection


# -------------------------------------------------------------------------- analyse

AVERAGING_TIME_INFINITY = 100.0  # the top Averaging Time value is the "infinity" position (growing mean since reset)


def analyse_track(samples, sample_rate):
    """Return (level_db[41], presence[41]) for one decoded clip.

    Runs Tonal Balance EQ alone in a chain at Averaging Time infinity (all other parameters at
    their defaults) through the public Python wheel and reads telemetry frame 29 at the
    end of the clip. samples is float32 with shape (frames, channels).
    """
    import effetune  # imported late: only `analyse` needs the wheel

    frames = []
    chain = effetune.Chain([effetune.TonalBalanceEQ(averaging_time=AVERAGING_TIME_INFINITY)])
    chain.process(np.ascontiguousarray(samples.T), sample_rate=sample_rate, on_telemetry=frames.append)
    if not frames:
        raise ValueError("no telemetry frame")
    return frames[-1].level_db, frames[-1].presence


def skip_id3v2(data):
    """Return data without leading ID3v2 tags (10-byte header, syncsafe size, optional footer)
    and the zero padding that may follow them."""
    while data[:3] == b"ID3" and len(data) >= 10:
        size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]
        data = data[10 + size + (10 if data[5] & 0x10 else 0):].lstrip(b"\x00")
    return data


def decode_mp3(data):
    import soundfile  # imported late: only `analyse` needs it

    samples, sample_rate = soundfile.read(io.BytesIO(skip_id3v2(data)), dtype="float32", always_2d=True)
    return samples, sample_rate


def clip_path(track_id):
    name = f"{track_id:06d}"
    return f"fma_large/{name[:3]}/{name}.mp3"


def read_checkpoint(path):
    """Return the checkpoint rows in file order; a partial last line is repaired."""
    path = Path(path)
    if not path.exists():
        return []
    raw = path.read_bytes()
    if raw and not raw.endswith(b"\n"):
        raw = raw[: raw.rfind(b"\n") + 1]
        path.write_bytes(raw)
    return [json.loads(line) for line in raw.decode("utf-8").splitlines()]


def valid_analysis(level_db, presence):
    return (
        len(level_db) == BAND_COUNT
        and len(presence) == BAND_COUNT
        and all(math.isfinite(v) for v in level_db)
        and all(math.isfinite(v) and 0.0 <= v <= 1.0 for v in presence)
    )


def analyse_one(archive, track_id):
    """Return a checkpoint row for one track."""
    try:
        samples, sample_rate = decode_mp3(archive.read(clip_path(track_id)))
        if samples.shape[0] == 0:
            return {"id": track_id, "ok": False, "reason": "empty clip"}
    except Exception as error:  # a broken clip is data, not a crash
        return {"id": track_id, "ok": False, "reason": f"decode failed: {type(error).__name__}"}
    try:
        level_db, presence = analyse_track(samples, sample_rate)
    except ValueError as error:  # e.g. a clip too short for one analysis hop
        return {"id": track_id, "ok": False, "reason": f"analysis failed: {error}"}
    level_db, presence = [float(v) for v in level_db], [float(v) for v in presence]
    if not valid_analysis(level_db, presence):
        return {"id": track_id, "ok": False, "reason": "invalid analysis result"}
    return {"id": track_id, "ok": True, "level_db": level_db, "presence": presence}


def command_analyse(args):
    selection = read_selection(args.selection)
    done = {row["id"] for row in read_checkpoint(args.checkpoint)}
    todo = [track_id for track_id in selection if track_id not in done]
    if args.limit is not None:
        todo = todo[: args.limit]
    started = time.monotonic()
    written = 0
    with zipfile.ZipFile(args.archive) as archive, open(args.checkpoint, "a", encoding="utf-8", newline="\n") as out:
        for track_id in todo:
            if args.time_budget_s is not None and time.monotonic() - started >= args.time_budget_s:
                break
            out.write(json.dumps(analyse_one(archive, track_id)) + "\n")
            out.flush()
            written += 1
    print(f"{written} rows written in {time.monotonic() - started:.1f} s; {len(todo) - written} of the requested tracks left")


# ------------------------------------------------------------------------ aggregate

def style_table(level, weight):
    """Presence-weighted style statistics of one style.

    level, weight: (tracks, bands) arrays. Returns mu, sigma, se_mu, has_target (bands).
    Every track is aligned to the style mean by the presence-weighted least-squares offset
    over the bands that have a target, iterated to a fixed point; the offsets are centred
    so the style keeps the mean level of its tracks.
    """
    weight_sum = weight.sum(axis=0)
    has_target = weight_sum >= MIN_PRESENCE_SUM
    if not has_target.any():
        return np.zeros((4, BAND_COUNT))
    w, x = weight[:, has_target], level[:, has_target]
    track_weight = w.sum(axis=1)
    used = track_weight > 0
    offset = np.zeros(level.shape[0])
    for _ in range(ALIGN_MAX_ITERATIONS):
        mu = (w * (x - offset[:, None])).sum(axis=0) / w.sum(axis=0)
        new = np.zeros_like(offset)
        new[used] = (w[used] * (x[used] - mu)).sum(axis=1) / track_weight[used]
        new[used] -= new[used].mean()
        change = np.max(np.abs(new - offset))
        offset = new
        if change < ALIGN_TOLERANCE_DB:
            break
    else:
        raise RuntimeError("alignment did not reach a fixed point")
    aligned = x - offset[:, None]
    mu = (w * aligned).sum(axis=0) / w.sum(axis=0)
    total = w.sum(axis=0)
    n_eff = total * total / (w * w).sum(axis=0)
    variance = (w * (aligned - mu) ** 2).sum(axis=0) / (total * (1.0 - 1.0 / n_eff))
    sigma = np.sqrt(variance)
    if not (np.all(np.isfinite(mu)) and np.all(np.isfinite(sigma)) and np.all(sigma > 0.0)):
        raise RuntimeError("a band with a target has a non-finite mean or a non-positive spread")
    table = np.zeros((4, BAND_COUNT))
    table[0, has_target], table[1, has_target] = mu, sigma
    table[2, has_target] = sigma / np.sqrt(n_eff)
    table[3, has_target] = 1.0
    return table


def smooth_tables(tables):
    """S-35: smooth the style tables across frequency with one shared penalty.

    Whittaker smoother on the band-index (ERB-number) axis with a second-difference penalty;
    per style, weights 1/sigma^2 (mean 1) over the bands that have a target, 0 elsewhere. The
    shared penalty is the largest whose weighted RMS residual pooled over all styles stays
    within one JND (Reinsch's criterion), found by bisection on its logarithm. log sigma is
    smoothed by the same smoother and SE_mu is propagated through its hat matrix.
    Returns (tables, penalty, pooled residual dB, per-style residuals dB).
    """
    weights = []
    for table in tables:
        weight = np.zeros(BAND_COUNT)
        has_target = table[3] > 0
        weight[has_target] = 1.0 / table[1, has_target] ** 2
        weights.append(weight * (has_target.sum() / weight.sum()))
    second_difference = np.diff(np.eye(BAND_COUNT), n=2, axis=0)
    roughness = second_difference.T @ second_difference

    def fit(log_penalty):
        hats = [np.linalg.solve(np.diag(w) + math.exp(log_penalty) * roughness, np.diag(w)) for w in weights]
        squares = [(w * (h @ t[0] - t[0]) ** 2).sum() for w, h, t in zip(weights, hats, tables)]
        return hats, squares, math.sqrt(sum(squares) / sum(w.sum() for w in weights))

    low, high = math.log(1e-6), math.log(1e12)
    for _ in range(SMOOTH_BISECTIONS):
        middle = 0.5 * (low + high)
        low, high = (middle, high) if fit(middle)[2] <= JND_DB else (low, middle)
    hats, squares, pooled = fit(low)
    smoothed = []
    for hat, table in zip(hats, tables):
        has_target = table[3] > 0
        result = np.zeros_like(table)
        result[0, has_target] = (hat @ table[0])[has_target]
        result[1, has_target] = np.exp(hat @ np.log(np.where(has_target, table[1], 1.0)))[has_target]
        result[2, has_target] = np.sqrt((hat * hat) @ (table[2] * table[2]))[has_target]
        result[3] = table[3]
        smoothed.append(result)
    residuals = [math.sqrt(s / w.sum()) for s, w in zip(squares, weights)]
    return smoothed, math.exp(low), pooled, residuals


def mixture_table(tables):
    """All = equal-weight mixture of the styles that have a target in the band (R 2.5)."""
    stack = np.stack(tables)  # (styles, 4, bands)
    present = stack[:, 3, :] > 0
    count = present.sum(axis=0)
    result = np.zeros((4, BAND_COUNT))
    for b in np.flatnonzero(count):
        mu_s, sigma_s, se_s = stack[present[:, b], 0, b], stack[present[:, b], 1, b], stack[present[:, b], 2, b]
        mu = mu_s.mean()
        result[0, b] = mu
        result[1, b] = math.sqrt(np.mean(sigma_s**2 + (mu_s - mu) ** 2))
        result[2, b] = math.sqrt(np.sum(se_s**2)) / count[b]
        result[3, b] = 1.0
    return result


def aggregate_rows(rows, selection):
    """Return (style_names, tables, used_ids, smoothing) from checkpoint rows; All is first."""
    by_genre = collections.defaultdict(list)
    seen = set()
    for row in sorted(rows, key=lambda r: r["id"]):
        if row["id"] in seen:
            raise ValueError(f"duplicate checkpoint row for track {row['id']}")
        seen.add(row["id"])
        if row["id"] not in selection:
            raise ValueError(f"track {row['id']} is not in the selection")
        if row["ok"]:
            by_genre[selection[row["id"]][0]].append(row)
    missing = len(selection.keys() - seen)
    if missing:
        raise ValueError(f"{missing} selected tracks are missing from the checkpoint; run analyse to completion")
    styles = sorted(g for g, r in by_genre.items() if len(r) >= MIN_TRACKS_PER_STYLE and g not in EXCLUDED_GENRES)
    tables, used = [], []
    for genre in styles:
        if not STYLE_NAME_PATTERN.match(genre):
            raise ValueError(f"style name {genre!r} is not a plain identifier")
        level = np.array([r["level_db"] for r in by_genre[genre]])
        weight = np.array([r["presence"] for r in by_genre[genre]])
        tables.append(style_table(level, weight))
        used.extend(r["id"] for r in by_genre[genre])
    tables, penalty, pooled, residuals = smooth_tables(tables)
    smoothing = {
        "penalty": float(f"{penalty:.6g}"),
        "pooled_weighted_rms_residual_db": round(pooled, 6),
        "per_style_weighted_rms_residual_db": {g: round(r, 6) for g, r in zip(styles, residuals)},
    }
    return ["All"] + styles, [mixture_table(tables)] + tables, sorted(used), smoothing


def format_values(values, per_line=4):
    """Rows of `per_line` values, each followed by a comma, as in the placeholder header."""
    lines = []
    for start in range(0, len(values), per_line):
        lines.append("        " + " ".join(f"{v}," for v in values[start:start + per_line]))
    return "\n".join(lines)


def render_header(names, tables, track_count):
    def array(name, kind, row, convert):
        blocks = [f"    {{ // {n}\n{format_values([convert(v) for v in t[row]])}\n    }}," for n, t in zip(names, tables)]
        return f"inline constexpr std::array<std::array<{kind}, kTargetBandCount>, kTargetStyleCount> {name} = {{{{\n" + "\n".join(blocks) + "\n}};\n"

    styles = ", ".join(f'"{n}"' for n in names)
    return (
        f"// GENERATED by learn_targets.py aggregate from {track_count} FMA tracks; see\n"
        "// target_tables.provenance.json. Do not edit by hand.\n"
        '// Layout is the P3 contract: styles with n >= 144, "All" first then alphabetical;\n'
        "// mu = relative band level (dB), sigma = between-track spread (dB), se_mu = standard\n"
        "// error of mu (dB), has_target = 1 when the band has data; mu, sigma and se_mu are\n"
        "// the per-style curves smoothed across bands (S-35, see the provenance).\n"
        "#ifndef EFFETUNE_TONAL_BALANCE_EQ_TARGET_TABLES_H\n"
        "#define EFFETUNE_TONAL_BALANCE_EQ_TARGET_TABLES_H\n\n"
        "#include <array>\n#include <cstdint>\n\n"
        "namespace effetune::plugins::eq::tonal_balance {\n\n"
        "// clang-format off\n"
        f"inline constexpr std::uint32_t kTargetStyleCount = {len(names)}u;\n"
        f"inline constexpr std::uint32_t kTargetBandCount = {BAND_COUNT}u;\n\n"
        f"inline constexpr std::array<const char *, kTargetStyleCount> kTargetStyleNames = {{\n    {styles}}};\n\n"
        + array("kTargetMuDb", "double", 0, lambda v: repr(float(v))) + "\n"
        + array("kTargetSigmaDb", "double", 1, lambda v: repr(float(v))) + "\n"
        + array("kTargetSeMuDb", "double", 2, lambda v: repr(float(v))) + "\n"
        + array("kTargetHasTarget", "std::uint8_t", 3, lambda v: str(int(v))) + "\n"
        "// clang-format on\n"
        "} // namespace effetune::plugins::eq::tonal_balance\n\n"
        "#endif // EFFETUNE_TONAL_BALANCE_EQ_TARGET_TABLES_H\n"
    )


def render_provenance(names, used_ids, selection, checkpoint_rows, smoothing):
    per_licence = collections.Counter(selection[i][1] for i in used_ids)
    counts = collections.Counter(selection[i][0] for i in used_ids)
    provenance = {
        "status": "corpus-derived",
        "generator": "dsp/plugins/eq/tonal_balance_eq/learn_targets.py",
        "generator_sha256": sha_of_file(__file__, "sha256"),
        "corpus": {
            "name": "Free Music Archive (FMA) fma_large, 30 s clips",
            "reference": "Defferrard et al., FMA: A Dataset for Music Analysis, ISMIR 2017",
            "metadata_link": FMA_METADATA_LINK,
        },
        "filter": filter_description(),
        "minimum_tracks_per_style": MIN_TRACKS_PER_STYLE,
        "excluded_genres": sorted(EXCLUDED_GENRES),
        "styles": names,
        "tracks_per_style": {n: counts[n] for n in names[1:]},
        "smoothing": {
            "method": "Whittaker smoother, second-difference penalty on the band index, weights 1/sigma^2; "
            "one penalty for all styles, the largest with the pooled weighted RMS residual <= JND; "
            "log sigma smoothed alike; SE_mu via the hat matrix",
            "jnd_db": JND_DB,
            **smoothing,
        },
        "analysed_rows": len(checkpoint_rows),
        "failed_rows": sum(1 for r in checkpoint_rows if not r["ok"]),
        "tracks_per_licence": dict(sorted(per_licence.items())),
    }
    return json.dumps(provenance, indent=2) + "\n"


def command_aggregate(args):
    selection = read_selection(args.selection)
    rows = read_checkpoint(args.checkpoint)
    names, tables, used_ids, smoothing = aggregate_rows(rows, selection)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "target_tables.h").write_text(render_header(names, tables, len(used_ids)), encoding="utf-8", newline="\n")
    (out / "target_tables.provenance.json").write_text(
        render_provenance(names, used_ids, selection, rows, smoothing), encoding="utf-8", newline="\n")
    print(f"{len(names) - 1} styles ({', '.join(names[1:])}); {len(used_ids)} tracks")


# ---------------------------------------------------------------------------- main

def build_parser():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)

    select = commands.add_parser("select", help="filter tracks.csv into the selection folder")
    select.add_argument("--metadata", required=True, help="unpacked fma_metadata folder")
    select.add_argument("--out", required=True, help="output folder for the selection")
    select.set_defaults(run=command_select)

    analyse = commands.add_parser("analyse", help="decode and analyse the selected clips (resumable)")
    analyse.add_argument("--selection", required=True, help="folder written by `select`")
    analyse.add_argument("--archive", required=True, help="fma_large.zip")
    analyse.add_argument("--checkpoint", required=True, help="checkpoint file (JSON lines, appended)")
    analyse.add_argument("--limit", type=int, help="analyse at most this many further tracks")
    analyse.add_argument("--time-budget-s", type=float, help="stop cleanly after this many seconds")
    analyse.set_defaults(run=command_analyse)

    aggregate = commands.add_parser("aggregate", help="checkpoint rows -> target tables and provenance")
    aggregate.add_argument("--selection", required=True, help="folder written by `select`")
    aggregate.add_argument("--checkpoint", required=True, help="checkpoint file written by `analyse`")
    aggregate.add_argument("--out", required=True, help="folder receiving target_tables.h and the provenance JSON")
    aggregate.set_defaults(run=command_aggregate)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    args.run(args)


if __name__ == "__main__":
    sys.exit(main())
