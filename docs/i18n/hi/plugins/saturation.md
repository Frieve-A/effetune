# सैचुरेशन प्लगइन

आपके संगीत में गर्माहट और चरित्र जोड़ने वाले प्लगइन का संग्रह। ये प्रभाव डिजिटल संगीत को अधिक एनालॉग जैसा बना सकते हैं और ध्वनि में सुखद समृद्धि जोड़ सकते हैं, जैसे विंटेज ऑडियो उपकरण ध्वनि को रंगते हैं।

## प्लगइन सूची

- [Hard Clipping](#hard-clipping) - ध्वनि में तीव्रता और धार जोड़ता है
- [Multiband Saturation](#multiband-saturation) - विभिन्न आवृत्ति रेंज को स्वतंत्र रूप से आकार देता और बढ़ाता है
- [Saturation](#saturation) - विंटेज उपकरणों की तरह गर्माहट और समृद्धि जोड़ता है
- [Sub Synth](#sub-synth) - बास बढ़ाने के लिए सब-हार्मोनिक सिग्नल उत्पन्न करता और मिश्रित करता है

## Hard Clipping

एक प्रभाव जो आपके संगीत में सूक्ष्म गर्माहट से लेकर तीव्र चरित्र तक कुछ भी जोड़ सकता है। यह धीरे से या आक्रामक रूप से ध्वनि तरंगों को आकार देकर काम करता है, हल्की वृद्धि से लेकर नाटकीय प्रभाव तक सब कुछ बनाता है।

### श्रवण वृद्धि गाइड
- सूक्ष्म वृद्धि:
  - डिजिटल संगीत को थोड़ा गर्म बनाता है
  - एक धीमी "एनालॉग जैसी" गुणवत्ता जोड़ता है
  - कठोरता को कम करते हुए स्पष्टता बनाए रखता है
- मध्यम प्रभाव:
  - अधिक ऊर्जावान ध्वनि बनाता है
  - लयात्मक तत्वों में उत्साह जोड़ता है
  - संगीत को अधिक "चालित" महसूस कराता है
- रचनात्मक प्रभाव:
  - नाटकीय ध्वनि परिवर्तन बनाता है
  - संगीत में आक्रामक चरित्र जोड़ता है
  - प्रयोगात्मक श्रवण के लिए बिल्कुल सही

### पैरामीटर
- **Threshold** - कितनी ध्वनि प्रभावित होती है, यह नियंत्रित करता है (-60dB से 0dB)
  - उच्च मान (-6dB से 0dB): सूक्ष्म गर्माहट
  - मध्य मान (-24dB से -6dB): उल्लेखनीय चरित्र
  - निम्न मान (-60dB से -24dB): नाटकीय प्रभाव
- **Mode** - ध्वनि के किन भागों को प्रभावित करना है, यह चुनता है
  - Both Sides: संतुलित, प्राकृतिक लगने वाला प्रभाव
  - Positive Only: अधिक चमकीली, अधिक आक्रामक ध्वनि
  - Negative Only: अधिक गहरा, अनूठा चरित्र

### विज़ुअल डिस्प्ले
- ध्वनि कैसे आकार दी जा रही है, यह दिखाता रीयल-टाइम ग्राफ
- सेटिंग्स समायोजित करते समय स्पष्ट विज़ुअल फीडबैक
- आपके समायोजन को मार्गदर्शित करने के लिए संदर्भ रेखाएं

### श्रवण टिप्स
- सूक्ष्म वृद्धि के लिए:
  1. उच्च Threshold (-6dB) से शुरू करें
  2. "Both Sides" मोड का उपयोग करें
  3. जोड़ी गई गर्माहट के लिए सुनें
- रचनात्मक प्रभावों के लिए:
  1. Threshold को धीरे-धीरे कम करें
  2. विभिन्न मोड का प्रयास करें
  3. अनूठी ध्वनियों के लिए अन्य प्रभावों के साथ संयोजित करें

## Multiband Saturation

एक बहुमुखी प्रभाव जो आपके संगीत की विशिष्ट आवृत्ति रेंज में गर्माहट और चरित्र जोड़ने की अनुमति देता है। ध्वनि को निम्न, मध्य और उच्च बैंड में विभाजित करके, आप प्रत्येक रेंज को स्वतंत्र रूप से आकार दे सकते हैं, जिससे सटीक ध्वनि वृद्धि होती है।

### श्रवण वृद्धि गाइड
- बास वृद्धि:
  - निम्न आवृत्तियों में गर्माहट और पंच जोड़ता है
  - बास गिटार और किक ड्रम को बढ़ाने के लिए बिल्कुल सही
  - अधिक पूर्ण, समृद्ध लो एंड बनाता है
- मिड रेंज आकार:
  - वोकल और वाद्ययंत्रों का बॉडी निकालता है
  - गिटार और कीबोर्ड में उपस्थिति जोड़ता है
  - अधिक स्पष्ट, परिभाषित ध्वनि बनाता है
- हाई एंड मिठास:
  - सिम्बल और हाई-हैट में चमक जोड़ता है
  - हवा और चमक को बढ़ाता है
  - स्पष्ट, विस्तृत हाई बनाता है

### पैरामीटर
- **क्रॉसओवर आवृत्तियां**
  - Freq 1 (20Hz-2kHz): निम्न बैंड कहां समाप्त होता है और मध्य बैंड कहां शुरू होता है, यह निर्धारित करता है
  - Freq 2 (200Hz-20kHz): मध्य बैंड कहां समाप्त होता है और उच्च बैंड कहां शुरू होता है, यह निर्धारित करता है
- **बैंड नियंत्रण** (प्रत्येक निम्न, मध्य और उच्च बैंड के लिए):
  - **Drive** (0.0-10.0): सैचुरेशन की तीव्रता नियंत्रित करता है
    - हल्का (0.0-3.0): सूक्ष्म वृद्धि
    - मध्यम (3.0-6.0): उल्लेखनीय गर्माहट
    - उच्च (6.0-10.0): मजबूत चरित्र
  - **Bias** (-0.3 से 0.3): सैचुरेशन वक्र की समरूपता समायोजित करता है
    - नकारात्मक: नकारात्मक शिखरों को बढ़ाता है
    - शून्य: समरूप सैचुरेशन
    - सकारात्मक: सकारात्मक शिखरों को बढ़ाता है
  - **Mix** (0-100%): प्रभाव को मूल के साथ मिश्रित करता है
    - निम्न (0-30%): सूक्ष्म वृद्धि
    - मध्यम (30-70%): संतुलित प्रभाव
    - उच्च (70-100%): मजबूत चरित्र
  - **Gain** (-18dB से +18dB): बैंड वॉल्यूम समायोजित करता है
    - बैंड को एक दूसरे के साथ संतुलित करने के लिए उपयोग किया जाता है
    - वॉल्यूम परिवर्तनों की भरपाई करता है

### विज़ुअल डिस्प्ले
- इंटरैक्टिव बैंड चयन टैब
- प्रत्येक बैंड के लिए रीयल-टाइम ट्रांसफर कर्व ग्राफ
- सेटिंग्स समायोजित करते समय स्पष्ट विज़ुअल फीडबैक

### संगीत वृद्धि टिप्स
- पूर्ण मिक्स वृद्धि के लिए:
  1. सभी बैंड पर धीमे Drive (2.0-3.0) से शुरू करें
  2. प्राकृतिक सैचुरेशन के लिए Bias को 0.0 पर रखें
  3. प्राकृतिक मिश्रण के लिए Mix को 40-50% के आसपास सेट करें
  4. प्रत्येक बैंड के लिए Gain को ठीक करें

- बास वृद्धि के लिए:
  1. निम्न बैंड पर ध्यान दें
  2. मध्यम Drive (3.0-5.0) का उपयोग करें
  3. स्थिर प्रतिक्रिया के लिए Bias को तटस्थ रखें
  4. Mix को 50-70% के आसपास रखें

- वोकल वृद्धि के लिए:
  1. मध्य बैंड पर ध्यान दें
  2. हल्के Drive (1.0-3.0) का उपयोग करें
  3. प्राकृतिक ध्वनि के लिए Bias को 0.0 पर रखें
  4. स्वाद के अनुसार Mix समायोजित करें (30-50%)

- चमक जोड़ने के लिए:
  1. उच्च बैंड पर ध्यान दें
  2. धीमे Drive (1.0-2.0) का उपयोग करें
  3. स्वच्छ सैचुरेशन के लिए Bias को तटस्थ रखें
  4. Mix को सूक्ष्म रखें (20-40%)

### त्वरित प्रारंभ गाइड
1. अपनी ध्वनि को विभाजित करने के लिए क्रॉसओवर आवृत्तियां सेट करें
2. सभी बैंड पर कम Drive मान से शुरू करें
3. शुरू में Bias को 0.0 पर रखें
4. प्रभाव को प्राकृतिक रूप से मिश्रित करने के लिए Mix का उपयोग करें
5. Gain नियंत्रणों से ठीक करें
6. अपने कानों पर भरोसा करें और स्वाद के अनुसार समायोजित करें!

## Saturation

एक प्रभाव जो विंटेज ट्यूब उपकरणों की गर्म, सुखद ध्वनि का अनुकरण करता है। यह आपके संगीत में समृद्धि और चरित्र जोड़ सकता है, इसे अधिक "एनालॉग" और कम "डिजिटल" बनाता है।

### श्रवण वृद्धि गाइड
- गर्माहट जोड़ना:
  - डिजिटल संगीत को अधिक प्राकृतिक बनाता है
  - ध्वनि में सुखद समृद्धि जोड़ता है
  - जैज़ और एकॉस्टिक संगीत के लिए बिल्कुल सही
- समृद्ध चरित्र:
  - अधिक "विंटेज" ध्वनि बनाता है
  - गहराई और आयाम जोड़ता है
  - रॉक और इलेक्ट्रॉनिक संगीत के लिए बढ़िया
- मज़बूत प्रभाव:
  - ध्वनि को नाटकीय रूप से बदलता है
  - बोल्ड, चरित्रपूर्ण टोन बनाता है
  - प्रयोगात्मक श्रवण के लिए आदर्श

### पैरामीटर
- **Drive** - गर्माहट और चरित्र की मात्रा को नियंत्रित करता है (0.0 से 10.0)
  - हल्का (0.0-3.0): सूक्ष्म एनालॉग गर्माहट
  - मध्यम (3.0-6.0): समृद्ध, विंटेज चरित्र
  - मज़बूत (6.0-10.0): बोल्ड, नाटकीय प्रभाव
- **Bias** - सैचुरेशन वक्र की समरूपता समायोजित करता है (-0.3 से 0.3)
  - 0.0: समरूप सैचुरेशन
  - सकारात्मक: सकारात्मक शिखरों को बढ़ाता है
  - नकारात्मक: नकारात्मक शिखरों को बढ़ाता है
- **Mix** - मूल ध्वनि के साथ प्रभाव को संतुलित करता है (0% से 100%)
  - 0-30%: सूक्ष्म वृद्धि
  - 30-70%: संतुलित प्रभाव
  - 70-100%: मज़बूत चरित्र
- **Gain** - समग्र वॉल्यूम को समायोजित करता है (-18dB से +18dB)
  - यदि प्रभाव बहुत तेज़ है तो नकारात्मक मान का उपयोग करें
  - यदि प्रभाव बहुत धीमा है तो सकारात्मक मान का उपयोग करें

### विज़ुअल डिस्प्ले
- ध्वनि कैसे आकार दी जा रही है, यह दिखाता स्पष्ट ग्राफ
- रीयल-टाइम विज़ुअल फीडबैक
- आसानी से पढ़ने योग्य नियंत्रण

### संगीत वृद्धि टिप्स
- शास्त्रीय और जैज़:
  - प्राकृतिक गर्माहट के लिए हल्का Drive (1.0-2.0)
  - स्वच्छ सैचुरेशन के लिए Bias को 0.0 पर रखें
  - सूक्ष्मता के लिए कम Mix (20-40%)
- रॉक और पॉप:
  - समृद्ध चरित्र के लिए मध्यम Drive (3.0-5.0)
  - स्थिर प्रतिक्रिया के लिए Bias को तटस्थ रखें
  - संतुलन के लिए मध्यम Mix (40-60%)
- इलेक्ट्रॉनिक:
  - बोल्ड प्रभाव के लिए उच्च Drive (4.0-7.0)
  - विभिन्न Bias मानों का प्रयोग करें
  - चरित्र के लिए उच्च Mix (60-80%)

### त्वरित प्रारंभ गाइड
1. धीमी गर्माहट के लिए कम Drive से शुरू करें
2. शुरू में Bias को 0.0 पर रखें
3. प्रभाव को संतुलित करने के लिए Mix समायोजित करें
4. उचित वॉल्यूम के लिए यदि आवश्यक हो तो Gain समायोजित करें
5. प्रयोग करें और अपने कानों पर भरोसा करें!

## Sub Synth

एक विशेष प्रभाव जो सब-हार्मोनिक सिग्नल उत्पन्न करके और मिश्रित करके आपके संगीत के लो-एंड को बढ़ाता है। कम बास वाली रिकॉर्डिंग में गहराई और शक्ति जोड़ने या समृद्ध, पूर्ण बास ध्वनियां बनाने के लिए बिल्कुल सही।

### श्रवण वृद्धि गाइड
- बास वृद्धि:
  - पतली रिकॉर्डिंग में गहराई और शक्ति जोड़ता है
  - अधिक पूर्ण, समृद्ध लो एंड बनाता है
  - हेडफ़ोन श्रवण के लिए बिल्कुल सही
- आवृत्ति नियंत्रण:
  - सब-हार्मोनिक आवृत्तियों पर सटीक नियंत्रण
  - स्वच्छ बास के लिए स्वतंत्र फ़िल्टरिंग
  - शक्ति जोड़ते हुए स्पष्टता बनाए रखता है

### पैरामीटर
- **Sub Level** - सब-हार्मोनिक सिग्नल स्तर नियंत्रित करता है (0-200%)
  - हल्का (0-50%): सूक्ष्म बास वृद्धि
  - मध्यम (50-100%): संतुलित बास बूस्ट
  - उच्च (100-200%): नाटकीय बास प्रभाव
- **Dry Level** - मूल सिग्नल स्तर समायोजित करता है (0-200%)
  - सब-हार्मोनिक सिग्नल के साथ संतुलित करने के लिए उपयोग किया जाता है
  - मूल ध्वनि की स्पष्टता बनाए रखता है
- **Sub LPF** - सब-हार्मोनिक सिग्नल के लिए लो-पास फ़िल्टर (5-400Hz)
  - आवृत्ति: सब की ऊपरी सीमा नियंत्रित करता है
  - स्लोप: फ़िल्टर तीक्ष्णता समायोजित करता है (बंद से -24dB/oct)
- **Sub HPF** - सब-हार्मोनिक सिग्नल के लिए हाई-पास फ़िल्टर (5-400Hz)
  - आवृत्ति: अवांछित गड़गड़ाहट हटाता है
  - स्लोप: फ़िल्टर तीक्ष्णता नियंत्रित करता है (बंद से -24dB/oct)
- **Dry HPF** - मूल सिग्नल के लिए हाई-पास फ़िल्टर (5-400Hz)
  - आवृत्ति: बास जमावट रोकता है
  - स्लोप: फ़िल्टर तीक्ष्णता समायोजित करता है (बंद से -24dB/oct)

### विज़ुअल डिस्प्ले
- इंटरैक्टिव आवृत्ति प्रतिक्रिया ग्राफ
- फ़िल्टर वक्रों का स्पष्ट विज़ुअलाइज़ेशन
- रीयल-टाइम विज़ुअल फीडबैक

### संगीत वृद्धि टिप्स
- सामान्य बास वृद्धि के लिए:
  1. 50% Sub Level से शुरू करें
  2. Sub LPF को 100Hz के आसपास सेट करें (-12dB/oct)
  3. Sub HPF को 20Hz पर रखें (-6dB/oct)
  4. स्वाद के अनुसार Dry Level समायोजित करें

- स्वच्छ बास बूस्ट के लिए:
  1. Sub Level को 70-100% पर सेट करें
  2. 80Hz पर Sub LPF का उपयोग करें (-18dB/oct)
  3. Sub HPF को 30Hz पर सेट करें (-12dB/oct)
  4. 40Hz पर Dry HPF सक्षम करें

- अधिकतम प्रभाव के लिए:
  1. Sub Level को 150% तक बढ़ाएं
  2. Sub LPF को 120Hz पर सेट करें (-24dB/oct)
  3. Sub HPF को 15Hz पर रखें (-6dB/oct)
  4. Dry Level से संतुलित करें

### त्वरित प्रारंभ गाइड
1. मध्यम Sub Level (50-70%) से शुरू करें
2. Sub LPF को 100Hz के आसपास सेट करें
3. 20Hz के आसपास Sub HPF सक्षम करें
4. संतुलन के लिए Dry Level समायोजित करें
5. आवश्यकतानुसार फ़िल्टर ठीक करें
6. अपने कानों पर भरोसा करें और धीरे-धीरे समायोजित करें!
