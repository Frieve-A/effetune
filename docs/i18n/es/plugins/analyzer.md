---
title: "Plugins de análisis - Analizador de espectro, espectrograma, vúmetro y medidor LUFS - EffeTune"
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

Muestra el nivel de cada canal en un medidor de aguja clásico, sin cambiar el sonido. Úsalo para seguir de un momento a otro cuánto suena tu música, o para ver cómo se lee tu reproducción en las escalas usadas en la radiodifusión y el streaming: VU, PPM, pico y sonoridad (LUFS). **Custom** permite combinar un detector, el movimiento de la aguja y una escala para crear tu propio medidor.

### Guía de uso

- **Sigue el nivel medio con VU**: observa la aguja durante una canción. Las estrofas tranquilas y los estribillos intensos muestran una diferencia clara, mientras que los golpes cortos de batería apenas mueven la aguja.
- **Comprueba el recorte con True Peak**: coloca Analog Meter después de tus efectos de EQ y ganancia, y reproduce la parte más intensa de una pista. Si la lectura supera 0 dBFS o se enciende el indicador over, la cadena puede recortar; baja la ganancia hasta que los picos se mantengan por debajo de 0 dBFS, con un pequeño margen como -1 dBFS.
- **Compara canciones con Loudness**: ajusta **Target** a una referencia de streaming como -14 LUFS, pulsa **Reset** al empezar una canción o álbum y reprodúcelo entero. El valor Integrated muestra su sonoridad global y el máximo True Peak muestra su pico más alto, lo que sirve de guía para igualar el volumen entre las canciones de un álbum o lista. LRA te permite comparar cuánto varía la sonoridad de cada canción.
- **Crea tu medidor con Custom**: empieza con **Bouncy VU** para una aguja más animada, **Slow RMS** para observar el nivel medio con calma o **Fast Peak** para seguir picos breves. Ajusta la velocidad con **Needle Response** y el rebote con **Overshoot**. Puedes conseguir una subida y una caída parecidas a PPM, pero los detectores de pico de Custom suben al instante; usa **PPM** para la respuesta PPM estándar.

### Presets del sistema

Haz clic en **Preajustes de efecto** en el encabezado del efecto para elegir un medidor estándar o personalizado en un solo paso. Un preset que cambia **Mode** reinicia la medición; al pasar de un preset de Loudness a otro, la medición continúa.

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
- **Bouncy VU** - Custom con el detector y la escala de VU y un sobreimpulso del 15% para una aguja con más rebote.
- **Slow RMS** - Custom con un promedio RMS de 3 s, una respuesta de aguja de 1000 ms y sin sobreimpulso. La escala dB sitúa el 0 en -18 dBFS y llega hasta -60 dBFS.
- **Fast Peak** - Custom con detección True Peak, liberación del detector de 0,5 s, respuesta de aguja de 10 ms y sin sobreimpulso. La escala dBFS cubre los 40 dB superiores y muestra la lectura en dBTP.

### Parámetros

Solo se muestran los controles que se aplican al **Mode** seleccionado. En **Custom**, todos sus controles permanecen visibles; los que no se aplican quedan desactivados, por lo que el panel de ajustes mantiene la misma altura.

