---
title: "Plugins de reverb - EffeTune"
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

Una implementación clásica de reverb de placa basada en el renombrado algoritmo de Jon Dattorro del artículo de 1997 "Effect Design, Part 1: Reverberator and Other Filters." Este algoritmo es celebrado por su calidad de sonido exuberante y suave y se ha convertido en un estándar de referencia en el diseño de reverb digital. Perfecto para añadir ambiente rico y brillante a tu música.

Nota de enrutamiento: Dattorro Plate Reverb es un modelo de placa estéreo. Cuando se enruta con más de dos canales, todos los canales de entrada enrutados alimentan una placa mono a estéreo compartida, pero la mezcla wet/dry se escribe solo en el primer par estéreo enrutado. Los canales adicionales contribuyen a la entrada de la placa y pasan sin cambios, incluso con Dry Mix en 0%; no reciben retorno wet y no son tanques de placa independientes.

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

### Parámetros
- **Pre Delay** - Silencio inicial antes de que comience el reverb (control de 0.0 a 100.0 ms; usa valores por debajo de 100.0 ms para un pre-delay efectivo)
  - 0-10ms: Reverb inmediata, sensación íntima
  - 10-30ms: Sensación natural de espacio
  - 30-99.9ms: Crea impresión de espacios más grandes
  - Evita exactamente 100.0ms cuando quieras el pre-delay máximo; la implementación actual trata ese extremo como si no hubiera pre-delay efectivo
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
   - Perfecto para: Piano solo, música de cámara

2. Voces y Acústico
   - Decay: 0.4-0.5
   - Damping: 0.002
   - Pre Delay: 15-25ms
   - Wet Mix: 20-30%
   - Perfecto para: Voces, guitarra acústica

3. Ambiente y Atmosférico
   - Decay: 0.8-0.95
   - Mod Depth: 4.0-8.0
   - Mod Rate: 0.5-1.0Hz
   - Wet Mix: 50-70%
   - Perfecto para: Ambient, electrónica, paisajes sonoros

4. Mejora General
   - Decay: 0.5
   - Damping: 0.0005
   - Mod Depth: 1.0
   - Wet Mix: 20-30%
   - Perfecto para: Uso general, pulido sutil

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

## FDN Reverb

Un efecto de reverb sofisticado basado en la arquitectura de Red de Retardo de Retroalimentación (FDN) usando una matriz de difusión Hadamard. Esto crea una reverberación rica y compleja con excelente densidad y características de decaimiento natural, perfecta para mejorar tu experiencia de escucha musical con efectos espaciales inmersivos.

Nota de enrutamiento: FDN Reverb es un modelo de reverb estéreo con un feedback tank compartido. Cuando se enruta con más de dos canales, cada canal avanza ese tank compartido en secuencia en lugar de usar tanks independientes por canal. El canal 1 recibe left wet y los canales 2+ reciben right wet.

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
  - 100-200Hz: Graves controlados para evitar confusión
  - 300-500Hz: Graves ajustados y claros
- **Mod Depth** - Cantidad de modulación de tono para efecto chorus (0.0 a 10.0 centavos)
  - 0.0: Sin modulación, reverb estática pura
  - 2.0-5.0: Movimiento sutil que añade vida y realismo
  - 10.0: Efecto chorus-like notable
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
   - Perfecto para: Grabaciones orquestales, música de cámara

2. Atmósfera de Club de Jazz
   - Reverb Time: 1.2-1.8s
   - Density: 6 líneas
   - Pre Delay: 15-25ms
   - HF Damp: 2.0-4.0
   - Perfecto para: Jazz acústico, actuaciones íntimas

3. Mejora Pop/Rock
   - Reverb Time: 1.0-2.0s
   - Density: 6-7 líneas
   - Pre Delay: 10-30ms
   - Wet Mix: 20-40%
   - Perfecto para: Grabaciones modernas, añadir espacio

4. Paisajes Sonoros Ambientales
   - Reverb Time: 4.0-8.0s
   - Density: 8 líneas
   - Mod Depth: 3.0-6.0
   - Wet Mix: 60-80%
   - Perfecto para: Música atmosférica, relajación

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
   - Establece Mod Depth a 2-4 centavos para vida sutil
   - Usa Mod Rate alrededor de 0.3-1.0 Hz para variación suave
   - Ajusta Stereo Width para impresión espacial

4. Equilibrar el Efecto
   - Comienza con 30% Wet Mix
   - Mantén Dry Mix al 100% para escucha normal
   - Ajusta finamente basado en tu música y preferencias

FDN Reverb transforma tu experiencia de escucha añadiendo espacios acústicos realistas a cualquier grabación. Es útil para quienes quieren realzar sus pistas favoritas con una reverberación bella y natural.

## IR Reverb

IR Reverb convoluciona la señal con una respuesta al impulso (IR) importada para reproducir el decaimiento y el carácter espacial medidos de una sala, un auditorio, una placa u otro sistema acústico. Resulta útil cuando buscas el sonido repetible de una captura concreta.

### Guía de mejora del sonido

- Para añadir una sala discreta, usa una IR corta, ajusta **Dry** a 0 dB, **Wet** entre -18 y -12 dB y añade un **Pre Delay** breve.
- Para ampliar la sensación de auditorio, usa una IR estéreo o True Stereo y acorta una cola excesiva con **Decay** y **Trim**.
- Para envío/retorno, copia las fuentes a otro bus con **Matrix**, ajusta **Dry** a -96 dB, deja **Wet** a 0 dB y controla la reverberación con el nivel de envío.
- Para reproducir el resultado, conserva el archivo IR original y sus datos de fuente y licencia: los mismos bytes generan el mismo ID.

