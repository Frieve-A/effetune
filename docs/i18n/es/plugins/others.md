---
title: "Otros plugins - EffeTune"
description: "Plugins de utilidad adicionales, incluido Oscillator para generar señales de prueba."
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

SFZ Note Player detecta las notas del audio de entrada y las reproduce con un instrumento SFZ elegido. Úsalo para seguir una canción con un piano o superponer otro timbre a la grabación. La estimación polifónica puede omitir notas o añadir otras, especialmente en música densa.

La reproducción reduce automáticamente el ruido por aliasing al cambiar el tono o convertir la frecuencia de muestreo.

**Retrigger Drop** determina cuándo puede volver a sonar una nota mientras sigue detectándose. Una vez terminadas la detección y la retención de **Note Hold**, si vuelve a aparecer la misma nota, se reproduce como una nota nueva.

### Guía de ajuste del sonido

En Electron, pulsa **Select SFZ Folder…** y elige la carpeta del instrumento que contiene sus archivos SFZ, muestras y archivos incluidos. Si se encuentran varios archivos SFZ, elige un instrumento y pulsa **Select**. Los archivos de esta carpeta se leen directamente cada vez que se carga el instrumento. **Remove** elimina la entrada de la lista sin borrar los archivos originales.

En la versión web, pulsa **Import Folder…** y elige una carpeta con el archivo SFZ y sus muestras. Si hay varios SFZ, selecciona uno y pulsa **Import**. **SFZ** selecciona un instrumento guardado y **Remove** elimina el banco seleccionado del dispositivo.

Empieza con **Dry** al 0% y **Wet** al 100% para escuchar solo el instrumento; después sube **Dry** para añadir el sonido original. Pon **Octave** en -1 para añadir una capa más grave, o en +1 para una más aguda. Sube **Threshold** para recoger menos notas, con mayor confianza. Acota el registro con **Lowest Note** y **Highest Note**. Si el instrumento suena siempre demasiado suave o fuerte, ajusta **Velocity 1 Level** y **Velocity 127 Level**; equilibra el volumen final con **Output Gain**.

Active solo **Lowest** para seguir una línea grave, o solo **Highest** para seguir una línea aguda.

Si una nota sostenida se repite sin querer, aumenta **Retrigger Drop** por encima de su valor predeterminado de 40 dB. Un valor de 96 dB reduce mucho las repeticiones causadas por cambios de nivel. Bájalo para seguir pulsaciones repetidas de la misma nota.

Aumenta **Note Hold** para alargar las notas y unir interrupciones breves de la detección. Con 100 ms, la nota se mantiene 100 ms más antes de enviar la orden de finalizarla.

Que una nota aparezca en **Note Spectrogram** no garantiza que suene: también debe cumplir los ajustes de **Threshold** y **Lowest Note / Highest Note**. Si no suenan las notas muy graves o muy agudas, comprueba el intervalo y prueba a bajar **Threshold**. Comprueba también que el instrumento SFZ incluya la nota resultante de aplicar **Octave**.

### Parámetros