- **Mode** - Selecciona el tipo de medidor: **VU** (predeterminado), **PPM**, **RMS**, **Sample Peak**, **True Peak**, **Loudness** o **Custom**. Cada modo mueve la aguja de forma distinta y usa su propia escala (consulta Cómo leer la visualización). Cambiar el modo reinicia la medición.
- **Detector** (Custom; predeterminado: Average Rectified) - Elige el nivel que sigue la aguja. **Average Rectified** usa la amplitud absoluta de la señal, promediada por la propia aguja sin una ventana de promedio adicional, como en VU. **RMS** mide la potencia media durante **Integration**. **Sample Peak** detecta el valor de muestra más alto; **True Peak** también estima los picos entre muestras. Ambos detectores de pico suben al instante y caen según **Release**. Cambiar el detector reinicia la medición.
- **Integration** (RMS, Custom con detector RMS; de 0,05 a 3 s; predeterminado: 0,3 s) - Define el tiempo de promediado. Los valores más largos dan una aguja más estable y lenta; los más cortos siguen los cambios con mayor rapidez. En Custom, la aguja añade su propia respuesta después de este promedio.
- **Attack** (PPM; de 1 a 20 ms; predeterminado: 5 ms) - Define la rapidez con la que sube la aguja en modo PPM, expresada como la duración de una ráfaga de tono que se lee 2 dB por debajo de un tono constante. Los valores más cortos muestran los picos breves más cerca de su nivel real; los más largos hacen que los picos breves se lean más bajos. 5 ms coincide con el medidor DIN.
- **Release** (PPM, Sample Peak, True Peak, Custom con detector Sample Peak o True Peak; de 0,1 a 5 s; predeterminado: 1,5 s) - Define el tiempo de caída de 20 dB tras un pico. Los valores más largos facilitan la lectura de los picos; los más cortos siguen la música con mayor precisión. En Custom controla la caída del detector, seguida de la respuesta de la aguja. 1,5 s coincide con el medidor DIN y con el medidor de pico digital estándar.
- **Needle Response** (Custom; de 1 a 3000 ms; predeterminado: 300 ms) - Define cuánto tarda la aguja en alcanzar por primera vez el 99% de un nuevo nivel constante del detector. Los valores más bajos dan una aguja más rápida; los más altos, más lenta. El promedio RMS y la liberación de los picos también afectan al movimiento global.
- **Overshoot** (Custom; de 0 a 25%; predeterminado: 1,25%) - Define cuánto sobrepasa la aguja un nuevo nivel constante del detector, como porcentaje del cambio de nivel. Los valores más altos dan más rebote; con 0, la aguja se acerca sin sobrepasarlo.
- **Dial** (Custom; predeterminado: VU) - Elige **VU**, **DIN**, **BBC**, **dB** o **dBFS** independientemente del detector y del movimiento de la aguja. VU, DIN y BBC usan las escalas descritas abajo. En dB, la marca 0 es **Reference** y el tope es 0 dBFS. En dBFS, el tope es 0 dBFS y las lecturas se muestran en dBTP si **Detector** es True Peak.
- **Reference** (VU, PPM, RMS, Custom salvo con escala dBFS; de -30 a 0 dBFS; predeterminado: -14 dBFS) - Define el nivel digital que coincide con la marca de referencia del medidor. El valor predeterminado se adapta a la mayoría de las grabaciones comerciales terminadas; con las alineaciones de estudio de -18 o -20 dBFS (consulta Presets del sistema), un CD corriente suele mantener la aguja cerca del tope de la escala. Súbelo cuando las grabaciones intensas lleven la aguja al tope de la escala; bájalo cuando las grabaciones tranquilas apenas la muevan.
- **Range** (PPM con la escala DIN o dB, RMS, Sample Peak, True Peak, Custom con escala DIN, dB o dBFS; de 20 a 60 dB; predeterminado: 40 dB) - Define hasta dónde llega la escala hacia abajo. Ámplialo para ver pasajes tranquilos; redúcelo para repartir mejor la parte superior de la escala.
- **PPM Scale** (PPM; predeterminado: DIN) - Selecciona la escala del PPM: **DIN**, **BBC** o **dB** (consulta Cómo leer la visualización).
- **Peak Hold** (PPM, RMS, Sample Peak, True Peak, Custom; de 0 a 10 s; predeterminado: 1 s) - Define cuánto tiempo permanece la marca de pico en la lectura más alta reciente y cuánto tiempo sigue encendido el indicador over. Con 0 se desactiva la marca y el indicador over permanece encendido 1 s.
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
| Custom | Sigue **Detector**, con velocidad definida por **Needle Response** y rebote por **Overshoot**. Los valores predeterminados dan el mismo movimiento que VU. | Se elige con **Dial**, independientemente del movimiento de la aguja. |

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

### Cómo leer la visualización
- La barra horizontal se extiende más hacia la derecha cuanto mayor es el nivel de señal
- El marcador blanco mantiene un pico nuevo durante un segundo y luego desciende suavemente
- OVERLOAD indica que la señal superó el rango digital seguro y puede distorsionar
- Para una reproducción limpia, evita niveles rojos o avisos OVERLOAD frecuentes; ajusta el volumen real de escucha en tu dispositivo

## Note Spectrogram

Muestra las frecuencias fundamentales (F0) estimadas de A0 a C8 en un piano roll que se desplaza, sin modificar el audio. Úsalo para seguir las notas de los acordes, las líneas vocales y melódicas, las líneas de bajo y las notas que se superponen en distintas octavas, con colores por instrumento y resaltado opcionales.

### Guía de uso

