---
title: "बेसिक प्लगइन - EffeTune"
description: "Volume, Mute, Stereo Balance, Matrix routing आदि सहित बुनियादी ऑडियो प्लगइन।"
lang: hi
---

# बेसिक ऑडियो प्लगइन

ये आपके music playback के बुनियादी पहलुओं को समायोजित करने वाले जरूरी tools हैं। Volume, balance और listening experience की मूल सेटिंग्स को नियंत्रित करने में ये plugin मदद करते हैं।

## प्लगइन सूची

- [Channel Divider](#channel-divider) - stereo audio को frequency bands में बांटकर stereo output pairs पर भेजता है
- [DC Offset](#dc-offset) - constant DC offset जोड़ता या ठीक करता है
- [Matrix](#matrix) - audio channels को flexible control के साथ route और mix करता है
- [MultiChannel Panel](#multichannel-panel) - कई audio channels को individual settings से नियंत्रित करता है
- [Mute](#mute) - audio output को silent करता है
- [Polarity Inversion](#polarity-inversion) - correction या special routing cases के लिए signal polarity flips करता है
- [Stereo Balance](#stereo-balance) - आपके संगीत का left-right balance समायोजित करता है
- [Volume](#volume) - music कितनी loud बजेगी, यह नियंत्रित करता है

## Channel Divider

यह specialized tool आपके stereo signal को अलग frequency bands में बांटता है और हर band को अलग stereo output pair पर route करता है। multi-amplifier, multi-speaker या custom crossover playback setups के लिए उपयोगी है।

इस effect का उपयोग करने के लिए desktop app इस्तेमाल करें, audio settings में output channels की संख्या band count के अनुसार 4, 6 या 8 सेट करें, और effect bus routing में channel को "All" पर सेट करें।

### कब उपयोग करें
- multi-channel audio outputs (4, 6 या 8 channels) इस्तेमाल करते समय
- custom frequency-based channel routing बनाने के लिए
- multi-amplifier या multi-speaker setups के लिए

### पैरामीटर
- **Band Count** - बनाए जाने वाले frequency bands की संख्या (2-4 bands)
  - 2 bands: Low/High split, 4 output channels चाहिए
  - 3 bands: Low/Mid/High split, 6 output channels चाहिए
  - 4 bands: Low/Mid-Low/Mid-High/High split, 8 output channels चाहिए
  - चुनी गई output channel count कम होने पर higher band counts उपलब्ध नहीं होते

- **Crossover Frequencies** - bands के बीच audio कहां split होगा, यह तय करती हैं
  - F1: पहला crossover point
  - F2: दूसरा crossover point (3+ bands के लिए)
  - F3: तीसरा crossover point (4 bands के लिए)
  - हर crossover 10 Hz से 40000 Hz तक set किया जा सकता है
  - plugin F1, F2 और F3 को कम से कम 1 Hz separation के साथ ascending order में रखता है

- **Slopes** - bands कितनी sharpness से अलग होंगे, यह नियंत्रित करता है
  - Options: -12dB से -96dB per octave
  - steeper slopes साफ separation देते हैं
  - lower slopes अधिक natural transitions देते हैं

### तकनीकी नोट्स
- केवल पहले दो input channels process करता है
- output channels 2 के multiple होने चाहिए (4, 6 या 8)
- हर band original stereo pair बनाए रखता है: 2-band mode में Low channels 1-2 और High channels 3-4 पर जाता है; 3-band mode channels 1-2, 3-4 और 5-6 इस्तेमाल करता है; 4-band mode channels 1-2, 3-4, 5-6 और 7-8 इस्तेमाल करता है
- high-quality Linkwitz-Riley crossover filters इस्तेमाल करता है
- आसान configuration के लिए visual frequency response graph देता है

## DC Offset

यह utility ऐसे signal को ठीक करने के लिए है जिसकी waveform zero line से हटकर बैठी हो। अधिकतर listeners को इसे 0.0 पर ही छोड़ना चाहिए, लेकिन unusual files या processing chains में DC offset हो तो यह मदद कर सकता है।

### कब उपयोग करें
- जब audio में constant DC bias हो या दूसरे processing के बाद clicks/headroom problems पैदा हों
- जब diagnostic tool या meter दिखाए कि waveform zero से shift है
- normal listening में इसे 0.0 पर छोड़ें

### पैरामीटर
- **Offset** - हर sample में constant value जोड़ता है (-1.0 से +1.0)
  - 0.0: कोई offset नहीं
  - positive values signal को ऊपर shift करती हैं
  - negative values signal को नीचे shift करती हैं
  - correction की जरूरत हो तो बहुत छोटे adjustments करें

## Matrix

यह channel routing tool unusual speaker या headphone channel layouts ठीक करने, channels swap करने, channels combine करने, या एक channel को एक से अधिक available output पर भेजने के लिए है।

### कब उपयोग करें
- channels के बीच custom routing बनाने के लिए
- जब signals को खास तरीकों से mix या split करना हो
- जब left/right या multi-channel playback गलत speakers से आ रहा हो
- stereo को mono में combine करने या किसी channel को दूसरे available output पर duplicate करने के लिए

### विशेषताएं
- 8 channels तक के लिए flexible routing matrix
- किसी भी input/output pair के बीच individual connection control
- हर connection के लिए phase inversion options
- सहज configuration के लिए visual matrix interface

### यह कैसे काम करता है
- हर connection point input row से output column तक routing दिखाता है
- active connections channels के बीच signal flow करने देते हैं
- phase inversion option signal polarity को reverse करता है
- एक output पर कई input connections हों तो वे साथ mix होते हैं
- कई inputs एक ही output पर भेजे जाएं तो उनके levels जुड़ते हैं, इसलिए volume घटाने की जरूरत पड़ सकती है
- Matrix अपने-आप extra output channels नहीं बनाता; यह केवल अभी उपलब्ध channels के भीतर audio route करता है

### व्यावहारिक उपयोग
- available channels के भीतर custom downmixing, channel swapping या routing
- left और right को mono में combine करना
- किसी channel को दूसरे available output पर duplicate करना
- unusual multi-channel playback layouts ठीक करना

## MultiChannel Panel

कई audio channels को अलग-अलग manage करने वाला comprehensive control panel। यह plugin 8 channels तक volume, mute, solo और delay पर पूरा control देता है, और हर channel के लिए visual level meter दिखाता है।

### कब उपयोग करें
- multi-channel audio (8 channels तक) के साथ काम करते समय
- अलग channels के बीच custom volume balance बनाने के लिए
- किसी खास channel पर individual delay लगाने की जरूरत हो
- कई channels के levels एक साथ monitor करने के लिए

### विशेषताएं
- 8 audio channels तक individual controls
- दृश्य निगरानी के लिए peak hold वाले रीयल-टाइम level meters
- grouped parameter changes के लिए channel linking

### पैरामीटर

#### प्रति-चैनल नियंत्रण
- **Mute (M)** - individual channels को silent करता है
  - हर channel के लिए on/off toggle
  - solo feature के साथ मिलकर काम करता है

- **Solo (S)** - individual channels को isolate करता है
  - किसी भी channel को solo करने पर केवल soloed channels बजते हैं
  - कई channels एक साथ solo किए जा सकते हैं

- **Volume** - individual channel loudness समायोजित करता है (-20dB से +10dB)
  - slider या direct value input से fine control
  - linked channels में समान volume रहता है

- **Delay** - individual channels में time delay जोड़ता है (0-30ms)
  - milliseconds में precise delay control
  - channels के बीच time-alignment के लिए उपयोगी
  - channels के बीच phase adjustment की अनुमति देता है

#### चैनल लिंकिंग
- **Link** - synchronized control के लिए adjacent channels को जोड़ता है
  - एक linked channel में बदलाव सभी connected channels को प्रभावित करता है
  - linked channel groups में consistent settings बनाए रखता है
  - stereo pairs या multi-channel groups के लिए उपयोगी

### विज़ुअल मॉनिटरिंग
- रीयल-टाइम level meters मौजूदा signal strength दिखाते हैं
- peak hold indicators अधिकतम levels दिखाते हैं
- peak levels का स्पष्ट संख्यात्मक dB readout
- levels पहचानने के लिए रंग-कोडित meters:
  - हरा: सुरक्षित levels
  - पीला: maximum के करीब
  - लाल: maximum level के पास या उसी पर

### व्यावहारिक उपयोग
- surround sound या multi-speaker playback balance करना
- speakers अलग दूरी पर हों तो speaker timing match करना
- setup के दौरान individual speakers को अस्थायी रूप से mute या solo करना
- आसान adjustment के लिए stereo pairs या speaker groups link करना

## Mute

यह simple utility buffer को zeros से भरकर सभी audio output को silent करती है। audio signals को तुरंत mute करने के लिए उपयोगी है।

### कब उपयोग करें
- fade के बिना audio तुरंत silent करने के लिए
- silent sections या pauses के दौरान
- unwanted noise output रोकने के लिए

## Polarity Inversion

यह utility audio signal की polarity flip करती है। सभी channels invert करने से आम तौर पर अकेले सुनाई देने वाला फर्क नहीं पड़ता, लेकिन अगर कोई speaker, cable या channel opposite polarity में wired लगता हो तो यह मदद कर सकता है।

suspected left/right या multi-channel polarity mismatch ठीक करने के लिए effect की common routing settings में processed channels सीमित करें और केवल affected channel invert करें।

### कब उपयोग करें
- जब center image weak, hollow या spread out लगे क्योंकि किसी channel की polarity उलटी हो सकती है
- playback setup में speaker, cable या channel polarity जांचने या ठीक करने के लिए
- routing या stereo effects के साथ उपयोग करते समय, जहां किसी एक channel की polarity reverse करनी हो

## Stereo Balance

यह तय करता है कि संगीत आपके left और right speakers या headphones में कैसे बंटे। uneven stereo ठीक करने या अपनी पसंद की sound placement बनाने के लिए उपयोगी है।

### सुनने के अनुभव को बेहतर बनाने की गाइड
- संतुलित स्थिति:
  - natural stereo के लिए center position
  - दोनों कानों में equal volume
  - अधिकतर music के लिए best
- समायोजित संतुलन:
  - room acoustics की भरपाई करें
  - hearing differences के लिए adjust करें
  - पसंदीदा sound stage बनाएं

### पैरामीटर
- **Balance** - left-right distribution नियंत्रित करता है (-100% से +100%)
  - Center (0%): दोनों sides में बराबर
  - Left (-100%): left में ज्यादा sound
  - Right (+100%): right में ज्यादा sound

### विज़ुअल डिस्प्ले
- उपयोग में आसान slider
- स्पष्ट संख्या display
- stereo position का दृश्य संकेतक

### अनुशंसित उपयोग

1. सामान्य श्रवण
   - balance centered रखें (0%)
   - stereo uneven लगे तो adjust करें
   - subtle adjustments इस्तेमाल करें

2. हेडफोन से सुनना
   - comfort के लिए fine-tune करें
   - hearing differences की भरपाई करें
   - पसंदीदा stereo image बनाएं

3. स्पीकर से सुनना
   - room setup के अनुसार adjust करें
   - listening position के लिए balance करें
   - room acoustics की भरपाई करें

## Volume

यह simple लेकिन जरूरी control तय करता है कि आपका संगीत कितनी loud बजे। अलग-अलग स्थितियों के लिए सही listening level पाने में उपयोगी है।

### सुनने के अनुभव को बेहतर बनाने की गाइड
- अलग-अलग सुनने की स्थितियों के लिए adjust करें:
  - काम करते समय पृष्ठभूमि संगीत
  - ध्यान से सुनने के सत्र
  - देर रात शांत सुनना
- volume को आरामदायक स्तर पर रखें ताकि ये समस्याएँ न हों:
  - सुनने की थकान
  - ध्वनि विकृति
  - संभावित श्रवण क्षति

### पैरामीटर
- **Volume** - कुल loudness नियंत्रित करता है (-60dB से +24dB)
  - कम मान: playback शांत होता है
  - अधिक मान: playback तेज़ होता है
  - 0dB: मूल volume level

याद रखें: ये basic controls अच्छी sound की नींव हैं। अधिक complex effects इस्तेमाल करने से पहले इन्हीं adjustments से शुरुआत करें!
