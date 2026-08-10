---
title: "Lo-Fi प्लगइन - EffeTune"
description: "AM Radio Simulator, Bit Crusher, Noise Blender, Vinyl Artifacts आदि सहित lo-fi effect प्लगइन।"
lang: hi
---

# Lo-Fi ऑडियो प्लगइन

आपके संगीत में विंटेज चरित्र और नॉस्टैल्जिक गुणों को जोड़ने वाले प्लगइन का संग्रह। ये प्रभाव आधुनिक डिजिटल संगीत को ऐसा बना सकते हैं जैसे वह क्लासिक उपकरणों के माध्यम से बज रहा हो या उसे वह लोकप्रिय "lo-fi" ध्वनि दे सकते हैं जो आरामदायक और वातावरणीय दोनों है।

## प्लगइन सूची

- [AM Radio Simulator](#am-radio-simulator) - संगीत को मॉडल की गई AM प्रसारण और रिसीवर शृंखला से गुजारता है
- [Bit Crusher](#bit-crusher) - रेट्रो गेमिंग और विंटेज डिजिटल ध्वनियां बनाता है
- [Cassette Artifacts](#cassette-artifacts) - संगीत को मॉडल की गई compact cassette पर रिकॉर्ड करके Type I/II/IV deck और Dolby B/C के साथ वापस चलाता है
- [Digital Error Emulator](#digital-error-emulator) - विभिन्न डिजिटल ऑडियो ट्रांसमिशन त्रुटियों का अनुकरण करता है
- [DSD64 IMD Simulator](#dsd64-imd-simulator) - DSD64 के अल्ट्रासोनिक शोर से उत्पन्न श्रव्य इंटरमॉड्यूलेशन डिस्टॉर्शन का अनुकरण करता है
- [FM Radio Simulator](#fm-radio-simulator) - संगीत को भौतिक रूप से सिम्युलेट की गई FM प्रसारण और रिसीवर श्रृंखला से गुज़ारता है
- [G.726 Simulator](#g726-simulator) - ITU-T G.726 speech codec encode/decode round trip का अनुकरण वैकल्पिक noisy radio link के साथ करता है
- [GSM-FR Simulator](#gsm-fr-simulator) - 13 kbit/s GSM-FR speech codec encode/decode round trip का अनुकरण radio link पर frame erasure concealment के साथ करता है
- [Hum Generator](#hum-generator) - विंटेज/lo-fi सुनने के लिए नियंत्रित विद्युत हम वातावरण जोड़ता है
- [MP3 Codec Simulator](#mp3-codec-simulator) - कम bitrate पर साफ़ MPEG Layer III encode/decode round trip का अनुकरण करता है
- [Noise Blender](#noise-blender) - वातावरणीय पृष्ठभूमि बनावट जोड़ता है
- [SBC Codec Simulator](#sbc-codec-simulator) - Bluetooth A2DP SBC का encode/decode round trip वैकल्पिक link packet loss और concealment के साथ पुनः बनाता है
- [Simple Jitter](#simple-jitter) - सूक्ष्म विंटेज डिजिटल अपूर्णताएं बनाता है
- [SW Radio Simulator](#sw-radio-simulator) - संगीत को मॉडल की गई शॉर्टवेव प्रसारण, आयनमंडलीय पथ और रिसीवर शृंखला से गुजारता है
- [Tape Artifacts](#tape-artifacts) - संगीत को मॉडल किए गए reel-to-reel टेप पर रिकॉर्ड करके वापस चलाता है
- [Vinyl Artifacts](#vinyl-artifacts) - विनाइल-शैली के पॉप, क्रैकल, हिस, रंबल और स्टेरियो शोर रिसाव जोड़ता है
- [Vinyl Simulator](#vinyl-simulator) - इनपुट को मॉडल किए गए groove में काटकर भौतिक stylus मॉडल से चलाता है

## AM Radio Simulator

AM Radio Simulator संगीत को मॉडल की गई AM प्रसारण शृंखला से रूपांतरित करता है: ट्रांसमीटर प्रोसेसिंग और मॉड्यूलेशन, धरातलीय व आयनमंडलीय तरंगों का प्रसार, वायुमंडलीय शोर और पास वाले चैनल का हस्तक्षेप, रिसीवर की ट्यूनिंग, डिटेक्शन और AGC, तथा वैकल्पिक रेडियो स्पीकर। इसका उपयोग तेज स्थानीय स्टेशन की तुलना रात में फीके पड़ते दूर के स्टेशन से करने, भीड़ भरे डायल को आजमाने, या संगीत में AM रिसेप्शन की सीमित बैंडविड्थ, विकृति, फेडिंग और हस्तक्षेप जोड़ने के लिए करें।

इस प्रभाव को ऐसा वातावरण चाहिए जो इसकी real-time processing को support करे। यह processing उपलब्ध न होने पर audio अपरिवर्तित रहता है और HUD बताता है कि प्रभाव उपलब्ध नहीं है।

### जोड़कर मिलाए जाने वाले lo-fi effects से अंतर

- **AM Radio Simulator** इनपुट को मॉड्यूलेट करके और उसे प्रसार, फिल्टरिंग व डिटेक्शन से गुजारकर सिग्नल को ही बदलता है। वायुमंडलीय शोर, हस्तक्षेप और हम रेडियो शृंखला के मॉडल किए गए चरणों में प्रवेश करते हैं, इसलिए वे Tuning, IF फिल्टर और AGC के साथ परस्पर प्रभाव डालते हैं।
- **Noise Blender** सामान्य पृष्ठभूमि शोर जोड़ता है, जबकि **Hum Generator** समायोज्य हम की परत जोड़ता है। जब ये ध्वनियां चाहिए लेकिन संगीत को रेडियो रिसीवर से नहीं गुजारना हो, तब इन्हें चुनें।
- **Vinyl Artifacts** मूल संगीत सिग्नल को बदले बिना रिकॉर्ड की सतही आवाजें जोड़ता है। **Vinyl Simulator** भी भौतिक मॉडल से सिग्नल बदलता है, लेकिन वह रेडियो प्रसारण के बजाय रिकॉर्ड groove और stylus को मॉडल करता है।

### ध्वनि सुधार गाइड

- **साफ स्थानीय प्रसारण:** Signal मजबूत रखें, Skywave और Static कम करें, Tuning को केंद्र में रखें और IF Bandwidth चौड़ा करें। भरपूर रेडियो-स्पीकर ध्वनि के लिए Table या लाइन आउटपुट के लिए Off चुनें।
- **रात का दूरस्थ स्टेशन:** Signal घटाएं, Skywave बढ़ाएं और Fading Speed मध्यम रखें। AGC Speed को Slow करने पर स्तर धीरे लौटता है, जबकि Static दूर की बिजली जैसी कभी-कभार छोटी आवाजें जोड़ता है।
- **भीड़ भरा डायल:** Interference बढ़ाएं और Interf. Offset को 9 या 10 kHz पर रखें। संकरा IF Bandwidth पास वाले स्टेशन को अधिक रोकता है; Tuning में छोटे बदलाव डिटेक्टर तक पहुंचने वाले हस्तक्षेप की मात्रा बदलते हैं।
- **प्रसारण ओवरलोड:** AM की विशिष्ट ओवरमॉड्यूलेशन और डायगोनल-क्लिपिंग विकृति सुनने के लिए Mod Depth को 100% से ऊपर करें या Detector RC बढ़ाएं। साफ रिसेप्शन के लिए इनमें से किसी एक को घटाएं।
- **Fading की गहराई:** नई instances में Skywave 1% रहता है, जिससे Mono में level का उतार-चढ़ाव शांत और रात वाला fade हल्का होता है। स्पष्ट रूप से गहरा fade चाहिए तो Skywave को करीब 8% करें; इससे ऊपर के मान प्रभाव को और तीखा बनाते हैं।
- रेडियो मॉडल का आकलन करते समय Mix को 100% से शुरू करें। मूल स्टीरियो छवि का कुछ भाग जानबूझकर रखना हो तभी इसे घटाएं।

### C-QUAM blend और Static मॉडल

C-QUAM में automatic stereo blend रिसीवर के दो परस्पर लंबवत axes पर मान्य signal loss को देखता है: decoded sum signal और quadrature difference signal के 25 Hz pilot क्षेत्र को। दोनों observations से AGC का प्रभाव हटाया जाता है, और quality तभी घटती है जब loss दोनों axes पर एक साथ आए। यह loss-coincidence नियम किसी एक axis पर सामान्य program बदलाव को RF fade समझने से बचाता है। Observation केवल तब चलता है जब PLL, TRACK में हो और pilot स्वीकार हो; अन्यथा quality observation साफ कर दिया जाता है।

नई instances के लिए Skywave का default 1% है, जिसे integrated model checks पास होने के बाद अपनाया गया। Saved presets में स्पष्ट रूप से store किया गया Skywave मान बना रहता है। 8% की तुलना में 1% पर Mono का level अधिक शांत तरीके से बदलता है और fade कम गहरा होता है; अधिक तीखे रात वाले fade के लिए करीब 8% चुनें।

Quality response की सत्यापित और frozen range Fading Speed 0.05 Hz से शुरू होती है। Adaptive reference के 60 s fall time से बहुत धीमे बदलने वाला attenuation उसी reference में समा जाता है और उसे जानबूझकर लगातार quality loss के रूप में बनाए नहीं रखा जाता। 0.75 dB program-residual allowance, 0.04 ratio offset, Q=4 pilot observation band, 0.05/0.2/0.5/60 s quality time constants, तथा 0.5 dB deadband और 5.0 dB transfer span सामान्य C-QUAM receiver specifications नहीं, बल्कि इस simulator की empirical calibration हैं।

यह receiver-faithful observation pilot वाले C-QUAM hardware के समान program-dependent ambiguity रखता है। यदि किसी program में 25 Hz के पास difference energy और asymmetric sum/DC दोनों हों और दोनों components एक साथ समाप्त हों, तो stereo blend थोड़ी देर के लिए घट सकता है, क्योंकि receiver को वही RF संकेत मिलते हैं जो fade में मिलते हैं। इसी तरह coherent anti-phase residual, PLL के TRACK में और pilot के accepted रहते हुए भी quality observation को घटा सकता है। ये approved model boundary के भीतर जानबूझकर रखे गए व्यवहार हैं, दोष नहीं।

Static events carrier-relative vector-area calibration का उपयोग करते हैं। हर event का area nominal desired carrier के सापेक्ष 20.0 µs से scale होता है, जिसमें empirical 0.5 से 1.5 uniform distribution और random phase लागू होते हैं। Events को rounded sample countdown की जगह double-precision absolute deadlines से schedule किया जाता है, इसलिए render blocks के बीच समय निरंतर रहता है और एक ही sample में due कई events जोड़ दिए जाते हैं। 20.0 µs scale और उसका distribution इस simulator की empirical calibration हैं।

### पैरामीटर

#### Station

- **Radio** (चालू या बंद) - स्टेशन का प्रसारण चालू या बंद करता है। बंद करने पर carrier पूरी तरह गायब हो जाता है और रिसीवर के पास केवल वायुमंडलीय शोर, पास वाला स्टेशन और उसका अपना शोर बचता है; AGC पूरा खुल जाता है और यही पृष्ठभूमि शोर तेज सुनाई देने लगता है। इससे किसी स्टेशन के प्रसारण शुरू करने या बंद होने का क्षण सुना जा सकता है। यह प्रभाव को बंद करने जैसा नहीं है — वहां संगीत ज्यों का त्यों निकल जाता है।
- **Stereo Mode** (Mono या C-QUAM) - Mono पारंपरिक envelope-detector receiver का उपयोग करता है। C-QUAM stereo reception देता है, लेकिन stereo में S/N mono से कम होता है और signal कमजोर या tuning से बाहर होने पर reception अपने आप mono की ओर blend होता है। Receiver की detection विधि भौतिक रूप से अलग होने के कारण mode बदलने पर ध्वनि का रंग भी बदल सकता है; Detector RC और उससे होने वाली diagonal clipping केवल Mono पर लागू होते हैं और C-QUAM में प्रभावहीन हैं। C-QUAM stereo 192 kHz तक की sample rates पर काम करता है; इससे अधिक rates पर reception mono हो जाता है। FCC के लिए simulation केवल C-QUAM c(5) की modulation-phase सीमा को model करता है, पूर्ण compliance test को नहीं।
- **TX Bandwidth** (2.0 से 10.0 kHz) - ट्रांसमीटर की ऑडियो बैंडविड्थ तय करता है। कम मान ध्वनि को गहरा और सीमित बनाते हैं; अधिक मान ज्यादा विवरण बचाते हैं।
- **Pre-emphasis** (0 से 100%) - प्रसारण से पहले ऊंची आवृत्तियां बढ़ाता है। अधिक सेटिंग उपस्थिति बढ़ाती है, लेकिन चमकीले peaks प्रसारण शृंखला को अधिक जोर से चलाते हैं।
- **Mod Depth** (10 से 125%) - AM मॉड्यूलेशन की गहराई तय करता है। 100% से ऊपर ओवरमॉड्यूलेशन और negative-peak clipping होता है।
- **Compression** (0 से 20 dB) - प्रसारण limiter की गहराई तय करता है। अधिक सेटिंग peaks को नियंत्रित करके मॉड्यूलेशन को अधिक समान बनाती है।

#### Path

- **Signal** (-50 से 0 dB) - प्राप्त सिग्नल की ताकत तय करता है। कमजोर सेटिंग रिसीवर का शोर अधिक उजागर करती है और अधिक AGC gain मांगती है।
- **Skywave** (0 से 100%) - स्थिर धरातलीय तरंग को देर से पहुंचने वाले आयनमंडलीय मार्गों के साथ मिलाता है। नई instances हल्की movement के लिए 1% से शुरू होती हैं; करीब 8% अधिक तीखा रात वाला fade देता है और उससे ऊपर के मान frequency-selective fading को और गहरा करते हैं।
- **Fading Speed** (0.05 से 2.0 Hz) - आयनमंडलीय प्रसार की स्थिति कितनी तेजी से बदलती है, यह तय करता है।
- **Static** (0 से 100/s) - बिजली जैसे static events की दर तय करता है। हर carrier-relative event absolute-time schedule पर चलता है और रिसेप्शन के बाद जोड़े जाने के बजाय IF फिल्टर से गुजरकर गूंजता है।
- **Interference** (-80 से 0 dB) - पास वाले स्टेशन की ताकत तय करता है। -80 dB पर यह बंद होता है; 0 dB के करीब जाने पर मजबूत होता है।
- **Interf. Offset** (5 से 10 kHz) - पास वाले स्टेशन की दूरी और उससे बनने वाली carrier beat आवृत्ति तय करता है। 9 और 10 kHz प्रचलित चैनल अंतर हैं।

#### Receiver

- **Tuning** (-30.0 से +30.0 kHz) - रिसीवर को इच्छित स्टेशन से हटाकर ट्यून करता है; धनात्मक मान स्टेशन से ऊँची और ऋणात्मक मान उससे नीची आवृत्ति पर ट्यून करते हैं। थोड़ा हटाने पर स्पष्टता घटती और असममित फ़िल्टरिंग की विकृति बढ़ती है; बहुत दूर करने पर स्टेशन की आवाज़ रिसीवर के शोर में दब जाती है। दिशा यह भी तय करती है कि रिसीवर Interf. Offset से निर्धारित ऊपरी आसन्न स्टेशन के पास जाता है या उससे दूर।
- **IF Bandwidth** (2.0 से 20.0 kHz) - रिसीवर के कुल IF passband की चौड़ाई तय करता है। संकरा मान अधिक शोर और हस्तक्षेप रोकता है, लेकिन treble भी अधिक घटाता है; चौड़ा मान ज्यादा विवरण रखता है।
- **AGC Speed** (Slow, Mid या Fast) - स्वचालित gain control सिग्नल बदलावों का कितनी तेजी से अनुसरण करे, यह तय करता है। Slow में स्तर की वापसी और pumping अधिक क्रमिक होती है; Fast तेज fades को ज्यादा कसकर नियंत्रित करता है।
- **Detector RC** (20 से 500 µs) - envelope detector का discharge time तय करता है। लंबा मान envelope को अधिक smooth करता है, लेकिन तेज मॉड्यूलेशन पर ऊंची आवृत्तियों में diagonal-clipping distortion बढ़ाता है।
- **Hum** (-80 से -20 dB) - power-supply hum तय करता है। -80 dB पर यह बंद होता है। जोड़ी गई हम परत से अलग, इसका अधिकांश प्रभाव detection से पहले receiver gain को मॉड्यूलेट करता है।
- **Hum Freq** (50 या 60 Hz) - मॉडल की गई बिजली आवृत्ति चुनता है।

#### Output

- **Speaker** (Off, Small या Table) - line output, सीमित pocket-radio speaker या अधिक भरपूर tabletop-radio response चुनता है।
- **Output Gain** (-24 से +24 dB) - receiver और speaker processing के बाद स्तर समायोजित करता है।
- **Mix** (0 से 100%) - मूल stereo signal को मॉडल किए गए mono reception के साथ मिलाता है। 0% पर stereo अपरिवर्तित रहता है; 100% पर वही processed signal बाएं और दाएं दोनों में भेजा जाता है। आउटपुट केवल Mix 100% पर पूरी तरह mono होता है।
- C-QUAM में reception अनुमति दे तो wet signal stereo होता है; ऊपर दिया mono वर्णन केवल Mono mode पर लागू होता है। FIR delay wet receiver path के भीतर ही रहता है। Mix dry signal को alignment के लिए delay नहीं करता, इसलिए बीच की settings दोनों signals को इसी समय-अंतर के साथ मिलाती हैं।

### HUD पढ़ना

- **S METER** दिखाता है कि AGC से पहले receiver अपने band के भीतर कितनी signal strength पा रहा है, S1 से S9 के पैमाने पर। असली सेट के S meter की तरह यह passband के भीतर की हर चीज़ जोड़कर पढ़ता है, इसलिए पास वाला स्टेशन, शोर और static भी इच्छित स्टेशन के साथ इसे ऊपर उठाते हैं।
- **AGC GAIN** रिसीवर द्वारा अभी लगाया जा रहा gain दिखाता है। Signal घटने या fade गहरा होने पर यह सामान्यतः बढ़ता है। यह +42 dB पर रुक जाता है, इसलिए अधिक गहरे fade और अधिक कमजोर signal पूरी तरह compensate होने के बजाय धीमे सुनाई देते हैं।
- **MODULATION** transmitter filtering के बाद प्रभावी modulation percentage दिखाता है।
- **FADE / EVENTS** मौजूदा propagation gain का बदलाव dB में दिखाता है और हाल की Static व clipping दर के अनुसार चमकता है। साफ परिणाम चाहिए और clipping बार-बार हो तो Mod Depth या Detector RC घटाएं।
- **STEREO** decoded stereo blend के अनुसार बदलता है। Stereo reception खुलने पर यह चमकता है और receiver के अपने आप mono की ओर लौटने पर मंद पड़ता है।

### सुझाई गई सेटिंग

1. **मजबूत स्थानीय स्टेशन**
   - TX Bandwidth: 6.0 kHz, Mod Depth: 90%, Signal: -10 dB, Skywave: 5%, Fading Speed: 0.1 Hz, Static: 0.5/s
   - Interference: -80 dB, Tuning: 0 kHz, IF Bandwidth: 12 kHz, AGC Speed: Fast, Speaker: Table, Mix: 100%

2. **रात का दूरस्थ स्टेशन**
   - TX Bandwidth: 4.5 kHz, Signal: -35 dB, Skywave: 75%, Fading Speed: 0.3 Hz, Static: 6/s
   - Interference: -55 dB, Interf. Offset: 9 kHz, IF Bandwidth: 6 kHz, AGC Speed: Slow, Detector RC: 150 µs, Speaker: Small, Mix: 100%

3. **भीड़ वाला पास का चैनल**
   - Signal: -25 dB, Skywave: 40%, Fading Speed: 0.5 Hz, Static: 3/s
   - Interference: -28 dB, Interf. Offset: 9 kHz, Tuning: +0.5 kHz, IF Bandwidth: 6 kHz, AGC Speed: Mid, Speaker: Small, Mix: 100%

## Bit Crusher

एक प्रभाव जो पुराने गेमिंग कंसोल और प्रारंभिक सैंपलर जैसे विंटेज डिजिटल उपकरणों की ध्वनि को पुनर्निर्मित करता है। रेट्रो चरित्र जोड़ने या lo-fi वातावरण बनाने के लिए बिल्कुल सही।

### ध्वनि चरित्र गाइड
- रेट्रो गेमिंग शैली:
  - क्लासिक 8-बिट कंसोल ध्वनियां बनाता है
  - वीडियो गेम संगीत नॉस्टैल्जिया के लिए बिल्कुल सही
  - ध्वनि में पिक्सेलेटेड बनावट जोड़ता है
- Lo-Fi हिप हॉप शैली:
  - वह आरामदायक, स्टडी-बीट्स ध्वनि बनाता है
  - गर्म, धीमी डिजिटल गिरावट
  - पृष्ठभूमि श्रवण के लिए बिल्कुल सही
- रचनात्मक प्रभाव:
  - अनूठी ग्लिच-शैली ध्वनियां बनाएं
  - आधुनिक संगीत को रेट्रो संस्करणों में बदलें
  - किसी भी संगीत में डिजिटल चरित्र जोड़ें

### पैरामीटर
- **Bit Depth** - ध्वनि कितनी "डिजिटल" बनती है, यह नियंत्रित करता है (4 से 24 बिट्स)
  - 4-6 बिट्स: चरम रेट्रो गेमिंग ध्वनि
  - 8 बिट्स: क्लासिक विंटेज डिजिटल
  - 12-16 बिट्स: सूक्ष्म lo-fi चरित्र
  - उच्च मान: बहुत धीमा प्रभाव
- **TPDF Dither** - प्रभाव को अधिक स्मूथ बनाता है
  - चालू: धीमी, अधिक संगीतमय ध्वनि
  - बंद: कच्चा, अधिक आक्रामक प्रभाव
- **ZOH Frequency** - समग्र स्पष्टता को प्रभावित करता है (4000Hz से 96000Hz)
  - निम्न मान: अधिक रेट्रो, कम स्पष्ट
  - उच्च मान: अधिक स्पष्ट, अधिक सूक्ष्म प्रभाव
- **Bit Error** - विंटेज हार्डवेयर चरित्र जोड़ता है (0.00% से 10.00%)
  - 0%: DAC bit-weight mismatch नहीं; Random Seed से सुनाई देने वाला बदलाव नहीं होता
  - 0.1-1%: सूक्ष्म डिजिटल DAC रंगत
  - 1-3%: क्लासिक हार्डवेयर अपूर्णताएं
  - 3-10%: रचनात्मक lo-fi चरित्र
- **Random Seed** - अपूर्णताओं की विशिष्टता को नियंत्रित करता है (0 से 1000)
  - Bit Error द्वारा उपयोग किए गए स्थिर imperfection pattern को बदलता है
  - केवल Bit Error 0% से ऊपर होने पर सुनाई देने वाला बदलाव करता है
  - वही मान हमेशा वही imperfection pattern फिर से बनाता है

## Cassette Artifacts

Cassette Artifacts संगीत को मॉडल की गई compact cassette पर रिकॉर्ड करता है और फिर वापस चलाता है। सिग्नल Dolby encoder, रिकॉर्ड amplifier तथा उसके द्वारा टेप पर अंकित ऊंची आवृत्तियों के उभार और निचली आवृत्तियों के सीमाबद्ध उभार, चुंबकीय परत के magnetic saturation, रिकॉर्ड bias से होने वाले ऊंची आवृत्तियों के मिटाव, प्लेबैक head के wavelength loss, चुंबकीय परत के स्थानीय dropouts, transport के wow और flutter, deck की बहती हुई head azimuth, प्लेबैक head के head contour, और ऊंची आवृत्तियों के उसी उभार को वापस हटाने वाले प्लेबैक curve से गुजरता है; उसके बाद टेप hiss और modulation noise जुड़ते हैं और Dolby decoder चलता है। जब आप चाहते हैं कि संगीत के ऊपर cassette जैसा शोर रखने के बजाय संगीत सचमुच किसी cassette deck से गुज़रा हुआ लगे, तब इसका उपयोग करें।

### अन्य Lo-Fi effects से अंतर

- **Tape Artifacts** एक open-reel स्टूडियो मशीन को मॉडल करता है, और दोनों के बीच का अंतर दोनों formats के बीच का अंतर है। अपने-अपने डिफ़ॉल्ट मानों पर, 96 kHz host पर छोटे सिग्नल के साथ, cassette 8 kHz पर 2.0 dB, 12 kHz पर 4.4 dB और 16 kHz पर 7.9 dB नीचे रहता है, जबकि open-reel मशीन क्रमशः 0.7, 1.7 और 3.5 dB नीचे रहती है। noise reduction बंद होने पर cassette की पृष्ठभूमि भी दोनों में से अधिक तेज़ होती है — open-reel मशीन के -68.5 dBFS के मुकाबले -65.5 dBFS — और Dolby B या C के साथ वह उससे नीचे, -73.6 और -82.8 dBFS तक चली जाती है; यही संबंध असली formats के बीच है। गति वहां एक नियंत्रण है और यहां स्थिर 4.76 cm/s, और Deck Grade, Type I/II/IV के स्तंभ, Dolby B/C, dropouts, head azimuth तथा Dolby level error केवल यहीं हैं।
- **Wow Flutter** (Modulation) केवल transport की गति के उतार-चढ़ाव को दोहराता है। जब आपको टेप saturation, Type और bias का व्यवहार, noise reduction और hiss के बिना सिर्फ कंपन चाहिए, तब इसे चुनें।
- **Saturation** और **Hard Clipping** केवल non-linearity जोड़ते हैं, टेप मशीन के आवृत्ति-निर्भर व्यवहार और transport के बिना।
- **Vinyl Artifacts**, **Noise Blender** और **Hum Generator** संगीत को बदले बिना ऊपर से शोर की एक परत जोड़ते हैं। यहां hiss, modulation noise और dropouts deck के सही स्थान पर बनते हैं, इसलिए noise reduction उन पर काम करता है और वे असली cassette शोर की तरह Tape Type और Hiss के साथ बदलते हैं।

### ध्वनि चरित्र गाइड

- **Deck Grade मशीन का वर्ग तय करता है:** यह band के सिरों और अल्पकालिक स्थिरता को एक साथ बदलता है, और कुछ नहीं। संदर्भ bias, छोटे सिग्नल और 96 kHz host पर मापने पर -3 dB बिंदु Reference पर 13.6 Hz से 18.0 kHz, Hi-Fi पर 16.7 Hz से 14.0 kHz, Consumer पर 19.9 Hz से 10.0 kHz और Portable पर 26.1 Hz से 6.5 kHz तक चलते हैं। 16 kHz पर यह क्रमशः 2.4, 4.0, 7.8 और 16.7 dB की कमी बनती है। azimuth का डगमगाना भी इसी क्रम में बढ़ता है — Reference पर बिल्कुल नहीं, क्योंकि उसी वर्ग की deck में azimuth servo होता है, और Portable पर सबसे अधिक, जहां ऊपरी सिरा साफ़ दिखने लायक सांस लेता है।
- **Record Level कार्य बिंदु है, कोई gain नहीं:** यह बताता है कि 0 dBFS का peak टेप को कितने ज़ोर से चलाता है, और output का स्तर इसके साथ नहीं हिलता। हिलता बाकी सब कुछ है। डिफ़ॉल्ट +9.0 dB पर full-scale 1 kHz tone लगभग 6% तीसरे harmonic के साथ 3.6 dB गोल होकर निकलता है, और किसी सघन आधुनिक master पर material के ऊपरी 6 dB लगभग 4.2 dB बनकर निकलते हैं। +0.0 dB पर वही material लगभग बिना compression के निकलता है (ऊपरी 6 dB, 5.9 dB बने रहते हैं) और टेप का उपयोग ही नहीं होता; +15.0 dB तक आते-आते ऊपरी 6 dB सिमटकर लगभग 1.9 dB रह जाते हैं। पृष्ठभूमि इसका उल्टी दिशा में एक decibel के बदले एक decibel अनुसरण करती है, इसलिए Record Level बढ़ाना signal-to-noise खरीदता है और dynamic range खर्च करता है।
- **निचली आवृत्तियां सबसे पहले छत से टकराती हैं:** रिकॉर्ड पक्ष को 50 Hz से नीचे की हर चीज़ टेप पर चढ़ाने के लिए उभारनी पड़ती है, और उस उभार की एक छत Deck Grade तय करता है, इसलिए गहरी bass मध्य आवृत्तियों से पहले saturation तक पहुंच जाती है। Consumer deck पर Record Level +12.0 dB होने पर full-scale tone 315 Hz के 3.3 dB के मुकाबले 20 Hz पर 7.8 dB और 40 Hz पर 5.4 dB नीचे निकलता है। यही असममिति निचले सिरे के गिरने का कारण भी है।
- **Tape Type कोई वॉल्यूम स्विच नहीं है:** 1 kHz का छोटा सिग्नल तीनों पर 0.01 dB के भीतर एक ही स्तर पर निकलता है। बदलते हैं headroom और शोर। Type IV के पास ऊंची आवृत्तियों का सबसे अधिक headroom है — इसका 10 kHz saturation output Type II से 6.5 dB ऊपर और 315 Hz पर अधिकतम output स्तर 1 dB ऊपर है — और डिफ़ॉल्ट Record Level पर यह Type II की तुलना में 10 kHz पर -6 dBFS के tone पर लगभग 4.9 dB और full-scale tone पर लगभग 7.5 dB अधिक बचाए रखता है; पर इसका अपना noise floor Type II से 2.5 dB खराब है। Type I तीनों में सबसे शोर वाला है, Type II से 4 dB ऊपर, और छोटे सिग्नलों को ठीक Type II जितना ही रंग देता है, इसलिए उससे जो सुनाई देता है उसका अधिकांश हिस्सा अतिरिक्त पृष्ठभूमि ही है।
- **noise reduction एक मिलान किया हुआ आवागमन है:** एक ही sliding-band compander टेप से पहले encode करता है और उसके बाद expand करता है, इसलिए आदर्श स्थितियों में संगीत ज्यों का त्यों वापस निकलता है। शांति की मात्रा नाममात्र 10 और 20 dB नहीं बल्कि मापी गई प्रभावी संख्या है: डिफ़ॉल्ट settings पर A-weighted रूप में Dolby B के लिए लगभग 8 dB और Dolby C के लिए लगभग 17 dB। इसकी कीमत ऊंचे स्तरों पर ऊंची आवृत्तियों की mistracking है, जहां decoder टेप से दबी हुई ऊंची आवृत्तियों को अधिक धीमा सिग्नल मानकर उन्हें और नीचे कर देता है; Dolby C के anti-saturation shelves इसे घटाते हैं, और डिफ़ॉल्ट Record Level पर -6 dBFS के 10 kHz tone पर C, B की तुलना में लगभग 3.9 dB और full-scale tone पर लगभग 8.4 dB अधिक बचाता है।
- **सबसे ऊपरी octave ही deck की सीमा है:** संदर्भ bias, छोटे सिग्नल और 96 kHz host पर डिफ़ॉल्ट Consumer deck 50 Hz पर +1.1 dB (head contour), 1 kHz पर 0.0 dB, 5 kHz पर -0.8 dB, 10 kHz पर -3.0 dB और 16 kHz पर -7.8 dB मापती है, तथा 20 Hz पर -2.9 dB। गिरते हुए निचले सिरे के ऊपर निचली आवृत्तियों का यह हल्का उभार और ऊपर की यह गिरावट ही, कुछ भी ज़ोर से चलाए जाने से पहले, deck की अपनी प्रतिक्रिया है।
- **transport open-reel से धीमा और अधिक चौड़ा है:** 6.9 Hz का capstan wow, 0.42 Hz का hub घूर्णन और 1 से 40 Hz के बीच broadband flutter। डिफ़ॉल्ट 0.200% पर pitch लगभग 9 cents peak to peak हिलता है, ठीक उन्हीं 5 से 10 cents पर जहां frequency modulation स्वयं सुनाई देने लगती है, इसलिए यह कंपन लंबे स्वरों पर सुनाई देता है और सघन कार्यक्रम में ढक जाता है; 0.040% वह आंकड़ा है जो एक संदर्भ deck प्रकाशित करती है और उसमें हलचल केवल लगभग 2 cents की होती है, और रेंज का शीर्ष 1.000% लगभग 46 cents देता है, यानी तेज़ warble।
- **जीवंत पृष्ठभूमि:** खाली जगहों में hiss, साथ ही संगीत के ऊपर ही चलने वाला modulation noise, जो Type I, Type II और Type IV पर सिग्नल से क्रमशः लगभग 48, 50 और 52 dB नीचे रहता है। पूरी तरह शांत पृष्ठभूमि चाहिए तो Hiss को -92.0 dB re 250 nWb/m तक नीचे कर दें।
- **dropouts क्लिक नहीं, सिग्नल की हानि हैं:** हर घटना gate नहीं बल्कि 2.1 से 21 ms और 3 से 30 dB की चिकनी raised-cosine गिरावट है, और गहराई का चयन उथले सिरे की ओर झुका हुआ है, इसलिए प्रायः जो सुनाई देता है वह टिक की आवाज़ नहीं बल्कि संगीत का एक क्षण के लिए बैठ जाना है। डिफ़ॉल्ट 2.0 events/min किसी भी एक track पर लगभग हर आधे मिनट में एक घटना बनती है।
- **Azimuth और Dolby Level Error अनुकूलता के अक्ष हैं:** दोनों चिह्न-सहित हैं, और उनका चिह्न ही असली बात है। Azimuth दोनों channels पर ऊपरी सिरे को गहरा करता है और उनके बीच एक अंतराल डालता है, और कौन-सा channel आगे रहेगा यह उसके चिह्न से तय होता है। शून्य से ऊपर का Dolby Level Error decoder से बहुत कम कटौती कराता है, इसलिए परिणाम अधिक चमकीला और अधिक hiss वाला होता है; शून्य से नीचे वह बहुत अधिक काट देता है और परिणाम अधिक गहरा होता है।

### पैरामीटर

गति चुनी नहीं जाती, बताई जाती है: compact cassette परिभाषा से 4.76 cm/s (1⅞ ips) पर चलती है, इसलिए वह कोई नियंत्रण नहीं है और panel के नीचे की status line उसे एक बार, Wow/Flutter के readout के हिस्से के रूप में, नाम से बता देती है।

- **Deck Grade** (Reference, Hi-Fi, Consumer या Portable) - deck का वर्ग चुनता है। यह केवल उन्हीं तंत्रों को नियंत्रित करता है जिनका अपना कोई नियंत्रण नहीं है: head के wavelength loss को समतल करने वाला record equalization का बजट, रिकॉर्ड amplifier की bandwidth, निचली आवृत्तियों के record उभार की छत, azimuth के डगमगाने का आकार और head contour का आकार। यह Wow/Flutter, Hiss या Dropouts को कभी नहीं छूता, इसलिए इसे बदलने से आपकी अपनी settings कभी नहीं मिटतीं। 96 kHz host पर छोटे सिग्नल के साथ मापे गए band के सिरे 13.6 Hz से 18.0 kHz (Reference), 16.7 Hz से 14.0 kHz (Hi-Fi), 19.9 Hz से 10.0 kHz (Consumer) और 26.1 Hz से 6.5 kHz (Portable) हैं, और इन्हीं चारों पर azimuth के डगमगाने का मानक विचलन क्रमशः 0, 1, 2 और 4 arcmin रहता है। Reference में डगमगाना बिल्कुल नहीं है, क्योंकि उस वर्ग की deck में azimuth servo होता है। डिफ़ॉल्ट Consumer एक साधारण घरेलू मशीन है।
- **Tape Type** (Type I, Type II या Type IV) - टेप का प्रकार चुनता है: ferric, high-bias और metal। यह न equalizer preset है न level नियंत्रण, बल्कि headroom और शोर का profile है — 1 kHz का छोटा सिग्नल तीनों पर 0.01 dB के भीतर एक ही स्तर पर निकलता है। Type II संदर्भ स्तंभ है: Type I उससे 4.0 dB और Type IV 2.5 dB अधिक शोर वाला है, जबकि Type IV के पास Type II से 6.5 dB अधिक ऊंची आवृत्तियों का headroom और 1 dB अधिक निचली आवृत्तियों का headroom है। हर Type का अपना अनुशंसित bias बिंदु भी है, इसलिए जो भी चुना जाए, Bias 0 dB का अर्थ सही ढंग से align की गई deck ही है।
- **Noise Reduction** (Off, Dolby B या Dolby C) - companding noise reduction चुनता है। यह हमेशा एक मिलान किया हुआ encode/decode आवागमन है — रिकॉर्ड और प्लेबैक दोनों में वही sliding-band नियम चलता है — इसलिए आदर्श स्थितियों में यह संगीत बदले बिना टेप को शांत करता है। Dolby B एक ही sliding band है और Dolby C anti-saturation shelves वाले दो आगे-पीछे रखे हुए bands; यहां मिलने वाली शांति नाममात्र नहीं बल्कि मापी हुई है, B के लिए लगभग 8 dB और C के लिए लगभग 17 dB, और यह Tape Type, Hiss, Dolby Level Error तथा host sample rate पर निर्भर करती है, इसीलिए status line मौजूदा settings का आंकड़ा बताती है। दोनों असली deck की तरह तेज़ ऊंची आवृत्तियों पर mistrack भी करते हैं, और Dolby C, Dolby B से कम mistrack करता है।
- **Bias** (-6.0 से +6.0 dB) - चुने हुए Tape Type के अनुशंसित बिंदु के सापेक्ष रिकॉर्डिंग bias तय करता है। 0 dB सही ढंग से align की गई deck है: यह 10 kHz संवेदनशीलता वक्र के शिखर से Type I पर 2.5 dB, Type II पर 3.0 dB और Type IV पर 2.0 dB ऊपर बैठता है, और deck वहीं align की जाती है। अधिक (over-bias) settings निचली और मध्य आवृत्तियों में साफ़ और ऊपर से अधिक गहरी होती हैं: +2.0 dB पर तीनों Type में 10 kHz संवेदनशीलता क्रमशः 1.67, 1.81 और 1.52 dB गिरती है, और +6.0 dB पर 5.31, 5.71 तथा 4.86 dB। कम (under-bias) settings अधिक चमकीली और अधिक distorted होती हैं, ठीक जैसे गलत align की गई deck होती है, पर केवल उस शिखर तक — Type I पर लगभग -3.6 dB, Type II पर -3.9 dB और Type IV पर -3.2 dB, जिनका 10 kHz पर मूल्य लगभग +2.5, +3.0 और +2.0 dB है — और उससे नीचे ऊंची आवृत्तियां फिर गहरी पड़ जाती हैं जबकि distortion बढ़ती रहती है, इसलिए -6.0 dB पहले ही -4.0 dB से कम चमकीला है। 1 kHz पर पूरी रेंज में 0.2 dB से भी कम हलचल होती है, इसलिए Bias कोई वॉल्यूम नियंत्रण नहीं है।
- **Record Level** (-12.0 से +18.0 dB) - तय करता है कि deck कितने ज़ोर से रिकॉर्ड करती है। यह संख्या वह टेप स्तर है जहां 0 dBFS का peak पहुंचता है, 250 nWb/m के संदर्भ flux से dB ऊपर के रूप में, और status line इसी परिपाटी को बताती है। यह नियंत्रण स्वयं कोई gain नहीं जोड़ता: जब तक टेप संतृप्त नहीं होता, वही संकेत हर Record Level setting पर उसी स्तर पर निकलता है, इसलिए यह टेप को बदलता है, आवाज़ को नहीं। डिफ़ॉल्ट +9.0 dB सामान्य रूप से रिकॉर्ड की गई cassette है, जहां full-scale 1 kHz tone लगभग 6% तीसरे harmonic के साथ 3.6 dB गोल होकर निकलता है और गहरी bass पहले ही छत से जा लगी होती है। नीची settings ऐसे transfer की ओर हटती हैं जो टेप का उपयोग ही नहीं करता — +0.0 dB पर full-scale tone केवल 0.5 dB खोता है — और पृष्ठभूमि को हर decibel के बदले एक decibel ऊपर उठा देती हैं, क्योंकि hiss टेप पर है और अब टेप peak से उतना ही नीचे है। ऊंची settings अधिक compression करती हैं और उसी नियम से पृष्ठभूमि को शांत करती हैं; लगभग +15.0 dB के आगे dynamic range और नहीं खुलती और केवल compression बढ़ती जाती है।
- **Wow/Flutter** (0 से 1%) - transport के गति-उतार-चढ़ाव को स्थिर 4.76 cm/s पर DIN 45507 peak weighted विचलन के प्रतिशत के रूप में तय करता है। 0% पूरी तरह स्थिर transport है। डिफ़ॉल्ट 0.200% उसी 0.15 से 0.25% की खिड़की के बीच में बैठता है जो साधारण cassette decks प्रकाशित करती हैं, और pitch को लगभग 9 cents peak to peak हिलाता है, ठीक उन्हीं 5 से 10 cents पर जहां frequency modulation स्वयं सुनाई देने लगती है। 0.040% वह weighted peak है जो एक संदर्भ deck प्रकाशित करती है और उसमें हलचल केवल लगभग 2 cents की होती है; रेंज का शीर्ष 1.000% लगभग 46 cents देता है, यानी तेज़ warble। यहां हलचल open-reel मशीन से धीमी है, क्योंकि उस पर 0.42 Hz का hub घूर्णन हावी रहता है।
- **Hiss** (-92.0 से -42.0 dB re 250 nWb/m) - टेप hiss और modulation noise दोनों का स्तर एक साथ तय करता है, noise reduction बंद होने पर Type II के A-weighted बिना-सिग्नल flux के रूप में, 250 nWb/m के संदर्भ के सापेक्ष। यह output पर का कोई स्तर नहीं बल्कि टेप का अपना datasheet आंकड़ा है: शोर टेप पर रिकॉर्ड होता है, इसलिए output पर वह कितना मापा जाएगा यह Record Level पर निर्भर करता है। -92.0 dB re 250 nWb/m पर दोनों पूरी तरह बंद हो जाते हैं। डिफ़ॉल्ट -60.5 dB re 250 nWb/m वह bias noise है जो निर्माता Type II टेप के लिए प्रकाशित करता है। Type I उस स्तंभ से 4.0 dB और Type IV 2.5 dB ऊपर है, Record Level पूरी चीज़ को एक decibel के बदले एक decibel खिसकाता है, और उसके बाद Dolby decoder अपनी मापी हुई मात्रा हटा देता है, इसलिए खाली जगहों में जो सुनाई देता है वह यह संख्या नहीं है — वह कितना बनता है, यह status line बताती है। यह सब Output से पहले है, इसलिए Output के बाद लगाया गया meter इसे Output जितना ऊपर उठा हुआ पढ़ता है। संगीत बजते समय यह नियंत्रण मुख्यतः सिग्नल के साथ चलने वाला modulation noise जोड़ता है।
- **Dropouts** (0 से 20 events/min) - चुंबकीय परत के dropouts की औसत दर प्रति track तय करता है: आप जिस भी एक channel को मापें, उसे प्रति मिनट इतनी ही घटनाएं मिलती हैं। इनमें से आधी पूरे टेप की होती हैं और सभी channels को एक साथ प्रभावित करती हैं, आधी किसी एक track तक सीमित होती हैं। हर घटना gate नहीं बल्कि 2.1 से 21 ms और 3 से 30 dB की चिकनी raised-cosine गिरावट है, इसलिए यह क्लिक की तरह नहीं, सिग्नल के थोड़ी देर खो जाने की तरह सुनाई देती है। डिफ़ॉल्ट 2.0 events/min सामान्य उपयोग में चल रही cassette है, यानी किसी भी एक track पर लगभग हर आधे मिनट में एक घटना; 0 एक निर्दोष टेप है और कुछ भी नहीं जोड़ता, और शीर्ष 20 events/min किसी premium cassette द्वारा प्रकाशित गुणवत्ता-नियंत्रण सीमा का तीन गुना है, जो स्पष्ट रूप से खराब हो चुके टेप का क्षेत्र है।
- **Azimuth** (-6.0 से +6.0 arcmin) - टेप रिकॉर्ड करने वाली deck और उसे चलाने वाली deck के बीच head alignment की त्रुटि तय करता है। यह गुणवत्ता का कोई दर्जा नहीं बल्कि उन्हीं दो मशीनों की alignment की स्थिति है, इसीलिए यह चिह्न-सहित है और Deck Grade से स्वतंत्र है। कोई भी त्रुटि दोनों channels पर ऊंची आवृत्तियों की कीमत लेती है: डिफ़ॉल्ट +2.0 arcmin पर पूरी तरह align किए हुए जोड़े की तुलना में 10 kHz का tone 0.25 dB और 16 kHz का tone 0.60 dB खोता है, और ±6.0 arcmin पर यह 1.03 और 2.26 dB हो जाता है। यह +2.0 arcmin पर दोनों channels के बीच 11.0 µs का अंतराल भी डालता है, और कौन-सा channel आगे रहेगा यह चिह्न तय करता है, इसलिए correlated material का mono योग 8 kHz पर 0.8 dB, 12 kHz पर 1.8 dB और 16 kHz पर 3.2 dB और खो देता है; uncorrelated material में ऐसा कोई comb नहीं दिखता। Deck Grade इस setting के ऊपर एक धीमा बहाव जोड़ता है, इसलिए Azimuth कोई जमा हुआ मान नहीं बल्कि वह केंद्र है जिसके इर्द-गिर्द वह बहाव घूमता है।
- **Dolby Level Error** (-3.0 से +3.0 dB) - तय करता है कि प्लेबैक deck का Dolby संदर्भ रिकॉर्ड करने वाली deck के संदर्भ से कितना हटा हुआ है। इसका अर्थ केवल Noise Reduction चालू होने पर है, और इसका चिह्न ही असली बात है: शून्य से ऊपर decoder टेप को उससे अधिक तेज़ पढ़ता है, बहुत कम काटता है, और परिणाम अधिक चमकीला तथा अधिक hiss वाला होता है; शून्य से नीचे वह बहुत अधिक काटता है और परिणाम अधिक गहरा होता है। डिफ़ॉल्ट deck पर मध्यम स्तर का tone -3.0 dB पर 5 kHz पर लगभग 2.4 dB और 10 kHz पर लगभग 1.0 dB नीचे जाता है, तथा +3.0 dB पर 5 kHz पर लगभग 1.9 dB और 10 kHz पर लगभग 2.2 dB ऊपर। 0.0 dB का अर्थ है एक-दूसरे के अनुरूप calibrate की गई दो decks। तेज़ ऊंची आवृत्तियों पर mistracking हर setting पर मौजूद रहती है, क्योंकि encode और decode के बीच टेप स्वयं सिग्नल बदल देता है; यह नियंत्रण जो खोलता है वह चमकीला पक्ष है, जहां मिलान किया हुआ जोड़ा पहुंच ही नहीं सकता।
- **Output** (-24.0 से +24.0 dB) - पूरी शृंखला के बाद स्तर समायोजित करता है। यह bypass से तुलना करते समय आवाज़ मिलाने के लिए है, या ऊंची Record Level setting से घटी आवाज़ वापस लाने के लिए।
- **Mix** (0 से 100%) - cassette सिग्नल को मूल सिग्नल के साथ मिलाता है। 100% पूरी cassette प्लेबैक है। dry सिग्नल को टेप पथ के साथ delay-aligned किया गया है, इसलिए मध्य आवृत्तियां साफ़-सुथरी मिलती हैं — 50% पर 1 kHz इकाई से 0.06 dB के भीतर रहता है — पर सबसे ऊपरी octave नहीं, क्योंकि वहां dry और टेप की phase मेल नहीं खाती और वे आंशिक रूप से एक-दूसरे को काटते हैं। यह कटाव दोनों channels पर एक जैसा नहीं होता, क्योंकि azimuth त्रुटि दोनों के बीच एक अंतराल डालती है: 96 kHz host पर डिफ़ॉल्ट settings के साथ 50% पर बायां channel 8 kHz पर 1.7 dB, 12 kHz पर 3.6 dB, 16 kHz पर 5.3 dB और 20 kHz पर 6.2 dB नीचे आता है, जबकि दायां channel उन्हीं आवृत्तियों पर क्रमशः 4.4, 8.9, 9.0 और 7.0 dB नीचे रहता है। 0% पर input बिल्कुल अपरिवर्तित निकलता है और effect कोई latency नहीं जोड़ता; किसी भी अन्य setting पर यह 44.1 kHz host पर 165 samples (3.741 ms), 48 kHz पर 179 (3.729 ms), 96 kHz पर 347 (3.615 ms) और 192 kHz पर 683 (3.557 ms) जोड़ता है।

### status line पढ़ना

नियंत्रणों के नीचे की पंक्ति Record Level की परिपाटी बताती है और यह भी कि deck के मौजूदा विन्यास पर दो Base settings कितनी बनती हैं, इस रूप में: `Record Level +9.0 dB → tape peak +9.0 dB re 250 nWb/m at 0 dBFS in · Wow/Flutter Base 0.200% → 0.200% at 4.76 cm/s (1⅞ ips) · Hiss Base -60.5 dB re 250 nWb/m → -73.6 dBFS, Type I, Dolby B`।

- **Record Level** नियंत्रण को उसी रूप में दोहराता है जो टेप पर उसका अर्थ है: वह flux जहां 0 dBFS का peak पहुंचता है। यह परिपाटी का कथन है, कोई meter नहीं — meter है ही नहीं, और अधिक धीमा master टेप पर उतना ही नीचे बैठता है।
- **Wow/Flutter** Base मान और प्रभावी मान बताता है। गति स्थिर है, इसलिए दोनों हमेशा एक ही आंकड़ा रहते हैं; यह पंक्ति इसलिए है कि वह प्रतिशत किस माप-परिपाटी का है यह नाम से स्पष्ट हो, और यही एकमात्र जगह है जहां transport की गति बताई जाती है।
- **Hiss** Base मान बताता है और साथ ही वह बिना-सिग्नल A-weighted floor, जो Tape Type के स्तंभ, Record Level और Dolby decoder के बाद तथा Output से पहले output पर बनती है। Hiss के -92.0 dB re 250 nWb/m होने पर पूरा शोर-परिवार बंद हो जाता है और पंक्ति `→ off` दिखाती है।
- प्रभावी floor मापी हुई है, Dolby B और C के नाममात्र 10 और 20 dB से निकाली हुई नहीं, और यह Tape Type, noise reduction, Hiss, Dolby Level Error, Record Level तथा host sample rate — सब पर एक साथ निर्भर करती है। Hiss के डिफ़ॉल्ट -60.5 dB re 250 nWb/m और Record Level के +9.0 dB पर, 96 kHz host पर, यह इतनी बनती है:

  | Tape Type | NR Off | Dolby B | Dolby C |
  |---|---|---|---|
  | Type I | -65.5 dBFS | -73.6 dBFS | -82.8 dBFS |
  | Type II | -69.5 dBFS | -77.7 dBFS | -87.0 dBFS |
  | Type IV | -67.0 dBFS | -75.2 dBFS | -84.4 dBFS |

  Record Level पूरी तालिका को एक decibel के बदले एक decibel खिसकाता है: +12.0 dB पर हर आंकड़ा 3 dB नीचे और +6.0 dB पर हर आंकड़ा 3 dB ऊपर। Dolby decoder कितना हटाता है यह इससे नहीं बदलता, क्योंकि टेप की floor और decoder का अपना संदर्भ साथ-साथ खिसकते हैं।
- हर संयोजन एक बार मापा जाता है और फिर याद रखा जाता है, इसलिए जिस setting से आप पहले गुज़र चुके हैं उसके लिए आंकड़ा तुरंत दिख जाता है। जब आप Hiss या Dolby Level Error को अब तक बिना मापे संयोजनों से खींचकर ले जा रहे होते हैं, तब पंक्ति `measuring…` दिखाती है और नियंत्रण रुकते ही संख्या भर देती है — कई decibel गलत आंकड़े को अंतिम जैसा दिखाकर बताना, कुछ न बताने से बुरा होगा।

### सुझाई गई सेटिंग

1. **साधारण cassette deck (डिफ़ॉल्ट)**
   - Deck Grade: Consumer, Tape Type: Type I, Noise Reduction: Dolby B, Bias: 0.0 dB, Record Level: +9.0 dB
   - Wow/Flutter: 0.200%, Hiss: -60.5 dB re 250 nWb/m, Dropouts: 2.0 events/min, Azimuth: +2.0 arcmin, Dolby Level Error: 0.0 dB, Output: 0.0 dB, Mix: 100%
   - रोज़मर्रा की cassette ध्वनि, और plugin का अपना डिफ़ॉल्ट भी: 16 kHz पर ऊपरी सिरा 7.9 dB नरम, 20 Hz पर पहले ही 2.9 dB नीचे जा चुके निचले सिरे के ऊपर 50 Hz के आसपास 1.1 dB का उभार, full-scale tone पर लगभग 6% तीसरा harmonic और 3.6 dB की गोलाई, 96 kHz host पर -73.6 dBFS की पृष्ठभूमि, लगभग 9 cents की pitch हलचल, और हर track पर लगभग हर आधे मिनट में एक dropout।

2. **Reference deck, Dolby C के साथ metal टेप**
   - Deck Grade: Reference, Tape Type: Type IV, Noise Reduction: Dolby C, Bias: 0.0 dB, Record Level: +9.0 dB
   - Wow/Flutter: 0.040%, Hiss: -60.5 dB re 250 nWb/m, Dropouts: 0.0 events/min, Azimuth: 0.0 arcmin, Dolby Level Error: 0.0 dB, Output: 0.0 dB, Mix: 100%
   - इस format का सबसे सक्षम संयोजन: Reference deck 18.0 kHz पर -3 dB तक पहुंचती है और बिल्कुल नहीं बहती, Type IV, Type II से 6.5 dB अधिक ऊंची आवृत्तियों का headroom लाता है, और 96 kHz host पर पृष्ठभूमि -84.4 dBFS पर बैठती है। Type IV की अपनी टेप floor Type II से 2.5 dB खराब है — इसे यहां सबसे शांत Dolby C ही बनाता है, और तेज़ ऊंची आवृत्तियों पर mistracking भी यही setting सबसे कम करती है। कंपन, hiss, dropouts और azimuth का बहाव — सब बंद होने के कारण यह deck पूरी तरह deterministic है।

3. **noise reduction के बिना ferric टेप**
   - Deck Grade: Consumer, Tape Type: Type I, Noise Reduction: Off, Bias: 0.0 dB, Record Level: +9.0 dB
   - Wow/Flutter: 0.200%, Hiss: -60.5 dB re 250 nWb/m, Dropouts: 2.0 events/min, Azimuth: +2.0 arcmin, Dolby Level Error: 0.0 dB, Output: 0.0 dB, Mix: 100%
   - noise reduction के बिना रिकॉर्ड किया गया सादा ferric टेप: 96 kHz host पर पृष्ठभूमि -65.5 dBFS पर बैठती है, डिफ़ॉल्ट से 8.1 dB अधिक तेज़, और उसे हटाने वाला कुछ नहीं है, इसलिए हर खाली जगह में hiss ध्वनि का हिस्सा बन जाता है। छोटे सिग्नलों के लिए रंग ठीक डिफ़ॉल्ट जैसा ही है — Types के बीच का अंतर शोर और headroom का है, रंग का नहीं — और कुछ भी mistrack नहीं करता, क्योंकि mistrack करने के लिए कोई decoder ही नहीं है।

4. **घरेलू deck, थोड़ी over-bias**
   - Deck Grade: Consumer, Tape Type: Type I, Noise Reduction: Dolby B, Bias: +2.0 dB, Record Level: +12.0 dB
   - Wow/Flutter: 0.300%, Hiss: -58.0 dB re 250 nWb/m, Dropouts: 4.0 events/min, Azimuth: +3.0 arcmin, Dolby Level Error: -1.0 dB, Output: +0.5 dB, Mix: 100%
   - सामान्य टेप पर चलने वाली एक साधारण घरेलू deck, और किसी दूसरी deck पर रिकॉर्ड किया गया टेप: bias थोड़ी ऊंची, इसलिए ऊपरी सिरा align की गई deck से 10 kHz पर लगभग 1.7 dB गहरा और निचली तथा मध्य आवृत्तियां थोड़ी साफ़; कम स्थिर transport; ऊपर उठी हुई टेप floor; हर track पर लगभग हर चौथाई मिनट में एक dropout; अधिक चौड़ी azimuth त्रुटि; और 1 dB नीचे calibrate किया हुआ decoder, जो उसे और गहरा कर देता है। Record Level डिफ़ॉल्ट से 3 dB ऊपर है, इसलिए किसी सघन master के ऊपरी 6 dB लगभग 3.1 dB बनकर निकलते हैं और compression की कीमत चुकाने के लिए Output थोड़ा ऊपर जाता है। ऊपर उठी हुई Hiss setting Type I, Dolby B और Record Level के बाद कितनी बनती है, यह status line बताती है।

5. **Portable, घिसा हुआ टेप**
   - Deck Grade: Portable, Tape Type: Type I, Noise Reduction: Off, Bias: -2.0 dB, Record Level: +12.0 dB
   - Wow/Flutter: 0.480%, Hiss: -54.0 dB re 250 nWb/m, Dropouts: 8.0 events/min, Azimuth: +4.0 arcmin, Dolby Level Error: 0.0 dB, Output: +1.0 dB, Mix: 100%
   - जानबूझकर खराब किया गया lo-fi प्रभाव। Portable deck 6.5 kHz और 26 Hz पर -3 dB तक पहुंचती है और डिफ़ॉल्ट deck से दोगुना बहती है; bias align बिंदु से नीचे है, जो 10 kHz को लगभग 1.6 dB चमकीला करता है और साथ ही distortion भी बढ़ाता है; transport उस बिंदु से कहीं आगे है जहां कंपन स्पष्ट सुनाई देने लगता है; टेप तेज़ और शोर भरा है; azimuth बुरी तरह बिगड़ा हुआ है; और हर track पर dropouts प्रति मिनट कई बार आते हैं। Record Level इतना ऊंचा है कि bass मज़बूती से छत से जा लगी है, और Output आवाज़ वापस ले आता है।

### मॉडल संबंधी टिप्पणियां

यह effect compact cassette की स्थिर 4.76 cm/s गति पर चलने वाली deck पर एक बार की रिकॉर्डिंग और प्लेबैक को मॉडल करता है। रिकॉर्ड पक्ष टेप से पहले ऊंची आवृत्तियां उठाता है और प्लेबैक पक्ष ठीक उतना ही उभार वापस हटा देता है, न कि किसी प्रकाशित प्लेबैक मानक का पालन करता है; curve का निचली आवृत्तियों वाला आधा हिस्सा जानबूझकर असममित है, क्योंकि असली deck 50 Hz से नीचे रिकॉर्ड पक्ष पर जो उभार लगाती है उसकी एक छत होती है, और वही छत निचली आवृत्तियों के गिरने और bass के सबसे पहले saturation तक पहुंचने — दोनों को जन्म देती है। Deck Grade केवल उन्हीं तंत्रों को नियंत्रित करता है जिनका अपना कोई नियंत्रण नहीं है, इसलिए यह Wow/Flutter, Hiss या Dropouts को कभी नहीं बदलता। azimuth का डगमगाना random walk नहीं बल्कि एक सीमाबद्ध प्रक्रिया है जो Azimuth की setting की ओर वापस खींची जाती है, और Reference में यह बिल्कुल नहीं है, क्योंकि उस वर्ग की deck में azimuth servo होता है; Wow/Flutter 0, Hiss बंद, Dropouts 0 और Deck Grade Reference होने पर कुछ भी यादृच्छिक नहीं चलता। Dolby B और Dolby C मिलान किए हुए sliding-band companders के रूप में मॉडल किए गए हैं और हमेशा encode तथा decode के पूरे आवागमन के रूप में चलते हैं; केवल encode या केवल decode जैसा कोई संचालन नहीं है, और किसी भी noise reduction विनिर्देश के अनुपालन या उसके विरुद्ध प्रमाणन का कोई दावा नहीं है। Dolby Level Error केवल decoder के संदर्भ को खिसकाता है, जो दो decks के बीच calibration का अंतर है, कोई दूसरा processing चरण नहीं। Type III टेप, microcassette और Elcaset formats, दूसरी टेप गतियां, pitch control, auto-reverse, print-through, splice noise, motor hum, shell तथा तंत्र का शोर, और विपरीत side से रिसाव इस मॉडल के बाहर हैं। प्रति टेप dropout के कोई सार्वजनिक आंकड़े मौजूद नहीं हैं, इसलिए dropout दर की रेंज, अवधि और गहराई एक प्रकाशित गुणवत्ता-नियंत्रण सीमा से बंधा हुआ calibrated मॉडल है, न कि मापे गए डेटा की नकल। टेप पथ 44.1 kHz host पर transport और processing का 165 samples (3.741 ms) विलंब रखता है, जो 192 kHz host पर घटकर 683 samples (3.557 ms) रह जाता है; Mix 0% पर input बिट-दर-बिट ज्यों का त्यों और बिना किसी विलंब के गुजरता है। ऊपर दिए गए रंग-संबंधी आंकड़े 96 kHz host पर और संदर्भ 0.0 dB Bias पर मापे गए हैं। यह effect Tape Artifacts से लगभग डेढ़ गुना अधिक भार डालता है।

## Digital Error Emulator

विभिन्न डिजिटल ऑडियो ट्रांसमिशन त्रुटियों की ध्वनि का अनुकरण करने वाला एक प्रभाव, डिजिटल इंटरफेस की सूक्ष्म ग्लिच से लेकर पुराने CD player की अपूर्णताओं तक। जब साफ playback में हल्की डिजिटल गड़बड़ी, dropouts या पुरानी digital-device याद जोड़नी हो, तब उपयोगी।

### ध्वनि चरित्र गाइड
- डिजिटल इंटरफेस ग्लिच:
  - S/PDIF, AES3, और MADI ट्रांसमिशन आर्टिफैक्ट्स का अनुकरण
  - पुराने डिजिटल उपकरण का चरित्र जोड़ता है
  - हल्की विंटेज डिजिटल खुरदराहट के लिए उपयोगी
- उपभोक्ता डिजिटल ड्रॉपआउट्स:
  - क्लासिक सीडी प्लेयर त्रुटि सुधार व्यवहार को दोहराता है
  - USB ऑडियो इंटरफेस ग्लिच का अनुकरण
  - 90s/2000s डिजिटल संगीत नॉस्टैल्जिया के लिए आदर्श
- स्ट्रीमिंग और वायरलेस ऑडियो आर्टिफैक्ट्स:
  - ब्लूटूथ ट्रांसमिशन त्रुटियों का अनुकरण
  - नेटवर्क स्ट्रीमिंग ड्रॉपआउट्स और आर्टिफैक्ट्स
  - आधुनिक डिजिटल जीवन की अपूर्णताएं
- रचनात्मक डिजिटल बनावट:
  - RF हस्तक्षेप और वायरलेस ट्रांसमिशन त्रुटियां
  - HDMI/DisplayPort ऑडियो भ्रष्टाचार प्रभाव
  - अनूठी प्रयोगात्मक ध्वनि संभावनाएं

### पैरामीटर
- **Bit Error Rate** - त्रुटि घटना आवृत्ति को नियंत्रित करता है (10^-12 से 10^-2)
  - बहुत दुर्लभ (10^-10 से 10^-8): सूक्ष्म कभी-कभार आर्टिफैक्ट्स
  - कभी-कभार (10^-8 से 10^-6): क्लासिक उपभोक्ता उपकरण व्यवहार
  - बार-बार (10^-6 से 10^-4): ध्यान देने योग्य विंटेज चरित्र
  - चरम (10^-4 से 10^-2): रचनात्मक प्रयोगात्मक प्रभाव
  - डिफ़ॉल्ट: 10^-6 (विशिष्ट उपभोक्ता उपकरण)
- **Mode** - अनुकरण करने के लिए डिजिटल ट्रांसमिशन प्रकार का चयन
  - AES3/S-PDIF: नमूना होल्ड के साथ डिजिटल इंटरफेस बिट त्रुटियां
  - ADAT/TDIF/MADI: मल्टी-चैनल बर्स्ट त्रुटियां (होल्ड या म्यूट)
  - HDMI/DP: डिस्प्ले ऑडियो रो करप्शन या म्यूटिंग
  - USB/FireWire/Thunderbolt: इंटरपोलेशन के साथ माइक्रो-फ्रेम ड्रॉपआउट्स
  - Dante/AES67/AVB: नेटवर्क ऑडियो पैकेट लॉस (64/128/256 नमूने)
  - Bluetooth A2DP/LE: छुपाव के साथ वायरलेस ट्रांसमिशन त्रुटियां
  - WiSA: वायरलेस स्पीकर FEC ब्लॉक त्रुटियां
  - RF Systems: रेडियो फ्रीक्वेंसी स्क्वेल्च और हस्तक्षेप
  - CD Audio: CIRC त्रुटि सुधार अनुकरण
  - डिफ़ॉल्ट: CD Audio — CIRC Error Correction (Interpolated)
- **Reference Fs (kHz)** - टाइमिंग गणना के लिए संदर्भ नमूना दर सेट करता है
  - उपलब्ध दरें: 44.1, 48, 88.2, 96, 176.4, 192 kHz
  - केवल Dante/AES67/AVB packet-loss modes पर लागू होता है
  - 64/128/256 sample packet length की actual time duration को scale करता है
  - डिफ़ॉल्ट: 48 kHz
- **Wet Mix** - मूल और प्रसंस्कृत ऑडियो के मिश्रण को नियंत्रित करता है (0-100%)
  - नोट: वास्तविक डिजिटल त्रुटि अनुकरण के लिए, 100% पर रखें
  - कम मान अवास्तविक "आंशिक" त्रुटियां बनाते हैं जो वास्तविक डिजिटल सिस्टम में नहीं होतीं
  - डिफ़ॉल्ट: 100% (प्रामाणिक डिजिटल त्रुटि व्यवहार)

### मोड विवरण

**डिजिटल इंटरफेस:**
- AES3/S-PDIF: पिछले नमूना होल्ड के साथ एकल नमूना त्रुटियां
- ADAT/TDIF/MADI: 32-नमूना बर्स्ट त्रुटियां - अंतिम अच्छे नमूने होल्ड करें या म्यूट करें
- HDMI/DisplayPort: बिट-स्तर त्रुटियों या पूर्ण म्यूटिंग के साथ 192-नमूना रो करप्शन

**कंप्यूटर ऑडियो:**
- USB/FireWire/Thunderbolt: इंटरपोलेशन छुपाव के साथ माइक्रो-फ्रेम ड्रॉपआउट्स
- नेटवर्क ऑडियो (Dante/AES67/AVB): विभिन्न आकार विकल्प और छुपाव के साथ पैकेट लॉस

**उपभोक्ता वायरलेस:**
- Bluetooth A2DP: वार्बल और डिके आर्टिफैक्ट्स के साथ पोस्ट-कोडेक ट्रांसमिशन त्रुटियां
- Bluetooth LE: उच्च आवृत्ति फिल्टरिंग और शोर के साथ बेहतर छुपाव
- WiSA: वायरलेस स्पीकर FEC ब्लॉक म्यूटिंग

**विशेष सिस्टम:**
- RF Systems: रेडियो हस्तक्षेप का अनुकरण करने वाले परिवर्तनीय लंबाई स्क्वेल्च इवेंट्स
- CD Audio: Reed-Solomon शैली व्यवहार के साथ CIRC त्रुटि सुधार अनुकरण

### विभिन्न शैलियों के लिए अनुशंसित सेटिंग्स

1. सूक्ष्म डिजिटल इंटरफेस चरित्र
   - मोड: AES3 / S-PDIF (I²S) — Bit Error (Hold), BER: 10^-8, Fs: 48kHz, Wet: 100%
   - बिल्कुल सही: हल्की, कभी-कभार आने वाली डिजिटल अपूर्णताएं जोड़ने के लिए

2. क्लासिक सीडी प्लेयर अनुभव
   - मोड: CD Audio — CIRC Error Correction (Interpolated), BER: 10^-7, Fs: 44.1kHz, Wet: 100%
   - बिल्कुल सही: 90s डिजिटल संगीत नॉस्टैल्जिया के लिए

3. आधुनिक स्ट्रीमिंग ग्लिच
   - मोड: Dante / AES67 / AVB — UDP Drop (128 samp), BER: 10^-6, Fs: 48kHz, Wet: 100%
   - बिल्कुल सही: समकालीन डिजिटल जीवन की अपूर्णताओं के लिए

4. ब्लूटूथ श्रवण अनुभव
   - मोड: Bluetooth A2DP — Digital Transmission, BER: 10^-6, Fs: 48kHz, Wet: 100%
   - बिल्कुल सही: वायरलेस ऑडियो यादों के लिए

5. वायरलेस ड्रॉपआउट बनावट
   - मोड: WMAS / DECT / Axient — RF Squelch, BER: 10^-5, Fs: 48kHz, Wet: 100%
   - बिल्कुल सही: स्पष्ट रेडियो-शैली रुकावटों और ग्लिच बनावट के लिए

नोट: सभी अनुशंसाएं वास्तविक डिजिटल त्रुटि व्यवहार के लिए 100% वेट मिक्स का उपयोग करती हैं। कम वेट मिक्स मान रचनात्मक प्रभावों के लिए उपयोग किए जा सकते हैं, लेकिन वे वास्तविक डिजिटल त्रुटियों के वास्तव में होने के तरीके का प्रतिनिधित्व नहीं करते।

## DSD64 IMD Simulator

एक प्रभाव जो DSD64 प्लेबैक के एक सूक्ष्म, अक्सर बहस में रहने वाले साइड इफेक्ट को फिर से बनाता है: DSD श्रव्य रेंज से ऊपर जो अल्ट्रासोनिक शोर ले जाता है, वह वास्तविक DAC, एम्प्लिफायर और स्पीकर की छोटी-छोटी अपूर्णताओं के कारण इंटरमॉड्यूलेशन डिस्टॉर्शन (IMD) पैदा कर सकता है — अतिरिक्त खुरदुरापन और टोन जो नीचे आकर उस रेंज में आ जाते हैं जिसे आप सुन सकते हैं। यह प्रभाव उसी श्रव्य परिणाम को पुनः उत्पन्न करता है ताकि आप उसे सुन सकें और समायोजित कर सकें। यह एक सिमुलेशन है और कोई वास्तविक DSD स्ट्रीम उत्पन्न नहीं करता।

**इस प्रभाव के लिए 88.2 kHz या उससे अधिक की सैंपल रेट आवश्यक है** (88.2 / 96 / 176.4 / 192 kHz)। 44.1 / 48 kHz पर यह काम नहीं कर सकता और बायपास हो जाता है (dry सिग्नल बिना किसी बदलाव के गुजर जाता है) और एक चेतावनी दिखाई जाती है। इस प्रभाव का उपयोग करने के लिए ऐप की ऑडियो सेटिंग्स में सैंपल रेट को 88.2 kHz या उससे अधिक पर सेट करें।

### ध्वनि चरित्र गाइड
- बहुत सूक्ष्म "डिजिटल खुरदुरापन": एक हल्का, स्थिर रेतीला शोर तल और साथ ही एक महीन कठोरता जो संगीत के साथ चलती है।
- प्रदर्शन उपकरण: आम तौर पर अश्रव्य रहने वाले DSD64 अल्ट्रासोनिक IMD को श्रव्य और समायोज्य बनाता है।
- रचनात्मक बनावट: अधिक Amount और Analog Nonlinearity के साथ यह एक स्पष्ट lo-fi स्क्रैच/एज प्रभाव बन जाता है।

### पैरामीटर

मुख्य पैरामीटर
- **Amount** (-40.0 से +50.0 dB) - उत्पन्न डिस्टॉर्शन का समग्र स्तर।
- **Dry-Wet** (100:0 से 0:100) - dry सिग्नल और उत्पन्न डिस्टॉर्शन का संतुलन, dry:wet अनुपात के रूप में दिखाया गया। 100:0 = केवल dry; 100:100 (केंद्र) = पूर्ण dry के साथ पूर्ण डिस्टॉर्शन; 0:100 = केवल डिस्टॉर्शन।
- **Ultrasonic Level** (-48.0 से -18.0 dBFS RMS) - सिमुलेटेड DSD अल्ट्रासोनिक शोर का स्तर। अधिक शोर अधिक डिस्टॉर्शन उत्पन्न करता है।
- **Noise Color** (-100 से +100%) - अल्ट्रासोनिक शोर को आवृत्ति में नीचे या ऊपर ले जाता है और उसके संतुलन को झुकाता है।
- **Analog Nonlinearity** (0.00 से 10.00%) - सिमुलेटेड एनालॉग गियर कितना अपूर्ण (नॉन-लीनियर) है। उच्च मान अधिक डिस्टॉर्शन उत्पन्न करते हैं।
- **Even Bias** (0 से 100%) - डिस्टॉर्शन की संरचना को संतुलित करता है। कम मान संगीत का अनुसरण करने वाले डिस्टॉर्शन (Attached) को प्रमुख बनाते हैं; अधिक मान इनपुट से स्वतंत्र स्थिर, शोर-जैसे डिस्टॉर्शन (Additive) तथा Cross घटक को प्रमुख बनाते हैं।
- **Signal Coupling** (0 से 200%) - संगीत पर निर्भर डिस्टॉर्शन (Attached और Cross) की तीव्रता। 0 पर केवल स्थिर Additive शोर शेष रहता है।
- **IMD Path HPF** (0.0 से 8.0 kHz) - डिस्टॉर्शन उत्पादन को इस बिंदु से ऊपर की आवृत्तियों तक सीमित करता है। 0.0 = Off (पूर्ण-रेंज, एक एम्प्लिफायर की तरह); लगभग 2.5 kHz एक ऐसे सिस्टम का अनुकरण करता है जहाँ केवल ट्वीटर डिस्टॉर्शन उत्पन्न करता है। dry सिग्नल कभी प्रभावित नहीं होता।
- **Scratch Tone** (3.0 से 14.0 kHz) - श्रव्य "स्क्रैच" चरित्र की केंद्र आवृत्ति।

उन्नत / उपयोगिता पैरामीटर
- **Noise Texture** (0 से 100%) - थोड़ी अलग बनावट के लिए अल्ट्रासोनिक शोर में रेज़ोनेंट रिपल जोड़ता है।
- **Cross Sideband** (0 से 100%) - संगीत के अल्ट्रासोनिक शोर के साथ मिश्रित होने से उत्पन्न डिस्टॉर्शन की मात्रा।
- **Output Trim** (-24.0 से +12.0 dB) - अंतिम आउटपुट स्तर समायोजन।

### विज़ुअलाइज़ेशन
- **Term Contribution मीटर** - प्रभाव के प्रत्येक भाग के रियल-टाइम स्तर:
  - **Additive** - केवल शोर वाला स्थिर डिस्टॉर्शन, जो बिना किसी इनपुट के भी मौजूद रहता है।
  - **Attached** - डिस्टॉर्शन जो संगीत से जुड़ता है और उसका अनुसरण करता है।
  - **Cross** - संगीत के अल्ट्रासोनिक शोर के साथ मिश्रित होने से उत्पन्न डिस्टॉर्शन।
  - **Total IMD** - उत्पन्न होने वाला संयुक्त डिस्टॉर्शन।
  - **Output** - अंतिम आउटपुट स्तर (dry के साथ डिस्टॉर्शन, Dry-Wet और Output Trim के बाद)।
- **Analog Transfer Curve** - Analog Nonlinearity और Even Bias द्वारा बनाए गए डिस्टॉर्शन वक्र को दिखाता है, उसी in/out शैली में जैसी Saturation प्लगइन में होती है।
- **Difference-Frequency दृश्य** - एक स्थिर ग्राफ जो दिखाता है कि वर्तमान शोर सेटिंग्स के आधार पर अल्ट्रासोनिक शोर कौन-सी श्रव्य आवृत्तियाँ उत्पन्न करता है।

### अनुशंसित सेटिंग्स
- सूक्ष्म (डिफ़ॉल्ट): Amount +24 dB, Ultrasonic Level -30 dBFS, Analog Nonlinearity 1.40%, Even Bias 20%, Signal Coupling 150%, Cross Sideband 75%, Scratch Tone 10.5 kHz।
- केवल-ट्वीटर IMD: IMD Path HPF 2.5 kHz, Signal Coupling 80–150%, Cross Sideband 50–100%, Scratch Tone 9–14 kHz।
- स्पष्ट प्रभाव: Amount, Ultrasonic Level और Analog Nonlinearity बढ़ाएं।

## FM Radio Simulator

FM Radio Simulator संगीत को एक मॉडल की गई FM प्रसारण और रिसीवर श्रृंखला से गुज़ारता है: प्रसारण ऑडियो प्रोसेसिंग और प्री-एम्फ़ेसिस, 19 kHz पायलट के साथ स्टीरियो मल्टीप्लेक्स (MPX) संयोजन, कैरियर का FM मॉड्यूलेशन, मल्टीपाथ प्रसार और एंटीना शोर, रिसीवर ट्यूनिंग, IF फ़िल्टरिंग, हार्ड लिमिटिंग, FM डिस्क्रिमिनेशन, पायलट-PLL स्टीरियो डिकोडिंग और डी-एम्फ़ेसिस। चूँकि सिग्नल वास्तव में FM मॉड्यूलेट और डिमॉड्यूलेट होता है, FM रिसेप्शन के विशिष्ट व्यवहार संश्लेषित होने के बजाय भौतिकी से उभरते हैं: सिग्नल कमज़ोर होने पर उठती चमकीली फुसफुसाहट (हिस), स्टीरियो का शोर दंड और मोनो की ओर स्वचालित ब्लेंड, FM थ्रेशोल्ड के नीचे क्लिक और स्पटर शोर, तथा मल्टीपाथ विकृति।

इस इफ़ेक्ट के लिए ऐसा वातावरण आवश्यक है जो इसकी रियल-टाइम प्रोसेसिंग का समर्थन करे। जब वह प्रोसेसिंग उपलब्ध नहीं होती, ऑडियो अपरिवर्तित रहता है और HUD बताता है कि इफ़ेक्ट अनुपलब्ध है।

### जोड़कर मिलाए जाने वाले lo-fi effects से अंतर

- **FM Radio Simulator** "रेडियो जैसा" शोर संश्लेषित करके ऊपर नहीं मिलाता। यह संगीत को कैरियर पर मॉड्यूलेट करता है, उस कैरियर को शोर, मल्टीपाथ और डीट्यूनिंग के ज़रिए विकृत करता है और फिर डिमॉड्यूलेट करता है। हिस, क्लिक और विकृति केवल वहीं प्रकट होते हैं जहाँ रिसीवर की भौतिकी उन्हें बनाती है, और वे Signal, Tuning, IF फ़िल्टर और स्टीरियो डिकोडर पर प्रतिक्रिया करते हुए वही भौतिक प्रवृत्तियाँ दिखाते हैं जो वास्तविक FM रिसेप्शन में दिखती हैं।
- **Noise Blender** संगीत को बदले बिना एक स्थिर पृष्ठभूमि शोर बनावट जोड़ता है; जब केवल माहौल चाहिए तो इसे चुनें। इसे इस इफ़ेक्ट के बाद चेन करके इंजन-इग्निशन जैसी आवेगी बाधाओं की जगह भी इस्तेमाल किया जा सकता है, जो इस मॉडल में शामिल नहीं हैं।
- **Digital Error Emulator** ड्रॉपआउट और कंसीलमेंट कलाकृतियों जैसी डिजिटल संचरण त्रुटियाँ पुनरुत्पादित करता है — यह एनालॉग FM रिसेप्शन से अलग तरह की गिरावट है।
- **AM Radio Simulator** AM प्रसारण के लिए समकक्ष भौतिक मॉडल है; FM Radio Simulator स्टीरियो मल्टीप्लेक्स, पायलट लॉक और FM-विशिष्ट शोर व्यवहार के साथ वाइडबैंड FM ध्वनि को पुनरुत्पादित करता है।

### ध्वनि चरित्र गाइड

- **साफ़ प्रसारण:** मज़बूत सिग्नल के साथ श्रृंखला मुख्यतः प्रसारण प्रोसेसिंग ही जोड़ती है — 15 kHz बैंडविड्थ सीमा और Processing से तय स्टेशन के लिमिटर की सघनता।
- **कमज़ोर सिग्नल की हिस:** Signal घटाने पर चमकीली, हवादार हिस पहले स्टीरियो में उठती है। Stereo को Mono पर करने से वही रिसेप्शन स्पष्ट रूप से शांत हो जाता है — यही वह कारण है जिससे असली ट्यूनर पर मोनो शांत सुनाई देता है।
- **कवरेज सीमा पर रिसेप्शन:** FM थ्रेशोल्ड के पास क्लिक और स्पटर प्रकट होते हैं, रिसीवर मोनो की ओर ब्लेंड करता है, और अंततः कार्यक्रम शोर में डूब जाता है।
- **मल्टीपाथ का रंग:** परावर्तन एक कठोर, खोखली विकृति जोड़ते हैं जिसका चरित्र Path Delay के साथ बदलता है; Fading बढ़ाने पर यह चलती गाड़ी के रिसेप्शन जैसी फड़फड़ाहट बन जाती है।

### पैरामीटर

- **Radio** (चालू या बंद) - स्टेशन का प्रसारण चालू या बंद करता है। बंद करने पर कैरियर पूरी तरह गायब हो जाता है, इसलिए रिसीवर के पास लिमिट करने को अपने शोर तल के अलावा कुछ नहीं बचता और खाली चैनल की पूरे स्तर वाली हिस सुनाई देने लगती है। इससे किसी स्टेशन के प्रसारण शुरू करने या बंद होने का क्षण सुना जा सकता है। यह इफ़ेक्ट को बंद करने जैसा नहीं है — वहाँ संगीत ज्यों का त्यों निकल जाता है।
- **Emphasis** (50 या 75 µs) - प्री-एम्फ़ेसिस/डी-एम्फ़ेसिस समय-स्थिरांक युग्म चुनता है (50 µs: जापान/यूरोप, 75 µs: अमेरिका)। साफ़ सिग्नल पर यह युग्म लगभग निरस्त हो जाता है; चुनाव हिस और विकृति के रंग को सूक्ष्म रूप से बदलता है।
- **Processing** (0 से +18 dB) - प्रसारण लिमिटर का ड्राइव — स्टेशन की "लाउडनेस"। 0 dB लगभग पारदर्शी है; ऊँचे मान भारी प्रोसेस किए गए स्टेशनों की तरह अधिक सघन और ऊँचे सुनाई देते हैं।
- **Signal** (0 से 70 dBµV) - एंटीना इनपुट पर कैरियर स्तर। शोर तल भौतिकी से नियत है (75 Ω तापीय शोर और रिसीवर का नॉइज़ फ़िगर), इसलिए यह नियंत्रण कैरियर-टू-नॉइज़ अनुपात तय करता है और गिरावट की मुख्य धुरी है। लगभग 50 dBµV और ऊपर रिसेप्शन प्रायः साफ़ है; 30 के पास स्टीरियो हिस स्पष्ट सुनाई देती है; 15 के पास Auto ब्लेंड मोनो में जा चुका होता है; 6 और नीचे क्लिक बहुगुणित हो जाते हैं और कार्यक्रम शोर में डूब जाता है।
- **Tuning** (-200 से +200 kHz) - रिसीवर को स्टेशन से विचलित करता है। छोटे विचलन लगभग अनसुने रहते हैं; लगभग ±40 kHz से ध्वनि उत्तरोत्तर विकृत, विषम और धीमी होती जाती है क्योंकि साइडबैंड IF पासबैंड से बाहर खिसकते हैं। ±200 kHz पर स्टेशन पूरी तरह पासबैंड से बाहर हो जाता है और केवल रिसीवर का शोर बचता है।
- **IF Band** (80 से 240 kHz) - रिसीवर के IF फ़िल्टर की चौड़ाई। संकरे मान भीड़भाड़ वाले बैंड के लिए बने रिसीवर को दर्शाते हैं: वे FM साइडबैंड काटते हैं और विकृति बढ़ाते हैं, विशेषकर डीट्यूनिंग के साथ। मज़बूत, केंद्रित स्टेशन के लिए चौड़े मान अधिक साफ़ होते हैं।
- **Multipath** (0 से 100%) - दो विलंबित परावर्तनों की प्रभाव मात्रा: 100% पर पहला परावर्तन सीधी तरंग के बराबर आयाम का होता है और दूसरा उसका 60%। परावर्तन बढ़ने पर व्यतिकरण शून्य गहरे होते जाते हैं और FM को ऐसे आयाम व कला त्रुटियों में बदल देते हैं जिन्हें लिमिटर पूरी तरह नहीं हटा सकता — कम सेटिंग पर हल्की रंगत से लेकर 100% के पास गंभीर मल्टीपाथ की कठोर, चटचटाती विकृति तक।
- **Path Delay** (0.5 से 50 µs) - पहले परावर्तन का विलंब (दूसरा 2.7 गुना पर स्थिर)। छोटे विलंब चौड़ा, फेज़-जैसा रंग देते हैं; लंबे विलंब अधिक तीखी, स्थानीयकृत विकृति उत्पन्न करते हैं।
- **Fading** (0 से 20 Hz) - परावर्तन कलाओं की घूर्णन दर। 0 Hz मल्टीपाथ पैटर्न को स्थिर कर देता है; ऊँचे मान चलती कार में रिसेप्शन की फड़फड़ाहट और "पिकेट-फेंसिंग" बनाते हैं।
- **Stereo** (Auto / Stereo / Mono) - Auto असली रिसीवर की तरह पायलट लॉक और सिग्नल गुणवत्ता घटने पर स्टीरियो से मोनो की ओर सतत ब्लेंड करता है। Stereo डिकोडर को बाध्य करता है और कमज़ोर सिग्नल पर स्टीरियो का पूरा शोर दंड सुनाता है। Mono L−R उपचैनल त्याग देता है जिससे कमज़ोर सिग्नल का रिसेप्शन स्पष्ट रूप से शांत होता है।
- **Output** (-24 से +24 dB) - डिमॉड्यूलेशन के बाद आउटपुट ट्रिम।
- **Mix** (0 से 100%) - डिमॉड्यूलेट सिग्नल को विलंब-संरेखित ड्राई सिग्नल के साथ मिलाता है। 100% पूर्ण रेडियो रिसेप्शन है; कम मान बिना कंघी-फ़िल्टरिंग के मूल को वापस मिलाते हैं।

### HUD पढ़ना

- ग्राफ़ लघुगणकीय आवृत्ति अक्ष पर डिमॉड्यूलेटर आउटपुट का **MPX स्पेक्ट्रम** दिखाता है, जिसमें 15 kHz (L+R क्षेत्र का अंत), 19 kHz पायलट और 38 kHz के आसपास के L−R उपचैनल (23 से 53 kHz बैंड) पर चिह्न हैं। Signal घटने पर शोर तल ऊँची आवृत्तियों की ओर अधिक उठता है — FM का विशिष्ट त्रिभुजाकार शोर स्पेक्ट्रम — और पहले L−R क्षेत्र को निगलता है। यही दृश्य कारण है कि स्टीरियो, मोनो से पहले शोरयुक्त हो जाता है।
- **सिग्नल मीटर और dBµV पाठ्यांक** प्राप्त कैरियर स्तर दिखाते हैं, जो Signal से तय होता है और मल्टीपाथ व्यतिकरण से घटता-बढ़ता रहता है।
- **CNR** अनुमानित कैरियर-टू-नॉइज़ अनुपात है। लगभग 12 dB के FM थ्रेशोल्ड के पास पहुँचने पर क्लिक दिखने लगते हैं।
- **ST संकेतक और प्रतिशत** वर्तमान स्टीरियो ब्लेंड दिखाते हैं: 100% पूर्ण स्टीरियो, 0% मोनो। Stereo के Auto पर होने पर सिग्नल बिगड़ने के साथ प्रतिशत गिरता है।
- **MPath** सीधी तरंग के सापेक्ष पहले परावर्तन का स्तर dB में दिखाता है (Multipath 0% होने पर −∞)।
- **Clicks** हाल के FM थ्रेशोल्ड क्लिकों की प्रति सेकंड गिनती है और बार-बार होने पर उभारा जाता है।
- **WASM** इंजन उपलब्ध न होने पर HUD एक सूचना दिखाता है और ऑडियो बिना बदलाव pass होता है।

### सुझाई गई सेटिंग

1. **मज़बूत स्थानीय स्टेशन**
   - Emphasis: 50 µs, Processing: 6 dB, Signal: 50 dBµV, Tuning: 0 kHz, IF Band: 230 kHz
   - Multipath: 0%, Fading: 0 Hz, Stereo: Auto, Mix: 100%
   - केवल प्रसारण प्रोसेसिंग के चरित्र वाला साफ़ स्टीरियो। स्टेशनों की ध्वनि तुलना के लिए Processing बढ़ाएँ।

2. **उपनगरीय रिसेप्शन**
   - Signal: 30 dBµV, Tuning: 0 kHz, IF Band: 230 kHz, Multipath: 20%, Path Delay: 5 µs, Fading: 0.5 Hz
   - Stereo: Auto, Mix: 100%
   - संगीत के ऊपर स्टीरियो हिस स्पष्ट सुनाई देती है। Stereo: Mono से तुलना करें और स्टीरियो शोर दंड को गायब होते सुनें।

3. **कवरेज के किनारे का रिसेप्शन**
   - Signal: 15 dBµV, IF Band: 180 kHz, Multipath: 40%, Path Delay: 12 µs, Fading: 2 Hz
   - Stereo: Auto, Mix: 100%
   - Auto ब्लेंड मोनो में जा चुका है और रिसेप्शन फड़फड़ाता है। Stereo बाध्य करके सुनें कि रिसीवर ब्लेंड क्यों करते हैं।

4. **बमुश्किल पकड़ में आता सिग्नल**
   - Signal: 6 dBµV, Tuning: +30 kHz, Multipath: 60%, Path Delay: 12 µs, Fading: 5 Hz
   - Stereo: Auto, Mix: 100%
   - FM थ्रेशोल्ड के नीचे: चटचटाते क्लिक, भारी शोर और स्थैतिक में आता-जाता कार्यक्रम।

### मॉडल संबंधी टिप्पणियाँ

यह इफ़ेक्ट पहले स्टीरियो युग्म को एक ही प्रसारण श्रृंखला के रूप में प्रोसेस करता है; मोनो इनपुट खाली L−R चैनल के साथ प्रसारित होता है। RDS, समीपवर्ती स्टेशन और व्यतिकरण स्रोत इस मॉडल से बाहर हैं। मल्टीबैंड "बड़े स्टेशन" की ध्वनि के लिए इस इफ़ेक्ट से पहले Multiband Compressor रखें; आवेगी बाधाओं के लिए इसके बाद Noise Blender या Digital Error Emulator चेन करें।

## G.726 Simulator

G.726 Simulator चुने हुए mono channel या stereo pair को वास्तविक 8 kHz ITU-T G.726 encode/decode round trip से गुज़ारता है। Stereo pair को encoding से पहले mono में मिलाया जाता है और decoded signal दोनों चुने हुए channels को दिया जाता है। इससे digital telephone speech coding की bandwidth, adaptive differential quantization और prediction-error की प्रकृति सुनी जा सकती है। Bit Error Rate के default मान पर path पूरी तरह साफ़ रहता है; इसे बढ़ाने पर DECT जैसी wireless link की bit errors जुड़ जाती हैं।

16, 24, 32 और 40 kbit/s G.726 की चार standard rates हैं। Default 32 kbit/s ऐतिहासिक DECT full-slot speech mode है। कम rate पर हर 8 kHz sample के लिए कम bits मिलते हैं, जिससे granular quantization, खुरदरे sustained tones और slope overload अधिक स्पष्ट होते हैं। Codec speech के लिए बना है, इसलिए full-band music इसकी सीमाएँ साफ़ दिखाता है।

इस effect को WebAssembly processing engine चाहिए। Engine, sample rate या channel mode उपलब्ध न हो तो input बदले बिना रहता है और plugin सरल status message दिखाता है। Suspension के बाद processing फिर शुरू होने पर resamplers और codec prediction state साथ में reset होते हैं, इसलिए suspension से पहले buffer हुआ audio दोबारा नहीं बजता।

### ध्वनि सुधार मार्गदर्शिका

- **प्रतिनिधि telephone speech:** 32 kbit/s, Output 0 dB और Mix 100% से शुरू करें। Speech पर 8 kHz narrow band और adaptive ADPCM texture सबसे स्पष्ट सुनाई देते हैं।
- **Rates की तुलना:** उसी speech passage पर 40, 32, 24 और 16 kbit/s बदलें। कम rates पर vowels की grain, sustained tones की roughness और अचानक level बदलने के बाद recovery सुनें।
- **Music से सीमा जाँचें:** 16 या 24 kbit/s पर percussion, bright sustained notes या dense mixes bandwidth limit और prediction errors को अधिक स्पष्ट करते हैं।
- **Radio bit errors जोड़ें:** Bit Error Rate को -4.5 से -2 की ओर बढ़ाएँ और सुनें कि code words कैसे चटकने और खुरदरे हिस्सों में टूटते हैं। साफ़ encode/decode तुलना के लिए इसे -6 पर रखें।
- **Effect मिलाएँ:** मूल signal का कुछ भाग रखने के लिए Mix घटाएँ। Dry path decoded path के साथ latency-aligned है।
- **Level मिलाएँ:** Output केवल loudness difference की भरपाई करता है; G.726 bit allocation नहीं बदलता।

### Parameters

- **Bitrate** — 16, 24, 32 या 40 kbit/s चुनता है। हर 8 kHz sample क्रमशः 2, 3, 4 या 5 bit ADPCM इस्तेमाल करता है; कम settings quantization और prediction artifacts बढ़ाती हैं।
- **Output** — Codec state या bitrate बदले बिना decoded level को -24.0 से +12.0 dB तक समायोजित करता है।
- **Mix** — Latency-aligned original और decoded result को 0% से 100% तक मिलाता है।
- **Bit Error Rate** — Wireless link की bit error rate को दस की घात के रूप में -6 से -2 तक सेट करता है (default -6)। -6 पर path पूरी तरह error-free रहता है। मान बढ़ाने पर ADPCM code words में अधिक bits पलटते हैं, जिससे कमज़ोर DECT जैसी radio link वाली चटकने की आवाज़ आती है।

## GSM-FR Simulator

Audio output में एक channel होने पर GSM-FR Simulator उस channel को सीधे process करता है। दो या अधिक output channels होने पर यह चुने हुए stereo pair को mono में मिलाता है। इसके बाद mono signal को 8 kHz पर resample करके मानकीकृत 13 kbit/s GSM-FR RPE-LTP encoder और decoder से गुज़ारा जाता है। Decoded result एकमात्र output channel में, या चुने हुए pair के दोनों channels में वापस भेजा जाता है। इससे यह परखा जा सकता है कि शुरुआती digital mobile speech coding आवाज़, percussion, sustained tones और घने music को कैसे बदलती है। C/I के default मान पर path पूरी तरह साफ़ रहता है; इसे घटाने पर कमज़ोर GSM reception जैसा असर आता है।

हर 20 ms frame को quantized linear prediction, long-term prediction और regular-pulse excitation parameters से दर्शाया जाता है। Transcodes पूरी encode/decode stage को अलग-अलग state के साथ दोहराता है, इसलिए यह सामान्य “quality” control नहीं, बल्कि वास्तविक tandem coding को दोहराता है। चुने हुए stereo pair के बाद के अतिरिक्त channels बिना बदलाव के रहते हैं।

इस effect को अपने WebAssembly processing engine की ज़रूरत होती है। अगर engine, चुना हुआ sample rate या channel mode उपलब्ध न हो, तो input बिना बदलाव के रहता है और plugin साफ़ status message दिखाता है। Suspension के बाद processing दोबारा शुरू होने पर resamplers, frame buffers और codec state साथ में reset होते हैं, इसलिए suspension से पहले buffer हुआ audio दोबारा नहीं बजता।

### साउंड एन्हांसमेंट गाइड

- **शुरुआती mobile speech की प्रतिनिधि setting:** Transcodes को 1, Output को 0 dB और Mix को 100% पर रखें, फिर आवाज़, cymbals और percussion की bypass से तुलना करें।
- **Tandem coding सुनें:** उसी passage पर Transcodes को 1 से 2 और फिर 3 करें। Signal को सच में दोबारा encode और decode किए जाने से warble, chirping और clarity loss बढ़ते हैं; radio reception errors अलग हैं: C/I 30 dB पर कोई error नहीं होता, और मान घटाने पर वे पुनः बनते हैं।
- **Music से speech model पहचानें:** चमकीले या घने music पर Transcodes 3 इस्तेमाल करें, ताकि 8 kHz speech bandwidth, RPE-LTP buzz और formant बदलाव अधिक स्पष्ट हों।
- **Result मिलाएँ:** मूल stereo signal का कुछ हिस्सा वापस लाने के लिए Mix घटाएँ। Dry path codec latency के साथ aligned रहता है।
- **तुलना से पहले level मिलाएँ:** सुनाई देने वाले या मापे गए loudness अंतर की भरपाई केवल Output से करें। इससे codec algorithm नहीं बदलता।

### पैरामीटर

- **Transcodes** — पूरे GSM-FR encode/decode process के 1, 2 या 3 passes चुनता है। हर pass का state स्वतंत्र होता है और वही 13 kbit/s codec इस्तेमाल होता है। ऊँचे मान tandem-coding artifacts बढ़ाते हैं।
- **Output** — Decoded output level को -24.0 से +12.0 dB तक समायोजित करता है। यह level matching के लिए है; codec state या bitrate नहीं बदलता।
- **Mix** — Latency-aligned original signal और decoded result को 0% से 100% तक मिलाता है। 100% पर चुने हुए stereo pair के दोनों channels में एक ही decoded mono signal आता है; कम मान मूल stereo अंतर वापस लाते हैं।
- **C/I** — Radio link का carrier-to-interference अनुपात 4 से 30 dB तक सेट करता है (default 30)। 30 dB पर reception व्यावहारिक रूप से पूर्ण रहता है। मान घटाने पर frame erasures (GSM 06.11 शैली का concealment: पिछला frame दोहराना और घटाना, लगातार loss पर mute) और Class 2 bit errors की distortion बढ़ती है, जिससे network की सीमा पर मोबाइल फ़ोन जैसी खरखराती टूटन मिलती है। Transcodes 1 से अधिक होने पर degradation केवल अंतिम hop पर लगता है।

## Hum Generator

50/60 Hz electrical hum की नियंत्रित परत जोड़ता है, जिससे vintage या lo-fi listening mood बनता है। साफ playback बहुत sterile लगे तो कम Level पर इस्तेमाल करें, या साफ सुनाई देने वाले hum texture के लिए Level बढ़ाएं।

### ध्वनि चरित्र गाइड
- विंटेज उपकरण वातावरण:
  - क्लासिक एम्प्लिफायर और उपकरणों की सूक्ष्म हम को पुनर्निर्मित करता है
  - AC पावर से "जुड़े" होने का चरित्र जोड़ता है
  - पुराने playback gear जैसी पृष्ठभूमि ambience बनाता है
- पावर सप्लाई विशेषताएं:
  - विभिन्न प्रकार के पावर सप्लाई शोर का अनुकरण करता है
  - क्षेत्रीय पावर ग्रिड विशेषताओं को पुनर्निर्मित करता है (50Hz बनाम 60Hz)
  - सूक्ष्म विद्युत अवसंरचना चरित्र जोड़ता है
- पृष्ठभूमि बनावट:
  - जैविक, निम्न-स्तरीय पृष्ठभूमि उपस्थिति बनाता है
  - निष्कर्ष डिजिटल रिकॉर्डिंग में गहराई और "जीवन" जोड़ता है
  - पुराने playback gear जैसा mood बनाने के लिए उपयोगी

### पैरामीटर
- **Frequency** - मूल हम आवृत्ति सेट करता है (10-120 Hz)
  - 50 Hz: यूरोपीय/एशियाई पावर ग्रिड मानक
  - 60 Hz: उत्तर अमेरिकी पावर ग्रिड मानक
  - अन्य मान: रचनात्मक प्रभावों के लिए कस्टम आवृत्तियां
- **Type** - हम की हार्मोनिक संरचना को नियंत्रित करता है
  - Standard: केवल विषम हार्मोनिक्स शामिल (अधिक शुद्ध, ट्रांसफार्मर-जैसा)
  - Rich: सभी हार्मोनिक्स शामिल (जटिल, उपकरण-जैसा)
  - Dirty: सूक्ष्म विकृति के साथ समृद्ध हार्मोनिक्स (विंटेज गियर चरित्र)
- **Harmonics** - चमक और हार्मोनिक सामग्री को नियंत्रित करता है (0-100%)
  - 0-30%: न्यूनतम ऊपरी हार्मोनिक्स के साथ गर्म, मैलो हम
  - 30-70%: वास्तविक उपकरण के विशिष्ट संतुलित हार्मोनिक सामग्री
  - 70-100%: मजबूत ऊपरी हार्मोनिक्स के साथ चमकीला, जटिल हम
  - Dirty mode में अधिक Harmonics distortion और roughness भी बढ़ाता है
- **Tone** - अंतिम टोन शेपिंग फिल्टर कटऑफ आवृत्ति (1.0-20.0 kHz)
  - 1-5 kHz: गर्म, मफल्ड चरित्र
  - 5-10 kHz: प्राकृतिक उपकरण-जैसा टोन
  - 10-20 kHz: चमकीला, वर्तमान चरित्र
- **Instability** - सूक्ष्म आवृत्ति और आयाम विविधता की मात्रा (0-10%)
  - 0%: पूर्णतः स्थिर हम (डिजिटल परिशुद्धता)
  - 1-3%: हल्का प्राकृतिक drift
  - 3-10%: अधिक ध्यान देने योग्य लेकिन फिर भी gentle wobble
- **Level** - हम सिग्नल का आउटपुट स्तर (-80.0 से 0.0 dB)
  - -80 से -60 dB: मुश्किल से श्रव्य पृष्ठभूमि उपस्थिति
  - -60 से -40 dB: सूक्ष्म लेकिन ध्यान देने योग्य हम
  - -40 से -20 dB: प्रमुख विंटेज चरित्र
  - -20 से 0 dB: रचनात्मक या विशेष प्रभाव स्तर

### विभिन्न शैलियों के लिए अनुशंसित सेटिंग्स

1. सूक्ष्म विंटेज एम्प्लिफायर
   - Frequency: 50/60 Hz, Type: Standard, Harmonics: 25%
   - Tone: 8.0 kHz, Instability: 1.5%, Level: -54 dB
   - बिल्कुल सही: कोमल विंटेज एम्प्लिफायर चरित्र जोड़ने के लिए

2. क्लासिक विंटेज playback
   - Frequency: 60 Hz, Type: Rich, Harmonics: 45%
   - Tone: 6.0 kHz, Instability: 2.0%, Level: -48 dB
   - बिल्कुल सही: पुराने playback gear जैसी पृष्ठभूमि electrical ambience

3. विंटेज ट्यूब उपकरण
   - Frequency: 50 Hz, Type: Dirty, Harmonics: 60%
   - Tone: 5.0 kHz, Instability: 3.5%, Level: -42 dB
   - बिल्कुल सही: गर्म ट्यूब एम्प्लिफायर चरित्र

4. पावर ग्रिड वातावरण
   - Frequency: 50/60 Hz, Type: Standard, Harmonics: 35%
   - Tone: 10.0 kHz, Instability: 1.0%, Level: -60 dB
   - बिल्कुल सही: वास्तविक पावर सप्लाई पृष्ठभूमि

5. मज़बूत hum texture
   - Frequency: 40 Hz, Type: Dirty, Harmonics: 80%
   - Tone: 15.0 kHz, Instability: 6.0%, Level: -36 dB
   - बिल्कुल सही: अधिक स्पष्ट, सुनाई देने वाली hum texture

## MP3 Codec Simulator

MP3 Codec Simulator चुने हुए चैनलों को real-time में सरल MPEG Layer III analysis, सीमित bit budget वाली spectral quantization और synthesis से गुज़ारता है। इससे आप सुन सकते हैं कि कम bitrate वाला MP3 transients, ऊँची frequencies के detail, sustained tones और stereo image को कैसे बदलता है। यह केवल साफ़ codec round trip का मॉडल है; इसमें damaged file clicks, dropouts, packet loss या transmission errors नहीं जोड़े जाते।

44.1 kHz MPEG-1 profile में 32–320 kbit/s उपलब्ध है। 22.05 kHz MPEG-2 profile में 32–160 kbit/s उपलब्ध है और coded bandwidth अधिक सीमित रहती है। इस effect को WebAssembly processing engine चाहिए; engine, चुना हुआ sample rate या channel mode उपलब्ध न होने पर audio अपरिवर्तित रहता है।

### ध्वनि सुधार मार्गदर्शिका

- MP3 का असर स्पष्ट सुनने के लिए 44.1 kHz, 48 या 64 kbit/s, Joint Stereo, Bit Reservoir On और Mix 100% से शुरू करें। percussion, cymbals, sustained tones और चौड़ी stereo recordings अंतर को आसानी से दिखाती हैं।
- 64 kbit/s की तुलना 128 या 192 kbit/s से करें ताकि अधिक bit budget से बचने वाला detail सुन सकें। अधिक bandwidth limitation के लिए 22.05 kHz पर 32 या 48 kbit/s आज़माएँ।
- शांत और घने हिस्सों वाले track पर Bit Reservoir Off करें। तब हर frame को अपने budget में फिट होना पड़ता है और जटिल transients अधिक खुरदरे हो सकते हैं।

### पैरामीटर

- **Codec Rate** — `44.1 kHz (MPEG-1)` या `22.05 kHz (MPEG-2)` चुनता है और profile, frame structure तथा coded bandwidth बदलता है।
- **Bitrate** — mono या stereo stream का कुल constant bitrate तय करता है। MPEG-1 में अधिकतम 320 kbit/s और MPEG-2 में अधिकतम 160 kbit/s मिलता है।
- **Stereo Mode** — अधिक कुशल होने पर `Joint Stereo` पहले stereo pair को Mid/Side में encode कर सकता है; `Stereo` बाएँ और दाएँ spectra अलग रखता है।
- **Bit Reservoir** — सरल frames की बची capacity को बाद के जटिल frames में इस्तेमाल करने देता है।
- **Output** — decoded level को -24.0 से +12.0 dB तक समायोजित करता है।
- **Mix** — latency-aligned मूल signal और decoded result को 0% से 100% तक मिलाता है।

## Noise Blender

एक प्रभाव जो आपके संगीत में वातावरणीय पृष्ठभूमि बनावट जोड़ता है, विनाइल रिकॉर्ड या विंटेज उपकरणों की ध्वनि के समान। आरामदायक, नॉस्टैल्जिक वातावरण बनाने के लिए बिल्कुल सही।

### ध्वनि चरित्र गाइड
- विंटेज उपकरण ध्वनि:
  - पुराने ऑडियो गियर की गर्माहट को पुनर्निर्मित करता है
  - डिजिटल रिकॉर्डिंग में सूक्ष्म "जीवन" जोड़ता है
  - प्रामाणिक विंटेज अनुभव बनाता है
- विनाइल रिकॉर्ड अनुभव:
  - वह क्लासिक रिकॉर्ड प्लेयर वातावरण जोड़ता है
  - आरामदायक, परिचित भावना बनाता है
  - रात में श्रवण के लिए बिल्कुल सही
- एम्बिएंट बनावट:
  - वातावरणीय पृष्ठभूमि जोड़ता है
  - गहराई और स्थान बनाता है
  - डिजिटल संगीत को अधिक जैविक बनाता है

### पैरामीटर
- **Noise Type** - पृष्ठभूमि बनावट का चरित्र चुनता है
  - White: अधिक चमकीली, अधिक मौजूद बनावट
  - Pink: अधिक गर्म, अधिक प्राकृतिक ध्वनि
  - Brown: अधिक गहरी, मुलायम बनावट जिसमें low-frequency weight अधिक है
- **Level** - प्रभाव कितना ध्यान खींचता है, यह नियंत्रित करता है (-96dB से 0dB)
  - बहुत सूक्ष्म (-96dB से -72dB): बस एक संकेत
  - धीमा (-72dB से -48dB): ध्यान खींचने वाली बनावट
  - मज़बूत (-48dB से -24dB): प्रमुख विंटेज चरित्र
- **Per Channel** - अधिक विस्तृत प्रभाव बनाता है
  - चालू: चौड़ी, अधिक इमर्सिव ध्वनि
  - बंद: अधिक केंद्रित, केंद्रित बनावट

## SBC Codec Simulator

SBC Codec Simulator चुने गए चैनलों को real-time SBC analysis, bit allocation, quantization और synthesis से गुज़ारता है। इससे आप सुन सकते हैं कि Bluetooth A2DP का अनिवार्य baseline codec high-frequency detail, tonal texture, transients और stereo image को कैसे बदलता है। Packet Loss के default मान पर codec round trip पूरी तरह साफ़ रहता है; इसे बढ़ाने पर असली Bluetooth link जैसी आवाज़ की टूटन आती है।

Codec 44.1 kHz sample-rate परिवार के लिए अंदरूनी तौर पर 44.1 kHz और 48 kHz परिवार के लिए 48 kHz पर चलता है। केवल पढ़ने योग्य Bitrate, मौजूदा Bitpool, Channel Mode, Blocks और codec rate के अनुसार सटीक SBC frame length से निकाला जाता है।

इस effect को WebAssembly processing engine चाहिए। Engine, चुना हुआ sample rate या channel mode उपलब्ध न होने पर input में कोई बदलाव नहीं होता और plugin स्पष्ट status message दिखाता है।

### ध्वनि सुधार मार्गदर्शिका

- **सामान्य SBC तुलना:** Bitpool 35, Joint Stereo, 16 Blocks और Mix 100% से शुरू करें। Cymbals, लंबे tones, percussion और चौड़ी stereo recordings पर bypass से तुलना करें।
- **Codec artifacts को अधिक स्पष्ट करना:** Bitpool को 12–20 तक घटाएँ। आठ subbands को कम quantization bits मिलेंगे, इसलिए high-frequency detail में बदलाव और tonal residue अधिक सुनाई देंगे।
- **Stereo allocation की तुलना:** Bitrate देखते हुए Joint Stereo और Stereo बदलें। Joint Stereo correlated stereo content को अधिक कुशलता से code कर सकता है, जबकि Stereo बाएँ और दाएँ subbands अलग रखता है।
- **SBC XQ को दोहराना:** Channel Mode को Dual Channel करें और Bitpool 38 रखें — यही आम तौर पर «SBC XQ» कहलाने वाला विन्यास है; 47 रखने पर «SBC XQ+» मिलता है। 44.1 kHz सामग्री पर Bitrate क्रमशः 452.0 और 551.3 kbit/s दिखाता है, जो प्रचलित आँकड़ों से मेल खाता है। Bitpool 53 पर 617.4 kbit/s मिलता है, जो इस simulator की अधिकतम दर है। ये सभी सेटिंग्स A2DP की अनुशंसित सीमा से बाहर हैं, पर उच्च bitrate वाले SBC transmitter असल में यही भेजते हैं, और यहीं codec को bypass से अलग पहचानना सबसे कठिन होता है।
- **Frame adaptation की तुलना:** Blocks को 16 से 4 करें। छोटे frames scale factors जल्दी update करते हैं, पर fixed overhead का अनुपात बढ़ाते हैं और दिखाया गया bitrate भी बदलते हैं।
- **Wireless dropouts जोड़ना:** Packet Loss को 5–20% तक बढ़ाएँ, ताकि frames का burst में गायब होना और concealment का fade सुनाई दे। साफ़ तुलना के लिए इसे 0% पर रखें।
- **Effect को मिलाना:** SBC character हल्का रखने के लिए Mix घटाएँ। Dry path की latency coded path के साथ aligned रहती है।

### पैरामीटर

- **Bitpool** — हर SBC frame के quantization-bit budget को 2 से 53 तक सेट करता है। `Joint Stereo` और `Stereo` इसे stereo जोड़ी में साझा करते हैं, जबकि `Dual Channel` इसे हर channel को अलग-अलग पूरा देता है। कम मान पर अधिक subbands को बहुत कम या कोई bit नहीं मिलता और codec artifacts बढ़ते हैं। Bitpool सीधे kbit/s नहीं बताता।
- **Channel Mode** — `Joint Stereo` correlated subbands को sum/difference के रूप में code कर सकता है, जब इससे ज़रूरी scale factors घटते हों। `Stereo` बाएँ और दाएँ subbands अलग रखता है। ये दोनों modes पहले stereo pair में एक Bitpool साझा करते हैं; Joint Stereo केवल output को mono नहीं बनाता। `Dual Channel` हर channel को पूरे Bitpool के साथ अपना स्वतंत्र allocation देता है, इसलिए frame और bitrate लगभग दोगुने हो जाते हैं: «SBC XQ» के पीछे यही विन्यास है, और बाएँ-दाएँ स्वतंत्र रूप से quantize होने के कारण stereo image का उतार-चढ़ाव भी Joint Stereo से अलग होता है।
- **Blocks** — हर SBC frame में 4, 8, 12 या 16 subband-sample blocks चुनता है। कम blocks frame को छोटा करते हैं और fixed overhead का अनुपात बढ़ाते हैं; अधिक blocks scale factors को कम बार update करते हैं।
- **Bitrate** — सटीक frame bytes और codec rate से निकला, केवल पढ़ने योग्य मौजूदा stream bitrate (kbit/s)। Bitpool, Channel Mode, Blocks, host sample-rate परिवार या mono और stereo के बीच host output routing बदलने पर यह update होता है।
- **Packet Loss** — Bluetooth link की packet loss दर को 0% से 20% तक सेट करता है (default 0%)। 0% पर कोई frame नहीं खोता। मान बढ़ाने पर पूरे SBC frames burst में गिरते हैं (Gilbert-Elliott model), और built-in concealment पिछले frame को घटाते हुए दोहराता है और फिर silence में fade होता है, जिससे असली wireless link जैसी टूटन मिलती है।
- **Output** — Decoded level को -24.0 से +12.0 dB तक बदलता है। Codec-filter overshoot से peaks बहुत ऊँची हों तो इसे घटाएँ।
- **Mix** — Latency-aligned original और decoded result को 0 से 100% तक मिलाता है।

## Simple Jitter

एक प्रभाव जो वह अपूर्ण, विंटेज डिजिटल ध्वनि बनाने के लिए सूक्ष्म समय विविधताएं जोड़ता है। यह संगीत को ऐसा बना सकता है जैसे वह पुराने CD प्लेयर या विंटेज डिजिटल उपकरणों के माध्यम से बज रहा हो।

### ध्वनि चरित्र गाइड
- सूक्ष्म विंटेज अनुभव:
  - पुराने उपकरणों की तरह धीमी अस्थिरता जोड़ता है
  - अधिक जैविक, कम पूर्ण ध्वनि बनाता है
  - सूक्ष्म रूप से चरित्र जोड़ने के लिए बिल्कुल सही
- क्लासिक CD प्लेयर ध्वनि:
  - प्रारंभिक डिजिटल प्लेयर की ध्वनि को पुनर्निर्मित करता है
  - नॉस्टैल्जिक डिजिटल चरित्र जोड़ता है
  - 90s संगीत सराहना के लिए बढ़िया
- रचनात्मक प्रभाव:
  - अनूठे वॉबल प्रभाव बनाएं
  - आधुनिक ध्वनियों को विंटेज में बदलें
  - प्रयोगात्मक चरित्र जोड़ें

### पैरामीटर
- **RMS Jitter** - समय विविधता की मात्रा को नियंत्रित करता है (1ps से 10ms)
  - सूक्ष्म (1-10ps): धीमा विंटेज चरित्र
  - मध्यम (10-100ps): क्लासिक CD प्लेयर अनुभव
  - मज़बूत (100ps-1ms): रचनात्मक वॉबल प्रभाव

### विभिन्न शैलियों के लिए अनुशंसित सेटिंग्स

1. मुश्किल से महसूस होने वाला
   - RMS Jitter: 1-5ps
   - इसके लिए बिल्कुल सही: प्लेबैक को थोड़ा कम पूर्णतः डिजिटल महसूस कराना

2. क्लासिक CD प्लेयर चरित्र
   - RMS Jitter: 50-100ps
   - इसके लिए बिल्कुल सही: प्रारंभिक डिजिटल प्लेबैक उपकरण की ध्वनि को दोहराना

3. विंटेज DAT मशीन
   - RMS Jitter: 200-500ps
   - इसके लिए बिल्कुल सही: 90s डिजिटल रिकॉर्डिंग उपकरण चरित्र

4. घिसे-पिटे डिजिटल उपकरण
   - RMS Jitter: 1-2ns (1000-2000ps)
   - इसके लिए बिल्कुल सही: पुराने या खराब रूप से रखरखाव किए गए डिजिटल गियर की ध्वनि बनाना

5. रचनात्मक डगमगाहट प्रभाव
   - RMS Jitter: 10-100µs (0.01-0.1ms)
   - इसके लिए बिल्कुल सही: प्रयोगात्मक प्रभाव और ध्यान देने योग्य पिच मॉड्यूलेशन

## SW Radio Simulator

SW Radio Simulator संगीत को एक मॉडल की गई शॉर्टवेव शृंखला से गुजारता है: transmitter processing और AM modulation या single-sideband modulation, गहरी frequency-selective fading वाला आयनमंडलीय प्रसारण, वायुमंडलीय static और उसी चैनल पर बैठा एक दूसरा स्टेशन, envelope, synchronous या BFO detection तथा AGC वाला संकरा communications receiver, और वैकल्पिक रेडियो स्पीकर। इसका उपयोग तब करें जब आप चाहते हैं कि संगीत ऐसा सुनाई दे जैसे कोई दूर का अंतरराष्ट्रीय प्रसारण शॉर्टवेव सेट पर आ रहा हो: संकरा और खोखला, आयनमंडल के साथ ऊपर-नीचे होता हुआ, और वहां सीटी बजाता हुआ जहां पास की आवृत्ति पर कोई और transmitter हो। Mode को USB या LSB पर रखें तो यही शृंखला communications receiver बन जाती है, जहां dial ठीक आवृत्ति पर न होने से पूरी ध्वनि उतने ही Hz खिसक जाती है और नाक से बोली जैसी, बेसुरी हो जाती है।

इस effect के लिए इसकी real-time processing का समर्थन करने वाला वातावरण आवश्यक है। जहां यह processing उपलब्ध नहीं है वहां ऑडियो अपरिवर्तित रहता है और HUD बताता है कि effect उपलब्ध नहीं है।

### AM, FM और जोड़कर मिलाए जाने वाले lo-fi effects से अंतर

- **AM Radio Simulator** मीडियम-वेव reception को model करता है, जहां सामान्यतः स्थिर groundwave प्रमुख रहती है और fading गौण प्रभाव है। इसका passband अधिक चौड़ा है और C-QUAM stereo भी उपलब्ध है।
- **SW Radio Simulator** शॉर्टवेव को model करता है, जहां signal आयनमंडल से परावर्तित होकर पहुंचता है। यहां गहरी frequency-selective fading मुख्य भूमिका में है, ऑडियो बैंड अधिक संकरा है, और उसी चैनल के स्टेशन से बनने वाली heterodyne सीटी भी इस ध्वनि का हिस्सा है। यहां USB और LSB reception भी उपलब्ध है, जो इस सूची के किसी अन्य effect में नहीं है। शॉर्टवेव प्रेषण mono होता है, इसलिए संसाधित signal हमेशा mono रहता है।
- **FM Radio Simulator** stereo multiplex, बढ़ती hiss और threshold clicks के साथ wideband FM को पुनः बनाता है — यह क्षरण का अलग परिवार है।
- **Noise Blender** और **Hum Generator** संगीत बदले बिना उसके ऊपर noise या hum जोड़ते हैं। यह effect इसके बजाय संगीत को modulate, propagate और detect करता है, इसलिए इसका noise, interference और distortion वास्तविक reception की तरह Tuning, IF filter और AGC के अनुसार बदलते हैं।

### ध्वनि चरित्र गाइड

- **संकरा और खोखला:** transmitter bandwidth और संकरा receiver IF अधिकांश treble हटा देते हैं, जिससे शॉर्टवेव सेट जैसा सीमित, डिब्बेनुमा रंग बनता है।
- **धीमी गहरी fading (QSB):** प्राप्त स्तर लगातार ऊपर-नीचे होता रहता है। यही शॉर्टवेव की पहचान है और डिफ़ॉल्ट सेटिंग पर भी सक्रिय रहता है।
- **पानी जैसी fade distortion:** गहरी fade में carrier और sidebands अलग-अलग दर से गिरते हैं, इसलिए envelope detector ऑडियो को साफ तरीके से पुनः नहीं बना पाता। हर fade के तल पर ध्वनि केवल धीमी नहीं होती, बल्कि खोखली, अस्थिर और "पानी के भीतर" जैसी हो जाती है। इसकी तीव्रता Delay Spread से बदलती है, और synchronous detection इसे काफी हद तक हटा देता है।
- **Flutter:** Fading Speed अधिक होने पर ये उतार-चढ़ाव तेज झिलमिलाहट में बदल जाते हैं, जैसे किसी अशांत या ध्रुवीय पथ से reception हो रहा हो।
- **Heterodyne सीटी (QRM):** उसी चैनल का transmitter आपके carrier के साथ beat करता है और ऐसी लगातार ध्वनि बनाता है जिसकी पिच Interf. Offset के बराबर होती है।
- **वायुमंडलीय static (QRN):** दूर की बिजली crashes के रूप में आती है जो IF filter में ringing करती है।
- **Pumping:** fade गुजरने पर AGC स्तर का पीछा करता है और पृष्ठभूमि का noise अंशों के बीच सांस लेता हुआ ऊपर-नीचे होता है।
- **Single-sideband की संकीर्णता (USB, LSB):** पुनः प्राप्त ऑडियो हर Mode में IF Bandwidth के आधे तक ही पहुंचता है — डिफ़ॉल्ट 6 kHz पर लगभग 3 kHz तक — और carrier दबा दिए जाने तथा केवल एक ही sideband भेजे जाने के कारण passband का दूसरा आधा हिस्सा कोई संकेत नहीं ले जाता, केवल noise और interference गुजरने देता है; यही communications चैनल की सूखी, सीमित ध्वनि है।
- **"डोनाल्ड डक" जैसी mistuning (USB, LSB):** BFO हर घटक को गुणा करने के बजाय उतने ही hertz खिसकाता है, इसलिए harmonics मूल आवृत्ति के पूर्णांक गुणज नहीं रह जाते। आवाजें और वाद्य नाक से बोली जैसे और बेसुरे हो जाते हैं, और USB तथा LSB में खिसकाव की दिशा उलटी होती है।
- **अक्षरों के साथ चलता AGC (USB, LSB):** वाक्यांशों के बीच कुछ भी प्रेषित नहीं होता, इसलिए AGC कार्यक्रम का ही अनुसरण करता है। ठहराव में पृष्ठभूमि ऊपर उठती है और हर नया वाक्यांश सुनाई देने वाले attack के साथ शुरू होता है।
- **खामोशी के बाद पहला क्षण तेज:** जब संगीत शुरू होता है — playback की शुरुआत में या किसी अंतराल के बाद — तो खामोशी के दौरान gain पूरा खुला रह जाता है, इसलिए AGC के स्थिर होने से पहले पहला क्षण तेज सुनाई देता है; USB और LSB में यह सबसे स्पष्ट है। शांत चैनल पर चालू किए गए receiver में भी यही होता है, और इसे जानबूझकर वैसा ही रखा गया है।
- **पतली और कटती fade (USB, LSB):** गहरी fade AM के envelope detector जैसी पानी-सी distortion बनाने के बजाय उस अकेले sideband के भीतर आवृत्ति के अनुसार असमान क्षीणन करती है, इसलिए ध्वनि पतली हो जाती है और उसके हिस्से गायब हो जाते हैं।

### पैरामीटर

#### Station

- **Radio** (चालू या बंद) - स्टेशन का प्रसारण चालू या बंद करता है। बंद करने पर carrier पूरी तरह गायब हो जाता है और receiver के पास केवल वायुमंडलीय static, उसी चैनल का स्टेशन और उसका अपना noise बचता है; AGC पूरा खुल जाता है और यही पृष्ठभूमि शोर तेज सुनाई देने लगता है। इससे किसी स्टेशन के प्रसारण शुरू करने या बंद होने का क्षण सुना जा सकता है। यह effect को बंद करने जैसा नहीं है — वहां संगीत ज्यों का त्यों निकल जाता है।
- **TX Bandwidth** (2.0 से 10.0 kHz) - ट्रांसमीटर की ऑडियो बैंडविड्थ तय करता है। शॉर्टवेव प्रसारण चैनल 5 kHz के अंतर पर होते हैं, इसलिए संकरा डिफ़ॉल्ट भी मीडियम-वेव स्टेशन से अधिक गहरा सुनाई देता है; अधिक खुले transmitter के लिए इसे बढ़ाएं।
- **Pre-emphasis** (0 से 100%) - प्रसारण से पहले ऊंची आवृत्तियां बढ़ाता है। अधिक सेटिंग संकरे बैंड में भी उपस्थिति बढ़ाती है, लेकिन चमकीले peaks प्रसारण limiter को अधिक जोर से चलाते हैं।
- **Mod Depth** (10 से 125%) - AM मॉड्यूलेशन की गहराई तय करता है। 100% से ऊपर ओवरमॉड्यूलेशन और negative-peak clipping होता है।
- **Compression** (0 से 20 dB) - प्रसारण limiter की गहराई तय करता है। अधिक सेटिंग peaks को नियंत्रित करके मॉड्यूलेशन को अधिक समान बनाती है — अंतरराष्ट्रीय प्रसारक इसी तरह fade के दौरान भी सुनने योग्य बने रहते हैं।

#### Propagation

- **Signal** (-50 से 0 dB) - प्राप्त signal की ताकत तय करता है। कमजोर सेटिंग पर receiver noise अधिक सुनाई देता है और अधिक AGC gain की जरूरत पड़ती है।
- **Fading** (0 से 100%) - प्राप्त शक्ति को एक स्थिर सीधे पथ और दो विलंबित आयनमंडलीय पथों के बीच बांटता है। 0% पर नजदीकी स्थिर reception मिलता है; डिफ़ॉल्ट मान दूर के signal जैसी लगातार fading देता है; 100% पर fade सबसे गहरे और selective-fade distortion सबसे तेज होता है।
- **Fading Speed** (0.1 से 10.0 Hz) - आयनमंडलीय पथों के बदलने की गति तय करता है। कम मान धीमे उतार-चढ़ाव देते हैं; कुछ hertz से ऊपर यह गति तेज flutter में बदल जाती है।
- **Delay Spread** (0.2 से 8.0 ms) - दोनों आयनमंडलीय पथों के बीच विलंब का अंतर तय करता है। यह तय करता है कि ऑडियो बैंड में fading के notches कितने पास-पास होंगे (1 ms पर लगभग 1 kHz की दूरी, और मान बढ़ने पर और पास), और इसी कारण गहरी fade केवल धीमी होने के बजाय पानी जैसी सुनाई देती है। छोटे मान पर पूरा बैंड एक साथ fade होता है; बड़े मान पर spectrum के अलग-अलग हिस्से अलग-अलग समय पर fade होते हैं।
- **Static** (0 से 100/s) - बिजली जैसे crashes की दर तय करता है। हर event IF filter से पहले डाला जाता है और उसमें ringing करता है। 0 पर ये बंद हो जाते हैं।
- **Interference** (-80 से 0 dB) - उसी चैनल पर मौजूद स्टेशन की ताकत तय करता है। -80 dB पर यह व्यावहारिक रूप से बंद रहता है; 0 dB के जितना पास, उतना तेज।
- **Interf. Offset** (0.1 से 10 kHz) - तय करता है कि बाधक carrier आपके carrier से कितनी दूर है। दोनों carrier इसी अंतर पर beat करते हैं और heterodyne सीटी बनाते हैं, इसलिए यह सेटिंग उसकी पिच तय करती है: लगभग 3 kHz से नीचे यह साफ स्वर होता है और बढ़ाने पर इसकी पिच ऊपर जाती है, जब तक कि IF filter उसे घटाना शुरू न कर दे। बाधक स्टेशन का कार्यक्रम shaped noise के रूप में model किया गया है, इसलिए यह समझ में आने वाली आवाज के बजाय खुरदुरा, सरसराता हुआ texture जोड़ता है।

#### Tuning

- **Mode** (AM, USB या LSB) - चुनता है कि स्टेशन किस तरह प्रेषित और प्राप्त होता है। AM वही double-sideband प्रसारण है जिसे यह पूरा विवरण मानकर चलता है। USB और LSB carrier को दबाकर केवल एक sideband भेजते हैं, जैसा amateur और utility स्टेशन करते हैं, और receiver अपने ही beat-frequency oscillator के सापेक्ष ऑडियो पुनः प्राप्त करता है। Mode यह भी तय करता है कि कौन-से नियंत्रण लागू होंगे: BFO Offset केवल USB और LSB में और Detector तथा Detector RC केवल AM में काम करते हैं। जो नियंत्रण लागू नहीं होते वे निष्क्रिय दिखते हैं पर अपने मान बनाए रखते हैं। समान सेटिंग पर USB और LSB का स्तर AM के लगभग बराबर रहता है, और बचा हुआ अंतर कार्यक्रम के crest तथा उसमें मौजूद विरामों की मात्रा से तय होता है: सघन सामग्री AM से लगभग एक डेसिबल ऊपर मापी जाती है, जबकि बार-बार विराम वाली आवाज जैसी सामग्री कुछ डेसिबल तक ऊपर चली जाती है, क्योंकि विरामों के दौरान AGC पृष्ठभूमि को उठा देता है। असली receiver भी यही करता है: AGC IF passband के भीतर के स्तर को सामान्यीकृत करता है, और carrier दबे होने पर वह स्तर स्थिर carrier नहीं बल्कि कार्यक्रम स्वयं होता है, इसलिए gain कार्यक्रम के पीछे-पीछे चलता है और हर विराम पर ऊपर चढ़ जाता है।
- **Tuning** (-5.0 से +5.0 kHz) - रिसीवर को स्टेशन से हटाता है; धनात्मक मान रिसीवर को स्टेशन से ऊँची आवृत्ति पर और ऋणात्मक मान नीची आवृत्ति पर tune करते हैं। छोटी offset ध्वनि को मंद करती है, असममित filtering से distortion बढ़ाती है और heterodyne सीटी की तीव्रता भी बदलती है; बड़ी offset पर स्टेशन संकरे IF passband से बाहर चला जाता है। ऊँची ओर tune करने पर USB का पुनः प्राप्त ऑडियो नीचे और LSB का ऊपर खिसकता है; नीची ओर tune करने पर दिशाएँ उलट जाती हैं।
- **BFO Offset** (-1000 से +1000 Hz) - USB और LSB में beat-frequency oscillator को महीन रूप से समायोजित करता है; AM में इसका कोई प्रभाव नहीं। Tuning के साथ मिलकर यह receiver द्वारा पुनः प्राप्त हर घटक का frequency shift तय करता है। Hertz में receiver की कुल offset Tuning × 1000 + BFO Offset है: USB में इसे हर घटक से घटाया जाता है और LSB में हर घटक में जोड़ा जाता है। शून्य का अर्थ ठीक आवृत्ति पर होना है, कुछ दस hertz पर ही ध्वनि नाक से बोली जैसी हो जाती है, और बड़े मान उसे उसी तरह अबूझ बना देते हैं जैसे कोई बेतरतीब tuned receiver करता है।
- **IF Bandwidth** (2.0 से 10.0 kHz) - रिसीवर का IF passband तय करता है। संकरी सेटिंग communications receiver जैसी है जो noise और उसी चैनल के स्टेशन को अधिक रोकती है लेकिन treble भी अधिक हटाती है; चौड़ी सेटिंग अधिक विवरण के साथ अधिक interference भी रखती है। पुनः प्राप्त ऑडियो हर Mode में इस सेटिंग के आधे तक पहुंचता है — डिफ़ॉल्ट 6 kHz पर लगभग 3 kHz तक; USB और LSB में केवल एक ही sideband होता है, इसलिए passband का दूसरा आधा हिस्सा केवल noise और interference गुजरने देता है। Mode बदलने पर यह नियंत्रण अपने आप नहीं बदलता; अधिक संकरी communications ध्वनि के लिए इसे स्वयं घटाएं।

#### Receiver

- **Detector** (Envelope या Synchronous) - Envelope सामान्य diode detector है, और गहरी selective fading को पानी जैसी distortion में यही बदलता है। Synchronous PLL से carrier को पुनः प्राप्त करके उसी के सापेक्ष demodulate करता है, जिससे fade गहरी होने पर भी यह distortion काफी कम रहती है। इसकी pull-in सीमा Tuning में लगभग ±1 kHz है और उससे आगे lock छूट जाता है, इसलिए dial घुमाते समय Envelope उपयुक्त रहता है। Detector बदलने पर carrier acquisition फिर से शुरू होता है। यह केवल AM पर लागू होता है, क्योंकि USB और LSB हमेशा BFO product detector का उपयोग करते हैं।
- **AGC Speed** (Slow, Mid या Fast) - तय करता है कि automatic gain control fade का कितनी तेजी से अनुसरण करता है। Slow में स्तर के उतार-चढ़ाव सुनाई देते रहते हैं और signal लौटने पर pumping होती है; Fast स्तर को अधिक कसकर पकड़ता है। AM में यह तय करता है कि स्तर बढ़ने पर gain कितनी तेजी से नीचे आता है और कितनी तेजी से वापस ऊपर जाता है। USB और LSB में यह केवल वापसी तय करता है: gain हमेशा कुछ मिलीसेकंड में नीचे आ जाता है, जैसा असली single-sideband receiver में होता है, इसलिए हर नया वाक्यांश तुरंत पकड़ लिया जाता है और फूटकर बाहर नहीं आता।
- **Detector RC** (20 से 500 µs) - envelope detector का discharge समय तय करता है। अधिक मान envelope को अधिक चिकना करते हैं लेकिन तेज modulation पर उच्च आवृत्तियों की diagonal-clipping distortion बढ़ाते हैं। Detector के Synchronous होने पर, तथा USB और LSB में, इसका कोई प्रभाव नहीं होता।
- **Hum** (-80 से -20 dB) - पावर-सप्लाई hum तय करता है। -80 dB पर यह व्यावहारिक रूप से बंद रहता है। जोड़े गए hum की परत के विपरीत, इस नियंत्रण का अधिकांश भाग detection से पहले receiver gain को modulate करता है।
- **Hum Freq** (50 या 60 Hz) - सिम्युलेट की जाने वाली पावर आवृत्ति चुनता है।

#### Output

- **Speaker** (Off, Small या Table) - लाइन आउटपुट, पोर्टेबल शॉर्टवेव सेट का सीमित स्पीकर, या टेबलटॉप communications receiver की भरी हुई प्रतिक्रिया चुनता है।
- **Output Gain** (-24 से +24 dB) - receiver और speaker processing के बाद स्तर समायोजित करता है।
- **Mix** (0 से 100%) - मूल stereo signal और सिम्युलेटेड mono reception को मिलाता है। 100% पूरा शॉर्टवेव reception है, जो बाएं और दाएं दोनों में समान भेजा जाता है। Mix dry signal को alignment के लिए delay नहीं करता, इसलिए बीच की settings दोनों signals को receiver और propagation से आए समय-अंतर के साथ मिलाती हैं।

### HUD पढ़ना

- **S METER** दिखाता है कि AGC से पहले receiver अपने band के भीतर कुल कितनी signal strength पा रहा है, हर Mode में, S1 से S9 के पैमाने पर। असली सेट के S meter की तरह यह passband के भीतर की हर चीज़ जोड़कर पढ़ता है, इसलिए एक ही चैनल का स्टेशन, शोर और static भी इच्छित स्टेशन के साथ इसे ऊपर उठाते हैं। AM में इस कुल पर carrier का प्रभुत्व रहता है इसलिए पाठ्यांक स्थिर रहता है; USB और LSB में carrier दबा होता है, इसलिए पाठ्यांक कार्यक्रम के साथ चलता है और वाक्यांशों के बीच शोर के स्तर तक गिर जाता है।
- **FADE** मौजूदा propagation gain का बदलाव dB में दिखाता है, और सीधा पथ तथा दो आयनमंडलीय पथ एक-दूसरे को काटते या बढ़ाते हैं इसलिए यह 0 dB के नीचे और ऊपर दोनों ओर झूलता है। शॉर्टवेव पर यही देखने लायक प्रदर्शन है: डिफ़ॉल्ट सेटिंग पर यह लगातार चलता रहता है, और सबसे गहरे गड्ढों पर ही ध्वनि पानी जैसी और विकृत होती है। यह हमेशा carrier आवृत्ति पर पथ का gain होता है, इसलिए USB और LSB में यह दबे हुए carrier के लिए वही gain बताता है — न कि पूरे sideband का क्षीणन और न ही कार्यक्रम का स्तर।
- **AGC GAIN** रिसीवर द्वारा अभी लगाया जा रहा gain दिखाता है। Signal घटने या fade गहरा होने पर यह बढ़ता है। यह +42 dB पर रुक जाता है, इसलिए सबसे गहरे fade पूरी तरह compensate होने के बजाय धीमे रह जाते हैं।
- **MOD / EVENTS**, जो USB और LSB में **TX / EVENTS** कहलाता है, प्रभावी modulation percentage दिखाता है — USB और LSB में यह sideband drive है — उसके बाद हाल की Static (⚡) और clipping (▲) की प्रति सेकंड दर, और इन events के होने पर चमकता है। साफ परिणाम चाहिए और clipping बार-बार हो तो Mod Depth या Detector RC घटाएं। clipping की गिनती AM की over-modulation और envelope detector की clipping दर्ज करती है, इसलिए USB और LSB में यह स्थिर रहती है।
- **WASM** engine उपलब्ध न होने पर HUD सूचना दिखाता है और plugin ऑडियो को अपरिवर्तित पास कर देता है।

### सुझाई गई सेटिंग

1. **दूर का अंतरराष्ट्रीय प्रसारण**
   - TX Bandwidth: 4.5 kHz, Mod Depth: 90%, Signal: -15 dB, Fading: 55%, Fading Speed: 0.5 Hz, Delay Spread: 1.4 ms, Static: 2/s
   - Interference: -47 dB, Interf. Offset: 1.0 kHz, Tuning: 0 kHz, IF Bandwidth: 6.0 kHz, Detector: Envelope, AGC Speed: Fast, Hum: -80 dB, Speaker: Small, Mix: 100%
   - शॉर्टवेव की रोजमर्रा की ध्वनि: संकरी, लगातार fade होती हुई, बीच-बीच में crash और हल्की सीटी के साथ।

2. **रात के बैंड की गहरी fade**
   - Signal: -30 dB, Fading: 100%, Fading Speed: 0.3 Hz, Delay Spread: 5.0 ms, Static: 10/s
   - IF Bandwidth: 4.0 kHz, Detector: Envelope, AGC Speed: Slow, Detector RC: 150 µs, Speaker: Small, Mix: 100%
   - लंबे, गहरे उतार-चढ़ाव, हर fade के तल पर पानी जैसी distortion, और signal लौटने पर साफ सुनाई देती AGC pumping।

3. **भीड़भाड़ वाला बैंड**
   - Signal: -20 dB, Fading: 60%, Fading Speed: 0.5 Hz, Static: 8/s, Interference: -18 dB, Interf. Offset: 0.8 kHz
   - Tuning: +0.3 kHz, IF Bandwidth: 4.0 kHz, AGC Speed: Mid, Speaker: Small, Mix: 100%
   - कार्यक्रम के ऊपर लगातार heterodyne सीटी। Interf. Offset से उसकी पिच और Tuning से उसकी तेजी बदलें।

4. **Synchronous detection**
   - "रात के बैंड की गहरी fade" से शुरू करके Detector: Synchronous करें
   - गहरी fade बनी रहती है, लेकिन हर fade के तल की distortion बहुत कम हो जाती है और कार्यक्रम सुनने योग्य बना रहता है। lock बनाए रखने के लिए Tuning को लगभग ±1 kHz के भीतर रखें, और अंतर सुनने के लिए Envelope से तुलना करें।

5. **ध्रुवीय flutter**
   - Signal: -25 dB, Fading: 90%, Fading Speed: 6 Hz, Delay Spread: 3.0 ms, Static: 5/s
   - IF Bandwidth: 5.0 kHz, Detector: Envelope, AGC Speed: Fast, Speaker: Small, Mix: 100%
   - धीमे उतार-चढ़ाव के बजाय किसी अशांत या ध्रुवीय पथ जैसी तेज झिलमिलाहट।

6. **Single-sideband स्टेशन**
   - Mode: USB, Tuning: 0 kHz, BFO Offset: 0 Hz, TX Bandwidth: 3.0 kHz, IF Bandwidth: 6.0 kHz
   - Signal: -20 dB, Fading: 55%, Fading Speed: 0.5 Hz, Static: 2/s, AGC Speed: Fast, Speaker: Small, Output Gain: 0 dB, Mix: 100%
   - ठीक आवृत्ति पर बैठी संकरी, सूखी communications ध्वनि, जिसमें वाक्यांशों के बीच AGC सांस लेता है। इसका स्तर पहले से ही AM स्टेशन के करीब रहता है, इसलिए किसी अतिरिक्त समायोजन की जरूरत नहीं।

7. **आवृत्ति से हटी डक वॉइस**
   - Single-sideband स्टेशन से शुरू करें और BFO Offset: -150 Hz करें
   - हर घटक 150 Hz ऊपर खिसक जाता है, इसलिए harmonics की पंक्ति बिगड़ जाती है और आवाजें तथा वाद्य नाक से बोली जैसे और बेसुरे हो जाते हैं। उसी सेटिंग पर Mode को LSB करें तो सब कुछ इसके बजाय 150 Hz नीचे खिसकेगा; अधिक मोटे offset के लिए Tuning का उपयोग करें।

### मॉडल संबंधी टिप्पणियां

यह effect पहली stereo जोड़ी को एक ही mono प्रेषण के रूप में संसाधित करता है, ठीक जैसे वास्तविक शॉर्टवेव करता है, और प्राप्त signal हमेशा mono रहता है। उसी चैनल पर केवल एक बाधक स्टेशन model किया गया है, और उसका कार्यक्रम भाषण या संगीत नहीं बल्कि shaped noise है। USB और LSB दबे हुए carrier वाले single-sideband signal के reception को model करते हैं; sideband का चयन transmitter पर होता है, इसलिए receiver अपनी ओर से विपरीत sideband का दमन नहीं जोड़ता, और CW तथा data modes model नहीं किए गए हैं। वास्तविक बैंड परिस्थितियां — दिन-रात के अनुसार propagation में बदलाव और विशिष्ट प्रसारण बैंड — भी इस model के दायरे से बाहर हैं; जो स्थिति चाहिए उसे Signal, Fading और अन्य propagation नियंत्रणों से सेट करें।

## Tape Artifacts

Tape Artifacts संगीत को मॉडल की गई एनालॉग reel-to-reel टेप मशीन पर रिकॉर्ड करता है और फिर वापस चलाता है। सिग्नल रिकॉर्ड amplifier और उसके द्वारा टेप पर अंकित ऊंची आवृत्तियों के उभार, टेप के अपने चुंबकीय saturation, रिकॉर्ड bias से होने वाले ऊंची आवृत्तियों के मिटाव, प्लेबैक head के wavelength loss, transport के wow और flutter, निचली आवृत्तियों के head bump, और उसी उभार को ठीक उतना ही वापस हटाने वाले प्लेबैक curve से गुजरता है; अंत में टेप hiss और modulation noise जुड़ते हैं। जब आप चाहते हैं कि संगीत ऊपर से शोर या कंपन जोड़ने के बजाय सचमुच टेप मशीन से गुज़रा हुआ लगे, तब इसका उपयोग करें।

### अन्य Lo-Fi effects से अंतर

- **Tape Artifacts** संगीत को ही बदलता है। हल्की compression, जुड़ती हुई गर्माहट, नरम पड़ती ऊंची आवृत्तियां और pitch का हल्का बहाव — सब एक ही रिकॉर्ड और प्लेबैक शृंखला से आते हैं, इसलिए ये सब Speed, Tape, Bias और Record Level पर एक साथ प्रतिक्रिया देते हैं।
- **Wow Flutter** (Modulation) केवल transport की गति के उतार-चढ़ाव को दोहराता है। जब आपको टेप saturation, टेप equalization और hiss के बिना सिर्फ कंपन चाहिए, तब इसे चुनें।
- **Saturation** और **Hard Clipping** केवल non-linearity जोड़ते हैं, टेप मशीन के आवृत्ति-निर्भर व्यवहार और transport के बिना।
- **Noise Blender** और **Hum Generator** संगीत को बदले बिना शोर या hum की परत ऊपर जोड़ते हैं। यहां hiss और modulation noise मशीन के सही स्थान पर बनते हैं, इसलिए वे असली टेप शोर की तरह Speed और Tape के साथ बदलते हैं।

### ध्वनि चरित्र गाइड

- **Speed मूल टोन तय करता है:** 30 ips सबसे खुला है, 15 ips जानी-पहचानी स्टूडियो ध्वनि है, और 7.5 ips स्पष्ट रूप से अधिक गहरा है, जिसमें निचली आवृत्तियों का उभार भी अधिक है। शोर सीधे-सीधे गति का अनुसरण नहीं करता: बिना सिग्नल के hiss floor 15 ips पर सबसे ऊंचा और 30 ips पर सबसे नीचा होता है, जबकि संगीत के साथ चलने वाला modulation noise 7.5 ips पर सबसे तेज़ होता है।
- **हल्की level compression:** Record Level जितना ऊंचा रखेंगे, टेप उतना ही पहले — साफ़ सुनाई देने वाली distortion से पहले ही — peaks को गोल कर देता है, इसलिए तेज़ हिस्से स्पष्ट रूप से clip होने के बजाय अधिक सघन और स्थिर हो जाते हैं। डिफ़ॉल्ट +6.0 dB और संदर्भ 0.0 dB Bias पर full-scale 1 kHz tone 0.49% distortion के साथ 0.17 dB गोल होकर निकलता है — अपने सामान्य कार्य स्तर पर चल रही मशीन, न कि कोई साफ़ digital रास्ता। यह मात्रा वहां से सहजता से बढ़ती है: +12.0 dB पर 0.68 dB और 2.0%, तथा शीर्ष +18.0 dB पर 2.49 dB और 6.8%। डिफ़ॉल्ट पर इससे बड़ा जो भी level परिवर्तन दिखे वह compression से नहीं बल्कि टोन बदलने से आता है, और वह material के अनुसार दोनों दिशाओं में जाता है: भारी निचली आवृत्तियों वाला संगीत लगभग 1 dB तेज़ और ऊंची आवृत्तियों से भरा material लगभग 1 dB धीमा निकल सकता है।
- **गर्माहट:** saturation असममित है, इसलिए यह सम और विषम दोनों harmonics बनाता है और गर्माहट Record Level बढ़ने के साथ अचानक आने के बजाय धीरे-धीरे बढ़ती है।
- **लंबे स्वरों पर transport सुनाई देता है:** धीमा wow और तेज़ flutter piano, organ और strings के लंबे स्वरों को बहुत हल्का बहा देते हैं (डिफ़ॉल्ट Wow/Flutter और Speed पर setting जो विचलन बताती है वह 0.160%)। टेप को डिजिटल फ़ाइल से सबसे साफ़ यही अलग करता है।
- **जीवंत पृष्ठभूमि:** सामान्य settings पर hiss और संगीत के साथ चलने वाला modulation noise ध्वनि का हिस्सा होते हैं। hiss टेप पर है, इसलिए output पर वह कितना मापा जाता है इसे Record Level एक decibel के बदले एक decibel खिसकाता है। पूरी तरह शांत पृष्ठभूमि चाहिए तो Hiss को -89.0 dB re 320 nWb/m तक नीचे कर दें।

### पैरामीटर

- **Speed** (7.5 / 15 / 30 ips) - टेप की गति चुनता है। अधिक गति ऊंची आवृत्तियों को बढ़ाती है और निचली आवृत्तियों के head bump को ऊंची आवृत्ति की ओर ले जाकर छोटा करती है: 7.5 ips पर 41 Hz पर +1.4 dB, 15 ips पर 80 Hz पर +0.8 dB, 30 ips पर 159 Hz पर +0.4 dB। wow और flutter तेज़ भी होते हैं और उथले भी: Wow/Flutter 15 ips पर weighted विचलन बताता है और गति उसे 7.5 ips पर 1.5 गुना तथा 30 ips पर 0.75 गुना कर देती है, इसलिए संदर्भ मशीन 15 ips के लिए जो 0.04% प्रकाशित करती है, वह बाकी दोनों गतियों पर वही 0.06% और 0.03% देता है जो वह उनके लिए प्रकाशित करती है। शोर गति के साथ एक ही दिशा में नहीं चलता: hiss floor 15 ips पर सबसे ऊंचा और 30 ips पर सबसे नीचा है, जबकि संगीत के साथ चलने वाला modulation noise 7.5 ips पर सबसे तेज़ है। 15 ips सामान्य स्टूडियो setting है, 7.5 ips सबसे गहरा है, और 30 ips मूल ध्वनि के सबसे करीब है। Wow/Flutter और Hiss दोनों संदर्भ 15 ips के लिए दिए गए हैं, और चुने हुए Speed, Tape तथा Record Level पर उनमें से हर एक कितना बनता है यह, Record Level की अपनी परिपाटी के साथ, effect की अंतिम पंक्ति में दिखता है।
- **Tape** (Standard / Master) - टेप का प्रकार चुनता है। Master की coating मोटी है और saturation से पहले लगभग 3 dB अधिक headroom है, इसलिए यह अधिक देर तक साफ़ रहती है और इसका ऊपरी सिरा थोड़ा नरम होता है। नीची Record Level settings पर दोनों का स्तर लगभग बराबर रहता है (डिफ़ॉल्ट पर 0.08 dB का अंतर), पर Record Level जितना ऊंचा रखेंगे उतना ही Master तेज़ बनी रहती है: +12.0 dB पर 0.34 dB और +18.0 dB पर 1.16 dB का अंतर — ठीक इसीलिए कि वह देर से saturate होती है; इसलिए तुलना करते समय Output से आवाज़ बराबर करें।
- **Bias** (-6.0 से +6.0 dB) - रिकॉर्डिंग bias तय करता है। 0 dB सही ढंग से align की गई मशीन है, और यही वह बिंदु है जहां निर्माता की अपनी bias समायोजन प्रक्रिया पहुंचती है: कार्य स्तर से 20 dB नीचे 10 kHz रिकॉर्ड करें, संवेदनशीलता वक्र का शिखर खोजें, फिर bias तब तक बढ़ाएं जब तक प्लेबैक स्तर प्रकाशित मात्रा जितना न गिर जाए — Standard टेप पर यह मात्रा 30 ips पर 1.5 dB, 15 ips पर 4.0 dB और 7.5 ips पर 5.0 dB है। Master टेप केवल 7.5 ips पर अलग है, जहां यह 6.5 dB है। अधिक (over-bias) settings साफ़ और अधिक गहरी होती हैं। कम (under-bias) settings गलत align किए गए deck की तरह अधिक चमकीली और अधिक distorted होती हैं, पर चमक उसी शिखर तक बढ़ती है, जो Standard टेप पर 30 ips पर लगभग -2.7 dB, 15 ips पर लगभग -4.5 dB और 7.5 ips पर लगभग -5.0 dB, तथा Master पर 7.5 ips में लगभग -5.7 dB पर है। उससे नीचे distortion बढ़ती रहती है जबकि ऊंची आवृत्तियां फिर से गहरी पड़ जाती हैं। चमक कितनी बढ़ती है यह गति जितना ही आवृत्ति पर भी निर्भर करता है: 30 ips पर शिखर 10 kHz पर 1.5 dB देता है पर 16 kHz पर 2.9 dB, और -6.0 dB पर ऊपरी सिरा 0 dB की तुलना में पहले ही अधिक गहरा हो चुका होता है — 10 kHz पर 0.2 dB और 16 kHz पर 0.5 dB।
- **Record Level** (-12.0 से +18.0 dB) - तय करता है कि मशीन कितने ज़ोर से रिकॉर्ड करती है। यह संख्या वह टेप स्तर है जहां 0 dBFS का peak पहुंचता है, 320 nWb/m के संदर्भ flux से dB ऊपर के रूप में, और status line इसी परिपाटी को बताती है। यह नियंत्रण स्वयं कोई gain नहीं जोड़ता: जब तक टेप संतृप्त नहीं होता, वही संकेत हर Record Level setting पर उसी स्तर पर निकलता है। यह स्तर ठीक इकाई नहीं है — यह उससे 0.05 dB के भीतर रहता है, 30 ips पर थोड़ा ऊपर और 7.5 ips पर थोड़ा नीचे — पर Record Level के साथ यह हिलता नहीं। डिफ़ॉल्ट +6.0 dB अपने सामान्य कार्य स्तर पर चल रही मशीन है, जहां full-scale 1 kHz tone 0.49% distort करता है; +12.0 dB पर यह 2.0% और शीर्ष +18.0 dB पर 6.8% देता है, और टेप की compression तथा गर्माहट इसी तरह मिलती है। peaks का चपटा होना टेप से आता है, नियंत्रण द्वारा कुछ भी घटाने से नहीं, इसलिए टेप जितने ज़ोर से चलेगा परिणाम उतना ही धीमा होगा, और आवाज़ वापस लाने के लिए Output है। यह पृष्ठभूमि को भी उल्टी दिशा में हर decibel के बदले एक decibel खिसकाता है, क्योंकि hiss टेप पर रिकॉर्ड होता है और अब टेप peak से उतना ही नीचे है।
- **Wow/Flutter** (0 से 1%) - transport के गति-उतार-चढ़ाव को 15 ips पर DIN 45507 peak weighted विचलन के प्रतिशत के रूप में तय करता है। 0% पूरी तरह स्थिर मशीन है। 0.04% वही सहनसीमा है जो संदर्भ स्टूडियो मशीन उस गति के लिए प्रकाशित करती है, और इसे रखने पर वही मशीन 7.5 ips के लिए जो 0.06% और 30 ips के लिए जो 0.03% प्रकाशित करती है वही मिलता है। डिफ़ॉल्ट 0.160% इस सहनसीमा का चार गुना है; इससे अधिक मान घिसे हुए deck जैसा सुनाई देने वाला बहाव और झिलमिलाहट देते हैं, 7.5 ips पर 1.5% तक।
- **Hiss** (-89.0 से -39.0 dB re 320 nWb/m) - टेप hiss और modulation noise दोनों का स्तर एक साथ तय करता है, Standard टेप पर 15 ips के A-weighted hiss flux के रूप में, 320 nWb/m के संदर्भ के सापेक्ष। यह output पर का कोई स्तर नहीं बल्कि टेप का अपना datasheet आंकड़ा है: शोर टेप पर रिकॉर्ड होता है, इसलिए output पर वह कितना मापा जाएगा यह Record Level पर निर्भर करता है। -89.0 dB re 320 nWb/m पर दोनों पूरी तरह बंद हो जाते हैं। डिफ़ॉल्ट -62.5 dB re 320 nWb/m वह bias noise है जो निर्माता उस टेप के लिए उस गति पर प्रकाशित करता है; बाकी गतियां और Master टेप उससे उतना ही हटती हैं जितना datasheet बताती है, इसलिए उस डिफ़ॉल्ट पर और Record Level +6.0 dB पर छह संयोजन -68.0 से -72.0 dBFS के बीच रहते हैं, और दोनों नियंत्रणों के साथ पूरा समूह खिसकता है। ये सभी Output से पहले हैं, इसलिए Output के बाद लगाया गया meter इन्हें Output जितना ऊपर उठा हुआ पढ़ता है। यह floor वह है जो खाली जगहों में सुनाई देता है; संगीत बजते समय यह नियंत्रण मुख्यतः सिग्नल के साथ चलने वाला modulation noise जोड़ता है, जो Standard टेप पर 15 ips पर स्थिर tone से लगभग 57 dB नीचे रहता है, और अन्य Speed तथा Tape संयोजनों पर और असली material पर कुछ dB ऊपर-नीचे होता है। अधिक मान पृष्ठभूमि को अधिक स्पष्ट बनाते हैं।
- **Output** (-24.0 से +24.0 dB) - पूरी शृंखला के बाद स्तर समायोजित करता है। यह bypass से तुलना करते समय आवाज़ मिलाने के लिए है, या ऊंची Record Level setting से घटी आवाज़ वापस लाने के लिए।
- **Mix** (0 से 100%) - टेप सिग्नल को मूल सिग्नल के साथ मिलाता है। 100% पूरी टेप प्लेबैक है। dry सिग्नल को टेप पथ के साथ delay-aligned किया गया है, इसलिए मध्य आवृत्तियां साफ़-सुथरी मिलती हैं — संदर्भ 0.0 dB Bias पर Mix की किसी भी स्थिति और किसी भी गति पर 1 kHz इकाई से 0.1 dB के भीतर रहता है, और पूरी Bias रेंज में कहीं भी 0.5 dB के भीतर — पर सबसे ऊपरी octave नहीं, क्योंकि वहां dry और टेप की phase मेल नहीं खाती और वे आंशिक रूप से एक-दूसरे को काटते हैं। 50% पर 16 kHz का स्तर 44.1 kHz host पर 1.7 dB, 48 kHz पर 2.1 dB, 96 kHz पर 4.6 dB और 192 kHz पर 5.7 dB नीचे आता है, और 96 या 192 kHz host पर नियंत्रण का सबसे गहरा बिंदु 100% नहीं बल्कि लगभग 70% है। 44.1 kHz host पर यह ऊपर बढ़ाने के साथ केवल गहरा ही होता जाता है, और 48 kHz host पर सबसे गहरा बिंदु 89% है, जो 100% से 0.06 dB नीचे है; दोनों ही में नियंत्रण का मध्य भाग सबसे ऊपरी सिरे पर 100% से अधिक चमकीला होता है। 0% पर input बिल्कुल अपरिवर्तित निकलता है और effect कोई latency नहीं जोड़ता; किसी भी अन्य setting पर यह 44.1 kHz host पर 5.26 ms और 192 kHz host पर 5.06 ms जोड़ता है।

### सुझाई गई सेटिंग

1. **स्टूडियो मास्टर टेप (डिफ़ॉल्ट)**
   - Speed: 15 ips, Tape: Standard, Bias: 0.0 dB, Record Level: +6.0 dB
   - Wow/Flutter: 0.160%, Hiss: -62.5 dB re 320 nWb/m, Output: 0.0 dB, Mix: 100%
   - रोज़मर्रा की टेप ध्वनि, और plugin का अपना डिफ़ॉल्ट भी: 16 kHz पर ऊपरी सिरा 3.5 dB नरम, 80 Hz के आसपास 0.8 dB का उभार, full-scale tone पर 0.49% distortion और 0.17 dB की गोलाई, -68.5 dBFS की पृष्ठभूमि, और 0.160% wow व flutter — लंबे स्वरों पर सुनाई देता है, transients पर नहीं।

2. **तेज़ गति पर साफ़ transfer**
   - Speed: 30 ips, Tape: Master, Bias: 0.0 dB, Record Level: 0.0 dB
   - Wow/Flutter: 0.070%, Hiss: -68.5 dB re 320 nWb/m, Output: 0.0 dB, Mix: 100%
   - मूल ध्वनि के बहुत करीब: full-scale tone पर 0.07% distortion और 0.02 dB की गोलाई, 16 kHz पर 2.2 dB की कमी, -72.0 dBFS की पृष्ठभूमि — यानी -68.5 dB re 320 nWb/m का Base मान इस Record Level पर 30 ips और Master टेप के साथ जो बन जाता है — और 0.053% wow व flutter। टेप डिफ़ॉल्ट से 6 dB नीचे रिकॉर्ड किया गया है, और इसी से यह इतना साफ़ रहता है। बाकी settings की तुलना करते समय संदर्भ बिंदु के रूप में उपयोगी।

3. **गर्म और सघन**
   - Speed: 15 ips, Tape: Standard, Bias: 0.0 dB, Record Level: +18.0 dB
   - Wow/Flutter: 0.200%, Hiss: -62.5 dB re 320 nWb/m, Output: +1.5 dB, Mix: 100%
   - टेप डिफ़ॉल्ट से 12 dB ऊपर, रेंज के शीर्ष पर रिकॉर्ड किया गया है: full-scale tone 6.8% distortion के साथ 2.49 dB गोल होकर निकलता है, इसलिए mix अधिक सघन और गर्म हो जाता है जबकि peaks चपटे पड़ते हैं। साथ ही पृष्ठभूमि गिरकर -80.5 dBFS हो जाती है, क्योंकि hiss टेप पर है और टेप अब उतना ही ऊपर बैठा है। compression आवाज़ की कीमत लेती है, इसलिए Output नीचे नहीं बल्कि ऊपर जाता है; अंत में कान से समायोजित करें।

4. **7.5 ips पर घरेलू deck**
   - Speed: 7.5 ips, Tape: Standard, Bias: +2.0 dB, Record Level: +12.0 dB
   - Wow/Flutter: 0.300%, Hiss: -59.5 dB re 320 nWb/m, Output: +0.5 dB, Mix: 100%
   - अधिक गहरा (16 kHz पर 10.2 dB की कमी, 50 Hz पर 1.4 dB का उभार) और अधिक शोर भरा (पृष्ठभूमि -72.5 dBFS, यानी टेप की अपनी -73.0 dBFS floor में इसका +0.5 dB Output जुड़कर), और कम स्थिर (0.450% wow व flutter), full-scale tone पर 1.3% distortion। bias थोड़ा ऊंचा रखा गया है, जैसा सामान्य टेप चलाने वाले घरेलू deck में प्रायः होता है — स्टूडियो मशीन नहीं, बल्कि एक साधारण मशीन।

5. **घिसा हुआ transport**
   - Speed: 7.5 ips, Tape: Standard, Bias: -2.0 dB, Record Level: +15.0 dB
   - Wow/Flutter: 0.480%, Hiss: -56.5 dB re 320 nWb/m, Output: +1.0 dB, Mix: 100%
   - 0.720% wow व flutter, full-scale tone पर 5.2% distortion और 1.80 dB की गोलाई, और -72.0 dBFS की पृष्ठभूमि — टेप की अपनी -73.0 dBFS floor में इसका +1.0 dB Output जुड़कर — साथ में under-bias मशीन जैसा खुरदरा, आगे निकला हुआ ऊपरी सिरा, जो 16 kHz पर केवल 4.4 dB नीचे है जबकि इसी गति पर align की गई मशीन 7.2 dB नीचे रहती है। आवाज़ वापस लाने के लिए Output बढ़ाना पड़ता है। जानबूझकर बिगाड़ा गया lo-fi प्रभाव।

### मॉडल संबंधी टिप्पणियां

यह effect सही ढंग से align की गई मशीन पर एक बार की रिकॉर्डिंग और प्लेबैक को मॉडल करता है। Equalization NAB जैसे किसी प्रकाशित मानक का पालन नहीं करता; इसके बजाय हर गति पर रिकॉर्ड पक्ष टेप से पहले ऊंची आवृत्तियां उभारता है और प्लेबैक पक्ष ठीक उतना ही उभार वापस हटा देता है। Print-through, टेप dropouts, azimuth त्रुटि, splice noise और मशीन-विशिष्ट equalization मानक इस मॉडल के बाहर हैं। टेप पथ में transport और प्रोसेसिंग का विलंब 44.1 से 192 kHz तक के hosts पर 5.06 से 5.26 ms होता है। ऊपर दिए गए टोन के आंकड़े 96 kHz host पर संदर्भ 0.0 dB Bias के साथ मापे गए हैं; सबसे ऊपरी सिरा host की sample rate पर निर्भर करता है, इसलिए डिफ़ॉल्ट का 16 kHz पर 3.5 dB, 44.1 या 48 kHz पर 2.7 dB हो जाता है।

## Vinyl Artifacts

एक प्रभाव जो pops, crackle, hiss, rumble और reactive surface noise जैसे vinyl-style playback artifacts जोड़ता है। यह संगीत में generated record noise जोड़ता है; यह किसी पूरे turntable, cartridge या phono preamp model की तरह मूल संगीत signal की tone नहीं बदलता।

### ध्वनि चरित्र गाइड
- विनाइल रिकॉर्ड अनुभव:
  - विनाइल रिकॉर्ड बजाने की प्रामाणिक ध्वनि को पुनर्निर्मित करता है
  - विशिष्ट सतह शोर और कलाकृतियां जोड़ता है
  - nostalgic record-noise layer बनाता है
- बनाई गई artifact परत:
  - पॉप, क्रैकल, हिस और रंबल को मूल संगीत के ऊपर मिलाता है
  - reactive noise जोड़ सकता है जो input signal के साथ बदलता है
  - मूल music signal की stereo separation और tone को मुख्य रूप से सुरक्षित रखता है
- वातावरणीय बनावट:
  - समृद्ध, जैविक पृष्ठभूमि बनावट बनाता है
  - डिजिटल रिकॉर्डिंग में गहराई और चरित्र जोड़ता है
  - आरामदायक, अंतरंग सुनने के अनुभव बनाने के लिए बिल्कुल सही

### पैरामीटर
- **Pops/min** - प्रति मिनट बड़े click noises की आवृत्ति नियंत्रित करता है (0 से 120)
  - 0-20: कभी-कभार gentle pops
  - 20-60: मध्यम vintage character
  - 60-120: भारी wear-and-tear sound
- **Pop Level** - pop noises की मात्रा नियंत्रित करता है (-80.0 से 0.0 dB)
  - -80 से -48 dB: सूक्ष्म clicks
  - -48 से -24 dB: मध्यम pops
  - -24 से 0 dB: तेज़ pops (extreme settings)
- **Crackles/min** - प्रति मिनट crackling noise की density नियंत्रित करता है (0 से 2000)
  - 0-200: सूक्ष्म surface texture
  - 200-1000: classic vinyl character
  - 1000-2000: भारी surface noise
- **Crackle Level** - crackling noise की मात्रा नियंत्रित करता है (-80.0 से 0.0 dB)
  - -80 से -48 dB: सूक्ष्म crackling
  - -48 से -24 dB: मध्यम crackle
  - -24 से 0 dB: तेज़ crackle (extreme settings)
- **Hiss** - broadband surface hiss का स्तर नियंत्रित करता है (-80.0 से 0.0 dB)
  - -80 से -60 dB: बहुत हल्का background hiss
  - -60 से -30 dB: सुनाई देने वाला vinyl-style hiss
  - -30 से 0 dB: प्रमुख hiss (extreme settings)
- **Rumble** - low-frequency turntable rumble नियंत्रित करता है (-80.0 से 0.0 dB)
  - -80 से -60 dB: सूक्ष्म low-end warmth
  - -60 से -40 dB: ध्यान देने योग्य rumble
  - -40 से 0 dB: भारी rumble (extreme settings)
- **Crosstalk** - generated artifact noise को left और right channels के बीच मिलाता है; मूल music signal अपनी stereo separation बनाए रखता है (0 से 100%)
  - 0%: generated noise अपनी original channel separation रखता है
  - 30-60%: realistic vinyl-style noise bleed
  - 100%: generated noise left और right में लगभग समान हो जाता है
- **Noise Profile** - generated noise की frequency response समायोजित करता है (0.0 से 10.0)
  - 0: सबसे dark, warmest noise tone
  - 5: आंशिक रूप से shaped noise tone
  - 10: flat noise tone / tone shaping bypassed
- **Wear** - pops, crackles और hiss जैसे surface wear artifacts को scale करता है (0 से 200%)
  - 0-50%: साफ surface noise
  - 50-100%: सामान्य surface wear
  - 100-200%: बहुत घिसी हुई surface noise
  - Rumble, Crosstalk और Noise Profile अलग से नियंत्रित होते हैं
- **React** - noise input signal पर कितनी प्रतिक्रिया देता है (0 से 100%)
  - 0%: static noise levels
  - 25-50%: संगीत पर मध्यम response
  - 75-100%: input पर बहुत reactive
- **React Mode** - signal का कौन-सा पहलू reaction को नियंत्रित करता है
  - Amplitude: loudness के साथ noise बदलता है
  - Velocity: signal change के साथ noise बदलता है
- **Mix** - generated vinyl noise की मात्रा नियंत्रित करता है (0 से 100%)
  - 0%: कोई generated vinyl noise नहीं
  - 50%: सूक्ष्म से मध्यम noise layer
  - 100%: full vinyl artifact layer
  - नोट: dry signal level अपरिवर्तित रहता है; यह parameter केवल noise amount नियंत्रित करता है

### विभिन्न शैलियों के लिए अनुशंसित सेटिंग्स

1. सूक्ष्म विनाइल चरित्र
   - Pops/min: 20, Pop Level: -48dB, Crackles/min: 200, Crackle Level: -48dB
   - Hiss: -48dB, Rumble: -60dB, Crosstalk: 30%, Noise Profile: 5.0
   - Wear: 25%, React: 20%, React Mode: Velocity, Mix: 100%
   - इसके लिए बिल्कुल सही: gentle vinyl surface texture जोड़ना

2. क्लासिक विनाइल अनुभव
   - Pops/min: 40, Pop Level: -36dB, Crackles/min: 400, Crackle Level: -36dB
   - Hiss: -36dB, Rumble: -50dB, Crosstalk: 50%, Noise Profile: 4.0
   - Wear: 60%, React: 30%, React Mode: Velocity, Mix: 100%
   - इसके लिए बिल्कुल सही: प्रामाणिक विनाइल सुनने का अनुभव

3. अच्छी तरह घिसा हुआ रिकॉर्ड
   - Pops/min: 80, Pop Level: -24dB, Crackles/min: 800, Crackle Level: -24dB
   - Hiss: -30dB, Rumble: -40dB, Crosstalk: 70%, Noise Profile: 3.0
   - Wear: 120%, React: 50%, React Mode: Velocity, Mix: 100%
   - इसके लिए बिल्कुल सही: भारी उम्रदराज़ रिकॉर्ड चरित्र

4. लो-फाई एंबिएंट
   - Pops/min: 15, Pop Level: -54dB, Crackles/min: 150, Crackle Level: -54dB
   - Hiss: -42dB, Rumble: -66dB, Crosstalk: 25%, Noise Profile: 6.0
   - Wear: 40%, React: 15%, React Mode: Amplitude, Mix: 100%
   - इसके लिए बिल्कुल सही: पृष्ठभूमि परिवेशी बनावट

5. डायनामिक विनाइल
   - Pops/min: 60, Pop Level: -30dB, Crackles/min: 600, Crackle Level: -30dB
   - Hiss: -39dB, Rumble: -45dB, Crosstalk: 60%, Noise Profile: 5.0
   - Wear: 80%, React: 75%, React Mode: Velocity, Mix: 100%
   - इसके लिए बिल्कुल सही: music पर नाटकीय रूप से react करने वाला noise

## Vinyl Simulator

Vinyl Simulator भौतिक record-cutting और stylus-playback मॉडल से संगीत signal को ही बदलता है। यह cutting filters और RIAA recording curve लगाकर signal को surface roughness और debris वाले groove में लिखता है, फिर stylus और tonearm के mechanical model से पढ़कर RIAA playback equalization लगाता है। जब केवल record noise जोड़ने के बजाय groove geometry, tracking और surface को संगीत के साथ वास्तविक रूप से interact कराना हो, तब इसका उपयोग करें।

### Vinyl Artifacts से अंतर

- **Vinyl Simulator** signal को model किए गए groove और stylus से गुजारता है। Roughness, Dust, Static, Tracking Force, stylus shape, Speed और Radius सभी परिणाम में भाग लेते हैं।
- **Vinyl Artifacts** संगीत signal को नहीं बदलता; वह pops, crackle, hiss, rumble और stereo noise bleed जोड़ता है। हल्की, predictable noise layer या WASM न मिलने पर इसे चुनें।
- दोनों साथ चल सकते हैं, लेकिन दोनों में surface settings तेज रखने से clicks और noise जल्दी बढ़ते हैं।

### ध्वनि सुधार मार्गदर्शिका

- **कोमल record playback:** Cut Level को 0 dB के पास, Shape को Elliptical, Roughness को मध्यम तथा Dust और Static को कम रखें। मूल signal अधिक रखना हो तो Mix घटाएँ।
- **Inner-groove character:** Radius को 60 mm की ओर घटाएँ। कम linear speed पर high-frequency detail और tracking अधिक कठिन होते हैं।
- **साफ और स्थिर playback:** Roughness, Dust, Static और Scratch घटाएँ, Tracking Force लगभग 2 g रखें और Standard या High चुनें।
- **पुरानी surface:** पहले Roughness बढ़ाएँ, फिर Dust, Static और थोड़ा Scratch जोड़ें; हर control अलग physical event दर्शाता है।
- **अधिक स्पष्ट groove coloration:** Cut Level सावधानी से बढ़ाएँ, HF Cutoff या Radius घटाएँ। Tracking S/E की गिरावट और mistrack/skip की वृद्धि देखें।
- इसमें wow/flutter, eccentricity, warping या turntable rumble नहीं हैं। जरूरत हो तो chain में **Wow Flutter** जोड़ें।

### Parameters

#### Cutting

- **Cut Level** (-20 से +20 dB) — input से cutter चलने की ताकत। अधिक level groove displacement और nonlinearity बढ़ाता है; कम level mechanical headroom बढ़ाता है।
- **HF Cutoff** (6000 से 24000 Hz) — cutting से पहले high-frequency सीमा। कम value गहरा और आसानी से track होने वाला groove देती है; अधिक value detail बचाती है पर stylus पर अधिक मांग रखती है।
- **Bass Mono Below** (50 से 1000 Hz) — वह range जिसमें Side component घटता है। अधिक value ज्यादा bass को center करती है।
- **Side Mix** (0 से 100%) — Bass Mono Below के नीचे बचने वाला Side। 0% उस range को mono बनाता है; 100% मूल Side रखता है।

#### Record

- **Speed** (33⅓, 45 या 78 rpm) — rotation speed। समान Radius पर अधिक speed linear velocity बढ़ाती है और fine detail track करना आसान बनाती है।
- **Radius** (60 से 146 mm) — record पर stylus की जगह। कम value धीमे और high frequencies में कठिन inner groove को दर्शाती है।
- **Roughness** (0.1 से 100 nm) — microscopic surface roughness; बढ़ाने पर continuous surface texture बढ़ता है।
- **Dust** (0 से 10000/s) — dust particles और छोटी physical disturbances की दर।
- **Static** (0 से 10000/s) — electrical discharge pulses की दर, जो cartridge output में sharp pops जोड़ते हैं।
- **Scratch** (0 से 1000/s) — बड़े groove defects की दर।

#### Stylus

- **Shape** (Spherical या Elliptical) — contact geometry। Spherical में Scan Radius, Side Radius के साथ चलता है। बदलने पर simulation state फिर बनती है।
- **Side Radius** (5 से 25 µm) — groove wall के आर-पार stylus radius; contact area और pressure distribution बदलता है।
- **Scan Radius** (2 से 25 µm) — groove travel की दिशा का radius। छोटा value fine geometry follow करता है; बड़ा व्यापक contact पर average करता है।
- **Tracking Force** (0.5 से 5.0 g) — downward stylus force। थोड़ा अधिक contact स्थिर कर सकता है, पर force और pressure बढ़ाता है; बहुत कम होने पर mistrack और skip बढ़ सकते हैं।
- **Tip Mass** (0.1 से 1.5 mg) — stylus tip की moving mass। अधिक mass inertia बढ़ाकर तेज groove motion follow करना कठिन बनाती है।
- **Compliance** (5 से 35 cu) — suspension flexibility। अधिक value उसी force पर ज्यादा movement और अलग mechanical response देती है।
- **Damping** (0.05 से 1.0 ζ) — mechanical resonance damping। अधिक value ringing को ज्यादा दबाती है।

#### Output

- **Quality** (Eco, Standard, High या Ultra) — physical integration के base substeps और contact scan points चुनता है। Contact resonance को stable रखने के लिए engine, sample rate, Tracking Force, Tip Mass, Compliance, Shape, Side Radius और Scan Radius के अनुसार effective substeps को base से ऊपर अपने-आप बढ़ा सकता है। Real-time default Standard है; बदलने पर simulation state फिर बनती है।
- **Output Gain** (-24 से +24 dB) — RIAA playback EQ और normalization के बाद का level।
- **Mix** (0 से 100%) — simulated playback और latency-aligned dry signal का blend। 0% dry, 100% पूरा simulated है।

### HUD कैसे पढ़ें

- **Force L/R (mN):** दोनों groove walls पर contact force। बड़ी या असमान values कठिन groove motion दिखाती हैं।
- **Pressure (GPa):** वर्तमान में अधिक contact pressure; stylus settings बदलते समय Force के साथ देखें।
- **Tip (cm/s, dB):** stylus-tip velocity और संबंधित playback level।
- **Tracking S/E L/R (dB):** tracked signal और tracking error का ratio। अधिक value साफ tracking है; लगातार गिरना कठिनाई बताता है।
- **Jitter (ns):** groove read point का timing variation, Stylus view में दिखता है।
- **Mistrack, Skip, Static Pop और Dust Hit (/s):** हाल की event rates; नई event पर flash होता है। बार-बार event आए तो Cut Level घटाएँ, Tracking Force थोड़ा बढ़ाएँ, Radius या Quality बढ़ाएँ।

Native DSP telemetry मिलने पर HUD सक्रिय होता है। Playback रुका हो या power saving के लिए telemetry बंद हो तो idle state दिख सकती है।

### अनुशंसित सेटिंग्स

1. **कोमल playback:** Cut Level 0 dB, HF Cutoff 16 kHz, 33⅓ rpm, Radius 120 mm, Roughness 5 nm, Dust 0.5/s, Static 0.02/s, Scratch 0/s, Elliptical, Tracking Force 2.0 g, Standard, Mix 75%।
2. **Classic outer groove:** Cut Level 0 dB, 33⅓ rpm, Radius 135 mm, Roughness 13.17 nm, Dust 2/s, Static 0.08/s, Elliptical, Tracking Force 2.0 g, Standard, Mix 100%।
3. **Inner-groove demo:** Cut Level +3 dB, HF Cutoff 14 kHz, Radius 60 mm, Elliptical, Scan Radius 8 µm, Tracking Force 2.0 g, High, Mix 100%; बड़े Radius से Tracking S/E की तुलना करें।
4. **घिसी surface:** Radius 100 mm, Roughness 35 nm, Dust 25/s, Static 1/s, Scratch 0.5/s, Tracking Force 2.2 g, Standard, Output Gain -3 dB, Mix 100%।

### Quality और CPU load

हर Quality preset base substeps और contact points तय करता है। Stability के लिए engine `Nmin = ceil(8 × f_c / sampleRate)` भी निकालता है, जहाँ contact-resonance frequency `f_c`, Tracking Force, Tip Mass, Compliance, Shape, Side Radius और Scan Radius से तय होती है; फिर `effectiveSubsteps = max(base, Nmin)` इस्तेमाल होता है। Default settings पर 96 kHz Standard अपने base 4 substeps पर ही रहता है, इसलिए मौजूदा performance target नहीं बदलता।

मुख्य load sample rate × effective substeps × contact points के समानुपाती है। नीचे contact evaluations और relative load तब के base estimates हैं जब stability floor substeps नहीं बढ़ाता; ये measured CPU percentages नहीं हैं। Processor, browser और WASM SIMD भी वास्तविक load बदलते हैं।

| Quality | Base physical detail | 96 kHz पर base evaluations | Base relative load | उपयोग |
|---|---:|---:|---:|---|
| Eco | 2 × 7 | 2.7 million/s | 0.39× | Mobile, low-power, कई instances |
| Standard | 4 × 9 | 6.9 million/s | 1.00× | सामान्य real-time listening |
| High | 8 × 13 | 20 million/s | 2.89× | तेज systems, focused comparison |
| Ultra | 20 × 25 | 96 million/s | 13.89× | Offline rendering और verification |

Stability floor inactive हो तो base relative load पर ये sample-rate multipliers लगाएँ: 44.1 kHz = 0.46×, 48 = 0.50×, 88.2 = 0.92×, 96 = 1.00×, 176.4 = 1.84× और 192 = 2.00×। Sample rate और Tracking Force, Tip Mass, Compliance, Shape, Side Radius तथा Scan Radius settings floor को सक्रिय करके वास्तविक load को base estimate से ऊपर ले जा सकती हैं। Playback टूटे तो पहले Quality घटाएँ।

### WASM आवश्यकता और मॉडल की सीमाएँ

Vinyl Simulator के real-time processing के लिए native WebAssembly DSP kernel जरूरी है। `?dsp=off` से WASM बंद हो, environment असमर्थ हो या initialization fail हो तो input बिना बदलाव pass होता है और UI बताता है कि WASM जरूरी है। बहुत धीमी JavaScript reference simulation को fallback के रूप में नहीं चलाया जाता।

Model पहले stereo pair को process करता है। Dust deformation केवल particle के active रहने तक बचती है और stylus हमेशा नए generated groove पर आगे बढ़ता है; wear अगले revolutions तक जमा नहीं होता और presets में save नहीं होता। Long-term wear, 3D visualization, real-time SNR/THD meters, wow/flutter, eccentricity, warping, turntable rumble और cartridge electrical loading model के बाहर हैं।

याद रखें: ये प्रभाव आपके संगीत में चरित्र और नॉस्टैल्जिया जोड़ने के लिए हैं। सूक्ष्म सेटिंग्स से शुरू करें और स्वाद के अनुसार समायोजित करें!
