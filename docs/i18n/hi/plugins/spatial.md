---
title: "स्पैशियल प्लगइन - क्रॉसफ़ीड, क्रॉसटॉक कैंसलेशन, स्टीरियो चौड़ाई और अपमिक्स - EffeTune"
description: "Crossfeed Filter, Crosstalk Cancellation, MS Matrix, Multiband Balance, Phase Select EQ, Spatial Mapper और Stereo Blend सहित spatial audio प्लगइन।"
lang: hi
---

# स्पैशियल ऑडियो प्लगइन

स्टीरियो (बायां और दायां) संतुलन को समायोजित करके आपके हेडफ़ोन या स्पीकर में संगीत कैसा सुनाई देता है, इसे बढ़ाने वाले प्लगइन का संग्रह। ये प्रभाव आपके संगीत को अधिक विस्तृत और प्राकृतिक बना सकते हैं, विशेष रूप से हेडफ़ोन के साथ सुनते समय।

## प्लगइन सूची

- [Crossfeed Filter](#crossfeed-filter) - प्राकृतिक स्टीरियो इमेज के लिए हेडफोन क्रॉसफीड फ़िल्टर
- [Crosstalk Cancellation](#crosstalk-cancellation) - कान के पास की माप से स्टीरियो स्पीकरों के बीच क्रॉसटॉक घटाता है
- [MS Matrix](#ms-matrix) - advanced stereo adjustment chains के लिए stereo को Mid/Side में और वापस stereo में बदलता है
- [Multiband Balance](#multiband-balance) - 5-बैंड आवृत्ति-आधारित स्टीरियो संतुलन नियंत्रण
- [Phase Select EQ](#phase-select-eq) - L/R phase difference और Balance से चुने गए frequency components को boost या cut करता है
- [Spatial Mapper](#spatial-mapper) - ध्वनि को Direct, Diffuse और Residual में अलग करके हर component को channels में route करता है
- [Stereo Blend](#stereo-blend) - polarity-swapped stereo से mono और enhanced stereo तक stereo width नियंत्रित करता है

## Crossfeed Filter

हेडफोन के लिए एक क्रॉसफीड फ़िल्टर जो स्पीकर के माध्यम से सुनते समय होने वाले प्राकृतिक ध्वनिक क्रॉसटॉक को सिमुलेट करता है। यह प्रभाव हेडफोन के साथ अक्सर अनुभव किए जाने वाले अतिरंजित स्टीरियो पृथक्करण को कम करने में मदद करता है, जिससे एक अधिक प्राकृतिक और आरामदायक सुनने का अनुभव बनता है जो वास्तविक ध्वनिक वातावरण में हमारे कानों तक ध्वनि पहुंचने के तरीके की नकल करता है।

### मुख्य विशेषताएं
- हेडफोन सुनने के लिए प्राकृतिक ध्वनिक क्रॉसटॉक को सिमुलेट करता है
- समायोज्य क्रॉसफीड स्तर और समय
- आवृत्ति-निर्भर क्रॉसटॉक की नकल के लिए लो-पास फ़िल्टरिंग
- केवल स्टीरियो प्रसंस्करण (mono या अन्य non-stereo signals के लिए स्वचालित रूप से bypass)

### सिस्टम प्रीसेट

हेडफ़ोन पर सुनने के लिए पूरी crossfeed मात्रा चुनने हेतु इफ़ेक्ट हेडर में **इफ़ेक्ट प्रीसेट** पर क्लिक करें।

- **Subtle Blend** - बहुत हल्का क्रॉसफीड, जो मूल चौड़ाई का अधिकांश भाग बनाए रखता है।
- **Vintage Receiver** - पारंपरिक हेडफ़ोन अडैप्टर जैसा मध्यम क्रॉसफीड।
- **Living Room Speakers** - बहुत चौड़े स्टीरियो विभाजन वाली रिकॉर्डिंग के लिए मजबूत स्पीकर-जैसा मिश्रण।

### पैरामीटर
- **Level** (-60 dB से 0 dB): क्रॉसफीड सिग्नल की मात्रा को नियंत्रित करता है
  - कम मान (-20 dB से -6 dB): सूक्ष्म और प्राकृतिक क्रॉसफीड
  - उच्च मान (-6 dB से 0 dB): अधिक स्पष्ट प्रभाव
- **Delay** (0 ms से 1 ms): ध्वनिक क्रॉसटॉक के समय अंतर को सिमुलेट करता है
  - कम मान (0.1-0.3 ms): अधिक तंग और केंद्रित छवि
  - उच्च मान (0.3-1.0 ms): अधिक विशाल स्पीकर जैसी प्रस्तुति
- **LPF Freq** (100 Hz से 20000 Hz): क्रॉसफीड की आवृत्ति प्रतिक्रिया को नियंत्रित करता है
  - कम मान (500-1000 Hz): अधिक प्राकृतिक आवृत्ति-निर्भर क्रॉसटॉक
  - उच्च मान (1000-20000 Hz): व्यापक आवृत्ति प्रतिक्रिया

### शुरुआती बिंदु

पूरी शुरुआती सेटिंग के लिए **Subtle Blend**, **Vintage Receiver** या **Living Room Speakers** system preset चुनें। फिर सबसे पहले Level समायोजित करें: कम मान अधिक stereo width बनाए रखते हैं, जबकि अधिक मान स्पीकर-जैसे मिश्रण को अधिक स्पष्ट बनाते हैं।

### अनुप्रयोग गाइड

1. हेडफोन अनुकूलन
   - रूढ़िवादी सेटिंग्स (-15 dB level, 0.3 ms delay) से शुरू करें
   - आराम और प्राकृतिकता के लिए स्तर समायोजित करें
   - स्थानिक धारणा के लिए देरी को सूक्ष्म रूप से समायोजित करें
   - आवृत्ति प्रतिक्रिया को नियंत्रित करने के लिए LPF का उपयोग करें

2. संगीत शैली विचार
   - क्लासिकल/जैज़: प्राकृतिक प्रस्तुति के लिए कम स्तर (-15 से -10 dB)
   - Rock/Pop: मध्यम levels (-12 से -8 dB) hard-panned guitars या vocals को नरम कर सकते हैं, जबकि music lively रहता है
   - Electronic या बहुत wide mixes: width बनाए रखने के लिए कम से मध्यम स्तर (-18 से -10 dB) इस्तेमाल करें; उच्च स्तर केवल तब जब excessive left-right separation को tame करना हो

3. सुनने का वातावरण
   - शांत वातावरण: सूक्ष्म प्रभाव के लिए कम स्तर
   - शोर वातावरण: बेहतर फोकस के लिए उच्च स्तर
   - लंबे सुनने के सत्र: थकान कम करने के लिए रूढ़िवादी सेटिंग्स

### त्वरित प्रारंभ गाइड

1. प्रारंभिक सेटअप
   - Level को -12 dB पर सेट करें
   - Delay को 0.3 ms पर सेट करें
   - LPF Freq को 700 Hz पर सेट करें

2. सूक्ष्म समायोजन
   - वांछित क्रॉसफीड मात्रा के लिए Level समायोजित करें
   - स्थानिक धारणा के लिए Delay संशोधित करें
   - आवृत्ति प्रतिक्रिया के लिए LPF Freq समायोजित करें

3. अनुकूलन
   - प्राकृतिक और आरामदायक प्रस्तुति के लिए सुनें
   - कृत्रिम लगने वाली अत्यधिक सेटिंग्स से बचें
   - विभिन्न संगीत शैलियों के साथ परीक्षण करें

याद रखें: Crossfeed Filter को हेडफोन सुनने को अधिक प्राकृतिक और आरामदायक बनाने के लिए डिज़ाइन किया गया है। रूढ़िवादी सेटिंग्स से शुरू करें और अपनी सुनने की प्राथमिकताओं और संगीत सामग्री के लिए इष्टतम संतुलन खोजने के लिए धीरे-धीरे समायोजित करें।

## Crosstalk Cancellation

Crosstalk Cancellation आपके कानों के पास मापी गई response का उपयोग करके हर stereo speaker की वह ध्वनि घटाता है जो दूसरे कान तक पहुँचती है। इसे दो stereo speakers के साथ, एक मापी गई listening position पर अधिक स्पष्ट, binaural-जैसी stereo image के लिए उपयोग करें। यह headphones या mono playback के लिए नहीं है।

[Crossfeed Filter](#crossfeed-filter) headphones के लिए speaker-जैसा थोड़ा crosstalk जोड़ता है; Crosstalk Cancellation speakers पर सुनते समय मापे गए crosstalk को घटाता है।

### मापें और असाइन करें

1. माइक्रोफ़ोन को बाएँ कान की स्थिति पर रखकर left और right speaker outputs के साथ मापें। उसका left channel **LL: L Speaker → Left Ear** और right channel **RL: R Speaker → Left Ear** को दें।
2. माइक्रोफ़ोन को दाएँ कान पर ले जाकर दोहराएँ: left channel **LR: L Speaker → Right Ear**, right channel **RR: R Speaker → Right Ear** को दें।
3. उसी speaker/listening setup में बनी single-point measurements लें और हर slot में अलग measurement channel दें, फिर filters के तैयार होने की प्रतीक्षा करें।

**Taps** 4096, **Regularization** 50%, **Max Gain** 12 dB, **Freq Low** 200 Hz, **Freq High** 6000 Hz, **Direct Window** 8 ms, **Strength** 70%, **Output Gain** 0 dB और **Latency** 128 samples से शुरू करें। मापी गई स्थिति पर बैठकर bypass से तुलना करें और छोटे बदलाव करें।

### पैरामीटर

- **Taps** (1024–16384): filter length। अधिक taps cancellation सुधार सकते हैं, पर processing और modeled delay बढ़ाते हैं; tail कटने की चेतावनी हो तो पहले इन्हें बढ़ाएँ।
- **Regularization** (0–100%): aggressive correction सीमित करता है। हल्के movement पर आवाज unstable/colored हो तो बढ़ाएँ; मापी गई जगह पर अधिक cancellation चाहिए तभी घटाएँ।
- **Max Gain** (0–24 dB): correction filter का boost limit। कम value नरम और headroom-सुरक्षित है; अधिक value cancellation बढ़ा सकती है पर कम robust होती है।
- **Freq Low** (20–2000 Hz) / **Freq High** (1000–20000 Hz): correction band; बाहर audio pass होता है। 200–6000 Hz से शुरू करें, सिर की movement के प्रति बहुत sensitive हो तो band संकरा करें।
- **Direct Window** (2–50 ms): मापे गए direct sound की अवधि। छोटा window reflections घटाता है पर effective low-frequency limit बढ़ा सकता है; लंबा window अधिक bass और room sound रखता है।
- **Strength** (0–100%): 0% delayed uncorrected sound से 100% full correction तक blend करता है। 70% से शुरू करें; position के बाहर कृत्रिम लगे तो घटाएँ।
- **Output Gain** (-24–+24 dB): final level। पहले 0 dB रखें, headroom के लिए जरूरत हो तो घटाएँ।
- **Latency** (0/128/256/512/1024 samples): processing-block delay। अधिक values processing आसान करती हैं, कम values monitoring delay घटाती हैं।

### स्थिति और लेटेंसी

स्थिति की शुरुआत **Assign all four measurements to begin.** से होती है। filters बनते समय यह design प्रगति पर होने की सूचना देती है; तैयार होने पर maximum filter gain दिखाती है। tail warning का अर्थ है कि **Taps** या **Regularization** बढ़ाने से मदद मिल सकती है। **Direct Window** द्वारा effective low frequency बढ़ाए जाने की चेतावनी का अर्थ है कि चुनी गई window इतनी छोटी है कि माँगी गई सबसे कम frequencies उपयोग नहीं हो सकतीं।

यदि कोई assigned measurement नहीं मिलता, तो उसे फिर से चुनें। यदि filters तैयार नहीं हो पाते, तो कम **Taps** या अधिक **Latency** आज़माएँ। जब तक चार उपयुक्त measurements assign न हों और filters तैयार न हों, plugin audio को बिना बदलाव के pass करता है और कोई अतिरिक्त processing latency नहीं बताता।

तैयार होने के बाद कुल अतिरिक्त latency चुनी गई **Latency** और filter की modeled delay का योग होती है; app अपना सामान्य pipeline delay compensation लागू करता है। real-time monitoring या audio/video synchronization मायने रखता हो तो **कुल विलंब** देखें। Crosstalk Cancellation में कोई graph या अन्य visualization नहीं है।

## MS Matrix

MS Matrix normal stereo audio को Mid/Side format में बदलता है, या Mid/Side audio को वापस normal stereo में बदलता है। जब effect chain के अंदर center और side information को अलग-अलग adjust करना हो, जैसे M/S में encode करना, Mid या Side level बदलना, फिर वापस stereo में decode करना, तब इसका उपयोग करें। normal music पर simple stereo width adjustment के लिए [Stereo Blend](#stereo-blend) अधिक सीधा tool है।

### मुख्य विशेषताएँ
- अलग Mid और Side gain (–18 dB से +18 dB)
- Mode स्विच: Encode (Stereo→M/S) या Decode (M/S→Stereo)  
- एन्कोडिंग से पहले या डिकोडिंग के बाद वैकल्पिक रूप से Left/Right स्वैप  

### पैरामीटर
- **Mode** (Encode/Decode): Encode left/right stereo को left channel में Mid और right channel में Side के रूप में output करता है। Decode left channel को Mid और right channel को Side मानकर normal stereo बनाता है।
- **Mid Gain** (–18 dB से +18 dB): selected conversion के दौरान Mid level समायोजित करता है
- **Side Gain** (–18 dB से +18 dB): selected conversion के दौरान Side level समायोजित करता है
- **Swap L/R** (Off/On): एन्कोडिंग से पहले या डिकोडिंग के बाद लेफ्ट और राइट चैनल स्वैप करता है  

### अनुशंसित सेटिंग्स
1. **Normal Stereo के लिए सूक्ष्म widening**
   - First MS Matrix: Mode: Encode, Mid Gain: 0 dB, Side Gain: +3 dB, Swap: Off
   - Second MS Matrix after it: Mode: Decode, Mid Gain: 0 dB, Side Gain: 0 dB, Swap: Off
   - प्रभाव: Side component को हल्का मजबूत करता है, फिर result को normal stereo में लौटाता है
2. **Normal Stereo के लिए center focus**
   - First MS Matrix: Mode: Encode, Mid Gain: +3 dB, Side Gain: -3 dB, Swap: Off
   - Second MS Matrix after it: Mode: Decode, Mid Gain: 0 dB, Side Gain: 0 dB, Swap: Off
   - प्रभाव: vocals और centered sounds को आगे लाता है और side ambience घटाता है
3. **Existing M/S Audio Decode करें**
   - Mode: Decode
   - Mid Gain: 0 dB
   - Side Gain: 0 dB
   - Swap: Off
   - केवल तब उपयोग करें जब incoming signal पहले से Mid/Side format में हो
4. **Creative Flip**
   - Mode: Encode  
   - Mid Gain: 0 dB  
   - Side Gain: 0 dB  
   - Swap: On  

### त्वरित प्रारंभ गाइड
1. तय करें कि आपको single conversion चाहिए या full Encode -> adjust -> Decode chain।
2. normal stereo listening के लिए, एक MS Matrix को Encode mode में रखें और उसके बाद दूसरा Decode mode में रखें।
3. Encode stage पर **Mid Gain** और **Side Gain** समायोजित करें।
4. **Swap L/R** केवल channel correction या creative inversion के लिए enable करें।
5. तुलना के लिए bypass करें और सुनें कि stereo image अभी भी natural लगती है।

## Multiband Balance

एक frequency-dependent balance processor जो audio को पांच bands में विभाजित करता है और हर band को थोड़ा left या right shift करने देता है। जब bass, vocals, cymbals या कोई frequency range एक तरफ खिंची हुई लगे और पूरे track को हिलाए बिना केवल उस हिस्से को rebalance करना हो, तब इसका उपयोग करें।

### मुख्य विशेषताएं
- 5-बैंड आवृत्ति-आधारित स्टीरियो संतुलन नियंत्रण
- उच्च-गुणवत्ता वाले Linkwitz-Riley क्रॉसओवर फिल्टर
- सटीक स्टीरियो समायोजन के लिए रैखिक संतुलन नियंत्रण
- बाएं और दाएं चैनल का स्वतंत्र प्रसंस्करण
- crossover filters reset होने पर स्वचालित fade handling

### पैरामीटर

#### क्रॉसओवर आवृत्तियां
- **Freq 1** (20-500 Hz): निम्न और निम्न-मध्य बैंड को अलग करता है
- **Freq 2** (100-2000 Hz): निम्न-मध्य और मध्य बैंड को अलग करता है
- **Freq 3** (500-8000 Hz): मध्य और उच्च-मध्य बैंड को अलग करता है
- **Freq 4** (1000-20000 Hz): उच्च-मध्य और उच्च बैंड को अलग करता है

#### बैंड नियंत्रण
प्रत्येक बैंड में स्वतंत्र संतुलन नियंत्रण होता है:
- **Band 1 Bal.** (-100% से +100%): निम्न आवृत्तियों का स्टीरियो संतुलन नियंत्रित करता है
- **Band 2 Bal.** (-100% से +100%): निम्न-मध्य आवृत्तियों का स्टीरियो संतुलन नियंत्रित करता है
- **Band 3 Bal.** (-100% से +100%): मध्य आवृत्तियों का स्टीरियो संतुलन नियंत्रित करता है
- **Band 4 Bal.** (-100% से +100%): उच्च-मध्य आवृत्तियों का स्टीरियो संतुलन नियंत्रित करता है
- **Band 5 Bal.** (-100% से +100%): उच्च आवृत्तियों का स्टीरियो संतुलन नियंत्रित करता है

### अनुशंसित सेटिंग्स

1. Treble का right pull सुधारें
   - निम्न बैंड (20-100 Hz): 0% (केंद्रित)
   - निम्न-मध्य (100-500 Hz): 0%
   - मध्य (500-2000 Hz): 0%
   - उच्च-मध्य (2000-8000 Hz): -10% से -25%
   - उच्च (8000+ Hz): -10% से -30%
   - प्रभाव: bright content को थोड़ा left ले जाता है, जबकि bass और vocals stable रहते हैं

2. Low-Mid का left pull सुधारें
   - निम्न बैंड: 0%
   - निम्न-मध्य: +10% से +25%
   - मध्य: +5% से +15%
   - उच्च-मध्य: 0%
   - उच्च: 0%
   - प्रभाव: warm body और lower vocals को पूरे stereo image को बदले बिना थोड़ा right ले जाता है

3. Air adjust करते समय bass centered रखें
   - निम्न बैंड: 0%
   - निम्न-मध्य: 0%
   - मध्य: 0%
   - उच्च-मध्य: +5% से +15%
   - उच्च: +10% से +20%
   - प्रभाव: low end centered रखते हुए upper ambience को हल्का right ले जाता है

### अनुप्रयोग गाइड

1. सुनने का संतुलन सुधार
   - स्थिर बास के लिए निम्न आवृत्तियों (100 Hz से नीचे) को केंद्रित रखें
   - केवल उस frequency range को shift करें जो off-center लगती है
   - पहले छोटे signed values इस्तेमाल करें (लगभग 5-20%)
   - tonal या level changes के लिए mono playback check करें

2. समस्या समाधान
   - ऐसी frequency ranges rebalance करें जो बहुत left या right लगती हैं
   - निम्न आवृत्तियों को केंद्रित करके अस्पष्ट बास को कसें
   - उच्च आवृत्तियों में कठोर स्टीरियो आर्टिफैक्ट्स को कम करें
   - ऐसी रिकॉर्डिंग सुधारें जिनमें ध्वनि के अलग-अलग हिस्से अलग-अलग तरफ झुके हों

3. रचनात्मक सुनने के प्रभाव
   - असामान्य frequency-dependent placement बनाएं
   - low frequencies को centered रखते हुए high frequencies को एक तरफ झुकाएं
   - upper bands में छोटे balance shifts करके अधिक चौड़ा महसूस होने वाला ambience बनाएं

4. स्टीरियो क्षेत्र समायोजन
   - प्रत्येक आवृत्ति बैंड के लिए स्टीरियो संतुलन का सूक्ष्म समायोजन
   - असमान स्टीरियो वितरण का सुधार
   - इसे stereo width control न मानें; पूरी image widen या narrow करनी हो तो Stereo Blend इस्तेमाल करें
   - मोनो संगतता बनाए रखें

### त्वरित प्रारंभ गाइड

1. प्रारंभिक सेटअप
   - सभी बैंड को केंद्र (0%) से शुरू करें
   - क्रॉसओवर आवृत्तियों को मानक बिंदुओं पर सेट करें:
     * Freq 1: 100 Hz
     * Freq 2: 500 Hz
     * Freq 3: 2000 Hz
     * Freq 4: 8000 Hz

2. बुनियादी वृद्धि
   - Band 1 (निम्न) को केंद्रित रखें
   - उच्च बैंड में छोटे समायोजन करें
   - स्थानिक छवि में परिवर्तनों को सुनें
   - मोनो संगतता की जांच करें

3. फाइन-ट्यूनिंग
   - अपनी सामग्री से मेल खाने के लिए क्रॉसओवर बिंदुओं को समायोजित करें
   - बैंड स्थितियों में क्रमिक परिवर्तन करें
   - अवांछित आर्टिफैक्ट्स के लिए सुनें
   - परिप्रेक्ष्य के लिए बायपास से तुलना करें

याद रखें: Multiband Balance एक शक्तिशाली उपकरण है जिसे सावधानीपूर्वक समायोजन की आवश्यकता होती है। सूक्ष्म सेटिंग्स से शुरू करें और आवश्यकतानुसार जटिलता बढ़ाएं। संगतता सुनिश्चित करने के लिए हमेशा अपने समायोजनों की जांच स्टीरियो और मोनो दोनों में करें।

## Phase Select EQ

Phase Select EQ उन stereo frequency components को boost या cut करता है जिन्हें **frequency**, **absolute left/right phase difference** और **left/right level balance**, तीनों से एक साथ चुना गया हो। यह दोनों channels पर एक ही positive gain multiplier लगाता है, इसलिए phase को घुमाए या बदले बिना केवल चुने गए spatial components का level बदलता है। जब सामान्य, केवल frequency पर आधारित EQ किसी centered vocal या instrument को उसी frequency band में मौजूद wide या hard-panned sounds से अलग न कर पाए, तब इसका उपयोग करें।

पाँच स्वतंत्र Bands उपलब्ध हैं। हर Band में भीतरी **Core** (जहाँ पूरा Gain लगता है) और बाहरी **Transition** (जहाँ multiplier धीरे-धीरे 100% की ओर लौटता है) होता है। overlap होने वाले Bands के gains गुणा होते हैं, इसलिए कई boosts signal को 0 dBFS से ऊपर ले जा सकते हैं; पर्याप्त headroom रखें और bypass से तुलना करें। Phase Select EQ FFT analysis की latency जोड़ता है (48 kHz पर 5,120 samples या लगभग 106.7 ms; 44.1 kHz पर लगभग 116.1 ms)। यह **कुल विलंब** में दिखाई देती है और real-time monitoring तथा audio/video synchronization को प्रभावित कर सकती है।

### सुनने में सुधार के लिए मार्गदर्शन

1. **चौड़े high frequencies की चुभन कम करें**: Band को लगभग 4–12 kHz और 90–180° Phase पर रखें, Gain 70–90% और transitions चौड़े करें। इससे centered detail वैसा ही रहता है और out-of-phase upper treble की कठोरता नरम होती है।
2. **centered vocals में presence जोड़ें**: Band को लगभग 1–4 kHz और 0–30° Phase (या −17% से +17% Balance) पर रखें, Gain 110–125% करें। इससे wide ambience को boost किए बिना center के पास का midrange आगे आता है।
3. **फैले हुए low-mid ambience को नियंत्रित करें**: Band को लगभग 150–600 Hz और 60–150° Phase पर रखें, Gain 80–90% करें। इससे centered bass और snare की body बनी रहती है और wide low-mid का धुंधलापन साफ होता है।
4. **hard-panned instrument को दबाएँ**: **Balance** view में −100% से −70% (left) या +70% से +100% (right) चुनें। Phase Core को 150–180° रखें ताकि -180° और +180° पर मौजूद एक-channel वाले points शामिल हों (यदि केवल Balance से चुनना हो तो 0–180°)। frequency range को instrument के आसपास सीमित करें और Gain 70–90% तक घटाएँ।

ये phase ranges सामान्य रुझान हैं, sources की तय positions नहीं। dots वास्तव में जहाँ दिखते हैं उसे देखते हुए छोटे बदलाव करें, और परिणाम headphones व speakers दोनों पर जाँचें।

### पैरामीटर

- **Band 1–5 / checkbox** (Off/On) - edit करने के लिए Band चुनता है और उसे on या off करता है।
- **Gain** (0% से 200%) - Core के भीतर level multiplier (100% = कोई बदलाव नहीं, 0% = mute, 200% = +6 dB)।
- **Solo** (Off/On) - केवल soloed Band(s) द्वारा चुने गए components सुनाता है; Solo on रहते हुए Gain अनदेखा होता है और soloed Bands के बाहर की हर चीज़ mute हो जाती है।
- **Core Low Freq / Core High Freq** (20 Hz से 40 kHz, sample rate द्वारा सीमित) - पूरी तरह processed frequency range।
- **Low Freq Trans / High Freq Trans** - Core के नीचे और ऊपर frequency fade की चौड़ाई।
- **Core Low Phase / Core High Phase** (0° से 180°) - पूरी तरह processed absolute L/R phase-difference range।
- **Low Phase Trans / High Phase Trans** - 0° और 180° की ओर phase fade की चौड़ाई।
- **Outer Low Bal / Core Low Bal / Core High Bal / Outer High Bal** (-100% से +100%) - left/right amplitude balance के लिए Core और बाहरी Transition की सीमाएँ।
- **Map पर handles**: Band के frame के अंदर drag करके उसे ले जाएँ, Core के edges/corners drag करके Core का आकार बदलें, या बाहरी dashed handles drag करके transitions समायोजित करें।

### Selection map को कैसे पढ़ें

- **ऊर्ध्वाधर अक्ष**: logarithmic frequency (नीचे low, ऊपर high)।
- **क्षैतिज अक्ष**: map के ऊपर **Phase** और **Balance** के बीच बदलें; किसी Phase या Balance control को edit करने पर view अपने-आप बदल जाता है।
  - **Phase**: बीच में 0° (in-phase); किनारों पर -180° और +180° एक ही opposite-phase बिंदु हैं। चयन absolute phase difference पर होता है, इसलिए frame 0° के दोनों ओर दर्पण की तरह दिखता है, 0° को छूने पर बीच में जुड़ जाता है, और 180° तक पहुँचने पर दोनों किनारों के पार जारी रहता है।
  - **Balance**: बीच में 50:50, बाएँ किनारे पर केवल left, दाएँ किनारे पर केवल right। Balance `(right amplitude - left amplitude) / (left amplitude + right amplitude) × 100%` है।
- **एक तरफ़ की ध्वनियाँ**: जो component केवल एक channel में हो, उसका Balance -100% या +100% होता है और Phase view में वह -180° (left) या +180° (right) पर दिखता है, इसलिए hard-panned sounds को किसी भी view से चुना जा सकता है।
- **Dots और frames**: सफ़ेद dots हाल के input components हैं (जितने चमकीले/बड़े, उतने प्रबल; छिपे अक्ष द्वारा अस्वीकृत dots धुंधले दिखते हैं)। भीतरी ठोस आयत हर enabled Band का **Core** और बाहरी dashed आयत उसका **Transition** दिखाते हैं; edit हो रहा Band highlight होता है, और हर Core के कोने पर लिखा नंबर Band की पहचान बताता है।
- **Badges**: हर Band नंबर के पास वाला badge छिपे अक्ष की range को outer low › Core low–high › outer high के रूप में दिखाता है, जैसे `P 20°›40°–80°›100°` या `B 100:0›80:20–70:30›0:100` (left:right अनुपात)। `P full` या `B full` का अर्थ है कि वह अक्ष सीमित नहीं है।
- **Readout**: map पर माउस घुमाएँ, या टच करके ड्रैग करें, ताकि उस बिंदु की frequency और phase difference या Balance पढ़ी जा सके।

Balance ग्रिड परिचित channel अनुपात इस्तेमाल करता है; संदर्भ के लिए L/R स्तर का अनुमानित अंतर दिखाया गया है:

| Balance | 0% | ±17% | ±33% | ±60% | ±82% | ±100% |
|---|---:|---:|---:|---:|---:|---:|
| प्रबल:कमज़ोर channel अनुपात | 50:50 | 59:41 | 67:33 | 80:20 | 91:9 | 100:0 |
| L/R level अंतर | 0 dB | ±3 dB | ±6 dB | ±12 dB | ±20 dB | केवल एक channel |

## Spatial Mapper

Spatial Mapper frequency bands में input channels के संबंध का विश्लेषण करता है, ध्वनि को लगातार Direct, Diffuse और Residual components में अलग करता है और हर component को मौजूदा channel bus में route करता है। इससे स्पष्ट ध्वनि को सामने रखा जा सकता है, ambience को surround या height channels में भेजा जा सकता है, center या ambience निकाला जा सकता है और stereo width बदली जा सकती है। डिफ़ॉल्ट **Transparent** preset मूल channel placement बनाए रखता है।

**Direct** में हर band की dominant coherent ध्वनि होती है। **Diffuse** में कम coherent और फैली हुई ध्वनि होती है। **Residual** वह सामग्री रखता है जो बाकी दोनों में पूरी तरह नहीं आती। विभाजन धीरे-धीरे होता है, इसलिए settings बदलते समय ध्वनि routes के बीच अचानक switch नहीं होती।

Frequency analysis के कारण Spatial Mapper कुछ latency जोड़ता है। EffeTune इसे **कुल विलंब** में शामिल करता है। Real-time monitoring और audio/video synchronization में इस मान को ध्यान में रखें।

### सिस्टम प्रीसेट

पूरी शुरुआती configuration चुनने के लिए इफ़ेक्ट हेडर में **इफ़ेक्ट प्रीसेट** पर क्लिक करें।

- **Transparent** - मूल channel placement बनाए रखता है और डिफ़ॉल्ट preset है।
- **Stereo Enhance** - स्पष्ट और diffuse ध्वनि की जगह बनाए रखते हुए Residual route से stereo input को चौड़ा करता है।
- **Center Extract** - Direct को channel 3 में भेजता है। कम से कम तीन channels वाला bus चाहिए।
- **5.1 Upmix** - Stereo को L, R, C, LFE, Ls, Rs क्रम में रखता है। LFE खाली रहता है और कम से कम छह bus channels चाहिए।
- **7.1.4 Upmix** - Stereo को L, R, C, LFE, Ls, Rs, Lb, Rb, Ltf, Rtf, Ltb, Rtb क्रम में रखता है। LFE खाली रहता है और कम से कम बारह bus channels चाहिए।
- **Ambience Extract** - Diffuse को रखता है और Direct तथा Residual को दबाता है।

### Routing Grid पढ़ना और बदलना

**Component Routing** में **Direct**, **Diffuse** या **Residual** tab चुनें। Columns analyzed input channels हैं और rows output bus channels हैं। हर cell में छोटे स्लाइडर या संख्या दर्ज करने के फ़ील्ड से linear gain को -1.00 से +1.00 तक 0.01 के चरणों में समायोजित करें: 0 connection हटाता है, +1.00 पूरे positive polarity स्तर पर भेजता है और negative value polarity उलटकर भेजती है। Negative values लाल दिखाई देती हैं। इनके बीच की values अनुपात में कम level देती हैं।

Route वाली output row उस bus channel को mapped result से बदल देती है। **Input Channels** की range में आने वाला output channel तब silent हो जाता है जब उसकी row में कोई component route न हो। इस range के बाहर के channels, जब उनमें कोई component नहीं लिखा जाता, समान delay के साथ pass through होते हैं।

### सुनने में सुधार के लिए मार्गदर्शन

1. **स्पष्ट ध्वनि को ज़्यादा हिलाए बिना stereo चौड़ा करें**
   - **Stereo Enhance** से शुरू करें।
   - widening route के लिए Residual में अधिक सामग्री रखनी हो, तभी **Directness** या **Diffuse Extraction** घटाएँ।
   - **Transparent** से तुलना करें; center images कमजोर हों या mono playback में बहुत सामग्री खो जाए तो बदलाव कम करें।
2. **stereo से center channel बनाएँ**
   - कम से कम तीन channels वाला bus इस्तेमाल करें और **Center Extract** चुनें।
   - अधिक coherent सामग्री को Direct में केंद्रित करने के लिए **Directness** और **Separation** बढ़ाएँ।
   - जाँचें कि vocals और अन्य centered सामग्री स्थिर रहे, जबकि wide ambience मुख्य रूप से left और right में रहे।
3. **stereo को surround या height channels तक फैलाएँ**
   - bus को ऊपर दिखाए channel क्रम पर सेट करें, फिर **5.1 Upmix** या **7.1.4 Upmix** चुनें।
   - surround और height routes तक कितनी फैली हुई सामग्री पहुँचे, यह **Diffuse Extraction** से नियंत्रित करें।
   - preset LFE signal नहीं बनाता; जरूरत हो तो bass management अलग से जोड़ें।
4. **ambience अलग करें**
   - **Ambience Extract** से शुरू करें।
   - अधिक मजबूत diffuse चयन के लिए **Diffuse Extraction** बढ़ाएँ, और **Phase Sensitivity** से तय करें कि channels का विपरीत phase Direct classification को कितना कम करे।

### पैरामीटर

- **Input Channels** (1 से 16): Bus की शुरुआत से analyze होने वाले channels की संख्या। Bus में कम channels हों तो उपलब्ध channels इस्तेमाल होते हैं।
- **Analysis Bands** (8, 16, 24, 32 या 48): Spatial analysis का frequency resolution। अधिक bands frequency के अनुसार placement को अधिक बारीकी से follow करते हैं, पर processing भी बढ़ती है। डिफ़ॉल्ट 24 है।
- **Directness** (0% से 100%): Direct को दी जाने वाली dominant coherent सामग्री की मात्रा। अधिक value Direct extraction को मजबूत करती है।
- **Separation** (0% से 100%): सामग्री को Direct और Diffuse में देने की selectivity। अधिक value अस्पष्ट सामग्री को Residual में छोड़कर routes का अंतर बढ़ाती है।
- **Diffuse Extraction** (0% से 100%): Diffuse को दी जाने वाली कम-coherence सामग्री की मात्रा। अधिक value अधिक फैली ambience को Diffuse route में भेजती है।
- **Phase Sensitivity** (0% से 100%): Channel phase opposition Direct classification को कितना कम करे। कम values opposite-polarity coherent सामग्री को अन्य coherent ध्वनि जैसा मानती हैं; अधिक values ऐसी सामग्री को Direct से बाहर रखती हैं। यह opposite-phase ध्वनि को अपने आप rear channels में नहीं भेजता।
- **Temporal Smoothing** (0% से 100%, Fast से Stable): Analysis और routing बदलावों को कितनी तेजी से follow करें। कम values जल्दी प्रतिक्रिया देती हैं; अधिक values image movement और pumping कम करती हैं, लेकिन धीमी प्रतिक्रिया देती हैं।
- **Energy Preservation** (Off/On): Routing matrices से अनचाहे level बदलाव रोकने के लिए Direct, Diffuse और Residual routes को अलग-अलग normalize करता है। Matrix gain से ही component level बदलना हो तो इसे Off करें।
- **Component Routing / Direct**: Direct grid चुनकर output gains सेट करता है।
- **Component Routing / Diffuse**: Diffuse grid चुनकर output gains सेट करता है।
- **Component Routing / Residual**: Residual grid चुनकर output gains सेट करता है।

## Stereo Blend

एक प्रभाव जो आपके संगीत की स्टीरियो चौड़ाई को समायोजित करके अधिक प्राकृतिक ध्वनि क्षेत्र प्राप्त करने में मदद करता है। यह विशेष रूप से हेडफ़ोन श्रवण के लिए उपयोगी है, जहां यह हेडफ़ोन के साथ अक्सर होने वाले अतिरंजित स्टीरियो अलगाव को कम कर सकता है, श्रवण अनुभव को अधिक प्राकृतिक और कम थकाऊ बनाता है। यह आवश्यकता पड़ने पर स्पीकर श्रवण के लिए स्टीरियो छवि को भी बढ़ा सकता है।

### श्रवण वृद्धि गाइड
- हेडफ़ोन अनुकूलन:
  - अधिक प्राकृतिक, स्पीकर जैसी प्रस्तुति के लिए स्टीरियो चौड़ाई कम करें (60-90%)
  - अत्यधिक स्टीरियो अलगाव से श्रवण थकान को कम करें
  - अधिक यथार्थवादी सामने-केंद्रित साउंडस्टेज बनाएं
- स्पीकर वृद्धि:
  - सटीक पुनरुत्पादन के लिए मूल स्टीरियो छवि बनाए रखें (100%)
  - आवश्यकता पड़ने पर चौड़े साउंडस्टेज के लिए सूक्ष्म वृद्धि (110-130%)
  - प्राकृतिक ध्वनि क्षेत्र बनाए रखने के लिए सावधान समायोजन
- ध्वनि क्षेत्र नियंत्रण:
  - प्राकृतिक, यथार्थवादी प्रस्तुति पर ध्यान केंद्रित करें
  - अत्यधिक चौड़ाई से बचें जो कृत्रिम लग सकती है
  - negative width केवल सुधार या रचनात्मक side-polarity inversion के लिए उपयोग करें
  - अपने विशिष्ट श्रवण वातावरण के लिए अनुकूलित करें

### पैरामीटर
- **Stereo** - स्टीरियो चौड़ाई को नियंत्रित करता है (-200% से 200%)
  - Negative values: reconstruction से पहले stereo side (L-R) component की polarity invert करते हैं
  - -200%: inverted side polarity के साथ maximum width; केवल correction या special cases के लिए उपयोग करें
  - -100%: left/right image swapped रखते हुए original stereo width
  - 0%: पूर्ण मोनो (बायां और दायां चैनल जोड़े गए)
  - 100%: मूल स्टीरियो छवि
  - 200%: maximum width enhancement; center component को बनाए रखते हुए stereo side difference को जोर से बढ़ाता है

### विभिन्न श्रवण परिदृश्यों के लिए अनुशंसित सेटिंग्स

1. हेडफ़ोन श्रवण (प्राकृतिक)
   - Stereo: 60-90%
   - प्रभाव: कम स्टीरियो अलगाव
   - इनके लिए बिल्कुल सही: लंबे श्रवण सत्र, थकान कम करना

2. स्पीकर श्रवण (संदर्भ)
   - Stereo: 100%
   - प्रभाव: मूल स्टीरियो छवि
   - इनके लिए बिल्कुल सही: सटीक पुनरुत्पादन

3. स्पीकर वृद्धि
   - Stereo: 110-130%
   - प्रभाव: सूक्ष्म चौड़ाई वृद्धि
   - इनके लिए बिल्कुल सही: करीबी स्पीकर स्थापना वाले कमरे

### संगीत शैली अनुकूलन गाइड

- शास्त्रीय संगीत
  - हेडफ़ोन: 70-80%
  - स्पीकर: 100%
  - लाभ: प्राकृतिक कॉन्सर्ट हॉल परिप्रेक्ष्य

- जैज़ और एकॉस्टिक
  - हेडफ़ोन: 80-90%
  - स्पीकर: 100-110%
  - लाभ: घनिष्ठ, यथार्थवादी समूह ध्वनि

- रॉक और पॉप
  - हेडफ़ोन: 85-95%
  - स्पीकर: 100-120%
  - लाभ: कृत्रिम चौड़ाई के बिना संतुलित प्रभाव

- इलेक्ट्रॉनिक संगीत
  - हेडफ़ोन: 90-100%
  - स्पीकर: 100-130%
  - लाभ: फोकस बनाए रखते हुए नियंत्रित विस्तार

### त्वरित प्रारंभ गाइड

1. अपना श्रवण सेटअप चुनें
   - पहचानें कि आप हेडफ़ोन या स्पीकर का उपयोग कर रहे हैं
   - यह आपके समायोजन के लिए प्रारंभिक बिंदु निर्धारित करता है

2. रूढ़िवादी सेटिंग्स से शुरू करें
   - हेडफ़ोन: 80% से शुरू करें
   - स्पीकर: 100% से शुरू करें
   - प्राकृतिक ध्वनि स्थापन के लिए सुनें

3. अपने संगीत के लिए फाइन-ट्यून करें
   - छोटे समायोजन करें (एक बार में 5-10%)
   - प्राकृतिक ध्वनि क्षेत्र प्राप्त करने पर ध्यान केंद्रित करें
   - श्रवण आराम पर ध्यान दें

याद रखें: लक्ष्य एक प्राकृतिक, आरामदायक श्रवण अनुभव प्राप्त करना है जो थकान को कम करता है और अभिप्रेत संगीत प्रस्तुति को बनाए रखता है। चरम सेटिंग्स से बचें जो शुरू में प्रभावशाली लग सकती हैं लेकिन समय के साथ थकाऊ हो जाती हैं।
