---
title: "Otros plugins - Generador de tonos de prueba y ruido, SFZ Note Player - EffeTune"
description: "Oscillator genera tonos de prueba y ruido blanco o rosa para comprobar altavoces y auriculares; SFZ Note Player reproduce con un instrumento SFZ las notas detectadas."
lang: es
---

# Otras herramientas de audio

Una colección de herramientas de audio especializadas y generadores que complementan las categorías principales de efectos. Estos plugins son útiles para comprobar altavoces, auriculares, balance de canales y comportamiento de reproducción antes o durante la escucha.

## Lista de Plugins

- [Oscillator](#oscillator) - Generador de tonos y ruido de prueba para comprobar altavoces y auriculares
- [SFZ Note Player](#sfz-note-player) - Reproduce un instrumento SFZ importado a partir de las notas detectadas

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

## SFZ Note Player

SFZ Note Player detecta las notas del audio de entrada y las reproduce con un instrumento SFZ importado. Usa un SFZ de piano para seguir las notas de una canción, o superpón otro instrumento a la grabación original. La estimación polifónica de notas es una herramienta para escuchar y superponer, no una transcripción exacta; en las mezclas densas puede omitir notas o activar otras de más.

### Guía de mejora del sonido

- **Importar y cargar un instrumento**: Haz clic en **SFZ Library…**, usa **Importar carpeta…** para añadir una carpeta que contenga definiciones `.sfz` y archivos de muestras (o la carpeta completa de un banco ARIA con `.bank.xml`, `Programs` y `Samples`) y haz clic en **Cargar** junto al instrumento. En la aplicación de escritorio, EffeTune lee los archivos originales en su ubicación; en la aplicación web, los instrumentos se guardan en tu dispositivo, y **Importar archivos…** debe incluir las muestras y los demás archivos que necesita el instrumento. No se pueden eliminar los instrumentos en uso.
- **Escuchar y mezclar**: Empieza con **Dry: 0%** y **Wet: 100%** para oír solo el instrumento SFZ; después sube **Dry** para volver a mezclar la pista original. Ajusta **Timing** (−100 a +100 ms) para que los ataques de las notas SFZ coincidan con la grabación original (con 0 ms, la señal original se retrasa para acompasarse con la detección de notas: unos 90 ms en Classic y unos 230 ms en Event).
- **Acotar el rango de notas y las voces**: Sube **Threshold** para activar solo las notas con mayor confianza, estrecha **Lowest Note** y **Highest Note**, o activa solo **Lowest** (línea de bajo) o **Highest** (melodía superior) para seguir una sola línea musical. Que una línea de color aparezca en Note Spectrogram no garantiza que suene, porque **Threshold** y el rango de notas siguen aplicándose.
- **Dar forma al timbre y a la octava**: Usa **Octave** (−2 a +2) para doblar una línea una octava más grave o más aguda, y **Sample Shift** (−6 a +6 semitonos) para tocar las asignaciones de muestras vecinas reajustadas a la altura de la nota detectada, con un timbre más oscuro o más brillante.

### Parámetros

- **SFZ** - Abre **SFZ Library…** para importar, buscar, ordenar, cargar o eliminar instrumentos (**Clear** descarga el instrumento actual sin eliminarlo de la biblioteca).
- **Detection**:
  - **Classic (Low Latency)** (predeterminado): Detector de menor latencia (retardo de alineación de unos 90 ms) que usa **Threshold** y **Retrigger Drop**.
  - **Event (+140 ms)**: Usa el mismo detector de ataques y eventos que Note Spectrogram (retardo de alineación de unos 230 ms y mayor uso de CPU; **Threshold** y **Retrigger Drop** se desactivan). Cuando un Note Spectrogram activado situado antes en la cadena analiza la misma entrada con el mismo rango de notas y el audio entre ambos no cambia, se comparte su análisis para reducir la carga si **Onsets**, el color **Instrument** o **Highlight** está activado en Note Spectrogram. En caso contrario, SFZ Note Player realiza su propio análisis.
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

### Visualización de la reproducción y notas

- **Teclado interactivo y barras de velocidad**: El teclado abarca de **Lowest Note** a **Highest Note** e ilumina las notas que suenan, incluidas las colas de liberación. Las teclas iluminadas siguen a **Octave**; **Sample Shift** cambia el timbre sin moverlas. Cada barra empieza en la velocidad con que suena la nota (1–127) y baja con el tiempo, incluso después de que la nota termine; **Color** cambia sus colores sin reiniciar la caída. **Voices / Max Voices** cuenta las voces de muestras, incluidas las liberaciones.
- **Audición**: Haz clic o arrastra sobre el teclado o la zona de velocidad para tocar directamente el instrumento SFZ cargado. El teclado suena con velocidad 100; en la zona de velocidad, la velocidad depende de la altura a la que introduces la nota. La audición reproduce la altura mostrada, sin tener en cuenta **Octave**, aunque **Sample Shift** sigue aplicándose.
- **Límite de memoria**: Los instrumentos tienen un límite predeterminado de **256 MiB** (se puede aumentar hasta **1024 MiB** con **Límite de tamaño de SFZ** en **Configuración > Configuración... > General**). Si un instrumento supera el límite, se cargan automáticamente muestras representativas de todo el teclado. En la aplicación web, vuelve a importar la carpeta después de aumentar el límite.
- **Funciones SFZ compatibles**: Se omiten las capas que necesitan soltar la nota, eventos de controlador o cambios dinámicos de articulación mediante teclas, y se ignoran los demás ajustes no compatibles.
- **Compartir y copias de seguridad**: Los presets, los enlaces compartidos y las copias de seguridad de los datos del usuario guardan una referencia al instrumento, no sus muestras de audio; conserva tus carpetas SFZ originales para usarlas en otros dispositivos.