### Parámetros

- **Channel Mode**: Auto, Mono, Independent, True Stereo (rutas LL/LR/RL/RR) o Diagonal Matrix sin cruce entre canales.
- **Latency**: Zero o 128/256/512/1024 muestras. Los valores altos reducen la presión de proceso pero retrasan la señal wet; Zero requiere Full.
- **Convolution Rate**: Auto, Full, Half o Quarter. Las tasas reducidas disminuyen la carga y el ancho de banda wet; Quarter requiere al menos 176,4 kHz.
- **Dry**: regula el nivel de la señal original. A -96 dB la silencia por completo para un efecto totalmente wet o un retorno.
- **Wet**: nivel de la señal convolucionada, de -96 a +12 dB. El valor predeterminado es -15 dB para un uso normal como inserto; en una configuración de envío/retorno, ajústalo a 0 dB y controla la cantidad de reverberación con el nivel de envío.
- **Pre Delay**: retrasa solo la señal wet entre 0 y 500 ms.
- **Direct Cut** elimina el impulso directo detectado; **Cut Offset** desplaza el corte entre -20 y +50 ms. La normalización sigue tomando como referencia la IR sin cortar, por lo que activar Direct Cut no aumenta el nivel de la cola de reverberación restante.
- **Decay** remodela el decaimiento entre 10% y 400%; 100% conserva la captura.
- **Trim** conserva entre 1% y 100% de la IR posterior al corte; una cola corta usa menos CPU y memoria.

### Cómo leer el gráfico de decaimiento

El tiempo avanza de izquierda a derecha y el nivel va de 0 a -90 dB. La curva EDC continua muestra la pérdida de energía; una pendiente mayor indica una cola más corta. Las marcas señalan onset, cut, pre-delay y trim. RT60 estima el tiempo de caída de 60 dB. Al cambiar **Decay**, la curva nueva es continua y la original aparece punteada.

### Enrutamiento, biblioteca y uso compartido

Mono aplica una IR, Independent mantiene canales separados, True Stereo usa LL/LR/RL/RR y Diagonal Matrix conecta solo entradas y salidas equivalentes. Para un par True Stereo, selecciona juntos archivos coincidentes terminados en `L`/`R` o `Left`/`Right`.

Los originales se guardan en **Impulse Response Library**. La web usa OPFS privado del sitio y la aplicación de escritorio su almacenamiento administrado. La biblioteca muestra los nombres de archivo originales y permite buscarlos, cargar entradas o eliminarlas. Un cambio de frecuencia de muestreo vuelve a preparar la IR desde el original. Conserva además una copia propia, pues borrar los datos del sitio o la presión de almacenamiento puede eliminar datos del navegador.

Las URL y los presets solo contienen el ID, no el audio IR ni el nombre del archivo. El destinatario debe importar el mismo archivo o elegir un sustituto. Sin IR no hay señal wet; sin WASM solo pasa la señal dry configurada. Puedes buscar material en [OpenAIR](https://www.openair.hosted.york.ac.uk/), [EchoThief](https://www.echothief.com/downloads/) y [Freesound](https://freesound.org/), pero comprueba la licencia de cada descarga (por ejemplo CC0, CC BY o CC BY-NC) y conserva autor, fuente, atribución y permiso comercial fuera de EffeTune, que no almacena ni verifica la información de licencia.

## RS Reverb

Un efecto que puede transportar tu música a diferentes espacios, desde habitaciones acogedoras hasta salas majestuosas. Añade ecos y reflexiones naturales que hacen que tu música se sienta más tridimensional e inmersiva.

### Guía de Experiencia de Escucha
- Espacio Íntimo:
  - Hace que la música se sienta como en una habitación cálida y acogedora
  - Perfecto para escucha cercana y personal
  - Añade profundidad sutil sin perder claridad
- Experiencia de Sala de Conciertos:
  - Recrea la grandeza de actuaciones en vivo
  - Añade espacio majestuoso a música clásica y orquestal
  - Crea una experiencia de concierto inmersiva
- Mejora Atmosférica:
  - Añade cualidades oníricas y etéreas
  - Perfecto para música ambiental y atmosférica
  - Crea paisajes sonoros cautivadores

### Parámetros
- **Pre-Delay** - Control almacenado y mostrado (0 a 50 ms)
  - En la implementación actual, este valor no se usa en el procesamiento de la reverb
  - Cambiarlo no altera la distancia ni la profundidad; usa Room Size, Reverb Time y Mix para cambios espaciales audibles
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
   - Perfecto para: Obras orquestales, conciertos para piano

2. Club de Jazz Íntimo
   - Room Size: 8-12m
   - Reverb Time: 1.0-1.5s
   - Mix: 20-30%
   - Perfecto para: Jazz, actuaciones acústicas

3. Pop/Rock Moderno
   - Room Size: 15-20m
   - Reverb Time: 1.2-1.8s
   - Mix: 15-25%
   - Perfecto para: Música contemporánea

4. Ambiental/Electrónico
   - Room Size: 25-40m
   - Reverb Time: 3.0-6.0s
   - Mix: 40-60%
   - Perfecto para: Música electrónica atmosférica

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
   - Usa Room Size y Reverb Time para la profundidad; el valor del control Pre-Delay no se refleja actualmente en el procesamiento
   - Ajusta Mix para equilibrio final
   - Confía en tus oídos y ajusta al gusto

¡Recuerda: El objetivo es mejorar tu música con espacio y atmósfera naturales. Comienza con configuraciones sutiles y ajusta hasta encontrar el equilibrio perfecto para tu experiencia de escucha!
