---
title: "Plugins de análisis - EffeTune"
description: "Plugins de análisis de audio, incluidos Analog Meter, Chroma Spiral, Level Meter, Note Spectrogram, Oscilloscope, Pitch Meter, Rhythm Analyzer, Spectrogram, Spectrum Analyzer y Stereo Meter."
lang: es
---

# Plugins de Análisis

Una colección de plugins que te permiten ver tu música de formas fascinantes. Estas herramientas visuales te ayudan a entender lo que estás escuchando mostrando diferentes aspectos del sonido, haciendo tu experiencia de escucha más atractiva e interactiva.

## Lista de Plugins

- [Analog Meter](#analog-meter) - Muestra los niveles de canal en un medidor de aguja con escalas VU, PPM, pico y sonoridad
- [Chroma Spiral](#chroma-spiral) - Sitúa los componentes de frecuencia en una espiral de notas y octavas
- [Level Meter](#level-meter) - Muestra el nivel de señal digital y posibles recortes
- [Note Spectrogram](#note-spectrogram) - Muestra las alturas estimadas a lo largo del tiempo en un piano roll
- [Oscilloscope](#oscilloscope) - Muestra la visualización de forma de onda en tiempo real
- [Pitch Meter](#pitch-meter) - Sigue una frecuencia fundamental y su afinación a lo largo del tiempo
- [Rhythm Analyzer](#rhythm-analyzer) - Muestra el tempo, los golpes pulso a pulso y cuánto se adelanta o se retrasa cada parte
- [Spectrogram](#spectrogram) - Crea hermosos patrones visuales a partir de tu música
- [Spectrum Analyzer](#spectrum-analyzer) - Muestra las diferentes frecuencias en tu música
- [Stereo Meter](#stereo-meter) - Visualiza el balance estéreo y las relaciones de fase

## Analog Meter

Muestra el nivel de cada canal en un medidor de aguja clásico, sin cambiar el sonido. Úsalo para seguir de un momento a otro cuánto suena tu música, o para ver cómo se lee tu reproducción en las escalas usadas en la radiodifusión y el streaming: VU, PPM, pico y sonoridad (LUFS).

### Guía de uso

- **Sigue el nivel medio con VU**: observa la aguja durante una canción. Las estrofas tranquilas y los estribillos intensos muestran una diferencia clara, mientras que los golpes cortos de batería apenas mueven la aguja.
- **Comprueba el recorte con True Peak**: coloca Analog Meter después de tus efectos de EQ y ganancia, y reproduce la parte más intensa de una pista. Si la lectura supera 0 dBFS o se enciende el indicador over, la cadena puede recortar; baja la ganancia hasta que los picos se mantengan por debajo de 0 dBFS, con un pequeño margen como -1 dBFS.
- **Compara canciones con Loudness**: ajusta **Target** a una referencia de streaming como -14 LUFS, pulsa **Reset** al empezar una canción o álbum y reprodúcelo entero. El valor Integrated muestra su sonoridad global y el máximo True Peak muestra su pico más alto, lo que sirve de guía para igualar el volumen entre las canciones de un álbum o lista. LRA te permite comparar cuánto varía la sonoridad de cada canción.

### Preajustes del sistema

Haz clic en **Preajustes de efecto** en la cabecera del efecto para ajustar el medidor a un estándar conocido en un solo paso. Un preajuste que cambia **Mode** reinicia la medición; al pasar de un preajuste de Loudness a otro, la medición continúa.

- **Studio VU (-18 dBFS)** - VU con 0 VU en -18 dBFS, la alineación de estudio habitual (EBU R68). Adecuado para grabaciones con mucho margen (headroom).
- **SMPTE VU (-20 dBFS)** - VU con 0 VU en -20 dBFS (SMPTE RP 155), la práctica de los estudios y la radiodifusión de Norteamérica.
- **Hot VU (-14 dBFS)** - La configuración predeterminada: VU con 0 VU en -14 dBFS, adecuada para la mayoría de las grabaciones comerciales terminadas.
- **Loud Master VU (-8 dBFS)** - VU con 0 VU en -8 dBFS, para CD modernos y másteres de pop con la sonoridad llevada al máximo, que de otro modo mantendrían la aguja en el tope de la escala.
- **DIN PPM** - El medidor DIN (**Attack** de 5 ms, caída de 20 dB en 1,5 s, escala DIN) con la marca -9 en -18 dBFS, de modo que el 0 queda en -9 dBFS. La escala llega hasta -50.
- **BBC PPM** - El medidor BBC (**Attack** de 10 ms, caída de 24 dB en 2,8 s, escala BBC) con la marca 4 en -18 dBFS, de modo que la marca 6 queda en -10 dBFS.
- **Nagra Modulometer** - El modulómetro de los magnetófonos Nagra (**Attack** de 7,5 ms, escala en dB de -30 a +5 dB) con 0 dB en -18 dBFS. **Release** usa el valor DIN de 1,5 s.
- **K-20** - El K-System de Bob Katz en un medidor RMS, con 0 en -20 dBFS y una escala que baja hasta -60 dBFS. Para grabaciones con dinámica amplia.
- **K-14** - Igual, con 0 en -14 dBFS y la escala hasta -60 dBFS. Para la música pop habitual.
- **K-12** - Igual, con 0 en -12 dBFS y la escala hasta -60 dBFS. Para material muy comprimido pensado para radiodifusión.
- **Digital Peak** - Un medidor de pico digital estándar (IEC 60268-18) de -60 a 0 dBFS, con retención de pico de 2 s.
- **True Peak Clip Watch** - True Peak ampliado a los 20 dB superiores de la escala, con la retención de pico más larga (10 s), para detectar picos por encima de 0 dBFS tras cambiar la EQ o la ganancia.
- **EBU R128 (-23 LUFS)** - Loudness con el objetivo de la radiodifusión europea y la escala EBU +9.
- **EBU R128 +18 Scale** - El mismo objetivo con la escala EBU +18, más amplia, para música clásica y otro material con dinámica amplia.
- **TV (-24 LKFS)** - Loudness con el objetivo de -24 LKFS que se usa en la televisión de EE. UU. (ATSC A/85) y Japón (ARIB TR-B32).
- **Streaming (-14 LUFS)** - Loudness con un objetivo de -14 LUFS, cercano a la normalización de volumen de muchos servicios de streaming musical, y la aguja Short-term, más tranquila.
- **Streaming (-16 LUFS)** - Loudness con el objetivo de -16 LUFS recomendado para streaming y pódcasts (AES TD1008), y la aguja Short-term.

### Parámetros

Solo se muestran los controles que se aplican al **Mode** seleccionado.

- **Mode** - Selecciona el tipo de medidor: **VU** (predeterminado), **PPM**, **RMS**, **Sample Peak**, **True Peak** o **Loudness**. Cada modo mueve la aguja de forma distinta y usa su propia escala (consulta Cómo leer la visualización). Cambiar el modo reinicia la medición.
- **Integration** (RMS; de 0,05 a 3 s; predeterminado: 0,3 s) - Define el tiempo de promediado. Los valores más largos dan una aguja más estable y lenta; los más cortos siguen los cambios con mayor rapidez.
- **Attack** (PPM; de 1 a 20 ms; predeterminado: 5 ms) - Define la rapidez con la que sube la aguja en modo PPM, expresada como la duración de una ráfaga de tono que se lee 2 dB por debajo de un tono constante. Los valores más cortos muestran los picos breves más cerca de su nivel real; los más largos hacen que los picos breves se lean más bajos. 5 ms coincide con el medidor DIN.
- **Release** (PPM, Sample Peak, True Peak; de 0,1 a 5 s; predeterminado: 1,5 s) - Define el tiempo que tarda la aguja en caer 20 dB tras un pico. Los valores más largos facilitan la lectura de los picos; los más cortos siguen la música con mayor precisión. 1,5 s coincide con el medidor DIN y con el medidor de pico digital estándar.
- **Reference** (VU, PPM, RMS; de -30 a 0 dBFS; predeterminado: -14 dBFS) - Define el nivel digital que coincide con la marca de referencia del medidor. El valor predeterminado se adapta a la mayoría de las grabaciones comerciales terminadas; con las alineaciones de estudio de -18 o -20 dBFS (consulta Preajustes del sistema), un CD corriente suele mantener la aguja cerca del tope de la escala. Súbelo cuando las grabaciones intensas lleven la aguja al tope de la escala; bájalo cuando las grabaciones tranquilas apenas la muevan.
- **Range** (PPM con la escala DIN o dB, RMS, Sample Peak, True Peak; de 20 a 60 dB; predeterminado: 40 dB) - Define hasta dónde llega la escala hacia abajo. Ámplialo para ver pasajes tranquilos; redúcelo para repartir mejor la parte superior de la escala.
- **PPM Scale** (PPM; predeterminado: DIN) - Selecciona la escala del PPM: **DIN**, **BBC** o **dB** (consulta Cómo leer la visualización).
- **Peak Hold** (PPM, RMS, Sample Peak, True Peak; de 0 a 10 s; predeterminado: 1 s) - Define cuánto tiempo permanece la marca de pico en la lectura más alta reciente y cuánto tiempo sigue encendido el indicador over. Con 0 se desactiva la marca y el indicador over permanece encendido 1 s.
- **Needle** (Loudness; predeterminado: Momentary) - Selecciona qué muestra la aguja. **Momentary** sigue la sonoridad de los últimos 0,4 s; **Short-term** muestra los últimos 3 s y se mueve con más calma.
- **Target** (Loudness; de -36 a -10 LUFS; predeterminado: -23 LUFS) - Define la sonoridad marcada en la escala y dispone la escala tomando ese valor como referencia. -23 LUFS es el nivel de radiodifusión de EBU R128; muchos servicios de streaming usan valores cercanos a -14 LUFS.
- **Scale** (Loudness; predeterminado: EBU +9) - Selecciona la amplitud de la escala de sonoridad. **EBU +9** cubre de 18 LU por debajo a 9 LU por encima de **Target**; **EBU +18** cubre de 36 LU por debajo a 18 LU por encima, lo que conviene a música con dinámica amplia o material muy intenso.

### Cómo leer la visualización

- Cada canal tiene su propio medidor, hasta cuatro por fila y hasta 16 canales.
- Los niveles siguen la convención digital habitual de que una onda sinusoidal a plena escala se lee como 0 dBFS, así que una onda sinusoidal constante da la misma lectura en todos los modos excepto Loudness.
- Los modos difieren en la rapidez con la que se mueve la aguja:

| Modo | Movimiento de la aguja | Escala |
|---|---|---|
| VU | Lento. Alcanza un nuevo nivel en unos 0,3 s y muestra el nivel medio (IEC 60268-17). | De -20 a +3 VU. 0 VU = **Reference**. |
| PPM | Una aproximación basada en IEC 60268-10. Sube rápidamente a la velocidad fijada por **Attack**; con el valor predeterminado de 5 ms, una ráfaga de 10 ms se lee aproximadamente 1 dB por debajo de un tono continuo, como en un medidor DIN. Cae 20 dB en el tiempo de **Release**. | Se elige con **PPM Scale**. **DIN**: la marca -9 = **Reference**, así que 0 queda 9 dB por encima. **BBC**: marcas de 1 a 7, con 4 dB entre las marcas de 2 a 7 y 6 dB entre 1 y 2; la marca 4 = **Reference**. **dB**: la marca 0 = **Reference**, desde **Range** por debajo de ella hasta +5 dB. |
| RMS | Muestra la potencia media durante el tiempo de **Integration**, sin suavizado adicional. | La marca 0 = **Reference**. |
| Sample Peak | Salta de inmediato al valor de muestra más alto. | El tope de la escala = 0 dBFS. |
| True Peak | Como Sample Peak, pero también estima los picos entre muestras. Puede leer por encima de 0 dBFS; esos picos pueden recortar en un DAC o durante la conversión. | El tope de la escala = 0 dBFS. |
| Loudness | Muestra la sonoridad en LUFS según ITU-R BS.1770 y EBU R128. | Definida por **Target** y **Scale**; las lecturas se muestran en LUFS. |

- La marca de pico muestra la lectura más alta reciente durante el tiempo de **Peak Hold**. El indicador over se enciende cuando el nivel supera 0 dBFS y permanece encendido durante el tiempo de **Peak Hold**, o 1 s si **Peak Hold** es 0.
- En el modo Loudness, el primer medidor muestra el programa completo. Su aguja sigue el ajuste de **Needle** y muestra Momentary (M), Short-term (S), Integrated (I), Loudness Range (LRA), el máximo True Peak y el tiempo de medición transcurrido, junto con un botón **Reset**. Integrated y LRA aparecen cuando se ha medido suficiente audio.
  - Para mono, estéreo y 5.1 (orden de canales L, R, C, LFE, Ls, Rs), estos valores siguen la ponderación de canales estándar. Para otros números de canales, todos los canales se suman con el mismo peso, por lo que los valores son solo de referencia.
  - Los medidores siguientes muestran cada canal por separado. Son valores de referencia, medidos sin ponderación de canales ni puerta.
- Integrated, LRA y el máximo True Peak siguen acumulándose hasta que pulsas **Reset**, cambias **Mode**, cambia la frecuencia de muestreo o el número de canales, o se reinicia el procesamiento de audio.
- El tiempo en que el procesamiento está en pausa no se mide: durante las pausas de ahorro de energía en silencio, mientras Master Bypass está activado o Analog Meter está desactivado, o mientras Effect Pipeline no está visible (por ejemplo, en la Biblioteca musical, con la ventana minimizada o en el Reproductor mini) y **Omitir el DSP de visualización cuando esté oculto** está activado en Configuración (lo está de forma predeterminada). Las lecturas continúan desde donde se detuvieron.

## Chroma Spiral

Muestra en qué notas y octavas se sitúan los componentes de frecuencia de la música, sin cambiar el sonido. Úsalo para observar armónicos superpuestos, comparar las zonas de una voz y un bajo o ver el rango de un instrumento.

### Guía de uso

- Mantén una nota y observa su posición y las que iluminan sus armónicos. Una sola nota puede iluminar varios nombres; no todos representan notas tocadas por separado.
- Sigue un acorde o una melodía para ver cómo cambian las posiciones activas. Puede dar pistas sobre la tonalidad, pero no identifica acordes ni tonalidades.
- Para revisar la afinación, observa si un punto brillante o el borde de una zona resaltada cae entre las guías de notas. Para leer en cents la desviación de una frecuencia fundamental, usa Pitch Meter.
- Pulsa el gráfico con el ratón, un dedo o un lápiz táctil para oír una onda sinusoidal en la posición elegida de la espiral. Arrastra para cambiar el tono; al soltar o cancelar el gesto, el sonido se detiene. Esta vista previa funciona con todas las opciones de **Color**.

### Parámetros

- **Color** - Elige cómo se dibuja el espectro. La misma espiral de referencia permanece visible con todas las opciones, incluso durante el silencio.
  - **Normal** (predeterminado): muestra cada celda de frecuencia como un punto con el color del trazo del gráfico del tema. Su brillo sigue el nivel de la celda y su área crece en proporción a ese nivel, para que las frecuencias más débiles sean más fáciles de ver. En el nivel máximo, el radio del punto llega a medio camino de la siguiente vuelta.
  - **Normal 2**: colorea desde la posición de cada frecuencia en la espiral hasta su nivel con el color del trazo del gráfico, sin trazar un contorno de los datos.
  - **Note Colors**: muestra los mismos puntos que Normal, pero con un color distinto para cada nota, repetido en todas las octavas.
- **Lowest Octave** (1 a 8; predeterminado: 1) - Define la octava interior. Súbela para centrarte en sonidos agudos.
- **Highest Octave** (1 a 9; predeterminado: 7) - Define la octava exterior. Bájala para centrarte en graves y medios. Ambos límites se mantienen en orden al cambiarlos.
- **Frequency Tilt** (de -6 a +6 dB/oct en pasos de 0,5; predeterminado: +3) - Ajusta el nivel mostrado de las frecuencias superiores a 100 Hz sin cambiar el sonido. Los valores positivos resaltan las frecuencias altas y los negativos las atenúan en el gráfico. Con 0 no se aplica corrección por frecuencia.
- **Level Range** (de 6 a 96 dB en pasos de 1 dB; predeterminado: 24) - Define la anchura de la ventana de visualización móvil. Redúcela para destacar las diferencias de nivel o amplíala para ver componentes más débiles junto a los más fuertes.
- **Display Floor** (de -120 a -24 dB en pasos de 1 dB; predeterminado: -60) - Define hasta dónde puede bajar la ventana móvil en los pasajes tranquilos. Bájalo para que puedan aparecer componentes más débiles dentro del **Level Range** elegido. La ventana sigue los picos recientes, así que este ajuste no garantiza que se vean todos los componentes débiles.

### Cómo leer la visualización

- Cada vuelta representa una octava. C está arriba y las notas avanzan en sentido horario; las vueltas interiores son más graves. Las etiquetas de C indican las octavas.
- En **Normal** y **Note Colors**, los puntos más brillantes y grandes indican componentes más fuertes en su posición, también entre notas. En **Normal 2**, la zona coloreada se extiende más hacia fuera donde los componentes son más fuertes; su borde exterior muestra los cambios del espectro sin un trazo separado.
- El brillo y el área de los puntos, así como la extensión de la zona coloreada, muestran intensidad relativa, no un nivel absoluto: la escala sigue los picos recientes.
- En las octavas graves, las notas próximas se distinguen peor y la respuesta es más lenta; pueden verse mezcladas.

### Visualización
- Pasa el cursor sobre la pantalla, o tócala y desliza el dedo sobre ella, para leer los valores en ese punto.

## Level Meter

Una visualización que muestra en tiempo real el nivel de señal digital de tu música. Te ayuda a revisar los niveles después de aplicar efectos y a detectar posibles recortes antes de que se vuelvan distorsión audible.

### Guía de Visualización
- La barra horizontal se extiende más hacia la derecha cuanto mayor es el nivel de señal
- El marcador blanco mantiene un pico nuevo durante un segundo y luego desciende suavemente
- OVERLOAD indica que la señal superó el rango digital seguro y puede distorsionar
- Para una reproducción limpia, evita niveles rojos o avisos OVERLOAD frecuentes; ajusta el volumen real de escucha en tu dispositivo

## Note Spectrogram

Muestra las frecuencias fundamentales (F0) estimadas de A0 a C8 en un piano roll que se desplaza sin modificar el audio. Úsalo para seguir las notas de un acorde, líneas vocales y melódicas cambiantes, la línea de bajo y las notas que se superponen en distintas octavas. El analizador estima las frecuencias fundamentales de las notas que detecta dentro del rango seleccionado.

### Guía de Visualización

- **Vertical** muestra el tiempo de izquierda a derecha, con el teclado y el sonido actual en el extremo derecho. Las notas más agudas aparecen arriba.
- **Horizontal** coloca el teclado abajo, con las notas graves a la izquierda y las agudas a la derecha. El sonido nuevo aparece justo encima del teclado y el historial se desplaza hacia arriba.
- El sonido nuevo se muestra primero con una estimación inmediata de su altura. Unos 40, 80 y 160 ms después, se actualiza la estimación en ese mismo punto con ayuda de los sonidos que vienen a continuación, por lo que las marcas recientes justo detrás del sonido más nuevo pueden cambiar. Esta actualización no añade retraso a la visualización ni cambia la sincronización de **Sincronizar elementos visuales con el audio**.
- Las líneas en cada C marcan los límites de las octavas.
- Las filas correspondientes a las teclas negras usan un fondo gris casi negro para que puedan distinguirse aunque no se detecte ninguna nota.
- **Normal** usa el color del trazado del gráfico del tema; **Note Colors** asigna un color a cada nota, que se repite en todas las octavas. Ambos muestran líneas de guía entre E y F más oscuras que los límites de octava.
- **1/12 Octave** muestra una fila por semitono. **High (1/60 Octave)** divide cada semitono en cinco filas para seguir mejor los pequeños cambios de altura; los colores se mezclan entre notas vecinas.
- La intensidad del color indica la confianza en cada estimación de altura; los candidatos débiles también se muestran, sin un umbral de visualización.
- Con **Volume** activado, cada altura detectada se convierte en una barra cuyo grosor del núcleo opaco representa su volumen relativo corregido según la frecuencia: de 1/60 de octava en la parte inferior de la escala a 1/12 de octava en la superior. En cada lado del núcleo se añade un desvanecido de 1/120 de octava, por lo que el ancho total dibujado aumenta en 1/60 de octava respecto al núcleo. **Pitch Resolution** cambia la posición central de la barra, no el grosor de su núcleo.
- En el borde del teclado, un semicírculo de bordes suaves se extiende hacia el gráfico y muestra el volumen actual. Responde de inmediato a los aumentos y desciende a 20 dB por segundo; no hay una retención de pico visible independiente.
- La escala de volumen abarca 24 dB. Su límite superior sigue el valor más alto entre una referencia reciente que estabiliza la escala del historial (durante aproximadamente un segundo) y -36 dB, de modo que el material más silencioso siga siendo legible sin que los pasajes más fuertes llenen continuamente la pantalla. Esta referencia es independiente del semicírculo del volumen actual.
- Las líneas guía de las octavas y de E–F se dibujan detrás de las barras de volumen, para que la cuadrícula de alturas siga sirviendo de referencia visual.
- Las teclas pasan gradualmente de su color habitual al color de visualización a medida que aumenta la confianza del último fotograma, hasta alcanzar ese color con un valor de 1.
- Cambiar **Color** actualiza los colores del historial existente.

### Visualización
- Pasa el cursor sobre el historial, o tócalo y desliza el dedo, para leer la nota, el tiempo, **Salience** (confianza en la estimación de la altura) y **Level** (volumen corregido según la frecuencia, en dB) en ese punto.

### Qué Puedes Ver

- Los acordes aparecen como varias filas brillantes al mismo tiempo
- Las melodías y líneas de bajo forman recorridos entre las filas de notas
- La pantalla no crea MIDI ni partitura, no identifica instrumentos ni puede separar por completo todos los sonidos simultáneos. Las superposiciones complejas pueden dejar partes de una melodía o armonía sin detectar, y la percusión, el ruido o los patrones repetidos poco claros pueden producir alguna altura incorrecta.

### Parámetros

- **Color** - Selecciona los colores de visualización sin cambiar las estimaciones de notas.
  - **Normal** (predeterminado): el color del trazado del gráfico del tema.
  - **Note Colors**: un color distinto para cada nota, que se repite en todas las octavas.
- **Pitch Resolution** - Selecciona el detalle vertical de la altura sin borrar el historial existente.
  - **1/12 Octave** (predeterminado): una fila por semitono, usando la estimación más fuerte de esa nota.
  - **High (1/60 Octave)**: cinco filas por semitono para mostrar cambios de altura más finos.
- **Layout** - Selecciona **Horizontal** (predeterminado) o **Vertical**. El historial se conserva al cambiar la disposición.
- **Volume** - Muestra el volumen relativo mediante el grosor de las barras y medidores semicirculares. Está activado por defecto; al desactivarlo, la intensidad de las filas indica la confianza.
- **Time Span** (de 1 a 10 s) - Define cuánto tiempo muestra el piano roll
  - Los valores cortos permiten ver mejor los cambios de ritmo
  - Los valores largos muestran un pasaje musical más extenso de una vez
  - Valor predeterminado: 2 s
- **Lowest Note** - Define la nota más baja del rango mostrado y analizado. Valor predeterminado: E1.
- **Highest Note** - Define la nota más alta del rango mostrado y analizado. Valor predeterminado: G6.
- Cuando la entrada es demasiado baja para el análisis, el piano roll permanece oscuro en lugar de mostrar una entrada extremadamente pequeña como alturas. Esta supresión no determina si un sonido sería audible o quedaría enmascarado perceptivamente.

## Oscilloscope

Muestra la forma de la onda sonora en tiempo real para que puedas ver golpes, ataques marcados y cambios de volumen mientras escuchas. Los ajustes de Trigger ayudan a estabilizar la visualización cuando la forma de onda se repite.

### Guía de Visualización
- El eje horizontal muestra el tiempo (milisegundos)
- El eje vertical muestra amplitud normalizada; el rango visible cambia con Display Level y Vertical Offset
- La línea verde traza la forma de onda real
- Las líneas de cuadrícula ayudan a medir valores de tiempo y amplitud
- Los ajustes de Trigger determinan dónde empieza la captura de la forma de onda; no se muestra un marcador aparte

### Visualización
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

### Parámetros
- **Display Time** - Cuánto tiempo mostrar (1 a 100 ms)
  - Valores más bajos: Ver más detalle en eventos más cortos
  - Valores más altos: Ver patrones más largos
- **Trigger Mode**
  - Auto: Actualizaciones continuas incluso sin disparo
  - Normal: Congela la visualización hasta el siguiente disparo
  - Off: Sin disparo; muestra continuamente la forma de onda más reciente. Trigger Level, Trigger Edge y Holdoff no tienen efecto
- La detección del disparo usa el promedio de los canales izquierdo y derecho. La entrada mono se usa directamente.
- **Trigger Level** - Nivel de amplitud que inicia la captura
  - Rango: -1 a 1 (amplitud normalizada)
- **Trigger Edge**
  - Rising: Dispara cuando la señal sube
  - Falling: Dispara cuando la señal baja
- **Holdoff** - Tiempo mínimo entre disparos (0.1 a 10 ms)
- **Display Level** - Escala vertical en dB (-96 a 0 dB)
- **Vertical Offset** - Desplaza la forma de onda arriba/abajo (-1 a 1)

### Nota sobre la Visualización de Forma de Onda
La forma de onda conecta los puntos capturados en orden temporal. Con tiempos de visualización largos, cada intervalo conserva sus muestras inicial y final, además de las muestras mínima y máxima en sus posiciones originales. Así se mantienen la continuidad y los picos breves dentro de la resolución de la pantalla. Úsala como guía visual, no como una herramienta de medición exacta.

## Pitch Meter

Sigue una frecuencia fundamental (F0) cada vez en un piano roll móvil de dos segundos sin modificar el audio. Úsalo para comprobar la afinación y los cambios de altura de una voz o un instrumento solista.

### Guía de Visualización

- **Horizontal** (predeterminado) coloca las notas graves a la izquierda y las agudas a la derecha. La estimación más reciente aparece sobre el teclado y el historial se desplaza hacia arriba.
- **Vertical** coloca las notas graves abajo y las agudas arriba. La estimación más reciente aparece junto al teclado de la derecha y el historial avanza hacia la izquierda.
- La posición de la línea indica la altura entre semitonos. Una estimación más fiable se ve más intensa; la línea se interrumpe cuando la entrada es demasiado baja o no se encuentra una sola altura estable.
- La etiqueta actual muestra la nota más cercana y la diferencia en cents. Un valor positivo indica una altura superior y uno negativo, inferior. La etiqueta desaparece cuando no hay una estimación fiable.
- El nombre de la nota usa los mismos colores que Note Spectrogram. El tamaño del nombre y la diferencia en cents se adapta al ancho disponible, y el punto decimal de los cents mantiene una posición fija.

### Visualización
- Pasa el cursor sobre la pantalla, o tócala y desliza el dedo sobre ella, para leer los valores en ese punto.

### Guía de Uso

- Empieza con una sola nota sostenida y observa si la línea permanece centrada o se desplaza hacia agudo o grave.
- El vibrato y los pitch bends aparecen como movimientos suaves entre las filas de notas.
- Este analizador sigue una altura dominante. Los acordes, las mezclas densas, la percusión, el ruido o los sonidos periódicos poco claros pueden interrumpir la línea o producir una octava incorrecta.

### Parámetros

- **Layout** - Selecciona **Horizontal** (predeterminado) o **Vertical**.
- **Color** - Cambia el color de la línea sin modificar la detección de altura. **Normal** (predeterminado) usa el color del gráfico del tema; **Heatmap** muestra el volumen en la misma escala de 24 dB que Note Spectrogram; **Note Colors** sigue la altura entre los colores de las notas.
- **Reference A4** (400 a 480 Hz) - Ajusta la referencia de afinación usada para los nombres de nota y los cents. Valor predeterminado: 440 Hz.
- **Lowest Note** - Define el límite inferior del intervalo mostrado y analizado. Valor predeterminado: C2. El ajuste más bajo es A0.
- **Highest Note** - Define el límite superior del intervalo mostrado y analizado. Valor predeterminado: C7. El ajuste más alto es C8.
- La entrada estéreo se analiza promediando los dos primeros canales; la entrada mono se usa directamente. El contenido con polaridad muy opuesta puede cancelarse al promediar y dejar la gráfica sin trazo.

## Rhythm Analyzer

Calcula el tempo de tu música y muestra, pulso a pulso, dónde caen los golpes de batería e instrumentos y cuánto se adelanta o se retrasa cada parte, sin modificar el sonido salvo que **Metronome Click** esté activado. Sirve para averiguar el BPM de un tema, comprobar cuánto swing tiene un groove, ver si la caja suena por detrás del tiempo, o localizar dónde entra un fill o cambia un patrón.

### Guía de Uso

- **Comprueba el tempo**: Reproduce música con un pulso claro y estable. El BPM y la línea **adopted** siguen el historial analizado, que aparece unos 1–2 segundos después del sonido. **LOCKED** indica que se muestran pulsos con la luz y el clic. Si el tempo no coincide con el que marcas con el pie, compara **×½**, **×2** y **strongest** para encontrar el nivel de pulso que percibes.
- **Escucha dónde cae el pulso**: activa **Metronome Click** para oír un clic en cada tiempo detectado. Si los clics coinciden con el pulso que marcas con el pie, el analizador ha encontrado el pulso correcto. Si caen entre los tiempos que marcas con el pie, o al doble o a la mitad de tu velocidad, el analizador sigue una posición o un nivel de pulso distinto; consulta **Corrige un bloqueo al doble o a la mitad de tempo** más abajo y **Limitaciones**.
- **Colócalo al final al usar el clic**: el clic se mezcla en el audio que sale del analizador, así que cualquier efecto posterior también lo procesa. Coloca Rhythm Analyzer al final de la cadena de efectos mientras escuchas con el clic activado.
- **Desactiva el clic antes de procesar archivos**: con **Metronome Click** activado, los clics se graban en cualquier archivo que proceses. Desactívalo antes.
- **Corrige un bloqueo al doble o a la mitad de tempo**: si una balada lenta se bloquea al doble de su tempo, baja **Max BPM** por debajo de ese valor (por ejemplo, a 100 para una balada de 60 BPM). Si un tema rápido se bloquea a la mitad de velocidad, sube **Min BPM** por encima de ese valor. El análisis se reinicia con el nuevo rango.
- **Lee un groove estable**: con música programada o tocada con clic, los puntos se sitúan cerca del centro de sus carriles y **jitter** se mantiene cerca de 0 ms. Cuando una parte suena sistemáticamente por detrás o por delante de las demás, sus puntos quedan por encima o por debajo del centro del carril en las mismas posiciones cada vez. Una caja que llega 15 ms detrás del bombo y el hi-hat, por ejemplo, aparece como puntos Mid por encima del centro del carril en los tiempos 2 y 4, y como una marca Mid etiquetada +15 en la columna **1** de la lente de tiempos.
- **Lee el swing**: **swing** muestra cuánto se retrasa el contratiempo: 1.00:1 es recto, 2.00:1 es un shuffle de tresillo completo, y los valores intermedios son un swing más ligero. En música claramente swingueada, la lente de tiempos coloca los golpes del contratiempo en la columna **⅔** en lugar de **&**.
- **Localiza fills y cambios de sección**: un anillo marca un golpe que esa misma banda no tocó en la misma posición uno o dos intervalos antes. Mientras se repite un patrón aparecen pocos anillos; un fill o los primeros compases de una nueva sección muestran muchos. Las filas de eco, debajo de los carriles principales, te permiten comparar el nuevo patrón con los anteriores.
- **Cuando aparece searching**: Dejan de mostrarse pulsos nuevos, pero el análisis continúa. El tempo, los carriles de sincronización y la lente pueden seguir visibles y atenuarse al bajar la confianza. Un pulso ya detectado todavía puede encender la luz o producir un clic. El silencio borra las lecturas actuales; el análisis se reanuda al volver el sonido. Los fundidos y el sonido de fondo pueden tardar más en detener los pulsos.

### Parámetros

- **Min BPM** (40 a 192; predeterminado 40) - Define el tempo mínimo considerado. Auméntalo si el analizador sigue la mitad del tempo que percibes.
- **Max BPM** (50 a 240; predeterminado 240) - Define el tempo máximo considerado. Redúcelo si sigue el doble del tempo que percibes. Max BPM se mantiene al menos en 1,25 veces Min BPM; si una modificación rompe esa relación, se ajusta el otro límite. Cambiar cualquiera reinicia el análisis. El tempograma siempre abarca 30–480 BPM; **×½** y **×2** pueden quedar fuera del rango elegido.
- **Metronome Click** (activado o desactivado; desactivado por defecto) - Añade un clic corto y agudo en cada pulso mostrado, igual que la luz. Durante **searching** no se generan clics nuevos, aunque uno ya detectado puede sonar. El nivel fijo es de unos −10 dBFS y se suma a los canales 1 y 2 (solo el 1 en mono); los demás no cambian. Desactivado, el audio pasa sin cambios. Alternarlo no reinicia el análisis.
- **Span (beats)** (4, 6, 8, 12 o 16; 8 predeterminado) - Fija cuántos tiempos muestran los carriles principales y cada fila de eco, y hasta dónde retroceden los anillos al comparar. Solo cambia la visualización, no el análisis. Un valor que cubre compases completos alinea un patrón que se repite entre las filas de eco, por ejemplo 8 para dos compases de 4/4 o 6 para dos compases de 3/4.
- **Tempogram**, **Timing lanes**, **Echo rows**, **Beat lens** (activado o desactivado; de forma predeterminada están activados **Timing lanes** y **Beat lens**) - Muestran u ocultan la franja del tempograma, los carriles principales, las filas de eco y la lente de tiempos. Los paneles restantes crecen para ocupar el espacio, y el encabezado siempre se muestra. Ocultar un panel solo cambia la visualización: el análisis continúa, y el panel vuelve a mostrar todo su historial cuando lo reactivas.

### Guía de Visualización

La pantalla tiene cinco partes: el encabezado, la franja del tempograma, los carriles principales, las filas de eco y la lente de tiempos. En una pantalla ancha, la lente de tiempos se sitúa a la derecha de los carriles y, cuando solo se muestran estos dos paneles, como al principio, sus filas se alinean con las de los carriles, de modo que cada banda se lee en una sola línea; en una pantalla alta, todas las partes se apilan de arriba abajo. Al ocultar paneles con sus casillas, los paneles restantes ocupan el espacio; el encabezado siempre permanece. Los golpes se clasifican en tres bandas: **Low** (bombo y bajo), **Mid** (caja, voces y la mayoría de los instrumentos) y **High** (hi-hats y platillos). Todas las bandas comparten un mismo color; en los carriles, las filas de eco y la lente de tiempos, cada banda tiene su propia fila, con **High** arriba y **Low** abajo. Los nombres de los ejes, los valores de las marcas y las etiquetas de fila **High**, **Mid** y **Low** se dibujan sobre los gráficos. La pantalla solo cuenta tiempos; no detecta compases ni el tiempo 1.

- **Encabezado**:
  - La luz se enciende una vez por cada pulso mostrado y se desvanece rápidamente; **Metronome Click** sigue esos mismos pulsos. El destello es más débil cuando baja la confianza. Durante **searching** queda un círculo hueco, aunque un pulso ya detectado aún puede encenderlo. La luz y el clic responden antes que el historial analizado.
  - El BPM procede de los pulsos confirmados del análisis. **LOCKED** significa que se muestran pulsos nuevos; **searching**, que se ocultan. Searching no borra un tempo o un análisis temporal ya disponible.
  - **×½** y **×2** - La mitad y el doble del tempo mostrado.
  - **strongest** - El tempo con mayor apoyo actual en el tempograma. Puede diferir del tempo del historial analizado, que se muestra con retraso.
  - **swing** - La proporción entre la primera y la segunda mitad de un tiempo, a partir de la posición típica del contratiempo en los últimos 32 tiempos. 1.00:1 es recto y 2.00:1 es un shuffle de tresillo.
  - **jitter** - La dispersión aleatoria típica de los golpes alrededor de su posición media en la lente de tiempos, en ms. Las partes ajustadas y programadas marcan cerca de 0; una interpretación más suelta marca más alto.
  - Leyenda: **○ timing unavailable**, **◎ new vs N / 2N beats ago** y **beat re-aligned** para la línea discontinua.
  - Un valor que todavía no está disponible se muestra como —.
- **Tempograma**: Muestra los últimos 20 segundos. **Time** avanza de izquierda a derecha; **Tempo (BPM)** abarca 30–480 en escala logarítmica. El brillo expresa el apoyo relativo a cada tempo, no la probabilidad de que sea correcto. Las bandas a mitad o doble tempo sugieren otros niveles de pulso. La línea continua **adopted** muestra el tempo de los pulsos confirmados; **×2** y **×½**, discontinuas, muestran sus múltiplos. El historial conserva el instante del audio que representa, mientras las líneas llegan al borde derecho con el último tempo confirmado. Una confianza menor las atenúa. El silencio vacía la columna actual.
- **Carriles principales**: Muestran los pulsos más recientes, incluidas las últimas estimaciones, con el último a la derecha. **Span (beats)** fija su amplitud y el título es **Last N beats**. Hay una fila por banda, con **Beats** en horizontal y **Timing (ms)** en vertical. Las guías de pulsos y corcheas aparecen donde hay análisis. Cada punto es un golpe detectado, unido al centro por una línea; cuanto mayor es, más segura es la detección. Los puntos aparecen en cuanto se detectan los golpes. Sus posiciones más recientes son estimaciones que se actualizan continuamente a medida que llega más sonido. Los puntos se desplazan suavemente hacia la posición estimada en cada momento y quedan fijos cuando el análisis los confirma unos 1–2 segundos después. Los carriles y las filas de eco se desplazan suavemente con el sonido. Siguen desplazándose al último tempo disponible durante el silencio o cuando se detiene la reproducción, de modo que los golpes antiguos salen de la zona visible.
  - La altura de un punto en su carril indica su desfase: por encima del centro del carril (0 ms) va retrasado; por debajo, adelantado. Unas líneas de puntos marcadas **+20** y **−20** señalan ±20 ms, y los golpes que superan ±30 ms se quedan en el borde del carril. El desfase se mide desde la semicorchea o la posición de tresillo más cercana, según la cuadrícula que siga la música, y se muestra en relación con el desfase típico de los 16 tiempos anteriores. Por eso un retraso constante compartido por todas las partes no se muestra; los carriles indican cómo difiere cada golpe del promedio reciente.
  - Un círculo hueco es un golpe sin análisis de pulso disponible. Se sitúa en el centro porque su sincronización es desconocida.
  - Un anillo marca un golpe ausente en la misma banda y posición uno o dos intervalos antes. Los anillos comienzan tras un intervalo desde el inicio del análisis o la realineación de la cuadrícula.
  - Una zona sombreada indica que no hay análisis temporal. **searching** en el encabezado por sí solo no elimina la sincronización.
  - Una línea discontinua marca una realineación de la cuadrícula al cambiar la posición o el nivel del pulso. La lente, swing y jitter comienzan un resumen nuevo allí.
- **Filas de eco**: ciclos de tantos tiempos como fije **Span (beats)**, apilados con el más reciente arriba y separados por líneas. El eje horizontal es **Beats**, y el vertical, **Cycles ago**, numera cada fila. Mientras se muestran los carriles principales, las filas empiezan un ciclo atrás, en 1, y el rótulo dice **Previous N-beat cycles**. Con los carriles principales ocultos, la fila superior es el ciclo actual, en 0, el rótulo dice **Recent N-beat cycles** y, si hay espacio, esa fila lleva los nombres de las bandas. Como los tiempos se alinean verticalmente, un patrón que se repite cada ciclo forma columnas verticales, y un cambio las rompe. Las filas de eco muestran la banda de cada golpe, con **High** arriba y **Low** abajo dentro de cada fila, pero no su desfase. Los círculos huecos, los anillos, el sombreado y las líneas discontinuas tienen el mismo significado que en los carriles principales.
- **Lente de pulso**: Resume hasta los últimos 32 pulsos confirmados desde el inicio del análisis o la realineación. Las columnas de **Position in beat** son **1**, las semicorcheas **e**, **&**, **a** y los tresillos **⅓**, **⅔**. Cada banda tiene una fila etiquetada, alineada con la banda correspondiente al lado de los carriles.
  - La marca vertical muestra cuánto se adelanta (izquierda) o se retrasa (derecha) esa banda en esa posición, en promedio. La escala superior cubre ±30 ms, con marcas en ±20 ms. La barra sombreada alrededor de la marca muestra la dispersión (± una desviación estándar). Una marca más opaca indica que esa posición suena con más frecuencia; una posición necesita al menos cuatro golpes para aparecer.
  - Cuando se actualizan los valores, las marcas y el ancho de las barras cambian suavemente hacia los nuevos valores, cada vez más despacio a medida que se acercan a ellos.
  - Los desfases se miden respecto al conjunto: si todo suena junto, cada marca queda en el centro. La lente muestra cómo difieren las partes entre sí.
  - Los desfases de 3 ms o más se etiquetan en ms. Los desfases menores se dibujan sin etiqueta, porque los desfases entre bandas por debajo de unos 3 ms no se pueden medir de forma fiable.
  - Hasta que haya análisis de pulso, muestra **waiting for a steady beat**. Sigue disponible durante **searching** si existe análisis confirmado.
- La confianza atenúa el texto y las líneas de tempo, carriles, ecos, lente, swing y jitter. Una lectura tenue indica menor confianza, no una interpretación menos precisa. La dispersión rítmica se ve en las alturas de los puntos, **jitter** y las barras. **LOCKED** determina si aparecen pulsos nuevos en la luz y el clic.
- Cuando el reproductor de EffeTune empieza un tema nuevo, el análisis se reinicia automáticamente desde el principio del tema y la pantalla conserva su historial. El botón **Reset** borra la pantalla y reinicia el análisis, por ejemplo cuando otra aplicación cambia de tema.
- La entrada estéreo se analiza promediando los dos primeros canales; la entrada mono se usa directamente.

### Visualización
- Pasa el cursor o toca y arrastra para leer valores. Los carriles y ecos muestran cuántos pulsos han pasado, la banda y la sincronización del golpe más próximo (— si no está disponible). El tempograma muestra tempo, tiempo, **Tempo support** (apoyo relativo, 100% para el tempo más apoyado) y **Adopted**. La lente muestra el desplazamiento y la dispersión de cada banda.

### Limitaciones

- La precisión puede bajar con grandes variaciones de tempo, ritmos dispersos, interpretaciones acústicas o piano solo. El sonido ambiente, el ruido y los tonos sostenidos pueden producir pulsos incorrectos; **LOCKED** no garantiza que sean correctos. Compara el clic con el ritmo que oyes y desactívalo si no resulta útil.
- El analizador puede asentarse en un nivel de pulso distinto al que elegiría un oyente, y entonces el piloto y el clic pueden ir al doble, a la mitad, a dos tercios o a una vez y media el tempo que sientes. En la música clásica, en la tocada con rubato y en alguna otra, además, tarda más en bloquearse y salta brevemente a otro nivel con más frecuencia que en la música de pulso estable. **×½**, **×2** y **strongest** muestran tempos alternativos probables. Si el tempo detectado o la posición del pulso no coinciden con lo que oyes, prueba a acotar el rango con **Min BPM** y **Max BPM** alrededor del tempo esperado y vuelve a escuchar.
- Con patrones rítmicos escasos, del tipo de la clave, el pulso puede bloquearse en el contratiempo.
- Cuando el tempo cambia de forma continua, como en una aceleración gradual o un rubato libre, el pulso lo sigue con un pequeño retraso, así que el clic puede sonar algo adelantado o retrasado hasta que el tempo se estabiliza.
- En algunos temas de tempo estable, la posición del pulso se realinea ocasionalmente, como muestra la línea discontinua, aunque la música no haya cambiado.
- En mezclas densas y grabaciones ruidosas, los carriles **Mid** y **High** muestran más puntos donde en realidad no sonó ningún instrumento. El carril **Low** pasa por alto algunas notas graves del piano.
- No hay detección de compás ni de métrica: la pantalla se organiza solo por tiempos y no muestra dónde empieza un compás.
- El análisis está disponible a 8, 11,025, 16, 22,05, 24, 32, 44,1, 48, 88,2, 96, 176,4, 192, 352,8 y 384 kHz. A otras frecuencias, como 64 kHz, el audio sigue pasando, pero no hay análisis rítmico ni clics. Elige una frecuencia compatible para utilizarlos.

## Spectrogram

Crea patrones coloridos que muestran cómo cambia tu música con el tiempo. Los colores indican la intensidad de cada sonido, mientras que la posición vertical muestra su frecuencia.

El gráfico se desplaza de derecha a izquierda a una velocidad constante, con marcas cada segundo.

### Guía de Visualización
- Los colores muestran qué tan fuertes son diferentes frecuencias:
  - Colores oscuros: Sonidos suaves
  - Colores brillantes: Sonidos fuertes
  - Observa cómo los patrones cambian con la música
- La posición vertical muestra la frecuencia:
  - Abajo: Sonidos graves
  - Medio: Instrumentos principales
  - Arriba: Frecuencias altas

### Visualización
- Pasa el cursor sobre la pantalla, o tócala y desliza el dedo sobre ella, para leer los valores en ese punto.

### Lo Que Puedes Ver
- Melodías: Líneas fluidas de color
- Ritmos: Franjas verticales
- Graves: Colores brillantes en la parte inferior
- Armonías: Múltiples líneas paralelas
- Diferentes instrumentos crean patrones únicos

### Parámetros
- **Color** - **Normal** usa el color del gráfico del tema y se ilumina con las frecuencias más fuertes. **Heatmap** (predeterminado) conserva la escala multicolor original. El cambio recolorea el historial existente.
- **DB Range** - Qué tan vibrantes son los colores (-144dB a -48dB)
  - Números más bajos: Ver más detalles sutiles
  - Números más altos: Enfocarse en los sonidos principales
- **Points** - Tamaño de FFT usado para la visualización (256 a 16384)
  - Números más altos: Más detalle de frecuencia, pero actualizaciones temporales más lentas
  - Números más bajos: Movimiento más rápido, pero menos detalle de frecuencia
  - Con **Log (HQ)**, Points define la ventana de análisis corta; una ventana cuatro veces más larga mejora la separación de las frecuencias bajas.
- **Frequency Scale** - **Log** da más espacio a las frecuencias bajas. **Log (HQ)** añade una medición más larga para separar con mayor claridad los graves cercanos, manteniendo la medición corta para los agudos. Usa más procesamiento y los cambios graves pueden tardar más en aparecer o desaparecer, pero no cambia el audio. **Linear** distribuye intervalos de frecuencia iguales a distancias iguales.
- **Keyboard** - Muestra a la derecha del gráfico una guía estática de teclado que relaciona las notas musicales con las frecuencias. No cambia el análisis ni el audio. La disposición de las teclas sigue **Log**, **Log (HQ)** o **Linear**; **Log (HQ)** usa el mismo espaciado logarítmico que **Log**, y con **Linear** las teclas graves se ven más estrechas.
- El analizador usa el promedio de los canales izquierdo y derecho. La entrada mono se analiza directamente.

## Spectrum Analyzer

Crea una visualización en tiempo real de las frecuencias de tu música, desde graves profundos hasta agudos altos. Es como ver los ingredientes individuales que componen el sonido completo de tu música.

### Guía de Visualización
- El lado izquierdo muestra frecuencias graves (batería, bajo)
- El medio muestra frecuencias principales (voces, guitarras, piano)
- El lado derecho muestra frecuencias altas (platillos, brillo, aire)
- Picos más altos significan mayor presencia de esas frecuencias
- La línea más gruesa muestra el sonido actual
- La línea más fina sigue los picos recientes y desciende suavemente al desaparecer
- En la visualización **Bar**, cada barra muestra el nivel más alto en una parte de igual ancho de la pantalla. **Log** y **Log (HQ)** usan anchos de octava iguales; **Linear** usa anchos de frecuencia iguales.
- La marca fina sobre una barra muestra su pico reciente y desciende suavemente.
- Observa cómo diferentes instrumentos crean diferentes patrones

### Visualización
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

### Lo Que Puedes Ver
- Caídas de Graves: Grandes movimientos a la izquierda
- Melodías Vocales: Actividad en el medio
- Agudos Nítidos: Destellos a la derecha
- Mezcla Completa: Cómo todas las frecuencias trabajan juntas

### Parámetros
- **Color** - **Normal** (predeterminado) conserva los colores del gráfico del tema. **Heatmap** ilumina los niveles más altos y **Note Colors** sigue los colores de las notas a lo largo del eje de frecuencias. Se aplica tanto a **Line** como a **Bar**. Con **Bar** y **Note Colors**, cada barra y su marca de pico usan un solo color según la frecuencia central de la banda.
- **DB Range** - Qué tan sensible es la visualización (-144dB a -48dB)
  - Números más bajos: Ver más detalles sutiles
  - Números más altos: Enfocarse en los sonidos principales
- **Points** - Cuánta separación muestra entre frecuencias cercanas (256 a 16384)
  - Números más altos: Más detalle de frecuencia, con actualizaciones más lentas
  - Números más bajos: Actualizaciones más rápidas, con menos detalle de frecuencia
  - Con **Log (HQ)**, Points define la ventana de análisis corta; una ventana cuatro veces más larga mejora la separación de las frecuencias bajas.
- **Frequency Scale** - **Log** da más espacio a las frecuencias bajas. **Log (HQ)** añade una medición más larga para separar con mayor claridad los graves cercanos, manteniendo la medición corta para los agudos. Usa más procesamiento y los cambios graves pueden tardar más en aparecer o desaparecer, pero no cambia el audio. **Linear** distribuye intervalos de frecuencia iguales a distancias iguales.
- **Display** - Solo cambia el aspecto del espectro; no cambia el análisis ni el audio.
  - **Line** (predeterminado): Muestra el espectro como líneas continuas.
  - **Bar**: Muestra como barra el nivel más alto de cada banda de visualización.
- **Keyboard** - Muestra debajo del gráfico una guía estática de teclado que relaciona las notas musicales con las frecuencias. No cambia el análisis ni el audio. La disposición de las teclas sigue **Log**, **Log (HQ)** o **Linear**; **Log (HQ)** usa el mismo espaciado logarítmico que **Log**, y con **Linear** las teclas graves se ven más estrechas.
- El analizador usa el promedio de los canales izquierdo y derecho. La entrada mono se analiza directamente.

### Formas Divertidas de Usar Estas Herramientas

1. Explorando Tu Música
   - Observa cómo diferentes géneros crean diferentes patrones
   - Ve la diferencia entre música acústica y electrónica
   - Observa cómo los instrumentos ocupan diferentes rangos de frecuencia

2. Aprendiendo Sobre el Sonido
   - Ve los graves en la música electrónica
   - Observa las melodías vocales moverse a través de la visualización
   - Observa cómo la batería crea patrones nítidos

3. Mejorando Tu Experiencia
   - Usa el Level Meter para revisar los picos de señal después de añadir efectos
   - Mira el Spectrum Analyzer bailar con la música
   - Crea un espectáculo de luces visual con el Spectrogram

## Stereo Meter

Una fascinante herramienta de visualización que te permite ver cómo tu música crea una sensación de espacio a través del sonido estéreo. Observa cómo diferentes instrumentos y sonidos se mueven entre tus altavoces o auriculares, añadiendo una emocionante dimensión visual a tu experiencia de escucha.

### Guía de Visualización
- **Pantalla de Diamante** - La ventana principal donde la música cobra vida:
  - Centro: Momentos muy silenciosos o momentos en los que la señal combinada está cerca de cero
  - Arriba/Abajo: Sonido compartido por los canales izquierdo y derecho, como contenido centrado o cercano a mono
  - Izquierda/Derecha: Contenido de diferencia o fuera de fase entre canales
  - Los sonidos mucho más fuertes en un lado pueden aparecer hacia las esquinas etiquetadas
  - Los puntos verdes bailan con la música actual
  - La línea blanca traza los picos musicales
  - La línea blanca de picos decae con cada muestra de audio, por lo que su movimiento se mantiene igual independientemente del tamaño del bloque de procesamiento
- **Correlation Bar** (lado izquierdo)
  - Muestra la correlación entre los canales izquierdo y derecho
  - Arriba (+1.0): Izquierda y derecha son casi iguales, a menudo con sonido centrado
  - Medio (0.0): Relación débil entre canales, a menudo por ambiente amplio o contenido distinto en izquierda/derecha
  - Abajo (-1.0): Izquierda y derecha son casi de polaridad opuesta, lo que puede sonar débil en altavoces
- **Barra de Balance** (Abajo)
  - Muestra si un altavoz suena más fuerte que el otro
  - Centro: Música igualmente fuerte en ambos altavoces
  - Izquierda/Derecha: Música más fuerte en un altavoz
  - Los números muestran cuánto más fuerte en decibelios (dB)

### Lo Que Puedes Ver
- **Sonido Centrado**: Movimiento vertical fuerte en el medio
- **Sonido Espacioso**: Actividad extendida por toda la pantalla
- **Efectos Especiales**: Patrones interesantes en las esquinas
- **Balance de Altavoces**: Hacia dónde apunta la barra inferior
- **Correlación de Canales**: Lo que muestra la barra de correlación izquierda

### Parámetros
- **Window** (10-1000 ms) - Cuánto audio reciente se muestra en la visualización
  - Valores más bajos: Ver cambios musicales rápidos
  - Valores más altos: Ver patrones de sonido generales
  - Por defecto: 100 ms funciona bien para la mayoría de la música
- **Gain** (0-24 dB; valor predeterminado: 0 dB) - Amplía solo los puntos y la línea de picos del rombo. Súbelo para ver mejor los patrones de los pasajes más suaves. No cambia el audio ni las lecturas de correlación y balance.

### Disfrutando Tu Música
1. **Observa Diferentes Estilos**
   - La música clásica suele mostrar patrones suaves y equilibrados
   - La música electrónica puede crear diseños salvajes y expansivos
   - Las grabaciones en vivo pueden mostrar movimiento natural de la sala

2. **Descubre Cualidades del Sonido**
   - Ve cómo diferentes álbumes usan efectos estéreo
   - Nota cómo algunas canciones se sienten más amplias que otras
   - Observa cómo los instrumentos se mueven entre altavoces

3. **Mejora Tu Experiencia**
   - Prueba diferentes auriculares para ver cómo muestran el estéreo
   - Compara grabaciones antiguas y nuevas de tus canciones favoritas
   - Observa cómo diferentes posiciones de escucha cambian la visualización

¡Recuerda: Estas herramientas están diseñadas para mejorar tu disfrute de la música agregando una dimensión visual a tu experiencia de escucha. ¡Diviértete explorando y descubriendo nuevas formas de ver tu música favorita!
