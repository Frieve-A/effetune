---
title: "Mobile/PWA Power-Saving Verification"
description: "Repeatable device, browser, and power-measurement record for EffeTune's Web/PWA power policy."
lang: en
---

# Mobile/PWA Power-Saving Verification

Use one copy of this record per OS/browser build. Node and Chromium CI tests establish software invariants; this record covers behavior and energy use that require a physical device.

## Environment

| Field | Value |
| --- | --- |
| Date and tester | |
| Device and SoC | |
| Battery health/range | |
| OS and build | |
| Browser/PWA version | |
| Install mode (tab/Home Screen/PWA) | |
| EffeTune commit | |
| Sample rate/channels/latency | |
| Input/output device | |
| Pipeline preset | |
| Screen brightness/network/thermal state | |
| Measurement tool and sampling interval | |

Keep the device, browser build, brightness, network, battery range, thermal state, pipeline, and audio routing unchanged within a comparison. Cool the device before every run. Run each baseline and candidate for at least 15 minutes, preferably 30 minutes, at least three times in alternating order. Compare medians normalized by elapsed time; do not select only the best run.

## Scenario matrix

Record audible continuity, permission prompts, state/directive, retained input state, and normalized CPU/energy for each row.

| Scenario | Policy/visibility | Expected invariant | Result/evidence |
| --- | --- | --- | --- |
| Active external signal | all/visible | Active, full processing, no new dropouts | |
| Active external silence | continuous/visible+hidden | No EffeTune automatic deep suspend | |
| Routed Monitoring | balanced/maximum | detector increases; full JS/WASM, telemetry, Analyzer RAF, and visual RAF deltas are zero | |
| Suspended | balanced/maximum | AudioContext suspended; Worklet render delta is zero | |
| File playing while hidden | all/hidden | browser-dependent continuation is recorded without claiming a guarantee | |
| Player paused/stopped with retained live mic | continuous/balanced/maximum | route signal is not-routed/silent; policy-specific no-route suspend; track stop delta zero before input deadline | |
| Maximum input-only release | maximum/60, 300, 900, never | context and input deadlines stay independent; one logical release and at most one physical track stop | |
| Proven global-zero transport | all | eligible chain skips DSP; must-process chain stays full-process and degraded | |
| Master bypass transport | all | dry route remains audible; eligible chain skips DSP | |
| Resume after manual input release | maximum/visible gesture | no automatic permission loop; explicit **Resume audio processing** reacquires as required | |

For every counter window, capture snapshots A and B only when `counterEpoch` and `workletGraphGeneration` match. Record `effectiveCommitSequence` and all mandatory counters. A Monitoring window passes only when detector blocks increase while full JS/WASM blocks, telemetry reads/posts, Analyzer RAF, and aggregate visual RAF do not. Any `monitoringRuntimeFailures` increment is a release blocker.

## iOS vertical spike

Record a timestamped sequence for Safari and the Home Screen Web App:

1. The original user gesture and the synchronous order in which AudioContext resume, output-bridge play, and getUserMedia are started.
2. Permission acceptance and rejection.
3. Background, screen-off, foreground, page freeze, and page restoration observations.
4. A programmatic-resume rejection followed by the visible resume CTA.
5. Whether playback position, selected input, manual-resume latch, and effect parameters remain correct.

Do not infer success from a timer firing while hidden. Use observed resource states after foregrounding.

## Rollback and release gates

The pull-request workflow publishes the `power-browser` check, but repository rules do
not become stricter merely because the workflow exists. Before release, a repository
administrator must add the exact `power-browser` context to the required status checks
and confirm the saved rule through the GitHub settings or API. Until that read-back is
recorded, mark the gate below as pending (or as an external blocker when administrator
access is unavailable).

| Gate | Pass/evidence |
| --- | --- |
| No audio drop, permission loop, resume loop, or broken route in the matrix | |
| Active CPU time and p95 processing time regress no more than 5% versus feature-off baseline | |
| Monitoring/Suspended resource counters match the invariants above | |
| Platform rollback/kill-switch rehearsal completed without automatically reacquiring a stopped input | |
| Repository administrator added `power-browser` to the ruleset's required status checks and confirmed it by API/settings read-back | |
| Android Chrome tab/PWA runs completed | |
| iOS Safari/Home Screen runs completed | |

If device access or repository-administration permission is unavailable, mark the corresponding row as an external release blocker rather than passing it by assumption.
