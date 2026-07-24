---
title: "EQ प्लगइन - EffeTune"
description: "Parametric EQ, Graphic EQ, Dynamic EQ, Room EQ, Earphone Cable Sim, filters और Tone Control सहित equalizer प्लगइन।"
lang: hi
---

# इक्वलाइज़र प्लगइन्स

आपके संगीत की ध्वनि के विभिन्न पहलुओं को समायोजित करने के लिए प्लगइन्स का एक संग्रह, गहरे बास से लेकर साफ़ हाईज़ तक। ये उपकरण विशिष्ट ध्वनि तत्वों को बढ़ाकर या घटाकर आपके सुनने के अनुभव को व्यक्तिगत बनाने में मदद करते हैं।

## प्लगइन सूची

- [15Band GEQ](#15band-geq) - 15 सटीक नियंत्रणों के साथ विस्तृत ध्वनि समायोजन
- [15Band PEQ](#15band-peq) - music playback के लिए detailed 15-band tone shaping
- [5Band Dynamic EQ](#5band-dynamic-eq) - डायनेमिक्स-आधारित इक्वलाइज़र जो आपकी संगीत पर प्रतिक्रिया करता है
- [5Band PEQ](#5band-peq) - bass, mids और treble shape करने के लिए flexible equalizer
- [Band Pass Filter](#band-pass-filter) - विशिष्ट आवृत्तियों पर ध्यान केंद्रित करें
- [Comb Filter](#comb-filter) - फेज़िंग जैसी, खोखली या metallic sound coloration
- [Earphone Cable Sim](#earphone-cable-sim) - सामान्य ईयरफोन केबल से होने वाले frequency response बदलाव आम तौर पर कितने छोटे होते हैं, यह जांचें
- [Hi Pass Filter](#hi-pass-filter) - अनचाही निम्न आवृत्तियों को सटीकता से हटाएं
- [Lo Pass Filter](#lo-pass-filter) - अनचाही उच्च आवृत्तियों को सटीकता से हटाएं
- [Loudness Equalizer](#loudness-equalizer) - कम वॉल्यूम पर सुनने के लिए आवृत्ति संतुलन सुधार
- [Narrow Range](#narrow-range) - ध्वनि के विशिष्ट हिस्सों पर ध्यान केंद्रित करें
- [Room EQ](#room-eq) - सेव की गई room measurements पर आधारित FIR correction
- [Tilt EQ](#tilt-eq) - झुकाव EQ - ध्वनि स्पेक्ट्रम को झुकाने वाला सरल इक्वलाइज़र
- [Tone Control](#tone-control) - सरल बास, मिड और ट्रेबल समायोजन

## 15Band GEQ

15 अलग-अलग नियंत्रणों के साथ एक विस्तृत ध्वनि समायोजन उपकरण, जो ध्वनि स्पेक्ट्रम के प्रत्येक विशिष्ट हिस्से को प्रभावित करता है। यह आपके संगीत को बिल्कुल वैसा ही ट्यून करने के लिए उपयुक्त है जैसा आप पसंद करते हैं।

### सुनने में सुधार के लिए मार्गदर्शन
- बास क्षेत्र (25Hz-160Hz):
  - बास ड्रम और गहरे बास की शक्ति बढ़ाएं
  - बास वाद्य यंत्रों की पूर्णता को समायोजित करें
  - कमरे को हिलाने वाले सब-बास को नियंत्रित करें
- निचला मिडरेंज (250Hz-630Hz):
  - संगीत की गर्माहट को समायोजित करें
  - कुल ध्वनि की पूर्णता को नियंत्रित करें
  - ध्वनि के "गाढ़ापन" को घटाएं या बढ़ाएं
- अपर मिडरेंज (1kHz-2.5kHz):
  - वोकल्स को और स्पष्ट और प्रमुख बनाएं
  - मुख्य वाद्य यंत्रों की प्रमुखता को समायोजित करें
  - ध्वनि की "forward" भावना को नियंत्रित करें
- उच्च आवृत्तियाँ (4kHz-16kHz):
  - स्पष्टता और विवरण को बढ़ाएं
  - संगीत में "चमक" और "हवा" को नियंत्रित करें
  - कुल उज्ज्वलता को समायोजित करें

### पैरामीटर
- **Band Gains** - प्रत्येक आवृत्ति सीमा के लिए व्यक्तिगत नियंत्रण (-12dB से +12dB तक)
  - Deep Bass
    - 25Hz: सबसे निचला बास अनुभव
    - 40Hz: गहरे बास का प्रभाव
    - 63Hz: बास की शक्ति
    - 100Hz: बास की पूर्णता
    - 160Hz: Upper bass
  - Lower Sound
    - 250Hz: ध्वनि की गर्माहट
    - 400Hz: ध्वनि की पूर्णता
    - 630Hz: ध्वनि का सार
  - Middle Sound
    - 1kHz: मुख्य ध्वनि की उपस्थिति
    - 1.6kHz: ध्वनि की स्पष्टता
    - 2.5kHz: ध्वनि का विवरण
  - High Sound
    - 4kHz: ध्वनि का चटकापन
    - 6.3kHz: ध्वनि की उत्कृष्टता
    - 10kHz: ध्वनि की हवा
    - 16kHz: ध्वनि का चमक

### दृश्य प्रदर्शन
- आपके ध्वनि समायोजन को दर्शाता वास्तविक समय का ग्राफ
- सटीक नियंत्रण के साथ उपयोग में आसान स्लाइडर्स
- डिफ़ॉल्ट सेटिंग्स पर एक-क्लिक रीसेट

## 15Band PEQ

listening के दौरान bass, vocals, presence और treble को fine-tune करने के लिए 15-band parametric equalizer। जब graphic EQ से अधिक detailed control चाहिए, छोटे tone changes करने हों, या कोई खास परेशान करने वाली frequency narrow down करनी हो, तब उपयोगी है।

### ध्वनि सुधार के लिए मार्गदर्शन
- वोकल और वाद्य यंत्रों की स्पष्टता:
  - natural presence के लिए किसी band को लगभग 3.2kHz पर moderate Q (1.0-2.0) के साथ set करें
  - narrow Q (4.0-8.0) cuts केवल तब लगाएं जब कोई specific resonance परेशान कर रहा हो
  - 10kHz high shelf के साथ हल्की हवा जोड़ें (+2 से +4dB)
- बास गुणवत्ता नियंत्रण:
  - 100Hz peaking filter के साथ मूल ध्वनियों को आकार दें
  - कोई bass note या room boom बहुत उभर रहा हो तो narrow cut इस्तेमाल करें
  - low shelf के साथ स्मूथ बास एक्सटेंशन बनाएं
- सूक्ष्म श्रवण समायोजन:
  - natural result के लिए छोटे, broad boosts या cuts इस्तेमाल करें
  - overall tone के बजाय targeted problems के लिए narrow settings इस्तेमाल करें
  - bypass से बार-बार तुलना करें ताकि music balanced रहे

### पैरामीटर
- **कॉन्फ़िगर किए जा सकने वाले बैंड**
  - 15 पूर्णतः कॉन्फ़िगर किए जा सकने वाले आवृत्ति बैंड
  - प्रारंभिक आवृत्ति सेटिंग्स:
    - 25Hz, 40Hz, 63Hz, 100Hz, 160Hz (डीप बास)
    - 250Hz, 400Hz, 630Hz (लोअर साउंड)
    - 1kHz, 1.6kHz, 2.5kHz (मिडिल साउंड)
    - 4kHz, 6.3kHz, 10kHz, 16kHz (हाई साउंड)
- **प्रत्येक बैंड के नियंत्रण**
  - Center Frequency: 20Hz से 20kHz तक adjustable
  - Gain Range: Peaking और Low/High Shelf filters के लिए ±20dB
  - Q Factor: अधिकतर filter types के लिए 0.1-10.0; Low/High Shelf 0.1-2.0 तक limited
  - Higher Q narrow range पर असर डालता है; lower Q smoother और broader सुनाई देता है
  - Low/High Pass, Band Pass, Notch और AllPass में Frequency और Q filter shape करते हैं; Gain उपयोग नहीं होता
  - Multiple Filter Types:
    - Peaking: सममित आवृत्ति समायोजन
    - Low/High Pass: 12dB/octave ढलान
    - Low/High Shelf: मृदु स्पेक्ट्रल आकार
    - Band Pass: केन्द्रीकृत आवृत्ति पृथक्करण
    - Notch: सटीक आवृत्ति हटाना
    - AllPass: phase-focused frequency alignment
- **प्रीसेट प्रबंधन**
  - Import: Equalizer APO-style TXT filter lines load करें
  - अधिकतम 15 `ON` PK/LS/LSC/HS/HSC filters import होते हैं; `Preamp` lines और unsupported filter types ignore होते हैं
    - उदाहरण प्रारूप:
      ```
      Filter 1: ON PK Fc 50 Hz Gain -3.0 dB Q 2.00
      Filter 2: ON HS Fc 12000 Hz Gain 4.0 dB Q 0.70
      ...
      ```

### दृश्य प्रदर्शन
- उच्च-रिज़ॉल्यूशन आवृत्ति प्रतिक्रिया विज़ुअलाइज़ेशन
- सटीक पैरामीटर डिस्प्ले के साथ इंटरैक्टिव नियंत्रण बिंदु
- adjust करते समय real-time curve updates
- frequency और gain grid
- सभी पैरामीटर के लिए सटीक संख्यात्मक रीडआउट

## 5Band Dynamic EQ

एक स्मार्ट इक्वलाइज़र जो आपके संगीत की सामग्री के आधार पर स्वतः आवृत्ति बैंड समायोजित करता है। यह सटीक इक्वलाइज़ेशन को वास्तविक समय में आपकी संगीत में होने वाले परिवर्तनों पर प्रतिक्रिया देने वाली डायनामिक प्रोसेसिंग के साथ जोड़ता है, जिससे लगातार मैनुअल समायोजन की आवश्यकता के बिना एक बेहतर सुनने का अनुभव बनता है।

### सुनने में सुधार मार्गदर्शिका
- कठोर वोकल्स को काबू में करें:
  - 3000Hz पर peak filter का उपयोग करें, उच्च Ratio (4.0-10.0) के साथ
  - मध्यम Threshold (-24dB) और तेज़ Attack (10ms) सेट करें
  - जब वोकल्स बहुत आक्रामक हो जाएँ, तो ही यह स्वतः कठोरता को कम करता है
- स्पष्टता और चमक बढ़ाएँ:
  - BBE-शैली का उच्च-आवृत्ति संवर्धन उपयोग करें (Filter Type: Highshelf, SC Freq: 1200Hz, Ratio: 0.5, Attack: 1ms)
  - मिड्स प्राकृतिक ध्वनि वाली स्पष्टता के लिए उच्च आवृत्तियाँ ट्रिगर करती हैं
  - स्थायी चमक के बिना संगीत में चमक जोड़ता है
- अत्यधिक बेस को नियंत्रित करें:
  - 100Hz पर lowshelf filter का उपयोग करें, मध्यम Ratio (2.0-4.0) के साथ
  - स्पीकर विरूपण को रोकते हुए बेस प्रभाव बनाए रखें
  - छोटे स्पीकर्स पर बेस-भारी संगीत के लिए आदर्श
- अनुकूली ध्वनि समायोजन:
  - संगीत की डायनेमिक्स को ध्वनि संतुलन नियंत्रित करने देती हैं
  - अलग-अलग गीतों और रिकॉर्डिंग्स के अनुसार स्वतः समायोजित होता है
  - आपकी प्लेलिस्ट में सुसंगत ध्वनि गुणवत्ता बनाए रखता है

### पैरामीटर्स
- **पाँच बैंड नियंत्रण** - प्रत्येक में स्वतंत्र सेटिंग्स
  - Band 1: 100Hz (बेस क्षेत्र)
  - Band 2: 300Hz (निचला मिडरेंज)
  - Band 3: 1000Hz (मिडरेंज)
  - Band 4: 3000Hz (ऊपरी मिडरेंज)
  - Band 5: 10000Hz (उच्च आवृत्तियाँ)
- **बैंड सेटिंग्स**
  - Filter Type: Peak, Lowshelf, या Highshelf में से चुनें
  - Frequency: केंद्र/कॉर्नर आवृत्ति को बारीकी से समायोजित करें (20Hz-20kHz)
  - Q: बैंडविड्थ/तीक्ष्णता को नियंत्रित करें (0.1-10.0)
  - Max Gain: अधिकतम गेन समायोजन सेट करें (0-24dB)
  - Threshold: प्रोसेसिंग शुरू होने पर स्तर सेट करें (-60dB से 0dB)
  - Ratio: प्रोसेसिंग तीव्रता नियंत्रित करें (0.1-100.0)
    - 1.0 से नीचे: Expander (जब सिग्नल Threshold से अधिक हो, तो संवर्धन करता है)
    - 1.0 से ऊपर: Compressor (जब सिग्नल Threshold से अधिक हो, तो कम करता है)
  - Knee Width: Threshold के आसपास मुलायम संक्रमण (0-10dB)
  - Attack: प्रोसेसिंग कितनी जल्दी शुरू होती है (0.1-100ms)
  - Release: प्रोसेसिंग कितनी जल्दी समाप्त होती है (1-1000ms)
  - Sidechain Frequency: डिटेक्शन आवृत्ति (20Hz-20kHz)
  - Sidechain Q: डिटेक्शन बैंडविड्थ (0.1-10.0)

### विज़ुअल डिस्प्ले
- आपके ध्वनि समायोजन दिखाने वाला रीयल-टाइम ग्राफ
- सटीक नियंत्रण के साथ उपयोग में आसान स्लाइडर्स
- वन-क्लिक डिफ़ॉल्ट सेटिंग्स रीसेट

## 5Band PEQ

music playback shape करने के लिए flexible 5-band equalizer। bass boomy लगे, vocals harsh लगें, या highs में थोड़ी sparkle चाहिए लेकिन detailed 15-band version खोलना न चाहें, तब उपयोगी है।

### ध्वनि सुधार के लिए मार्गदर्शन
- वोकल और वाद्य यंत्रों की स्पष्टता:
  - natural presence के लिए 3.16kHz band को moderate Q (1.0-2.0) के साथ इस्तेमाल करें
  - narrow Q (4.0-8.0) cuts केवल तब लगाएं जब कोई specific resonance परेशान कर रहा हो
  - 10kHz high shelf के साथ हल्की हवा जोड़ें (+2 से +4dB)
- बास गुणवत्ता नियंत्रण:
  - 100Hz peaking filter के साथ मूल ध्वनियों को आकार दें
  - कोई bass note या room boom बहुत उभर रहा हो तो narrow cut इस्तेमाल करें
  - low shelf के साथ स्मूथ बास एक्सटेंशन बनाएं
- Everyday Sound Tuning:
  - natural tone changes के लिए broad, small adjustments इस्तेमाल करें
  - harshness, boominess या dullness को कान से घटाएं
  - bypass से बार-बार तुलना करें ताकि music balanced रहे

### पैरामीटर
- **पाँच समायोज्य बैंड**
  - Band 1: 100Hz (Sub & Bass Control)
  - Band 2: 316Hz (Lower Midrange Definition)
  - Band 3: 1.0kHz (Midrange Presence)
  - Band 4: 3.2kHz (Upper Midrange Detail)
  - Band 5: 10kHz (High Frequency Extension)
- **प्रत्येक बैंड के नियंत्रण**
  - Center Frequency: 20Hz से 20kHz तक adjustable
  - Gain Range: Peaking और Low/High Shelf filters के लिए ±20dB
  - Q Factor: अधिकतर filter types के लिए 0.1-10.0; Low/High Shelf 0.1-2.0 तक limited
  - Higher Q narrow range पर असर डालता है; lower Q smoother और broader सुनाई देता है
  - Low/High Pass, Band Pass, Notch और AllPass में Frequency और Q filter shape करते हैं; Gain उपयोग नहीं होता
  - Multiple Filter Types:
    - Peaking: सममित आवृत्ति समायोजन
    - Low/High Pass: 12dB/octave ढलान
    - Low/High Shelf: मृदु स्पेक्ट्रल आकार
    - Band Pass: केन्द्रीकृत आवृत्ति पृथक्करण
    - Notch: सटीक आवृत्ति हटाना
    - AllPass: phase-focused frequency alignment

### दृश्य प्रदर्शन
- उच्च-रिज़ॉल्यूशन आवृत्ति प्रतिक्रिया विज़ुअलाइज़ेशन
- सटीक पैरामीटर डिस्प्ले के साथ इंटरैक्टिव नियंत्रण बिंदु
- adjust करते समय real-time curve updates
- frequency और gain grid
- सभी पैरामीटर के लिए सटीक संख्यात्मक रीडआउट

## Band Pass Filter

एक सटीक बैंड पास फिल्टर जो हाई-पास और लो-पास फिल्टर को संयोजित करके केवल विशिष्ट आवृत्ति सीमा को पास होने देता है। इष्टतम फेज़ प्रतिक्रिया और पारदर्शी ध्वनि गुणवत्ता के लिए Linkwitz-Riley फिल्टर डिज़ाइन पर आधारित है।

### सुनने में सुधार के लिए मार्गदर्शन
- वोकल रेंज पर ध्यान केंद्रित करें:
  - वोकल स्पष्टता पर जोर देने के लिए HPF को 100-300Hz और LPF को 4-8kHz के बीच सेट करें
  - प्राकृतिक ध्वनि के लिए मध्यम स्लोप्स (-24dB/oct) का उपयोग करें
  - जटिल मिक्स में वोकल्स को अलग करने में मदद करता है
- विशेष प्रभाव बनाएं:
  - टेलीफोन, रेडियो, या मेगाफोन प्रभावों के लिए संकरी आवृत्ति सीमाएं सेट करें
  - अधिक नाटकीय फिल्टरिंग के लिए तीव्र स्लोप्स (-36dB/oct या उच्चतर) का उपयोग करें
  - रचनात्मक ध्वनियों के लिए विभिन्न आवृत्ति सीमाओं का प्रयोग करें
- विशिष्ट आवृत्ति सीमाओं को साफ करें:
  - सटीक नियंत्रण के साथ समस्याग्रस्त आवृत्तियों को लक्षित करें
  - आवश्यकतानुसार हाई-पास और लो-पास सेक्शन के लिए अलग-अलग स्लोप्स का उपयोग करें
  - निम्न आवृत्ति शोर और उच्च आवृत्ति शोर को एक साथ हटाने के लिए उत्तम

### पैरामीटर्स
- **HPF Frequency (Hz)** - निम्न आवृत्तियों को filter करने का point नियंत्रित करता है (10Hz से 40000Hz; effective upper limit audio sample rate पर भी निर्भर करती है)
  - निम्न मान: केवल सबसे निचली आवृत्तियां हटाई जाती हैं
  - उच्च मान: अधिक निम्न आवृत्तियां हटाई जाती हैं
  - उस विशिष्ट निम्न-आवृत्ति सामग्री के आधार पर समायोजित करें जिसे आप खत्म करना चाहते हैं
- **HPF Slope** - कटऑफ से नीचे की आवृत्तियों को कितनी तीव्रता से कम किया जाता है, इसे नियंत्रित करता है
  - Off: कोई फिल्टरिंग लागू नहीं
  - -12dB/oct: हल्की फिल्टरिंग (LR2 - 2nd order Linkwitz-Riley)
  - -24dB/oct: मानक फिल्टरिंग (LR4 - 4th order Linkwitz-Riley)
  - -36dB/oct: अधिक मजबूत फिल्टरिंग (LR6 - 6th order Linkwitz-Riley)
  - -48dB/oct: बहुत मजबूत फिल्टरिंग (LR8 - 8th order Linkwitz-Riley)
- **LPF Frequency (Hz)** - उच्च आवृत्तियों को filter करने का point नियंत्रित करता है (10Hz से 40000Hz; effective upper limit audio sample rate पर भी निर्भर करती है)
  - निम्न मान: अधिक उच्च आवृत्तियां हटाई जाती हैं
  - उच्च मान: केवल सबसे ऊंची आवृत्तियां हटाई जाती हैं
  - उस विशिष्ट उच्च-आवृत्ति सामग्री के आधार पर समायोजित करें जिसे आप खत्म करना चाहते हैं
- **LPF Slope** - कटऑफ से ऊपर की आवृत्तियों को कितनी तीव्रता से कम किया जाता है, इसे नियंत्रित करता है
  - Off: कोई फिल्टरिंग लागू नहीं
  - -12dB/oct: हल्की फिल्टरिंग (LR2 - 2nd order Linkwitz-Riley)
  - -24dB/oct: मानक फिल्टरिंग (LR4 - 4th order Linkwitz-Riley)
  - -36dB/oct: अधिक मजबूत फिल्टरिंग (LR6 - 6th order Linkwitz-Riley)
  - -48dB/oct: बहुत मजबूत फिल्टरिंग (LR8 - 8th order Linkwitz-Riley)

### दृश्य प्रदर्शन
- लॉगरिथमिक आवृत्ति स्केल के साथ वास्तविक समय की आवृत्ति प्रतिक्रिया ग्राफ
- दोनों फिल्टर स्लोप और कटऑफ बिंदुओं का स्पष्ट विज़ुअलाइज़ेशन
- सटीक समायोजन के लिए इंटरैक्टिव नियंत्रण
- प्रमुख संदर्भ बिंदुओं पर मार्कर के साथ आवृत्ति ग्रिड

## Comb Filter

एक comb filter जो ध्वनि को बहुत छोटी देरी वाली प्रतिलिपि के साथ मिलाकर फेज़िंग जैसा, hollow, metallic या resonant character जोड़ता है। जब आप किसी track को अधिक रंगीन, खुला या experimental महसूस कराना चाहें, तब इसका उपयोग करें।

### सुनने में सुधार के लिए मार्गदर्शन
- सूक्ष्म रंगत जोड़ें:
  - Feedforward mode, Feedback Gain लगभग 0.2-0.4 और Dry-Wet Mix लगभग 20-40% से शुरू करें
  - hollow या फेज़िंग जैसी tone संगीत में फिट बैठे तब तक Fundamental Frequency adjust करें
  - मूल sound में घुलने वाले नरम effect के लिए feedback कम रखें
- resonance और echo effects बनाएं:
  - अधिक मजबूत ringing या echo-like effects के लिए Feedback mode या अधिक Feedback Gain इस्तेमाल करें
  - अलग tonal character के लिए अलग fundamental frequencies आज़माएं
  - effect बहुत स्पष्ट लगे तो कम Dry-Wet Mix values इस्तेमाल करें
- चमकीली metallic रंगत:
  - अधिक चमकीले, अधिक दूरी वाले comb peaks और dips के लिए उच्च Fundamental Frequency values आज़माएं
  - peaks और dips का pattern बदलने के लिए positive या negative Feedback Gain इस्तेमाल करें
  - अधिक experimental listening effects के लिए दूसरे effects के साथ combine करें

### पैरामीटर्स
- **Fundamental Frequency (Hz)** - delay time और harmonic spacing नियंत्रित करता है (20Hz से 20000Hz)
  - कम मान: longer delays, closer-spaced comb peaks और dips
  - उच्च मान: shorter delays, wider-spaced comb peaks और dips
- **Feedback Gain** - comb filter effect की intensity नियंत्रित करता है (-1.0 से 1.0)
  - नकारात्मक मान: विपरीत हार्मोनिक पैटर्न बनाते हैं
  - सकारात्मक मान: सुदृढ़ हार्मोनिक पैटर्न बनाते हैं
  - शून्य: कोई प्रभाव नहीं (केवल ड्राई सिग्नल)
  - उच्च निरपेक्ष मान: अधिक स्पष्ट प्रभाव
- **Comb Type** - filter structure नियंत्रित करता है
  - Feedforward: feedback के बिना harmonic enhancement बनाता है
  - Feedback: resonance और echo-like effects बनाता है
- **Dry-Wet Mix** - processed और original signal के बीच balance नियंत्रित करता है (0% से 100%)
  - 0%: केवल मूल सिग्नल
  - 50%: मूल और संसाधित सिग्नल का समान मिश्रण
  - 100%: केवल संसाधित सिग्नल

### तकनीकी विवरण
- **विलंब गणना**: Delay time = 1 / Fundamental Frequency
- **हार्मोनिक प्रतिक्रिया**: Fundamental Frequency के आधार पर समान दूरी वाले peaks और dips बनाता है
- **स्थानिक रंगत**: छोटे प्रतिबिंब, hollow coloration या metallic resonance जैसा लग सकता है
- **रीयल-टाइम दृश्यांकन**: Fundamental Frequency marker के साथ frequency response दिखाता है

### दृश्य प्रदर्शन
- लॉगरिथमिक आवृत्ति स्केल के साथ वास्तविक समय की आवृत्ति प्रतिक्रिया ग्राफ
- कंब फिल्टर के पीक और डिप का स्पष्ट विज़ुअलाइज़ेशन
- delay time दिखाने वाला Fundamental frequency marker
- सटीक समायोजन के लिए इंटरैक्टिव नियंत्रण
- मिलीमीटर में विलंब दूरी गणना

## Earphone Cable Sim

वास्तविक केबल प्रतिरोध/इंडक्टेंस और शून्य से अलग एम्पलीफायर आउटपुट प्रतिबाधा के साथ ईयरफोन चलाने पर जो छोटे आवृत्ति-प्रतिक्रिया बदलाव पैदा होते हैं, यह प्लगइन उन्हें पुनः बनाता है। ईयरफोन की प्रतिबाधा आवृत्ति के साथ बदलती है (ड्राइवर रेज़ोनेंस और वॉइस-कॉइल इंडक्टेंस के कारण), इसलिए स्रोत और केबल प्रतिबाधा हर ईयरफोन में अलग-अलग स्तर बदलाव पैदा करती हैं। यह एक वास्तविकता-जांच के रूप में भी उपयोगी है: सामान्य बनावट और गुणवत्ता वाली केबलों, सामान्य एम्पलीफायर आउटपुट प्रतिबाधा, और ऐसे ईयरफोन जो असामान्य रूप से कम प्रतिबाधा वाले या किसी और तरह असामान्य न हों, उनके साथ सामान्य ईयरफोन-केबल अंतर से सुनाई देने वाला बदलाव आम तौर पर नगण्य रहने जितना छोटा होता है। यह प्रभाव बड़े प्रतिबाधा शिखर वाले कम-प्रतिबाधा ईयरफोन में सबसे मजबूत होता है, और आधुनिक कम-आउटपुट-प्रतिबाधा एम्पलीफायरों के साथ आम तौर पर सूक्ष्म रहता है।

### सुनने में सुधार के लिए मार्गदर्शन
- स्रोत प्रतिबाधा के प्रभाव का मूल्यांकन करें:
  - ट्यूब एम्पलीफायर या उच्च-प्रतिबाधा हेडफोन आउटपुट का अनुकरण करने के लिए Output Z बढ़ाएं
  - bypass से तुलना करके सुनें कि बास और प्रतिबाधा-शिखर क्षेत्रों में क्या बदलाव आता है
- मल्टी-ड्राइवर ईयरफोन के व्यवहार को समझें:
  - कई प्रतिबाधा शिखर वाले balanced-armature या hybrid ईयरफोन को मॉडल करने के लिए अतिरिक्त Resonances सक्षम करें
  - बड़े प्रतिबाधा शिखर और अधिक स्रोत प्रतिबाधा का संयोजन रंगत को अधिक स्पष्ट बनाता है
- केबल प्रतिरोध और इंडक्टेंस का अनुकरण करें:
  - अधिक DC प्रतिरोध वाली लंबी या पतली केबलों का अनुकरण करने के लिए Cable R बढ़ाएं
  - अधिक इंडक्टेंस वाली केबलों का अनुकरण करने के लिए Cable L बढ़ाएं; इसका प्रभाव मुख्य रूप से ऊपरी ट्रेबल में दिखता है
  - Cable R कुल श्रृंखला प्रतिरोध में जुड़ता है, इसलिए यह पूरे बैंड में परस्पर प्रभाव को मजबूत कर सकता है
- सामान्य केबल अंतर की सुनाई देने वाली मात्रा जांचें:
  - यथार्थवादी Cable R और Cable L मान सेट करें, फिर bypass से तुलना करके अनुमान लगाएं कि सामान्य केबल अंतर कितने छोटे हैं
  - यदि बदलाव केवल बहुत अधिक Output Z, Cable R या बहुत कम Base Z settings पर ही स्पष्ट होता है, तो वही तुलना बताती है कि उस ईयरफोन और एम्पलीफायर संयोजन में सामान्य केबलों का अंतर सुनाई देने योग्य रूप से महत्वपूर्ण होने की संभावना कम है

### पैरामीटर
- **Output Z (Ω)** - एम्पलीफायर आउटपुट प्रतिबाधा (0 से 20)। आधुनिक एम्पलीफायरों में 1Ω से कम मान सामान्य हैं; अधिक मान प्रतिबाधा-जनित रंगत को मजबूत बनाते हैं।
- **Cable R (Ω)** - केबल का DC प्रतिरोध (0 से 2)। अधिक मान लंबी या पतली केबलों को दर्शाते हैं और कुल श्रृंखला प्रतिरोध में जुड़ते हैं।
- **Cable L (µH)** - केबल इंडक्टेंस (0 से 5)। खासकर कम-प्रतिबाधा ईयरफोन में, यह मुख्य रूप से ऊपरी-ट्रेबल प्रतिक्रिया को प्रभावित करता है।
- **Voice Coil L (mH)** - ईयरफोन की वॉइस-कॉइल इंडक्टेंस (0.01 से 2)। यह उच्च आवृत्तियों की ओर load impedance बढ़ाता है और उच्च-आवृत्ति परस्पर प्रभाव को बदलता है।
- **Base Z (Ω)** - कम आवृत्तियों पर ईयरफोन की nominal impedance (4 से 64)। कम मान स्रोत और केबल प्रतिबाधा के प्रभाव को अधिक महत्वपूर्ण बनाते हैं।
- **Resonances (अधिकतम 5)** - प्रत्येक item ड्राइवर की एक impedance peak को मॉडल करता है। पहला default रूप से enabled है; बाकी typical driver resonances पर preset हैं और on/off किए जा सकते हैं।
  - **Enable** - प्रत्येक resonance को on या off करें
  - **Freq (Hz)** - resonance frequency (20 से 20000)
  - **Q** - impedance peak की तीक्ष्णता (0.5 से 10)
  - **Peak Z (Ω)** - resonance peak पर impedance (16 से 116)

### तकनीकी विवरण
- **भौतिक मॉडल**: `H(f) = Zload / (Zsource + Zload)` की गणना करता है, जहां `Zsource` आउटपुट प्रतिबाधा और केबल प्रतिरोध/इंडक्टेंस का योग है, और `Zload` ईयरफोन impedance (base impedance, voice-coil inductance और resonance peaks) है।
- **कार्यान्वयन**: transfer function को factor करके matched-Z biquad filters की cascade में बदला जाता है, जिससे दूसरे EQ plugins की तरह zero latency और minimum-phase behavior मिलता है।
- **सामान्यीकरण**: response को 20Hz से 20kHz तक 0 dB power average पर normalize किया जाता है, ताकि effect on/off करने पर overall loudness न बदले।

### दृश्य प्रदर्शन
- logarithmic frequency scale पर लागू filter response का real-time graph
- grid labels 20Hz से 20kHz तक होते हैं; plotted curve पूरे 10Hz से 40kHz graph range में फैलती है
- dark grid पर green response curve, normalized 0dB reference के आसपास auto-scaled dB axis के साथ
- curve deviations जितनी बड़ी हों, model playback level को वहां उतना अधिक बदल रहा होता है

## Hi Pass Filter

एक सटीक high-pass filter जो अनचाही निम्न आवृत्तियों को हटाते हुए उच्च आवृत्तियों की स्पष्टता को बनाए रखता है। यह optimal phase response और पारदर्शी ध्वनि गुणवत्ता के लिए Linkwitz-Riley filter design पर आधारित है।

### सुनने में सुधार के लिए मार्गदर्शन
- अनचाही गड़गड़ाहट को हटाएं:
  - subsonic noise को समाप्त करने के लिए 20-40Hz के बीच आवृत्ति सेट करें
  - साफ़ बास के लिए -24dB/oct या उससे अधिक तीव्र ढलान का उपयोग करें
  - vinyl recordings या stage vibrations वाले live प्रदर्शन के लिए आदर्श
- अधिक bass वाले संगीत को साफ करें:
  - bass response को कसा करने के लिए 60-100Hz के बीच आवृत्ति सेट करें
  - प्राकृतिक संक्रमण के लिए -12dB/oct से -24dB/oct के मध्यम ढलान का उपयोग करें
  - स्पीकर ओवरलोड को रोकता है और स्पष्टता में सुधार करता है
- विशेष प्रभाव बनाएं:
  - thinner, low-cut voice effect के लिए 200-500Hz के बीच frequency set करें
  - नाटकीय filtering के लिए -48dB/oct या उससे अधिक तीव्र ढलान का उपयोग करें
  - telephone-like voice effect के लिए Lo Pass Filter को लगभग 3-4kHz पर साथ इस्तेमाल करें

### पैरामीटर
- **Frequency (Hz)** - यह नियंत्रित करता है कि निम्न आवृत्तियाँ कहाँ फ़िल्टर की जाएं (10Hz से 40000Hz; effective upper limit audio sample rate पर भी निर्भर करती है)
  - कम मान: केवल सबसे निचली आवृत्तियाँ हटाई जाती हैं
  - अधिक मान: अधिक निम्न आवृत्तियाँ हटाई जाती हैं
  - उन विशिष्ट निम्न आवृत्ति सामग्रियों के आधार पर समायोजित करें जिन्हें आप हटाना चाहते हैं
- **Slope** - यह नियंत्रित करता है कि कटऑफ से नीचे की आवृत्तियाँ कितनी आक्रामकता से कम की जाएं
  - Off: कोई फ़िल्टरिंग लागू नहीं
  - -12dB/oct: हल्की फ़िल्टरिंग (LR2 - 2nd order Linkwitz-Riley)
  - -24dB/oct: मानक फ़िल्टरिंग (LR4 - 4th order Linkwitz-Riley)
  - -36dB/oct: अधिक मजबूत फ़िल्टरिंग (LR6 - 6th order Linkwitz-Riley)
  - -48dB/oct: बहुत मजबूत फ़िल्टरिंग (LR8 - 8th order Linkwitz-Riley)
  - -60dB/oct से -96dB/oct: विशेष अनुप्रयोगों के लिए अत्यंत तीव्र फ़िल्टरिंग

### दृश्य प्रदर्शन
- लॉगरिदमिक आवृत्ति पैमाने के साथ वास्तविक समय का आवृत्ति प्रतिक्रिया ग्राफ
- फिल्टर ढलान और कटऑफ बिंदु का स्पष्ट दृश्यीकरण
- सटीक समायोजन के लिए इंटरैक्टिव नियंत्रण
- महत्वपूर्ण संदर्भ बिंदुओं पर मार्करों के साथ आवृत्ति ग्रिड

## Lo Pass Filter

एक सटीक low-pass filter जो अनचाही उच्च आवृत्तियों को हटाते हुए निम्न आवृत्तियों की गर्माहट और सार को बनाए रखता है। यह optimal phase response और पारदर्शी ध्वनि गुणवत्ता के लिए Linkwitz-Riley filter design पर आधारित है.

### सुनने में सुधार के लिए मार्गदर्शन
- कठोरता और सिबिलेंस को कम करें:
  - कठोर रिकॉर्डिंग्स को नियंत्रित करने के लिए 8-12kHz के बीच आवृत्ति सेट करें
  - प्राकृतिक ध्वनि के लिए -12dB/oct से -24dB/oct के मध्यम ढलान का उपयोग करें
  - चमकदार रिकॉर्डिंग्स के साथ सुनने की थकान कम करने में मदद करता है
- डिजिटल रिकॉर्डिंग्स को गर्म करें:
  - डिजिटल "edge" को कम करने के लिए 12-16kHz के बीच आवृत्ति सेट करें
  - सूक्ष्म गर्माहट प्रभाव के लिए -12dB/oct के हल्के ढलान का उपयोग करें
  - एक अधिक एनालॉग जैसा ध्वनि चरित्र बनाता है
- विशेष प्रभाव बनाएं:
  - vintage radio effect के लिए 1-3kHz के बीच आवृत्ति सेट करें
  - नाटकीय filtering के लिए -48dB/oct या उससे अधिक तीव्र ढलान का उपयोग करें
  - band-pass effects के लिए Hi Pass Filter के साथ संयोजन करें
- शोर और हिस्स को नियंत्रित करें:
  - संगीत सामग्री के ठीक ऊपर की आवृत्ति सेट करें (आमतौर पर 14-18kHz)
  - प्रभावी शोर नियंत्रण के लिए -36dB/oct या उससे अधिक तीव्र ढलान का उपयोग करें
  - अधिकांश संगीत सामग्री को संरक्षित करते हुए टेप हिस्स या पृष्ठभूमि शोर को कम करता है

### पैरामीटर
- **Frequency (Hz)** - यह नियंत्रित करता है कि उच्च आवृत्तियाँ कहाँ फ़िल्टर की जाएं (10Hz से 40000Hz; effective upper limit audio sample rate पर भी निर्भर करती है)
  - कम मान: अधिक उच्च आवृत्तियाँ हटाई जाती हैं
  - अधिक मान: केवल सबसे ऊंची आवृत्तियाँ ही हटाई जाती हैं
  - उन विशिष्ट उच्च आवृत्ति सामग्रियों के आधार पर समायोजित करें जिन्हें आप हटाना चाहते हैं
- **Slope** - यह नियंत्रित करता है कि कटऑफ से ऊपर की आवृत्तियाँ कितनी आक्रामकता से कम की जाएं
  - Off: कोई फ़िल्टरिंग लागू नहीं
  - -12dB/oct: हल्की फ़िल्टरिंग (LR2 - 2nd order Linkwitz-Riley)
  - -24dB/oct: मानक फ़िल्टरिंग (LR4 - 4th order Linkwitz-Riley)
  - -36dB/oct: अधिक मजबूत फ़िल्टरिंग (LR6 - 6th order Linkwitz-Riley)
  - -48dB/oct: बहुत मजबूत फ़िल्टरिंग (LR8 - 8th order Linkwitz-Riley)
  - -60dB/oct से -96dB/oct: विशेष अनुप्रयोगों के लिए अत्यंत तीव्र फ़िल्टरिंग

### दृश्य प्रदर्शन
- लॉगरिदमिक आवृत्ति पैमाने के साथ वास्तविक समय का आवृत्ति प्रतिक्रिया ग्राफ
- फिल्टर ढलान और कटऑफ बिंदु का स्पष्ट दृश्यीकरण
- सटीक समायोजन के लिए इंटरैक्टिव नियंत्रण
- महत्वपूर्ण संदर्भ बिंदुओं पर मार्करों के साथ आवृत्ति ग्रिड

## Loudness Equalizer

एक विशेष equalizer जो आपके set किए गए Average SPL value के आधार पर frequency balance adjust करता है। quieter listening में bass और treble कमजोर महसूस हो सकते हैं; music को balanced और enjoyable रखने के लिए इसका उपयोग करें।

### सुनने में सुधार के लिए मार्गदर्शन
- कम वॉल्यूम पर सुनना:
  - बास और ट्रेबल आवृत्तियों को बढ़ाता है
  - शांत स्तरों पर संगीत संतुलन बनाए रखता है
  - मानव श्रवण विशेषताओं की भरपाई करता है
- वॉल्यूम-निर्भर प्रसंस्करण:
  - कम वॉल्यूम पर अधिक सुधार
  - वॉल्यूम बढ़ने पर प्रसंस्करण में क्रमिक कमी
  - उच्च सुनने के स्तर पर प्राकृतिक ध्वनि
- आवृत्ति संतुलन:
  - बास वृद्धि के लिए Low shelf (100-300Hz)
  - ट्रेबल वृद्धि के लिए High shelf (3-6kHz)
  - आवृत्ति श्रेणियों के बीच सहज संक्रमण

### पैरामीटर
- **Average SPL** - correction के लिए इस्तेमाल होने वाला estimated average listening level (60dB से 85dB)
  - कम मान: अधिक सुधार
  - अधिक मान: कम सुधार
  - इसे अपने typical listening volume से match करने के लिए manually set करें
- **निम्न आवृत्ति नियंत्रण**
  - Frequency: Bass enhancement center (100Hz से 300Hz)
  - Gain: Maximum bass boost (0dB से 15dB)
  - Q: Shape of bass enhancement (0.5 से 1.0)
- **उच्च आवृत्ति नियंत्रण**
  - Frequency: Treble enhancement center (3kHz से 6kHz)
  - Gain: Maximum treble boost (0dB से 15dB)
  - Q: Shape of treble enhancement (0.5 से 1.0)

### दृश्य प्रदर्शन
- वास्तविक समय का आवृत्ति प्रतिक्रिया ग्राफ
- इंटरैक्टिव पैरामीटर नियंत्रण
- वॉल्यूम-निर्भर वक्र दृश्यीकरण
- सटीक संख्यात्मक रीडआउट

## Narrow Range

एक उपकरण जो आपको अनचाही आवृत्तियों को फ़िल्टर करके संगीत के विशिष्ट हिस्सों पर ध्यान केंद्रित करने देता है। विशेष ध्वनि प्रभाव बनाने या अनचाही आवाजें हटाने के लिए उपयोगी।

### सुनने में सुधार के लिए मार्गदर्शन
- अनूठे ध्वनि प्रभाव बनाएं:
  - "Telephone voice" effect
  - "Old radio" sound
  - "Underwater" effect
- किसी frequency range पर focus करें:
  - bass-heavy हिस्सों को सुनना आसान बनाएं
  - vocal range पर ध्यान केंद्रित करें
  - sound को उस range तक narrow करें जहां vocals या instruments सबसे ज्यादा noticeable हों
- अनचाही आवाजें हटाएं:
  - निम्न-आवृत्ति गड़गड़ाहट को कम करें
  - अत्यधिक उच्च-आवृत्ति hiss को हटाएं
  - संगीत के सबसे महत्वपूर्ण हिस्सों पर ध्यान केंद्रित करें

### पैरामीटर
- **HPF Frequency** - यह नियंत्रित करता है कि निम्न ध्वनियाँ कहाँ से कम होना शुरू होती हैं (20Hz से 4000Hz)
  - अधिक मान: अधिक bass हटाता है
  - कम मान: अधिक bass बनाए रखता है
  - कम मानों से शुरू करें और पसंद के अनुसार समायोजित करें
- **HPF Slope** - निम्न ध्वनियाँ कितनी तेजी से कम होती हैं (0 से -48 dB/octave तक)
  - 0dB: कोई कमी नहीं (off)
  - -6dB से -48dB: 6dB के चरणों में क्रमिक रूप से अधिक मजबूत कमी
- **LPF Frequency** - यह नियंत्रित करता है कि उच्च ध्वनियाँ कहाँ से कम होना शुरू होती हैं (200Hz से 40000Hz)
  - कम मान: अधिक highs हटाता है
  - अधिक मान: अधिक highs बनाए रखता है
  - उच्च से शुरू करें और आवश्यकतानुसार घटाएं
- **LPF Slope** - उच्च ध्वनियाँ कितनी तेजी से कम होती हैं (0 से -48 dB/octave तक)
  - 0dB: कोई कमी नहीं (off)
  - -6dB से -48dB: 6dB के चरणों में क्रमिक रूप से अधिक मजबूत कमी

### दृश्य प्रदर्शन
- आवृत्ति प्रतिक्रिया दिखाने वाला स्पष्ट ग्राफ
- आसानी से समायोजित होने वाले आवृत्ति नियंत्रण
- सरल slope drop-down menus

## Room EQ

Room EQ, EffeTune में सेव की गई एक frequency-response measurement से एक FIR correction filter बनाता है और plugin को route किए गए सभी channels पर वही filter लागू करता है। Standard plugin bus selector तय करता है कि कौन-से channels process होंगे। यह चुनी गई measurement के सभी points का औसत लेता है, परिणाम को smooth करता है और चुनी हुई correction range में विचलन घटाता है। इसका उपयोग तब करें जब speaker और room के परस्पर प्रभाव से listening area में बार-बार आने वाले peaks या व्यापक tonal imbalance बनें। यह linear-phase magnitude correction के साथ-साथ minimum-phase magnitude correction और मापे गए direct sound की excess phase correction को जोड़ने वाला mixed-phase correction भी कर सकता है। Default रूप से excess-phase correction सभी measurement points में साझा component को बनाए रखता है और जहाँ उनकी phases सहमत नहीं होतीं वहाँ correction घटाता है। Room EQ को WASM DSP engine चाहिए; यह उपलब्ध न हो तो signal बिना बदले pass होता है।

### ध्वनि सुधार गाइड

- जिस speaker group को ठीक करना है, उसे listening area में पास-पास की कई microphone positions से मापें और वह measurement Room EQ में चुनें। कई points से correction केवल एक सटीक स्थान पर कम निर्भर रहता है।
- शुरुआत **Phase: Linear**, **Smoothing: 0.17 oct**, **Correction Low: 20 Hz**, **Correction High: 16000 Hz**, **Max Boost: 6 dB** और **Level Correction: 100%** से करें। Plugin के मुख्य on/off control से तुलना करके देखें कि balance अधिक समान हो, पर ध्वनि अस्वाभाविक रूप से पतली या बहुत चमकीली न बने।
- यदि filter ऐसे संकरे dips भरने की कोशिश करे जो microphone position के साथ बदलते हैं, तो Smoothing बढ़ाएँ या Max Boost घटाएँ। Max Boost को 0 dB रखने पर automatic boost रुकता है, लेकिन peaks घटाने वाले cuts जारी रहते हैं।
- यदि पूरी level correction बहुत अधिक लगे, तो Level Correction घटाएँ। यह हर automatic correction value को dB में समान अनुपात से बदलता है, इसलिए 50% पर +6 dB की correction +3 dB और -8 dB की correction -4 dB हो जाती है।
- Correction Low और Correction High को speaker तथा measurement microphone की भरोसेमंद range तक सीमित रखें। अविश्वसनीय measurement range के बाहर correction करने से परिणाम बिगड़ सकता है।
- Room correction स्थिर होने के बाद अतिरिक्त EQ से हल्का listening target बनाएँ, जैसे 100 Hz के पास चौड़ा +2 dB Low shelf या 10 kHz के पास छोटा High shelf adjustment। ये bands target बदलते हैं और FIR filter में शामिल होते हैं।
- कम latency के लिए **Minimum** चुनें। Frequency response के साथ excess phase भी correct करना हो तो **Correction** चुनें। Reference Point को **सहमति (सभी बिंदु)** पर रखकर, Direct Window के default और **Phase Correction: 100%** से शुरुआत करें। किसी एक microphone position के लिए excess phase optimize करनी हो तभी अलग point चुनें। यदि phase correction बहुत अधिक लगे, तो Phase Correction को अलग से घटाएँ।
- Room EQ speaker-distance alignment अपने-आप नहीं निकालता। **Delay** सभी processed channels में समान manual delay जोड़ता है। अलग groups को अलग delay चाहिए तो अलग Room EQ instances उपयोग करें।

Measurement एक device-local reference है। URL या preset में उसका नाम और identifier रहता है, measurement data नहीं। दूसरे device पर measurement उपयोग करने के लिए export से पहले measurement screen पर **Measurement JSON export में impulse responses शामिल करें** चालू करें, फिर दूसरे device पर import करके उसे चुनें। यह option default रूप से off होता है, और impulse responses शामिल करने से file का आकार दसियों megabytes तक बढ़ सकता है। Measurement न मिलने पर warning दिखती है और Room EQ पुराने correction data की जगह time-aligned bypass उपयोग करता है।

### पैरामीटर

- **Measurement** - सभी processed channels के लिए सेव की गई frequency-response measurement चुनता है। सूची में नाम, points की संख्या और impulse-response data होने पर `IR` दिखता है। Measurement जोड़ने या बदलने के बाद **Refresh measurements** उपयोग करें।
- **Delay** - सभी processed channels में 0 से 20 ms manual delay जोड़ता है। यह plugin की दिखाई गई processing latency में शामिल नहीं होता।
- **Phase** - FIR filter का phase व्यवहार चुनता है।
  - **Minimum** - सबसे कम अतिरिक्त latency वाला minimum-phase magnitude correction।
  - **Linear** - Linear-phase magnitude correction। यह input की relative phase बनाए रखता है, लेकिन चुने गए taps की आधी delay जोड़ता है।
  - **Correction** - Minimum-phase magnitude correction के साथ सेव की गई direct-sound impulse response की excess phase correction करता है। Mixed-phase filter के लिए `Taps / 2` samples की delay बनाए रखते हुए यह group-delay variation घटाता है। Design के समय main impulse की energy position को उसी Level Correction setting वाली Minimum response के साथ align रखा जाता है। चुनी गई एक measurement से एक filter design किया जाता है और उसे बिना बदले सभी routed channels पर लगाया जाता है। इसलिए Level Correction या Phase Correction बदलने से channels के बीच अलग-अलग timing difference नहीं आता। इसके लिए Reference Point, Direct Window और impulse-response data चाहिए।
- **Taps** - FIR length: 8192, 16384, 32768, 65536 या 131072। अधिक taps low-frequency resolution बढ़ाते हैं, लेकिन delay, memory और filter-design time भी बढ़ाते हैं। Linear और Correction में `Taps / 2` samples की delay जुड़ती है।
- **Latency** - Convolution engine की head latency: 0, 128, 256, 512 या 1024 samples। कम value delay घटाती है लेकिन processing बढ़ाती है; Linear और Correction में FIR की half-length delay आम तौर पर अधिक होती है।
- **Smoothing** - 0.02 से 1.00 octave तक Gaussian smoothing। बड़ी value व्यापक और अधिक conservative correction देती है; छोटी value बारीक response variations को अधिक follow करती है।
- **Correction Low / Correction High** - Automatic magnitude correction की निचली और ऊपरी transition boundaries सेट करते हैं। Gaussian smoothing से पहले इन boundaries पर और इनके बाहर automatic correction को 0 dB माना जाता है। इसलिए Smoothing तय करता है कि correction कितनी धीरे कम हो और हर boundary के बाहर कितनी दूर तक फैले। ऊपरी boundary को Nyquist frequency के नीचे margin रखने के लिए भीतर से भी सीमित किया जाता है।
- **Direct Window** - Correction में direct-sound onset के बाद उपयोग होने वाली measurement response की 1 से 50 ms लंबाई। लंबी window phase correction को नीचे तक बढ़ाती है, पर अधिक room reflections भी शामिल करती है।
- **Max Boost** - Automatic response inversion से बने boost को 0 से 18 dB तक सीमित करता है। यह limit Gaussian smoothing से पहले लागू होती है, इसलिए limit तक पहुँचे हिस्से आसपास के correction curve में smoothly blend होते हैं। Cuts सीमित नहीं होते।
- **Level Correction** - Automatic magnitude correction को 0% से 100% तक 1% के steps में, dB में linearly सेट करता है। 0% पर automatic level correction बंद रहती है; Phase Correction, Additional EQ, Delay और Gain सक्रिय रहते हैं।
- **Phase Correction** - मापी गई excess-phase correction को 0% से 100% तक 1% के steps में सेट करता है और केवल Correction में काम करता है। Minimum और Linear modes में इसके controls disabled रहते हैं। 0% पर excess-phase correction बंद रहती है, जबकि Level Correction सक्रिय रहती है। Level Correction की magnitude response के साथ स्वाभाविक रूप से जुड़ा minimum-phase बदलाव बना रहता है, इसलिए Phase Correction केवल measurement से जोड़े गए अतिरिक्त excess-phase component को नियंत्रित करता है।
- **Reference Point** - Correction में direct-sound excess phase का source चुनता है। **सहमति (सभी बिंदु)** default और fallback है: यह points को समय में align करता है, उनकी excess phase जोड़ता है, गहरे response nulls के पास अविश्वसनीय phase को कम weight देता है और जहाँ points सहमत नहीं होते वहाँ correction घटाता है। किसी नामित point को चुनने पर केवल उसी की excess phase उपयोग होती है। Magnitude correction हमेशा सभी points का उपयोग करता है। चुना हुआ point हटाने पर setting सहमति पर लौट जाती है।
- **अतिरिक्त EQ (FIR में शामिल)** - 5Band PEQ के समान पाँच-band interface और graph का उपयोग करता है। हर band को enable करके Peak, Low shelf या High shelf चुन सकते हैं और 20 Hz से 20 kHz, -20 से +20 dB तथा Q 0.1 से 10 तक सेट कर सकते हैं। Response अलग IIR stage में नहीं, FIR में शामिल होती है। Linear में इसकी phase zero और Minimum तथा Correction में minimum-phase होती है। Max Boost automatic room-response inversion को सीमित करता है, इस EQ के जानबूझकर दिए boost को नहीं।
- **Gain** - Corrected और bypass paths को मिलाने के बाद सभी channels पर -12 से +12 dB लागू करता है।

### दृश्य प्रदर्शन

- Graph के ऊपर दिए **Frequency Response** और **Impulse Response** radio buttons से दोनों views के बीच बदल सकते हैं।
- **Impulse Response** चुना हुआ point दिखाता है; Reference Point को सहमति पर रखने पर यह समय में align की गई औसत waveform दिखाता है। Range मापे गए onset से 5 ms पहले से 5 ms और Direct Window में जो अधिक हो, वहाँ तक रहती है। धूसर line correction से पहले की response और सफेद line वास्तविक FIR लगाने के बाद का calculated result दिखाती है। मापा गया onset दोनों के लिए साझा 0 ms reference है और corrected waveform से केवल FIR का ज्ञात fixed delay हटाया जाता है, इसलिए peak की relative timing और pre-ringing दिखाई देते रहते हैं। दोनों एक ही normalized amplitude scale का उपयोग करती हैं। Impulse-response data न होने पर unavailable message दिखाई देता है।
- Graph का horizontal axis logarithmic frequency और vertical axis dB level दिखाता है।
- दो सफेद खड़ी dotted lines, Correction Low और Correction High से सेट की गई frequencies दिखाती हैं।
- Markers से हर band की frequency और gain बदली जा सकती है।
- हल्की धूसर curve graph का common display offset लागू की गई smoothed measured frequency response दिखाती है।
- पतली हल्की हरी curve चुनी हुई measurement और मौजूदा Room EQ correction settings से निकली automatic correction को अतिरिक्त EQ लागू होने से पहले दिखाती है।
- चमकीली हरी curve उसी correction पर अतिरिक्त EQ लागू होने के बाद की response दिखाती है। यही combined magnitude response FIR में शामिल होती है।
- सफेद curve हल्की धूसर measured response में चमकीली हरी combined correction जोड़कर मिली estimated corrected response दिखाती है। धूसर और सफेद curves पर एक ही offset लगाया जाता है, जो 100% automatic correction के destination level को 0 dB पर रखता है; Max Boost की सीमा कुछ deviation छोड़ सकती है, जबकि Additional EQ इस reference के आसपास response को जानबूझकर बदलता है। यह calculated preview है, कोई नई acoustic measurement नहीं।
- Controls के नीचे status total processing latency, FIR resolution और filter की bypass, staged, preparing, active या error अवस्था दिखाता है।

## Tone Control

एक सरल तीन-बैंड ध्वनि समायोजक जो त्वरित और आसान ध्वनि निजीकरण के लिए है। अत्यधिक तकनीकी विवरण में जाए बिना बुनियादी ध्वनि आकार देने के लिए उत्तम।

### संगीत सुधार के लिए मार्गदर्शन
- शास्त्रीय संगीत:
  - स्ट्रिंग्स में अधिक विवरण के लिए हल्का ट्रेबल बूस्ट
  - भरपूर ऑर्केस्ट्रा ध्वनि के लिए कोमल बास बूस्ट
  - प्राकृतिक ध्वनि के लिए न्यूट्रल मिड्स
- रॉक/पॉप संगीत:
  - अधिक प्रभाव के लिए मध्यम बास बूस्ट
  - स्पष्ट ध्वनि के लिए हल्का मिड कम
  - ट्रेबल बूस्ट से चमकदार cymbals और विवरण
- जैज़ संगीत:
  - भरपूर ध्वनि के लिए गर्म बास
  - वाद्य यंत्रों के विवरण के लिए स्पष्ट मिड्स
  - cymbal sparkle के लिए कोमल ट्रेबल
- इलेक्ट्रॉनिक संगीत:
  - गहरे प्रभाव के लिए मजबूत बास
  - साफ़ ध्वनि के लिए कम मिड्स
  - crisp details के लिए बढ़ा हुआ ट्रेबल

### पैरामीटर
- **Bass** - निम्न ध्वनियों को नियंत्रित करता है (-24dB से +24dB)
  - अधिक शक्तिशाली bass के लिए बढ़ाएं
  - हल्की, साफ़ ध्वनि के लिए घटाएं
  - संगीत के "weight" को प्रभावित करता है
- **Mid** - ध्वनि के मुख्य भाग को नियंत्रित करता है (-24dB से +24dB)
  - अधिक प्रमुख vocals/वाद्य यंत्रों के लिए बढ़ाएं
  - अधिक व्यापक ध्वनि के लिए घटाएं
  - संगीत के "fullness" को प्रभावित करता है
- **Treble** - उच्च ध्वनियों को नियंत्रित करता है (-24dB से +24dB)
  - अधिक चमक और विवरण के लिए बढ़ाएं
  - अधिक चिकनी, मुलायम ध्वनि के लिए घटाएं
  - संगीत के "brightness" को प्रभावित करता है

### दृश्य प्रदर्शन
- आपके समायोजनों को दिखाने वाला आसानी से पढ़ा जाने वाला ग्राफ
- प्रत्येक नियंत्रण के लिए सरल स्लाइडर्स
- त्वरित रीसेट बटन
## Tilt EQ

एक सरल पर प्रभावी इक्वलाइज़र जो संगीत की फ्रीक्वेंसी बैलेंस को धीरे से झुकाता है। यह सूक्ष्म समायोजन के लिए डिज़ाइन किया गया है जो बिना जटिल कंट्रोल्स के संगीत को गर्म या चमकदार बना सकता है। समग्र टोन को अपनी पसंद के अनुसार जल्दी से एडजस्ट करने के लिए आदर्श।

### संगीत संवर्धन गाइड
- संगीत को गर्म बनाएं:
  - high frequencies घटाने और low frequencies बढ़ाने के लिए negative slope values इस्तेमाल करें
  - तेज रिकॉर्डिंग या अत्यधिक तीखे हेडफ़ोन के लिए उपयुक्त
  - आरामदायक और गर्मजोशी भरी सुनने का अनुभव बनाएं
- संगीत को चमकदार बनाएं:
  - high frequencies बढ़ाने और low frequencies घटाने के लिए positive slope values इस्तेमाल करें
  - मफल्ड रिकॉर्डिंग या सुस्त स्पीकर के लिए आदर्श
  - संगीत में स्पष्टता और चमक जोड़ें
- सूक्ष्म टोन समायोजन:
  - gentle overall tone shaping के लिए small slope values इस्तेमाल करें
  - अपने सुनने के वातावरण या मूड के अनुसार बैलेंस एडजस्ट करें

### पैरामीटर्स
- **Pivot Frequency** - टिल्ट का सेंट्रल फ़्रीक्वेंसी पॉइंट कंट्रोल करें (20Hz से ~20kHz)
  - टिल्ट इफेक्ट के केंद्र बिंदु को सेट करने के लिए एडजस्ट करें
- **Slope** - Pivot Frequency के आसपास tilt की steepness control करता है (-12 dB/oct से +12 dB/oct)
  - positive values sound को brighter बनाती हैं; negative values warmer बनाती हैं
  - smaller values gentler changes करती हैं

### विजुअल डिस्प्ले
- आसान slope adjustment के लिए simple slider
- रियल-टाइम फ़्रीक्वेंसी रिस्पांस कर्व
- current slope value की clear indication
