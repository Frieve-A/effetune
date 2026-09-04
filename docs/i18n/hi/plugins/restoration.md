---
title: "Restoration Plugins - EffeTune"
description: "क्लिक, क्लिप हुए पीक, इलेक्ट्रिकल हम और स्थिर बैकग्राउंड शोर के लिए Restoration plugins।"
lang: hi
---

# Restoration Plugins

Restoration plugins रिकॉर्डिंग की अनचाही खराबियों को कम करते हैं, ताकि संगीत स्वाभाविक ढंग से सुनाई देता रहे।

## Plugin सूची

- [Click Remover](#click-remover) - छोटे क्लिक, क्रैकल, पॉप और ड्रॉपआउट ठीक करता है
- [Clip Restorer](#clip-restorer) - hard clipping से चपटे हुए पीक को बहाल करता है
- [Hum Remover](#hum-remover) - स्थिर इलेक्ट्रिकल हम और उसके harmonics हटाता है
- [Noise Reduction](#noise-reduction) - स्थिर हिस और बैकग्राउंड शोर घटाता है

## Click Remover

Click Remover रिकॉर्ड की क्रैकल, पॉप, क्लिक और बहुत छोटे ड्रॉपआउट जैसे अलग-अलग छोटे दोष ठीक करता है। इसे कभी-कभार आने वाली रुकावटों के लिए उपयोग करें, लगातार हिस या हम के लिए नहीं।

### सुनने की गाइड

1. **Sensitivity** 50% और **Max Repair Length** 1 ms से शुरू करें।
2. क्लिक कम सुनाई देने तक **Sensitivity** धीरे-धीरे बढ़ाएं। अगर ड्रम के attack या दूसरे तेज संगीत विवरण मुलायम हो जाएं, इसे फिर घटाएं।
3. केवल लंबे पॉप या ड्रॉपआउट के लिए **Max Repair Length** बढ़ाएं; सामान्य क्रैकल के लिए इसे छोटा रखें।
4. प्रभावित भाग चलाते समय **REPAIRS/S** देखें और मजबूत सेटिंग रखने से पहले effect bypass से तुलना करें।

### पैरामीटर

- **Sensitivity** (0–100%, default 50%) तय करता है कि छोटा बदलाव कितनी आसानी से दोष माना जाए। अधिक मान ज्यादा संदिग्ध क्लिक ठीक करता है; कम मान अधिक सावधान रहता है और संगीत के attack बचाता है।
- **Max Repair Length** (0.1–2 ms, default 1 ms) हर repair की अधिकतम अवधि सीमित करता है। थोड़ा लंबे पॉप या ड्रॉपआउट के लिए बढ़ाएं और छोटे क्रैकल के लिए घटाएं।

### डिस्प्ले पढ़ना

**REPAIRS/S** हाल में प्रति सेकंड हुए क्लिक repair की संख्या दिखाता है। शून्य के पास मान का अर्थ है कि अभी छोटे दोष repair नहीं हो रहे हैं। सामान्य संगीत पर लगातार बड़ा मान आए तो **Sensitivity** या **Max Repair Length** घटाएं।

## Clip Restorer

Clip Restorer hard digital clipping से चपटे हुए पीक को फिर बनाता है। यह साफ flat-top distortion वाली रिकॉर्डिंग के लिए उपयोगी है, लेकिन EffeTune तक पहुंचने से पहले खोए हर विवरण को वापस नहीं ला सकता।

### सुनने की गाइड

1. **Threshold** -0.10 dB और **Output Gain** -3 dB से शुरू करें।
2. स्पष्ट clipped peaks बचे हों तो **Threshold** थोड़ा घटाएं। यदि तेज, लगातार आवाजें अनावश्यक रूप से बदलें तो इसे 0 dB की ओर बढ़ाएं।
3. संभव हो तो **Output Gain** को 0 dB से नीचे रखें, क्योंकि बहाल किए गए पीक मूल चपटे पीक से ऊंचे हो सकते हैं।
4. खराब भाग में **RESTORED** देखें और कम से कम हस्तक्षेप वाली सेटिंग के लिए bypass से तुलना करें।

### पैरामीटर

- **Threshold** (-18–0 dB, default -0.10 dB) clipped peak माने जाने वाला स्तर तय करता है। 0 dB के निकट केवल लगभग full-scale flat peak लक्षित होते हैं; कम करने पर हल्का clipping भी शामिल होता है, पर अधिक तेज सामग्री प्रभावित हो सकती है।
- **Output Gain** (-12–0 dB, default -3 dB) restoration के बाद output level तय करता है। अधिक आवाज के लिए 0 dB की ओर बढ़ाएं, या अधिक headroom के लिए घटाएं।

### डिस्प्ले पढ़ना

**RESTORED** हाल में clipped peak के रूप में repair हुए audio samples का प्रतिशत दिखाता है। छोटा मान सामान्य हो सकता है क्योंकि clipping अक्सर बहुत छोटे पीक में होता है। बिना clipping वाली सामग्री पर मान ऊंचा रहे तो **Threshold** बढ़ाएं।

## Hum Remover

Hum Remover 50 Hz या 60 Hz जैसे स्थिर electrical hum और उसके harmonics को कम करता है, जो turntable, cable या power fault से आ सकता है। यह लगातार tone के लिए है, सामान्य background noise के लिए नहीं।

### सुनने की गाइड

1. **Frequency** को **Auto**, **Harmonics** को 8 और **Tracking Speed** को 50% पर रखें।
2. रिकॉर्डिंग की mains frequency पता हो तो **50 Hz** या **60 Hz** चुनें; नहीं तो **Auto** रहने दें और **FUNDAMENTAL** देखें।
3. fundamental के ऊपर buzz बचा हो तो **Harmonics** बढ़ाएं; संगीत का body या detail कम हो तो घटाएं।
4. hum की pitch धीरे बदलती हो तो **Tracking Speed** बढ़ाएं; स्थिर hum के लिए घटाएं। यदि sustained bass ठीक किसी harmonic से मिले, **Harmonics** घटाएं।

### पैरामीटर

- **Frequency** (**Auto**, **50 Hz**, या **60 Hz**; default **Auto**) hum fundamental चुनता है। **Auto** पहचाने गए mains-like hum को follow करता है; frequency पता होने पर fixed value चुनें।
- **Harmonics** (1–64, default 8) fundamental के कितने multiples हटाने हैं, यह चुनता है। अधिक मान ज्यादा buzz हटाते हैं; कम मान ऊंचे harmonics के पास अधिक संगीत बचाते हैं। Slider logarithmic scale का उपयोग करता है, इसलिए कम values को अधिक बारीकी से adjust किया जा सकता है।
- **Tracking Speed** (0–100%, default 50%) बदलते hum को automatic tracking कितनी जल्दी follow करे, यह तय करता है। अधिक मान तेज बदलाव follow करते हैं; कम मान स्थिर hum के लिए बेहतर हैं।

### डिस्प्ले पढ़ना

**FUNDAMENTAL** अभी लक्षित frequency दिखाता है। **REMOVED** हटाए जा रहे hum component का dBFS level दिखाता है: 0 dBFS के निकट मान मजबूत हटाए गए hum को दर्शाता है, जबकि -140 dBFS जैसा बहुत कम मान बहुत कम या कोई hum हटाया नहीं जा रहा है।

## Noise Reduction

Noise Reduction लगातार background noise, जैसे tape hiss, equipment noise या room noise, कम करता है। इसका उपयोग तब करें जब संगीत के पीछे लगातार noise की परत हो। यह notes के बीच बने रहने वाले noise के लिए सबसे उपयोगी है; अलग क्लिक, बदलती background sound या रिकॉर्डिंग में दूसरे संगीत को हटाने के लिए नहीं।

### सुनने की गाइड

1. **Reduction** 12 dB, **Sensitivity** 0 dB, **Smoothing** 50%, **Treble Care** 50% और **Mix** 100% से शुरू करें।
2. शांत भाग साफ होने तक **Reduction** धीरे बढ़ाएं। vocals, cymbals या ambience अप्राकृतिक लगने लगें तो घटाएं।
3. स्पष्ट लगातार hiss के लिए **Sensitivity** थोड़ा बढ़ाएं; पहले से साफ संगीत के लिए घटाएं।
4. reduction डोलती लगे या tone बदले तो **Smoothing** बढ़ाएं। संगीत बहुत soft लगे तो **Smoothing** या **Reduction** घटाएं।
5. effect bypass से तुलना करें और अधिक प्राकृतिक लगे तो **Mix** से कुछ original sound मिलाएं।

### पैरामीटर

- **Reduction** (0–24 dB, default 12 dB) background noise की अधिकतम कमी तय करता है। कम मान हल्का है; अधिक मान ज्यादा noise घटाता है, पर हल्के विवरण छिपा सकता है। हल्के noise के लिए 6–12 dB से शुरू करें।
- **Sensitivity** (-12–+12 dB, default 0 dB) तय करता है कि sound कितनी आसानी से background noise माना जाए। लगातार noise बचे तो बढ़ाएं; soft instruments, reverb tails या ambience बहुत घटें तो कम करें।
- **Smoothing** (0–100%, default 50%) पास की frequencies में reduction को अधिक समान बनाता है। अधिक मान डोलते या watery character को रोकते हैं; sound dull लगे तो इसे और **Reduction** को कम करें।
- **Treble Care** (0–100%, default 50%) high-frequency music details की रक्षा करता है। cymbals, strings और vocals की चमक बचाने के लिए बढ़ाएं; केवल तेज hiss परेशान करे तो घटाएं।
- **Mix** (0–100%, default 100%) processed और original sound मिलाता है। 100% पर केवल processed sound है; original ambience अधिक natural लगे तो घटाएं। 0% पर sound नहीं बदलता।

### सुझाई गई सेटिंग

1. **हल्की सफाई:** Reduction 6–10 dB, Sensitivity -2 से 0 dB, Smoothing 40–60%, Treble Care 50–70%।
2. **स्पष्ट tape या equipment hiss:** Reduction 12–18 dB, Sensitivity 0 से +4 dB, Smoothing 60–80%, Treble Care 50–70%।
3. **नाज़ुक treble बचाना:** Reduction 6–12 dB, Sensitivity -4 से 0 dB, Smoothing 50–70%, Treble Care 70–100%, Mix 70–100%।
