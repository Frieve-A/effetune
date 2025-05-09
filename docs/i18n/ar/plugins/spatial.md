# إضافات الصوت المكاني

مجموعة من الإضافات التي تحسن كيفية سماع الموسيقى في سماعات الرأس أو السماعات من خلال ضبط توازن الستيريو (اليسار واليمين). هذه المؤثرات يمكن أن تجعل موسيقاك تبدو أكثر اتساعاً وطبيعية، خاصة عند الاستماع بسماعات الرأس.

## قائمة الإضافات

- [MS Matrix](#ms-matrix) - ضبط صورة الستيريو عن طريق التحكم بشكل مستقل في مستويات Mid و Side، مع خيار تبديل Left/Right  
- [Multiband Balance](#multiband-balance) - التحكم في توازن الستيريو المعتمد على التردد بخمس نطاقات
- [Stereo Blend](#stereo-blend) - يتحكم في عرض الستيريو من الأحادي إلى الستيريو المعزز

## MS Matrix

معالج Mid/Side مرن يتيح لك التحكم بشكل مستقل في مركز الإشارة (mid) وعرضها (side) في صورة الستيريو الخاصة بك. استخدم أدوات تحكم بسيطة في الكسب وخيار تبديل Left/Right لضبط موضع الصوت في المجال الاستريو بدون توجيه معقد.

### المزايا الرئيسية
- ضبط منفصل لمستوى Mid و Side (–18 dB إلى +18 dB)  
- مفتاح Mode: Encode (Stereo→M/S) أو Decode (M/S→Stereo)  
- خيار تبديل Left/Right قبل التشفير أو بعد فك التشفير  
- تغييرات معلمات خالية من النقر لسلاسة التعديلات  

### المعلمات
- **Mode** (Encode/Decode)  
- **Mid Gain** (–18 dB إلى +18 dB): يضبط مستوى المحتوى المركزي  
- **Side Gain** (–18 dB إلى +18 dB): يضبط مستوى الفرق الاستريو (العرض)  
- **Swap L/R** (Off/On): يبدل القناتين اليسرى واليمنى قبل التشفير أو بعد فك التشفير  

### الإعدادات الموصى بها
1. **توسيع طفيف**  
   - Mode: Decode  
   - Mid Gain: 0 dB  
   - Side Gain: +3 dB  
   - Swap: Off  
2. **تركيز على المركز**  
   - Mode: Decode  
   - Mid Gain: +3 dB  
   - Side Gain: –3 dB  
   - Swap: Off  
3. **قلب إبداعي**  
   - Mode: Encode  
   - Mid Gain: 0 dB  
   - Side Gain: 0 dB  
   - Swap: On  

### دليل البدء السريع
1. اختر **Mode** للتحويل  
2. اضبط **Mid Gain** و **Side Gain**  
3. فعّل **Swap L/R** لتصحيح القناة أو الانعكاس الإبداعي  
4. استخدم التجاهل (Bypass) للمقارنة والتأكد من عدم وجود مشاكل طور  

## Multiband Balance

معالج مكاني متطور يقسم الصوت إلى خمسة نطاقات ترددية ويسمح بالتحكم في توازن الستيريو المستقل لكل نطاق. توفر هذه الإضافة تحكماً دقيقاً في صورة الستيريو عبر الطيف الترددي، مما يوفر إمكانيات إبداعية لتصميم الصوت والمزج، بالإضافة إلى تطبيقات تصحيحية للتسجيلات الستيريو المشكلة.

### الميزات الرئيسية
- التحكم في توازن الستيريو المعتمد على التردد بخمس نطاقات
- مرشحات تقاطع Linkwitz-Riley عالية الجودة
- تحكم توازن خطي لضبط الستيريو الدقيق
- معالجة مستقلة للقنوات اليسرى واليمنى
- تغييرات المعلمات بدون نقرات مع معالجة تلاشي تلقائية

### المعلمات

#### ترددات التقاطع
- **Freq 1** (20-500 هرتز): يفصل النطاقات المنخفضة والمتوسطة المنخفضة
- **Freq 2** (100-2000 هرتز): يفصل النطاقات المتوسطة المنخفضة والمتوسطة
- **Freq 3** (500-8000 هرتز): يفصل النطاقات المتوسطة والمتوسطة العالية
- **Freq 4** (1000-20000 هرتز): يفصل النطاقات المتوسطة العالية والعالية

#### التحكم في النطاقات
كل نطاق له تحكم مستقل في التوازن:
- **Band 1 Bal.** (-100% إلى +100%): يتحكم في توازن الستيريو للترددات المنخفضة
- **Band 2 Bal.** (-100% إلى +100%): يتحكم في توازن الستيريو للترددات المتوسطة المنخفضة
- **Band 3 Bal.** (-100% إلى +100%): يتحكم في توازن الستيريو للترددات المتوسطة
- **Band 4 Bal.** (-100% إلى +100%): يتحكم في توازن الستيريو للترددات المتوسطة العالية
- **Band 5 Bal.** (-100% إلى +100%): يتحكم في توازن الستيريو للترددات العالية

### الإعدادات الموصى بها

1. تعزيز الستيريو الطبيعي
   - النطاق المنخفض (20-100 هرتز): 0% (مركزي)
   - المتوسط المنخفض (100-500 هرتز): ±20%
   - المتوسط (500-2000 هرتز): ±40%
   - المتوسط العالي (2000-8000 هرتز): ±60%
   - العالي (8000+ هرتز): ±80%
   - التأثير: يخلق توسعاً ستيريو متدرجاً يزداد مع التردد

2. مزج مركز
   - النطاق المنخفض: 0%
   - المتوسط المنخفض: ±10%
   - المتوسط: ±30%
   - المتوسط العالي: ±20%
   - العالي: ±40%
   - التأثير: يحافظ على التركيز المركزي مع إضافة عرض خفيف

3. مشهد صوتي غامر
   - النطاق المنخفض: 0%
   - المتوسط المنخفض: ±40%
   - المتوسط: ±60%
   - المتوسط العالي: ±80%
   - العالي: ±100%
   - التأثير: يخلق مجالاً صوتياً محيطاً مع ترسيخ الجهير

### دليل التطبيق

1. تحسين المزج
   - حافظ على الترددات المنخفضة (تحت 100 هرتز) في المركز للحصول على جهير مستقر
   - زيادة عرض الستيريو تدريجياً مع التردد
   - استخدم إعدادات معتدلة (±30-50%) للتحسين الطبيعي
   - راقب في الوضع الأحادي للتحقق من مشاكل الطور

2. حل المشكلات
   - تصحيح مشاكل الطور في نطاقات ترددية محددة
   - شد الجهير غير المركز عن طريق توسيط الترددات المنخفضة
   - تقليل التشوهات الستيريو الحادة في الترددات العالية
   - إصلاح المسارات الستيريو المسجلة بشكل سيئ

3. تصميم الصوت الإبداعي
   - إنشاء حركة معتمدة على التردد
   - تصميم تأثيرات مكانية فريدة
   - بناء مشاهد صوتية غامرة
   - تعزيز آلات أو عناصر محددة

4. ضبط المجال الستيريو
   - ضبط دقيق لتوازن الستيريو لكل نطاق ترددي
   - تصحيح التوزيع الستيريو غير المتساوي
   - تعزيز الفصل الستيريو حيث يلزم
   - الحفاظ على التوافق الأحادي

### دليل البدء السريع

1. الإعداد الأولي
   - ابدأ مع جميع النطاقات في المركز (0%)
   - اضبط ترددات التقاطع على النقاط القياسية:
     * Freq 1: 100 هرتز
     * Freq 2: 500 هرتز
     * Freq 3: 2000 هرتز
     * Freq 4: 8000 هرتز

2. التحسين الأساسي
   - حافظ على Band 1 (المنخفض) في المركز
   - قم بتعديلات صغيرة للنطاقات العالية
   - استمع للتغييرات في الصورة المكانية
   - تحقق من التوافق الأحادي

3. الضبط الدقيق
   - اضبط نقاط التقاطع لتتناسب مع مادتك
   - قم بتغييرات تدريجية في مواضع النطاقات
   - استمع للتشوهات غير المرغوب فيها
   - قارن مع التجاوز للمنظور

تذكر: Multiband Balance هو أداة قوية تتطلب ضبطاً حذراً. ابدأ بإعدادات خفيفة وزد التعقيد حسب الحاجة. تحقق دائماً من ضبطك في كل من الستيريو والأحادي لضمان التوافق.

## Stereo Blend

تأثير يساعد في تحقيق مجال صوتي أكثر طبيعية من خلال ضبط عرض الستيريو لموسيقاك. مفيد بشكل خاص للاستماع بسماعات الرأس، حيث يمكنه تقليل فصل الستيريو المبالغ فيه الذي يحدث غالباً مع سماعات الرأس، مما يجعل تجربة الاستماع أكثر طبيعية وأقل إرهاقاً. يمكنه أيضاً تعزيز صورة الستيريو للاستماع بالسماعات عند الحاجة.

### دليل تحسين الاستماع
- تحسين سماعات الرأس:
  - تقليل عرض الستيريو (60-90%) لعرض أكثر طبيعية، يشبه السماعات
  - تقليل إرهاق الاستماع من فصل الستيريو المفرط
  - خلق مسرح صوتي أمامي أكثر واقعية
- تعزيز السماعات:
  - الحفاظ على صورة الستيريو الأصلية (100%) لإعادة إنتاج دقيقة
  - تعزيز خفيف (110-130%) لمسرح صوتي أوسع عند الحاجة
  - ضبط حذر للحفاظ على مجال صوتي طبيعي
- التحكم في المجال الصوتي:
  - التركيز على العرض الطبيعي والواقعي
  - تجنب العرض المفرط الذي قد يبدو اصطناعياً
  - التحسين لبيئة الاستماع الخاصة بك

### Parameters
- **Stereo** - يتحكم في عرض الستيريو (0-200%)
  - 0%: أحادي كامل (دمج القنوات اليسرى واليمنى)
  - 100%: صورة الستيريو الأصلية
  - 200%: ستيريو معزز بأقصى عرض (L-R/R-L)

### الإعدادات الموصى بها لسيناريوهات الاستماع المختلفة

1. الاستماع بسماعات الرأس (طبيعي)
   - Stereo: 60-90%
   - التأثير: فصل ستيريو مخفض
   - مثالي لـ: جلسات الاستماع الطويلة، تقليل الإرهاق

2. الاستماع بالسماعات (مرجعي)
   - Stereo: 100%
   - التأثير: صورة الستيريو الأصلية
   - مثالي لـ: إعادة الإنتاج الدقيقة

3. تعزيز السماعات
   - Stereo: 110-130%
   - التأثير: تعزيز عرض خفيف
   - مثالي لـ: الغرف ذات وضع السماعات القريب

### دليل تحسين نمط الموسيقى

- الموسيقى الكلاسيكية
  - سماعات الرأس: 70-80%
  - السماعات: 100%
  - الفائدة: منظور قاعة حفلات طبيعي

- الجاز والصوتية
  - سماعات الرأس: 80-90%
  - السماعات: 100-110%
  - الفائدة: صوت مجموعة حميم وواقعي

- الروك والبوب
  - سماعات الرأس: 85-95%
  - السماعات: 100-120%
  - الفائدة: تأثير متوازن دون عرض اصطناعي

- الموسيقى الإلكترونية
  - سماعات الرأس: 90-100%
  - السماعات: 100-130%
  - الفائدة: اتساع متحكم فيه مع الحفاظ على التركيز

### دليل البدء السريع

1. اختر إعداد الاستماع الخاص بك
   - حدد ما إذا كنت تستخدم سماعات رأس أو سماعات
   - هذا يحدد نقطة البداية للضبط

2. ابدأ بإعدادات محافظة
   - سماعات الرأس: ابدأ عند 80%
   - السماعات: ابدأ عند 100%
   - استمع لوضع الصوت الطبيعي

3. ضبط دقيق لموسيقاك
   - قم بتعديلات صغيرة (5-10% في المرة)
   - ركز على تحقيق مجال صوتي طبيعي
   - انتبه لراحة الاستماع

تذكر: الهدف هو تحقيق تجربة استماع طبيعية ومريحة تقلل الإرهاق وتحافظ على العرض الموسيقي المقصود. تجنب الإعدادات المتطرفة التي قد تبدو مثيرة للإعجاب في البداية ولكنها تصبح مرهقة مع مرور الوقت.