- **Acordes y melodías**: Los acordes aparecen como filas brillantes simultáneas; las melodías y las líneas de bajo trazan recorridos a través de las filas de notas.
- **Seguir la voz o el bajo**: Elige **Instrument (3)**, o mantén **Note Colors** y selecciona **Vocal** o **Bass** en **Highlight**. Usa **Instrument (9)** para una agrupación de instrumentos más detallada.
- **Precisión de las estimaciones**: Las estimaciones de altura y de instrumento son una ayuda visual para escuchar, no una transcripción exacta. Los sonidos superpuestos, la percusión o el ruido pueden producir estimaciones ambiguas, y la batería no se clasifica. Las estimaciones de instrumento usan las notas anteriores como pistas, por lo que son menos fiables justo después de activarlas o de mover la posición de reproducción; una vez lista, una estimación no se revisa.

### Grupos de instrumentos

**Instrument (3)** agrupa las alturas en **Vocal**, **Bass** y **Other** (todos los grupos siguientes salvo Vocal y Bass).

**Instrument (9)** separa las alturas en nueve grupos:
- **Vocal**: Canto humano grabado, incluidas voces solistas y coros.
- **Bass**: Bajo acústico, eléctrico y de sintetizador.
- **Guitar**: Guitarras acústicas, eléctricas limpias y distorsionadas.
- **Piano**: Pianos acústicos y eléctricos, clave y clavinet.
- **Strings**: Cuerdas solistas y en conjunto, pizzicato, arpa y cuerdas de sintetizador.
- **Wind**: Metales y maderas, incluidos saxofones y flautas.
- **Synth**: Leads y pads de sintetizador.
- **Organ**: Órganos, acordeón y armónica.
- **Other**: Percusión afinada (celesta, vibráfono), sonidos de coro o voz sintetizados, efectos de sintetizador, golpes orquestales, instrumentos étnicos y efectos de sonido.

### Parámetros

- **Color** - Selecciona los colores de la visualización sin cambiar la detección de alturas (al cambiarlo se recolorea el historial existente):
  - **Normal** (predeterminado): Color del trazado de gráficos del tema.
  - **Note Colors**: Un color distinto por clase de altura, repetido en todas las octavas.
  - **Instrument (3)**: Colores para Vocal, Bass y Other.
  - **Instrument (9)**: Colores para los nueve grupos de instrumentos anteriores.
- **Highlight** - Destaca un grupo concreto (**Vocal**, **Bass**, **Other (3)**, **Guitar**, **Piano**, **Strings**, **Wind**, **Synth**, **Organ** u **Other (9)**) llevando las notas hacia un gris neutro cuanto menos probable es que pertenezcan a ese grupo, sin cambiar el grosor que indica el volumen. **None** (predeterminado) desactiva el resaltado.
  - El análisis de ataques y de instrumentos consume CPU adicional. Para reducir al mínimo el uso de CPU, desactiva **Onsets**, elige **Normal** o **Note Colors** y pon **Highlight** en **None**.
- **Pitch Resolution** - Selecciona el detalle vertical de altura sin borrar el historial:
  - **1/12 Octave** (predeterminado): Una fila por semitono.
  - **High**: Coloca las alturas en su posición estimada en cents para mostrar el vibrato y las inflexiones de tono.
- **Layout** - **Horizontal** (predeterminado; teclado abajo y el historial se desplaza hacia arriba) o **Vertical** (teclado a la derecha y el historial se desplaza hacia la izquierda).
- **Volume** - Representa el volumen relativo con el grosor de las barras y con medidores semicirculares en el borde del teclado (activado de forma predeterminada). Si está desactivado, el grosor de las barras es fijo.
- **Onsets** - Marca los ataques estimados de las notas con triángulos (▼ en Horizontal, ▶ en Vertical; desactivado de forma predeterminada). El centro de la base de cada triángulo marca el momento y la altura del ataque, de modo que los ataques repetidos de una altura sostenida reciben marcas separadas. Desactivarlo no detiene el análisis de instrumentos mientras un **Color** de instrumento o **Highlight** lo necesite.
- **Time Span** (1 a 10 s; predeterminado: 2 s) - Duración del historial visible en el piano roll.
- **Lowest Note** / **Highest Note** - Establecen el rango de alturas que se analiza y se muestra (predeterminado: E1 a G6).

### Cómo leer la visualización

