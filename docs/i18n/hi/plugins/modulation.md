---
title: "मॉड्यूलेशन प्लगइन - EffeTune"
description: "Auto Filter, Auto Pan, Chorus, Frequency Shifter, Phaser और Rotary Speaker सहित modulation effects।"
lang: hi
---

# मॉड्यूलेशन प्लगइन

मॉड्यूलेशन इफेक्ट्स के माध्यम से आपके संगीत में गति और विविधता जोड़ने वाले प्लगइन्स का संग्रह। ये इफेक्ट्स आपके डिजिटल संगीत को और अधिक प्राकृतिक और गतिशील बनाते हैं, जिससे सुनने के अनुभव में सूक्ष्म या नाटकीय ध्वनि परिवर्तनों का आनंद मिलता है।

## प्लगइन सूची

- [Auto Filter](#auto-filter) - LFO या envelope से resonant filter sweep करता है
- [Auto Pan](#auto-pan) - हर stereo pair को sound field में सहजता से घुमाता है
- [Chorus](#chorus) - Chorus, Ensemble, Flanger और Vibrato को एक effect में देता है
- [Doppler Distortion](#doppler-distortion) - स्पीकर कॉन के सूक्ष्म आंदोलन द्वारा उत्पन्न प्राकृतिक, गतिशील ध्वनि परिवर्तनों का अनुकरण करता है।
- [Frequency Shifter](#frequency-shifter) - frequency shift, Ring Mod या Barber-pole sweep लगाता है
- [Phaser](#phaser) - all-pass filters से moving peaks और notches बनाता है
- [Pitch Shifter](#pitch-shifter) - आपके संगीत के प्लेबैक स्पीड को प्रभावित किए बिना उसके स्वर को बदलता है
- [Pitch Shifter HQ](#pitch-shifter-hq) - जब latency या CPU usage से अधिक sound quality महत्वपूर्ण हो, तब कम phase artifacts के साथ pitch बदलता है
- [Rotary Speaker](#rotary-speaker) - horn और drum की स्वतंत्र गति को जोड़ता है
- [Tremolo](#tremolo) - धड़कती, गतिशील ध्वनि के लिए लयबद्ध वॉल्यूम परिवर्तनों का निर्माण करता है
- [Wow Flutter](#wow-flutter) - विनाइल रिकॉर्ड्स और टेप प्लेयर्स के कोमल स्वर परिवर्तनों को पुनर्जीवित करता है

## Auto Filter

LFO या input signal के envelope से state-variable filter को अपने-आप चलाता है। Envelope mode को Envelope Filter या Auto Wah की तरह इस्तेमाल किया जा सकता है। algorithmic latency शून्य है।

### ध्वनि समायोजन के सुझाव

- हल्के tonal बदलाव के लिए LFO, Low-pass, कम Resonance और लगभग 30–50% Mix से शुरू करें।
- Auto Wah के लिए Envelope और Band-pass चुनें, फिर Sensitivity को इस तरह मिलाएँ कि तेज़ ध्वनि filter को उचित मात्रा में खोले।
- लंबा Attack शुरुआत की प्रतिक्रिया को नरम करता है; लंबा Release वापसी को अधिक सहज बनाता है।

### पैरामीटर

- **Style**: सभी parameters को एक साथ तय करने वाली पूरी factory setting। विकल्प **Auto Filter Sweep** (LFO), **Stereo Filter Sweep** (LFO), **Envelope Filter** (Envelope), **Auto Wah** (Envelope) और **Reverse Auto Wah** (Envelope) हैं। किसी parameter को अलग से बदलने पर यह **Custom** हो जाता है।
- **Mode**: नियमित रूप से चलने वाले LFO और volume का अनुसरण करने वाले Envelope के बीच बदलता है।
- **Filter Type**: Low-pass, Band-pass या High-pass।
- **Minimum Frequency / Maximum Frequency** (20–20,000 Hz): गति की सीमा। उलटे क्रम को अपने-आप सही किया जाता है; समान मान filter को स्थिर रखते हैं। processing के दौरान सीमा Nyquist frequency से नीचे सुरक्षित क्षेत्र में रखी जाती है।
- **Resonance** (Q 0.5–20): अधिक मान cutoff के आसपास अधिक जोर देते हैं।
- **Mix** (0–100%): मूल और filtered ध्वनि का अनुपात। 0% पर केवल मूल ध्वनि रहती है।
- **Rate**, **Waveform**, **Stereo Phase**: LFO की गति, पथ और हर stereo pair के भीतर phase difference। केवल LFO mode में उपयोग होते हैं।
- **Sensitivity**, **Attack**, **Release**, **Direction**: envelope की प्रतिक्रिया, rise, return और दिशा। केवल Envelope mode में उपयोग होते हैं।

## Auto Pan

हर पास-पास के stereo pair की volume को बाएँ और दाएँ चलाता है। pairs के बीच audio नहीं मिलाता, और अंत में बचा अकेला channel mono माना जाता है। algorithmic latency शून्य है।

### ध्वनि समायोजन के सुझाव

- आरामदेह गति के लिए लगभग 0.2–0.5 Hz Rate और मध्यम Depth से शुरू करें।
- headphones में प्रभाव बहुत चौड़ा लगे तो Width घटाएँ; बाएँ/दाएँ का आधार Center से मिलाएँ।
- Sine किनारों पर धीरे चलती है, जबकि Triangle की गति अधिक समान रहती है।

### पैरामीटर

- **Style**: सभी parameters की पूरी factory setting। विकल्प **Gentle Auto Pan**, **Wide Auto Pan** और **Fast Auto Pan** हैं। अलग parameter बदलने पर यह **Custom** हो जाता है।
- **Rate** (0.05–20 Hz): गति।
- **Depth** (0–100%): Center के आसपास चलने की मात्रा। 0% पर कोई बदलाव नहीं।
- **Center** (-100–100%): मध्य स्थिति को बाएँ या दाएँ खिसकाता है।
- **Width** (0–100%): इस्तेमाल की जाने वाली stereo width।
- **Waveform**: Sine या Triangle।
- **Phase** (0–360°): नियमित गति की शुरुआती स्थिति।

## Chorus

चार-point cubic interpolation वाले कई variable-delay signals जोड़ता है। Mode में Chorus, Stereo Chorus, Ensemble, Flanger और Vibrato हैं। variable delay सुनाई देने वाला विलंब बनाता है, पर fixed latency नहीं है; इसलिए reported algorithmic latency शून्य है।

### ध्वनि समायोजन के सुझाव

- प्राकृतिक मोटाई के लिए Classic Chorus या Stereo Chorus के साथ मध्यम Rate और Depth रखें।
- Voices बढ़ाने पर Ensemble अधिक घना होता है। बहुत अधिक Depth pitch wobble को स्पष्ट करती है।
- केवल Flanger Feedback का उपयोग करता है; positive और negative मान comb-filter polarity बदलते हैं।
- Vibrato हमेशा 100% wet है।

### पैरामीटर

- **Style**: सभी parameters की पूरी factory setting। विकल्प **Classic Chorus** (Chorus), **Stereo Chorus** (Stereo Chorus), **Ensemble** (Ensemble), **Flanger** (Flanger), **Jet Flanger** (Flanger) और **Vibrato** (Vibrato) हैं। अलग parameter बदलने पर यह **Custom** हो जाता है।
- **Mode**: Chorus, Stereo Chorus, Ensemble, Flanger या Vibrato।
- **Rate** (0.05–10 Hz): modulation की गति।
- **Delay** (0.5–30 ms): wet signal का आधार delay।
- **Depth** (0–20 ms): delay में बदलाव। negative-delay read रोकने के लिए saved value को Delay तक सीमित किया जाता है।
- **Voices** (1–6): Chorus और Ensemble में variable taps की संख्या। अन्य modes में अनदेखा होता है।
- **Stereo Spread** (0–100%): हर stereo pair में modulation difference। Chorus mode में अनदेखा होता है।
- **Feedback** (-75–75%): केवल Flanger में उपयोग होता है।
- **Mix** (0–100%): मूल और wet signal का linear ratio। Vibrato में अनदेखा होता है और हमेशा 100% wet रहता है।

## Doppler Distortion

अपने संगीत में प्राकृतिक गति का स्पर्श लाने वाला एक अनोखा ऑडियो इफेक्ट अनुभव करें।  
Doppler Distortion स्पीकर कॉन के भौतिक आंदोलन द्वारा उत्पन्न कोमल विकृतियों का अनुकरण करता है।  
यह इफेक्ट ध्वनि की गहराई और टोन में सूक्ष्म परिवर्तन लाता है, बिलकुल वैसे जैसे जब कोई ध्वनि स्रोत आपके सापेक्ष संचरित होता है।  
यह ऑडियो को और अधिक जीवंत और आकर्षक बनाकर आपके सुनने के अनुभव में एक गतिशील, डूबा हुआ प्रभाव जोड़ता है।

### पैरामीटर

- **Coil Force (N / V)**
  स्पीकर कॉइल के सिम्युलेटेड आंदोलन की ताकत को नियंत्रित करता है। उच्च मान अधिक स्पष्ट विकृति का परिणाम देते हैं।

- **Speaker Mass (kg)**  
  यह स्पीकर कॉन के वजन का अनुकरण करता है, जो यह निर्धारित करता है कि आंदोलन कितनी प्राकृतिक रूप से दोहराया जाता है।  
  - **उच्च मान:** जड़त्व बढ़ाते हैं, जिससे प्रतिक्रिया धीमी हो जाती है और विकृतियाँ अधिक चिकनी, सूक्ष्म होती हैं।  
  - **निम्न मान:** जड़त्व को कम करते हैं, जिससे त्वरित और अधिक स्पष्ट मॉड्यूलेशन प्रभाव उत्पन्न होता है।

- **Spring Constant (N/m)**  
  स्पीकर के सस्पेंशन की कठोरता निर्धारित करता है। उच्च स्प्रिंग कॉन्स्टेंट से अधिक स्पष्ट, परिभाषित प्रतिक्रिया मिलती है।

- **Damping Factor (N·s/m)**  
  सिम्युलेटेड आंदोलन के स्थिरीकरण की गति को समायोजित करता है, जीवंत गति और चिकनी संक्रमण के बीच संतुलन स्थापित करता है।  
  - **उच्च मान:** तेज़ स्थिरीकरण की ओर ले जाते हैं, दोलनों को कम करते हैं और अधिक नियंत्रित, सख्त प्रभाव उत्पन्न करते हैं।  
  - **निम्न मान:** आंदोलन को अधिक समय तक बना रहने देते हैं, जिससे एक ढीला, अधिक विस्तारित गतिशील परिवर्तन प्राप्त होता है।

### अनुशंसित सेटिंग्स

संतुलित और प्राकृतिक संवर्द्धन के लिए, निम्न प्रारंभिक सेटिंग्स से शुरुआत करें:
   - **Coil Force:** 8.0 N / V
- **Speaker Mass:** 0.03 kg  
- **Spring Constant:** 6000 N/m  
- **Damping Factor:** 1.5 N·s/m  

ये सेटिंग्स एक सूक्ष्म Doppler Distortion प्रदान करती हैं, जो मूल ध्वनि को ओवरपावर किए बिना आपके सुनने के अनुभव को समृद्ध बनाती हैं।

## Frequency Shifter

हर frequency component को pitch ratio के बजाय निश्चित Hz से खिसकाता है। Ring Mod signal को carrier से गुणा करता है; Barber-pole shifts को overlap करके लगातार ऊपर या नीचे जाने का आभास देता है। Shift और Barber-pole Hilbert analytic-signal FIR का उपयोग करते हैं; Ring Mod उसी FIFO से मिले बराबर-delay वाले real signal को carrier से गुणा करता है। इसलिए मूल और processed signals सभी modes में time-aligned रहते हैं। fixed latency sample rate पर निर्भर है और DSP Library इसे report करती है।

### ध्वनि समायोजन के सुझाव

- हल्के बदलाव के लिए Shift चुनें और लगभग ±5–15 Hz से शुरू करें। Pitch Shifter के विपरीत harmonic spacing भी बदलती है।
- metallic timbre के लिए Ring Mod इस्तेमाल करें। कम Carrier Frequency मूल rhythm को बनाए रखने में मदद करती है।
- लगातार गति के लिए कम Rate वाला Barber-pole और clarity के लिए मध्यम Mix रखें।

### पैरामीटर

- **Style**: सभी parameters की पूरी factory setting। विकल्प **Shift Up** (Shift), **Shift Down** (Shift), **Fine Detune** (Shift), **Ring Modulator** (Ring Mod), **Barber-pole Up** (Barber-pole) और **Barber-pole Down** (Barber-pole) हैं। अलग parameter बदलने पर यह **Custom** हो जाता है।
- **Mode**: Shift, Ring Mod या Barber-pole।
- **Shift** (-5,000–5,000 Hz): Shift mode की मात्रा। positive मान ऊपर और negative मान नीचे खिसकाते हैं।
- **Carrier Frequency** (0.1–10,000 Hz): Ring Mod का carrier frequency।
- **Minimum Shift / Maximum Shift** (0–5,000 Hz): Barber-pole की सीमा। उलटा क्रम सही किया जाता है; समान मान shift को स्थिर रखते हैं।
- **Rate** (0.01–2 Hz), **Direction**: Barber-pole की गति और दिशा।
- **Stereo Phase** (0–180°): सभी modes में हर stereo pair के बाएँ और दाएँ carrier या sweep में अंतर देता है।
- **Mix** (0–100%): बराबर-delay वाले मूल और processed signal का अनुपात। 0% पर भी बताई गई fixed latency रहती है।

बड़े shifts Nyquist frequency से ऊपर components बना सकते हैं, जिससे aliasing सुनाई दे सकती है। शुरुआती version oversampling नहीं करता।

## Phaser

moving peaks और notches बनाने के लिए मूल signal को all-pass filter chain के output से मिलाता है। Classic आगे-पीछे चलता है; Barber-pole तीन constant-power windows को overlap करके लगातार ऊपर या नीचे जाने का आभास देता है। algorithmic latency शून्य है।

### ध्वनि समायोजन के सुझाव

- साफ़ notches के लिए Classic, 4–6 Stages, मध्यम Range और लगभग 50% Mix से शुरू करें।
- Stages और Feedback बढ़ाने पर प्रभाव अधिक गहरा और resonant होता है। attacks बहुत रंगीन हों तो इन्हें घटाएँ।
- Stereo Phase से width मिलाएँ; लगातार गति के लिए Barber-pole Up/Down चुनें।

### पैरामीटर

- **Style**: सभी parameters की पूरी factory setting। विकल्प **Classic Phaser** (Classic), **Deep Phaser** (Classic), **Stereo Phaser** (Classic), **Barber-pole Up** (Barber-pole) और **Barber-pole Down** (Barber-pole) हैं। अलग parameter बदलने पर यह **Custom** हो जाता है।
- **Mode**: Classic या Barber-pole।
- **Rate** (0.05–10 Hz): sweep की गति।
- **Center Frequency** (80–8,000 Hz): logarithmic sweep का केंद्र।
- **Range** (0–6 octaves): sweep की चौड़ाई।
- **Stages** (2 से 12 के सम अंक): all-pass stages की संख्या। अधिक stages से अधिक notches बनते हैं।
- **Feedback** (-90–90%): processed signal को input में लौटाने की मात्रा। absolute value ताकत और sign emphasis का ढंग बदलता है।
- **Stereo Phase** (0–180°): हर stereo pair के भीतर गति का अंतर।
- **Direction**: Barber-pole का Up/Down। Classic में अनदेखा होता है।
- **Mix** (0–100%): मूल और processed signal का linear ratio। बीच के पास cancellation सबसे गहरी होती है।

## Pitch Shifter

एक ऐसा इफेक्ट जो आपके संगीत के प्लेबैक स्पीड को प्रभावित किए बिना उसके स्वर को बदलता है। इससे आप अपने पसंदीदा गानों को विभिन्न कुंजी में सुन सकते हैं, जिससे वे मूल ताल और लय को बरकरार रखते हुए ऊँचे या नीचे सुनाई देते हैं।

### पैरामीटर
- **Pitch Shift** - सेमिटोन में कुल स्वर को बदलता है (-6 से +6)
  - नकारात्मक मान: स्वर को कम करता है (गहरा, नीची ध्वनि)
  - शून्य: कोई परिवर्तन नहीं (मूल स्वर)
  - सकारात्मक मान: स्वर को बढ़ाता है (ऊँचा, उजला ध्वनि)
- **Fine Tune** - सेंट में सूक्ष्म स्वर समायोजन करता है (-50 से +50)
  - सेमिटोन के बीच सटीक समायोजन की अनुमति देता है
  - जब एक पूर्ण सेमिटोन अधिक हो तो छोटे समायोजनों के लिए उत्तम
- **Window Size** - मिलिसेकंड में विश्लेषण विंडो के आकार को नियंत्रित करता है (80 से 500ms)
  - छोटे मान (80-150ms): ट्रांज़िएंट से भरपूर सामग्री जैसे कि पर्कशन के लिए उपयुक्त
  - मध्यम मान (150-300ms): अधिकांश संगीत के लिए अच्छा संतुलन
  - बड़े मान (300-500ms): सुचारु, निरंतर ध्वनियों के लिए उपयुक्त
- **XFade Time** - प्रोसेस्ड सेगमेंट्स के बीच क्रॉसफेड समय को मिलिसेकंड में सेट करता है (20 से 40ms)
  - यह निर्धारित करता है कि pitch-shifted सेगमेंट्स कितनी सुचारू रूप से मिलते हैं
  - निम्न मान अधिक तात्कालिक सुनाई दे सकते हैं, परंतु संभावित रूप से कम सुचारू
  - उच्च मान सेगमेंट्स के बीच अधिक सुचारू संक्रमण बनाते हैं, परंतु इससे ध्वनि में डगमगाहट बढ़ सकती है और ओवरलैपिंग की अनुभूति हो सकती है

## Pitch Shifter HQ

ध्यान से सुनने के लिए बनाया गया एक उच्च-गुणवत्ता वाला pitch shifter, जब कम latency या कम CPU usage की तुलना में phase smearing घटाना अधिक महत्वपूर्ण हो। यह playback speed बदले बिना pitch बदलता है और standard Pitch Shifter की तुलना में spectral components को बेहतर ढंग से साथ रखता है। बदले में, यह अधिक CPU उपयोग करता है और लगभग 106.7–116.1ms की fixed processing latency जोड़ता है: 48, 96 और 192kHz पर लगभग 106.7ms तथा 44.1, 88.2 और 176.4kHz पर लगभग 116.1ms। इसके लिए EffeTune का WASM DSP engine आवश्यक है; यदि यह engine उपलब्ध न हो, तो audio बिना processing के गुजरता है।

Pitch Shifter HQ formants को सुरक्षित नहीं रखता। इसलिए बड़े pitch shifts से pitch के साथ-साथ आवाज़ों और वाद्ययंत्रों का स्वरूप भी बदलता है।

### सुनने का अनुभव गाइड

- हल्के बदलाव के लिए **Pitch Shift** को -1 या +1 से शुरू करें और **Fine Tune** को 0 पर रखें।
- पूरे semitone से बदले बिना थोड़े ऊँचे या नीचे सुर वाले संगीत से मेल कराने के लिए **Fine Tune** का उपयोग करें।
- जब कम phase artifacts के लिए अतिरिक्त CPU usage और latency स्वीकार्य हों, तब standard Pitch Shifter के बजाय Pitch Shifter HQ चुनें। latency-sensitive listening या कम शक्ति वाले device पर standard version का उपयोग करें।
- बड़े shifts की तुलना ध्यान से करें: pitch स्थिर रूप से बदलता है, लेकिन formants सुरक्षित न रहने से timbre का बदलाव अधिक स्पष्ट होता है।

### पैरामीटर

- **Pitch Shift** - पूरे pitch को semitones में बदलता है (-6 से +6)
  - नकारात्मक मान pitch को कम और सकारात्मक मान बढ़ाते हैं
  - शून्य पर pitch नहीं बदलता
- **Fine Tune** - pitch को cents में समायोजित करता है (-50 से +50)
  - semitones के बीच सटीक समायोजन के लिए उपयोग करें
  - 100 cents एक semitone के बराबर हैं

## Rotary Speaker

Linkwitz–Riley crossover से signal को high-frequency horn और low-frequency drum में बाँटता है, फिर दोनों पर अलग rotation speed, volume modulation और छोटा Doppler delay लगाता है। यह किसी खास Leslie cabinet का measured model नहीं है। variable delay के कारण इसे fixed algorithmic latency के रूप में report नहीं किया जाता।

### ध्वनि समायोजन के सुझाव

- Slow आरामदेह और Fast अधिक तीव्र rotation देता है। लंबी Acceleration speed change को अधिक प्राकृतिक बनाती है।
- pitch movement को Doppler Depth और volume movement को Amplitude Depth से मिलाएँ।
- drum और horn का अनुपात Rotor Balance तथा चौड़ाई Stereo Width से मिलाएँ।

### पैरामीटर

- **Style**: सभी parameters की पूरी factory setting। विकल्प **Rotary Slow** (Slow), **Rotary Fast** (Fast), **Gentle Rotary** (Slow), **Leslie Slow** (Slow) और **Leslie Fast** (Fast) हैं। अलग parameter बदलने पर यह **Custom** हो जाता है।
- **Speed State**: Stop, Slow या Fast। बदलते समय mute किए बिना लगातार तेज़ या धीमा होता है।
- **Speed** (25–200%): horn और drum दोनों की speed multiplier।
- **Acceleration** (0.1–10 s): rotors नई speed की ओर कितनी तेज़ी से बढ़ते हैं।
- **Crossover** (200–2,000 Hz): drum और horn bands को बाँटने वाली frequency।
- **Rotor Balance** (-100–100%): negative मान drum और positive मान horn को उभारते हैं।
- **Stereo Width** (0–100%): stereo pair की चौड़ाई।
- **Doppler Depth** (0–100%): variable delay से होने वाला pitch variation।
- **Amplitude Depth** (0–100%): virtual rotor direction से होने वाला volume variation।
- **Mix** (0–100%): मूल और rotating sound का अनुपात। 0% पर केवल मूल ध्वनि रहती है।

## Tremolo

एक ऐसा प्रभाव जो आपके संगीत में लयबद्ध वॉल्यूम परिवर्तनों को जोड़ता है, जो पुराने एम्पलीफायर्स और क्लासिक रिकॉर्डिंग्स में सुनाई देने वाली धड़कती ध्वनि के समान है। यह एक गतिशील, अभिव्यक्तिपूर्ण गुण पैदा करता है जो आपके सुनने के अनुभव में गति और रुचि जोड़ता है।

### सुनने का अनुभव गाइड
- क्लासिक एम्पलीफायर अनुभव:
  - विंटेज ट्यूब एम्पलीफायर्स की प्रतिष्ठित धड़कती ध्वनि को पुनः उत्पन्न करता है
  - स्थिर रिकॉर्डिंग्स में लयबद्ध गति जोड़ता है
  - एक सम्मोहक, आकर्षक सुनने का अनुभव पैदा करता है
- विंटेज रिकॉर्डिंग चरित्र:
  - क्लासिक रिकॉर्डिंग्स में उपयोग किए गए प्राकृतिक tremolo प्रभावों का अनुकरण करता है
  - विंटेज चरित्र और गर्माहट जोड़ता है
  - जैज़, ब्लूज़, और रॉक सुनने के लिए एकदम उपयुक्त
- सृजनात्मक वातावरण:
  - नाटकीय उतार-चढ़ाव उत्पन्न करता है
  - संगीत में भावनात्मक तीव्रता जोड़ता है
  - एंबियंट और एटमॉस्फेरिक सुनने के लिए उत्तम

### पैरामीटर
- **Rate** - वॉल्यूम कितनी तेजी से बदलता है (0.1 से 50 Hz तक)
  - धीमा (0.1-2 Hz): कोमल, सूक्ष्म धड़कन
  - मध्यम (2-6 Hz): क्लासिक tremolo प्रभाव
  - तेज (6-20 Hz): नाटकीय, खंडित प्रभाव
  - बहुत तेज (20-50 Hz): बेहद तेज़ वॉल्यूम मॉड्यूलेशन, जो खुरदरी या भनभनाती बनावट जोड़ सकता है; आरामदायक सुनने के लिए संयम से उपयोग करें
- **Depth** - वॉल्यूम कितना बदलता है (0 से 12 dB तक)
  - हल्का (0-3 dB): कोमल वॉल्यूम परिवर्तन
  - मध्यम (3-6 dB): स्पष्ट धड़कन प्रभाव
  - प्रबल (6-12 dB): नाटकीय वॉल्यूम वृद्धि
- **Ch Phase** - स्टेरियो चैनलों के बीच फेज अंतर (-180 से 180 डिग्री तक)
  - 0°: दोनों चैनल एक साथ धड़कते हैं (mono tremolo)
  - 90° या -90°: घूमते हुए, घूर्णन प्रभाव का निर्माण करता है
  - 180° या -180°: चैनल विपरीत दिशाओं में धड़कते हैं (अधिकतम स्टेरियो चौड़ाई)
- **Randomness** - वॉल्यूम परिवर्तनों में अनियमितता (0 से 96 dB तक)
  - कम: अधिक पूर्वानुमानयोग्य, नियमित धड़कन
  - मध्यम: प्राकृतिक विंटेज विविधता
  - अधिक: अधिक अस्थिर, प्राकृतिक ध्वनि
- **Randomness Cutoff** - यादृच्छिक परिवर्तनों की गति (1 से 1000 Hz तक)
  - कम: धीमे, अधिक कोमल यादृच्छिक बदलाव
  - अधिक: तेज, अधिक अनियमित परिवर्तन
- **Randomness Slope** - यादृच्छिकता फ़िल्टरिंग की तीव्रता को नियंत्रित करता है (-12 से 0 dB)
  - -12 dB: अधिक सुचारू, अधिक क्रमिक यादृच्छिक बदलाव (अधिक कोमल प्रभाव)
  - -6 dB: संतुलित प्रतिक्रिया
  - 0 dB: अधिक तेज़, अधिक स्पष्ट यादृच्छिक बदलाव (अधिक मज़बूत प्रभाव)
- **Ch Sync** - चैनलों के बीच यादृच्छिकता कितनी सिंक्रनाइज़ है (0 से 100%)
  - 0%: प्रत्येक चैनल की यादृच्छिकता स्वतंत्र
  - 50%: चैनलों के बीच आंशिक समन्वयन
  - 100%: दोनों चैनल एक ही यादृच्छिक पैटर्न साझा करते हैं

### विभिन्न शैलियों के लिए अनुशंसित सेटिंग्स

1. क्लासिक गिटार एम्प Tremolo
   - Rate: 4-6 Hz (मध्यम गति)
   - Depth: 6-8 dB
   - Ch Phase: 0° (mono)
   - Randomness: 0-5 dB
   - उपयुक्त: Blues, Rock, Surf Music

2. स्टीरियो साइकेडेलिक प्रभाव
   - Rate: 2-4 Hz
   - Depth: 4-6 dB
   - Ch Phase: 180° (विपरीत चैनल)
   - Randomness: 10-20 dB
   - उपयुक्त: Psychedelic Rock, Electronic, Experimental

3. सूक्ष्म संवर्द्धन
   - Rate: 1-2 Hz
   - Depth: 2-3 dB
   - Ch Phase: 0-45°
   - Randomness: 5-10 dB
   - उपयुक्त: किसी भी संगीत के लिए जिसे हल्की गति की आवश्यकता हो

4. नाटकीय धड़कन
   - Rate: 8-12 Hz
   - Depth: 8-12 dB
   - Ch Phase: 90°
   - Randomness: 20-30 dB
   - उपयुक्त: Electronic, Dance, Ambient

### त्वरित शुरुआत गाइड
1. क्लासिक Tremolo sound के लिए:
   - मध्यम Rate (4-5 Hz) से शुरू करें
   - मध्यम Depth (6 dB) जोड़ें
   - Mono के लिए Ch Phase को 0° या stereo आंदोलन के लिए 90° सेट करें
   - Randomness को कम रखें (0-5 dB)
   - अपनी पसंद अनुसार समायोजित करें

2. अधिक रंगत के लिए:
   - धीरे-धीरे Randomness बढ़ाएं
   - विभिन्न Ch Phase सेटिंग्स के साथ प्रयोग करें
   - विभिन्न Rate और Depth संयोजनों को आजमाएं
   - अपने कान पर भरोसा करें

## Wow Flutter

एक ऐसा प्रभाव जो आपके संगीत में सूक्ष्म पिच परिवर्तनों को जोड़ता है, जैसा कि आपको विनाइल रिकॉर्ड्स या कैसेट टेप्स से याद आ सकता है। यह एक गर्म, पुरानी यादों से भरपूर भावना पैदा करता है जिसे कई लोग सुखद और आरामदायक मानते हैं।

### सुनने का अनुभव गाइड
- विनाइल रिकॉर्ड अनुभव:
  - टर्नटेबल्स की कोमल डगमगाहट को पुनः उत्पन्न करता है
  - ध्वनि में प्राकृतिक गति जोड़ता है
  - एक आरामदायक, पुरानी यादों से भरपूर वातावरण बनाता है
- कैसट टेप स्मृति:
  - टेप डेक्स की विशिष्ट फ्लटर का अनुकरण करता है
  - विंटेज टेप डेक का चरित्र जोड़ता है
  - Lo-Fi और रेट्रो वाइब्स के लिए एकदम उपयुक्त
- सृजनात्मक वातावरण:
  - सपनीले, पानी के नीचे जैसा प्रभाव उत्पन्न करता है
  - स्थिर ध्वनियों में गति और जीवन जोड़ता है
  - एंबियंट और प्रयोगात्मक सुनने के लिए उत्तम

### पैरामीटर
- **Rate** - ध्वनि कितनी तेजी से डगमगाती है (0.1 से 20 Hz तक)
  - धीमा (0.1-2 Hz): विनाइल रिकॉर्ड जैसा आंदोलन
  - मध्यम (2-6 Hz): कैसेट टेप जैसा फ्लटर
  - तेज (6-20 Hz): सृजनात्मक प्रभाव
- **Depth** - डिले समय मॉड्यूलेशन की ताकत, जिससे पिच डगमगाती है (0 से 40 ms तक)
  - हल्का (0-6 ms): कोमल विंटेज चरित्र
  - मध्यम (6-15 ms): स्पष्ट टेप/विनाइल जैसा अनुभव
  - प्रबल (15-40 ms): नाटकीय विशेष प्रभाव
- **Ch Phase** - स्टेरियो चैनलों के बीच फेज अंतर (-180 से 180 डिग्री तक)
  - 0°: दोनों चैनल एक साथ डगमगाते हैं
  - 90° या -90°: घूमते हुए, घूर्णन प्रभाव का निर्माण करता है
  - 180° या -180°: चैनल विपरीत दिशाओं में डगमगाते हैं
- **Randomness** - डगमगाहट में अनियमितता (0 से 40 ms तक)
  - कम: अधिक पूर्वानुमानयोग्य, नियमित गति
  - मध्यम: प्राकृतिक विंटेज विविधता
  - अधिक: अधिक अस्थिर, पुराने उपकरण की ध्वनि
- **Randomness Cutoff** - यादृच्छिक परिवर्तनों की गति (0.1 से 20 Hz तक)
  - कम: धीमी, अधिक कोमल परिवर्तन
  - अधिक: तेज, अधिक अनियमित परिवर्तन
- **Randomness Slope** - यादृच्छिकता फ़िल्टरिंग की तीव्रता नियंत्रित करता है (-12 से 0 dB)
  - -12 dB: अधिक चिकने, क्रमिक यादृच्छिक बदलाव (अधिक कोमल प्रभाव)
  - -6 dB: संतुलित response
  - 0 dB: sharper, अधिक स्पष्ट random variations (stronger effect)
- **Ch Sync** - चैनलों के बीच यादृच्छिकता का समन्वयन (0 से 100% तक)
  - 0%: प्रत्येक चैनल की यादृच्छिकता स्वतंत्र
  - 50%: चैनलों के बीच आंशिक समन्वयन
  - 100%: दोनों चैनल एक ही यादृच्छिक पैटर्न साझा करते हैं

### विभिन्न शैलियों के लिए अनुशंसित सेटिंग्स

1. क्लासिक विनाइल अनुभव
   - Rate: 0.3-0.8 Hz (धीमा, कोमल movement)
   - Depth: 2-6 ms
   - Randomness: 1-4 ms
   - Randomness Cutoff: 0.5-3 Hz
   - Ch Phase: 0°
   - Ch Sync: 100%
   - उपयुक्त: Jazz, Classical, Vintage Rock

2. रेट्रो कैसट अनुभूति
   - Rate: 4-6 Hz (तेज flutter)
   - Depth: 1-3 ms
   - Randomness: 1-5 ms
   - Randomness Cutoff: 3-8 Hz
   - Ch Phase: 0-30°
   - Ch Sync: 80-100%
   - उपयुक्त: Lo-Fi, Pop, Rock

3. सपनीली वातावरण
   - Rate: 1-2 Hz
   - Depth: 25-30 ms
   - Randomness: 20-25 ms
   - Ch Phase: 90-180°
   - Ch Sync: 50-70%
   - उपयुक्त: Ambient, Electronic, Experimental

4. सूक्ष्म संवर्द्धन
   - Rate: 1-2 Hz
   - Depth: 2-5 ms
   - Randomness: 1-3 ms
   - Ch Phase: 0°
   - Ch Sync: 100%
   - उपयुक्त: किसी भी संगीत के लिए जिसे हल्के विंटेज चरित्र की आवश्यकता हो

### त्वरित शुरुआत गाइड
1. प्राकृतिक विंटेज ध्वनि के लिए:
   - धीमे Rate (0.5-1 Hz) से शुरू करें
   - हल्का Depth (2-6 ms) जोड़ें
   - थोड़ा Randomness शामिल करें (1-4 ms)
   - Randomness Cutoff को लगभग 0.5-3 Hz पर रखें
   - Ch Phase को 0° और Ch Sync को 100% पर रखें
   - अपनी पसंद अनुसार समायोजित करें

2. अधिक रंगत के लिए:
   - धीरे-धीरे Depth बढ़ाएं
   - और अधिक Randomness जोड़ें
   - विभिन्न Ch Phase सेटिंग्स के साथ प्रयोग करें
   - अधिक stereo variation के लिए Ch Sync कम करें
   - अपने कान पर भरोसा करें

याद रखें: उद्देश्य आपके संगीत में सुखद विंटेज चरित्र जोड़ना है। हल्के से शुरू करें और तब तक समायोजित करें जब तक कि आप उस बेहतरीन संतुलन को नहीं पा लेते जो आपके सुनने के अनुभव को बढ़ाता है!
