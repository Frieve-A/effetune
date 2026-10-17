---
title: "EQ प्लगइन - पैरामीट्रिक, ग्राफ़िक, लीनियर-फ़ेज़ EQ और रूम करेक्शन - EffeTune"
description: "पैरामीट्रिक EQ (AutoEQ इम्पोर्ट), ग्राफ़िक, डायनामिक व लीनियर-फ़ेज़ EQ, EffeTune में अपने कमरे के मापों से Room EQ, Tonal Balance EQ, Loudness Equalizer व फ़िल्टर।"
lang: hi
---

# इक्वलाइज़र प्लगइन्स

आपके संगीत की ध्वनि के विभिन्न पहलुओं को समायोजित करने के लिए प्लगइन्स का एक संग्रह, गहरे बास से लेकर साफ़ हाईज़ तक। ये उपकरण विशिष्ट ध्वनि तत्वों को बढ़ाकर या घटाकर आपके सुनने के अनुभव को व्यक्तिगत बनाने में मदद करते हैं।

## ग्राफ़ के नियंत्रण

5Band PEQ, 15Band PEQ, 5Band FIR PEQ, Group Delay PEQ और Room EQ के Additional EQ में खींचे जा सकने वाले पॉइंट ग्राफ़ पर किसी पॉइंट को सामान्य रूप से खींचने से दोनों अक्ष बदलते हैं। गति को एक अक्ष पर सीमित करने के लिए खींचते समय Shift दबाए रखें: केवल Frequency बदलने के लिए शुरुआत में पॉइंट को मुख्यतः दाएँ या बाएँ ले जाएँ, या केवल Level बदलने के लिए मुख्यतः ऊपर या नीचे ले जाएँ (Group Delay PEQ में Delay)। फिर से स्वतंत्र रूप से चलाने के लिए Shift छोड़ दें। किसी पॉइंट पर माउस पॉइंटर रखें और Q बढ़ाने के लिए व्हील ऊपर, या Q घटाने के लिए नीचे स्क्रॉल करें।

## मोबाइल पर बैंड चुनना

मोबाइल पर 5Band PEQ, 5Band FIR PEQ, Group Delay PEQ, Room EQ का Additional EQ और Tonal Balance EQ का Target Adjust एक समय में केवल चुने हुए बैंड की सेटिंग दिखाते हैं। जिस बैंड को बदलना है, उसके नंबर वाले बटन पर टैप करें। बैंड बदलने पर सभी बैंड की सेटिंग बनी रहती हैं।

## प्लगइन सूची