- **Actualización de alturas**: El sonido nuevo aparece de inmediato y se refina unos 40, 80 y 160 ms después con el contexto del audio que sigue, sin añadir retardo a la visualización ni afectar a **Sincronizar elementos visuales con el audio**.
- **Cuadrícula y teclado**: Las líneas en cada C marcan los límites de las octavas, las guías entre E y F se ven en todos los modos y las filas de las teclas negras usan un fondo más oscuro. Las teclas del piano se iluminan según la confianza de la altura actual.
- **Intensidad del color**: La intensidad del color siempre indica la confianza de la altura. Cuando la entrada es demasiado débil para analizarla, el piano roll permanece oscuro.
- **Colores de instrumento y resaltado**: Los colores de instrumento mezclan los colores de los grupos según sus probabilidades estimadas. Los colores aparecen en las posiciones correspondientes del historial cuando la estimación del instrumento está lista; las notas pendientes de clasificar se muestran en gris neutro. La leyenda enumera los grupos mostrados y, mientras el resaltado está activo, añade **Highlight:** seguido del grupo seleccionado. Pasa el cursor sobre un grupo de la leyenda para resaltarlo temporalmente.
- **Barras de volumen**: Con **Volume** activado, el grosor de las barras abarca un rango relativo de 24 dB, y un semicírculo suave en el borde del teclado sube de inmediato con el volumen actual y baja a 20 dB/s.

### Visualización
- Pasa el cursor sobre el historial, o tócalo y desliza el dedo, para leer la nota, el tiempo, **Salience** (confianza de la altura), **Level** (dB) y, cuando el análisis de instrumentos está activo, las probabilidades estimadas de los grupos: **Vocal**, **Bass** y **Other** con **Instrument (3)**, y los nueve grupos en los demás casos, más el grupo de **Highlight** cuando no está entre ellos (**Not classified** para las notas sin estimación).

## Oscilloscope

Muestra la forma de la onda sonora en tiempo real para que veas golpes, ataques marcados y cambios de volumen mientras escuchas. Los ajustes de disparo estabilizan la imagen cuando la onda se repite.

### Guía de uso
- Ajusta **Display Time** a 1–20 ms y **Trigger Mode** a **Auto** para observar un ciclo de onda repetitivo.
- Ajusta **Display Time** a 1.000–10.000 ms y **Trigger Mode** a **Off** para seguir los golpes y la envolvente de volumen mientras se desplazan suavemente de derecha a izquierda.
- En los modos **Auto** y **Normal**, el trazo se actualiza cuando se ha recogido todo el intervalo de **Display Time**.

### Parámetros
- **Display Time** (1 a 10.000 ms) - Intervalo de tiempo visible. Los valores cortos muestran ciclos de onda individuales; los largos, la envolvente general.
- **Trigger Mode**:
  - **Auto**: Se actualiza continuamente aunque no haya disparo.
  - **Normal**: Solo se actualiza cuando se produce un disparo y mantiene la última captura hasta el siguiente.
  - **Off**: Se desplaza continuamente de derecha a izquierda; los ajustes de disparo no tienen efecto.
- **Trigger Level** (-1 a 1) - Umbral de amplitud normalizada que inicia la captura (se detecta en la señal mono o en el promedio de L/R).
- **Trigger Edge** - **Rising** (dispara al cruzar hacia arriba) o **Falling** (dispara al cruzar hacia abajo).
- **Holdoff** (0,1 a 10 ms) - Tiempo mínimo de espera entre disparos.
- **Display Level** (-96 a 0 dB; predeterminado: 0 dB) - Nivel que se muestra en los bordes superior e inferior de la pantalla. Con 0 dB se ve todo el rango de ±1; los valores más bajos amplían las señales más débiles.
- **Vertical Offset** (-1 a 1) - Desplaza la onda verticalmente; los valores positivos la suben.

### Cómo leer la visualización
- **Eje horizontal**: Tiempo en milisegundos o segundos.
- **Eje vertical**: Amplitud normalizada, escalada por **Display Level** y desplazada por **Vertical Offset**.
- **Línea o banda de envolvente**: Con tiempos cortos se dibuja una línea continua; con tiempos largos, una banda rellena de mínimos y máximos, para que los picos breves sigan visibles aunque muchas muestras compartan la misma columna de píxeles.

### Visualización
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo, para leer el tiempo y la amplitud (o Minimum/Maximum con tiempos largos).

## Pitch Meter

Sigue una única frecuencia fundamental (F0) cada vez en un piano roll de dos segundos que se desplaza, sin modificar el audio. Úsalo para comprobar la afinación y el movimiento de altura de una voz o un instrumento solista.

### Guía de uso

