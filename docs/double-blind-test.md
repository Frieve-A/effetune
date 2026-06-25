---
title: "Double Blind Test Guide - EffeTune"
description: "Run ABX and A/B preference blind listening tests between two effect pipelines in EffeTune and check the results with statistical significance."
lang: en
---

# How to Use the Double Blind Test

The Double Blind Test lets you compare **Pipeline A** and **Pipeline B** by ear without knowing which one you are listening to. It is a controlled way to find out whether a difference you *think* you hear is actually distinguishable, and whether you actually prefer one pipeline over the other.

Two test types are available:

- **ABX Test** – Check whether you can reliably tell the two pipelines apart.
- **A/B Preference Test** – Choose which pipeline you prefer, without knowing which is which.

In both cases EffeTune records your answers and reports a p-value, so you can see whether the result is statistically significant.

## Preparing the Two Pipelines

The test compares the two pipelines described in [Using AB Pipeline Features](../README.md#using-ab-pipeline-features):

- **Pipeline A** and **Pipeline B** must each contain at least one effect.
- Put one of the settings you want to compare in Pipeline A and the other in Pipeline B. Keep everything else identical except the one thing you want to test (for example, *With EQ* vs. *Without EQ*) so that only that difference is under test.
- For an **A/B Preference Test**, it does not matter which of the two settings you put in Pipeline A and which in Pipeline B. During the test the A and B samples are reshuffled on every trial, so neither position has any advantage. If you swap the settings, the reported winning pipeline label will swap too, but the statistical interpretation is unchanged. What matters is that you remember which setting you placed in which pipeline: the result reports whether Pipeline A or Pipeline B was significantly preferred, so you read it against your own setup to know which one you favored. Clear results usually mean one setting had a real preference for you; if they sound the same or your choices vary, the test will usually report no significant preference.
- You can open the test panel at any time, but the start buttons stay disabled until both pipelines are present. If Pipeline B is missing, a notice is shown instead.

## Opening the Test

- **Web app:** Click the **▼** button just to the right of the A/B toggle button (the button showing "A" or "B" for the current pipeline) in the Effect Pipeline header, then choose **Double Blind Test** from the menu that appears.
- **Desktop app:** The same **▼** menu is available, and you can also open the test from the **File** menu.

While the test is open, the effect pipeline display is hidden so you cannot see which effects are active and stay blind. Close the test at any time with the **×** button to return to the normal view.

## Configuring the Test

The configuration screen offers the following items:

- **Test name** – Describes the difference you are testing (for example, *With EQ vs. Without EQ*). The combobox works like Effect Presets: you can **save**, **recall**, and **delete** named tests. A saved test stores both pipelines and the number of tests, so you can reload the same comparison later. A test name is required before you can share a test.
- **Your name** – Optional. Shown in the result; left blank it becomes *Anonymous*.
- **Number of tests** – How many trials to run (set with the box or the slider). More trials give a more reliable result but take longer. The default is 20.

Press **Start ABX Test** or **Start A/B Preference Test** to begin.

> **Note:** The **A** and **B** in the test are a separate thing from Effect Pipeline A and Pipeline B. On every trial, which pipeline's sound is assigned to A and which to B is decided again at random, and that mapping is never shown — so you cannot know which real pipeline you are currently hearing as A. The test's "A" is not necessarily Pipeline A, so do not assume it is; this is what keeps the test blind.

## Playing the Audio

The test only switches pipelines; you supply the music as usual:

- Drag & drop a music file (or open one from the File menu), or
- Feed audio into EffeTune from a physical source.

The audio device sample rate is shown on the test screen for reference.

## Running an ABX Test

1. Use the **Switch to A**, **Switch to B**, and **Switch to X** buttons to switch the live audio between samples. **X** is the same as either A or B, chosen randomly for each trial.
2. Switch back and forth as many times as you like until you can tell which sample **X** matches.
3. Click **X matches A** or **X matches B** to record your answer, and the next trial begins.

You can also switch with the keyboard: press the **A**, **B**, or **X** key — or the **1**, **2**, or **3** key (top row or numpad) — to switch the active sample, just like clicking the matching switch button. To vote, press **Q** for **X matches A** or **W** for **X matches B**.

## Running an A/B Preference Test

1. Use the **Switch to A** and **Switch to B** buttons to compare the two samples (there is no X in this mode).
2. When you have decided which one you prefer, click **Prefer A** or **Prefer B**.

You can also switch with the keyboard: press the **A** or **B** key — or the **1** or **2** key (top row or numpad) — to switch the active sample. To vote, press **Q** for **Prefer A** or **W** for **Prefer B**.

## Reading the Result

When all trials are done, EffeTune shows the result:

- **ABX Test** – Your score (percentage and correct / total) and a one-sided binomial p-value. If **p < 0.05**, the result is statistically significant, so your answers are unlikely to be explained by chance alone and you were able to tell the pipelines apart. Otherwise, we cannot say that you were able to tell them apart.
- **A/B Preference Test** – The pipeline chosen more often (shown as Pipeline A if tied) and how often it was chosen (count / total), together with a two-sided binomial p-value. The percentage shown is always 50% or more, because it reports the winning side — so a high percentage by itself does not mean a real preference. What matters is the p-value: if **p < 0.05**, your preference is significant; otherwise, we cannot say that you had a significant preference (a result near 50% is just chance).

The total time you spent is shown as well.

## Sharing a Test

Click **Share this test** to copy a URL to your clipboard. The URL reproduces **both effect pipelines and opens the blind test**, so whoever opens it can run the same pipeline comparison. You can share at any time — from the configuration screen before you start, or after you finish. If you share before starting, the important thing being shared is the two-pipeline comparison; confirm the number of trials before beginning. If you share after completing the test, your result is included as well, and the recipient sees it before taking the test themselves.

Sharing requires both pipelines and a test name, so the shared comparison is meaningful and can be reproduced on the other end.

To use a shared test URL:

- **Web app:** Open the shared URL in a browser. EffeTune restores both pipelines and opens the Double Blind Test automatically.
- **Desktop app:** Copy the shared URL, switch to EffeTune, then paste it with **Edit > Paste**, **Ctrl+V** (or **Command+V** on macOS), or the toolbar **Paste effects** button. EffeTune reads the URL from the clipboard, restores both pipelines, and opens the Double Blind Test. Paste the URL while the Double Blind Test panel is not already open.

[← Back to README](../README.md)
