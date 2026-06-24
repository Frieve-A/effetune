---
title: "अन्य प्लगइन - EffeTune"
description: "स्पीकर/हेडफ़ोन जाँच के लिए Oscillator सहित अतिरिक्त utility प्लगइन।"
lang: hi
---

# अन्य ऑडियो टूल

मुख्य effect श्रेणियों के पूरक विशेष audio tools और generators का संग्रह। ये plugins सुनने से पहले या सुनते समय speakers, headphones, channel balance और playback behavior की जाँच में उपयोगी हैं।

## प्लगइन सूची

- [Oscillator](#oscillator) - speakers/headphones की जाँच के लिए test tone और noise generator

## Oscillator

यह आपके listening setup की जाँच के लिए test tone और noise generator है। speaker/headphone output, left/right placement, level balance, rattles, buzzes या साधारण frequency response समस्याएँ कम volume पर जाँचने के लिए इसका उपयोग करें।

बनाया गया tone या noise input को बदलता नहीं है, बल्कि मौजूदा audio path में mix होता है। इसे चालू करने से पहले Volume कम करें, खासकर जब music पहले से चल रहा हो।

### विशेषताएं
- कई वेवफॉर्म प्रकार:
  - संदर्भ टोन के लिए शुद्ध साइन वेव
  - समृद्ध हार्मोनिक सामग्री के लिए स्क्वेयर वेव
  - नरम हार्मोनिक्स के लिए ट्रायएंगल वेव
  - चमकीले टिम्बर के लिए सॉटूथ वेव
  - broadband speaker/headphone checks के लिए व्हाइट नॉइज़
  - अधिक smooth और natural noise balance के लिए पिंक नॉइज़
- बर्स्ट परीक्षण और आंतरायिक सिग्नल के लिए पल्स ऑपरेशन मोड

### पैरामीटर
- **Frequency (Hz)** - उत्पन्न टोन की पिच को नियंत्रित करता है (20 Hz से 96 kHz)
  - निम्न फ्रीक्वेंसी: गहरी बास टोन
  - मध्य फ्रीक्वेंसी: संगीत रेंज
  - उच्च फ्रीक्वेंसी: सावधानी से और केवल सुरक्षित listening levels पर उपयोग करें
  - केवल sine, square, triangle और sawtooth पर लागू; white और pink noise के लिए disabled
  - उपलब्ध high-frequency output मौजूदा audio sample rate पर निर्भर करता है; usable Nyquist frequency से ऊपर के tones muted होते हैं
- **Volume (dB)** - आउटपुट स्तर समायोजित करता है (-96 dB से 0 dB)
  - कम level से शुरू करें और धीरे-धीरे बढ़ाएँ
  - उच्च values बहुत तेज़ या थकाऊ हो सकती हैं
- **Panning (L/R)** - स्टीरियो स्थान नियंत्रित करता है
  - केंद्र: दोनों चैनलों में समान
  - बायां/दायां: चैनल संतुलन परीक्षण
- **Waveform Type** - सिग्नल का प्रकार चुनता है
  - Sine: स्वच्छ संदर्भ टोन
  - Square: विषम हार्मोनिक्स में समृद्ध
  - Triangle: नरम हार्मोनिक सामग्री
  - Sawtooth: पूर्ण हार्मोनिक श्रृंखला
  - White Noise: प्रति Hz समान ऊर्जा
  - Pink Noise: प्रति ऑक्टेव समान ऊर्जा
- **Mode** - signal generation pattern को नियंत्रित करता है
  - Continuous: मानक निरंतर signal generation
  - Pulsed: नियंत्रणीय समयबद्धता के साथ आंतरायिक सिग्नल
- **Interval (ms)** - पल्स मोड में पल्स बर्स्ट के बीच का समय (100-2000 ms, स्टेप 10 ms)
  - छोटे अंतराल: तेज़ पल्स अनुक्रम
  - लंबे अंतराल: व्यापक रूप से फैले पल्स
  - केवल तभी सक्रिय जब Mode को Pulsed पर सेट किया गया हो
- **Width (ms)** - पल्स मोड में pulse ramp time (2-100 ms, Interval के आधे तक सीमित, step 1 ms)
  - प्रत्येक पल्स के फेड-इन/फेड-आउट समय को नियंत्रित करता है
  - generated pulse लगभग Width के दोगुने समय तक रहता है, इसमें steady hold section नहीं होता
  - छोटी चौड़ाई: तेज़ पल्स किनारे
  - लंबी चौड़ाई: चिकने पल्स संक्रमण
  - केवल तभी सक्रिय जब Mode को Pulsed पर सेट किया गया हो

### उपयोग के उदाहरण

1. Speaker और Headphone Output Check
   - ध्वनि आने की पुष्टि करें
     * आरामदायक Volume पर sine wave या pink noise से शुरू करें
     * जरूरत हो तो Volume धीरे-धीरे बढ़ाएँ
   - left और right output की तुलना करें
     * Pan को पूरी तरह left और right पर ले जाएँ
     * पुष्टि करें कि हर side अपेक्षित speaker या headphone driver से बज रही है

2. Channel और Level Balance
   - stereo placement जाँचें
     * centered sine wave या pink noise का उपयोग करें
     * पुष्टि करें कि ध्वनि बीच में सुनाई दे रही है
   - left और right loudness की तुलना करें
     * समान Volume पर हर side पर pan करें
     * अगर कोई side ज्यादा तेज़ लगे तो playback setup समायोजित करें
   - plugin chains जाँचें
     * Oscillator को दूसरे effects से पहले या बाद में रखकर सुनें कि chain simple signal को कैसे बदलती है

3. Room या Desk Resonance Spot Checks
   - साफ़ bass build-up या rattles खोजें
     * safe levels पर low sine tones का उपयोग करें
     * listening position के आसपास चलकर मजबूत peaks या dropouts नोट करें
   - vibration-prone objects जाँचें
     * low और low-mid frequencies में धीरे-धीरे sweep करें
     * कुछ भी जोर से rattles करे तो Volume तुरंत कम करें

4. Noise Balance Checks
   - broad, steady reference के लिए pink noise का उपयोग करें
     * स्पष्ट left/right या tonal imbalance के लिए सुनें
     * level आरामदायक रखें और लंबे समय तक तेज़ noise playback से बचें
   - white noise केवल तब उपयोग करें जब brighter broadband signal चाहिए हो

5. Pulsed Signal Checks
   - छोटे bursts को पहचानना आसान बनाने के लिए Pulsed mode इस्तेमाल करें
     * लंबे intervals हर burst को अलग-अलग सुनना आसान बनाते हैं
     * छोटी Width values तेज़ starts और stops बनाती हैं
     * अलग-अलग volume levels पर behavior की तुलना करें

याद रखें: Oscillator एक test signal generator है। कम Volume से शुरू करें, धीरे-धीरे बढ़ाएँ, और बहुत तेज़ या high-frequency tones से बचें, क्योंकि वे equipment damage या hearing fatigue का कारण बन सकते हैं।