- [15Band GEQ](#15band-geq) - 15 सटीक नियंत्रणों के साथ विस्तृत ध्वनि समायोजन
- [15Band PEQ](#15band-peq) - music playback के लिए detailed 15-band tone shaping
- [5Band Dynamic EQ](#5band-dynamic-eq) - डायनेमिक्स-आधारित इक्वलाइज़र जो आपकी संगीत पर प्रतिक्रिया करता है
- [5Band FIR PEQ](#5band-fir-peq) - minimum-phase या linear-phase FIR filtering के साथ five-band tone shaping
- [5Band PEQ](#5band-peq) - bass, mids और treble shape करने के लिए flexible equalizer
- [Band Pass Filter](#band-pass-filter) - विशिष्ट आवृत्तियों पर ध्यान केंद्रित करें
- [Comb Filter](#comb-filter) - फेज़िंग जैसी, खोखली या metallic sound coloration
- [Earphone Cable Sim](#earphone-cable-sim) - सामान्य ईयरफोन केबल से होने वाले frequency response बदलाव आम तौर पर कितने छोटे होते हैं, यह जांचें
- [Group Delay EQ](#group-delay-eq) - Tone बदले बिना हर frequency band की delay समायोजित करता है
- [Group Delay PEQ](#group-delay-peq) - Tone बदले बिना हर frequency की delay को पाँच parametric bands से नियंत्रित करता है
- [Hi Pass Filter](#hi-pass-filter) - अनचाही निम्न आवृत्तियों को सटीकता से हटाएं
- [Lo Pass Filter](#lo-pass-filter) - अनचाही उच्च आवृत्तियों को सटीकता से हटाएं
- [Loudness Equalizer](#loudness-equalizer) - कम वॉल्यूम पर सुनने के लिए आवृत्ति संतुलन सुधार
- [Narrow Range](#narrow-range) - ध्वनि के विशिष्ट हिस्सों पर ध्यान केंद्रित करें
- [Room EQ](#room-eq) - सेव की गई room measurements पर आधारित FIR correction
- [Tilt EQ](#tilt-eq) - ध्वनि स्पेक्ट्रम को झुकाने वाला सरल इक्वलाइज़र
- [Tonal Balance EQ](#tonal-balance-eq) - लंबी अवधि के tonal balance को music style के target की ओर अपने-आप correct करता है
- [Tone Control](#tone-control) - सरल बास, मिड और ट्रेबल समायोजन

<!-- spectrum-overlay -->
## स्पेक्ट्रम ओवरले

किसी समर्थित ग्राफ़ में स्पेक्ट्रम आइकन दबाकर After, Before + After और Off के बीच क्रम से बदलें। After में केवल प्रोसेसिंग के बाद का स्पेक्ट्रम नीली लाइन के रूप में दिखता है। Before + After में प्रोसेसिंग से पहले और बाद के स्पेक्ट्रम के बीच का बदलाव भरा जाता है: प्रोसेसिंग के बाद जिन फ़्रीक्वेंसी का स्तर बढ़ा है वे गर्म रंग में, जिनका स्तर घटा है वे नीले रंग में दिखती हैं, और ग्रे लाइन After स्पेक्ट्रम दिखाती है। इनपुट और आउटपुट स्पेक्ट्रम प्लेबैक के एक ही क्षण से लिए जाते हैं, इसलिए तुलना में वही ऑडियो मेल खाता है। **सामान्य** मोड में 1/12-ऑक्टेव स्मूदिंग लागू होती है; **उच्च गुणवत्ता** मोड कम फ़्रीक्वेंसी का अधिक बारीकी से विश्लेषण करता है। सुनते समय इस तुलना से देखें कि हर समायोजन बास, मिड्स और हाईज़ को कैसे बदलता है। स्पेक्ट्रम के स्तर ग्राफ़ के दाईं ओर dBFS स्केल पर पढ़ें। यह ग्राफ़ के gain scale से अलग है; 0 dBFS डिजिटल full-scale reference है और कम मान शांत स्तर दिखाते हैं। विन्यास में ओवरले स्पेक्ट्रम गुणवत्ता के लिए **सामान्य** या **उच्च गुणवत्ता**, और प्रदर्शन के लिए **तात्कालिक मान** या **पीक होल्ड** चुनें। पीक होल्ड हाल के अधिकतम स्तरों को दिखाता रहता है और फिर उन्हें धीरे-धीरे कम करता है। After में केवल प्रोसेसिंग के बाद का स्पेक्ट्रम लिया जाता है; Off में डेटा लेना और चित्रण दोनों बंद हो जाते हैं।

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
- किसी slider पर double-click करने से वह band 0dB पर लौट आती है
- Graph पर माउस घुमाएं, या टच करके ड्रैग करें, ताकि उस बिंदु के values पढ़े जा सकें।

## 15Band PEQ

listening के दौरान bass, vocals, presence और treble को fine-tune करने के लिए 15-band parametric equalizer। जब graphic EQ से अधिक detailed control चाहिए, छोटे tone changes करने हों, या कोई खास परेशान करने वाली frequency narrow down करनी हो, तब उपयोगी है।

### ध्वनि सुधार के लिए मार्गदर्शन
- वोकल और वाद्य यंत्रों की स्पष्टता:
  - natural presence के लिए किसी band को लगभग 3.2kHz पर moderate Q (1.0-2.0) के साथ set करें
  - narrow Q (4.0-8.0) cuts केवल तब लगाएं जब कोई specific resonance परेशान कर रहा हो
  - 10kHz high shelf के साथ हल्की हवा जोड़ें (+2 से +4dB)
- बास गुणवत्ता नियंत्रण:
  - 100Hz peaking filter से bass की भरपूरता को आकार दें
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
- Graph पर माउस घुमाएं, या टच करके ड्रैग करें, ताकि उस बिंदु के values पढ़े जा सकें।

## 5Band Dynamic EQ

एक स्मार्ट इक्वलाइज़र जो आपके संगीत की सामग्री के आधार पर स्वतः आवृत्ति बैंड समायोजित करता है। यह सटीक इक्वलाइज़ेशन को वास्तविक समय में आपकी संगीत में होने वाले परिवर्तनों पर प्रतिक्रिया देने वाली डायनामिक प्रोसेसिंग के साथ जोड़ता है, जिससे लगातार मैनुअल समायोजन की आवश्यकता के बिना एक बेहतर सुनने का अनुभव बनता है।

### सुनने में सुधार मार्गदर्शिका
- कठोर वोकल्स को काबू में करें:
  - 3000Hz पर peak filter का उपयोग करें, उच्च Ratio (4.0-10.0) के साथ
  - मध्यम Threshold (-24dB) और तेज़ Attack (10ms) सेट करें
  - जब वोकल्स बहुत आक्रामक हो जाएँ, तो ही यह स्वतः कठोरता को कम करता है
- स्पष्टता और चमक बढ़ाएँ:
  - Band 5 को Filter Type: Highshelf, Frequency: लगभग 10000Hz, SC Freq: लगभग 1200Hz, Ratio: 0.5, Attack: 1ms के साथ उपयोग करें
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
- रीयल-टाइम frequency response graph
- मौजूदा boosts और cuts दिखाने वाला dynamic response curve
- इंटरैक्टिव frequency और gain controls
- Graph पर माउस घुमाएं, या टच करके ड्रैग करें, ताकि उस बिंदु के values पढ़े जा सकें।

## 5Band FIR PEQ

5Band FIR PEQ, 5Band PEQ जैसी परिचित पाँच-band controls को बनाए रखते हुए सभी bands की संयुक्त response को एक FIR filter के रूप में बनाता है। इसका उपयोग playback की सटीक correction, बहुत narrow cuts या तीखे shelf transitions के लिए करें, जब आप recursive filters की stability limits से बचना चाहते हों। Minimum Phase processing delay कम रखता है, जबकि Linear Phase सभी frequencies को एक समान निश्चित समय से delay करता है। इसके लिए WASM DSP engine आवश्यक है; उसके बिना signal बिना बदलाव के गुजरता है।

### ध्वनि सुधार गाइड

- **Minimum Phase**, 32768 Taps और 128 samples की Latency से शुरू करें। सामान्य bass, midrange और treble adjustment के लिए लगभग 0.7 से 2 तक के broad Q values उपयोग करें।
- Measurement में दिखी narrow peak को घटाने के लिए Peaking चुनें, center frequency को peak पर रखें और Q को धीरे-धीरे बढ़ाएँ। 10 से अधिक values सटीक correction के लिए हैं; बहुत narrow response को अधिक Taps चाहिए हो सकते हैं, इसलिए status देखें।
- Bass balance के लिए Low Shelf और treble balance के लिए High Shelf उपयोग करें। रोज़मर्रा की listening में 1 से 3 dB के छोटे बदलावों से शुरू करें।
- अनचाहे frequency extremes हटाने के लिए LowPass या HighPass उपयोग करें। Slope को 12 या 24 dB/oct से शुरू करें और अधिक तीखा cutoff चाहिए तभी बढ़ाएँ।
- जब पूरे spectrum में स्थिर phase delay महत्वपूर्ण हो और अतिरिक्त latency स्वीकार्य हो, तो **Linear Phase** चुनें। खासकर तीखी settings में transient से पहले energy आ सकती है, इसलिए तेज़ attacks वाली music पर Minimum Phase से भी तुलना करें।
- FIR design feedback poles से होने वाली instability से बचता है, लेकिन अधिक boost या बहुत ऊँचा Q फिर भी लंबी और अधिक selective impulse response बनाता है। अलग-थलग resonance के लिए boost की जगह cut को प्राथमिकता दें और playback के लिए पर्याप्त headroom रखें।

### पैरामीटर

- **Phase**
  - **Minimum Phase** - Causal minimum-phase response बनाता है और FIR की आधी लंबाई के बराबर delay नहीं जोड़ता। चुनी हुई Latency फिर भी लागू होती है।
  - **Linear Phase** - Symmetric linear-phase response बनाता है और चुनी हुई Latency के अतिरिक्त `Taps / 2` samples का FIR delay जोड़ता है।
- **Taps** - FIR length: 8192, 16384, 32768, 65536 या 131072। अधिक taps low frequencies और बहुत ऊँचे Q की accuracy सुधारते हैं, लेकिन memory use, design time और Linear Phase delay भी बढ़ाते हैं।
- **Latency** - Convolution engine की head latency: 0, 128, 256, 512 या 1024 samples। कम values delay घटाती हैं, लेकिन अधिक processing चाहती हैं।
- **पाँच adjustable bands** - Default center frequencies 100 Hz, 316 Hz, 1 kHz, 3.16 kHz और 10 kHz हैं। हर band को अलग से Enable किया जा सकता है।
- **Type** - Peaking, LowPass, HighPass, Low Shelf, High Shelf, BandPass या Notch चुनता है। FIR filter design होने से पहले सभी enabled bands को combine किया जाता है।
- **Freq** - Band frequency को 20 Hz से 20 kHz तक set करता है।
- **Gain** - Peaking, Low Shelf और High Shelf के लिए -20 से +20 dB तक boost या cut set करता है। LowPass, HighPass, BandPass और Notch Gain का उपयोग नहीं करते।
- **Q** - Response width को 0.1 से 100 तक set करता है। बड़ी values बदलाव को narrow और छोटी values broad बनाती हैं। Slider logarithmic scale का उपयोग करता है।
- **Slope** - LowPass या HighPass की cutoff rate को 0.1 से 384 dB/oct तक set करता है। Slider logarithmic scale का उपयोग करता है और यह control केवल इन दो Type values के लिए उपलब्ध है।

### दृश्य प्रदर्शन

- धूसर curve मौजूदा band settings से बनी संयुक्त «लक्ष्य» response दिखाती है।
- हरी curve designed FIR की वास्तविक magnitude response दिखाती है। दोनों curves के बीच दिखाई देने वाला अंतर बताता है कि चुने गए Taps target को ठीक से reproduce नहीं कर पा रहे हैं।
- Numbered markers पाँच bands से मेल खाते हैं। Freq बदलने के लिए horizontal और Gain बदलने के लिए vertical drag करें; disabled bands धुंधली दिखती हैं।
- Status line बताती है कि FIR design, prepare या use हो रहा है और total processing latency को samples तथा milliseconds में दिखाती है।
- यदि चुने हुए Taps किसी extreme response को सटीक रूप से reproduce नहीं कर सकते, तो status Taps बढ़ाने या Q अथवा Slope घटाने की सलाह देता है।
- Graph पर माउस घुमाएं, या टच करके ड्रैग करें, ताकि उस बिंदु के values पढ़े जा सकें।

## 5Band PEQ

music playback shape करने के लिए flexible 5-band equalizer। bass boomy लगे, vocals harsh लगें, या highs में थोड़ी sparkle चाहिए लेकिन detailed 15-band version खोलना न चाहें, तब उपयोगी है।

### ध्वनि सुधार गाइड
- वोकल और वाद्य यंत्रों की स्पष्टता:
  - natural presence के लिए 3.16kHz band को moderate Q (1.0-2.0) के साथ इस्तेमाल करें
  - narrow Q (4.0-8.0) cuts केवल तब लगाएं जब कोई specific resonance परेशान कर रहा हो
  - 10kHz high shelf के साथ हल्की हवा जोड़ें (+2 से +4dB)
- बास गुणवत्ता नियंत्रण:
  - 100Hz peaking filter से bass की भरपूरता को आकार दें
  - कोई bass note या room boom बहुत उभर रहा हो तो narrow cut इस्तेमाल करें
  - low shelf के साथ स्मूथ बास एक्सटेंशन बनाएं
- रोज़मर्रा की ध्वनि ट्यूनिंग:
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
- Graph पर माउस घुमाएं, या टच करके ड्रैग करें, ताकि उस बिंदु के values पढ़े जा सकें।

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
- Graph पर माउस घुमाएं, या टच करके ड्रैग करें, ताकि उस बिंदु के values पढ़े जा सकें।

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
- Graph पर माउस घुमाएं, या टच करके ड्रैग करें, ताकि उस बिंदु के values पढ़े जा सकें।

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

### सिस्टम प्रीसेट

स्रोत और केबल के अलग-अलग संयोजनों की पूरी सेटिंग की तुलना करने के लिए इफ़ेक्ट के शीर्षक में **इफ़ेक्ट प्रीसेट** पर क्लिक करें।

- **High Impedance Source** - अधिक आउटपुट इम्पीडेंस वाला स्रोत, जो कम इम्पीडेंस के ईयरफ़ोन को चलाता है।
- **Long Thin Cable** - केबल का अधिक रेज़िस्टेंस और इंडक्टेंस।
- **Vintage Portable Out** - अधिक इम्पीडेंस वाला पोर्टेबल आउटपुट और 32 Ω का ईयरफ़ोन।

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
- Graph पर माउस घुमाएं, या टच करके ड्रैग करें, ताकि उस बिंदु के values पढ़े जा सकें।

## Group Delay EQ

Group Delay EQ सामान्य equalizer का समकक्ष है: यह हर band का स्तर नहीं, बल्कि यह बदलता है कि हर band **कब** पहुँचती है। पंद्रह sliders हर frequency range की delay तय करते हैं और plugin एक FIR filter बनाता है जिसे इन delays को सपाट magnitude response के साथ साकार करने के लिए design किया गया है। सपाट response design का लक्ष्य है, गारंटी नहीं: सीमित Taps आदर्श लक्ष्य का approximation करते हैं, और बहुत बड़ी या bands के बीच तेजी से बदलने वाली delay settings मापी जा सकने वाली magnitude ripple पैदा कर सकती हैं। इसका उपयोग speaker या crossover की timing त्रुटियों की भरपाई के लिए करें, या यह जाँचने के लिए कि आपके सिस्टम पर phase distortion वास्तव में कितनी सुनाई देती है। इसके लिए WASM DSP engine आवश्यक है; उसके बिना signal बिना बदलाव के गुजरता है।

ध्वनि पर केवल bands के बीच का अंतर असर डालता है। सभी bands को समान रूप से delay करना केवल एक साधारण delay है, इसलिए plugin एक निश्चित आंतरिक delay रखता है और आपको हर band को उसके आगे-पीछे खिसकाने देता है। जब तक सभी sliders 0 ms पर हैं, plugin पूरी तरह पारदर्शी है और कोई latency नहीं जोड़ता।

### ध्वनि सुधार गाइड

- **Speaker और subwoofer की timing**: यदि bass बाकी संगीत से देर से पहुँचता है, तो crossover के ऊपर की bands को उतनी ही मात्रा में delay करें जब तक graph उस हिस्से में सपाट न हो जाए। सामान्य सुधार 2 से 10 ms के होते हैं और kick drum तथा bass पर सबसे आसानी से पहचाने जाते हैं।
- **Ported speakers और room modes**: Port वाला cabinet अपनी tuning frequency के आसपास group delay बढ़ाता है। प्रभावित low band को घटाएं, या बाकी सभी को बढ़ाएं, ताकि curve अधिक सपाट हो जाए। 50 Hz से नीचे थोड़ा अंतर बचा रहना सामान्य है।
- **Phase distortion का श्रवण परीक्षण**: एक band को +10 ms पर रखें, effect बंद होने से तुलना करें, फिर मान तब तक घटाएं जब तक अंतर सुनाई देना बंद न हो जाए। इस परिणाम को केवल phase की तुलना तभी मानें जब status line में Ripple पर्याप्त रूप से छोटी हो और हरी Realized curve धूसर Target curve के बहुत पास हो। अन्यथा magnitude में बदलाव या delay का ठीक से साकार न होना भी आपकी सुनाई देने वाली चीज़ों को प्रभावित कर सकता है।
- **एक-एक band पर काम करें**: एक बार में एक slider बदलें और सुनें। केवल phase के बदलाव अधिकांश संगीत में सूक्ष्म होते हैं और मुख्यतः drums, plucked strings और piano के attack जैसे transients पर दिखते हैं।
- **दोनों curves देखें**: यदि हरी curve धूसर curve का अनुसरण करना छोड़ दे, तो वर्तमान Taps से वह आकार नहीं बन सकता। Taps बढ़ाएं या पड़ोसी bands के बीच अंतर घटाएं।

### पैरामीटर

- **Taps** - FIR की लंबाई: 4096, 8192, 16384 या 32768। कम frequencies को लंबा filter चाहिए: 96 kHz पर 16384 taps लगभग 60 Hz तक बड़े delay अंतर भी बनाए रखते हैं, जबकि छोटी settings में सबसे पहले bass की सटीकता घटती है। Taps यह भी तय करता है कि filter कितनी delay संभाल सकता है, यानी sliders की सीमा भी। अधिक taps का अर्थ अधिक latency और अधिक processing भी है।
- **Latency** - Convolution engine की आरंभिक latency: 0, 128, 256, 512 या 1024 samples। कम मान delay घटाते हैं पर processing बढ़ाते हैं।
- **Band sliders (25 Hz से 16 kHz)** - पंद्रह sliders हर band की group delay तय करते हैं। धनात्मक मान उस range को बाद में पहुँचाते हैं, ऋणात्मक पहले। सीमा उतनी ही है जितनी delay filter संभाल सकता है: 96 kHz पर 4096 taps के साथ ±18.6 ms और 32768 taps के साथ ±149.3 ms। सबसे ऊँची band इन मानों को पूरी तरह साकार करती है, जबकि नीची bands को बड़ी setting का अनुसरण करने के लिए अधिक taps चाहिए; कहाँ तक पहुँचा, यह graph दिखाता है। मान frequency के साथ सहजता से interpolate होते हैं, इसलिए पड़ोसी bands हमेशा एक-दूसरे में मिल जाती हैं।
- **Phase angle** - हर millisecond मान के नीचे slider उसी delay को उस band की केंद्र frequency पर phase के घुमाव के रूप में दिखाता है। एक पूरे चक्कर से आगे इसे «पूरे cycles + शेष कोण» में बाँटकर दिखाया जाता है, इसलिए `+2c180°` का अर्थ है दो पूरे cycles और आधा चक्कर।
- **Reset** - किसी slider पर double-click करने से वह band 0 ms पर लौट आती है। Graph का Reset बटन सभी bands को एक साथ रीसेट करता है।

कुल latency, Latency की setting और Taps के आधे का योग है। sliders हिलाने पर यह नहीं बदलती, इसलिए पूरी chain की delay केवल Taps या Latency बदलने पर बदलती है।

### प्रदर्शन

- धूसर curve लक्ष्य है: माँगी गई delay, जो 20 Hz से 20 kHz के logarithmic frequency axis पर interpolate करके दिखाई जाती है। Delay axis वर्तमान settings के अनुसार अपने आप scale होती है, न्यूनतम ±5 ms।
- हरी curve वह है जो design किया गया filter वास्तव में करता है। जहाँ दोनों curves मिलती हैं वहाँ setting पूरी तरह साकार है; जहाँ अलग होती हैं वहाँ filter वर्तमान Taps के साथ अनुरोध का पालन नहीं कर पाता।
- Status पंक्ति कुल latency को samples और milliseconds में तथा filter की magnitude ripple दिखाती है। Ripple बताती है कि साकार हुई magnitude response सपाट design लक्ष्य से कितनी अलग है: मान जितना छोटा होगा, response लक्ष्य के उतना ही करीब होगा, और 0.3 dB सटीकता की चेतावनी का threshold है।
- Graph पर माउस घुमाएं, या टच करके ड्रैग करें, ताकि उस बिंदु के values पढ़े जा सकें।

## Group Delay PEQ

Group Delay PEQ, Group Delay EQ का parametric रूप है। पंद्रह निश्चित sliders के बजाय यह पाँच स्वतंत्र रूप से रखी जाने वाली bands देता है, जिनमें से हर एक का अपना आकार, frequency, delay और Q होता है। सक्रिय bands को जोड़कर एक target delay curve बनती है, और plugin एक FIR filter बनाता है जिसे उस curve को सपाट magnitude response के साथ साकार करने के लिए design किया गया है। सपाट response design का लक्ष्य है, गारंटी नहीं: सीमित Taps आदर्श लक्ष्य का approximation करते हैं, और बड़ी delay या बहुत संकरे आकार मापी जा सकने वाली magnitude ripple पैदा कर सकते हैं। इसका उपयोग तब करें जब जिस timing त्रुटि को सुधारना है उसका आकार ज्ञात हो — crossover, ported enclosure, तीखा high-pass या resonance — क्योंकि तब एक या दो bands उस आकार को सीधे पुन: बना सकती हैं। इसके लिए WASM DSP engine आवश्यक है; उसके बिना signal बिना बदलाव के गुजरता है।

ध्वनि पर केवल frequencies के बीच का अंतर असर डालता है। सब कुछ समान रूप से delay करना केवल एक साधारण delay है, इसलिए plugin एक निश्चित आंतरिक delay रखता है और आपको हर क्षेत्र को उसके आगे-पीछे खिसकाने देता है। जब तक सभी सक्रिय bands 0 ms पर हैं, plugin पूरी तरह पारदर्शी है और कोई latency नहीं जोड़ता। चूँकि magnitude response नहीं बदलती, प्रभाव सूक्ष्म रहता है: यह tone नहीं बल्कि timing बदलता है और मुख्यतः drums, plucked strings और piano के attack जैसे transients पर दिखता है।

### ध्वनि सुधार गाइड

- **Filter GD से किसी ज्ञात filter की नकल करें**: दूसरे क्रम के analog section की group delay की उभार का आकार उसकी cutoff frequency और Q से तय होता है। इन दोनों मानों को Freq और Q में डालें और मापी गई उभार की ऊँचाई ऋणात्मक चिह्न के साथ Delay में रखें; band उसे रद्द कर देगी। Sealed subwoofer या LR2 sum के लिए एक band, चौथे क्रम का bass-reflex alignment या LR4 sum एक से दो bands में आ जाता है।
- **Shelves से पूरे क्षेत्र को align करें**: जब spectrum का एक हिस्सा किसी एक frequency के आसपास नहीं, बल्कि समग्र रूप से देर से पहुँचे, तो Q 2 से 4 के साथ Low Shelf या High Shelf उपयोग करें। इससे लगभग एक octave चौड़ा step बनता है, जिससे corner frequency के एक ओर की सारी सामग्री समान मात्रा में खिसकती है।
- **बाकी को Peak से ठीक करें**: Peak एक कोमल bell है जिसकी half-width parametric EQ की तरह Q का अनुसरण करती है। जिन बचे हुए उभारों को किसी एक filter आकार से नहीं समझाया जा सकता, उनके लिए इसका उपयोग करें।
- **उच्च frequency crossovers से अधिक अपेक्षा न रखें**: 3 kHz पर LR4 crossover का group delay peak केवल लगभग 0.2 ms होता है। इसका सुधार श्रव्यता की सीमा से नीचे है, इसलिए वहाँ लाभ बहुत कम है; निम्न frequencies की timing त्रुटियाँ कहीं अधिक महत्वपूर्ण हैं।
- **निम्न frequencies और ऊँचे Q के लिए लंबे filter चाहिए**: लगभग Q 8 जैसे ऊँचे Q के साथ किसी low-frequency resonance का सुधार 96 kHz पर 32768 taps माँगता है। दोनों curves देखें: यदि हरी curve धूसर curve का अनुसरण न कर सके, तो Taps बढ़ाएं या Q घटाएं।
- **एक-एक band पर काम करें**: एक बार में एक band बदलें और सुनें। केवल phase के बदलाव अधिकांश संगीत में सूक्ष्म होते हैं, और effect बंद करके तुलना करना अकेले graph देखने से अधिक बताता है।

### पैरामीटर

- **Type** - Band का delay आकार चुनता है। चारों types उन्हीं तीन मानों — Freq, Delay और Q — से तय होते हैं, और Delay हमेशा उस band की अपनी curve का चरम मान होता है।
  - **Peak** - Freq पर केंद्रित एक bell, जिसकी half-width Q से निकले bandwidth के बराबर होती है। यह कभी overshoot नहीं करती, इसलिए मुक्त आकार के सुधार और बचे हुए अंतर की touch-up के लिए स्वाभाविक विकल्प है।
  - **Low Shelf** - एक कोमल step जो Freq से नीचे Delay बनाए रखती है, Freq पर Delay का आधा मान देती है और उससे ऊपर शून्य तक गिरती है। Q संक्रमण की तीव्रता तय करता है: Q 1 पर यह first-order allpass की group delay संक्रमण से मेल खाता है, जबकि Q 2 से 4 लगभग एक octave चौड़ा व्यावहारिक step देता है, जो band-limited alignment में काम आता है।
  - **High Shelf** - Low Shelf का दर्पण प्रतिबिंब और उसका पूरक: समान Freq और Q वाले दोनों आकार जुड़कर स्थिर Delay बनाते हैं।
  - **Filter GD** - किसी एक analog filter stage (high-pass / crossover / resonance) की group delay के आकार को जैसा है वैसा जोड़ता या घटाता है। जिस filter को सुधारना है उसकी cutoff frequency और Q को Freq और Q में डालें, और मापी गई group delay curve की उभार की ऊँचाई Delay में डालें (रद्द करने के लिए ऋणात्मक मान)।
- **Freq** - Band frequency को 20 Hz से 20 kHz तक set करता है। लगभग 18 से 20 kHz के पास लक्ष्य सहजता से शून्य तक घटाया जाता है, इसलिए सीमा के पास रखी band का प्रभाव घट जाता है।
- **Delay** - उस band की अपनी curve के चरम मान को milliseconds में set करता है। धनात्मक मान उस क्षेत्र को बाद में पहुँचाते हैं, ऋणात्मक पहले। सीमा उतनी ही है जितनी delay filter संभाल सकता है: 96 kHz पर 4096 taps के साथ ±18.6 ms और 32768 taps के साथ ±149.3 ms। Taps या sample rate बदलने पर सहेजे गए मान नई सीमा तक clamp हो जाते हैं।
- **Q** - आकार की चौड़ाई या तीव्रता को 0.1 से 100 तक logarithmic slider पर set करता है और हर Type में उपयोग होता है। उपयोगी श्रेणियाँ अलग-अलग हैं: Low Shelf और High Shelf के लिए 0.25 से 16, Filter GD के लिए 0.1 से 10। व्यवहार में shelves Q 2 से 4 पर और Filter GD Q 0.5 से 8 पर उपयोग होते हैं — 0.5 first-order allpass या LR2 sum के, 0.7071 Butterworth या LR4 sum के, और 8 तीखे resonance के अनुरूप है। इन श्रेणियों से बाहर की settings भी स्वीकार्य हैं; जब मौजूदा Taps उन्हें साकार नहीं कर पाते तो status line यह बताती है।
- **Enabled** - पाँचों bands को अलग-अलग चालू या बंद करता है। बंद bands target curve में कुछ नहीं जोड़तीं और graph पर धुंधली दिखती हैं।
- **Taps** - FIR की लंबाई: 4096, 8192, 16384 या 32768। कम frequencies को लंबा filter चाहिए, और ऊँचे Q वाले आकारों को भी। Taps यह भी तय करता है कि filter कितनी delay संभाल सकता है, यानी Delay की सीमा भी। अधिक taps का अर्थ अधिक latency और अधिक processing भी है।
- **Latency** - Convolution engine की आरंभिक latency: 0, 128, 256, 512 या 1024 samples। कम मान delay घटाते हैं पर processing बढ़ाते हैं।

कुल latency, Latency की setting और Taps के आधे का योग है। bands बदलने पर यह नहीं बदलती, इसलिए पूरी chain की delay केवल Taps या Latency बदलने पर बदलती है।

### प्रदर्शन

- धूसर curve लक्ष्य है: सक्रिय bands के आकारों का योग, जो logarithmic frequency axis पर दिखाया जाता है। Delay axis वर्तमान settings के अनुसार अपने आप scale होती है, न्यूनतम ±5 ms।
- हरी curve वह है जो design किया गया filter वास्तव में करता है। जहाँ दोनों curves मिलती हैं वहाँ setting पूरी तरह साकार है; जहाँ अलग होती हैं वहाँ filter वर्तमान Taps के साथ अनुरोध का पालन नहीं कर पाता।
- Numbered markers पाँच bands से मेल खाते हैं। Freq बदलने के लिए horizontal और Delay बदलने के लिए vertical drag करें। Marker केवल Peak में curve पर बैठता है: shelf, Freq पर Delay का आधा मान देती है और Filter GD का चरम मान Freq से नीचे आता है — Q ऊँचा हो तो Freq के ठीक नीचे, और Q घटने के साथ उत्तरोत्तर और नीचे, यहाँ तक कि लगभग 0.577 या उससे कम Q पर चरम मान graph के निम्न-आवृत्ति सिरे पर आ जाता है।
- Status पंक्ति कुल latency को samples और milliseconds में तथा filter की magnitude ripple दिखाती है। Ripple बताती है कि साकार हुई magnitude response सपाट design लक्ष्य से कितनी अलग है: मान जितना छोटा होगा, response लक्ष्य के उतना ही करीब होगा, और 0.3 dB सटीकता की चेतावनी का threshold है।
- Graph पर माउस घुमाएं, या टच करके ड्रैग करें, ताकि उस बिंदु के values पढ़े जा सकें।

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
- Graph पर माउस घुमाएं, या टच करके ड्रैग करें, ताकि उस बिंदु के values पढ़े जा सकें।

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
  - दबी हुई, narrow-band ध्वनि के लिए आवृत्ति 1-3kHz के बीच रखें और तीव्र ढलान चुनें
  - नाटकीय filtering के लिए -48dB/oct या उससे अधिक तीव्र ढलान का उपयोग करें
  - vintage radio effect के लिए Hi Pass Filter के साथ मिलाकर निम्न आवृत्तियाँ भी हटाएं
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
- Graph पर माउस घुमाएं, या टच करके ड्रैग करें, ताकि उस बिंदु के values पढ़े जा सकें।

## Loudness Equalizer

यह विशेष इक्वलाइज़र वॉल्यूम समायोजन को आवृत्ति-संतुलन सुधार से जोड़ता है। Relative Volume के 0dB पर अनुमानित औसत श्रवण ध्वनि-दाब स्तर को Average SPL में सेट करें और सामान्य वॉल्यूम बदलावों के लिए Relative Volume का उपयोग करें। वॉल्यूम घटाने पर सुधार अपने-आप बढ़ता है और वॉल्यूम बढ़ाने पर घटता है।

### सुनने में सुधार के लिए मार्गदर्शन
- कम वॉल्यूम पर सुनना:
  - बास और ट्रेबल आवृत्तियों को बढ़ाता है
  - शांत स्तरों पर संगीत संतुलन बनाए रखता है
  - मानव श्रवण विशेषताओं की भरपाई करता है
- Average SPL सेटिंग:
  - इसे Relative Volume के 0dB पर अनुमानित औसत श्रवण ध्वनि-दाब स्तर पर सेट करें
  - यह हाथ से सेट किया जाने वाला संदर्भ मान है; प्लगइन SPL नहीं मापता
- Relative Volume समायोजन:
  - ऋणात्मक मान आउटपुट वॉल्यूम घटाते हैं और सुधार बढ़ाते हैं
  - धनात्मक मान आउटपुट वॉल्यूम बढ़ाते हैं और सुधार घटाते हैं
  - EQ सुधार की गणना `Average SPL + Relative Volume` से होती है और यह 60dB से 85dB की सुधार सीमा तक सीमित रहता है
- आवृत्ति संतुलन:
  - बास वृद्धि के लिए Low shelf (100-300Hz)
  - ट्रेबल वृद्धि के लिए High shelf (3-6kHz)
  - आवृत्ति श्रेणियों के बीच सहज संक्रमण

### सिस्टम प्रीसेट

लाउडनेस कम्पेन्सेशन की पूरी कर्व से शुरुआत करने के लिए इफ़ेक्ट के शीर्षक में **इफ़ेक्ट प्रीसेट** पर क्लिक करें।

- **Late Night Listening** - कम आवाज़ में सुनने के लिए अधिक कम्पेन्सेशन।
- **Quiet Background** - रोज़मर्रा के उपयोग के लिए मध्यम कम्पेन्सेशन कर्व।
- **Near Reference Level** - ऊँचे संदर्भ स्तर के आसपास न्यूनतम कम्पेन्सेशन।

### पैरामीटर
- **Average SPL** - Relative Volume के 0dB पर अनुमानित औसत श्रवण ध्वनि-दाब स्तर (60dB से 96dB)
  - इसे सुनने की जगह पर औसत ध्वनि-दाब स्तर के अनुसार हाथ से सेट करें
  - 85dB से अधिक मान ऊँचा संदर्भ स्तर सेट करने देते हैं; `Average SPL + Relative Volume` के 85dB से नीचे आने तक EQ सुधार बंद रहता है
- **Relative Volume** - Average SPL के सापेक्ष वॉल्यूम समायोजन (-30dB से +12dB)
  - 0dB: Average SPL के अनुरूप आउटपुट वॉल्यूम
  - ऋणात्मक मान: कम वॉल्यूम और अधिक लाउडनेस सुधार
  - धनात्मक मान: अधिक वॉल्यूम और कम लाउडनेस सुधार
  - इनपुट स्तर या EQ बूस्ट पहले से अधिक होने पर धनात्मक मान क्लिपिंग पैदा कर सकते हैं
- **निम्न आवृत्ति नियंत्रण**
  - Frequency: Bass enhancement center (100Hz से 300Hz)
  - Gain: Maximum bass boost (0dB से 15dB)
  - Q: Shape of bass enhancement (0.5 से 1.0)
- **उच्च आवृत्ति नियंत्रण**
  - Frequency: Treble enhancement center (3kHz से 6kHz)
  - Gain: Maximum treble boost (0dB से 15dB)
  - Q: Shape of treble enhancement (0.5 से 1.0)

### दृश्य प्रदर्शन
- रियल-टाइम EQ प्रतिक्रिया ग्राफ
- इंटरैक्टिव पैरामीटर नियंत्रण
- वॉल्यूम के अनुसार बदलने वाला सुधार वक्र; Relative Volume से होने वाला समान स्तर परिवर्तन ग्राफ में शामिल नहीं है
- सटीक संख्यात्मक रीडआउट
- Graph पर माउस घुमाएं, या टच करके ड्रैग करें, ताकि उस बिंदु के values पढ़े जा सकें।

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
  - उस range पर ध्यान केंद्रित करें जिसे आप सबसे स्पष्ट सुनना चाहते हैं

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
- Graph पर माउस घुमाएं, या टच करके ड्रैग करें, ताकि उस बिंदु के values पढ़े जा सकें।

## Room EQ

Room EQ, EffeTune में सेव की गई frequency-response measurements से FIR correction filters बनाता है। Default रूप से यह एक साझा filter design करता है और उसे plugin से route होने वाले हर channel पर लागू करता है; अलग-अलग channels को अलग सेव की गई measurement भी assign की जा सकती है, जबकि बाकी correction settings पूरे instance में साझा रहती हैं। Filter चुनी गई measurement के सभी points का औसत लेता है, curve को smooth करता है और चुनी गई frequency range में peaks और dips घटाता है। इसका उपयोग तब करें जब speakers और room के आपसी असर से आपकी listening position पर बार-बार दिखने वाले peaks या व्यापक tonal असंतुलन पैदा हो। Minimum-phase या linear-phase magnitude correction के अलावा, **Correction** mode direct sound (**Phase Correction**) और room reverberation (**Reverb Correction**) की मापी गई excess phase भी correct कर सकता है। Room EQ को WASM DSP engine चाहिए; यह उपलब्ध न हो तो signal बिना बदले pass होता है।

### ध्वनि सुधार गाइड

- **कई points पर measurement**: Speaker या channel group को अपनी listening seat के आसपास पास-पास की कई microphone positions से मापें, फिर वह सेव की गई measurement चुनें, ताकि correction किसी एक microphone position पर ज़रूरत से ज़्यादा निर्भर न हो।
- **शुरुआती settings**: **Phase: Minimum**, **Smoothing: 0.17 oct**, **Correction Low: 80 Hz**, **Correction High: 16000 Hz**, **Max Boost: 6 dB** और **Level Correction: 100%** से शुरू करें। Effect को on/off करके जाँचें कि tonal balance अधिक समान हुआ है और ध्वनि पतली या कर्कश नहीं लगती।
- **Dips को ज़्यादा boost न करें**: यदि filter संकरे acoustic cancellations को भरने की कोशिश करे, तो **Smoothing** बढ़ाएँ या **Max Boost** घटाएँ (0 dB पर automatic boosts बंद हो जाते हैं, जबकि peak cuts बने रहते हैं)।
- **Correction की strength**: 100% बहुत ज़्यादा लगे तो **Level Correction** घटाएँ (50% पर +6 dB का boost +3 dB और −8 dB का cut −4 dB हो जाता है)।
- **केवल भरोसेमंद range**: **Correction Low** और **Correction High** को उसी range में रखें जिसे आपका speaker और measurement microphone भरोसेमंद ढंग से reproduce करते हैं; उसके बाहर correction करने से परिणाम कम सटीक होता है।
- **Target shaping**: Room peaks नियंत्रित हो जाने के बाद, हल्की tonal पसंद के लिए **Additional EQ** (सीधे FIR filter में शामिल) का उपयोग करें, जैसे 100 Hz के आसपास चौड़ा +2 dB low shelf।
- **Excess-phase और reverb correction**: सबसे कम latency के लिए **Phase: Minimum**, और excess phase भी align करने के लिए **Phase: Correction** चुनें। शुरुआत **Reference Point: Consensus (all points)**, default **Direct Window** और **Phase Correction: 100%** से करें। **Low-frequency Phase Extension** तभी चालू करें जब **Phase Low** से नीचे भी excess-phase correction चाहिए, और listening positions के बीच bass timing कम consistent लगे तो इसे बंद कर दें। Listening area में low-frequency reverberation counteract करने के लिए **Reverb Max Freq: 250 Hz** रखते हुए **Reverb Correction** धीरे-धीरे बढ़ाएँ; **Reverb Max Freq** बढ़ाने पर परिणाम केवल मापी गई position के लिए optimization बन जाता है।
- **Manual delay**: Room EQ speaker-distance alignment नहीं निकालता। **Delay** instance के सभी channels पर लागू होता है; अलग channel groups को अलग manual delays चाहिए हों तो अलग Room EQ instances उपयोग करें।

> **दूसरे device पर measurement उपयोग करना**: Presets और URLs में measurement का नाम और ID सेव होते हैं, acoustic data नहीं। Measurement को दूसरे device पर ले जाने के लिए export से पहले फ्रीक्वेंसी रिस्पॉन्स मापन tool में **Measurement JSON export में impulse responses शामिल करें** चालू रखें (default रूप से चालू; इससे file दसियों megabytes बड़ी हो सकती है), फिर target device पर वह JSON file import करें। चुनी गई measurement न मिले तो Room EQ warning दिखाता है और signal को बिना correction pass करता है।

### पैरामीटर

- **Measurement** - साझा सेव की गई measurement चुनता है (नाम, points की संख्या, और impulse data होने पर `IR` दिखता है)। Measurements जोड़ने या edit करने के बाद **Refresh measurements** पर click करें।
- **Measurement ChN** - हर routed bus channel के लिए वैकल्पिक per-channel measurement override। साझा **Measurement** उपयोग करने के लिए इसे **(Shared)** पर छोड़ें।
- **Delay** (0 से 20 ms) - सभी routed channels पर लागू manual delay; यह दिखाई गई processing latency में शामिल नहीं होता।
- **Phase** - FIR का phase व्यवहार चुनता है:
  - **Minimum**: सबसे कम latency वाला minimum-phase magnitude correction।
  - **Linear**: Linear-phase magnitude correction (`Taps / 2` samples की delay जोड़ता है)।
  - **Correction**: Minimum-phase magnitude correction के साथ direct sound की excess-phase correction (**Direct Window** के भीतर **Phase Correction**) और वैकल्पिक रूप से room decay की correction (**Reverb Window** के भीतर **Reverb Correction**)। यह `Taps / 2` samples की delay जोड़ता है और impulse-response (`IR`) data माँगता है। **Phase Smoothing**, **Phase Low**, **Low-frequency Phase Extension**, **Phase Correction**, चारों Reverb settings और **Reference Point** केवल इसी mode में काम करते हैं; Minimum और Linear में ये disabled रहते हैं और अपने values बनाए रखते हैं।
- **Taps** (8192, 16384, 32768, 65536 या 131072) - FIR filter length। अधिक values low-frequency resolution सुधारती हैं, पर memory, design time और Linear/Correction modes में delay बढ़ाती हैं।
- **Latency** (0, 128, 256, 512 या 1024 samples) - Convolution head latency। कम values delay घटाती हैं, पर processing load बढ़ाती हैं।
- **Smoothing** (0.02 से 1.00 oct) - Magnitude correction के लिए Gaussian frequency smoothing। अधिक values व्यापक और अधिक conservative correction देती हैं; कम values response के बारीक बदलावों को follow करती हैं।
- **Phase Smoothing** (0.02 से 1.00 oct, या **Auto**) - Correction mode में direct-sound excess-phase correction के लिए Gaussian smoothing (**Auto** चालू होने पर यह **Smoothing** के अनुसार चलता है)।
- **Correction Low / Correction High** - Automatic correction की निचली और ऊपरी frequency boundaries।
- **Direct Window** (1 से 50 ms) - Direct-sound phase correction के लिए analyze किया जाने वाला onset के बाद का time window। लंबा window automatic **Phase Low** को नीचे लाता है, पर अधिक room reflections शामिल करता है।
- **Phase Low** (20 से 20000 Hz, या **Auto**) - Fixed-window direct-sound phase correction की निचली frequency limit (default: **Correction Low** और **Direct Window** में तीन cycles समाने वाली frequency में से जो अधिक हो, जैसे 6 ms पर 500 Hz)। **Low-frequency Phase Extension** चालू होने पर यह इसके बजाय वह बिंदु दिखाता है जहाँ fixed window की जगह लंबी low-frequency windows ले लेती हैं।
- **Low-frequency Phase Extension** (default off) - Frequency के अनुसार लगातार लंबी होती windows का उपयोग करके excess-phase correction को **Phase Low** से नीचे **Correction Low** की ओर बढ़ाता है।
- **Max Boost** (0 से 18 dB) - Smoothing से पहले automatic correction के boosts को सीमित करता है; cuts और **Additional EQ** के जानबूझकर दिए गए boosts सीमित नहीं होते।
- **Level Correction** (0% से 100%) - Automatic magnitude correction को dB में linearly scale करता है। 0% पर केवल automatic correction रुकता है; **Phase Correction**, **Additional EQ**, **Delay** और **Gain** सक्रिय रहते हैं।
- **Phase Correction** (0% से 100%) - Correction mode में direct-sound excess-phase correction को scale करता है, **Reverb Correction** से स्वतंत्र रूप से।
- **Reverb Correction** (0% से 100%; default 0%) - **Reverb Window** के भीतर **Reverb Max Freq** तक analyze की गई बाद की room reverberation की excess-phase correction को scale करता है। यह magnitude correction नहीं बदलता।
- **Reverb Window** (20 से 1000 ms) - **Reverb Correction** द्वारा analyze किया जाने वाला onset के बाद का time window। यदि यह **Direct Window** से लंबा न हो (या measurement बहुत छोटी हो), तो warning के साथ reverb correction छोड़ दिया जाता है, जबकि filter का बाकी हिस्सा सक्रिय रहता है।
- **Reverb Max Freq** (20 से 20000 Hz; default 250 Hz) - **Reverb Correction** की ऊपरी frequency limit, जो **Correction High** से ऊपर नहीं जाती (इसे लगभग 250 Hz पर रखने से correction उस low-frequency room decay पर केंद्रित रहता है जो पास-पास की seats पर एक जैसा व्यवहार करता है)।
- **Reverb Smoothing** (0.02 से 1.00 oct) - Reverb की excess-phase delay पर लागू Gaussian smoothing।
- **Reference Point** - Excess-phase analysis के लिए **Consensus (all points)** (सभी measurement points का reliability-weighted average) या कोई एक measurement point चुनता है। चुना गया point हटा दिया जाए तो यह Consensus पर लौट आता है।
- **Additional EQ (FIR में शामिल)** - Target को आकार देने वाले पाँच parametric bands (Peak, Low shelf, High shelf; 20 Hz–20 kHz, ±20 dB, Q 0.1–10, shelves के लिए 2 तक), जो सीधे FIR filter में बनते हैं। Linear mode में इनकी phase zero होती है, और Minimum तथा Correction modes में minimum-phase।
- **Gain** (-12 से +12 dB) - Output level trim।

### दृश्य प्रदर्शन

- **Graph**: **Frequency** (smoothed measurement हल्के धूसर में, automatic correction हल्के हरे में, Additional EQ सहित combined correction चमकीले हरे में, और estimated corrected response सफेद में; सफेद curve नई measurement नहीं, बल्कि calculated preview है), **Phase** (FIR से पहले और बाद −180° से +180°), **Min Group Delay**, **Excess Group Delay** और **Impulse** (FIR से पहले और बाद का normalized waveform) के बीच बदलें। Impulse, measured onset से 2 ms पहले से लेकर 5 ms, **Direct Window** और **Reverb Window** (केवल जब **Reverb Correction** 0% से अधिक हो, अधिकतम 50 ms) में से सबसे लंबे तक दिखाता है। Phase, group-delay और Impulse views में धूसर **Before** line correction से पहले का response है और हरी **After** line FIR के बाद का calculated result। दो सफेद dotted खड़ी lines **Correction Low** और **Correction High** दिखाती हैं।
- Frequency view में धूसर और सफेद curves को इस तरह खिसकाया जाता है कि पूरे (100%) automatic correction का target level 0 dB पर रहे; सफेद curve में बचे deviations **Max Boost** या 100% से कम **Level Correction** जैसी सीमाओं से, या **Additional EQ** की जानबूझकर की गई shaping से आते हैं।
- Phase, group-delay और Impulse views में measured onset हटाया जाता है, और corrected result से FIR की fixed delay हटाई जाती है। Group delay को 1 kHz पर दोबारा reference नहीं किया जाता, इसलिए वहाँ value का 0 ms होना ज़रूरी नहीं। **Min Group Delay** अपनी range अपने-आप scale करता है; **Excess Group Delay** −100 से +100 ms पर रहता है, जबकि readout इस range से बाहर के values भी दिखाता है। Impulse-response data न होने पर ये views unavailable message दिखाते हैं।
- **Graph Preview Ch**: एक से अधिक channel के लिए filters design होने पर दिखता है; यह चुनता है कि किस channel की curves दिखें, और audio को प्रभावित नहीं करता।
- **इंटरैक्टिव नियंत्रण**: Numbered markers को horizontally drag करने पर **Additional EQ** band की frequency और vertically drag करने पर उसका gain बदलता है (disabled bands धुंधले दिखते हैं), और किसी भी बिंदु के values पढ़ने के लिए graph पर hover करें या drag करें।
- Controls के नीचे status line कुल processing latency, FIR resolution, और filter की bypassed, staged, preparing, active या error अवस्था दिखाती है।

## Tilt EQ

Pivot frequency के आसपास shelving filters की मिलान वाली जोड़ी से पूरे frequency balance को झुकाता है: spectrum का एक हिस्सा ऊपर उठता है और दूसरा नीचे जाता है। इसका उपयोग एक ही control से व्यापक रूप से warmer या brighter adjustment के लिए करें, जैसे जब कोई recording या headphones लगातार बहुत bright या बहुत dull लगें।

### ध्वनि सुधार गाइड
- **Warmer**: छोटा negative **Slope** (जैसे -1 dB/oct) उपयोग करें, ताकि treble घटे और bass बढ़े; यह bright recordings या headphones के लिए उपयुक्त है।
- **Brighter**: छोटा positive **Slope** (जैसे +1 dB/oct) उपयोग करें, ताकि treble बढ़े और bass घटे; यह dull recordings या speakers के लिए उपयुक्त है।
- **बदलाव कहाँ से शुरू हो**: **Pivot Freq (Hz)** घटाने पर treble की ओर का बदलाव midrange तक फैलता है; बढ़ाने पर वह बदलाव सबसे ऊपरी octaves तक सीमित रहता है।

### पैरामीटर
- **Pivot Freq (Hz)** (20 Hz से ~20 kHz; default लगभग 1 kHz) - वह frequency जिसके आसपास balance झुकता है।
- **Slope** (-12 से +12 dB/oct; default 0) - Tilt की मात्रा और दिशा। Positive values ध्वनि को brighter, negative values warmer बनाती हैं, और 0 पर कोई बदलाव नहीं होता।

### दृश्य प्रदर्शन
- Graph परिणामी frequency response दिखाता है।
- **Reset** दोनों parameters को उनके defaults पर लौटाता है।
- Graph पर माउस घुमाएं, या टच करके ड्रैग करें, ताकि उस बिंदु के values पढ़े जा सकें।

## Tonal Balance EQ

यह चल रहे music का लंबी अवधि का tonal balance मापता है और उसे चुनी गई style की released music के typical spectral balance की ओर धीरे-धीरे ले जाता है। इसका उपयोग तब करें जब किसी playlist, album या stream के tracks लगातार बहुत dark, बहुत bright, boomy या पतले लगें, और आप हर track के लिए EQ हाथ से adjust किए बिना उन्हें अपने-आप एक जैसा करना चाहें। (यह recording का balance correct करता है, आपके speakers या room को नहीं; acoustic correction के लिए [Room EQ](#room-eq) का उपयोग करें।)

Plugin overall loudness को align करने के बाद मापे गए spectrum की target से तुलना करता है, ज़रूरत से ज़्यादा तेज़ regions को घटाता है, और एक ही make-up gain लगाता है, ताकि perceived loudness बदले बिना कमज़ोर regions उभरकर आएँ। यह silence और pauses को measurement से बाहर रखता है, और hiss तथा स्थिर, noise जैसे bands (लगातार बजते synth pad सहित) को ऊपर नहीं उठाता, ताकि खाली frequency सिरों को कृत्रिम रूप से boost न किया जाए। सभी channels को एक ही zero-latency correction मिलता है, इसलिए stereo image बनी रहती है।

### ध्वनि सुधार गाइड
- **Mixed playlists और streaming**: Defaults (**Target: All**, **Amount: 100%**, **Averaging Time: 30 s**) से शुरुआत करें। Measurement भरोसेमंद होने के साथ correction दसियों सेकंड में धीरे-धीरे बनता है, इसलिए bypass से तुलना करने से पहले music को लगभग 30 सेकंड चलने दें।
- **पूरे album के लिए एक स्थिर correction**: Album की शुरुआत में **Reset** पर click करें और **Averaging Time** को **∞** पर सेट करें, ताकि correction पूरे playback session का औसत ले और एक fixed curve पर स्थिर हो जाए।
- **Genre के अनुसार targets**: किसी खास style से मिलाने के लिए **Classical**, **Electronic**, **Pop** या **Rock** चुनें, या मिली-जुली listening के लिए **All**।
- **हल्की shaping**: व्यापक, सूक्ष्म tilts के लिए **Amount** घटाएँ (जैसे 50%), **Range** कम करें (जैसे 3 dB), या **Smoothing** बढ़ाएँ (जैसे 1 oct)।
- **अपना house curve**: Graph के नीचे के पाँच **Target Adjust** bands से target को अपनी पसंद के अनुसार झुकाएँ या आकार दें (जैसे 8 kHz पर +1.5 dB High shelf)। तब हर recording को आपके custom target की ओर उतना ही correct किया जाता है जितनी ज़रूरत है।
- **Fixed slope reference**: **Target: Tilt** चुनें; इसमें **Corner** से नीचे response flat रहता है और उसके बाद एक स्थिर **Slope** से गिरता है (−5 dB/oct typical commercial masters के करीब है; −3 dB/oct pink noise के बराबर है)।

Make-up gain loudness को बनाए रखता है, peak level को नहीं, इसलिए peaks बढ़ सकती हैं; अगर बाद के किसी stage में clipping हो, तो इस plugin के बाद level घटाएँ या limiter जोड़ें।

### पैरामीटर
- **Target** - लक्ष्य tonal balance: **All** (default; चारों styles का बराबर मिश्रण), **Classical**, **Electronic**, **Pop**, **Rock** या **Tilt** (fixed slope reference)।
- **Slope** (-18 से 0 dB/oct; default -6 dB/oct; केवल Tilt mode) - **Corner** से ऊपर roll-off की दर (-3 dB/oct = pink noise, ~-5 dB/oct = typical commercial releases)। हल्के slope अधिक treble माँगते हैं; default सामान्य music से थोड़ा dark balance माँगता है।
- **Corner** (20 से 1000 Hz; default 250 Hz; केवल Tilt mode) - वह frequency जिसके नीचे **Tilt** target flat रहता है। कम values अधिक deep bass माँगती हैं; अधिक values कम bass माँगती हैं।
- **Amount** (0% से 100%; default 100%) - कुल correction strength। 0% पर ध्वनि नहीं बदलती, पर measurement और graph चलते रहते हैं, और **Range**, **Smoothing**, **Low** व **High** disabled हो जाते हैं।
- **Range** (0 से 12 dB; default 6 dB) - किसी भी band में ऊपर या नीचे अनुमत अधिकतम gain adjustment। कम values बदलाव को हल्का रखती हैं (0 dB पर correction बंद हो जाता है); अधिक values target से दूर की recordings को भी उसके करीब ले आती हैं।
- **Smoothing** (0.1667 से 2 oct; default 0.5 oct) - Correction curve की बनावट की चौड़ाई (अधिक values चौड़े tilts देती हैं)।
- **Averaging Time** (0.1 s से ∞; default 30 s) - Measurement integration window। छोटे values (जैसे 0.5 से 1 s) गाने के भीतर के बदलावों को follow करते हैं, जैसे dark verse और bright chorus; लंबे values स्थिर correction देते हैं (**∞** पिछले **Reset** के बाद से लगातार औसत लेता है)।
- **Low** (20 से 200 Hz; default 20 Hz) / **High** (2000 से 20000 Hz; default 16000 Hz) - Active reshaping की निचली और ऊपरी frequency सीमाएँ (इनके बाहर correction स्थिर रहता है)। Deep bass को न छेड़ने के लिए **Low** बढ़ाएँ, या सबसे ऊपरी octave को न छेड़ने के लिए **High** घटाएँ।
- **Average SPL** (60 से 96 dB; default 83 dB) - अनुमानित listening level, जिससे तय होता है कि कौन-से धीमे frequency bands इतने सुनाई देते हैं कि उन्हें ऊपर उठाया जा सके; यह output level नहीं बदलता। कम values अधिक धीमे bands को inaudible मानती हैं, इसलिए वे ऊपर नहीं उठाए जाते; अधिक values उनमें से अधिक को audible मानती हैं।
- **Target Adjust** - Target curve को नया आकार देने वाले पाँच parametric bands (Peak, Low shelf, High shelf; 20 Hz–20 kHz, ±20 dB, Q 0.1–10, shelves के लिए 2 तक; default Q 0.7)। Positive gain उस region को अधिक माँगता है, negative gain कम।

**Target Adjust** केवल target बदलता है; हर recording अब भी **Amount** और **Range** के भीतर उसकी ओर correct की जाती है, इसलिए बड़े adjustment के लिए बड़ा **Range** चाहिए हो सकता है। पूरे target को एक ही मात्रा से ऊपर उठाने पर कुछ नहीं बदलता, क्योंकि तुलना से पहले overall levels align किए जाते हैं। संकरे peaks और dips smooth हो जाते हैं; संकरे सुधारों के लिए 5Band PEQ का उपयोग करें।

### दृश्य प्रदर्शन
- Horizontal axis लगभग 26 Hz से 18.6 kHz तक की frequency और vertical axis dB में level है, जो प्रति hertz दिखाया जाता है, इसलिए pink noise -3 dB/oct से गिरती line के रूप में दिखता है। Vertical range curves के अनुसार फैलती है और **Reset** या **Target** बदलने पर ±12 dB पर लौट आती है। **Low** से नीचे और **High** से ऊपर के regions धुंधले दिखते हैं।
- **Target**, **Target Adjust** सहित लक्ष्य balance है। किसी style के लिए shaded band tracks के बीच का typical spread दिखाता है, जिसे एक music collection के long-term spectra से सीखा गया है; **Tilt** में यह band नहीं होता।
- **Measured** dots वाली line है: target के साथ align किया गया मापा हुआ long-term spectrum। जहाँ यह target band के नीचे हो, वहाँ recording सामान्य से कमज़ोर है; ऊपर हो, तो ज़्यादा तेज़। किसी frequency का preview करते समय measurement रुका रहता है।
- **EQ response** मोटी line है: make-up gain सहित लगाया गया gain (0 dB = कोई बदलाव नहीं)।
- **Withheld lift** shaded area है, जो मोटे तौर पर दिखाता है कि अगर band को noise जैसे या non-musical content के रूप में रोका न गया होता, तो उसे कितना अधिक lift मिलता।
- **Target adjust** 0 dB के आसपास numbered handles वाली पतली curve है, जो bands को वैसे ही दिखाती है जैसे आपने सेट किए हैं; handles **Target** line पर नहीं होते। Frequency और gain बदलने के लिए handle drag करें, Q बदलने के लिए उस पर माउस व्हील घुमाएँ, और band चालू या बंद करने के लिए उस पर राइट-क्लिक करें। Audio चलते समय **Target** line कुछ ही पल में handles के अनुसार बदल जाती है; रुके होने पर वह अपना आखिरी आकार बनाए रखती है।
- Band values, **Presence** (समय का वह % जिसमें band को musical content के रूप में पहचाना गया), **Make-up gain** और integrated **Loudness** (LKFS) देखने के लिए graph पर hover करें या drag करें। कोई audio मापे जाने से पहले graph पर "Play audio to start measuring" दिखता है।
- **Reset** जमा हुई measurement साफ़ करता है; **Target Adjust** नहीं बदलता। Power-saving pause के बाद processing फिर शुरू होने पर भी measurement नए सिरे से शुरू होती है।
- **Copy as PEQ** EQ response को 5Band PEQ settings के रूप में copy करता है। Effect Pipeline में **Ctrl+V** दबाकर इसे चुने गए effect से पहले (या कोई effect चुना न हो तो अंत में) जोड़ें, फिर correction को स्थिर रखने के लिए Tonal Balance EQ बंद करें। Copy **Low** और **High** के बीच curve का आकार दोहराता है, पर उसका overall level नहीं, इसलिए loudness थोड़ी अलग हो सकती है। यह तब उपलब्ध होता है जब graph पर EQ response दिख रहा हो और **Amount** 0% से अधिक हो।

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
- Graph पर माउस घुमाएं, या टच करके ड्रैग करें, ताकि उस बिंदु के values पढ़े जा सकें।
