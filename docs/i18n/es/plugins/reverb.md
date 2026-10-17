---
title: "Plugins de reverb - Convolución, sala de conciertos, placa y habitación - EffeTune"
description: "Plugins de reverb Dattorro Plate Reverb, FDN Reverb, IR Reverb y RS Reverb."
lang: es
---

# Plugins de reverb

Una colección de plugins que añaden espacio y atmósfera a tu música. Estos efectos pueden hacer que tu música suene como si estuviera siendo reproducida en diferentes ambientes, desde habitaciones íntimas hasta grandes salas de conciertos, mejorando tu experiencia de escucha con ambiente natural y profundidad.

## Lista de Plugins

- [Dattorro Plate Reverb](#dattorro-plate-reverb) - Reverb de placa clásico basado en el algoritmo Dattorro
- [FDN Reverb](#fdn-reverb) - Reverb de Red de Retardo de Retroalimentación con matriz de difusión avanzada
- [IR Reverb](#ir-reverb) - Reverb por convolución con una respuesta al impulso importada
- [RS Reverb](#rs-reverb) - Crea ambiente y espacio natural de habitación

## Dattorro Plate Reverb

Una reverberación de placa basada en el diseño de Jon Dattorro de 1997. Añade una caída densa y suave, ideal cuando quieres un ambiente amplio sin la impresión de una sala concreta.

### Guía de Experiencia de Escucha
- Sonido de Placa Exuberante:
  - Carácter clásico de reverb de placa
  - Cola de reverb suave y densa sin artefactos metálicos
  - Hermoso brillo y calidez característicos de los reverbs de placa
- Ambiente Versátil:
  - Desde mejora sutil de sala hasta salas expansivas
  - Funciona hermosamente con cualquier género musical
  - Añade espacio y un acabado suave a la música
- Movimiento Natural:
  - La modulación añade vida orgánica al reverb
  - Previene colas estáticas y artificiales
  - Crea un espacio vivo y respirante alrededor de tu música

### Presets del sistema

Haz clic en **Preajustes de efecto** en el encabezado del efecto para empezar con un ajuste completo de placa.

- **Studio Plate** - Una reverberación de placa corta y brillante para la escucha cotidiana.
- **Vocal Plate** - Separa el ataque del sonido original de la reverberación con un retardo previo más largo.
- **Dark Vintage Plate** - Una respuesta de placa más oscura y con mayor amortiguación.
- **Long Wash** - Una cola de reverberación larga y envolvente, con modulación.

### Parámetros
- **Pre Delay** - Silencio inicial antes de que comience el reverb (control de 0.0 a 100.0 ms; usa valores por debajo de 100.0 ms para un pre-delay efectivo)
  - 0-10ms: Reverb inmediata, sensación íntima
  - 10-30ms: Sensación natural de espacio
  - 30-99.9ms: Crea impresión de espacios más grandes
  - Evita exactamente 100.0ms cuando quieras el pre-delay máximo, porque ese ajuste no produce casi ningún pre-delay audible
- **Bandwidth** - Filtrado de señal de entrada (0.0 a 1.0)
  - Valores más bajos: Tono de entrada más oscuro y cálido
  - Valores más altos (cerca de 1.0): Entrada más brillante, frecuencia completa
  - Por defecto 0.9995: Óptimo según sugirió Dattorro
- **Input Diff 1** - Primera etapa de difusión de entrada (0.0 a 1.0)
  - Controla la dispersión inicial de la señal de entrada
  - Por defecto 0.75: Valor recomendado del artículo de Dattorro
  - Valores más altos: Reflexiones tempranas más difusas y suaves
- **Input Diff 2** - Segunda etapa de difusión de entrada (0.0 a 1.0)
  - Dispersa más la señal de entrada
  - Por defecto 0.625: Valor recomendado del artículo de Dattorro
  - Trabaja con Input Diff 1 para crear difusión compleja
- **Decay** - Cuánto dura la cola del reverb (0.0 a 1.0)
  - Bajo (0.1-0.3): Decaimiento corto y controlado
  - Medio (0.4-0.6): Decaimiento natural tipo habitación
  - Alto (0.7-1.0): Colas largas y expansivas
- **Decay Diff 1** - Difusión de decaimiento en el tanque (0.0 a 1.0)
  - Controla la densidad durante la fase de decaimiento
  - Por defecto 0.70: Valor recomendado del artículo de Dattorro
  - Afecta la suavidad de la cola del reverb
- **Damping** - Absorción de alta frecuencia con el tiempo (0.0 a 1.0)
  - 0.0: Sin amortiguación, reverb brillante en todo momento
  - 0.0005 (por defecto): Amortiguación muy sutil y natural
  - Valores más altos: Decaimiento más oscuro y cálido
- **Mod Depth** - Cantidad de modulación de retardo (0.0 a 16.0 muestras)
  - 0.0: Sin modulación, reverb estática
  - 1.0-4.0: Movimiento sutil, añade vida
  - 8.0-16.0: Efecto tipo chorus más notable
- **Mod Rate** - Velocidad de modulación (0.0 a 10.0 Hz)
  - 0.5-1.5Hz: Movimiento lento y suave
  - 2.0-4.0Hz: Modulación más activa
  - Valores más altos: Efecto rápido y brillante
- **Wet Mix** - Cantidad de reverb añadida (0 a 100%)
  - 10-30%: Mejora sutil
  - 30-50%: Presencia notable
  - 50-100%: Efecto de reverb dominante
- **Dry Mix** - Cantidad de señal original (0 a 100%)
  - Usualmente mantenida al 100% para escucha normal
  - Reducir para efectos especiales o lavados ambientales

### Configuraciones Recomendadas para Diferentes Estilos Musicales

1. Piano Clásico
   - Decay: 0.6-0.7
   - Damping: 0.001
   - Mod Depth: 1.0
   - Wet Mix: 25-35%
   - Útil para: Piano solo, música de cámara

2. Voces y Acústico
   - Decay: 0.4-0.5
   - Damping: 0.002
   - Pre Delay: 15-25ms
   - Wet Mix: 20-30%
   - Útil para: Voces, guitarra acústica

3. Ambiente y Atmosférico
   - Decay: 0.8-0.95
   - Mod Depth: 4.0-8.0
   - Mod Rate: 0.5-1.0Hz
   - Wet Mix: 50-70%
   - Útil para: Ambient, electrónica, paisajes sonoros

4. Mejora General
   - Decay: 0.5
   - Damping: 0.0005
   - Mod Depth: 1.0
   - Wet Mix: 20-30%
   - Útil para: Escucha general y ambiente sutil

### Guía de Inicio Rápido

1. Establecer el Carácter Básico
   - Comienza con Decay para controlar la longitud del reverb
   - Ajusta Pre Delay para la distancia percibida
   - Establece Wet Mix para la presencia de reverb deseada

2. Dar Forma al Tono
   - Usa Bandwidth para controlar el brillo de entrada
   - Ajusta Damping para el decaimiento de alta frecuencia
   - Ajusta finamente los parámetros de difusión para la densidad

3. Añadir Movimiento
   - Establece Mod Depth para variación sutil (prueba 1.0)
   - Ajusta Mod Rate para la velocidad (prueba 1.0Hz)
   - Estos parámetros añaden vida al reverb

4. Balance Final
   - Ajusta la mezcla Wet/Dry al gusto
   - Confía en tus oídos para los ajustes finales
   - Los valores por defecto son un gran punto de partida

El Dattorro Plate Reverb aporta un ambiente clásico de estilo placa a tu experiencia de escucha. Su carácter suave y exuberante es útil para añadir espacio bello y natural a una grabación.

### Enrutamiento multicanal

Dattorro Plate Reverb es un modelo de placa estéreo. Cuando se enruta con más de dos canales, todos los canales de entrada enrutados alimentan una placa mono a estéreo compartida, pero la mezcla wet/dry se escribe solo en el primer par estéreo enrutado. Los canales adicionales contribuyen a la entrada de la placa y pasan sin cambios, incluso con Dry Mix en 0%; no reciben retorno wet y no son tanques de placa independientes.

## FDN Reverb

FDN Reverb añade una caída densa y natural. Úsalo para dar a grabaciones secas o cercanas una sensación más clara de tamaño de sala y distancia.

### Guía de Experiencia de Escucha
- Sensación de Habitación Natural:
  - Crea la sensación de escuchar en espacios acústicos reales
  - Añade profundidad y dimensión a tu música
  - Hace que las grabaciones estéreo se sientan más espaciosas y vivas
- Mejora Atmosférica:
  - Transforma grabaciones planas en experiencias inmersivas
  - Añade hermosos sustain y colas a las notas musicales
  - Crea una sensación de estar en el espacio de actuación
- Ambiente Personalizable:
  - Ajustable desde habitaciones íntimas hasta grandes salas de conciertos
  - Control fino sobre el carácter y color del espacio
  - La modulación suave añade movimiento natural y vida

### Presets del sistema

Haz clic en **Preajustes de efecto** en el encabezado del efecto para aplicar un espacio completo en lugar de ajustar cada control por separado.

- **Tight Room** - Sala corta y contenida.
- **Warm Hall** - Sala más larga y suavemente oscura para música acústica y orquestal.
- **Bright Plate** - Reverberación corta, brillante y animada con carácter de placa.
- **Vast Cavern** - El espacio más grande y largo de los incluidos.

### Parámetros
- **Reverb Time** - Cuánto dura el efecto de reverb (0.20 a 10.00 s)
  - Corto (0.2-1.0s): Decaimiento rápido y controlado para claridad
  - Medio (1.0-3.0s): Reverberación natural tipo habitación
  - Largo (3.0-10.0s): Colas expansivas y atmosféricas
- **Density** - Número de rutas de eco para complejidad (4 a 8 líneas)
  - 4 líneas: Ecos individuales más simples y definidos
  - 6 líneas: Buen equilibrio de complejidad y claridad
  - 8 líneas: Máxima suavidad y densidad
- **Pre Delay** - Silencio inicial antes de que comience la reverb (0.0 a 100.0 ms)
  - 0-20ms: Reverb inmediata, sensación íntima
  - 20-50ms: Sensación natural de distancia de habitación
  - 50-100ms: Crea impresión de espacios más grandes
- **Base Delay** - Tiempo base para la red de reverb (10.0 a 60.0 ms)
  - Valores más bajos: Carácter de reverb más ajustado y enfocado
  - Valores más altos: Calidad de sonido más espaciosa y abierta
  - Afecta las relaciones de tiempo fundamentales
- **Delay Spread** - Añade variación progresiva de tiempo entre líneas de retardo encima de pequeños desplazamientos aleatorios por línea (0.0 a 25.0 ms)
  - 0.0ms: Usa el retardo base más pequeños desplazamientos aleatorios de línea, por lo que las reflexiones siguen siendo ligeramente irregulares
  - Valores más altos: Añaden más separación progresiva entre líneas para una cola más grande y menos regular
  - Añade variación realista encontrada en espacios acústicos reales
- **HF Damp** - Cómo se desvanecen las altas frecuencias con el tiempo (0.0 a 12.0 dB/s)
  - 0.0: Sin amortiguación, sonido brillante durante todo el decaimiento
  - 3.0-6.0: Simulación natural de absorción de aire
  - 12.0: Amortiguación pesada para carácter cálido y suave
- **Low Cut** - Elimina bajas frecuencias de la reverb (20 a 500 Hz)
  - 20-50Hz: Respuesta completa de graves en la reverb
  - 100-200Hz: Graves controlados para evitar que suene turbio
  - 300-500Hz: Graves ajustados y claros
- **Mod Depth** - Cantidad de modulación de tono para efecto chorus (0.0 a 10.0 cents)
  - 0.0: Sin modulación, reverb estática pura
  - 2.0-5.0: Movimiento sutil que añade vida y realismo
  - 10.0: Efecto de tipo chorus notable
- **Mod Rate** - Velocidad de la modulación (0.10 a 5.00 Hz)
  - 0.1-0.5Hz: Movimiento muy lento y suave
  - 1.0-2.0Hz: Variación de sonido natural
  - 3.0-5.0Hz: Modulación rápida y más obvia
- **Diffusion** - Controla cuánto del feedback mezclado vuelve a la red de retardo (0 a 100%)
  - 0%: Desactiva la difusión de feedback; el sonido se vuelve mucho más escaso y la cola de reverb se reduce mucho
  - 50%: Difusión equilibrada para sonido natural
  - 100%: Difusión de feedback máxima para la densidad más suave
- **Wet Mix** - Cantidad de reverb añadida al sonido (0 a 100%)
  - 10-30%: Mejora espacial sutil
  - 30-60%: Presencia notable de reverb
  - 60-100%: Efecto de reverb dominante
- **Dry Mix** - Cantidad de señal original preservada (0 a 100%)
  - Usualmente mantenida al 100% para escucha normal
  - Puede reducirse para efectos atmosféricos especiales
- **Stereo Width** - Mezcla la reverb wet desde mono hacia taps wet izquierdo/derecho separados (0 a 200%)
  - 0%: La reverb wet aparece en el centro (mono)
  - 100%: Ancho estéreo wet moderado por defecto
  - 200%: Separación completa de taps wet izquierdo/derecho, no amplificación extra del componente lateral

### Configuraciones Recomendadas para Diferentes Experiencias de Escucha

1. Mejora de Música Clásica
   - Reverb Time: 2.5-3.5s
   - Density: 8 líneas
   - Pre Delay: 30-50ms
   - HF Damp: 4.0-6.0
   - Útil para: Grabaciones orquestales, música de cámara

2. Atmósfera de Club de Jazz
   - Reverb Time: 1.2-1.8s
   - Density: 6 líneas
   - Pre Delay: 15-25ms
   - HF Damp: 2.0-4.0
   - Útil para: Jazz acústico, actuaciones íntimas

3. Mejora Pop/Rock
   - Reverb Time: 1.0-2.0s
   - Density: 6-7 líneas
   - Pre Delay: 10-30ms
   - Wet Mix: 20-40%
   - Útil para: Grabaciones que necesitan un poco más de espacio

4. Paisajes Sonoros Ambientales
   - Reverb Time: 4.0-8.0s
   - Density: 8 líneas
   - Mod Depth: 3.0-6.0
   - Wet Mix: 60-80%
   - Útil para: Música atmosférica y caídas largas

### Guía de Inicio Rápido

1. Establecer el Carácter del Espacio
   - Comienza con Reverb Time para igualar el tamaño de espacio deseado
   - Establece Density a 6-8 para sonido suave y natural
   - Ajusta Pre Delay para controlar la percepción de distancia

2. Dar Forma al Tono
   - Usa HF Damp para simular absorción natural del aire
   - Establece Low Cut para prevenir acumulación de graves
   - Ajusta Diffusion para suavidad (prueba 70-100%)

3. Añadir Movimiento Natural
   - Establece Mod Depth a 2-4 cents para vida sutil
   - Usa Mod Rate alrededor de 0.3-1.0 Hz para variación suave
   - Ajusta Stereo Width para impresión espacial

4. Equilibrar el Efecto
   - Comienza con 30% Wet Mix
   - Mantén Dry Mix al 100% para escucha normal
   - Ajusta finamente basado en tu música y preferencias

Empieza con un valor bajo de Wet Mix y súbelo hasta que el espacio añadido se oiga sin enmascarar los detalles de la grabación.

### Enrutamiento multicanal

Todos los canales de entrada enrutados se mezclan en una sola reverberación compartida. El sonido reverberado se distribuye entre los canales de salida enrutados, sin crear una reverberación independiente para cada entrada.

## IR Reverb

IR Reverb convoluciona la señal con una respuesta al impulso (IR) importada y reproduce el decaimiento y el carácter espacial medidos de una sala, un auditorio, una placa u otro sistema acústico. Resulta útil cuando buscas el carácter repetible de una captura concreta en lugar de un modelo de reverberación sintetizado.

### Guía de mejora del sonido

- **Apoyo discreto de sala:** Importa una IR de sala corta, deja **Dry** activado con **Dry Level** en 0 dB, ajusta **Wet Level** entre -18 y -12 dB y usa un **Pre Delay** breve. Así añades espacio sin enturbiar la grabación.
- **Ampliar la sensación de auditorio:** Usa una IR de auditorio estéreo o True Stereo, baja primero **Wet Level** y después acorta una cola demasiado larga con **Decay** y **Trim**.
- **Envío/retorno de reverberación:** Envía la fuente a otro bus con **Matrix**, coloca IR Reverb en ese retorno con **Dry** desactivado y **Wet Level** en 0 dB, y controla la reverberación con el nivel de envío. Así evitas sumar dos veces la señal original, y también funciona con retornos multicanal seleccionados.
- **Comparación y repetibilidad:** Conserva el archivo IR original y el registro de su fuente y licencia. Los mismos bytes de la IR generan el mismo ID de biblioteca, de modo que otra instalación puede volver a enlazarla exactamente importando ese archivo.

### Parámetros

- **Channel Mode** - Selecciona cómo se enrutan los canales de la IR. **Auto** elige Mono para una IR de un canal, True Stereo para una IR de cuatro canales con una selección estéreo, Independent cuando coinciden el número de canales de la IR y el de canales seleccionados, y Diagonal Matrix en los demás casos; el modo resultante aparece a la derecha del menú. **Mono** aplica una sola IR a los canales seleccionados; **Independent** asigna un canal de la IR a cada canal seleccionado; **True Stereo** usa las rutas LL/LR/RL/RR; **Diagonal Matrix** conecta las entradas y salidas correspondientes sin cruce entre canales.
- **Latency** - Elige la latencia de bloque de la convolución (Zero, 128, 256, 512 o 1024 muestras). Los valores altos suelen reducir la carga de proceso, pero retrasan toda la salida del efecto; la señal directa se retrasa lo mismo para mantenerse alineada con la reverberación, y la cadena compensa ese retardo. **Zero** requiere **Convolution Rate = Full**.
- **Convolution Rate** - Ajusta la frecuencia de muestreo de la convolución wet. **Auto** usa media frecuencia cuando la frecuencia del contexto es alta y muestra la frecuencia resultante a la derecha del menú, mientras que **Full**, **Half** y **Quarter** fijan la elección de forma explícita. Las frecuencias reducidas bajan el coste de proceso, pero también reducen el ancho de banda de la ruta wet; Quarter requiere una frecuencia de contexto de al menos 176,4 kHz.
- **Wet Level** - Ajusta el nivel de la salida convolucionada de -96 a +12 dB. El valor predeterminado es -15 dB para un uso normal como inserto; en una configuración de envío/retorno, usa 0 dB y controla la cantidad de reverberación con el nivel de envío.
- **Dry** - Activa la señal directa. Está activado de forma predeterminada; desactívalo para eliminar por completo la señal original y conservar el ajuste de **Dry Level** para más adelante.
- **Dry Level** - Ajusta el nivel de la señal directa de -96 a +12 dB mientras **Dry** está activado. El extremo de -96 dB también silencia la señal original.
- **Pre Delay** - Retrasa solo la señal wet entre 0 y 500 ms para separar el transitorio original de la respuesta de la sala.
- **Direct Cut** - Elimina de la IR el impulso directo detectado, de modo que la captura aporte solo su parte reverberante. La normalización sigue tomando como referencia la IR sin cortar, por lo que activar Direct Cut no aumenta el nivel de la cola reverberante restante.
- **Cut Offset** - Desplaza el punto de corte detectado entre -20 y +50 ms cuando **Direct Cut** está activado.
- **Decay** - Remodela el decaimiento de la IR entre 10% y 400%; 100% conserva el decaimiento grabado, los valores más bajos lo acortan y los más altos lo alargan.
- **Trim** - Conserva entre 1% y 100% de la IR posterior al corte, con un fundido. Los valores más cortos reducen la longitud de la cola, el uso de CPU y la memoria.

### Cómo leer el gráfico de decaimiento

El tiempo avanza de izquierda a derecha y el nivel va de 0 a -90 dB. La curva continua de decaimiento de energía (EDC) muestra cómo cae la energía acústica almacenada; una pendiente más pronunciada indica una cola más corta. La envolvente tenue da contexto sobre los transitorios. Las marcas señalan el inicio detectado, el punto de corte directo activo, el pre-delay wet y el punto de recorte. **RT60** estima el tiempo que tarda el sonido en caer 60 dB; “unavailable” significa que la IR no contenía un tramo fiable para el ajuste. Cuando **Decay** es distinto de 100%, compara la curva continua remodelada con la curva original punteada. Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

### Enrutamiento, biblioteca y uso compartido

Una IR mono puede alimentar los canales seleccionados, los canales independientes de la IR se mantienen separados y una IR True Stereo de cuatro canales usa las rutas cruzadas LL/LR/RL/RR. En Auto, toda IR de cuatro canales con una selección estéreo se interpreta en ese orden; para disposiciones Quad u otras disposiciones de cuatro canales, elige explícitamente Independent o Diagonal Matrix. Los demás archivos multicanal usan una ruta diagonal acotada; IR Reverb no crea una matriz completa de cruce envolvente. Para un par de archivos True Stereo, selecciona juntos los archivos con nombres coincidentes terminados en `L`/`R` o `Left`/`Right`.

Los archivos IR importados se guardan en la **Biblioteca de respuestas al impulso**, donde puedes buscarlos por su nombre original, cargarlos o eliminarlos. Para eliminar varios a la vez, marca sus casillas o usa **Seleccionar todo** para seleccionar todas las entradas que se muestran y elige **Eliminar seleccionadas**. **Ctrl+A** (**Command+A** en macOS) también selecciona todas las entradas visibles; **Deseleccionar todo** borra la selección. Los archivos de audio WAV con extensión `.irs` se pueden importar sin cambiarles el nombre. En la aplicación web, estos archivos se guardan en el navegador y pueden perderse si borras los datos del sitio o el navegador libera espacio. La aplicación de escritorio los guarda con sus datos de aplicación. Conserva una copia aparte de cada IR que necesites.

Las URL compartidas y los presets identifican la IR, pero no incluyen sus datos de audio. Si la IR no está disponible, no se produce sonido wet; vuelve a importarla o seleccionarla, o elige otra. La señal directa sigue los ajustes **Dry** y **Dry Level**.

Para encontrar material de libre acceso, empieza por la [biblioteca OpenAIR](https://www.openair.hosted.york.ac.uk/) de la Universidad de York, las [descargas de EchoThief](https://www.echothief.com/downloads/) o las IR subidas individualmente a [Freesound](https://freesound.org/). “Gratis” no significa sin restricciones: OpenAIR indica la licencia en la página de cada contenido, y los archivos de Freesound pueden ser CC0, CC BY o CC BY-NC. Comprueba la página de descarga concreta, conserva el autor, la fuente y la licencia junto al archivo, atribuye la autoría cuando sea obligatorio y confirma que el uso comercial o la redistribución que pretendes están permitidos. EffeTune no almacena ni verifica la información de licencia.

## RS Reverb

RS Reverb añade reflexiones y una caída ajustables para que una grabación seca suene como si se reprodujera en una sala o un auditorio.

### Guía de Experiencia de Escucha
- Espacio íntimo:
  - Empieza con Room Size 8-12m, Reverb Time 1.0-1.5s y Mix 20-30%
  - Baja Mix si las voces o los ataques de los instrumentos pierden claridad
- Espacio tipo auditorio:
  - Empieza con Room Size 30-40m, Reverb Time 2.0-2.5s y Mix 30-40%
  - Acorta Reverb Time si las notas sucesivas se emborronan
- Caída larga y atmosférica:
  - Empieza con Room Size 25-40m, Reverb Time 3-6s y Mix 40-60%
  - Sube Damping o baja High Damp si la cola suena demasiado brillante

### Presets del sistema

Haz clic en **Preajustes de efecto** en el encabezado del efecto para aplicar una sala o un auditorio completos.

- **Small Room** - Ambiente de sala corto y cercano con 5 ms de pre-delay y una caída de graves más contenida.
- **Jazz Club** - Sala moderada para material acústico íntimo con 15 ms de pre-delay.
- **Concert Hall** - Un espacio más grande y profundo con 25 ms de pre-delay y una caída de graves más plena.
- **Cathedral** - Un espacio largo y oscuro con 40 ms de pre-delay y la caída de graves más plena.

### Parámetros
- **Pre-Delay** (0 a 50 ms) - Retrasa las reflexiones de la señal reverberada antes de que entren en el modelo de sala. Los valores más altos mantienen definido el ataque del sonido original durante más tiempo, pero no eliminan el retardo propio del modelo de sala.
- **Room Size** - Establece qué tan grande se siente el espacio (2.0 a 50.0 m)
  - Pequeño (2-5m): Sensación de habitación acogedora
  - Medio (5-15m): Atmósfera de sala en vivo
  - Grande (15-50m): Grandeza de sala de conciertos
- **Reverb Time** - Cuánto duran los ecos (0.1 a 10.0 s)
  - Corto (0.1-1.0s): Sonido claro y enfocado
  - Medio (1.0-3.0s): Sonido natural de habitación
  - Largo (3.0-10.0s): Espacioso, atmosférico
- **Density** - Qué tan rico se siente el espacio (4 a 8)
  - Valores más bajos: Ecos más definidos
  - Valores más altos: Atmósfera más suave
  - Comienza con 6 para sonido natural
- **Diffusion** - Cómo se extiende el sonido (0.2 a 0.8)
  - Valores más bajos: Ecos más distintos
  - Valores más altos: Mezcla más suave
  - Prueba 0.5 para sonido equilibrado
- **Damping** - Cómo se desvanecen los ecos (0 a 100%)
  - Valores más bajos: Sonido más brillante y abierto
  - Valores más altos: Más cálido e íntimo
  - Comienza alrededor del 40% para sensación natural
- **High Damp** - Controla el brillo del espacio (1000 a 20000 Hz)
  - Valores más bajos: Espacio más oscuro y cálido
  - Valores más altos: Más brillante y abierto
  - Comienza alrededor de 8000Hz para sonido natural
- **Low Damp** - Controla la plenitud del espacio (20 a 500 Hz)
  - Valores más bajos: Sonido más lleno y rico
  - Valores más altos: Más claro y controlado
  - Comienza alrededor de 100Hz para graves equilibrados
- **Mix** - Equilibra el efecto con el sonido original (0 a 100%)
  - 10-30%: Mejora sutil
  - 30-50%: Espacio notable
  - 50-100%: Efecto dramático

### Configuraciones Recomendadas para Diferentes Estilos Musicales

1. Música Clásica en Sala de Conciertos
   - Room Size: 30-40m
   - Reverb Time: 2.0-2.5s
   - Mix: 30-40%
   - Útil para: Obras orquestales, conciertos para piano

2. Club de Jazz Íntimo
   - Room Size: 8-12m
   - Reverb Time: 1.0-1.5s
   - Mix: 20-30%
   - Útil para: Jazz, actuaciones acústicas

3. Pop/Rock Moderno
   - Room Size: 15-20m
   - Reverb Time: 1.2-1.8s
   - Mix: 15-25%
   - Útil para: Música contemporánea

4. Ambiental/Electrónico
   - Room Size: 25-40m
   - Reverb Time: 3.0-6.0s
   - Mix: 40-60%
   - Útil para: Música electrónica atmosférica

### Guía de Inicio Rápido

1. Elige Tu Espacio
   - Comienza con Room Size para establecer el espacio básico
   - Ajusta Reverb Time para la atmósfera deseada
   - Ajusta finamente Mix para equilibrio apropiado

2. Da Forma al Sonido
   - Usa Damping para controlar calidez
   - Ajusta High/Low Damp para tono
   - Establece Density y Diffusion para textura

3. Ajusta Finamente el Efecto
   - Ajusta Mix para equilibrio final
   - Confía en tus oídos y ajusta al gusto

Empieza con un valor bajo de Mix y súbelo hasta que el espacio añadido se perciba con claridad sin ocultar la grabación original.
