---
permalink: "/docs/i18n/es/"
title: "Frieve EffeTune - Procesador de Efectos de Audio en Tiempo Real"
description: "Procesador de efectos de audio en tiempo real para entusiastas del audio. Más de 50 efectos incluyendo EQ, compresor y reverb. Gratis para Windows, macOS, Linux y navegadores web."
lang: es
image: /images/screenshot.png
---

# Frieve EffeTune <img src="../../../images/icon_64x64.png" alt="EffeTune Icon" width="30" height="30" align="bottom">

[Open Web App](https://effetune.frieve.com/effetune.html)  [Download Desktop App](https://github.com/Frieve-A/effetune/releases/)

Un procesador de efectos de audio en tiempo real, diseñado para entusiastas del audio que desean mejorar su experiencia musical. EffeTune te permite procesar cualquier fuente de audio a través de diversos efectos de alta calidad, lo que te posibilita personalizar y perfeccionar tu experiencia auditiva en tiempo real.

[![Screenshot](../../../images/screenshot.png)](https://effetune.frieve.com/effetune.html)

## Concepto

EffeTune ha sido creado para los entusiastas del audio que quieren elevar su experiencia musical. Ya sea que estés transmitiendo música o reproduciéndola desde un medio físico, EffeTune te permite añadir efectos de nivel profesional para personalizar el sonido según tus preferencias exactas. Transforma tu computadora en un potente procesador de efectos de audio que se sitúa entre tu fuente de audio y tus altavoces o amplificador.

Sin mitos audiophiles, solo pura ciencia.

## Características

- Procesamiento de audio en tiempo real
- Interfaz de arrastrar y soltar para construir cadenas de efectos
- Sistema de efectos ampliable con efectos categorizados
- Visualización de audio en vivo
- Cadena de procesamiento de audio que se puede modificar en tiempo real
- Procesamiento de archivos de audio sin conexión con la cadena de efectos actual
- Función de sección para agrupar y controlar múltiples efectos
- Característica de medición de respuesta en frecuencia para equipos de audio
- Procesamiento y salida multicanal

## Guía de Configuración

Antes de usar EffeTune, deberás configurar el enrutamiento de audio. Aquí se explica cómo configurar diferentes fuentes de audio:

### Configuración del Reproductor de Archivos de Música

- Abre la aplicación web EffeTune en tu navegador, o inicia la aplicación de escritorio EffeTune
- Abre y reproduce un archivo de música para asegurar una reproducción adecuada
   - Abre un archivo de música y selecciona EffeTune como la aplicación (solo aplicación de escritorio)
   - O selecciona Abrir archivo de música... desde el menú Archivo (solo aplicación de escritorio)
   - O arrastra el archivo de música a la ventana

### Configuración para Servicios de Streaming

Para procesar audio de servicios de streaming (Spotify, YouTube Music, etc.):

1. Requisitos:
   - Instala un dispositivo de audio virtual (por ejemplo, VB Cable, Voice Meeter o ASIO Link Tool)
   - Configura tu servicio de streaming para enviar el audio al dispositivo de audio virtual

2. Configuración:
   - Abre la aplicación web EffeTune en tu navegador, o inicia la aplicación de escritorio EffeTune
   - Selecciona el dispositivo de audio virtual como fuente de entrada
     - En Chrome, la primera vez que lo abras, aparecerá un cuadro de diálogo pidiéndote que selecciones y permitas la entrada de audio
     - En la aplicación de escritorio, configúralo haciendo clic en el botón Config Audio en la esquina superior derecha de la pantalla
   - Comienza a reproducir música desde tu servicio de streaming
   - Verifica que el audio esté fluyendo a través de EffeTune
   - Para instrucciones de configuración más detalladas, consulta la [FAQ](faq.md)

### Configuración para Fuentes de Audio Físicas

Para usar EffeTune con reproductores de CD, reproductores de red u otras fuentes físicas:

- Conecta tu interfaz de audio a tu computadora
- Abre la aplicación web EffeTune en tu navegador, o inicia la aplicación de escritorio EffeTune
- Selecciona tu interfaz de audio como fuente de entrada y salida
   - En Chrome, la primera vez que lo abras, aparecerá un cuadro de diálogo pidiéndote que selecciones y permitas la entrada de audio
   - En la aplicación de escritorio, configúralo haciendo clic en el botón Config Audio en la esquina superior derecha de la pantalla
- Tu interfaz de audio ahora funciona como un procesador de múltiples efectos:
   * **Entrada:** Tu reproductor de CD, reproductor de red u otra fuente de audio
   * **Procesamiento:** Efectos en tiempo real a través de EffeTune
   * **Salida:** Audio procesado hacia tu amplificador o altavoces

## Uso

### Creando tu Cadena de Efectos

1. Los **Available Effects** se encuentran listados en el lado izquierdo de la pantalla  
   - Utiliza el botón de búsqueda al lado de **Available Effects** para filtrar los efectos  
   - Escribe cualquier texto para encontrar efectos por nombre o categoría  
   - Presiona ESC para limpiar la búsqueda
2. Arrastra los efectos desde la lista hasta el área de **Effect Pipeline**
3. Los efectos se procesan en orden de arriba a abajo
4. Arrastra el manejador (⋮) o pulsa los botones ▲▼ para reordenar los efectos
   - Para efectos Section: Shift+clic en los botones ▲▼ para mover secciones completas (de una Section a la siguiente Section, inicio de pipeline, o final de pipeline)
5. Haz clic en el nombre de un efecto para expandir o colapsar sus ajustes
   - Shift+clic en un efecto Section para colapsar/expandir todos los efectos dentro de esa sección
   - Shift+clic en otros efectos para colapsar/expandir todos los efectos excepto la categoría Analizador
   - Ctrl+clic para colapsar/expandir todos los efectos
6. Utiliza el botón **ON** para omitir efectos individuales
7. Haz clic en el botón **?** para abrir su documentación detallada en una nueva pestaña
8. Elimina efectos utilizando el botón ×
   - Para efectos Section: Shift+clic en el botón × para eliminar secciones completas
9. Haga clic en el botón de enrutamiento para configurar los canales que se procesarán y los buses de entrada y salida  
   - [Más información sobre las funciones de los buses](bus-function.md)

### Uso de Presets

1. Guarda tu cadena de efectos:
   - Configura la cadena de efectos y los parámetros deseados
   - Ingresa un nombre para tu preset en el campo de entrada
   - Haz clic en el botón de guardar para almacenar tu preset

2. Cargar un Preset:
   - Escribe o selecciona un nombre de preset de la lista desplegable
   - El preset se cargará automáticamente
   - Se restaurarán todos los efectos y sus configuraciones

3. Eliminar un Preset:
   - Selecciona el preset que deseas eliminar
   - Haz clic en el botón de eliminar
   - Confirma la eliminación cuando se te solicite

4. Información del Preset:
   - Cada preset almacena la configuración completa de tu cadena de efectos
   - Incluye el orden de los efectos, los parámetros y los estados

### Usando Secciones

1. Uso del Efecto de Sección:
   - Añade un efecto de Sección al principio de un grupo de efectos
   - Ingresa un nombre descriptivo en el campo de comentario
   - Alternar el efecto de Sección ON/OFF activará/desactivará todos los efectos dentro de esa sección
   - Usa múltiples efectos de Sección para organizar tu cadena de efectos en grupos lógicos
   - [Más sobre efectos de control](plugins/control.md)

### Usando Funciones de Pipeline AB

1. Resumen de Pipeline AB:
   - EffeTune puede mantener dos pipelines de efectos separados: Pipeline A y Pipeline B
   - Al inicio, solo se carga el Pipeline A; el Pipeline B se crea cuando es necesario
   - Todas las operaciones de procesamiento, guardado, carga y edición funcionan en el pipeline seleccionado actualmente

2. Botón de Alternancia AB:
   - Ubicado a la derecha del encabezado de Effect Pipeline
   - Muestra "A" por defecto (Pipeline A activo)
   - Haz clic para alternar entre Pipeline A y Pipeline B
   - Si el Pipeline B no existe al alternar, la configuración del Pipeline A se copia al Pipeline B

3. Menú AB (Botón Desplegable):
   - Ubicado a la derecha del botón de alternancia AB
   - "A → B": Copia la configuración del Pipeline A al Pipeline B y cambia al Pipeline B
   - "B → A": Copia la configuración del Pipeline B al Pipeline A y cambia al Pipeline A

### Selección de Efectos y Atajos de Teclado

1. Métodos de Selección de Efectos:
   - Haz clic en los encabezados de los efectos para seleccionar efectos individuales
   - Mantén presionada la tecla Ctrl mientras haces clic para seleccionar múltiples efectos
   - Haz clic en un espacio vacío en el área de Pipeline para deseleccionar todos los efectos

2. Atajos de Teclado:
   - Ctrl + Z: Deshacer
   - Ctrl + Y: Rehacer
   - Ctrl + S: Guardar el pipeline actual
   - Ctrl + Shift + S: Guardar el pipeline actual como
   - Ctrl + X: Cortar los efectos seleccionados
   - Ctrl + C: Copiar los efectos seleccionados
   - Ctrl + V: Pegar los efectos desde el portapapeles
   - Ctrl + F: Buscar efectos
   - Ctrl + A: Seleccionar todos los efectos en el pipeline
   - Delete: Eliminar los efectos seleccionados
   - ESC: Deseleccionar todos los efectos
   - T: Alternar entre Pipeline A y Pipeline B
   - A: Cambiar al Pipeline A
   - B: Cambiar al Pipeline B

3. Atajos de teclado (al usar el reproductor):
   - Espacio: Reproducir/Pausar
   - Ctrl + → o N: Siguiente pista
   - Ctrl + ← o P: Pista anterior
   - Shift + → o F o .: Avanzar 10 segundos
   - Shift + ← o R o ,: Retroceder 10 segundos
   - Ctrl + M: Alternar modo repetición
   - Ctrl + H: Alternar modo aleatorio
   - T: Alternar entre Pipeline A y Pipeline B
   - A: Cambiar al Pipeline A
   - B: Cambiar al Pipeline B

### Procesamiento de Archivos de Audio

1. Área de Arrastre o Especificación de Archivos:
   - Un área de arrastre dedicada siempre es visible debajo de la **Effect Pipeline**
   - Soporta uno o múltiples archivos de audio
   - Los archivos se procesan utilizando la configuración actual de la pipeline
   - Todo el procesamiento se realiza a la tasa de muestreo de la pipeline

2. Estado del Procesamiento:
   - La barra de progreso muestra el estado actual del procesamiento
   - El tiempo de procesamiento depende del tamaño del archivo y la complejidad de la cadena de efectos

3. Opciones de Descarga o Guardado:
   - El archivo procesado se genera en formato WAV
   - Los múltiples archivos se empaquetan automáticamente en un archivo ZIP

### Medición de Respuesta en Frecuencia

1. Para la versión web, inicie la [herramienta de medición de respuesta en frecuencia](https://effetune.frieve.com/features/measurement/measurement.html). Para la versión de la aplicación, seleccione «Medición de respuesta en frecuencia» en el menú Ajustes
2. Conecta tu equipo de audio a la entrada y salida de tu ordenador
3. Configura los parámetros de medición (duración del barrido, rango de frecuencias)
4. Ejecuta la medición para generar un gráfico de respuesta en frecuencia
5. Analiza los resultados o exporta los datos de medición para un análisis más detallado

### Compartir Cadenas de Efectos

Puedes compartir la configuración de tu cadena de efectos con otros usuarios:
1. Después de configurar la cadena de efectos deseada, haz clic en el botón **Share** en la esquina superior derecha del área de **Effect Pipeline**
2. La URL de la aplicación web se copiará automáticamente en tu portapapeles
3. Comparte la URL copiada con otros: podrán recrear exactamente tu cadena de efectos al abrirla
4. En la aplicación web, todos los ajustes de los efectos se almacenan en la URL, facilitando su guardado y compartición
5. En la versión de aplicación de escritorio, exporta la configuración a un archivo effetune_preset desde el menú Archivo
6. Comparte el archivo effetune_preset exportado. El archivo effetune_preset también puede cargarse arrastrándolo a la ventana de la aplicación web

### Reinicio de Audio

Si experimentas problemas de audio (interrupciones, fallos):
1. Haz clic en el botón **Reset Audio** en la esquina superior izquierda en la aplicación web o selecciona Reload desde el menú View en la aplicación de escritorio
2. La pipeline de audio se reconstruirá automáticamente
3. La configuración de tu cadena de efectos se conservará

## Combinaciones Comunes de Efectos

Aquí hay algunas combinaciones populares de efectos para mejorar tu experiencia de escucha:

### Mejora para Auriculares
1. **Stereo Blend** -> **RS Reverb**
   - **Stereo Blend:** Ajusta la anchura estéreo para mayor comodidad (60-100%)
   - **RS Reverb:** Añade una sutil ambientación de sala (mezcla 10-20%)
   - **Resultado:** Escucha con auriculares más natural y menos fatigante

### Simulación de Vinilo
1. **Wow Flutter** -> **Noise Blender** -> **Saturation**
   - **Wow Flutter:** Añade una suave variación de tono
   - **Noise Blender:** Crea una atmósfera similar a la de un vinilo
   - **Saturation:** Añade calidez analógica
   - **Resultado:** Experiencia auténtica de un disco de vinilo

### Estilo de Radio FM
1. **Multiband Compressor** -> **Stereo Blend**
   - **Multiband Compressor:** Crea ese sonido de "radio"
   - **Stereo Blend:** Ajusta la anchura estéreo para mayor comodidad (100-150%)
   - **Resultado:** Sonido profesional similar a una transmisión

### Carácter Lo-Fi
1. **Bit Crusher** -> **Simple Jitter** -> **RS Reverb**
   - **Bit Crusher:** Reduce la profundidad de bits para una sensación retro
   - **Simple Jitter:** Añade imperfecciones digitales
   - **RS Reverb:** Crea un espacio atmosférico
   - **Resultado:** Estética clásica lo-fi

## Resolución de Problemas y Preguntas Frecuentes

Si tienes algún inconveniente, consulta la [FAQ](faq.md).
Si el problema persiste, repórtalo a través de [GitHub Issues](https://github.com/Frieve-A/effetune/issues).

## Efectos Disponibles

| Categoría | Efecto             | Descripción                                                               | Documentación                                           |
| --------- | ------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| Analyzer  | Level Meter        | Muestra el nivel de audio con retención de pico                           | [Detalles](plugins/analyzer.md#level-meter)             |
| Analyzer  | Oscilloscope       | Visualización de la forma de onda en tiempo real                          | [Detalles](plugins/analyzer.md#oscilloscope)            |
| Analyzer  | Spectrogram        | Muestra los cambios del espectro de frecuencias a lo largo del tiempo     | [Detalles](plugins/analyzer.md#spectrogram)             |
| Analyzer  | Spectrum Analyzer  | Análisis de espectro en tiempo real                                       | [Detalles](plugins/analyzer.md#spectrum-analyzer)       |
| Analyzer  | Stereo Meter       | Visualiza el equilibrio estéreo y el movimiento del sonido                | [Detalles](plugins/analyzer.md#stereo-meter)            |
| Basics    | Channel Divider    | Divide la señal estéreo en bandas de frecuencia y la enruta a canales separados | [Detalles](plugins/basics.md#channel-divider)      |
| Basics    | DC Offset          | Ajuste de desplazamiento de corriente continua                             | [Detalles](plugins/basics.md#dc-offset)                 |
| Basics    | Matrix             | Enruta y mezcla canales de audio con control flexible                      | [Detalles](plugins/basics.md#matrix)                    |
| Basics    | MultiChannel Panel | Panel de control para múltiples canales con volumen, silencio, solo y retardo | [Detalles](plugins/basics.md#multichannel-panel)      |
| Basics    | Mute               | Silencia completamente la señal de audio                                  | [Detalles](plugins/basics.md#mute)                      |
| Basics    | Polarity Inversion | Inversión de polaridad de la señal                                        | [Detalles](plugins/basics.md#polarity-inversion)        |
| Basics    | Stereo Balance     | Control de balance de canales estéreo                                     | [Detalles](plugins/basics.md#stereo-balance)            |
| Basics    | Volume             | Control básico de volumen                                                 | [Detalles](plugins/basics.md#volume)                    |
| Delay     | Delay          | Efecto de retardo estándar | [Detalles](plugins/delay.md#delay) |
| Delay     | Time Alignment | Ajustes de sincronización de precisión para canales de audio | [Detalles](plugins/delay.md#time-alignment) |
| Dynamics  | Auto Leveler | Ajuste automático de volumen basado en medición LUFS para una experiencia de escucha uniforme | [Detalles](plugins/dynamics.md#auto-leveler) |
| Dynamics  | Brickwall Limiter | Control de picos transparente para una escucha segura y cómoda | [Detalles](plugins/dynamics.md#brickwall-limiter) |
| Dynamics  | Compressor | Compresión de rango dinámico con control de umbral, relación y curvatura | [Detalles](plugins/dynamics.md#compressor) |
| Dynamics  | Gate | Puerta de ruido con control de umbral, relación y curvatura para reducción de ruido | [Detalles](plugins/dynamics.md#gate) |
| Dynamics  | Multiband Compressor | Procesador dinámico profesional de 5 bandas con modelado de sonido al estilo radio FM | [Detalles](plugins/dynamics.md#multiband-compressor) |
| Dynamics  | Multiband Expander | Expansor profesional de 5 bandas para expansión de rango dinámico específico por frecuencia | [Detalles](plugins/dynamics.md#multiband-expander) |
| Dynamics  | Multiband Transient | Modelador de transitorios avanzado de 3 bandas para control específico de frecuencia en ataque y sustain | [Detalles](plugins/dynamics.md#multiband-transient) |
| Dynamics  | Power Amp Sag | Simula la caída de voltaje del amplificador de potencia bajo condiciones de alta carga | [Detalles](plugins/dynamics.md#power-amp-sag) |
| Dynamics  | Transient Shaper | Controla las partes transitorias y de sostenimiento de la señal | [Detalles](plugins/dynamics.md#transient-shaper) |
| EQ        | 15Band GEQ | Ecualizador gráfico de 15 bandas | [Detalles](plugins/eq.md#15band-geq) |
| EQ        | 15Band PEQ | Ecualizador paramétrico profesional con 15 bandas totalmente configurables | [Detalles](plugins/eq.md#15band-peq) |
| EQ        | 5Band Dynamic EQ | Ecualizador dinámico de 5 bandas con ajuste de frecuencia basado en umbral | [Detalles](plugins/eq.md#5band-dynamic-eq) |
| EQ        | 5Band PEQ | Ecualizador paramétrico profesional con 5 bandas totalmente configurables | [Detalles](plugins/eq.md#5band-peq) |
| EQ        | Band Pass Filter | Enfócate en frecuencias específicas | [Detalles](plugins/eq.md#band-pass-filter) |
| EQ        | Comb Filter | Filtro peine digital para coloración armónica y simulación de resonancia | [Detalles](plugins/eq.md#comb-filter) |
| EQ        | Hi Pass Filter | Elimina con precisión las frecuencias bajas no deseadas | [Detalles](plugins/eq.md#hi-pass-filter) |
| EQ        | Lo Pass Filter | Elimina con precisión las frecuencias altas no deseadas | [Detalles](plugins/eq.md#lo-pass-filter) |
| EQ        | Loudness Equalizer | Corrección del equilibrio de frecuencias para escucha a bajo volumen | [Detalles](plugins/eq.md#loudness-equalizer) |
| EQ        | Narrow Range | Combinación de filtros pasaaltos y pasabajos | [Detalles](plugins/eq.md#narrow-range) |
| EQ        | Tilt EQ      | Ecualizador de inclinación para modelado rápido del tono | [Detalles](plugins/eq.md#tilt-eq)      |
| EQ        | Tone Control | Control de tono de tres bandas | [Detalles](plugins/eq.md#tone-control) |
| Lo-Fi     | Bit Crusher | Reducción de profundidad de bits y efecto de retención de orden cero | [Detalles](plugins/lofi.md#bit-crusher) |
| Lo-Fi     | Digital Error Emulator | Simula varios errores de transmisión de audio digital y características de equipos digitales vintage | [Detalles](plugins/lofi.md#digital-error-emulator) |
| Lo-Fi     | Hum Generator | Generador de ruido de zumbido de alta precisión | [Detalles](plugins/lofi.md#hum-generator) |
| Lo-Fi     | Noise Blender | Generación y mezcla de ruido | [Detalles](plugins/lofi.md#noise-blender) |
| Lo-Fi     | Simple Jitter | Simulación de jitter digital | [Detalles](plugins/lofi.md#simple-jitter) |
| Lo-Fi     | Vinyl Artifacts | Simulación física de ruido de discos analógicos | [Detalles](plugins/lofi.md#vinyl-artifacts) |
| Modulation | Doppler Distortion | Simula cambios dinámicos y naturales en el sonido causados por movimientos sutiles del cono del altavoz | [Detalles](plugins/modulation.md#doppler-distortion) |
| Modulation | Pitch Shifter | Efecto de cambio de tono ligero | [Detalles](plugins/modulation.md#pitch-shifter) |
| Modulation | Tremolo | Efecto de modulación basado en volumen | [Detalles](plugins/modulation.md#tremolo) |
| Modulation | Wow Flutter | Efecto de modulación basado en tiempo | [Detalles](plugins/modulation.md#wow-flutter) |
| Resonator | Horn Resonator | Simulación de resonancia de bocina con dimensiones personalizables | [Detalles](plugins/resonator.md#horn-resonator) |
| Resonator | Horn Resonator Plus | Modelo de bocina mejorado con reflexiones avanzadas | [Detalles](plugins/resonator.md#horn-resonator-plus) |
| Resonator | Modal Resonator | Efecto de resonancia de frecuencia con hasta 5 resonadores | [Detalles](plugins/resonator.md#modal-resonator) |
| Reverb    | Dattorro Plate Reverb | Reverb de placa clásico basado en el algoritmo Dattorro | [Detalles](plugins/reverb.md#dattorro-plate-reverb) |
| Reverb    | FDN Reverb | Reverberación de red de retardo con retroalimentación que produce texturas de reverb ricas y densas | [Detalles](plugins/reverb.md#fdn-reverb) |
| Reverb    | RS Reverb | Reverberación de dispersión aleatoria con difusión natural | [Detalles](plugins/reverb.md#rs-reverb) |
| Saturation| Dynamic Saturation | Simula el desplazamiento no lineal de conos de altavoz | [Detalles](plugins/saturation.md#dynamic-saturation) |
| Saturation| Exciter | Añade contenido armónico para mejorar la claridad y presencia | [Detalles](plugins/saturation.md#exciter) |
| Saturation| Hard Clipping | Efecto de recorte duro digital | [Detalles](plugins/saturation.md#hard-clipping) |
| Saturation | Harmonic Distortion | Añade carácter único mediante distorsión armónica con control independiente de cada armónico | [Detalles](plugins/saturation.md#harmonic-distortion) |
| Saturation| Multiband Saturation | Efecto de saturación de 3 bandas para un calentamiento preciso según frecuencia | [Detalles](plugins/saturation.md#multiband-saturation) |
| Saturation| Saturation | Efecto de saturación | [Detalles](plugins/saturation.md#saturation) |
| Saturation| Sub Synth | Mezcla señales subarmónicas para realce de graves | [Detalles](plugins/saturation.md#sub-synth) |
| Spatial   | Crossfeed Filter | Filtro de alimentación cruzada para auriculares para imagen estéreo natural | [Detalles](plugins/spatial.md#crossfeed-filter) |
| Spatial   | MS Matrix | Codificación y decodificación mid-side para manipulación estéreo | [Detalles](plugins/spatial.md#ms-matrix) |
| Spatial   | Multiband Balance | Control de balance estéreo dependiente de frecuencia de 5 bandas | [Detalles](plugins/spatial.md#multiband-balance) |
| Spatial   | Stereo Blend | Efecto de control de anchura estéreo | [Detalles](plugins/spatial.md#stereo-blend) |
| Others    | Oscillator | Generador de señal de audio multiforma de onda | [Detalles](plugins/others.md#oscillator) |
| Control   | Section | Agrupa múltiples efectos para control unificado | [Detalles](plugins/control.md) |

## Información Técnica

### Compatibilidad del Navegador

Frieve EffeTune ha sido probado y se ha verificado que funciona en Google Chrome. La aplicación requiere un navegador moderno con soporte para:
- Web Audio API
- Audio Worklet
- getUserMedia API
- Drag and Drop API

### Detalles de Soporte del Navegador
1. **Chrome/Chromium**
   - Totalmente soportado y recomendado
   - Actualiza a la última versión para un mejor rendimiento

2. **Firefox/Safari**
   - Soporte limitado
   - Algunas funciones pueden no funcionar como se espera
   - Considera usar Chrome para una mejor experiencia

### Tasa de Muestreo Recomendada

Para un rendimiento óptimo con efectos no lineales, se recomienda usar EffeTune a una tasa de muestreo de 96kHz o superior. Esta tasa de muestreo más alta ayuda a lograr características ideales al procesar audio a través de efectos no lineales como la saturación y la compresión.

## Guía de Desarrollo

¿Quieres crear tus propios plugins de audio? Consulta nuestra [Plugin Development Guide](../../plugin-development.md).
¿Quieres construir una aplicación de escritorio? Consulta nuestra [Guía de Construcción](../../build.md).

## Enlaces

[Version History](../../version-history.md)

[Source Code](https://github.com/Frieve-A/effetune)

[YouTube](https://www.youtube.com/@frieveamusic)

[Discord](https://discord.gg/gf95v3Gza2)
