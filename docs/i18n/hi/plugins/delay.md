---
title: "डिले प्लगइन - EffeTune"
description: "मानक Delay और सटीक ऑडियो timing के लिए Time Alignment सहित delay effect प्लगइन।"
lang: hi
---

# डिले प्लगइन

audio signals की timing समायोजित करने या साफ repetitions जोड़ने वाले tools का संग्रह। ये plugins temporal alignment fine-tune करने, rhythmic echoes बनाने, या listening experience में space और depth जोड़ने में मदद करते हैं।

## प्लगइन सूची

- [Delay](#delay) - timing, tone और stereo spread पर control के साथ echoes बनाता है।
- [Time Alignment](#time-alignment) - speaker और listening-position alignment के लिए playback timing fine-tune करता है

## Delay

यह effect आपके audio में साफ echoes जोड़ता है। आप control कर सकते हैं कि echoes कितनी जल्दी repeat हों, कैसे fade हों, और speakers के बीच कैसे फैलें, ताकि music playback में subtle depth, rhythmic interest या creative spatial effects जोड़े जा सकें।

### सुनने के अनुभव की गाइड

- **सूक्ष्म गहराई और स्थान:**
  - sound को धुंधला किए बिना हल्का space जोड़ता है।
  - vocals या lead instruments को थोड़ा बड़ा या अधिक present महसूस करा सकता है।
  - short delay times और low feedback/mix इस्तेमाल करें।
- **लयात्मक संवर्धन:**
  - music tempo के साथ feel होने वाले echoes बनाता है (manual tuning से)।
  - electronic music, drums या guitars में groove और energy जोड़ता है।
  - अलग delay times आज़माएं (जैसे eighth या quarter notes को कान से मिलाना)।
- **स्लैपबैक इको:**
  - बहुत छोटा, single echo, जो rock और country में vocals या guitars पर अक्सर सुना जाता है।
  - percussive, doubling effect जोड़ता है।
  - बहुत short delay times (30-120ms), zero feedback और moderate mix इस्तेमाल करें।
- **रचनात्मक stereo फैलाव:**
  - Ping-Pong control से echoes left और right speakers के बीच bounce कर सकते हैं।
  - wider, अधिक engaging stereo image बनाता है।
  - sound को अधिक dynamic और रोचक महसूस करा सकता है।

### पैरामीटर

- **Pre-Delay (ms)** - echo delay में signal जाने से पहले extra time जोड़ता है (0 से 100 ms)। पहला echo Pre-Delay + Delay Size के बाद सुनाई देता है।
  - कम values (0-20ms): Echo pattern लगभग तुरंत शुरू होता है।
  - अधिक values (20-100ms): echo pattern से पहले noticeable gap जोड़ता है, जिससे वह original sound से अलग होता है।
- **Delay Size (ms)** - हर echo के बीच का time (1 से 5000 ms)।
  - Short (1-100ms): thickening या 'slapback' effects बनाता है।
  - Medium (100-600ms): standard echo effects, rhythmic enhancement के लिए अच्छा।
  - Long (600ms+): दूर-दूर रखे, साफ echoes।
  - *Tip:* music के साथ tap करके ऐसा delay time खोजें जो rhythmic लगे।
- **Damping (%)** - हर echo के साथ high और low frequencies कितनी fade होंगी, यह control करता है (0 से 100%)।
  - 0%: echoes अपना original tone रखते हैं (brighter)।
  - 50%: balanced, natural fade।
  - 100%: echoes जल्दी काफी darker और thinner हो जाते हैं (more muffled)।
  - High/Low Damp के साथ इस्तेमाल करें।
- **High Damp (Hz)** - वह frequency set करता है जिसके ऊपर echoes brightness खोने लगते हैं (20 से 20000 Hz)।
  - कम values (जैसे 2000Hz): echoes जल्दी dark हो जाते हैं।
  - अधिक values (जैसे 10000Hz): echoes लंबे समय तक brighter रहते हैं।
  - echoes के tonal control के लिए Damping के साथ adjust करें।
- **Low Damp (Hz)** - वह frequency set करता है जिसके नीचे echoes fullness खोने लगते हैं (20 से 20000 Hz)।
  - कम values (जैसे 50Hz): echoes ज्यादा bass रखते हैं।
  - अधिक values (जैसे 500Hz): echoes जल्दी thinner हो जाते हैं।
  - echoes के tonal control के लिए Damping के साथ adjust करें।
  - predictable tone shaping के लिए Low Damp को High Damp से नीचे रखें। values cross होने पर processor उन्हें internally order करता है।
- **Feedback (%)** - आप कितने echoes सुनते हैं, या वे कितनी देर टिकते हैं (0 से 99%)।
  - 0%: केवल एक echo सुनाई देता है।
  - 10-40%: कुछ स्पष्ट repeats।
  - 40-70%: longer, fading trails of echoes।
  - 70-99%: बहुत long trails, self-oscillation के करीब (सावधानी से इस्तेमाल करें!)।
- **Ping-Pong (%)** - echoes stereo channels के बीच कैसे bounce करते हैं, यह control करता है (0 से 100%)। (केवल stereo playback को प्रभावित करता है)।
  - 0%: standard delay - left input का echo left पर, right का right पर।
  - 50%: mono feedback - echoes speakers के बीच center होते हैं।
  - 100%: full Ping-Pong - echoes left और right speakers के बीच alternate होते हैं।
  - बीच की values stereo spread की अलग-अलग मात्रा देती हैं।
- **Mix (%)** - echoes की volume को original sound के साथ balance करता है (0 से 100%)।
  - 0%: कोई effect नहीं।
  - 5-15%: subtle depth या rhythm।
  - 15-30%: साफ audible echoes (अच्छा starting point)।
  - 30%+: stronger, अधिक pronounced effect। Default 16% है।

### श्रवण संवर्धन के लिए अनुशंसित सेटिंग्स

1. **वोकल/वाद्य में सूक्ष्म गहराई:**
   - Delay Size: 80-150ms
   - Feedback: 0-15%
   - Mix: 8-16%
   - Ping-Pong: 0% (या हल्की width के लिए 20-40% आज़माएं)
   - Damping: 40-60%
2. **लयात्मक संवर्धन (Electronic/Pop):**
   - Delay Size: tempo को कान से मिलाकर देखें (जैसे 120-500ms)
   - Feedback: 20-40%
   - Mix: 15-25%
   - Ping-Pong: 0% या 100%
   - Damping: स्वाद के अनुसार adjust करें (brighter repeats के लिए कम)
3. **क्लासिक रॉक स्लैपबैक (Guitars/Vocals):**
   - Delay Size: 50-120ms
   - Feedback: 0%
   - Mix: 15-30%
   - Ping-Pong: 0%
   - Damping: 20-40%
4. **चौड़े stereo echoes (Ambient/Pads):**
   - Delay Size: 300-800ms
   - Feedback: 40-60%
   - Mix: 20-35%
   - Ping-Pong: 70-100%
   - Damping: 50-70% (smoother tails के लिए)

### त्वरित प्रारंभ गाइड

1. **Timing सेट करें:**
   - main echo rhythm set करने के लिए `Delay Size` से शुरू करें।
   - कितने echoes सुनाई देंगे, यह `Feedback` से adjust करें।
   - echo pattern शुरू होने से पहले extra gap जोड़ने के लिए `Pre-Delay` इस्तेमाल करें।
2. **Tone adjust करें:**
   - echoes fade होते समय कैसे सुनाई देंगे, यह shape करने के लिए `Damping`, `High Damp` और `Low Damp` साथ इस्तेमाल करें। Damping लगभग 50% से शुरू करें और Damp frequencies adjust करें।
3. **Stereo position (optional):**
   - stereo में सुनते समय echoes की width control करने के लिए `Ping-Pong` आज़माएं।
4. **Blend करें:**
   - echo volume को original music के साथ balance करने के लिए `Mix` इस्तेमाल करें। कम value (लगभग 16%) से शुरू करें और effect सही लगे तब तक बढ़ाएं।

## Time Alignment

playback timing को थोड़ी मात्रा में adjust करता है। speaker distance differences की भरपाई करने या sound आपके listening position पर कैसे पहुंचता है, इसे fine-tune करने में उपयोगी है।

### कब उपयोग करें
- speakers और listening position के बीच छोटे distance differences की भरपाई के लिए
- इस plugin से route हुए channels की timing fine-tune करने के लिए
- जांचने के लिए कि छोटा delay stereo image को अधिक stable या natural महसूस कराता है या नहीं

### पैरामीटर
- **Delay** - इस plugin से route हुए channels पर लगाया जाने वाला delay time control करता है (0 से 100 ms)
  - 0 ms: कोई delay नहीं
  - छोटे values: speakers के बीच tiny arrival-time differences की भरपाई के लिए उपयोगी
  - अधिक values: अधिक noticeable timing shift बनाते हैं

### अनुशंसित उपयोग

1. स्पीकर दूरी की भरपाई
   - जब कोई speaker या channel listening position पर पहले पहुंचता हो, तो छोटा delay जोड़ें
   - centered vocals या दूसरे focused sounds सुनते हुए छोटे steps में adjust करें

2. सुनने की स्थिति का सूक्ष्म समायोजन
   - पहले बहुत छोटे values आज़माएं
   - center image stable लगे और sound natural रहे, वहां रुकें

याद रखें: लक्ष्य listening enjoyment बढ़ाना है। controls के साथ experiment करके ऐसी depth और interest खोजें जो आपके पसंदीदा music पर हावी हुए बिना उसे बेहतर बनाए।
