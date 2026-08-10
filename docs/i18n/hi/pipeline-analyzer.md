# Pipeline Analyzer

Pipeline Analyzer सुनाई देने वाले ऑडियो को बदले बिना सक्रिय Effect Pipeline की प्रतिक्रिया मापता है। चौड़ी विंडो में यह pipeline के पास और संकरी विंडो में उसके header के नीचे रहता है, इसलिए effect को बदलते समय परिणाम देखा जा सकता है।

इसे Effect Pipeline header के graph button या desktop app में **View > Pipeline Analyzer** से खोलें। Pipeline या measurement settings बदलने पर नया मापन अपने-आप शुरू होता है।

## चैनल और स्पीकर प्रतिक्रियाएँ

एक input channel चुनें। शुरुआत में एक output होता है; मौजूदा audio device के अलग-अलग channels में से अधिकतम चार जोड़ने के लिए **+ आउटपुट जोड़ें** चुनें। Output हटाने पर उसकी speaker-response setting भी हटती है। अंतिम output को हटाया नहीं जा सकता।

हर output के लिए **स्पीकर IR नहीं**, या जुड़े tweeter, woofer या दूसरे speaker unit का saved measurement point चुन सकते हैं। **पहले** समय-संरेखित speaker responses का signed sum है और **बाद में** हर output को चुने गए pipeline से process करने के बाद का signed sum है। इससे FIR Crossover को speaker units के साथ जाँचा जा सकता है। कोई saved response न मिले तो वह बदलने या हटाने तक missing के रूप में साफ़ दिखाई देता है।

Saved responses को उनकी पहचानी गई शुरुआत पर align किया जाता है। अलग measurements drivers के बीच वास्तविक acoustic arrival-time difference को सुरक्षित नहीं रखते; कुल परिणाम पर भरोसा करने से पहले pipeline में relative delay और polarity सेट करें।

## मापन सेटिंग्स

**मापन सेटिंग्स** खोलकर ये controls बदलें:

- **सिग्नल**: default **MLS** है। **TSP** समान stabilization और averaging controls वाला periodic phase-sweep signal देता है। **यूनिट इम्पल्स** सीधा time-domain capture देता है।
- **स्तर**: test signal का peak, default `-12 dBFS`। Nonlinear या level-dependent effects अलग परिणाम दे सकते हैं।
- **सीक्वेंस लंबाई**: MLS 32,767 से 524,287 samples और TSP उनसे मेल खाने वाली powers of two, 32,768 से 524,288, उपयोग करता है। Signal बदलने पर वही order बना रहता है। लंबी sequence circular overlap से पहले लंबी response दिखाती है। Analyzer सुझाव दे सकता है, पर इसे अपने-आप नहीं बदलता।
- **स्थिरीकरण अवधि**: default 12। Capture से पहले MLS या TSP इतने periods तक लगातार चलता है और वास्तविक समय दिखाया जाता है।
- **औसत**: default 2। अधिक periods repeated captures की variation कम करते हैं।

विवरण में **मौजूदा सपोर्ट**, **सुझाई गई सीक्वेंस लंबाई**, periods और seconds में **सुझाया गया स्थिरीकरण**, और **कुल test-signal समय** भी दिखता है। ये केवल मार्गदर्शन के लिए हैं; Pipeline Analyzer settings को अपने-आप नहीं बदलता।

Sequence Length, Stabilization Periods और Averages केवल Unit Impulse के लिए disabled होते हैं। Frequency, Phase, Group Delay या Impulse बदलने से केवल graph बदलता है, measurement नहीं।

## Graph और मापन विधि

**Frequency** level, **Phase** phase, **Group Delay** frequency के अनुसार delay और **Impulse** time response दिखाता है। Graph हमेशा केवल **पहले** और **बाद में** की दो curves दिखाता है। Pointer से दोनों values पढ़ें; **पहले** पर pointer रखने से **बाद में** अस्थायी रूप से छिप जाता है। Frequency और Group Delay में साझा **स्मूदिंग (oct)** control है। हर frequency curve अलग-अलग 0 dB पर reference होती है; हर impulse अपने पूरे response peak से normalize होकर -2 ms से चुनी गई **इम्पल्स रेंज (ms)** तक दिखती है।

हर run वर्तमान pipeline, resources, routing, speaker responses और settings को freeze करके isolated worker में चलाता है। MLS circular correlation और TSP inverse sweep से DC को छोड़कर periodic response निकालता है। दिखाए गए phase, group delay और impulse time से pipeline की reported latency घटाई जाती है। Unit Impulse चुने गए level से capture को normalize करता है और सीमित tail capture इस्तेमाल करता है।

Nonlinear, time-varying, random, noisy या sound-generating effects में परिणाम चुने गए level और initial state की एक capture है, universal transfer function नहीं। Measurements के बीच परिणाम बदल सकता है। Invalid numeric output या किसी आवश्यक processor/resource के तैयार न होने पर measurement fail होता है।
