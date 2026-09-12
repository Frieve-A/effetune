---
title: "Browser Extension Privacy Policy - EffeTune"
description: "How the EffeTune browser extension handles tab audio, settings, presets, measurements, and impulse responses."
lang: en
---

# EffeTune Browser Extension Privacy Policy

**Effective date:** September 12, 2026

**Operator:** Frieve

**Privacy inquiries:** Contact Frieve through the contact form at [https://www.frieve.com/about](https://www.frieve.com/about) (email address required).

This policy applies to the EffeTune browser extension for Google Chrome and Microsoft Edge. It explains what the extension handles, why it handles it, where it is stored, and how you can delete it.

## Summary

- EffeTune processes audio from a tab only after you choose **Start processing**.
- Captured tab audio is processed on your device in real time. EffeTune does not record it, store it, or send it to the EffeTune operator.
- Your effect settings, presets, imported measurements, and impulse responses are stored in the extension's local browser storage. They are not automatically synchronized with the EffeTune web app, desktop app, or another device.
- EffeTune does not include operator-run advertising or analytics and does not sell your data.
- The optional **Ask ChatGPT** and **Ask Perplexity** actions send the question you enter and the name of the selected effect to the service you choose. Nothing is sent to those services unless you choose one of those actions.

## Information the extension handles

### Selected tab audio

When you choose **Start processing**, EffeTune captures the audio stream of the selected tab and applies your effect pipeline on your device. The audio is used only while the processing session is active. It is not recorded or saved by the extension and is not sent to the EffeTune operator or to another service.

The audio in a tab can contain personal or sensitive material. Start processing only on a tab whose audio you intend to process, and choose **Stop processing** when you are finished.

### Selected tab information

To start and display the session, the extension temporarily accesses the selected tab's browser identifier, title, and URL. The URL is checked only to confirm that the selected tab is a regular `http` or `https` website. The title is shown in the extension so you can identify the tab being processed.

EffeTune does not create a browsing-history record. This tab information is not added to your saved presets or settings and is discarded when the processing session ends.

### Settings, presets, measurements, and impulse responses

The extension stores the following information locally in the browser profile:

- effect-pipeline settings, effect parameters, interface preferences, and the master bypass setting;
- complete pipeline presets and effect presets that you save or import;
- measurement files that you choose to import, including any measurement names, response data, and included impulse-response data; and
- impulse-response files that you choose to import, including the file information and audio data needed by compatible effects.

This information is used only to provide the settings, preset, Room EQ, Crosstalk Cancellation, and impulse-response features you request. The extension does not automatically send it to the EffeTune operator or synchronize it with another EffeTune installation.

## Optional third-party services

Each effect's help dialog can offer **Ask ChatGPT** and **Ask Perplexity**. If you choose one of these actions, EffeTune opens the selected provider's website with the question you entered and the name of the effect in the page URL. Your browser and the selected provider will receive that information, and the provider's own terms and privacy policy will apply.

The extension does not include captured audio, tab information, presets, measurements, or impulse responses in that request. Do not enter private or sensitive information in an AI question.

Opening documentation, support, or other external links also takes you to the destination website, whose privacy policy applies to that visit.

## Browser permissions

EffeTune requests only these extension permissions:

- **tabCapture** — captures audio from the tab where you explicitly start processing.
- **activeTab** — identifies the tab from which you invoked EffeTune. It does not grant permanent access to every website.
- **offscreen** — keeps the local Web Audio processing session running while the popup or editor is closed.
- **storage** — saves your settings and presets in the extension's local browser storage.

The extension does not request host permissions for all websites and does not install a content script in webpages. It does not require microphone access for tab-audio processing.

## Sharing, sale, advertising, and analytics

EffeTune does not sell the information described in this policy. It does not use it for advertising, credit decisions, or profiling, and it does not provide operator-run analytics or telemetry.

Except for information you intentionally send through an optional third-party action described above, the extension does not transmit captured tab audio, selected tab information, settings, presets, measurements, or impulse responses to the EffeTune operator or third parties.

Google, Microsoft, the browser you use, and the browser store may separately process installation, update, crash, security, or store-interaction information under their own terms and privacy policies. That processing is controlled by those providers, not by EffeTune.

EffeTune's use of information received through Chrome APIs follows the Chrome Web Store User Data Policy, including its Limited Use requirements. Information received through browser APIs is used only to provide the tab-audio processing and related extension features described here.

## Retention and deletion

- Captured tab audio is not retained. Processing ends when you choose **Stop processing**, close the captured tab, end the capture session, or close the browser.
- The selected tab information used for the active session is not retained after that session ends.
- Settings and presets remain in the extension's local browser storage until you replace or delete them, clear the extension's storage, or remove the extension.
- To delete a saved preset, open **Pipeline Presets**, select it, and choose **Delete Selected**.
- To delete an imported measurement, select it in Room EQ's **Measurement** list and choose **Delete** beside the list. EffeTune clears assignments that use that measurement before deleting it.
- To delete an imported impulse response, open **Impulse Response Library** and choose **Delete** or **Delete selected**. An impulse response that is currently assigned to an effect must be removed from that effect before it can be deleted.
- To remove all locally stored EffeTune extension data, remove the extension or clear its stored data from the browser's extension settings.

Information intentionally sent to ChatGPT or Perplexity is retained and deleted according to the selected provider's policy and your settings with that provider.

## Children

The EffeTune browser extension is not directed to children and does not provide accounts, advertising, or social features. It does not send extension data to the EffeTune operator. If a child uses the extension, the selected tab audio and locally saved information are handled in the same way described in this policy.

## Security

Stored settings and imported files remain within storage managed by your browser profile. Protect access to your browser profile and device. No storage or transmission method can be guaranteed to be completely secure.

## Changes to this policy

This policy may be updated when the extension's features or data handling change. The effective date at the top of the page will be updated when a revised policy is published. If a change materially affects how the extension handles information, the relevant store listing and disclosures will also be updated before the changed behavior is released.

## Contact and support

For general help or bug reports, use [EffeTune GitHub Issues](https://github.com/Frieve-A/effetune/issues). GitHub Issues are public. Do not post captured audio, tab titles or URLs, presets, measurement files, impulse responses, account identifiers, or other personal or confidential information there.

Privacy inquiries: Contact Frieve through the contact form at [https://www.frieve.com/about](https://www.frieve.com/about) (email address required). When you use the form, only the information you enter in it is sent for your inquiry. The contact form is separate from the extension's local audio processing and storage; the extension does not automatically attach or send captured audio, tab information, settings, presets, measurements, or impulse responses with an inquiry.
