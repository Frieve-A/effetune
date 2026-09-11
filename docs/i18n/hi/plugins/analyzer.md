---
title: "विश्लेषण प्लगइन - EffeTune"
description: "Level Meter, Note Spectrogram, Oscilloscope, Spectrogram, Spectrum Analyzer और Stereo Meter सहित ऑडियो विश्लेषण प्लगइन।"
lang: hi
---

# विश्लेषण प्लगइन

ये प्लगइन संगीत को देखने के रोचक तरीके देते हैं। ध्वनि के अलग-अलग पहलू दिखाई देने से आप जो सुन रहे हैं उसे बेहतर समझ सकते हैं, और सुनने का अनुभव अधिक जीवंत और इंटरैक्टिव हो जाता है।

## प्लगइन सूची

- [Level Meter](#level-meter) - digital signal level और संभावित clipping दिखाता है
- [Note Spectrogram](#note-spectrogram) - समय के साथ अनुमानित pitch को piano roll में दिखाता है
- [Oscilloscope](#oscilloscope) - waveform को real time में दिखाता है
- [Spectrogram](#spectrogram) - आपके संगीत से सुंदर visual patterns बनाता है
- [Spectrum Analyzer](#spectrum-analyzer) - संगीत की अलग-अलग frequencies दिखाता है
- [Stereo Meter](#stereo-meter) - stereo balance और phase relationships को visualize करता है

## Level Meter

एक visual display जो आपके संगीत का digital signal level real time में दिखाता है। इफेक्ट्स लगाने के बाद level जांचने और clipping को audible distortion बनने से पहले पहचानने में मदद करता है।

### विज़ुअलाइज़ेशन गाइड
- horizontal bar जितना दाईं ओर बढ़ता है, signal level उतना ऊंचा होता है
- white marker नया peak एक सेकंड तक hold करता है, फिर धीरे-धीरे नीचे आता है
- OVERLOAD का मतलब है signal safe digital range से ऊपर गया और distort हो सकता है
- clean playback के लिए बार-बार red levels या OVERLOAD warnings से बचें; असली listening volume अपने device पर सेट करें

## Note Spectrogram

ऑडियो को बदले बिना A0 से C8 तक की अनुमानित fundamental frequencies (F0) को चलते हुए piano roll में दिखाता है। इसका उपयोग chord की notes, बदलती vocal और melody lines, bass line और अलग-अलग octave में एक साथ बजने वाली notes को समझने के लिए करें।

### विज़ुअलाइज़ेशन गाइड

- **Vertical** में समय बाएँ से दाएँ दिखता है और दाएँ किनारे पर कीबोर्ड और मौजूदा ध्वनि दिखाई देते हैं। ऊँचे स्वर ऊपर होते हैं।
- **Horizontal** में कीबोर्ड नीचे होता है, जिसमें निचले स्वर बाईं ओर और ऊँचे स्वर दाईं ओर होते हैं। नई ध्वनि कीबोर्ड के ठीक ऊपर दिखाई देती है और इतिहास ऊपर की ओर खिसकता है।
- हर C पर रेखा सप्तक की सीमा दिखाती है।
- काली piano keys से जुड़ी pitch rows को लगभग काले gray background में दिखाया जाता है, ताकि कोई note detect न होने पर भी वे पहचानी जा सकें।
- **Normal** में थीम का ग्राफ़ रेखा रंग होता है; **Note Colors** में हर स्वर का अलग रंग होता है, जो सभी सप्तकों में दोहराया जाता है। दोनों में E और F के बीच की सहायक रेखाएँ सप्तक की सीमाओं से गहरी होती हैं।
- **1/12 Octave** हर semitone के लिए एक row दिखाता है। **High (1/60 Octave)** हर semitone को पाँच rows में बाँटता है, जिससे pitch के छोटे बदलाव देखना आसान होता है; पास-पास के notes के रंगों को बीच की rows में मिलाया जाता है।
- रंग मॉडल के विश्वास स्तर के अनुसार 0 (पृष्ठभूमि का रंग) से 1 (पूरा रंग) तक बदलती है। कमजोर संभावित स्वर भी किसी प्रदर्शन सीमा से हटाए बिना दिखाए जाते हैं। यह स्कोर बताता है कि मॉडल किसी स्वर की मौजूदगी का कितना समर्थन करता है; यह अंशांकित प्रायिकता नहीं है।
- **Volume** चालू करने पर हर पहचानी गई pitch एक bar के रूप में दिखती है, जिसकी अपारदर्शी core की मोटाई frequency-corrected relative volume बताती है। यह core scale के निचले सिरे पर 1/60 octave और ऊपरी सिरे पर 1/12 octave होती है। core के दोनों ओर 1/120 octave का fade जुड़ता है, इसलिए कुल drawing width core से 1/60 octave अधिक होती है। **Pitch Resolution** केवल bar के केंद्र की स्थिति बदलता है, core की मोटाई नहीं।
- keyboard की सीमा से graph की ओर फैला soft-edge अर्धवृत्त मौजूदा volume दिखाता है। volume बढ़ने पर यह तुरंत प्रतिक्रिया देता है और घटने पर 20 dB प्रति सेकंड की दर से नीचे आता है; अलग से दिखाई देने वाला peak hold नहीं है।
- volume scale 24 dB का range दिखाता है। इसका ऊपरी सिरा history scale को स्थिर रखने वाली हाल की reference (लगभग एक सेकंड) और -36 dB में जो अधिक हो, उसका अनुसरण करता है। यह reference मौजूदा volume वाले अर्धवृत्त से अलग है। इससे शांत सामग्री पढ़ने योग्य रहती है और तेज़ हिस्से display को लगातार नहीं भरते।
- octave और E–F की guide lines volume bars के पीछे बनाई जाती हैं, इसलिए pitch grid एक दृश्य संदर्भ बनी रहती है।
- नवीनतम फ़्रेम में विश्वास स्तर बढ़ने पर कुंजियाँ अपने सामान्य रंग से धीरे-धीरे प्रदर्शन रंग की ओर बदलती हैं और 1 पर पूरी तरह उसी रंग की हो जाती हैं।
- **Color** बदलने पर मौजूदा इतिहास नए रंगों में दिखता है।

### आप क्या देख सकते हैं

- chords एक ही समय पर कई चमकीली rows के रूप में दिखते हैं
- melodies और bass lines note rows के बीच चलने वाले paths बनाती हैं
- यह display MIDI या music notation नहीं बनाता, instruments पहचानता नहीं है, और हर एक साथ बजने वाली sound को पूरी तरह अलग नहीं कर सकता। जटिल overlaps melody या harmony के कुछ हिस्से छोड़ सकते हैं, जबकि percussion, noise और अस्पष्ट repeating patterns कभी-कभी गलत pitch दिखा सकते हैं।

### पैरामीटर

- **Color** - स्वरों के अनुमान बदले बिना प्रदर्शन के रंग चुनता है।
  - **Normal** (डिफ़ॉल्ट): थीम का ग्राफ़ रेखा रंग।
  - **Note Colors**: हर स्वर का अलग रंग, जो सभी सप्तकों में दोहराया जाता है।
- **Pitch Resolution** - मौजूदा history मिटाए बिना pitch की vertical detail चुनता है।
  - **1/12 Octave** (डिफ़ॉल्ट): हर semitone के लिए एक row, जिसमें उस note की सीमा का सबसे मजबूत अनुमान दिखता है।
  - **High (1/60 Octave)**: pitch के अधिक सूक्ष्म बदलाव दिखाने के लिए हर semitone में पाँच rows।
- **Layout** - **Horizontal** (डिफ़ॉल्ट) या **Vertical** चुनता है। लेआउट बदलने पर मौजूदा इतिहास बना रहता है।
- **Volume** - bar की मोटाई और अर्धवृत्ताकार meters से relative volume दिखाता है। यह डिफ़ॉल्ट रूप से चालू रहता है; बंद करने पर पहले की तरह केवल confidence वाली rows दिखाई देती हैं।
- **Time Span** (1 से 10 s) - पियानो रोल में दिखाई देने वाली समय अवधि तय करता है
  - कम value timing के बदलाव अधिक साफ़ दिखाती है
  - अधिक value लंबा musical passage एक साथ दिखाती है
  - Default: 2 s
- **Regular Note Limit** (1 से 16 notes) - अलग low-note range के बाहर final detection stage तक पहुँचने वाले simultaneous notes की संख्या तय करता है। Default 8 है। बहुत dense chords के लिए इसे बढ़ाएँ; कम value analysis work और candidates के बीच competition घटाती है।
- **Lowest Note** - दिखाई और analyze की जाने वाली pitch range का सबसे निचला note तय करता है। Default: E1.
- **Highest Note** - दिखाई और analyze की जाने वाली pitch range का सबसे ऊँचा note तय करता है। Default: G6.
- input analysis के लिए बहुत कम होने पर piano roll बहुत छोटे input को pitches के रूप में दिखाने के बजाय गहरा रहता है। यह suppression तय नहीं करता कि कोई sound सुनाई देगी या perceptually masked होगी।

## Oscilloscope

सुनते समय sound wave का shape real time में दिखाता है, ताकि beats, sharp hits और loudness में बदलाव देख सकें। waveform दोहराने पर trigger settings display को स्थिर कर सकती हैं।

### विज़ुअलाइज़ेशन गाइड
- horizontal axis समय दिखाता है (milliseconds)
- vertical axis normalized amplitude दिखाता है; दिखने वाली range Display Level और Vertical Offset से बदलती है
- green line actual waveform trace करती है
- grid lines time और amplitude values मापने में मदद करती हैं
- trigger settings तय करती हैं कि waveform capture कहां से शुरू होगा; कोई अलग marker नहीं दिखता

### पैरामीटर
- **Display Time** - कितना समय दिखाना है (1 से 100 ms)
  - कम मान: छोटी घटनाओं में अधिक detail देखें
  - अधिक मान: लंबे patterns देखें
- **Trigger Mode**
  - Auto: trigger के बिना भी continuous updates
  - Normal: अगले trigger तक display freeze रहता है
- Trigger detection averaged left/right waveform का उपयोग करती है। Mono input सीधे उपयोग होता है।
- **Trigger Level** - capture शुरू करने वाला amplitude level
  - Range: -1 से 1 (normalized amplitude)
- **Trigger Edge**
  - Rising: signal ऊपर जाते समय trigger
  - Falling: signal नीचे जाते समय trigger
- **Holdoff** - triggers के बीच न्यूनतम समय (0.1 से 10 ms)
- **Display Level** - dB में vertical scale (-96 से 0 dB)
- **Vertical Offset** - waveform को ऊपर/नीचे shift करता है (-1 से 1)

### वेवफॉर्म डिस्प्ले पर नोट
displayed waveform captured points को time order में जोड़ता है। लंबे Display Time पर हर interval अपने पहले और आखिरी sample के साथ minimum और maximum samples तथा उनकी original positions भी सुरक्षित रखता है। इससे display resolution की सीमा में continuity और छोटे peaks बने रहते हैं। इसे exact measurement tool के बजाय visual guide की तरह इस्तेमाल करें।

## Spectrogram

रंगीन पैटर्न बनाता है जो दिखाते हैं कि आपका संगीत समय के साथ कैसे बदलता है। रंग बताते हैं कि हर ध्वनि कितनी मजबूत है, और ऊर्ध्व स्थिति उसकी आवृत्ति दिखाती है।

ग्राफ़ एक समान गति से दाएँ से बाएँ खिसकता है और हर सेकंड के लिए एक निशान दिखाता है।

### विज़ुअलाइज़ेशन गाइड
- रंग दिखाते हैं कि अलग-अलग आवृत्तियाँ कितनी मजबूत हैं:
  - गहरे रंग: शांत ध्वनियाँ
  - चमकीले रंग: तेज़ ध्वनियाँ
  - संगीत के साथ पैटर्न बदलते हुए देखें
- ऊर्ध्व स्थिति आवृत्ति दिखाती है:
  - नीचे: बास ध्वनियाँ
  - बीच: मुख्य वाद्य
  - ऊपर: उच्च आवृत्तियाँ

### आप क्या देख सकते हैं
- धुनें: रंग की बहती हुई रेखाएँ
- बीट्स: ऊर्ध्व धारियाँ
- बास: नीचे चमकीले रंग
- हार्मोनियाँ: कई समानांतर रेखाएँ
- अलग-अलग वाद्य अपने खास पैटर्न बनाते हैं

### पैरामीटर
- **DB Range** - रंग कितने vibrant दिखेंगे (-144dB से -48dB)
  - कम numbers: अधिक subtle details देखें
  - अधिक numbers: मुख्य sounds पर focus करें
- **Points** - display के लिए उपयोग होने वाला FFT size (256 से 16384)
  - अधिक numbers: अधिक frequency detail, लेकिन time updates धीमे
  - कम numbers: तेज़ movement, लेकिन कम frequency detail
- **Frequency Scale** - **Log** कम आवृत्तियों को display पर अधिक जगह देता है; **Linear** समान आवृत्ति चौड़ाइयों को समान अंतराल पर दिखाता है।
- analyzer left और right channels का average उपयोग करता है। Mono input सीधे analyze होता है।

## Spectrum Analyzer

गहरे bass से high treble तक, आपके संगीत की frequencies का real-time visual display बनाता है। यह आपके संगीत की पूरी ध्वनि बनाने वाले अलग-अलग घटकों को देखने जैसा है।

### विज़ुअलाइज़ेशन गाइड
- बाईं ओर bass frequencies दिखती हैं (drums, bass guitar)
- बीच में मुख्य frequencies दिखती हैं (vocals, guitars, piano)
- दाईं ओर high frequencies दिखती हैं (cymbals, sparkle, air)
- ऊंचे peaks का मतलब उन frequencies की stronger presence है
- darker green line मौजूदा sound दिखाती है
- brighter green line recent peaks का अनुसरण करती है और उनके fade होने पर धीरे-धीरे नीचे आती है
- देखें कि अलग-अलग instruments कैसे अलग patterns बनाते हैं

### आप क्या देख सकते हैं
- बास ड्रॉप: बाईं ओर बड़ी हलचल
- वोकल धुनें: बीच में गतिविधि
- साफ़ ऊंचे स्वर: दाईं ओर चमक
- पूरा मिक्स: सभी frequencies एक साथ कैसे काम करती हैं

### पैरामीटर
- **DB Range** - display कितना sensitive है (-144dB से -48dB)
  - कम numbers: अधिक subtle details देखें
  - अधिक numbers: मुख्य sounds पर focus करें
- **Points** - display nearby frequencies को कितनी बारीकी से अलग करता है (256 से 16384)
  - अधिक numbers: अधिक frequency detail, updates धीमे
  - कम numbers: तेज़ updates, कम frequency detail
- **Frequency Scale** - **Log** कम आवृत्तियों को display पर अधिक जगह देता है; **Linear** समान आवृत्ति चौड़ाइयों को समान अंतराल पर दिखाता है।
- analyzer left और right channels का average उपयोग करता है। Mono input सीधे analyze होता है।

### इन टूल का उपयोग करने के मज़ेदार तरीके

1. अपने संगीत को explore करें
   - देखें कि अलग-अलग genres कैसे अलग patterns बनाते हैं
   - acoustic और electronic music का फर्क देखें
   - देखें कि instruments अलग frequency ranges में कैसे जगह लेते हैं

2. ध्वनि के बारे में सीखें
   - electronic music में bass देखें
   - vocal melodies को display पर चलते देखें
   - देखें कि drums कैसे sharp patterns बनाते हैं

3. सुनने का अनुभव बढ़ाएं
   - effects जोड़ने के बाद signal peaks जांचने के लिए Level Meter इस्तेमाल करें
   - Spectrum Analyzer को संगीत के साथ नाचते देखें
   - Spectrogram से visual light show बनाएं

## Stereo Meter

यह दृश्य उपकरण दिखाता है कि आपका संगीत स्टीरियो ध्वनि से जगह और फैलाव का एहसास कैसे बनाता है। बाएँ और दाएँ चैनल का संबंध देखकर आप समझ सकते हैं कि ध्वनि बीच में केंद्रित है, चौड़ी फैली हुई है या किसी एक ओर झुकी हुई है।

### विज़ुअलाइज़ेशन गाइड
- **डायमंड डिस्प्ले** - मुख्य क्षेत्र जहां स्टीरियो छवि दिखाई देती है:
  - Center: बहुत शांत क्षण, या ऐसे क्षण जब संयुक्त संकेत लगभग शून्य हो
  - Top/Bottom: बाएँ और दाएँ चैनल में साझा ध्वनि, जैसे बीच में स्थित या मोनो जैसी सामग्री
  - Left/Right: चैनलों के बीच का अंतर या विपरीत-फेज वाली सामग्री
  - किसी एक ओर बहुत मजबूत ध्वनि हो तो वह लेबल वाले कोनों की तरफ दिखाई दे सकती है
  - हरे बिंदु वर्तमान संगीत के साथ चलते हैं
  - सफेद रेखा संगीत की हाल की चोटियों को दिखाती है
  - सफेद पीक रेखा हर ऑडियो सैंपल के साथ घटती है, इसलिए प्रोसेसिंग ब्लॉक का आकार बदलने पर भी उसकी गति एक जैसी रहती है
- **Correlation Bar** (बाईं ओर)
  - बाएँ और दाएँ चैनल का आपसी संबंध दिखाता है
  - Top (+1.0): दोनों चैनल लगभग समान हैं, इसलिए ध्वनि अक्सर बीच में सुनाई देती है
  - Middle (0.0): चैनलों का संबंध कमजोर है, जैसे बहुत फैला हुआ वातावरण या अलग-अलग बाएँ/दाएँ सामग्री
  - Bottom (-1.0): दोनों चैनल लगभग उलटी ध्रुवता में हैं, जिससे स्पीकर पर ध्वनि कमजोर लग सकती है
- **Balance Bar** (नीचे)
  - दिखाता है कि एक स्पीकर दूसरे से अधिक तेज़ है या नहीं
  - Center: संगीत दोनों स्पीकर में बराबर तेज़ है
  - Left/Right: संगीत किसी एक स्पीकर में अधिक मजबूत है
  - संख्याएँ decibels (dB) में तेज़ी का अंतर दिखाती हैं

### आप क्या देख सकते हैं
- **बीच में केंद्रित ध्वनि:** बीच में मजबूत ऊर्ध्व गति
- **फैली हुई ध्वनि:** पूरे डिस्प्ले में चौड़ी गतिविधि
- **विशेष प्रभाव:** कोनों में रोचक पैटर्न
- **स्पीकर संतुलन:** नीचे की पट्टी किस ओर झुकती है
- **चैनल संबंध:** बाईं correlation पट्टी क्या दिखाती है

### पैरामीटर
- **Window** (10-1000 ms) - डिस्प्ले में हाल का कितना ऑडियो दिखेगा
  - कम मान: तेज़ संगीत बदलाव देखें
  - अधिक मान: समग्र ध्वनि पैटर्न देखें
  - डिफ़ॉल्ट 100 ms अधिकतर संगीत के लिए अच्छा काम करता है

### अपने संगीत का आनंद लें
1. **अलग-अलग शैलियाँ देखें**
   - शास्त्रीय संगीत अक्सर कोमल और संतुलित पैटर्न दिखाता है
   - इलेक्ट्रॉनिक संगीत अधिक फैलती हुई और तेज़ गतिविधि बना सकता है
   - लाइव रिकॉर्डिंग प्राकृतिक कमरे की गति दिखा सकती हैं

2. **ध्वनि की खूबियाँ पहचानें**
   - देखें कि अलग-अलग एल्बम स्टीरियो प्रभावों का उपयोग कैसे करते हैं
   - ध्यान दें कि कुछ गीत दूसरों से अधिक चौड़े क्यों लगते हैं
   - देखें कि वाद्य ध्वनियाँ स्पीकरों के बीच कैसे चलती हैं

3. **अपना अनुभव बढ़ाएँ**
   - अलग-अलग हेडफ़ोन आज़माकर देखें कि वे स्टीरियो छवि को कैसे दिखाते हैं
   - अपने पसंदीदा गीतों की पुरानी और नई रिकॉर्डिंग की तुलना करें
   - देखें कि अलग सुनने की जगहों पर डिस्प्ले कैसे बदलता है

याद रखें: ये उपकरण संगीत सुनने में एक दृश्य आयाम जोड़कर आनंद बढ़ाने के लिए हैं। अपने पसंदीदा संगीत को देखने के नए तरीके खोजें और आनंद लें!