- Toca o canta una sola nota sostenida y observa si el trazo se mantiene centrado en la fila de la nota o se desvía hacia arriba (sostenido) o hacia abajo (bemol).
- El vibrato, los glissandos y las inflexiones de tono aparecen como curvas suaves a través de las filas de notas.
- Como Pitch Meter sigue una sola altura dominante, los acordes, las mezclas densas o la percusión pueden interrumpir el trazo o hacerlo saltar de octava; para material polifónico usa [Note Spectrogram](#note-spectrogram).
- La entrada estéreo se analiza promediando los dos primeros canales (la entrada mono se usa directamente), por lo que un sonido con polaridad opuesta en los dos canales puede cancelarse y no dejar trazo.

### Parámetros

- **Color** - Cambia el color del trazo sin afectar a la detección: **Normal** (predeterminado; color del trazado del tema), **Heatmap** (volumen relativo en un rango de 24 dB) o **Note Colors** (colores por clase de altura).
- **Layout** - **Horizontal** (predeterminado; teclado abajo y el historial se desplaza hacia arriba) o **Vertical** (teclado a la derecha y el historial se desplaza hacia la izquierda).
- **Reference A4** (400 a 480 Hz; predeterminado: 440 Hz) - Referencia de afinación que se usa para los nombres de nota y las desviaciones en cents.
- **Lowest Note** / **Highest Note** - Establecen el rango de alturas que se analiza y se muestra (predeterminado: C2 a C7; rango completo: A0 a C8).

### Cómo leer la visualización

- La posición del trazo muestra la altura de forma continua entre semitonos; una confianza mayor dibuja una línea más brillante, y el silencio o los sonidos sin altura definida cortan la línea.
- La lectura muestra el nombre de la nota más cercana (con el color de su clase de altura) y la desviación de afinación en cents (`+` sostenido, `-` bemol; por ejemplo, `+3.5 cent`).

### Visualización
- Pasa el cursor sobre la pantalla, o tócala y desliza el dedo, para leer los valores en ese punto.

## Rhythm Analyzer

Detecta el tempo de tu música y muestra, pulso a pulso, dónde caen los golpes de batería y de los instrumentos y lo adelantada o retrasada que toca cada parte, sin cambiar el sonido salvo que **Metronome Click** esté activado. Úsalo para averiguar el BPM de una pista, medir el swing, ver si la caja va por detrás del pulso o localizar redobles y cambios de sección.

### Guía de uso

- **Comprobar el tempo**: Reproduce una pista con un pulso estable. El BPM confirmado y la línea **adopted** aparecen unos 1–2 segundos después del sonido, mientras que **LOCKED** indica que el pulso está activo para la lámpara y el clic. Compara **×½**, **×2** y **strongest** si el analizador se fija al doble o a la mitad del tempo que percibes.
- **Oír dónde cae el pulso**: Activa **Metronome Click** para oír un clic en cada pulso detectado. Coloca Rhythm Analyzer al final de la cadena de efectos mientras escuchas con el clic, y desactiva **Metronome Click** antes de exportar archivos de audio procesados.
- **Corregir fijaciones al doble o a la mitad del tempo**: Si una balada lenta se fija al doble de tempo, baja **Max BPM** por debajo de ese valor; si una pista rápida se fija a la mitad, sube **Min BPM** por encima.
- **Leer el groove y la microtemporización**: Los ritmos programados quedan cerca del centro del carril, con un **jitter** cercano a 0 ms. Una caja que va siempre 15 ms por detrás del bombo aparece como puntos **Mid** por encima del centro del carril en los pulsos 2 y 4, y como una marca **+15** en Beat lens.
- **Leer el swing**: **swing** indica la proporción de retraso de los contratiempos (1.00:1 es recto y 2.00:1, un shuffle de tresillo). En los grooves con swing, los golpes a contratiempo se agrupan en la columna **⅔** de Beat lens en lugar de en **&**.
- **Localizar redobles y cambios**: Los anillos (**◎**) destacan los golpes que no se tocaron en la misma posición del pulso uno o dos ciclos antes, de modo que los redobles de batería y las transiciones de sección resaltan en las **Echo rows**.
- **Cuando muestra searching**: Dejan de producirse nuevos pulsos y clics, pero el análisis continúa; el tempo, Timing lanes y Beat lens siguen visibles y se atenúan a medida que baja la confianza. El silencio borra las lecturas del pulso actual y la columna de Tempogram; el análisis vuelve a empezar cuando regresa el sonido.

### Parámetros

- **Min BPM** (40 a 192; predeterminado: 40) / **Max BPM** (50 a 240; predeterminado: 240) - Rango de búsqueda del tempo (Max BPM se mantiene en al menos 1,25 veces Min BPM; cambiar cualquiera de los dos reinicia el análisis).
- **Metronome Click** (desactivado de forma predeterminada) - Mezcla un clic corto de −10 dBFS en los canales 1 y 2 (solo el canal 1 en mono) en cada pulso detectado; los demás canales no cambian.
- **Span (beats)** (4, 6, 8, 12 o 16; predeterminado: 8) - Número de pulsos que se muestran a lo ancho de Timing lanes y de cada fila de Echo rows (por ejemplo, 8 para dos compases de 4/4 y 6 para dos compases de 3/4).
- **Tempogram**, **Timing lanes**, **Echo rows**, **Beat lens** - Muestran u ocultan cada panel de la visualización (Timing lanes y Beat lens empiezan activados; ocultar un panel no detiene el análisis).

### Cómo leer la visualización

En una pantalla ancha, **Beat lens** se coloca a la derecha de Timing lanes; en una pantalla alta, todos los paneles se apilan. Los golpes se separan en las filas **High** (hi-hats, platillos), **Mid** (caja, voces, instrumentos) y **Low** (bombo, bajo):
- **Cabecera**: Muestra la lámpara que destella con el pulso (más débil cuanto menor es la confianza y hueca durante **searching**), el BPM confirmado (**LOCKED** o **searching**), **×½**, **×2**, el candidato **strongest** de Tempogram, la proporción de **swing** (calculada con los últimos 32 pulsos), el **jitter** (dispersión típica de los golpes alrededor de su posición media, en ms) y la leyenda de símbolos. Los valores que aún no están disponibles se muestran como —.
- **Tempogram**: Historial de 20 segundos del apoyo a cada tempo, con **Time** avanzando de izquierda a derecha y **Tempo (BPM)** de 30 a 480 en escala logarítmica, con la línea continua del tempo **adopted** y las líneas discontinuas **×2** / **×½** superpuestas. El brillo muestra el apoyo relativo a cada tempo, no la probabilidad de que sea el correcto.
- **Timing lanes**: Muestran los golpes de los últimos *N* pulsos (**Span (beats)**; leyenda **Last N beats**); un punto más grande indica un golpe más seguro, y las posiciones más recientes son estimaciones que se asientan unos 1–2 segundos después. La altura del trazo vertical muestra la microtemporización respecto a la cuadrícula de semicorcheas o de tresillos más cercana, comparada con la temporización típica de los 16 pulsos anteriores (guías punteadas de **+20** / **−20** ms; por encima del centro = tarde, por debajo = pronto; los golpes que superan ±30 ms se quedan en el borde del carril). Los círculos huecos (**○**) son golpes cuya temporización no está disponible (se dibujan en el centro del carril), las zonas sombreadas marcan periodos sin análisis de temporización, los anillos (**◎**) marcan golpes nuevos respecto a 1–2 ciclos antes y las líneas verticales discontinuas marcan los reajustes de la cuadrícula de pulsos.
- **Echo rows**: Apila verticalmente los ciclos de *N* pulsos anteriores, con el más reciente arriba, para que los patrones de compás que se repiten se alineen en columnas y los redobles o variaciones resalten. **Cycles ago** numera las filas a partir de 1; con **Timing lanes** oculto, la fila superior es el ciclo actual (0). Cada golpe muestra su banda, pero no su temporización.
- **Beat lens**: Resume, para cada banda, cuánto se adelanta (marca a la izquierda) o se retrasa (marca a la derecha) de media (escala de ±30 ms) y su dispersión (barra sombreada, ± una desviación estándar) en las subdivisiones del pulso (**1**, **e**, **&**, **a**, **⅓**, **⅔**) durante los últimos 32 pulsos confirmados. Los desplazamientos son relativos al conjunto completo, una marca más opaca indica que esa posición se toca con más frecuencia, cada posición necesita al menos cuatro golpes para aparecer y los desplazamientos de 3 ms o más llevan etiqueta. Hasta que el análisis de pulso esté disponible, el panel muestra **waiting for a steady beat**.
- **Confianza**: Las lecturas más tenues indican menos confianza en el análisis, no una interpretación menos precisa.
- **Reset**: El botón **Reset** bajo la visualización la borra y reinicia el análisis, por ejemplo cuando otra aplicación cambia de pista. Cuando el reproductor de EffeTune empieza una pista nueva, el análisis se reinicia automáticamente.

### Visualización
- Pasa el cursor sobre la pantalla, o tócala y desliza el dedo, para leer los valores: hace cuántos pulsos, la banda y la temporización del golpe más cercano en Timing lanes y Echo rows (— si no está disponible); el tempo, **Tempo support** y el tempo **Adopted** en Tempogram; y el desplazamiento y la dispersión de cada banda en Beat lens.

### Limitaciones

- El seguimiento del tempo y del pulso es menos seguro con rubato, música clásica, piano solo o pasajes ambientales o sin pulso, y el pulso puede fijarse al doble, a la mitad, a dos tercios o a una vez y media el tempo que percibes, o en el contratiempo (usa **Min BPM** / **Max BPM** para acotar el rango). **LOCKED** no garantiza que el pulso sea correcto.
- Cuando el tempo cambia de forma continua, el pulso lo sigue con un pequeño retraso, por lo que el clic puede ir ligeramente adelantado o retrasado.
- En mezclas densas y grabaciones con ruido, los carriles **Mid** y **High** pueden mostrar puntos de más, y el carril **Low** no detecta algunas notas graves del piano.
- El analizador sigue los pulsos, no las líneas de compás ni el compás (no identifica el pulso 1).
- Frecuencias de muestreo compatibles: 8, 11,025, 16, 22,05, 24, 32, 44,1, 48, 88,2, 96, 176,4, 192, 352,8 y 384 kHz. Con otras frecuencias, el audio pasa sin cambios, pero el análisis y los clics no están disponibles.

## Spectrogram

Muestra cómo cambia tu música con el tiempo. La intensidad del color indica la fuerza de cada frecuencia, mientras que la posición vertical muestra su frecuencia.

El gráfico se desplaza de derecha a izquierda a una velocidad constante, con marcas cada segundo.

### Cómo leer la visualización
- Los colores muestran qué tan fuertes son diferentes frecuencias:
  - Colores oscuros: Sonidos suaves
  - Colores brillantes: Sonidos fuertes
  - Observa cómo los patrones cambian con la música
- La posición vertical muestra la frecuencia:
  - Abajo: Sonidos graves
  - Medio: Instrumentos principales
  - Arriba: Frecuencias altas
- Con **Log (HQ)**, los tonos graves cercanos aparecen como bandas más claramente separadas. La medición más larga de las frecuencias bajas puede tardar algo más en asentarse o desvanecerse.

### Visualización
- Pasa el cursor sobre la pantalla, o tócala y desliza el dedo sobre ella, para leer los valores en ese punto.

### Qué puedes ver
- Melodías: Líneas fluidas de color
- Ritmos: Franjas verticales
- Graves: Colores brillantes en la parte inferior
- Armonías: Múltiples líneas paralelas
- Diferentes instrumentos crean patrones únicos

### Parámetros
- **DB Range** - Qué tan vibrantes son los colores (-144dB a -48dB)
  - Números más bajos: Ver más detalles sutiles
  - Números más altos: Enfocarse en los sonidos principales
- **Points** - Tamaño de FFT usado para la visualización (256 a 16384)
  - Números más altos: Más detalle de frecuencia, pero actualizaciones temporales más lentas
  - Números más bajos: Movimiento más rápido, pero menos detalle de frecuencia
  - Con **Log (HQ)**, Points define la ventana de análisis corta; una ventana cuatro veces más larga mejora la separación de las frecuencias bajas.
- **Color** - **Normal** usa el color del gráfico del tema y muestra más brillantes las frecuencias más fuertes. **Heatmap** (predeterminado) usa la escala multicolor original, de oscuro a brillante. Al cambiar el color se recolorea el historial existente.
- **Frequency Scale** - **Log** da más espacio a las frecuencias bajas. **Log (HQ)** añade una medición más larga para separar con mayor claridad los graves cercanos, manteniendo la medición corta para los agudos. Usa más procesamiento y los cambios graves pueden tardar más en aparecer o desaparecer, pero no cambia el audio. **Linear** distribuye intervalos de frecuencia iguales a distancias iguales.
- **Keyboard** - Muestra a la derecha del gráfico una guía estática de teclado que relaciona las notas musicales con las frecuencias. No cambia el análisis ni el audio. La disposición de las teclas sigue **Log**, **Log (HQ)** o **Linear**; **Log (HQ)** usa el mismo espaciado logarítmico que **Log**, y con **Linear** las teclas graves se ven más estrechas.
- El analizador usa el promedio de los canales izquierdo y derecho. La entrada mono se analiza directamente.

## Spectrum Analyzer

Crea una visualización en tiempo real de las frecuencias de tu música, desde graves profundos hasta agudos altos. Es como ver los ingredientes individuales que componen el sonido completo de tu música.

### Cómo leer la visualización
- El lado izquierdo muestra frecuencias graves (batería, bajo)
- El medio muestra frecuencias principales (voces, guitarras, piano)
- El lado derecho muestra frecuencias altas (platillos, brillo, aire)
- Picos más altos significan mayor presencia de esas frecuencias
- La línea más gruesa muestra el sonido actual
- La línea más fina sigue los picos recientes y desciende suavemente al desaparecer
- En la visualización **Bar**, cada barra muestra el nivel más alto en una parte de igual ancho de la pantalla. **Log** y **Log (HQ)** usan anchos de octava iguales; **Linear** usa anchos de frecuencia iguales.
- La marca fina sobre una barra muestra su pico reciente y desciende suavemente.
- Con **Log (HQ)**, los tonos graves cercanos pueden aparecer como picos separados. Su medición más larga de las frecuencias bajas puede tardar algo más en asentarse o desvanecerse.
- Observa cómo diferentes instrumentos crean diferentes patrones

### Visualización
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

### Qué puedes ver
- Caídas de Graves: Grandes movimientos a la izquierda
- Melodías Vocales: Actividad en el medio
- Agudos Nítidos: Destellos a la derecha
- Mezcla Completa: Cómo todas las frecuencias trabajan juntas

### Parámetros
- **DB Range** - Qué tan sensible es la visualización (-144dB a -48dB)
  - Números más bajos: Ver más detalles sutiles
  - Números más altos: Enfocarse en los sonidos principales
- **Points** - Cuánta separación muestra entre frecuencias cercanas (256 a 16384)
  - Números más altos: Más detalle de frecuencia, con actualizaciones más lentas
  - Números más bajos: Actualizaciones más rápidas, con menos detalle de frecuencia
  - Con **Log (HQ)**, Points define la ventana de análisis corta; una ventana cuatro veces más larga mejora la separación de las frecuencias bajas.
- **Color** - **Normal** (predeterminado) conserva los colores del gráfico del tema. **Heatmap** ilumina los niveles más altos y **Note Colors** sigue los colores de las notas a lo largo del eje de frecuencias. La elección se aplica tanto a la visualización Line como a Bar. Con **Bar** y **Note Colors**, cada barra y su marca de pico usan un solo color según la frecuencia central de la banda.
- **Frequency Scale** - **Log** da más espacio a las frecuencias bajas. **Log (HQ)** añade una medición más larga para separar con mayor claridad los graves cercanos, manteniendo la medición corta para los agudos. Usa más procesamiento y los cambios graves pueden tardar más en aparecer o desaparecer, pero no cambia el audio. **Linear** distribuye intervalos de frecuencia iguales a distancias iguales.
- **Display** - Solo cambia el aspecto del espectro; no cambia el análisis ni el audio.
  - **Line** (predeterminado): Muestra el espectro como líneas continuas.
  - **Bar**: Muestra como barra el nivel más alto de cada banda de visualización.
- **Keyboard** - Muestra debajo del gráfico una guía estática de teclado que relaciona las notas musicales con las frecuencias. No cambia el análisis ni el audio. La disposición de las teclas sigue **Log**, **Log (HQ)** o **Linear**; **Log (HQ)** usa el mismo espaciado logarítmico que **Log**, y con **Linear** las teclas graves se ven más estrechas.
- El analizador usa el promedio de los canales izquierdo y derecho. La entrada mono se analiza directamente.

## Stereo Meter

Una fascinante herramienta de visualización que te permite ver cómo tu música crea una sensación de espacio a través del sonido estéreo. Observa cómo diferentes instrumentos y sonidos se mueven entre tus altavoces o auriculares, añadiendo una emocionante dimensión visual a tu experiencia de escucha.

### Cómo leer la visualización
- **Pantalla en rombo** - La ventana principal donde la música cobra vida:
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

### Qué puedes ver
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

## Formas Divertidas de Usar Estas Herramientas

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

Recuerda: estas herramientas están pensadas para que disfrutes más de la música añadiendo una dimensión visual a tu experiencia de escucha. ¡Diviértete explorando y descubriendo nuevas formas de ver tu música favorita!
