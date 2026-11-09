---
title: "Otros plugins - Generador de tonos de prueba y ruido, SoundFont Note Player, SoundFont Player - EffeTune"
description: "Oscillator genera tonos de prueba y ruido blanco o rosa para comprobar altavoces y auriculares; SoundFont Note Player reproduce con un instrumento SF2/SF3/SFZ las notas detectadas. SoundFont Player reproduce canciones MIDI con SoundFonts SF2/SF3 o instrumentos SFZ."
lang: es
---

# Otras herramientas de audio

Una colección de herramientas de audio especializadas y generadores que complementan las categorías principales de efectos. Estos plugins son útiles para comprobar altavoces, auriculares, balance de canales y comportamiento de reproducción antes o durante la escucha.

## Lista de Plugins

- [Oscillator](#oscillator) - Generador de tonos y ruido de prueba para comprobar altavoces y auriculares
- [SoundFont Note Player](#sfz-note-player) - Reproduce las notas detectadas con SoundFonts SF2/SF3 e instrumentos SFZ
- [SoundFont Player](#soundfont-player) - Reproduce MIDI con SoundFonts SF2/SF3 e instrumentos SFZ

## Oscillator

Un generador de tonos y ruido de prueba para comprobar tu sistema de escucha. Úsalo a niveles bajos para confirmar la salida de altavoces o auriculares, la posición izquierda/derecha, el balance de nivel, vibraciones, zumbidos o problemas sencillos de respuesta en frecuencia.

El tono o ruido generado se mezcla en la ruta de audio actual en lugar de sustituir la entrada. Baja Volume antes de activarlo, sobre todo si ya se está reproduciendo música.

### Características
- Múltiples tipos de forma de onda:
  - Onda sinusoidal pura para comprobaciones de tono sencillas
  - Onda cuadrada para contenido armónico rico
  - Onda triangular para armónicos más suaves
  - Onda de sierra para timbres brillantes
  - Impulsos periódicos de una muestra para comprobar la respuesta al impulso y la temporización
  - Ruido blanco para comprobaciones de banda ancha en altavoces o auriculares
  - Ruido rosa para un balance de ruido más suave y natural
- Modo de operación pulsado para tonos intermitentes o ráfagas de ruido

### Parámetros
- **Frequency (Hz)** - Controla el tono de la señal generada (20 Hz a 96 kHz)
  - Frecuencias bajas: Tonos graves profundos
  - Frecuencias medias: Rango musical
  - Frecuencias altas: Úsalas con cuidado y solo a niveles de escucha seguros
  - Se aplica solo a Sine, Square, Triangle y Sawtooth; está desactivado para Impulse, White Noise y Pink Noise
  - La salida de alta frecuencia disponible depende de la frecuencia de muestreo de audio actual; los tonos por encima de la frecuencia de Nyquist utilizable se silencian
- **Volume (dB)** - Ajusta el nivel de salida (-96 dB a 0 dB)
  - Empieza bajo y sube lentamente
  - Los valores altos pueden sonar fuertes o cansar el oído
- **Panning (L/R)** - Controla la ubicación estéreo
  - Centro: Igual en ambos canales
  - Izquierda/Derecha: Comprobación de enrutamiento y balance de canales
- **Waveform Type** - Selecciona el tipo de señal
  - Sine: Tono de referencia limpio
  - Square: Rico en armónicos impares
  - Triangle: Contenido armónico más suave
  - Sawtooth: Serie armónica completa
  - Impulse: Una muestra a amplitud máxima en cada Interval, según la frecuencia de muestreo actual; Frequency no le afecta
  - White Noise: Energía igual por Hz; Frequency no le afecta
  - Pink Noise: Energía igual por octava; Frequency no le afecta
- **Mode** - Controla el patrón de generación de señal
  - Continuous: Generación de señal continua sin interrupciones
  - Pulsed: Señal intermitente con temporización controlable
  - Impulse siempre usa Pulsed; Continuous queda desactivado
- **Interval (ms)** - Tiempo entre ráfagas de pulsos en modo pulsado (100-2000 ms, paso 10 ms)
  - Intervalos cortos: Secuencias de pulsos rápidas
  - Intervalos largos: Pulsos ampliamente espaciados
  - Activo cuando Mode está establecido en Pulsed, incluido Impulse
- **Width (ms)** - Tiempo de rampa del pulso en modo pulsado (2-100 ms, limitado a la mitad de Interval, paso 1 ms)
  - Controla el tiempo de entrada/salida gradual de cada pulso
  - El pulso generado dura aproximadamente el doble de Width, sin una sección sostenida plana
  - Anchuras cortas: Bordes de pulso nítidos
  - Anchuras largas: Transiciones de pulso más suaves
  - Solo activo cuando Mode está establecido en Pulsed; se desactiva para Impulse porque cada impulso dura exactamente una muestra

### Ejemplos de Uso

1. Comprobación de altavoces o auriculares
   - Comprobar la reproducción básica de frecuencias
     * Usar barrido de onda sinusoidal de frecuencias bajas a altas
     * Notar dónde el sonido se vuelve inaudible o distorsionado
   - Escuchar vibraciones, zumbidos o resonancias ásperas
     * Usar primero un Volume bajo
     * Probar un rango de frecuencias cada vez
   - Comparar la salida izquierda y derecha
     * Poner Panning totalmente a la izquierda y a la derecha
     * Confirmar que cada lado suena desde el altavoz o driver esperado

2. Balance de canales y nivel
   - Comprobar la posición estéreo
     * Usar una onda sinusoidal centrada o ruido rosa
     * Confirmar que el sonido aparece centrado
   - Comparar el volumen izquierdo y derecho
     * Enviar la señal a cada lado con el mismo Volume
     * Ajustar tu sistema de reproducción si un lado parece más fuerte
   - Comprobar cadenas de plugins
     * Colocar Oscillator antes o después de otros efectos para oír cómo la cadena trata una señal sencilla

3. Comprobaciones rápidas de resonancia de sala o escritorio
   - Encontrar acumulaciones de graves o vibraciones evidentes
     * Usar tonos sinusoidales graves a niveles seguros
     * Moverse alrededor de la posición de escucha y notar picos o caídas fuertes
   - Comprobar objetos propensos a vibrar
     * Barrer lentamente por frecuencias graves y medio-graves
     * Reducir Volume de inmediato si algo vibra con fuerza

4. Comprobaciones de balance con ruido
   - Usar Pink Noise como referencia amplia y estable
     * Escuchar desequilibrios evidentes entre izquierda/derecha o de tono
     * Mantener el nivel cómodo y evitar ruido fuerte durante mucho tiempo
   - Usar White Noise solo cuando necesites una señal de banda ancha más brillante

5. Comprobaciones de señal pulsada
   - Usar el modo Pulsed para que las ráfagas cortas sean más fáciles de identificar
     * Los intervalos más largos hacen que cada ráfaga se oiga por separado con más claridad
     * Los valores de Width más cortos crean comienzos y finales más definidos
     * Comparar el comportamiento a diferentes niveles de volumen

6. Comprobaciones de respuesta al impulso y temporización
   - Selecciona Impulse para generar transitorios de una muestra con el Interval configurado
     * Usa un Interval más largo para separar las reflexiones o las colas de los efectos
     * Graba la salida para analizar la respuesta al impulso de un sistema o una cadena de plugins
     * Empieza con un Volume bajo porque el impulso tiene un pico brusco y contenido de banda ancha

Recuerda: Oscillator es un generador de señales de prueba. Empieza con Volume bajo, súbelo gradualmente y evita tonos fuertes o de alta frecuencia que puedan dañar el equipo o fatigar el oído.

## SoundFont Note Player

<a id="sfz-note-player"></a>

SoundFont Note Player detecta las notas del audio de entrada y las reproduce con un instrumento SF2/SF3/SFZ importado. Usa un SFZ de piano para seguir las notas de una canción, o superpón otro instrumento a la grabación original. La estimación polifónica de notas es una herramienta para escuchar y superponer, no una transcripción exacta; en las mezclas densas puede omitir notas o activar otras de más.

### Guía de mejora del sonido

- **Importar y cargar un instrumento**: Abre **SoundFont Library…**, usa **Importar archivos…** para importar un archivo `.sf2` / `.sf3`, haz clic en **Cargar** y elige un sonido con **Preset**. Para SFZ, usa **Importar carpeta…** para añadir la definición junto con sus muestras (o la carpeta completa de un banco ARIA con `.bank.xml`, `Programs` y `Samples`). La aplicación de escritorio lee los archivos originales en su ubicación; la aplicación web guarda los instrumentos importados en tu dispositivo. Si usas **Importar archivos…** para SFZ, incluye todas las muestras y los demás archivos necesarios. No se pueden eliminar los instrumentos en uso.
- **Escuchar y mezclar**: Empieza con **Dry: 0%** y **Wet: 100%** para oír solo el instrumento SFZ; después sube **Dry** para volver a mezclar la pista original. Ajusta **Timing** (−100 a +100 ms) para que los ataques de las notas SFZ coincidan con la grabación original (con 0 ms, la señal original se retrasa para acompasarse con la detección de notas: unos 90 ms en Classic y unos 230 ms en Event).
- **Acotar el rango de notas y las voces**: Sube **Threshold** para activar solo las notas con mayor confianza, estrecha **Lowest Note** y **Highest Note**, o activa solo **Lowest** (línea de bajo) o **Highest** (melodía superior) para seguir una sola línea musical. Que una línea de color aparezca en Note Spectrogram no garantiza que suene, porque **Threshold** y el rango de notas siguen aplicándose.
- **Dar forma al timbre y a la octava**: Usa **Octave** (−2 a +2) para doblar una línea una octava más grave o más aguda, y **Sample Shift** (−6 a +6 semitonos) para tocar las asignaciones de muestras vecinas reajustadas a la altura de la nota detectada, con un timbre más oscuro o más brillante.

### Parámetros

- **SoundFont** - Abre **SoundFont Library…** para importar, buscar, ordenar, cargar o eliminar instrumentos (**Clear** descarga el instrumento actual sin eliminarlo de la biblioteca).
- **Preset** - En una colección SF2/SF3, elige el sonido de las notas detectadas. **Default** usa el primer preset reproducible. Este control se oculta para instrumentos SFZ.
- **Detection**:
  - **Classic (Low Latency)** (predeterminado): Detector de menor latencia (retardo de alineación de unos 90 ms) que usa **Threshold** y **Retrigger Drop**.
  - **Event (+140 ms)**: Usa el mismo detector de ataques y eventos que Note Spectrogram (retardo de alineación de unos 230 ms y mayor uso de CPU; **Threshold** y **Retrigger Drop** se desactivan). Cuando un Note Spectrogram activado situado antes en la cadena analiza la misma entrada con el mismo rango de notas y el audio entre ambos no cambia, se comparte su análisis para reducir la carga si **Onsets**, el color **Instrument** o **Highlight** está activado en Note Spectrogram. En caso contrario, SoundFont Note Player realiza su propio análisis.
- **Color** - **Normal** (color del gráfico del tema) o **Note Colors** (colores por clase de altura, iguales a los de Note Spectrogram).
- **Threshold** (0,01 a 1; predeterminado: 0,75) - Umbral de confianza de la detección en el modo Classic.
- **Retrigger Drop (dB)** (1 a 96 dB; predeterminado: 40 dB) - Caída de nivel necesaria antes de volver a activar las notas sostenidas por encima de B5 en el modo Classic; después, el nivel debe volver a subir al menos 6 dB. Los valores altos reducen las repeticiones no deseadas durante las notas sostenidas; los bajos siguen con más facilidad los golpes repetidos de la misma nota. En B5 y por debajo, los ataques detectados activan notas nuevas directamente.
- **Note Hold (ms)** (0 a 100 ms; predeterminado: 50 ms) - Une las interrupciones breves de la detección antes de soltar una nota.
- **Velocity 1 Level / Velocity 127 Level (dB)** (-96 a 0 dB / -60 a +24 dB; predeterminados: -60 dB / -10 dB) - Rango de nivel de entrada que se asigna a las velocidades MIDI 1–127. Al bajarlos, la misma entrada produce velocidades más fuertes.
- **Lowest Note / Highest Note** (A0 a C8; predeterminados: E1 a G6) - Rango de detección de alturas.
- **Highest / Middle / Lowest** - Filtra qué notas detectadas simultáneamente se reproducen (línea superior, voces interiores o línea de bajo; todas activadas de forma predeterminada).
- **Octave** (-2 a +2; predeterminado: 0) - Transpone en octavas completas las notas SFZ que se activan a partir de ese momento.
- **Sample Shift** (-6 a +6 semitonos; predeterminado: 0) - Desplaza la región de muestra que se elige y compensa su afinación para conservar la altura de la nota objetivo. Los valores positivos reproducen más despacio muestras de notas más agudas (con +1, un C4 detectado usa la muestra de C#4 a la altura de C4); los negativos reproducen más rápido muestras de notas más graves.
- **Max Voices** (1 a 128; predeterminado: 32) - Número máximo de voces de muestras simultáneas (incluidas las colas de liberación). Los valores altos conservan más notas superpuestas, pero consumen más procesamiento.
- **Dry (%)** / **Wet (%)** (0 a 100%; predeterminados: 20% / 100%) - Niveles independientes del audio original alineado en latencia y del instrumento SFZ.
- **Timing (ms)** (-100 a +100 ms; predeterminado: 0 ms) - Ajuste fino de la alineación temporal entre el audio original y el instrumento SFZ. Los valores negativos retrasan aún más el audio original; los positivos retrasan el instrumento.
- **Output Gain (dB)** (-60 a +12 dB; predeterminado: 0 dB) - Ajuste final del nivel de salida.

### Instrument Details

Abre **Instrument Details**, debajo de los controles principales, para consultar las etiquetas del instrumento SFZ: teclas, controladores MIDI (**CC**), salidas, grupos, capas y teclas de cambio de articulación. Las etiquetas describen las asignaciones del instrumento; no son controles adicionales. Cuando hay una articulación con nombre activa, **Keyswitch** muestra la seleccionada en cada canal. También aparece la imagen incluida por el instrumento; si se declaran varias, se muestra la última.

### Visualización de la reproducción y notas

- **Teclado interactivo y barras de velocidad**: El teclado abarca de **Lowest Note** a **Highest Note** e ilumina las notas que suenan, incluidas las colas de liberación. Las teclas iluminadas siguen a **Octave**; **Sample Shift** cambia el timbre sin moverlas. Cada barra empieza en la velocidad con que suena la nota (1–127) y baja con el tiempo, incluso después de que la nota termine; **Color** cambia sus colores sin reiniciar la caída. **Voices / Max Voices** cuenta las voces de muestras, incluidas las liberaciones.
- **Audición**: Haz clic o arrastra sobre el teclado o la zona de velocidad para tocar directamente el instrumento SFZ cargado. El teclado suena con velocidad 100; en la zona de velocidad, la velocidad depende de la altura a la que introduces la nota. La audición reproduce la altura mostrada, sin tener en cuenta **Octave**, aunque **Sample Shift** sigue aplicándose.
- **Límite de memoria**: El presupuesto para instrumentos y caché de muestras es de **256 MiB**, ampliable hasta **1024 MiB** con **Límite de tamaño de SoundFont** en **Ajustes > Configuración... > General**. Los archivos leídos por partes pueden ser mayores. Si este límite impide la carga, auméntalo o elige un instrumento más pequeño.
- **Funciones SFZ compatibles**: SoundFont Note Player utiliza los ataques de las notas detectadas. Las capas dependientes de controladores y los cambios de articulación usan los ajustes iniciales del instrumento; no siguen los eventos de la canción MIDI. Para canciones MIDI y controles que cambian durante la ejecución, usa SoundFont Player. Si un instrumento usa ajustes no compatibles o le faltan muestras necesarias, no se puede cargar. Comprueba sus archivos o elige otro instrumento.
- **Compartir y copias de seguridad**: Los presets, los enlaces compartidos y las copias de seguridad de los datos del usuario guardan una referencia al instrumento, no sus muestras de audio; conserva tus carpetas SFZ originales para usarlas en otros dispositivos.

## SoundFont Player

Reproduce canciones MIDI con una colección SoundFont SF2/SF3 o un instrumento SFZ y ajusta el sonido con los efectos posteriores. El audio entrante pasa sin cambios y el instrumento se suma en este punto de la cadena.

### Primeros pasos

Abre un archivo `.mid`, añade SoundFont Player y abre **SoundFont Library…**. Importa un archivo `.sf2` / `.sf3` o un instrumento `.sfz` con sus muestras y pulsa **Cargar**. La aplicación de escritorio lee los archivos originales; la versión web guarda los archivos importados en tu dispositivo. Empieza con **Instrument Level** a 0 dB y bájalo si el resultado suena demasiado fuerte.

SF3 (.sf3) utiliza muestras comprimidas; se importa y se eligen sus sonidos del mismo modo que con SF2. Para reproducir SF3, el navegador debe admitir la decodificación Vorbis. Si no es compatible, elige un SoundFont SF2 o usa otro navegador compatible.

**SoundFont Library…** permite importar, buscar, cargar y eliminar instrumentos. **Clear** quita el instrumento cargado sin eliminarlo de la biblioteca. No se pueden eliminar instrumentos en uso. Si cambias de instrumento durante una canción, el tiempo MIDI sigue avanzando mientras se prepara el nuevo. Cuando está listo, reproduce los eventos MIDI posteriores con los ajustes actuales de los controladores; no vuelve a tocar las notas anteriores.

### MIDI Mixer

La pestaña **MIDI Mixer** tiene una fila por cada uno de los 16 canales MIDI. Una colección SF2/SF3 puede ofrecer un sonido distinto para cada canal; los mensajes Bank Select y Program Change eligen los sonidos, y el canal 10 usa el banco de percusión de forma predeterminada. Los mensajes de asignación de percusión GS/XG pueden asignar otros canales a la percusión o devolverlos a sonidos melódicos. Program Change selecciona un kit disponible en el SoundFont cargado. Un instrumento SFZ utiliza sus propias asignaciones.

Antes de recibir un mensaje Program Change, los canales melódicos usan el programa 1 del banco 0 y el canal 10 usa el kit de batería estándar, si esos sonidos están disponibles. Si falta el sonido solicitado en el SF2/SF3, los canales melódicos prueban el mismo programa en el banco 0 y después el programa 1 de ese banco; los canales de percusión prueban el kit estándar. **Patch** muestra el sonido que se utiliza realmente. Si no existe ninguno de esos sonidos, o **Automatic Fallback** está desactivado, el canal no sonará.

- **Patch** selecciona por su nombre un sonido de la colección SF2/SF3 cargada para ese canal. Las notas nuevas usan el sonido seleccionado; las que ya están sonando conservan el anterior.
- **Notes** ilumina las teclas de cada canal desde Note On hasta Note Off. La tecla se apaga con Note Off aunque el pedal de sustain o la cola de la nota mantengan el sonido. **Voices** muestra el número real de voces de muestra que siguen sonando, incluidas sus colas, frente al límite **Max Voices**. Una nota puede usar varias voces de muestra.
- Arrastra el ratón, el dedo o un lápiz óptico por las teclas de un canal para tocar el instrumento cargado con la altura de la tecla bajo el puntero, usando el **Patch** y los ajustes del mezclador actuales de ese canal. Pasar a otra tecla o soltar equivale a un Note Off de MIDI: la nota anterior se apaga con la fase de liberación (release) propia del instrumento, por lo que las notas con una liberación lenta se superponen. Funciona con independencia de la canción y de la entrada MIDI, por lo que suena por encima de una canción en reproducción. Un canal con **Mute** activado permanece en silencio, y solo responden las filas con controles del mezclador activos.
- **Vol.** (CC7, 0–127) ajusta el nivel del canal. **EXP** (expresión, CC11, 0–127) es un control de nivel adicional. Los valores más altos aumentan el volumen; poner cualquiera de los dos a 0 silencia el canal.
- **Pan** (CC10, 0–127) desplaza el sonido de izquierda a derecha, con 64 en el centro.
- **Rev.** (CC91) y **Cho.** (CC93) ajustan los envíos a efectos de 0 a 127. Los valores más altos envían más sonido al efecto correspondiente; el resultado depende de los efectos que admita el instrumento y de sus ajustes.
- **Level** muestra el nivel de audio medido de cada canal tras aplicar Vol., EXP, Pan y Mute/Solo. La barra de color sigue la señal y la marca fina retiene brevemente los picos recientes. No incluye el retorno compartido de reverberación y coro.
- **Mute** (**M**) silencia el canal. **Solo** (**S**) permite oír únicamente los canales que tengan Solo activado. Úsalos para comparar las partes de una canción.

Arrastra los mandos en vertical o selecciónalos y usa las teclas de flecha. Los cambios del mezclador son temporales y no se guardan en preajustes, enlaces compartidos ni copias de seguridad. Los cambios de Patch y de controladores usan el estado del MIDI entrante; los mensajes posteriores del mismo tipo pueden sobrescribirlos. Todos los cambios del mezclador, incluidos Mute y Solo, se restablecen al pasar a la siguiente canción o al recibir un mensaje de reinicio GM, GS o XG.

Cuando un mensaje MIDI entrante cambia el valor mostrado de Patch o de un mando, ese control se resalta brevemente.

### Settings

La pestaña **Settings** contiene los ajustes de reproducción que se guardan:

- **MIDI Channel** reproduce **All** los canales de forma predeterminada, o solo el canal elegido entre **1–16**.
- **Instrument Level** ajusta el sonido generado entre -60 y +12 dB (0 dB por defecto), sin cambiar el audio entrante.
- **Max Voices** limita las voces de muestra simultáneas, incluidas las colas, a 1–1024 (256 por defecto). Un valor mayor conserva más notas superpuestas y exige más procesamiento.
- **Automatic Fallback** (activado de forma predeterminada) sustituye un sonido SF2/SF3 que falta por otro disponible parecido, como se describe arriba. Desactívalo para que los canales que piden un sonido inexistente queden en silencio; así es fácil detectar los sonidos que faltan en el SoundFont.
- **Interpolation** elige cómo se remuestrean los sonidos del instrumento. **FIR (64 taps)** usa el filtro habitual de SF2/SF3 o respeta el ajuste de calidad del instrumento SFZ. **FIR (32 taps)** (predeterminado) reduce el procesamiento con SF2/SF3: emplea 32 coeficientes cuando no hace falta reducir la frecuencia de muestreo; los filtros FIR se alargan cuando la reproducción requiere esa reducción para limitar el aliasing. **Cubic (4 points)** usa una interpolación ligera, pero carece de un filtro paso bajo que evite el aliasing; al subir mucho el tono o usar muestras ricas en armónicos agudos pueden aparecer frecuencias falsas. FIR y Cubic prevalecen sobre el ajuste de calidad del instrumento SFZ.
- **SF2 Compatibility** elige cómo se interpretan los sonidos SF2/SF3; no afecta a los instrumentos SFZ. **Standard** (por defecto) se comporta como los sintetizadores SoundFont habituales y como el hardware original para el que está ajustada la mayoría de los SoundFonts: la atenuación de cada sonido se aplica al 40 % y se ignora la regla predeterminada de velocidad a filtro de la especificación, por lo que las notas suaves no suenan más oscuras automáticamente. **SF2.04 Strict** sigue al pie de la letra la especificación SoundFont 2.04: la atenuación se aplica por completo, de modo que los sonidos con atenuación suenan con menos volumen del que pretendían los autores de la mayoría de los SoundFonts, y las notas suaves suenan más oscuras. Úsalo para comprobar cómo suena un SoundFont interpretado según el texto de la especificación.

El instrumento seleccionado y estos ajustes se guardan de la forma habitual. El volumen y el silencio del reproductor también afectan al instrumento MIDI. Los presets, enlaces compartidos y copias de seguridad guardan la referencia al instrumento, no sus muestras. Conserva los archivos originales para usarlos en otro dispositivo.

**Color** solo cambia los colores del teclado. **Normal** usa el color habitual de los gráficos, **Note Colors** usa los colores de las notas de Note Spectrogram y **Channel Colors** asigna un color distinto a cada canal MIDI. La elección de color no se guarda en los presets.

### Instrument Details

El resumen del instrumento cargado muestra, cuando están disponibles, el número de muestras y sonidos, el tamaño de los archivos de origen y la memoria de reproducción. Los instrumentos grandes leen las muestras necesarias a medida que se reproducen, sin cargar todo el archivo de origen en memoria. Por eso, el tamaño de origen puede superar ampliamente la memoria de reproducción.

El estado indica si se están leyendo los archivos, preparando el instrumento o la caché de muestras, si está listo o si ha fallado la carga. El progreso muestra lo completado frente al total cuando este se conoce; en caso contrario, el indicador no muestra un porcentaje determinado. Si falla la carga, comprueba que los archivos originales estén disponibles o elige otro instrumento. Con la precarga limitada, el instrumento sigue disponible, pero algunas notas pueden empezar con retraso.

En **Settings**, abre **Instrument Details** para consultar las etiquetas del instrumento SFZ: teclas, controladores MIDI (**CC**), salidas, grupos, capas y teclas de cambio de articulación. Las etiquetas describen las asignaciones del instrumento; no son controles adicionales. Cuando hay una articulación con nombre activa, **Keyswitch** muestra la seleccionada en cada canal. También aparece la imagen incluida por el instrumento; si se declaran varias, se muestra la última.

### Entrada MIDI en directo

La interpretación MIDI en directo está disponible en la aplicación de escritorio y en el reproductor web/PWA. No se admite en la aplicación de Android, donde sigue disponible la asignación de controladores.

Para tocar desde un teclado MIDI o un puerto MIDI virtual, cierra Music Player. En **Configuración de audio**, pulsa **Actualizar dispositivos MIDI**, permite el acceso MIDI si se solicita y elige el **Dispositivo de entrada MIDI**. Mantén un instrumento cargado en SoundFont Player. Music Player tiene prioridad mientras esté abierto, aunque esté en pausa; elige **Ninguno** para detener la entrada MIDI en directo. Sin un instrumento cargado, la entrada MIDI continúa en silencio. Al cargarlo, se oyen los eventos MIDI posteriores; las notas anteriores no se repiten. La entrada MIDI en directo no se reenvía al **Dispositivo de salida MIDI**, que solo envía a un dispositivo externo la reproducción de archivos MIDI de Music Player.

En la aplicación de escritorio, los sitios abiertos en **Navegador** que usan Web MIDI también pueden tocar SoundFont Player a través de una salida MIDI llamada **EffeTune**. Desde su primer mensaje MIDI, la página toma la entrada MIDI en directo hasta que haces clic en **Cerrar** en la barra de herramientas del navegador, sales de la página o la recargas; entonces la entrada vuelve al **Dispositivo de entrada MIDI** seleccionado.

### Instrumentos SFZ

Un instrumento SFZ puede variar el volumen, la altura y el timbre de cada nota a lo largo del tiempo, combinar filtros y efectos integrados, y definir bucles de muestras y sonidos al soltar las notas. La reproducción y los efectos sincronizados con el pulso siguen el tempo y la velocidad de reproducción de la canción MIDI. Estos ajustes pertenecen al archivo del instrumento. Para modificar el sonido conjunto, añade efectos después de SoundFont Player.

`amp_veltrack_random` permite que un instrumento SFZ varíe aleatoriamente la relación entre la velocidad MIDI y el volumen con cada nota nueva. El valor predeterminado 0 no añade variación aleatoria. Cambia cómo influye la intensidad de la interpretación en el volumen, no la velocidad MIDI en sí.

Los instrumentos grandes leen las muestras según las necesitan, dentro del límite de memoria configurado. Importa el archivo de definición junto con todas las muestras necesarias; también se incluyen las muestras incrustadas y los archivos que solo usan los efectos del instrumento. Si una muestra no supera la comprobación de contenido, restaura el archivo original o vuelve a importar el instrumento. Los instrumentos con salidas separadas necesitan una configuración de salida con suficientes canales.

Un archivo SFZ puede elegir el almacenamiento de muestras con `load_mode`: 0 (predeterminado) usa coma flotante de 32 bits y 1 usa PCM de 16 bits para reducir la memoria de las muestras. Las fuentes de mayor precisión pierden precisión en el modo de 16 bits. En EffeTune, `load_start` y `load_end` indican la primera y la última trama de audio de la muestra original que se conservan en memoria, incluida la última. Al especificar un intervalo, omitir el inicio equivale a 0 y omitir el final equivale al final de la muestra. Los datos fuera del intervalo se leen según se necesitan; esto no recorta la reproducción ni desplaza los puntos de bucle. Sin ninguno de los dos límites, la lectura de muestras sigue siendo automática.

La compatibilidad depende del instrumento, y algunos comportamientos propios de determinados fabricantes no están disponibles. Consulta la [referencia de compatibilidad SFZ](../../../../specifications/sfz/README.md) para conocer el perfil compatible y sus límites. SoundFont Note Player prepara los instrumentos del mismo modo, pero las notas detectadas no aportan los cambios de controladores ni el tempo de una canción MIDI.
