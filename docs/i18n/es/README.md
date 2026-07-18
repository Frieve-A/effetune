# Frieve EffeTune <img src="../../../images/icon_64x64.png" alt="EffeTune Icon" width="30" height="30" align="bottom">

<div class="doc-primary-actions" aria-label="Acciones principales">
  <a class="button button-primary" href="https://effetune.frieve.com/effetune.html">Abrir aplicación web</a>
  <install class="button button-secondary"><a href="https://effetune.frieve.com/effetune.html">Instalar versión PWA</a></install>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune/releases/">Descargar aplicación de escritorio</a>
</div>

Un procesador de efectos de audio en tiempo real, diseñado para entusiastas del audio que desean mejorar su experiencia musical. EffeTune te permite procesar cualquier fuente de audio a través de diversos efectos de alta calidad, lo que te posibilita personalizar y perfeccionar tu experiencia auditiva en tiempo real.

[![Screenshot](../../../images/screenshot.png)](https://effetune.frieve.com/effetune.html)

## Video de introducción

[![YouTube Video](../../../images/video_thumbnail.jpg)](https://www.youtube.com/watch?v=--mtsy1t4HI)

## Concepto

EffeTune ha sido creado para los entusiastas del audio que quieren elevar su experiencia musical. Ya sea que escuches música en streaming o desde un medio físico, EffeTune te permite añadir efectos de alta calidad para ajustar el sonido a tu gusto. Transforma tu computadora en un potente procesador de efectos de audio que se sitúa entre tu fuente de audio y tus altavoces o amplificador.

Sin mitos audiophiles, solo pura ciencia.

## Características

- Procesamiento de audio en tiempo real
- Interfaz de arrastrar y soltar para construir cadenas de efectos
- Sistema de efectos ampliable con efectos categorizados
- Visualización de audio en vivo
- Cadena de procesamiento de audio que se puede modificar en tiempo real
- Procesamiento de archivos de audio sin conexión con la cadena de efectos actual
- Exploración de subcarpetas locales, metadatos y listas de reproducción con la Biblioteca musical
- Medición y corrección de respuesta en frecuencia para calibración del sistema
- Procesamiento y salida multicanal
- Ahorro de energía en las versiones Web/PWA y de escritorio, con gestión configurable del silencio y de la retención de la entrada de audio

## Guía de Configuración

Antes de usar EffeTune, deberás configurar el enrutamiento de audio. Aquí se explica cómo configurar diferentes fuentes de audio:

### Configuración del Reproductor de Archivos de Música

- Abre la aplicación web EffeTune en tu navegador, o inicia la aplicación de escritorio EffeTune
- Abre y reproduce un archivo de música para asegurar una reproducción adecuada
   - Abre un archivo de música y selecciona EffeTune como la aplicación (solo aplicación de escritorio)
   - O selecciona **Abrir archivo de música...** desde el menú **Archivo** (solo aplicación de escritorio)
   - O arrastra el archivo de música a la ventana
- Para usar solo el reproductor, selecciona Ninguno (solo reproductor de archivos de música) como dispositivo de entrada en Configuración de audio y evita usar una entrada de audio en vivo

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

### Configuración de la aplicación

En el menú **Configuración**, abre **Configuración...** para elegir el idioma, la vista al inicio y el comportamiento del pipeline de efectos al iniciar. La vista al inicio puede ser **Effect Pipeline (predeterminado)** o **Biblioteca musical**. Si eliges **Biblioteca musical**, usa la lista de al lado para elegir qué sección aparecerá primero: **Pistas**, **Álbumes**, **Artistas**, **Géneros** o **Subcarpetas**.

### Buscar música en la Biblioteca musical

1. En PC, ábrela con el botón **Biblioteca musical** del encabezado; en móvil, con la pestaña **Biblioteca**; en la aplicación de escritorio, desde **Ver > Biblioteca musical**.
2. Selecciona **Añadir carpeta de música** e indexa la carpeta que contiene tus archivos de música. Si una hoja CUE externa y los archivos WAV o FLAC a los que hace referencia están en la misma carpeta, al añadir esa carpeta a la Biblioteca musical, el álbum queda dividido en pistas individuales.
3. Explora por **Pistas**, **Álbumes**, **Artistas**, **Géneros**, **Subcarpetas**, **Carpetas**, **Añadidas recientemente** y **Listas de reproducción**, y usa **Buscar en la biblioteca** para buscar en todo el catálogo. La sección **Subcarpetas** agrupa las pistas por la ruta que las contiene dentro de cada carpeta de música indexada, mientras que la sección **Carpetas** gestiona esas carpetas raíz.
4. Las pistas que encuentres pueden reproducirse a través del pipeline de efectos actual, y puedes gestionar el orden de reproducción y las listas de reproducción con **Reproducir a continuación**, **Añadir a la cola** y **Añadir a lista**.
5. Después de cambiar archivos, usa **Volver a escanear**; si caducan los permisos del navegador o de una carpeta, usa **Reconectar**.
   - [Más detalles sobre la Biblioteca musical](music-library.md)

Tanto en el diseño para PC como en el móvil, si una búsqueda de pistas o los detalles de un álbum, artista, género, subcarpeta o lista de reproducción devuelven 300 pistas o menos, todas se seleccionan de forma predeterminada. Con 301 pistas o más no hay selección automática. En móvil, la selección automática solo cambia el estado de selección. Solo mantener pulsada una pista abre el modo de selección y muestra las casillas, **Seleccionar todo** y **Deseleccionar todo**; seleccionar o deseleccionar pistas no abre ni cierra ese modo, y las acciones habituales de cada fila siguen disponibles.

Los navegadores Chromium de PC pueden conservar los identificadores de carpeta de File System Access. Safari, Firefox, los navegadores móviles y otros entornos sin esa API solo conservan los objetos `File` durante la sesión actual de la página. Después de cada recarga, vuelve a seleccionar la carpeta o los archivos; EffeTune los enlaza con el catálogo existente mediante la ruta relativa normalizada.

La versión 2.1.0 de EffeTune incorpora una Biblioteca musical basada en el esquema de catálogo v3 que permite explorar álbumes CUE pista por pista. El estado de la Biblioteca musical anterior no se transfiere: vuelve a añadir y analizar tus carpetas de música, y vuelve a crear o importar las listas de reproducción de la Biblioteca musical. El catálogo anterior y los archivos de audio no se modifican. El catálogo está diseñado para paginar colecciones grandes desde el disco. Las mediciones de rendimiento a gran escala son diagnósticos locales y opcionales para el desarrollo: no son requisitos para commits, versiones, `verify` ni GitHub Actions, y tampoco constituyen una garantía general de rendimiento.

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
   - Al cambiar el ON/OFF de Section, se omite o se restaura toda esa sección sin cambiar el estado ON/OFF propio de cada efecto
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

3. Menú AB (botón desplegable):
   - Ubicado a la derecha del botón de alternancia AB
   - "A → B": Copia la configuración del Pipeline A al Pipeline B y cambia al Pipeline B
   - "B → A": Copia la configuración del Pipeline B al Pipeline A y cambia al Pipeline A

4. Double Blind Test:
   - Compara Pipeline A y Pipeline B de oído sin saber cuál se está reproduciendo
   - Ejecuta un ABX Test para comprobar si realmente puedes distinguir los dos pipelines, o un A/B Preference Test para saber cuál prefieres, con una comprobación de significación estadística
   - Ábrelo desde el menú de pipeline **▼** situado a la derecha del botón de alternancia AB (también disponible desde el menú **Archivo** en la aplicación de escritorio)
   - [Más información sobre Double Blind Test](double-blind-test.md)

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
   - Para múltiples archivos, seleccione una carpeta de salida antes de procesar; cada archivo se guarda directamente en esa carpeta al completarse
   - En navegadores más antiguos sin soporte de selección de carpeta, los archivos múltiples se empaquetan en un ZIP para descargar

### Compartir Cadenas de Efectos

Puedes compartir la configuración de tu cadena de efectos con otros usuarios:
1. Después de configurar la cadena de efectos deseada, haz clic en el botón **Share** en la esquina superior derecha del área de **Effect Pipeline**
2. La URL de la aplicación web se copiará automáticamente en tu portapapeles
3. Comparte la URL copiada con otros: podrán recrear exactamente tu cadena de efectos al abrirla
4. En la aplicación web, todos los ajustes de los efectos se almacenan en la URL, facilitando su guardado y compartición
5. En la versión de aplicación de escritorio, exporta la configuración a un archivo effetune_preset desde el menú **Archivo**
6. Comparte el archivo effetune_preset exportado. El archivo effetune_preset también puede cargarse arrastrándolo a la ventana de la aplicación web

### Reinicio de Audio

Si experimentas problemas de audio (interrupciones, fallos):
1. Haz clic en el botón **Reset Audio** en la esquina superior izquierda de la aplicación web o selecciona **Recargar** desde el menú **Ver** en la aplicación de escritorio
2. La pipeline de audio se reconstruirá automáticamente
3. La configuración de tu cadena de efectos se conservará

### Medición y Corrección de Respuesta en Frecuencia

Para medir la respuesta en frecuencia de tu sistema de audio y crear una corrección EQ plana:
1. En la versión web, abre la [herramienta de medición de respuesta en frecuencia](https://effetune.frieve.com/features/measurement/measurement.html). En la versión de escritorio, selecciona **Medición de respuesta en frecuencia** desde el menú **Configuración**.
2. Sigue la guía para configurar el micrófono de medición y el dispositivo de salida
3. Mide la respuesta en frecuencia de tu sistema en una o varias posiciones de escucha
4. Genera una corrección de EQ paramétrico que se puede importar directamente en EffeTune
5. Aplica la corrección para lograr una reproducción más precisa y neutral

## Combinaciones Comunes de Efectos

Aquí hay algunas combinaciones populares de efectos para mejorar tu experiencia de escucha:

### Mejora para Auriculares
1. **Stereo Blend** -> **RS Reverb**
   - **Stereo Blend:** Ajusta la anchura estéreo para mayor comodidad (60-100%)
   - **RS Reverb:** Añade una sutil ambientación de sala (mix 10-20%)
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
   - **Resultado:** Sonido pulido al estilo radio FM

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
| Analyzer  | Spectrum Analyzer  | Muestra en tiempo real la intensidad de graves, medios y agudos           | [Detalles](plugins/analyzer.md#spectrum-analyzer)       |
| Analyzer  | Stereo Meter       | Visualiza el equilibrio estéreo y la correlación entre canales            | [Detalles](plugins/analyzer.md#stereo-meter)            |
| Basics    | Channel Divider    | Divide la señal estéreo en bandas de frecuencia y enruta cada banda a pares de salida estéreo separados | [Detalles](plugins/basics.md#channel-divider)      |
| Basics    | DC Offset          | Ajuste de desplazamiento de corriente continua                             | [Detalles](plugins/basics.md#dc-offset)                 |
| Basics    | Matrix             | Enruta y mezcla canales de audio con control flexible                      | [Detalles](plugins/basics.md#matrix)                    |
| Basics    | MultiChannel Panel | Panel de control para múltiples canales con volumen, silencio, solo y retardo | [Detalles](plugins/basics.md#multichannel-panel)      |
| Basics    | Mute               | Silencia completamente la señal de audio                                  | [Detalles](plugins/basics.md#mute)                      |
| Basics    | Polarity Inversion | Inversión de polaridad de la señal                                        | [Detalles](plugins/basics.md#polarity-inversion)        |
| Basics    | Stereo Balance     | Control de balance de canales estéreo                                     | [Detalles](plugins/basics.md#stereo-balance)            |
| Basics    | Volume             | Control básico de volumen                                                 | [Detalles](plugins/basics.md#volume)                    |
| Delay     | Delay          | Efecto de retardo estándar | [Detalles](plugins/delay.md#delay) |
| Delay     | Time Alignment | Ajusta con precisión el tiempo de reproducción para alinear altavoces y posición de escucha | [Detalles](plugins/delay.md#time-alignment) |
| Dynamics  | Auto Leveler | Ajuste automático de volumen basado en medición LUFS para una experiencia de escucha uniforme | [Detalles](plugins/dynamics.md#auto-leveler) |
| Dynamics  | Brickwall Limiter | Control de picos transparente para una escucha segura y cómoda | [Detalles](plugins/dynamics.md#brickwall-limiter) |
| Dynamics  | Compressor | Suaviza los pasajes que se vuelven fuertes de golpe para una escucha más cómoda | [Detalles](plugins/dynamics.md#compressor) |
| Dynamics  | Expander | Recupera contraste dinámico haciendo más silenciosos los sonidos bajos por debajo del umbral | [Detalles](plugins/dynamics.md#expander) |
| Dynamics  | Gate | Reduce sonidos de bajo nivel durante pausas o secciones tranquilas | [Detalles](plugins/dynamics.md#gate) |
| Dynamics  | Multiband Compressor | Balance de volumen de 5 bandas para un sonido estable tipo radio | [Detalles](plugins/dynamics.md#multiband-compressor) |
| Dynamics  | Multiband Expander | Expansor de 5 bandas para devolver contraste natural a grabaciones demasiado planas | [Detalles](plugins/dynamics.md#multiband-expander) |
| Dynamics  | Multiband Transient | Moldea ataque y sustain por separado en graves, medios y agudos | [Detalles](plugins/dynamics.md#multiband-transient) |
| Dynamics  | Power Amp Sag | Simula la caída de voltaje del amplificador de potencia bajo condiciones de alta carga | [Detalles](plugins/dynamics.md#power-amp-sag) |
| Dynamics  | Transient Shaper | Ajusta el golpe y el cuerpo de la música moldeando ataques y sustain | [Detalles](plugins/dynamics.md#transient-shaper) |
| EQ        | 15Band GEQ | Ecualizador gráfico de 15 bandas | [Detalles](plugins/eq.md#15band-geq) |
| EQ        | 15Band PEQ | Ecualizador paramétrico de 15 bandas para ajustes detallados del tono de escucha | [Detalles](plugins/eq.md#15band-peq) |
| EQ        | 5Band Dynamic EQ | Ecualizador dinámico de 5 bandas con ajuste de frecuencia basado en umbral | [Detalles](plugins/eq.md#5band-dynamic-eq) |
| EQ        | 5Band PEQ | Ecualizador flexible de 5 bandas para moldear graves, medios y agudos | [Detalles](plugins/eq.md#5band-peq) |
| EQ        | Band Pass Filter | Enfócate en frecuencias específicas | [Detalles](plugins/eq.md#band-pass-filter) |
| EQ        | Comb Filter | Añade una coloración faseada, hueca o metálica | [Detalles](plugins/eq.md#comb-filter) |
| EQ        | Earphone Cable Sim | Ayuda a comprobar lo pequeñas que suelen ser las variaciones de respuesta en frecuencia causadas por cables de auriculares normales | [Detalles](plugins/eq.md#earphone-cable-sim) |
| EQ        | Hi Pass Filter | Elimina con precisión las frecuencias bajas no deseadas | [Detalles](plugins/eq.md#hi-pass-filter) |
| EQ        | Lo Pass Filter | Elimina con precisión las frecuencias altas no deseadas | [Detalles](plugins/eq.md#lo-pass-filter) |
| EQ        | Loudness Equalizer | Corrección del equilibrio de frecuencias para escucha a bajo volumen | [Detalles](plugins/eq.md#loudness-equalizer) |
| EQ        | Narrow Range | Combinación de filtros pasaaltos y pasabajos | [Detalles](plugins/eq.md#narrow-range) |
| EQ        | Tilt EQ      | Ecualizador de inclinación para modelado rápido del tono | [Detalles](plugins/eq.md#tilt-eq)      |
| EQ        | Tone Control | Control de tono de tres bandas | [Detalles](plugins/eq.md#tone-control) |
| Lo-Fi     | Bit Crusher | Reducción de profundidad de bits y efecto de retención de orden cero | [Detalles](plugins/lofi.md#bit-crusher) |
| Lo-Fi     | Digital Error Emulator | Simula varios errores de transmisión de audio digital y características de equipos digitales vintage | [Detalles](plugins/lofi.md#digital-error-emulator) |
| Lo-Fi     | DSD64 IMD Simulator | Simula la distorsión por intermodulación audible que genera el ruido ultrasónico del DSD64 | [Detalles](plugins/lofi.md#dsd64-imd-simulator) |
| Lo-Fi     | Hum Generator | Añade una atmósfera ajustable de zumbido eléctrico de 50/60 Hz para escucha vintage/lo-fi | [Detalles](plugins/lofi.md#hum-generator) |
| Lo-Fi     | Noise Blender | Añade una textura de ruido de fondo ajustable para ambiente lo-fi | [Detalles](plugins/lofi.md#noise-blender) |
| Lo-Fi     | Simple Jitter | Simulación de jitter digital | [Detalles](plugins/lofi.md#simple-jitter) |
| Lo-Fi     | Vinyl Artifacts | Añade pops, crackle, hiss, rumble y fuga de ruido estéreo al estilo vinilo | [Detalles](plugins/lofi.md#vinyl-artifacts) |
| Lo-Fi     | Vinyl Simulator | Graba la entrada en un surco modelado y la reproduce con una aguja física simulada | [Detalles](plugins/lofi.md#vinyl-simulator) |
| Modulation | Doppler Distortion | Simula cambios dinámicos y naturales en el sonido causados por movimientos sutiles del cono del altavoz | [Detalles](plugins/modulation.md#doppler-distortion) |
| Modulation | Pitch Shifter | Sube o baja el tono de la música sin cambiar el tempo | [Detalles](plugins/modulation.md#pitch-shifter) |
| Modulation | Tremolo | Efecto de modulación basado en volumen | [Detalles](plugins/modulation.md#tremolo) |
| Modulation | Wow Flutter | Añade una sutil fluctuación de tono tipo cinta o disco para carácter vintage | [Detalles](plugins/modulation.md#wow-flutter) |
| Resonator | Horn Resonator | Simulación de resonancia de bocina con dimensiones personalizables | [Detalles](plugins/resonator.md#horn-resonator) |
| Resonator | Horn Resonator Plus | Resonancia de bocina más suave para una coloración natural en la escucha | [Detalles](plugins/resonator.md#horn-resonator-plus) |
| Resonator | Modal Resonator | Efecto de resonancia de frecuencia con hasta 5 resonadores | [Detalles](plugins/resonator.md#modal-resonator) |
| Reverb    | Dattorro Plate Reverb | Reverb de placa clásico basado en el algoritmo Dattorro | [Detalles](plugins/reverb.md#dattorro-plate-reverb) |
| Reverb    | FDN Reverb | Reverberación de red de retardo con retroalimentación que produce texturas de reverb ricas y densas | [Detalles](plugins/reverb.md#fdn-reverb) |
| Reverb    | RS Reverb | Reverberación de dispersión aleatoria con difusión natural | [Detalles](plugins/reverb.md#rs-reverb) |
| Saturation| Dynamic Saturation | Simula el desplazamiento no lineal de conos de altavoz | [Detalles](plugins/saturation.md#dynamic-saturation) |
| Saturation| Exciter | Añade contenido armónico para mejorar la claridad y presencia | [Detalles](plugins/saturation.md#exciter) |
| Saturation| Hard Clipping | Efecto de recorte duro digital | [Detalles](plugins/saturation.md#hard-clipping) |
| Saturation | Harmonic Distortion | Añade carácter con distorsión armónica ajustable de 2.º a 5.º orden | [Detalles](plugins/saturation.md#harmonic-distortion) |
| Saturation| Multiband Saturation | Añade calidez o filo por separado a graves, medios y agudos | [Detalles](plugins/saturation.md#multiband-saturation) |
| Saturation| Saturation | Añade riqueza y carácter cálidos de estilo analógico | [Detalles](plugins/saturation.md#saturation) |
| Saturation| Sub Synth | Mezcla una señal de baja frecuencia filtrada para reforzar los graves | [Detalles](plugins/saturation.md#sub-synth) |
| Spatial   | Crossfeed Filter | Filtro de alimentación cruzada para auriculares para imagen estéreo natural | [Detalles](plugins/spatial.md#crossfeed-filter) |
| Spatial   | MS Matrix | Convierte entre estéreo y Mid/Side para ajustar centro y ambiente | [Detalles](plugins/spatial.md#ms-matrix) |
| Spatial   | Multiband Balance | Control de balance estéreo dependiente de frecuencia de 5 bandas | [Detalles](plugins/spatial.md#multiband-balance) |
| Spatial   | Stereo Blend | Controla la anchura estéreo desde polaridad lateral invertida, pasando por mono, hasta estéreo ampliado | [Detalles](plugins/spatial.md#stereo-blend) |
| Others    | Oscillator | Generador de tonos de prueba y ruido para comprobar altavoces/auriculares | [Detalles](plugins/others.md#oscillator) |
| Control   | Section | Agrupa efectos para poder omitir o restaurar una sección completa | [Detalles](plugins/control.md) |

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

¿Quieres crear tus propios plugins de audio? Consulta nuestra [guía de desarrollo de plugins](../../plugin-development.md).
¿Quieres construir una aplicación de escritorio? Consulta nuestra [Guía de Construcción](../../../BUILD.md).

## Enlaces

[Historial de versiones](../../version-history.md)

[Código fuente](https://github.com/Frieve-A/effetune)

[YouTube](https://www.youtube.com/@frieveamusic)

[Discord](https://discord.gg/gf95v3Gza2)

[Apóyanos en Ko-fi](https://ko-fi.com/frievea)
