# Pipeline Analyzer

Pipeline Analyzer सुनाई देने वाले ऑडियो को बदले बिना सक्रिय Effect Pipeline की प्रतिक्रिया मापता है। चौड़ी विंडो में यह pipeline के पास और संकरी विंडो में उसके header के नीचे रहता है, इसलिए effect को बदलते समय परिणाम देखा जा सकता है।

इसे Effect Pipeline header के graph button या desktop app में **View > Pipeline Analyzer** से खोलें। **Auto** चुना होने पर pipeline बदलते ही नया मापन अपने-आप शुरू होता है। **Auto** बंद करने पर pipeline के बदलावों को मापने के लिए **Refresh measurements** चुनें। Measurement settings बदलने पर हमेशा नया मापन शुरू होता है।

## चैनल और स्पीकर प्रतिक्रियाएँ

एक input channel चुनें। शुरुआत में एक output होता है; मौजूदा audio device के अलग-अलग channels में से अधिकतम चार जोड़ने के लिए **+ आउटपुट जोड़ें** चुनें। Output हटाने पर उसकी speaker-response setting भी हटती है। अंतिम output को हटाया नहीं जा सकता।

हर output के लिए **स्पीकर IR नहीं**, या जुड़े tweeter, woofer या दूसरे speaker unit का saved measurement point चुन सकते हैं। Measurement चुनकर उसका point न चुनना **स्पीकर IR नहीं** के समान माना जाता है। किसी भी output में speaker IR न होने पर **पहले** आदर्श इकाई आवेग होता है: 0 ms पर 1.0 और बाकी हर समय 0। Speaker IR होने पर **पहले** समय-संरेखित responses का signed sum है और **बाद में** हर output को चुने गए pipeline से process करने के बाद का signed sum है। इससे FIR Crossover को speaker units के साथ जाँचा जा सकता है। कोई saved response न मिले तो वह बदलने या हटाने तक missing के रूप में साफ़ दिखाई देता है।

Saved responses को उनकी पहचानी गई शुरुआत पर align किया जाता है। अलग measurements drivers के बीच वास्तविक acoustic arrival-time difference को सुरक्षित नहीं रखते; कुल परिणाम पर भरोसा करने से पहले pipeline में relative delay और polarity सेट करें।

## मापन सेटिंग्स

इन विकल्पों के लिए **मापन सेटिंग्स** खोलें:

- **Signal** में डिफ़ॉल्ट रूप से **MLS** चुना जाता है। **TSP** एक वैकल्पिक आवर्ती टेस्ट सिग्नल है, जबकि **Unit Impulse** सीधे समय-आधारित प्रतिक्रिया पकड़ता है। nonlinear या समय के साथ बदलने वाले effects में ये तरीके pipeline को अलग-अलग तरह से माप सकते हैं।
- **Level** टेस्ट सिग्नल का पीक तय करता है और डिफ़ॉल्ट -12 dBFS है। linear effects सामान्यतः हर स्तर पर वही सामान्यीकृत प्रतिक्रिया देते हैं; nonlinear और स्तर पर निर्भर effects अलग परिणाम दे सकते हैं।
- **Sequence Length** तय करता है कि MLS या TSP कितनी लंबी प्रतिक्रिया को साफ़ माप सकता है। लंबी सेटिंग में अधिक समय और मेमोरी लगती है। delay, reverb या लंबे समय तक बजने वाले effects के लिए इसे बढ़ाएँ, खासकर जब analyzer इसकी सलाह दे।
- **Stabilization Periods** डिफ़ॉल्ट रूप से 12 है और मापन से पहले pipeline को स्थिर होने देता है। धीमे बदलने वाला effect स्थिर न हुआ हो तो इसे बढ़ाएँ।
- **Averages** डिफ़ॉल्ट रूप से 2 है। ग्राफ़ अस्थिर हो तो अलग-अलग मापों का अंतर घटाने के लिए इसे बढ़ाएँ; मापन में अधिक समय लगेगा।

विवरण में बताया जाता है कि मौजूदा लंबाई पर्याप्त है या नहीं, सुझाई गई लंबाई और स्थिरीकरण समय क्या है, और कुल मापन समय कितना है। सुझाव केवल मार्गदर्शन हैं; मापे जा रहे effects के लिए उपयुक्त होने पर उन्हें अपनाएँ।

Sequence Length, Stabilization Periods और Averages केवल Unit Impulse के लिए बंद रहते हैं। Frequency, Phase, Min Group Delay, Excess Group Delay या Impulse बदलने से केवल दिखाया गया ग्राफ़ बदलता है, मापन दोबारा नहीं होता।

## ग्राफ़ पढ़ना और मापन विधि

ग्राफ़ के बाहर दिए **Graph** radio buttons से view चुनें। **Frequency** स्तर, **Phase** चरण, **Min Group Delay** magnitude response के minimum-phase हिस्से से बनने वाला delay, **Excess Group Delay** उस हिस्से को हटाने के बाद बचा delay और **Impulse** time response दिखाता है। ग्राफ़ हमेशा **Before** और **After** दिखाता है। दोनों मान पढ़ने के लिए पॉइंटर चलाएँ; **Before** पर पॉइंटर रखने से **After** अस्थायी रूप से छिप जाता है। Frequency और दोनों Group Delay views में **Smoothing (oct)** लागू होता है। हर frequency curve को अलग से 0 dB पर रखा जाता है; हर impulse अपने सबसे बड़े peak से सामान्यीकृत होकर -2 ms से चुनी हुई **Impulse Range (ms)** तक दिखता है।

हर मापन सक्रिय pipeline, उसकी मौजूदा setting और routing, तथा चुनी हुई speaker responses को पकड़ता है। ग्राफ़ frequency, phase, minimum और excess group-delay तथा impulse responses दिखाते हैं; **After** pipeline द्वारा बताए गए latency की भरपाई करता है।

MLS और TSP सामान्य मापन के लिए उपयुक्त हैं। अगर delay, reverb या ringing चुनी हुई window से आगे बढ़े, तो response अपने ऊपर चढ़ सकता है; **Sequence Length** बढ़ाएँ। **Unit Impulse** सीमित समय तक response सीधे रिकॉर्ड करता है, इसलिए बहुत लंबी tail कट सकती है।

nonlinear, समय के साथ बदलने वाले, random, noisy या sound-generating effects अलग स्तरों पर या अलग-अलग मापों में अलग परिणाम दे सकते हैं। इन ग्राफ़ों को चुनी हुई setting का snapshot मानें, कोई स्थायी विशेषता नहीं।