- **SFZ**: Elige un instrumento por su nombre. Un diálogo informa de los problemas en el primer intento de carga tras seleccionar o importar manualmente un instrumento; las recargas automáticas no muestran ningún diálogo.
- **Threshold**: Confianza mínima de detección (0,01–1, valor predeterminado 0,75). Al subirla, se reducen notas no deseadas, pero pueden perderse sonidos débiles o poco definidos.
- **Retrigger Drop (dB)**: Caída necesaria desde el nivel máximo de la nota de entrada antes de que pueda volver a sonar (1–96 dB, predeterminado 40 dB). Después, el nivel debe subir al menos 6 dB. Los valores altos reducen las repeticiones de notas sostenidas; los bajos permiten seguir mejor las pulsaciones repetidas de una misma nota.
- **Note Hold (ms)**: Tiempo adicional que se mantiene una nota tras terminar su detección, antes de enviar la orden de finalizarla (0–100 ms, predeterminado 50 ms). Si reaparece la misma nota durante ese tiempo, continúa sin reiniciarse. La envolvente del instrumento y la duración de la muestra siguen aplicándose.
- **Velocity 1 Level / Velocity 127 Level (dB)**: Niveles de entrada que corresponden a la velocidad más suave y más fuerte (valores predeterminados -60 dB / -10 dB). Bajarlos produce velocidades mayores con la misma entrada. Su separación determina cómo se distribuyen los niveles entre ambas velocidades.
- **Lowest Note / Highest Note**: Notas mínima y máxima de la entrada que se detectarán (A0–C8, MIDI 21–108; valores predeterminados E1 y G6), mostradas por su nombre. Se ignoran las notas fuera del intervalo.
- **Highest / Middle / Lowest**: Selecciona la línea grave, las notas interiores y la línea aguda antes de aplicar Octave (todas activadas de forma predeterminada). Middle selecciona las notas que quedan estrictamente entre la más grave y la más aguda detectadas en ese momento. Las líneas exteriores siguen la evolución de la altura para reducir los cambios bruscos; una única nota detectada pertenece a ambas. Las notas que dejan de estar seleccionadas se atenúan de forma natural. Desactive las tres opciones para detener las notas nuevas.
- **Octave**: Desplaza las nuevas notas del SFZ entre -2 y +2 octavas, en pasos de una octava (valor predeterminado 0). Los valores negativos producen notas más graves; los positivos, más agudas. El intervalo de detección de entrada y las notas que ya suenan no cambian.
- **Max Voices**: Límite de voces de muestras simultáneas. Aumentarlo conserva más notas y colas superpuestas, con mayor carga de procesamiento. Reducirlo sustituye antes las voces antiguas.
- **Dry (%)**: Nivel del audio original (0–100%, valor predeterminado 20%). 0% lo silencia y 100% conserva su nivel original.
- **Wet (%)**: Nivel del instrumento SFZ (0–100%, valor predeterminado 100%). 0% lo silencia y 100% conserva su nivel completo. Dry y Wet se ajustan de forma independiente.
- **Timing (ms)**: Ajusta la sincronización entre el audio original y el instrumento SFZ (de -100 a +100 ms, valor predeterminado 0). Los valores negativos retrasan más el audio original; los positivos retrasan el instrumento. Ajústelo mientras escucha para acercar el inicio de sus notas.
- **Output Gain (dB)**: Volumen final de la mezcla.

Con **Timing** a 0 ms, el audio original se retrasa unos **80 ms** para acompasarlo con el procesamiento y la corrección de la detección de notas. El ciclo de análisis y el ataque del instrumento pueden dejar pequeñas diferencias de tiempo. Un **Note Spectrogram** activo situado antes puede compartir su análisis y reducir la carga si coinciden el intervalo de notas, el bus de entrada y los canales, y el audio no cambia entre ambos.

La carga admite ajustes habituales de selección, tono, volumen, panorámica, bucles y envolvente de amplitud de SFZ. El desvanecimiento al soltar una nota dura al menos **0,2 segundos** y conserva los tiempos mayores definidos en el SFZ; el sonido puede detenerse antes si la muestra llega a su fin. Las condiciones de rango de los controladores se evalúan con sus valores iniciales; los ajustes `set_ccN` del SFZ tienen prioridad. Por ejemplo, un piano cuyo pedal está suelto inicialmente utiliza las muestras de esa posición sin añadir la capa del pedal pisado. Se utiliza la articulación predeterminada mediante tecla de cambio cuando el instrumento la especifica. Se omiten las capas que requieren soltar la nota, eventos de controlador, cambios de articulación durante la interpretación u otras condiciones no admitidas. Se descartan las regiones inválidas y se siguen cargando las válidas. Se ignoran los demás ajustes de sonido no admitidos.

El límite predeterminado es **256 MiB**. Puedes aumentarlo hasta **1024 MiB (1 GiB)** con **Límite de tamaño de SFZ** en **Configuración → General**. El límite se aplica a los archivos del instrumento y a las muestras descomprimidas para reproducirlo, a partir de la siguiente selección, importación o carga. Los límites mayores consumen más memoria. Si el instrumento completo supera el límite, se intenta cargar muestras representativas que cubran su intervalo de notas reproducibles. La velocidad sigue cambiando el volumen, pero se simplifican las variaciones entre capas de velocidad y muestras alternas. Si tampoco caben, elige un instrumento más pequeño o aumenta el límite. En la versión web, vuelve a importar la carpeta original después de aumentar el límite para recuperar las muestras omitidas. Otros efectos basados en muestras también comparten la memoria de procesamiento.

Los ajustes preestablecidos y las cadenas compartidas contienen solo una referencia al instrumento, sin sus archivos de sonido. En otro dispositivo, selecciona la carpeta local del instrumento en Electron o importa su carpeta en la versión web. Los archivos de sonido SFZ no se incluyen en la copia de seguridad de los datos del usuario; conserva las carpetas SFZ originales.
