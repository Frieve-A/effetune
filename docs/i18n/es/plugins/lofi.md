---
title: "Plugins lo-fi - EffeTune"
description: "Plugins de efecto lo-fi, incluidos AM Radio Simulator, Bit Crusher, Noise Blender, Vinyl Artifacts y más."
lang: es
---

# Plugins Lo-Fi

Una colección de plugins que agregan carácter vintage y cualidades nostálgicas a tu música. Estos efectos pueden hacer que la música digital moderna suene como si se reprodujera a través de equipos clásicos o darle ese popular sonido "lo-fi" que es tanto relajante como atmosférico.

## Lista de Plugins

- [AM Radio Simulator](#am-radio-simulator) - Pasa la música por una cadena modelada de transmisión y recepción AM
- [Bit Crusher](#bit-crusher) - Crea sonidos retro de juegos y digitales vintage
- [Cassette Artifacts](#cassette-artifacts) - Graba la música en un casete compacto modelado y la reproduce en una pletina Type I/II/IV con Dolby B/C
- [Digital Error Emulator](#digital-error-emulator) - Simula varios errores de transmisión de audio digital
- [DSD64 IMD Simulator](#dsd64-imd-simulator) - Simula la distorsión por intermodulación audible que genera el ruido ultrasónico del DSD64
- [FM Radio Simulator](#fm-radio-simulator) - Hace pasar la música por una cadena de emisión y recepción FM simulada físicamente
- [G.726 Simulator](#g726-simulator) - Simula una conversión de codificación y decodificación de voz ITU-T G.726 con un enlace de radio ruidoso opcional
- [GSM-FR Simulator](#gsm-fr-simulator) - Simula una conversión de codificación y decodificación de voz GSM-FR a 13 kbit/s por enlace de radio con ocultación de pérdidas de trama
- [Hum Generator](#hum-generator) - Añade una atmósfera ajustable de zumbido eléctrico para escucha vintage/lo-fi
- [MP3 Codec Simulator](#mp3-codec-simulator) - Simula una conversión limpia de MPEG Layer III a baja tasa
- [Noise Blender](#noise-blender) - Agrega textura atmosférica de fondo
- [SBC Codec Simulator](#sbc-codec-simulator) - Reproduce una conversión Bluetooth A2DP SBC con pérdida de paquetes del enlace y ocultación opcionales
- [Simple Jitter](#simple-jitter) - Crea sutiles imperfecciones digitales vintage
- [SW Radio Simulator](#sw-radio-simulator) - Pasa la música por una cadena modelada de emisión en onda corta, propagación ionosférica y recepción
- [Tape Artifacts](#tape-artifacts) - Graba la música en una cinta de bobina abierta modelada y la reproduce
- [Vinyl Artifacts](#vinyl-artifacts) - Añade pops, crackle, hiss, rumble y fuga de ruido estéreo al estilo vinilo
- [Vinyl Simulator](#vinyl-simulator) - Graba la entrada en un surco modelado y la reproduce con una aguja física simulada

## AM Radio Simulator

AM Radio Simulator transforma la música mediante una cadena de radiodifusión AM modelada: procesamiento y modulación del transmisor, propagación por onda terrestre y ionosférica, estática e interferencia de canales adyacentes, sintonización, detección y AGC del receptor, y un altavoz de radio opcional. Úsalo para comparar una emisora local potente con una señal nocturna lejana y sujeta a desvanecimientos, explorar un dial congestionado o aplicar a la música la limitación de banda, la distorsión, los desvanecimientos y las interferencias propias de la recepción AM.

Este efecto necesita un entorno compatible con su procesamiento en tiempo real. Cuando ese procesamiento no está disponible, el audio no cambia y el HUD indica que el efecto no está disponible.

### Diferencias frente a los efectos lo-fi aditivos

- **AM Radio Simulator** cambia la propia señal de entrada al modularla y someterla a propagación, filtrado y detección. La estática, la interferencia y el zumbido se introducen en puntos modelados de la cadena de radio, por lo que interactúan con la sintonización, el filtro IF y el AGC.
- **Noise Blender** añade un ruido de fondo general, mientras que **Hum Generator** añade una capa de zumbido ajustable. Elige estos efectos cuando quieras esos sonidos sin transformar la música mediante un receptor de radio.
- **Vinyl Artifacts** añade ruido de superficie de disco sin alterar la señal musical original. **Vinyl Simulator** también transforma la señal mediante un modelo físico, pero reproduce un surco y una aguja en lugar de una transmisión de radio.

### Guía de mejora del sonido

- **Emisión local clara:** usa un Signal fuerte, poco Skywave y Static, centra Tuning y amplía IF Bandwidth. Selecciona Table para una respuesta de radio más completa u Off para una salida de línea.
- **Emisora nocturna lejana:** baja Signal, sube Skywave y utiliza un Fading Speed moderado. AGC Speed en Slow hace más gradual la recuperación del nivel, mientras que Static añade ráfagas ocasionales similares a rayos lejanos.
- **Dial congestionado:** sube Interference y ajusta Interf. Offset a 9 o 10 kHz. Un IF Bandwidth estrecho rechaza mejor la emisora adyacente; pequeños cambios de Tuning modifican cuánto llega al detector.
- **Sobrecarga de emisión:** sube Mod Depth por encima del 100% o alarga Detector RC para oír la sobremodulación y la distorsión por recorte diagonal propias de AM. Reduce uno de los dos para una recepción más limpia.
- **Profundidad del desvanecimiento:** las instancias nuevas usan Skywave al 1% para que el nivel varíe con más calma en Mono y el desvanecimiento nocturno sea menos acusado. Sube Skywave a alrededor del 8% cuando quieras un desvanecimiento claramente más profundo; los valores mayores intensifican aún más el efecto.
- Empieza con Mix al 100% para evaluar el modelo de radio. Bájalo solo si quieres conservar deliberadamente parte de la imagen estéreo original.

### Mezcla C-QUAM y modelo de Static

En C-QUAM, la mezcla estéreo automática observa pérdidas de señal válidas en dos ejes ortogonales del receptor: la señal suma decodificada y la región del piloto de 25 Hz de la señal diferencia en cuadratura. Se elimina el efecto del AGC de ambas observaciones y la calidad solo disminuye cuando la pérdida coincide en los dos ejes. Esta regla de coincidencia evita confundir los cambios normales del programa en un único eje con un desvanecimiento de RF. La observación solo funciona mientras el PLL está en TRACK y el piloto está aceptado; en cualquier otro caso, se borra.

El valor predeterminado de Skywave para instancias nuevas es del 1%, adoptado tras superar las comprobaciones integradas del modelo. Los ajustes preestablecidos guardados conservan el valor de Skywave almacenado expresamente. Frente al 8%, el 1% produce en Mono variaciones de nivel más tranquilas y desvanecimientos menos profundos; elige alrededor del 8% para simular un desvanecimiento nocturno más severo.

El intervalo de respuesta de calidad validado y fijado comienza en Fading Speed 0.05 Hz. Una atenuación que cambie mucho más despacio que la constante de caída de 60 s de la referencia adaptativa se incorpora a esa referencia y, de forma intencionada, no se conserva como una pérdida de calidad continua. La tolerancia de 0.75 dB para residuos del programa, el desplazamiento de relación de 0.04, la banda de observación del piloto Q=4, las constantes de tiempo de calidad de 0.05/0.2/0.5/60 s y la zona muerta de 0.5 dB con un intervalo de transición de 5.0 dB son calibraciones empíricas del simulador, no especificaciones generales de los receptores C-QUAM.

Esta observación fiel al receptor comparte con el hardware C-QUAM basado en piloto una ambigüedad que depende del programa. Si el programa contiene a la vez energía de diferencia cerca de 25 Hz y una suma/DC asimétrica, el final simultáneo de ambos componentes puede reducir brevemente la mezcla estéreo porque presenta al receptor las mismas señales que un desvanecimiento de RF. Del mismo modo, un residuo coherente en contrafase puede reducir la observación de calidad mientras el PLL permanece en TRACK y el piloto sigue aceptado. Son comportamientos intencionados dentro del límite aprobado del modelo, no defectos.

Los eventos Static usan una calibración de área vectorial relativa a la portadora. Cada evento parte de un área de 20.0 µs referida a la portadora nominal de la emisora deseada, con una distribución uniforme empírica de 0.5 a 1.5 y fase aleatoria. Los eventos se programan mediante plazos absolutos de doble precisión, no con una cuenta atrás de muestras redondeada, por lo que el tiempo continúa entre bloques de renderizado y se acumulan varios eventos que vencen en una misma muestra. La escala de 20.0 µs y su distribución son calibraciones empíricas del simulador.

### Parámetros

#### Station

- **Radio** (activado o desactivado) - Activa y desactiva la transmisión de la emisora. Al desactivarla, la portadora desaparece por completo y en el receptor solo quedan la estática atmosférica, la emisora adyacente y su propio ruido, con el AGC abierto del todo y ese fondo sonando fuerte. Permite recrear el cambio de sonido justo cuando una emisora empieza o termina su emisión. No es lo mismo que desactivar el efecto, que deja pasar la música sin alterarla.
- **Stereo Mode** (Mono o C-QUAM) - Mono utiliza un receptor tradicional con detector de envolvente. C-QUAM ofrece recepción estéreo, con una relación señal/ruido menor en estéreo que en mono, y pasa automáticamente a mono cuando la señal es débil o está mal sintonizada. Como el receptor emplea un método de detección físicamente distinto, cambiar de modo también puede alterar el timbre; Detector RC y su recorte diagonal solo se aplican a Mono y no tienen efecto en C-QUAM. El estéreo C-QUAM funciona con frecuencias de muestreo de hasta 192 kHz; con frecuencias superiores, la recepción es mono. La simulación solo modela el límite de fase de modulación C-QUAM c(5) de la FCC, no una prueba completa de conformidad.
- **TX Bandwidth** (2.0 a 10.0 kHz) - Define el ancho de banda de audio del transmisor. Los valores bajos producen un sonido más oscuro y limitado; los altos conservan más detalle.
- **Pre-emphasis** (0 a 100%) - Refuerza las frecuencias altas antes de transmitir. Los ajustes altos añaden presencia, pero también hacen que los picos brillantes exciten más la cadena de emisión.
- **Mod Depth** (10 a 125%) - Define la profundidad de modulación AM. Por encima del 100% se producen sobremodulación y recorte de picos negativos.
- **Compression** (0 a 20 dB) - Define la intensidad del limitador de emisión. Los ajustes altos contienen los picos y uniforman la modulación.

#### Path

- **Signal** (-50 a 0 dB) - Define la intensidad de la señal recibida. Las señales débiles dejan oír más ruido del receptor y requieren más ganancia de AGC.
- **Skywave** (0 a 100%) - Mezcla la onda terrestre estable con trayectos ionosféricos retardados. Las instancias nuevas parten del 1% para un movimiento suave; alrededor del 8% se obtiene un desvanecimiento nocturno más severo y los valores mayores profundizan el desvanecimiento selectivo.
- **Fading Speed** (0.05 a 2.0 Hz) - Define la rapidez con la que varían las condiciones de propagación ionosférica.
- **Static** (0 a 100/s) - Define la frecuencia de eventos de estática similares a rayos. Cada evento relativo a la portadora sigue un programa temporal absoluto y resuena en el filtro IF, en lugar de añadirse después de la recepción.
- **Interference** (-80 a 0 dB) - Define la intensidad de la emisora adyacente. -80 dB la desactiva; cuanto más se acerca el valor a 0 dB, más intensa resulta.
- **Interf. Offset** (5 a 10 kHz) - Define la separación respecto a la emisora adyacente y la frecuencia de batido de portadoras resultante. 9 y 10 kHz son separaciones de canal habituales.

#### Receiver

- **Tuning** (-30.0 a +30.0 kHz) - Desplaza la sintonización respecto a la emisora deseada. Los desajustes pequeños reducen la claridad y aumentan la distorsión por filtrado asimétrico; con desajustes grandes, la emisora queda oculta bajo el ruido del receptor.
- **IF Bandwidth** (2.0 a 20.0 kHz) - Define el ancho total de la banda pasante IF del receptor. Un valor estrecho rechaza más ruido e interferencia, pero elimina más agudos; uno amplio conserva más detalle.
- **AGC Speed** (Slow, Mid o Fast) - Define la rapidez con la que el control automático de ganancia sigue los cambios de señal. Slow acentúa una recuperación y un bombeo más graduales; Fast controla mejor los desvanecimientos rápidos.
- **Detector RC** (20 a 500 µs) - Define el tiempo de descarga del detector de envolvente. Los valores largos suavizan más la envolvente, pero aumentan la distorsión por recorte diagonal en los agudos cuando la modulación es intensa.
- **Hum** (-80 a -20 dB) - Define el zumbido de la fuente de alimentación. -80 dB lo desactiva. A diferencia de una capa de zumbido añadida, la mayor parte de este efecto modula la ganancia del receptor antes de la detección.
- **Hum Freq** (50 o 60 Hz) - Selecciona la frecuencia de alimentación simulada.

#### Output

- **Speaker** (Off, Small o Table) - Selecciona una salida de línea, la respuesta limitada de una radio de bolsillo o la respuesta más completa de una radio de mesa.
- **Output Gain** (-24 a +24 dB) - Ajusta el nivel después del procesamiento del receptor y del altavoz.
- **Mix** (0 a 100%) - Mezcla la señal estéreo original con la recepción mono simulada. El 0% mantiene el estéreo sin cambios; el 100% envía la misma señal procesada a izquierda y derecha. La salida solo es completamente mono con Mix al 100%.
- En C-QUAM, la señal procesada es estéreo cuando la recepción lo permite; la descripción mono anterior solo se aplica al modo Mono. El retardo FIR permanece dentro de la ruta procesada del receptor. Mix no retrasa la señal seca para alinearla, por lo que los ajustes intermedios combinan ambas con esa diferencia temporal.

### Lectura del HUD

- **S METER** muestra, en una escala de S1 a S9, la intensidad de señal que el receptor recibe dentro de su banda antes del AGC. Igual que el S-metro de un receptor real, lee todo lo que hay dentro del paso de banda, así que la emisora adyacente, el ruido y la estática también hacen subir la lectura junto con la emisora deseada.
- **AGC GAIN** muestra cuánta ganancia aplica el receptor. Normalmente aumenta cuando Signal baja o se profundiza un desvanecimiento. Se detiene en +42 dB, por lo que los desvanecimientos más profundos y las señales más débiles quedan a menor volumen en lugar de compensarse por completo.
- **MODULATION** muestra el porcentaje de modulación efectivo después del filtrado del transmisor.
- **FADE / EVENTS** muestra en dB el cambio actual de ganancia debido a la propagación y parpadea según las tasas recientes de estática y recorte. Si buscas un resultado más limpio y el recorte es frecuente, reduce Mod Depth o Detector RC.
- **STEREO** sigue la mezcla estéreo decodificada. Se ilumina a medida que se abre la recepción estéreo y se atenúa cuando el receptor vuelve automáticamente hacia mono.

### Ajustes recomendados

1. **Emisora local potente**
   - TX Bandwidth: 6.0 kHz, Mod Depth: 90%, Signal: -10 dB, Skywave: 5%, Fading Speed: 0.1 Hz, Static: 0.5/s
   - Interference: -80 dB, Tuning: 0 kHz, IF Bandwidth: 12 kHz, AGC Speed: Fast, Speaker: Table, Mix: 100%

2. **Emisora nocturna lejana**
   - TX Bandwidth: 4.5 kHz, Signal: -35 dB, Skywave: 75%, Fading Speed: 0.3 Hz, Static: 6/s
   - Interference: -55 dB, Interf. Offset: 9 kHz, IF Bandwidth: 6 kHz, AGC Speed: Slow, Detector RC: 150 µs, Speaker: Small, Mix: 100%

3. **Canal adyacente congestionado**
   - Signal: -25 dB, Skywave: 40%, Fading Speed: 0.5 Hz, Static: 3/s
   - Interference: -28 dB, Interf. Offset: 9 kHz, Tuning: +0.5 kHz, IF Bandwidth: 6 kHz, AGC Speed: Mid, Speaker: Small, Mix: 100%

## Bit Crusher

Un efecto que recrea el sonido de dispositivos digitales vintage como consolas de juegos antiguas y samplers tempranos. Perfecto para agregar carácter retro o crear una atmósfera lo-fi.

### Guía de Carácter de Sonido
- Estilo Retro Gaming:
  - Crea sonidos clásicos de consola de 8 bits
  - Perfecto para nostalgia de música de videojuegos
  - Agrega textura pixelada al sonido
- Estilo Lo-Fi Hip Hop:
  - Crea ese sonido relajante de ritmos para estudiar
  - Degradación digital cálida y suave
  - Perfecto para escucha de fondo
- Efectos Creativos:
  - Crea sonidos únicos estilo glitch
  - Transforma música moderna en versiones retro
  - Agrega carácter digital a cualquier música

### Parámetros
- **Bit Depth** - Controla qué tan "digital" se vuelve el sonido (4 a 24 bits)
  - 4-6 bits: Sonido retro gaming extremo
  - 8 bits: Digital vintage clásico
  - 12-16 bits: Carácter lo-fi sutil
  - Valores más altos: Efecto muy suave
- **TPDF Dither** - Hace que el efecto suene más suave
  - On: Sonido más suave y musical
  - Off: Efecto más crudo y agresivo
- **ZOH Frequency** - Afecta la claridad general (4000Hz a 96000Hz)
  - Valores más bajos: Más retro, menos claro
  - Valores más altos: Efecto más claro y sutil
- **Bit Error** - Agrega carácter de hardware vintage (0.00% a 10.00%)
  - 0%: Sin desajuste de ponderación de bits del DAC; Random Seed no tiene efecto audible
  - 0.1-1%: Coloración digital sutil de DAC
  - 1-3%: Imperfecciones clásicas de hardware
  - 3-10%: Carácter lo-fi creativo
- **Random Seed** - Controla la unicidad de las imperfecciones (0 a 1000)
  - Cambia el patrón fijo de imperfección usado por Bit Error
  - Solo es audible cuando Bit Error está por encima de 0%
  - El mismo valor siempre recrea el mismo patrón de imperfección

## Cassette Artifacts

Cassette Artifacts graba la música en un casete compacto modelado y la reproduce. La señal pasa por el codificador Dolby, el amplificador de grabación con el realce de agudos y el realce de graves acotado que este imprime en la cinta, la saturación magnética de la capa magnética, el borrado de agudos que provoca la polarización de grabación, las pérdidas por longitud de onda de la cabeza reproductora, las caídas locales de la capa magnética, el wow y el flutter del transporte, la deriva del acimut de la cabeza de la pletina, el contorno de cabeza de la cabeza reproductora y la curva de reproducción que vuelve a retirar el realce de agudos, antes de que se añadan el siseo de cinta y el ruido de modulación y de que actúe el decodificador Dolby. Úsalo cuando quieras música que haya pasado por una pletina de casete, en lugar de música con ruido de casete superpuesto por encima.

### Diferencias frente a otros efectos lo-fi

- **Tape Artifacts** modela una máquina de estudio de bobina abierta, y la diferencia entre ambos es la diferencia entre los formatos. Con sus valores por defecto, con una señal pequeña y un anfitrión a 96 kHz, el casete cae 2.0 dB a 8 kHz, 4.4 dB a 12 kHz y 7.9 dB a 16 kHz, donde la máquina de bobina abierta cae 0.7, 1.7 y 3.5 dB. Con la reducción de ruido desactivada el fondo del casete es además el más alto de los dos - -65.5 dBFS frente a los -68.5 dBFS de la máquina de bobina abierta - y con Dolby B o C queda por debajo, en -73.6 y -82.8 dBFS: la misma relación que tienen los formatos reales. La velocidad allí es un control y aquí un valor fijo de 4.76 cm/s, y Deck Grade, las columnas Type I/II/IV, Dolby B/C, las caídas de señal, el acimut de la cabeza y el error de nivel Dolby solo existen aquí.
- **Wow Flutter** (Modulation) reproduce únicamente la variación de velocidad de un transporte. Elígelo cuando quieras la inestabilidad sin la saturación de cinta, sin el comportamiento de Type y de la polarización, sin la reducción de ruido y sin el siseo.
- **Saturation** y **Hard Clipping** añaden no linealidad por sí sola, sin el comportamiento dependiente de la frecuencia ni el transporte de una máquina de cinta.
- **Vinyl Artifacts**, **Noise Blender** y **Hum Generator** añaden una capa de ruido sobre una música que no cambia. Aquí el siseo, el ruido de modulación y las caídas de señal se generan en el punto correcto de la pletina, así que la reducción de ruido actúa sobre ellos y siguen a Tape Type y a Hiss como lo hace el ruido real de un casete.

### Guía de carácter del sonido

- **Deck Grade fija la clase de máquina:** mueve a la vez los extremos de banda y la estabilidad a corto plazo, y nada más. Medidos con la polarización de referencia, una señal pequeña y un anfitrión a 96 kHz, los puntos de -3 dB van de 13.6 Hz a 18.0 kHz en Reference, de 16.7 Hz a 14.0 kHz en Hi-Fi, de 19.9 Hz a 10.0 kHz en Consumer y de 26.1 Hz a 6.5 kHz en Portable. A 16 kHz eso son 2.4, 4.0, 7.8 y 16.7 dB de caída. La oscilación de acimut crece en ese mismo orden: nula del todo en Reference, que es la clase de pletina que lleva servo de acimut, y máxima en Portable, donde la parte alta respira de forma visible.
- **Record Level es el punto de trabajo, no una ganancia:** indica con cuánta fuerza ataca la cinta un pico de 0 dBFS, y el nivel de salida no se mueve con él. Lo que se mueve es todo lo demás. Con el valor por defecto de +9.0 dB, un tono de 1 kHz a fondo de escala sale con 3.6 dB de redondeo y en torno a un 6% de tercer armónico, y en un máster moderno denso los 6 dB superiores del material salen convertidos en unos 4.2 dB. En +0.0 dB ese mismo material sale casi sin comprimir (los 6 dB superiores se quedan en 5.9 dB) y la cinta no llega a usarse nunca; en +15.0 dB los 6 dB superiores se han hundido hasta unos 1.9 dB. El fondo lo sigue decibelio a decibelio en sentido contrario, así que subir Record Level compra relación señal/ruido y gasta rango dinámico.
- **Los graves llegan antes al techo:** el lado de grabación tiene que realzar todo lo que hay por debajo de 50 Hz para llevarlo a la cinta, y ese realce tiene un techo que fija Deck Grade, así que los graves profundos alcanzan la saturación antes que la zona media. En una pletina Consumer con Record Level en +12.0 dB, un tono a fondo de escala sale 7.8 dB por debajo a 20 Hz y 5.4 dB por debajo a 40 Hz, frente a 3.3 dB a 315 Hz. Esa misma asimetría es la razón de que los graves lleguen a caer.
- **Tape Type no es un interruptor de volumen:** una señal pequeña de 1 kHz sale al mismo nivel en las tres, dentro de 0.01 dB. Lo que cambia es el margen y el ruido. Type IV es la que más margen tiene en agudos - su salida de saturación a 10 kHz está 6.5 dB por encima de Type II y su nivel máximo de salida a 315 Hz 1 dB por encima - y con el Record Level por defecto conserva unos 4.9 dB más a 10 kHz que Type II con un tono de -6 dBFS, y unos 7.5 dB más con uno a plena escala; su propio suelo de ruido, en cambio, es 2.5 dB peor que el de Type II. Type I es la más ruidosa de las tres, 4 dB por encima de Type II, y colorea las señales pequeñas exactamente igual que Type II, así que casi todo lo que se oye de ella es el fondo añadido.
- **La reducción de ruido es una ida y vuelta emparejada:** el mismo compansor de banda deslizante codifica antes de la cinta y expande después de ella, así que en condiciones ideales la música vuelve a salir igual. El silenciamiento es la cifra efectiva medida, no los 10 y 20 dB nominales: unos 8 dB para Dolby B y unos 17 dB para Dolby C, con ponderación A y en los ajustes por defecto. El precio es el desajuste de seguimiento en agudos a niveles altos, donde el decodificador lee como señal más baja unos agudos ya comprimidos por la cinta y los baja aún más; los realces antisaturación de Dolby C lo reducen, y con un tono fuerte de 10 kHz y el Record Level por defecto C conserva unos 3.9 dB más que B en un tono de 10 kHz a -6 dBFS, y unos 8.4 dB más en uno a plena escala.
- **La octava más alta es el límite de la pletina:** con la polarización de referencia, una señal pequeña y un anfitrión a 96 kHz, la pletina Consumer por defecto mide +1.1 dB a 50 Hz (el contorno de cabeza), 0.0 dB a 1 kHz, -0.8 dB a 5 kHz, -3.0 dB a 10 kHz y -7.8 dB a 16 kHz, y -2.9 dB a 20 Hz. Esa suave elevación de graves sobre unos graves que ya caen y esa caída en la parte alta son la respuesta propia de la pletina, antes de atacar nada con fuerza.
- **El transporte es más lento y más amplio que el de una bobina abierta:** un wow de cabrestante a 6.9 Hz, una rotación de bobina a 0.42 Hz y flutter de banda ancha entre 1 y 40 Hz. Con el valor por defecto de 0.200% la afinación se mueve unos 9 cents de pico a pico, justo en los 5 a 10 cents a partir de los cuales la modulación de frecuencia empieza a oírse como tal, así que la inestabilidad es audible en las notas mantenidas y queda enmascarada en programa denso; 0.040% es la cifra que publica una pletina de referencia y solo mueve unos 2 cents, y el tope de 1.000% da unos 46 cents, un temblor fuerte.
- **Un fondo vivo:** siseo en los silencios, más el ruido de modulación que viaja sobre la propia música, unos 48, 50 y 52 dB por debajo de la señal en Type I, Type II y Type IV. Baja Hiss del todo, hasta -92.0 dB re 250 nWb/m, cuando quieras un fondo silencioso.
- **Las caídas de señal son pérdidas, no clics:** cada evento es una depresión suave en coseno alzado de 2.1 a 21 ms y de 3 a 30 dB en lugar de una puerta, y el sorteo de profundidad se inclina hacia las pérdidas leves, así que lo que se oye normalmente es la música hundiéndose un instante, no un chasquido. El valor por defecto de 2.0 events/min es aproximadamente un evento cada medio minuto en cualquier pista.
- **Azimuth y Dolby Level Error son los ejes de compatibilidad:** los dos llevan signo, y su signo es justo lo importante. Azimuth oscurece la parte alta en ambos canales e introduce un retardo entre ellos, y cuál de los dos va por delante depende de su signo. Un Dolby Level Error por encima de cero hace que el decodificador recorte de menos, así que el resultado es más brillante y con más siseo; por debajo de cero recorta de más y el resultado es más apagado.

### Parámetros

La velocidad se indica en lugar de seleccionarse: el casete compacto corre a 4.76 cm/s (1⅞ ips) por definición, así que no es un control y la línea de estado al pie del panel la nombra una sola vez, como parte de la lectura de Wow/Flutter.

- **Deck Grade** (Reference, Hi-Fi, Consumer o Portable) - Selecciona la clase de pletina. Gobierna únicamente los mecanismos que no tienen un control propio: el presupuesto de ecualización de grabación que aplana la pérdida por longitud de onda de la cabeza, el ancho de banda del amplificador de grabación, el techo del realce de graves de grabación, el tamaño de la oscilación de acimut y la forma del contorno de cabeza. Nunca toca Wow/Flutter, Hiss ni Dropouts, así que cambiarlo no puede descartar nunca tus propios ajustes. Los extremos de banda, medidos con una señal pequeña y un anfitrión a 96 kHz, son de 13.6 Hz a 18.0 kHz (Reference), de 16.7 Hz a 14.0 kHz (Hi-Fi), de 19.9 Hz a 10.0 kHz (Consumer) y de 26.1 Hz a 6.5 kHz (Portable), y la oscilación de acimut recorre 0, 1, 2 y 4 arcmin de desviación típica en esas mismas cuatro. Reference no oscila en absoluto, porque una pletina de esa clase lleva servo de acimut. El valor por defecto, Consumer, es una máquina doméstica corriente.
- **Tape Type** (Type I, Type II o Type IV) - Selecciona la formulación de la cinta: ferrita, alta polarización y metal. Es un perfil de margen y de ruido, no un preajuste de ecualización ni un control de nivel: una señal pequeña de 1 kHz sale al mismo nivel en las tres, dentro de 0.01 dB. Type II es la columna de referencia: Type I queda 4.0 dB más ruidosa y Type IV 2.5 dB más ruidosa, mientras que Type IV tiene 6.5 dB más de margen en agudos y 1 dB más de margen en graves que Type II. Cada Type tiene además su propio punto de polarización recomendado, así que Bias 0 dB significa una pletina correctamente alineada sea cual sea la seleccionada.
- **Noise Reduction** (Off, Dolby B o Dolby C) - Selecciona la reducción de ruido por compansión. Siempre es una ida y vuelta emparejada de codificación y decodificación - la misma ley de banda deslizante graba y reproduce -, así que silencia la cinta sin cambiar la música en condiciones ideales. Dolby B es una sola banda deslizante y Dolby C dos escalonadas con realces antisaturación; el silenciamiento que consiguen aquí está medido, no es el nominal: unos 8 dB para B y unos 17 dB para C, y depende de Tape Type, Hiss, Dolby Level Error y la frecuencia de muestreo del anfitrión, por lo que la línea de estado indica la cifra correspondiente a los ajustes actuales. Ambas presentan además desajuste de seguimiento con agudos fuertes, igual que una pletina real, y Dolby C se desajusta menos que Dolby B.
- **Bias** (-6.0 a +6.0 dB) - Ajusta la polarización de grabación respecto al punto recomendado del Tape Type seleccionado. 0 dB es la pletina correctamente alineada: queda 2.5 dB (Type I), 3.0 dB (Type II) o 2.0 dB (Type IV) por encima del máximo de la curva de sensibilidad a 10 kHz, que es donde se alinea una pletina. Los valores altos (sobrepolarización) son más limpios en graves y medios y más apagados arriba: en +2.0 dB la sensibilidad a 10 kHz cae 1.67, 1.81 y 1.52 dB en los tres Types, y en +6.0 dB cae 5.31, 5.71 y 4.86 dB. Los valores bajos (subpolarización) son más brillantes y más distorsionados, como en una pletina mal ajustada, pero solo hasta ese máximo - en torno a -3.6 dB en Type I, -3.9 dB en Type II y -3.2 dB en Type IV, que valen unos +2.5, +3.0 y +2.0 dB a 10 kHz -, y por debajo los agudos vuelven a oscurecerse mientras la distorsión sigue creciendo, de modo que -6.0 dB ya es menos brillante que -4.0 dB. A 1 kHz todo el recorrido se mueve menos de 0.2 dB, así que Bias no es un control de volumen.
- **Record Level** (-12.0 a +18.0 dB) - Ajusta con cuánta fuerza graba la pletina. El número es el nivel de cinta que alcanza un pico de 0 dBFS, en dB por encima del flujo de referencia de 250 nWb/m, y la línea de estado indica ese convenio. El control no aplica ganancia por sí mismo: mientras la cinta no sature, la misma señal sale al mismo nivel en cualquier posición de Record Level, así que lo que cambia es la cinta, no el volumen. El valor por defecto de +9.0 dB es un casete grabado con normalidad, donde un tono de 1 kHz a fondo de escala sale con 3.6 dB de redondeo y en torno a un 6% de tercer armónico y los graves profundos ya están tocando el techo. Los valores más bajos se acercan a una copia que no llega a usar la cinta - en +0.0 dB un tono a fondo de escala solo pierde 0.5 dB - y suben el fondo un decibelio por cada decibelio, porque el siseo está en la cinta y la cinta queda ahora más lejos por debajo del pico. Los valores más altos comprimen más y silencian el fondo con esa misma regla; pasados unos +15.0 dB el rango dinámico deja de ensancharse y solo sigue creciendo la compresión.
- **Wow/Flutter** (0 a 1%) - Ajusta la variación de velocidad del transporte, como desviación en pico ponderada según DIN 45507, en porcentaje a los 4.76 cm/s fijos. 0% es un transporte perfectamente estable. El valor por defecto de 0.200% queda en el centro de la ventana de 0.15 a 0.25% que publican las pletinas de casete corrientes y mueve la afinación unos 9 cents de pico a pico, justo en los 5 a 10 cents a partir de los cuales la modulación de frecuencia empieza a oírse como tal. 0.040% es el pico ponderado que publica una pletina de referencia y solo mueve unos 2 cents; el tope de 1.000% da unos 46 cents, un temblor fuerte. El movimiento es más lento aquí que en una máquina de bobina abierta, porque lo domina la rotación de bobina a 0.42 Hz.
- **Hiss** (-92.0 a -42.0 dB re 250 nWb/m) - Ajusta a la vez el nivel del siseo de cinta y del ruido de modulación, como el flujo sin señal con ponderación A de Type II con la reducción de ruido desactivada, referido a la referencia de 250 nWb/m. Es la cifra de la hoja de datos de la propia cinta y no un nivel a la salida: el ruido está grabado en la cinta, así que lo que mide a la salida depende de Record Level. -92.0 dB re 250 nWb/m apaga ambos por completo. El valor por defecto de -60.5 dB re 250 nWb/m es el ruido de polarización que el fabricante publica para una cinta Type II. Type I queda 4.0 dB por encima de esa columna y Type IV 2.5 dB por encima, Record Level mueve el conjunto entero un decibelio por cada decibelio y después el decodificador Dolby retira la cantidad medida que le corresponde, así que lo que se oye en los silencios no es esta cifra: la línea de estado indica en qué queda. Todo ello está antes de Output, así que un medidor puesto después de Output lo lee subido por lo que marque Output. Mientras suena la música, lo que este control añade sobre todo es el ruido de modulación que viaja sobre la señal.
- **Dropouts** (0 a 20 events/min) - Ajusta la tasa media de caídas de la capa magnética, contadas por pista: la pista que midas verá esta cantidad de eventos por minuto. La mitad son de toda la cinta y afectan a todos los canales a la vez, y la otra mitad son locales de una sola pista. Cada evento es una depresión suave en coseno alzado de 2.1 a 21 ms y de 3 a 30 dB, no una puerta, así que suena como una breve pérdida de señal y no como un clic. El valor por defecto de 2.0 events/min es un casete en servicio normal, aproximadamente un evento cada medio minuto en cualquier pista; 0 es una cinta impecable y no añade absolutamente nada, y el tope de 20 events/min es el triple del límite de control de calidad que publica un casete de gama alta, claramente terreno de cinta degradada.
- **Azimuth** (-6.0 a +6.0 arcmin) - Ajusta el error de alineación de cabeza entre la pletina que grabó la cinta y la que la reproduce. No es un grado de calidad, sino el estado de alineación de ese par concreto de máquinas, y por eso lleva signo y es independiente de Deck Grade. Cualquier error cuesta agudos en ambos canales: con el valor por defecto de +2.0 arcmin un tono de 10 kHz pierde 0.25 dB y uno de 16 kHz 0.60 dB frente a un par perfectamente alineado, y en ±6.0 arcmin eso pasa a ser 1.03 y 2.26 dB. Además introduce un retardo de 11.0 µs entre los canales en +2.0 arcmin, y el signo decide cuál de los dos va por delante, de modo que una suma mono de material correlacionado pierde otros 0.8 dB a 8 kHz, 1.8 dB a 12 kHz y 3.2 dB a 16 kHz; el material no correlacionado no muestra ese filtrado de peine. Deck Grade añade una deriva lenta por encima de este ajuste, así que Azimuth es el centro alrededor del cual vaga la deriva y no un valor congelado.
- **Dolby Level Error** (-3.0 a +3.0 dB) - Ajusta a qué distancia queda la referencia Dolby de la pletina de reproducción respecto a la de la pletina que grabó. Solo significa algo con Noise Reduction activado, y su signo es lo importante: por encima de cero el decodificador lee la cinta como más caliente de lo que es, recorta de menos y el resultado es más brillante y con más siseo; por debajo de cero recorta de más y el resultado es más apagado. Con la pletina por defecto, un tono de nivel medio se mueve unos 2.4 dB hacia abajo a 5 kHz y 1.0 dB hacia abajo a 10 kHz en -3.0 dB, y unos 1.9 dB hacia arriba a 5 kHz y 2.2 dB hacia arriba a 10 kHz en +3.0 dB. 0.0 dB son dos pletinas calibradas entre sí. El desajuste de seguimiento con agudos fuertes está presente en todos los ajustes, porque es la propia cinta la que cambia la señal entre la codificación y la decodificación; lo que abre este control es el lado brillante, al que un par emparejado no puede llegar.
- **Output** (-24.0 a +24.0 dB) - Ajusta el nivel después de toda la cadena. Sirve para igualar el volumen al comparar con el bypass o para recuperar el volumen que ha costado un Record Level alto.
- **Mix** (0 a 100%) - Mezcla la señal del casete con la original. El 100% es reproducción de casete completa. La señal seca está alineada temporalmente con el trayecto de cinta, así que la zona media se mezcla con limpieza - 1 kHz se mantiene dentro de 0.06 dB de la unidad al 50% -, pero la octava más alta no, porque allí seca y cinta ya no comparten fase y se cancelan en parte. Esa cancelación no es igual en los dos canales, porque el error de acimut introduce un retardo entre ellos: al 50%, con los valores por defecto y un anfitrión a 96 kHz, el canal izquierdo sale 1.7 dB por debajo a 8 kHz, 3.6 dB a 12 kHz, 5.3 dB a 16 kHz y 6.2 dB a 20 kHz, mientras que el derecho queda 4.4, 8.9, 9.0 y 7.0 dB por debajo en esas mismas frecuencias. Al 0% la entrada pasa sin ningún cambio y el efecto no añade latencia; en cualquier otro ajuste añade 165 muestras (3.741 ms) con un anfitrión a 44.1 kHz, 179 (3.729 ms) a 48 kHz, 347 (3.615 ms) a 96 kHz y 683 (3.557 ms) a 192 kHz.

### Lectura de la línea de estado

La línea que hay bajo los controles indica el convenio de Record Level y en qué quedan los dos ajustes Base con la pletina tal como está configurada en ese momento, con la forma `Record Level +9.0 dB → tape peak +9.0 dB re 250 nWb/m at 0 dBFS in · Wow/Flutter Base 0.200% → 0.200% at 4.76 cm/s (1⅞ ips) · Hiss Base -60.5 dB re 250 nWb/m → -73.6 dBFS, Type I, Dolby B`.

- **Record Level** repite el control en términos de lo que significa en la cinta: el flujo que alcanza un pico de 0 dBFS. Es una declaración del convenio y no un medidor - no lo hay -, y un máster más bajo cae proporcionalmente más abajo en la cinta.
- **Wow/Flutter** indica el valor Base y el efectivo. La velocidad es fija, así que los dos son siempre la misma cifra; la línea está ahí para nombrar el convenio de medida al que pertenece el porcentaje, y es el único sitio donde se indica la velocidad del transporte.
- **Hiss** indica el valor Base y el suelo sin señal con ponderación A en que se convierte a la salida, tras la columna de Tape Type, Record Level y el decodificador Dolby, antes de Output. Con Hiss en -92.0 dB re 250 nWb/m toda la familia de ruido está apagada y la línea muestra `→ off`.
- El suelo efectivo está medido, no derivado de los 10 y 20 dB nominales de Dolby B y C, y depende a la vez de Tape Type, la reducción de ruido, Hiss, Dolby Level Error, Record Level y la frecuencia de muestreo del anfitrión. Con Hiss en su valor por defecto de -60.5 dB re 250 nWb/m y Record Level en +9.0 dB, con un anfitrión a 96 kHz, queda así:

  | Tape Type | NR Off | Dolby B | Dolby C |
  |---|---|---|---|
  | Type I | -65.5 dBFS | -73.6 dBFS | -82.8 dBFS |
  | Type II | -69.5 dBFS | -77.7 dBFS | -87.0 dBFS |
  | Type IV | -67.0 dBFS | -75.2 dBFS | -84.4 dBFS |

  Record Level desplaza la tabla entera un decibelio por cada decibelio: en +12.0 dB todas las cifras son 3 dB más bajas, y en +6.0 dB todas son 3 dB más altas. Cuánto retira el decodificador Dolby no cambia con él, porque el suelo de la cinta y la propia referencia del decodificador se mueven juntos.
- Cada combinación se mide una vez y luego se recuerda, así que la cifra aparece de inmediato en cualquier ajuste por el que ya hayas pasado. Mientras arrastras Hiss o Dolby Level Error por combinaciones que aún no se han medido, la línea muestra `measuring…` y rellena el número en cuanto el control se detiene: anunciar una cifra de aspecto definitivo que se desvía varios decibelios sería peor que no anunciar nada.

### Ajustes recomendados

1. **Pletina de casete corriente (por defecto)**
   - Deck Grade: Consumer, Tape Type: Type I, Noise Reduction: Dolby B, Bias: 0.0 dB, Record Level: +9.0 dB
   - Wow/Flutter: 0.200%, Hiss: -60.5 dB re 250 nWb/m, Dropouts: 2.0 events/min, Azimuth: +2.0 arcmin, Dolby Level Error: 0.0 dB, Output: 0.0 dB, Mix: 100%
   - El sonido de casete cotidiano, y el valor por defecto del propio plugin: la parte alta suavizada 7.9 dB a 16 kHz, una elevación de 1.1 dB en torno a 50 Hz sobre unos graves que ya caen 2.9 dB a 20 Hz, en torno a un 6% de tercer armónico y 3.6 dB de redondeo en un tono a fondo de escala, un fondo de -73.6 dBFS con un anfitrión a 96 kHz, un movimiento de afinación de unos 9 cents y una caída de señal cada medio minuto aproximadamente en cada pista.

2. **Pletina de referencia, cinta de metal con Dolby C**
   - Deck Grade: Reference, Tape Type: Type IV, Noise Reduction: Dolby C, Bias: 0.0 dB, Record Level: +9.0 dB
   - Wow/Flutter: 0.040%, Hiss: -60.5 dB re 250 nWb/m, Dropouts: 0.0 events/min, Azimuth: 0.0 arcmin, Dolby Level Error: 0.0 dB, Output: 0.0 dB, Mix: 100%
   - La combinación más capaz que ofrece el formato: una pletina Reference llega a -3 dB a 18.0 kHz y no deriva en absoluto, Type IV aporta 6.5 dB más de margen en agudos que Type II y el fondo se sitúa en -84.4 dBFS con un anfitrión a 96 kHz. El suelo de cinta propio de Type IV es 2.5 dB peor que el de Type II: es Dolby C lo que hace de este el ajuste más silencioso de aquí, y también es el que menos desajuste de seguimiento presenta con agudos fuertes. Con la inestabilidad, el siseo, las caídas de señal y la deriva de acimut todos desactivados, esta pletina es completamente determinista.

3. **Cinta de ferrita, sin reducción de ruido**
   - Deck Grade: Consumer, Tape Type: Type I, Noise Reduction: Off, Bias: 0.0 dB, Record Level: +9.0 dB
   - Wow/Flutter: 0.200%, Hiss: -60.5 dB re 250 nWb/m, Dropouts: 2.0 events/min, Azimuth: +2.0 arcmin, Dolby Level Error: 0.0 dB, Output: 0.0 dB, Mix: 100%
   - Una cinta de ferrita corriente grabada sin reducción de ruido: el fondo se sitúa en -65.5 dBFS con un anfitrión a 96 kHz, 8.1 dB más alto que el valor por defecto, y nada lo retira, así que el siseo forma parte del sonido en todos los silencios. El timbre es exactamente el del ajuste por defecto para las señales pequeñas - la diferencia entre los Types es de ruido y margen, no de color - y no hay desajuste de seguimiento, porque no hay decodificador que se desajuste.

4. **Pletina doméstica, ligeramente sobrepolarizada**
   - Deck Grade: Consumer, Tape Type: Type I, Noise Reduction: Dolby B, Bias: +2.0 dB, Record Level: +12.0 dB
   - Wow/Flutter: 0.300%, Hiss: -58.0 dB re 250 nWb/m, Dropouts: 4.0 events/min, Azimuth: +3.0 arcmin, Dolby Level Error: -1.0 dB, Output: +0.5 dB, Mix: 100%
   - Una pletina doméstica corriente con cinta genérica, y una cinta grabada en otra distinta: la polarización algo alta, así que la parte alta queda unos 1.7 dB más oscura a 10 kHz que en una pletina alineada y los graves y medios algo más limpios, un transporte menos estable, un suelo de cinta subido, una caída de señal cada cuarto de minuto aproximadamente en cada pista, un error de acimut mayor y un decodificador calibrado 1 dB por debajo, que lo oscurece aún más. Record Level está 3 dB por encima del valor por defecto, así que los 6 dB superiores de un máster denso salen convertidos en unos 3.1 dB y Output sube un poco para pagar la compresión. La línea de estado indica en qué queda el ajuste de Hiss subido tras Type I, Dolby B y el Record Level.

5. **Portátil, cinta gastada**
   - Deck Grade: Portable, Tape Type: Type I, Noise Reduction: Off, Bias: -2.0 dB, Record Level: +12.0 dB
   - Wow/Flutter: 0.480%, Hiss: -54.0 dB re 250 nWb/m, Dropouts: 8.0 events/min, Azimuth: +4.0 arcmin, Dolby Level Error: 0.0 dB, Output: +1.0 dB, Mix: 100%
   - Un efecto lo-fi deliberadamente degradado. Una pletina Portable llega a -3 dB a 6.5 kHz y a 26 Hz y deriva el doble que la del ajuste por defecto; la polarización está por debajo del punto alineado, lo que aclara 10 kHz en torno a 1.6 dB y añade distorsión con ello; el transporte está muy por encima del punto en el que la inestabilidad resulta evidente; la cinta suena alta y ruidosa; el acimut está muy desviado; y las caídas de señal llegan varias veces por minuto en todas las pistas. Record Level es lo bastante alto como para que los graves estén firmemente contra el techo, y Output recupera el volumen.

### Notas sobre el modelo

El efecto modela una pasada de grabación y reproducción en una pletina que corre a los 4.76 cm/s fijos del casete compacto. El lado de grabación realza los agudos antes de la cinta y el de reproducción retira exactamente ese mismo realce, en lugar de seguir una norma de reproducción publicada; la mitad grave de la curva no es simétrica a propósito, porque el realce que una pletina real aplica por debajo de 50 Hz en grabación tiene un techo, y ese techo es lo que produce a la vez la caída de graves y que los graves lleguen antes a la saturación. Deck Grade gobierna únicamente los mecanismos que no tienen un control propio, así que nunca cambia Wow/Flutter, Hiss ni Dropouts. La oscilación de acimut es un proceso acotado que se devuelve al valor de Azimuth, no un paseo aleatorio, y Reference no tiene ninguna, porque una pletina de esa clase lleva servo de acimut; con Wow/Flutter en 0, Hiss apagado, Dropouts en 0 y Deck Grade en Reference no corre absolutamente nada aleatorio. Dolby B y Dolby C están modelados como compansores de banda deslizante emparejados y funcionan siempre como una ida y vuelta completa de codificación y decodificación; no hay funcionamiento solo de codificación ni solo de decodificación, ni se afirma conformidad con ninguna especificación de reducción de ruido ni certificación alguna frente a ella. Dolby Level Error desplaza únicamente la referencia del decodificador, que es la diferencia de calibración entre dos pletinas y no una segunda etapa de proceso. Las cintas Type III, los formatos microcasete y Elcaset, otras velocidades de cinta, el control de afinación, la inversión automática, la copia por contacto, el ruido de empalme, el zumbido del motor, el ruido de la carcasa y del mecanismo y la filtración de la cara opuesta quedan fuera de este modelo. No existen estadísticas públicas de caídas de señal por cinta, así que el rango de tasas, las duraciones y las profundidades de las caídas son un modelo calibrado limitado por un límite de control de calidad publicado, no una transcripción de datos medidos. El trayecto de cinta lleva 165 muestras (3.741 ms) de retardo de transporte y proceso con un anfitrión a 44.1 kHz, que bajan a 683 muestras (3.557 ms) con uno a 192 kHz; con Mix al 0% la entrada pasa bit a bit sin ningún retardo. Las cifras de timbre citadas arriba están medidas con un anfitrión a 96 kHz y con el Bias de referencia de 0.0 dB. Este efecto cuesta aproximadamente una vez y media lo que Tape Artifacts.

## Digital Error Emulator

Un efecto que simula el sonido de errores de transmisión de audio digital, desde clics leves de interfaz hasta imperfecciones de reproductores de CD antiguos y cortes inalámbricos. Úsalo cuando quieras carácter digital nostálgico o una textura glitch evidente durante la escucha.

### Guía de Carácter de Sonido
- Carácter Sutil de Reproducción Digital:
  - Simula artefactos de transmisión S/PDIF, AES3 y MADI
  - Añade imperfecciones digitales leves y ocasionales
  - Útil cuando la reproducción limpia se siente demasiado perfecta
- Dropouts Digitales de Consumo:
  - Recrea el comportamiento de corrección de errores de reproductores de CD clásicos
  - Simula glitches de interfaz de audio USB
  - Ideal para nostalgia de música digital de los 90/2000
- Artefactos de Streaming y Audio Inalámbrico:
  - Simula errores de transmisión Bluetooth
  - Dropouts y artefactos de streaming de red
  - Imperfecciones de la vida digital moderna
- Texturas Digitales Creativas:
  - Interferencia RF y errores de transmisión inalámbrica
  - Efectos de corrupción de audio HDMI/DisplayPort
  - Posibilidades de sonido experimental únicas

### Parámetros
- **Bit Error Rate** - Controla la frecuencia de ocurrencia de errores (10^-12 a 10^-2)
  - Muy Raro (10^-10 a 10^-8): Artefactos sutiles ocasionales
  - Ocasional (10^-8 a 10^-6): Comportamiento clásico de equipos de consumo
  - Frecuente (10^-6 a 10^-4): Carácter vintage notable
  - Extremo (10^-4 a 10^-2): Efectos experimentales creativos
  - Por defecto: 10^-6 (equipos de consumo típicos)
- **Mode** - Selecciona el tipo de transmisión digital a simular
  - AES3/S-PDIF: Errores de bits de interfaz con retención de muestra
  - ADAT/TDIF/MADI: Errores de ráfaga multicanal (retención o silencio)
  - HDMI/DP: Corrupción de fila de audio de pantalla o silenciamiento
  - USB/FireWire/Thunderbolt: Dropouts de microtrama con interpolación
  - Dante/AES67/AVB: Pérdida de paquetes de audio de red (64/128/256 muestras)
  - Bluetooth A2DP/LE: Errores de transmisión inalámbrica con ocultación
  - WiSA: Errores de bloques FEC de altavoces inalámbricos
  - RF Systems: Silenciamiento de radiofrecuencia e interferencia
  - CD Audio: Simulación de corrección de errores CIRC
  - Por defecto: CD Audio — CIRC Error Correction (Interpolated)
- **Reference Fs (kHz)** - Establece la frecuencia de muestreo de referencia usada solo por los modos de pérdida de paquetes Dante / AES67 / AVB para escalar la longitud de paquetes de 64/128/256 muestras
  - Frecuencias disponibles: 44.1, 48, 88.2, 96, 176.4, 192 kHz
  - Solo la usan los modos de pérdida de paquetes Dante / AES67 / AVB para escalar la longitud de paquetes de 64/128/256 muestras
  - Los demás modos usan su propio timing fijo o la tasa de muestreo actual
  - Por defecto: 48 kHz
- **Wet Mix** - Controla la mezcla entre audio original y procesado (0-100%)
  - Nota: Para simulación realista de errores digitales, mantener al 100%
  - Valores más bajos crean errores "parciales" irreales que no ocurren en sistemas digitales reales
  - Por defecto: 100% (comportamiento auténtico de errores digitales)

### Detalles de Modos

**Interfaces digitales especializadas:**
- AES3/S-PDIF: Errores de muestra única con retención de muestra anterior
- ADAT/TDIF/MADI: Errores de ráfaga de 32 muestras - retener últimas muestras buenas o silenciar
- HDMI/DisplayPort: Corrupción de fila de 192 muestras con errores a nivel de bit o silenciamiento completo

**Audio de Computadora:**
- USB/FireWire/Thunderbolt: Dropouts de microtrama con ocultación por interpolación
- Audio de Red (Dante/AES67/AVB): Pérdida de paquetes con diferentes opciones de tamaño y ocultación

**Inalámbrico de Consumo:**
- Bluetooth A2DP: Errores de transmisión post-códec con artefactos de vibración y decaimiento
- Bluetooth LE: Ocultación mejorada con filtrado de alta frecuencia y ruido
- WiSA: Silenciamiento de bloques FEC de altavoces inalámbricos

**Sistemas Especializados:**
- RF Systems: Eventos de silenciamiento de longitud variable simulando interferencia de radio
- CD Audio: Simulación de corrección de errores CIRC con comportamiento estilo Reed-Solomon

### Ajustes Recomendados para Diferentes Estilos

1. Carácter Sutil de Reproducción Digital
   - Modo: AES3 / S-PDIF (I²S) — Bit Error (Hold), BER: 10^-8, Fs: 48kHz, Wet: 100%
   - Perfecto para: Añadir imperfecciones digitales leves y ocasionales

2. Experiencia Clásica de Reproductor de CD
   - Modo: CD Audio — CIRC Error Correction (Interpolated), BER: 10^-7, Fs: 44.1kHz, Wet: 100%
   - Perfecto para: Nostalgia de música digital de los 90

3. Glitches de Streaming Moderno
   - Modo: Dante / AES67 / AVB — UDP Drop (128 samp), BER: 10^-6, Fs: 48kHz, Wet: 100%
   - Perfecto para: Imperfecciones de la vida digital contemporánea

4. Experiencia de Escucha Bluetooth
   - Modo: Bluetooth A2DP — Digital Transmission, BER: 10^-6, Fs: 48kHz, Wet: 100%
   - Perfecto para: Memorias de audio inalámbrico

5. Textura de Corte Inalámbrico
   - Modo: WMAS / DECT / Axient — RF Squelch, BER: 10^-5, Fs: 48kHz, Wet: 100%
   - Perfecto para: Interrupciones evidentes tipo radio y textura glitch

Nota: Todas las recomendaciones usan 100% de Wet Mix para comportamiento realista de errores digitales. Los valores de mezcla húmeda más bajos pueden usarse para efectos creativos, pero no representan cómo ocurren realmente los errores digitales reales.

## DSD64 IMD Simulator

Un efecto que recrea un efecto secundario sutil, y a menudo debatido, de la reproducción DSD64: el ruido ultrasónico que el DSD transporta por encima del rango audible puede, a través de las pequeñas imperfecciones de los DAC, amplificadores y altavoces reales, generar distorsión por intermodulación (IMD), es decir, aspereza y tonos adicionales que terminan cayendo de nuevo dentro del rango que puedes oír. Este efecto reproduce ese resultado audible para que puedas escucharlo y ajustarlo. Se trata de una simulación y no genera un flujo DSD real.

**Este efecto requiere una frecuencia de muestreo de 88.2 kHz o superior** (88.2 / 96 / 176.4 / 192 kHz). A 44.1 / 48 kHz no puede funcionar y se omite (la señal seca pasa sin alteraciones), mostrando una advertencia. Configura la frecuencia de muestreo a 88.2 kHz o superior en los ajustes de audio de la aplicación para usar este efecto.

### Guía de Carácter de Sonido
- "Aspereza digital" muy sutil: un leve y constante piso de ruido arenoso, más una fina dureza que sigue a la música.
- Herramienta de demostración: hace audible y ajustable la IMD ultrasónica del DSD64, normalmente inaudible.
- Textura creativa: con valores más altos de Amount y Analog Nonlinearity se convierte en un evidente efecto lo-fi de rasguño/filo.

### Parámetros

Parámetros principales
- **Amount** (-40.0 a +50.0 dB) - Nivel general de la distorsión generada.
- **Dry-Wet** (100:0 a 0:100) - Balance entre la señal seca y la distorsión generada, expresado como una proporción seco:húmedo. 100:0 = solo señal seca; 100:100 (centro) = señal seca completa más distorsión completa; 0:100 = solo distorsión.
- **Ultrasonic Level** (-48.0 a -18.0 dBFS RMS) - Nivel del ruido ultrasónico DSD simulado. Más ruido produce más distorsión.
- **Noise Color** (-100 a +100%) - Desplaza el ruido ultrasónico hacia frecuencias más bajas o más altas e inclina su balance.
- **Analog Nonlinearity** (0.00 a 10.00%) - Cuán imperfecto (no lineal) es el equipo analógico simulado. Valores más altos producen más distorsión.
- **Even Bias** (0 a 100%) - Equilibra la composición de la distorsión. Los valores bajos favorecen la distorsión que sigue a la música (Attached); los valores altos favorecen la distorsión constante de tipo ruido (Additive) más el componente Cross.
- **Signal Coupling** (0 a 200%) - Intensidad de la distorsión dependiente de la música (Attached y Cross). En 0, solo permanece el ruido Additive constante.
- **IMD Path HPF** (0.0 a 8.0 kHz) - Limita la generación de distorsión a las frecuencias por encima de este punto. 0.0 = Off (rango completo, como un amplificador); alrededor de 2.5 kHz emula un sistema en el que solo el tweeter produce la distorsión. La señal seca nunca se ve afectada.
- **Scratch Tone** (3.0 a 14.0 kHz) - Frecuencia central del carácter audible de "rasguño".

Parámetros avanzados / de utilidad
- **Noise Texture** (0 a 100%) - Añade una ondulación resonante al ruido ultrasónico para una textura ligeramente distinta.
- **Cross Sideband** (0 a 100%) - Cantidad de distorsión creada por la mezcla de la música con el ruido ultrasónico.
- **Output Trim** (-24.0 a +12.0 dB) - Ajuste final del nivel de salida.

### Visualizaciones
- **Medidores Term Contribution** - Niveles en tiempo real de cada parte del efecto:
  - **Additive** - la distorsión constante, presente solo a partir del ruido, incluso sin señal de entrada.
  - **Attached** - distorsión que se adhiere a la música y la sigue.
  - **Cross** - distorsión producida por la mezcla de la música con el ruido ultrasónico.
  - **Total IMD** - la distorsión combinada que se genera.
  - **Output** - el nivel de salida final (señal seca más distorsión, después de Dry-Wet y Output Trim).
- **Analog Transfer Curve** - Muestra la curva de distorsión creada por Analog Nonlinearity y Even Bias, con el mismo estilo de entrada/salida que los plugins de Saturation.
- **Vista Difference-Frequency** - Un gráfico estático que muestra qué frecuencias audibles produce el ruido ultrasónico, según los ajustes de ruido actuales.

### Ajustes Recomendados
- Sutil (por defecto): Amount +24 dB, Ultrasonic Level -30 dBFS, Analog Nonlinearity 1.40%, Even Bias 20%, Signal Coupling 150%, Cross Sideband 75%, Scratch Tone 10.5 kHz.
- IMD solo en el tweeter: IMD Path HPF 2.5 kHz, Signal Coupling 80–150%, Cross Sideband 50–100%, Scratch Tone 9–14 kHz.
- Efecto evidente: aumenta Amount, Ultrasonic Level y Analog Nonlinearity.

## FM Radio Simulator

FM Radio Simulator hace pasar la música por una cadena modelada de emisión y recepción FM: procesamiento de audio de emisión y preénfasis, composición del múltiplex estéreo (MPX) con el piloto de 19 kHz, modulación FM de una portadora, propagación multitrayecto y ruido de antena, sintonía del receptor, filtrado de FI, limitación dura, discriminación FM, decodificación estéreo mediante PLL de piloto y deénfasis. Como la señal se modula y demodula realmente en FM, los comportamientos característicos de la recepción FM emergen de la física en lugar de sintetizarse: el siseo brillante que crece cuando la señal se debilita, la penalización de ruido del estéreo con la mezcla automática hacia mono, los clics y chisporroteos por debajo del umbral FM y la distorsión por multitrayecto.

Este efecto requiere un entorno compatible con su procesamiento en tiempo real. Cuando ese procesamiento no está disponible, el audio permanece sin cambios y el HUD informa de que el efecto no está disponible.

### Diferencias frente a los efectos lo-fi aditivos

- **FM Radio Simulator** no sintetiza un ruido "de radio" para superponerlo. Modula la música sobre una portadora, degrada esa portadora y la demodula. El siseo, los clics y la distorsión aparecen solo donde la física del receptor los crea, y reaccionan a Signal, Tuning, el filtro de FI y el decodificador estéreo, mostrando las mismas tendencias físicas que la recepción FM real.
- **Noise Blender** añade una textura de ruido de fondo constante sin cambiar la música; elígelo cuando solo quieras ambiente. También puede encadenarse después de este efecto para representar interferencias impulsivas tipo encendido de motor, que este modelo no incluye.
- **Digital Error Emulator** reproduce errores de transmisión digital como cortes y artefactos de ocultación: una familia de degradación distinta de la recepción FM analógica.
- **AM Radio Simulator** es el modelo físico equivalente para la radiodifusión AM; FM Radio Simulator reproduce el sonido FM de banda ancha con su múltiplex estéreo, el enganche del piloto y el comportamiento de ruido propio de FM.

### Guía de carácter sonoro

- **Emisión limpia:** con señal fuerte, la cadena aporta sobre todo el propio procesamiento de emisión: el límite de banda de 15 kHz y la densidad del limitador de la emisora fijada por Processing.
- **Siseo de señal débil:** al bajar Signal, primero surge en estéreo un siseo brillante y aireado. Cambiar Stereo a Mono hace que la misma recepción suene claramente más silenciosa, por la misma razón por la que el mono es más silencioso en un sintonizador real.
- **Recepción en el límite:** cerca del umbral FM aparecen clics y chisporroteos, el receptor mezcla hacia mono y el programa acaba hundiéndose en el ruido.
- **Color del multitrayecto:** las reflexiones añaden una distorsión áspera y hueca cuyo carácter sigue a Path Delay; subir Fading la convierte en el aleteo de la recepción móvil.

### Parámetros

- **Radio** (activado o desactivado) - Activa y desactiva la transmisión de la emisora. Al desactivarla, la portadora desaparece por completo y al receptor no le queda nada que limitar salvo su propio piso de ruido, de modo que produce el siseo a plena escala de un canal vacío. Permite recrear el cambio de sonido justo cuando una emisora empieza o termina su emisión. No es lo mismo que desactivar el efecto, que deja pasar la música sin alterarla.
- **Emphasis** (50 o 75 µs) - Selecciona el par de constantes de tiempo de preénfasis/deénfasis (50 µs: Japón/Europa, 75 µs: América). Con señal limpia el par casi se cancela; la elección cambia sutilmente el timbre del siseo y la distorsión.
- **Processing** (0 a +18 dB) - Excitación del limitador de emisión, la "sonoridad" de la emisora. 0 dB es casi transparente; los valores altos suenan más densos y fuertes, como las emisoras muy procesadas.
- **Signal** (0 a 70 dBµV) - Nivel de portadora en la entrada de antena. El piso de ruido queda fijado por la física (ruido térmico de 75 Ω más la figura de ruido del receptor), por lo que este control determina la relación portadora/ruido y es el eje principal de degradación. A partir de unos 50 dBµV la recepción es esencialmente limpia; cerca de 30 el siseo estéreo es claramente audible; cerca de 15 la mezcla Auto ya ha pasado a mono; a 6 o menos los clics se multiplican y el programa se hunde en el ruido.
- **Tuning** (-200 a +200 kHz) - Desintoniza el receptor respecto a la emisora. Los desajustes pequeños casi no se notan; desde aproximadamente ±40 kHz el sonido se vuelve cada vez más distorsionado, asimétrico y débil a medida que las bandas laterales salen del paso de banda de FI. A ±200 kHz, la emisora queda totalmente fuera de la banda de paso y solo permanece el ruido del receptor.
- **IF Band** (80 a 240 kHz) - Ancho del filtro de FI del receptor. Los ajustes estrechos representan un receptor pensado para bandas saturadas: recortan las bandas laterales FM y aumentan la distorsión, sobre todo combinados con desintonía. Los ajustes anchos son más limpios con una emisora fuerte y centrada.
- **Multipath** (0 a 100%) - Cantidad de efecto de dos reflexiones retardadas: al 100% la primera reflexión alcanza la misma amplitud que la onda directa y la segunda el 60% de la primera. A medida que crecen las reflexiones, los nulos de interferencia se profundizan y convierten la FM en errores de amplitud y fase que el limitador no puede eliminar del todo: desde una coloración sutil en ajustes bajos hasta la distorsión áspera y crepitante del multitrayecto severo cerca del 100%.
- **Path Delay** (0.5 a 50 µs) - Retardo de la primera reflexión (la segunda queda fija en 2.7 veces). Los retardos cortos dan una coloración amplia y de tipo fase; los largos producen una distorsión más nítida y localizada.
- **Fading** (0 a 20 Hz) - Velocidad de rotación de las fases de las reflexiones. 0 Hz congela el patrón de multitrayecto; los valores altos crean el aleteo y el efecto "valla" de la recepción en un coche en movimiento.
- **Stereo** (Auto / Stereo / Mono) - Auto mezcla de forma continua de estéreo a mono a medida que se degradan el enganche del piloto y la calidad de la señal, como un receptor real. Stereo fuerza el decodificador y expone toda la penalización de ruido estéreo con señales débiles. Mono descarta el subcanal L−R para una recepción claramente más silenciosa con señal débil.
- **Output** (-24 a +24 dB) - Ajuste de nivel tras la demodulación.
- **Mix** (0 a 100%) - Mezcla la señal demodulada con una señal seca alineada en latencia. 100% es recepción de radio completa; los valores menores reincorporan el original sin filtrado de peine.

### Lectura del HUD

- El gráfico muestra el **espectro MPX** observado a la salida del demodulador sobre un eje de frecuencia logarítmico, con marcadores en 15 kHz (final de la región L+R), el piloto de 19 kHz y el subcanal L−R en torno a 38 kHz (banda de 23 a 53 kHz). Al bajar Signal, el piso de ruido sube más cuanto mayor es la frecuencia — el espectro de ruido triangular característico de FM — y engulle primero la región L−R. Esa es la razón visible de que el estéreo se vuelva ruidoso antes que el mono.
- El **medidor de señal y la lectura en dBµV** muestran el nivel de portadora recibido, fijado por Signal y fluctuante por la interferencia multitrayecto.
- **CNR** es la relación portadora/ruido estimada. Los clics empiezan a aparecer cuando se acerca al umbral FM, en torno a 12 dB.
- El **indicador ST con su porcentaje** muestra la mezcla estéreo actual: 100% es estéreo completo y 0% mono. Con Stereo en Auto, el porcentaje cae según se degrada la señal.
- **MPath** muestra el nivel de la primera reflexión respecto a la onda directa en dB (−∞ cuando Multipath es 0%).
- **Clicks** cuenta los clics recientes de umbral FM por segundo y se resalta cuando se vuelven frecuentes.
- Si el motor **WASM** no está disponible, el HUD muestra un aviso y el audio pasa sin cambios.

### Ajustes recomendados

1. **Emisora local fuerte**
   - Emphasis: 50 µs, Processing: 6 dB, Signal: 50 dBµV, Tuning: 0 kHz, IF Band: 230 kHz
   - Multipath: 0%, Fading: 0 Hz, Stereo: Auto, Mix: 100%
   - Estéreo limpio solo con el carácter del procesamiento de emisión. Sube Processing para comparar el sonido de distintas emisoras.

2. **Recepción suburbana**
   - Signal: 30 dBµV, Tuning: 0 kHz, IF Band: 230 kHz, Multipath: 20%, Path Delay: 5 µs, Fading: 0.5 Hz
   - Stereo: Auto, Mix: 100%
   - Siseo estéreo claramente audible sobre la música. Compara con Stereo: Mono para oír desaparecer la penalización de ruido estéreo.

3. **Recepción en el límite de cobertura**
   - Signal: 15 dBµV, IF Band: 180 kHz, Multipath: 40%, Path Delay: 12 µs, Fading: 2 Hz
   - Stereo: Auto, Mix: 100%
   - La mezcla Auto ya ha pasado a mono y la recepción aletea. Fuerza Stereo para oír por qué los receptores mezclan hacia mono.

4. **Señal apenas presente**
   - Signal: 6 dBµV, Tuning: +30 kHz, Multipath: 60%, Path Delay: 12 µs, Fading: 5 Hz
   - Stereo: Auto, Mix: 100%
   - Por debajo del umbral FM: clics chisporroteantes, ruido intenso y un programa que entra y sale de la estática.

### Notas sobre el modelo

El efecto procesa el primer par estéreo como una única cadena de emisión; una entrada mono se emite con el canal L−R vacío. RDS, las emisoras adyacentes y las fuentes de interferencia quedan fuera de este modelo. Para el sonido multibanda de una "gran emisora", coloca un Multiband Compressor antes de este efecto; para interferencias impulsivas, encadena Noise Blender o Digital Error Emulator después.

## G.726 Simulator

G.726 Simulator procesa el canal mono o el par estéreo seleccionado mediante una conversión real de codificación y decodificación ITU-T G.726 a 8 kHz. El par estéreo se combina en mono antes de codificarse y la señal decodificada se envía a ambos canales seleccionados. Permite escuchar el ancho de banda, la cuantización diferencial adaptativa y los errores de predicción de la telefonía digital. Con Bit Error Rate en su valor predeterminado la ruta permanece totalmente limpia; al subirlo se añaden los errores de bit de un enlace inalámbrico como DECT.

Los modos de 16, 24, 32 y 40 kbit/s son las cuatro tasas estándar de G.726. El valor predeterminado de 32 kbit/s es el modo de voz full-slot usado históricamente por DECT. Las tasas inferiores dedican menos bits a cada muestra de 8 kHz y hacen más evidentes la cuantización granular, los tonos sostenidos ásperos y la sobrecarga de pendiente. Como el códec está diseñado para voz, la música de banda ancha deja sus límites especialmente claros.

Este efecto necesita su motor WebAssembly. Si el motor, la frecuencia de muestreo o el modo de canales no están disponibles, la entrada no cambia y el plugin muestra un mensaje comprensible. Al reanudar el procesamiento tras una suspensión, los remuestreadores y el estado predictivo del códec se reinician juntos para no reproducir audio almacenado antes de la suspensión.

### Guía de mejora del sonido

- **Voz telefónica representativa:** Empieza con 32 kbit/s, Output a 0 dB y Mix al 100%. La voz revela la banda estrecha de 8 kHz y la textura ADPCM adaptativa en un punto de funcionamiento históricamente común.
- **Comparar los artefactos por tasa:** Alterna entre 40, 32, 24 y 16 kbit/s con el mismo pasaje hablado. En las tasas bajas, escucha las vocales más granuladas, los tonos sostenidos más ásperos y la recuperación tras cambios bruscos de nivel.
- **Exponer el códec con música:** Usa percusión, notas brillantes sostenidas o mezclas densas a 16 o 24 kbit/s para hacer más audibles el límite de banda y los errores de predicción.
- **Añadir errores de radio:** Sube Bit Error Rate hacia -4.5 a -2 para oír cómo las palabras de código se rompen en crepitaciones y zonas ásperas. Déjalo en -6 para una comparación limpia de codificación y decodificación.
- **Mezclar el efecto:** Reduce Mix para conservar parte de la señal original. La ruta seca está alineada en latencia con la decodificada.
- **Igualar niveles:** Usa Output solo para compensar diferencias de volumen; no cambia la asignación de bits de G.726.

### Parámetros

- **Bitrate** — Selecciona 16, 24, 32 o 40 kbit/s. Cada muestra de 8 kHz usa respectivamente 2, 3, 4 o 5 bits ADPCM. Las tasas bajas aumentan los artefactos de cuantización y predicción.
- **Output** — Ajusta el nivel decodificado entre -24,0 y +12,0 dB sin cambiar el estado ni la tasa del códec.
- **Mix** — Mezcla el original alineado en latencia con el resultado decodificado, del 0% al 100%.
- **Bit Error Rate** — Define la tasa de errores de bit del enlace inalámbrico como potencia de diez, de -6 a -2 (predeterminado -6). En -6 la ruta está libre de errores. Los valores más altos invierten más bits dentro de las palabras de código ADPCM y producen el crepitar de un enlace DECT con mala recepción.

## GSM-FR Simulator

Cuando la salida de audio tiene un canal, GSM-FR Simulator procesa ese canal directamente. Con dos o más canales de salida, combina en mono el par estéreo seleccionado. A continuación, remuestrea la señal mono a 8 kHz y la procesa con el codificador y decodificador RPE-LTP normalizado de GSM-FR a 13 kbit/s. El resultado decodificado vuelve al único canal de salida o a los dos canales del par seleccionado. Sirve para examinar cómo la codificación de voz de los primeros móviles digitales modifica voces, percusión, sonidos sostenidos y música densa. Con C/I en su valor predeterminado la ruta permanece totalmente limpia; al bajarlo se reproduce una recepción GSM deficiente.

Cada trama de 20 ms se representa mediante parámetros cuantizados de predicción lineal, predicción a largo plazo y excitación de pulsos regulares. Transcodes repite la etapa completa de codificación y decodificación con estados independientes, por lo que reproduce la codificación en tándem y no actúa como un control genérico de «calidad». Los canales adicionales posteriores al par estéreo seleccionado no se modifican.

Este efecto necesita su motor de procesamiento WebAssembly. Si el motor, la frecuencia de muestreo o el modo de canales seleccionados no están disponibles, la entrada permanece sin cambios y el plugin muestra un mensaje de estado claro. Al reanudar el procesamiento tras una suspensión, se reinician juntos los remuestreadores, los búferes de trama y el estado del códec para no reproducir audio almacenado antes de la suspensión.

### Guía de mejora del sonido

- **Voz representativa de los primeros móviles:** Ajusta Transcodes a 1, Output a 0 dB y Mix al 100%, y compara voces, platos y percusión con el bypass.
- **Escuchar la codificación en tándem:** Mantén el mismo pasaje y cambia Transcodes de 1 a 2 y a 3. Aumentan el gorjeo, la inestabilidad y la pérdida de claridad porque la señal se vuelve a codificar y decodificar de verdad; los errores de radio son independientes: con C/I en 30 dB no hay ninguno y, al bajarlo, se reproducen.
- **Revelar el modelo de voz con música:** Usa Transcodes 3 con música brillante o densa para identificar mejor el ancho de banda de voz de 8 kHz, el zumbido RPE-LTP y la modificación de formantes.
- **Mezclar el resultado:** Reduce Mix para recuperar parte de la señal estéreo original. La ruta seca está alineada con la latencia del códec.
- **Igualar niveles antes de comparar:** Utiliza Output solo para compensar diferencias de volumen percibidas o medidas. No cambia el algoritmo del códec.

### Parámetros

- **Transcodes** — Selecciona 1, 2 o 3 ciclos completos de codificación y decodificación GSM-FR. Cada ciclo conserva un estado independiente y usa el mismo códec de 13 kbit/s. Los valores mayores intensifican los artefactos de la codificación en tándem.
- **Output** — Ajusta el nivel de la salida decodificada entre -24,0 y +12,0 dB. Sirve para igualar niveles; no modifica el estado ni la tasa de bits del códec.
- **Mix** — Mezcla entre el 0% y el 100% la señal original, alineada en latencia, con el resultado decodificado. Al 100%, los dos canales del par estéreo seleccionado contienen la misma señal mono decodificada; los valores menores recuperan la diferencia estéreo original.
- **C/I** — Define la relación portadora/interferencia del enlace de radio entre 4 y 30 dB (predeterminado 30). A 30 dB la recepción es prácticamente perfecta. Los valores bajos añaden pérdidas de trama con ocultación al estilo de GSM 06.11 (repetición atenuada de la trama anterior y silenciamiento tras pérdidas consecutivas) y distorsión por errores de bits de Clase 2, con los cortes irregulares de un móvil al límite de cobertura. Con Transcodes mayor que 1, la degradación se aplica solo al último salto.

## Hum Generator

Añade una capa ajustable de zumbido eléctrico de 50/60 Hz para un ánimo de escucha vintage o lo-fi. Usa niveles bajos cuando la reproducción limpia se siente demasiado estéril, o sube Level para un zumbido evidente de efecto sonoro.

### Guía de Carácter Sonoro
- Ambiente de Equipos Vintage:
  - Recrea el zumbido sutil de amplificadores y equipos clásicos
  - Agrega el carácter de estar "conectado" a alimentación AC
  - Crea una atmósfera de reproducción vintage
- Características de Fuente de Alimentación:
  - Simula diferentes tipos de ruido de fuente de alimentación
  - Recrea características regionales de red eléctrica (50Hz vs 60Hz)
  - Agrega carácter sutil de infraestructura eléctrica
- Textura de Fondo:
  - Crea presencia orgánica de bajo nivel en el fondo
  - Agrega profundidad y "vida" a reproducciones muy limpias
  - Útil para un ambiente de escucha vintage o lo-fi

### Parámetros
- **Frequency** - Establece la frecuencia fundamental del zumbido (10-120 Hz)
  - 50 Hz: Estándar de red eléctrica europea/asiática
  - 60 Hz: Estándar de red eléctrica norteamericana
  - Otros valores: Frecuencias personalizadas para efectos creativos
- **Type** - Controla la estructura armónica del zumbido
  - Standard: Contiene solo armónicos impares (más puro, tipo transformador)
  - Rich: Contiene todos los armónicos (complejo, tipo equipo)
  - Dirty: Armónicos ricos con distorsión sutil (carácter de equipo vintage)
- **Harmonics** - Controla el brillo y contenido armónico (0-100%)
  - 0-30%: Zumbido cálido y suave con armónicos superiores mínimos
  - 30-70%: Contenido armónico equilibrado típico de equipos reales
  - 70-100%: Zumbido brillante y complejo con armónicos superiores fuertes
  - En Type: Dirty, valores más altos de Harmonics también aumentan la distorsión y aspereza
- **Tone** - Frecuencia de corte del filtro de modelado tonal final (1.0-20.0 kHz)
  - 1-5 kHz: Carácter cálido y apagado
  - 5-10 kHz: Tono natural tipo equipo
  - 10-20 kHz: Carácter brillante y presente
- **Instability** - Cantidad de variación sutil de frecuencia y amplitud (0-10%)
  - 0%: Zumbido perfectamente estable (precisión digital)
  - 1-3%: Deriva natural leve
  - 3-10%: Fluctuación más perceptible, pero aún suave
- **Level** - Nivel de salida de la señal de zumbido (-80.0 a 0.0 dB)
  - -80 a -60 dB: Presencia de fondo apenas audible
  - -60 a -40 dB: Zumbido sutil pero notable
  - -40 a -20 dB: Carácter vintage prominente
  - -20 a 0 dB: Niveles creativos o de efectos especiales

### Configuraciones Recomendadas para Diferentes Estilos

1. Amplificador Vintage Sutil
   - Frequency: 50/60 Hz, Type: Standard, Harmonics: 25%
   - Tone: 8.0 kHz, Instability: 1.5%, Level: -54 dB
   - Perfecto para: Agregar carácter suave de amplificador vintage

2. Reproducción Vintage Clásica
   - Frequency: 60 Hz, Type: Rich, Harmonics: 45%
   - Tone: 6.0 kHz, Instability: 2.0%, Level: -48 dB
   - Perfecto para: Ambiente eléctrico de fondo de equipos de reproducción antiguos

3. Equipo Vintage de Tubos
   - Frequency: 50 Hz, Type: Dirty, Harmonics: 60%
   - Tone: 5.0 kHz, Instability: 3.5%, Level: -42 dB
   - Perfecto para: Carácter cálido de amplificador de tubos

4. Ambiente de Red Eléctrica
   - Frequency: 50/60 Hz, Type: Standard, Harmonics: 35%
   - Tone: 10.0 kHz, Instability: 1.0%, Level: -60 dB
   - Perfecto para: Fondo realista de fuente de alimentación

5. Textura de Zumbido Más Fuerte
   - Frequency: 40 Hz, Type: Dirty, Harmonics: 80%
   - Tone: 15.0 kHz, Instability: 6.0%, Level: -36 dB
   - Perfecto para: Una textura de zumbido más fuerte y audible

## MP3 Codec Simulator

MP3 Codec Simulator procesa los canales seleccionados mediante un análisis MPEG Layer III simplificado en tiempo real, cuantización espectral con un presupuesto de bits limitado y síntesis. Permite escuchar cómo un MP3 de baja tasa modifica los transitorios, el detalle en agudos, los tonos sostenidos y la imagen estéreo. Solo modela una conversión limpia del códec; no añade clics por archivos dañados, cortes, pérdida de paquetes ni errores de transmisión.

El perfil MPEG-1 de 44.1 kHz ofrece de 32 a 320 kbit/s. El perfil MPEG-2 de 22.05 kHz ofrece de 32 a 160 kbit/s y limita más el ancho de banda codificado. Este efecto requiere su motor WebAssembly; si el motor, la frecuencia de muestreo o el modo de canales no están disponibles, el audio permanece sin cambios.

### Guía de mejora del sonido

- Para oír claramente el carácter del MP3, empiece con 44.1 kHz, 48 o 64 kbit/s, Joint Stereo, Bit Reservoir On y Mix al 100%. La percusión, los platillos, los tonos sostenidos y las grabaciones estéreo amplias muestran mejor las diferencias.
- Compare 64 kbit/s con 128 o 192 kbit/s para oír cuánto detalle conserva un mayor presupuesto de bits. Pruebe 22.05 kHz a 32 o 48 kbit/s para una limitación de banda más intensa.
- Desactive Bit Reservoir en una pieza con pasajes tranquilos y densos. Cada trama deberá ajustarse por sí sola y los transitorios complejos pueden sonar más ásperos.

### Parámetros

- **Codec Rate** — Selecciona `44.1 kHz (MPEG-1)` o `22.05 kHz (MPEG-2)` y cambia el perfil, la estructura de trama y el ancho de banda codificado.
- **Bitrate** — Ajusta la tasa constante total del flujo mono o estéreo. MPEG-1 admite hasta 320 kbit/s y MPEG-2 hasta 160 kbit/s; los valores bajos aumentan los huecos espectrales, la aspereza tonal y la difusión de transitorios.
- **Stereo Mode** — `Joint Stereo` puede codificar el primer par estéreo como Mid/Side cuando resulta más eficiente; `Stereo` mantiene separados los espectros izquierdo y derecho.
- **Bit Reservoir** — Permite guardar capacidad no utilizada de tramas simples para tramas complejas posteriores.
- **Output** — Ajusta el nivel decodificado entre -24.0 y +12.0 dB.
- **Mix** — Mezcla entre 0% y 100% la señal original, alineada en latencia, con el resultado decodificado.

## Noise Blender

Un efecto que agrega textura atmosférica de fondo a tu música, similar al sonido de discos de vinilo o equipos vintage. Perfecto para crear atmósferas acogedoras y nostálgicas.

### Guía de Carácter de Sonido
- Sonido de Equipo Vintage:
  - Recrea la calidez de equipos de audio antiguos
  - Agrega "vida" sutil a grabaciones digitales
  - Crea una sensación vintage auténtica
- Experiencia de Disco de Vinilo:
  - Agrega esa atmósfera clásica de tocadiscos
  - Crea una sensación acogedora y familiar
  - Perfecto para escucha nocturna
- Textura Ambiental:
  - Agrega fondo atmosférico
  - Crea profundidad y espacio
  - Hace que la música digital se sienta más orgánica

### Parámetros
- **Noise Type** - Elige el carácter de la textura de fondo
  - White: Textura más brillante y presente
  - Pink: Sonido más cálido y natural
  - Brown: Textura más profunda y suave, con más peso en bajas frecuencias
- **Level** - Controla qué tan notable es el efecto (-96dB a 0dB)
  - Muy Sutil (-96dB a -72dB): Solo un toque
  - Suave (-72dB a -48dB): Textura notable
  - Fuerte (-48dB a -24dB): Carácter vintage dominante
- **Per Channel** - Crea un efecto más espacioso
  - On: Sonido más amplio e inmersivo
  - Off: Textura más enfocada y centrada

## SBC Codec Simulator

SBC Codec Simulator procesa los canales seleccionados mediante análisis SBC en tiempo real, asignación de bits, cuantización y síntesis. Permite comprobar cómo el códec base obligatorio de Bluetooth A2DP modifica el detalle de las frecuencias altas, las texturas tonales, los transitorios y la imagen estéreo. Con Packet Loss en su valor predeterminado la conversión es totalmente limpia; al subirlo se reproducen los cortes de un enlace Bluetooth real.

El códec funciona internamente a 44,1 kHz para la familia de frecuencias de 44,1 kHz y a 48 kHz para la de 48 kHz. El valor de solo lectura Bitrate se calcula a partir de la longitud exacta de trama SBC correspondiente a Bitpool, Channel Mode, Blocks y la frecuencia del códec actuales.

Este efecto requiere el motor de procesamiento WebAssembly. Si el motor, la frecuencia de muestreo o el modo de canales no están disponibles, la entrada no cambia y el plugin muestra un mensaje de estado claro.

### Guía de mejora del sonido

- **Comparación SBC habitual:** Empieza con Bitpool 35, Joint Stereo, 16 Blocks y Mix al 100 %. Compara con bypass usando platillos, tonos sostenidos, percusión y grabaciones estéreo amplias.
- **Hacer más audibles los artefactos:** Reduce Bitpool a 12–20. Habrá menos bits de cuantización para los ocho subbandas y los cambios en el detalle de agudos y los residuos tonales serán más claros.
- **Comparar la asignación estéreo:** Alterna entre Joint Stereo y Stereo mientras observas Bitrate. Joint Stereo puede codificar con más eficiencia material estéreo correlacionado; Stereo mantiene separadas las subbandas izquierda y derecha.
- **Reproducir SBC XQ:** Selecciona Dual Channel y pon Bitpool en 38 para la configuración conocida como «SBC XQ», o en 47 para «SBC XQ+». Con material a 44.1 kHz, Bitrate muestra 452.0 y 551.3 kbit/s, que coinciden con las cifras habituales. Con Bitpool 53 alcanza 617.4 kbit/s, la tasa máxima que puede generar este simulador. Todos estos ajustes quedan fuera de la recomendación de A2DP, pero son los que envían realmente los transmisores SBC de alta tasa y son el terreno donde más cuesta distinguir el códec del bypass.
- **Comparar la adaptación de trama:** Cambia Blocks de 16 a 4. Las tramas cortas actualizan los factores de escala con más frecuencia, pero dedican una proporción mayor a la sobrecarga fija y cambian el bitrate mostrado.
- **Añadir cortes inalámbricos:** Sube Packet Loss hacia el 5–20 % para oír cómo desaparecen tramas en ráfagas y cómo entra la ocultación. Déjalo en 0 % para una comparación limpia.
- **Mezclar el efecto:** Reduce Mix para añadir un carácter SBC más sutil. La ruta original está alineada con la latencia de la ruta codificada.

### Parámetros

- **Bitpool** — Define entre 2 y 53 el presupuesto de bits de cuantización de cada trama SBC. `Joint Stereo` y `Stereo` lo comparten entre el par estéreo, mientras que `Dual Channel` lo aplica por separado a cada canal. Los valores bajos dejan más subbandas con pocos bits o ninguno y acentúan los artefactos. Bitpool no expresa directamente kbit/s.
- **Channel Mode** — `Joint Stereo` puede codificar como suma y diferencia las subbandas correlacionadas cuando esto reduce los factores de escala necesarios. `Stereo` conserva separadas las subbandas izquierda y derecha. Estos dos modos comparten un Bitpool para el primer par estéreo; Joint Stereo no convierte simplemente la señal en mono. `Dual Channel` asigna a cada canal su propia distribución independiente con el Bitpool completo, por lo que la trama y la tasa de bits se duplican aproximadamente: es la configuración que hay detrás de «SBC XQ» y, al cuantizarse izquierda y derecha de forma independiente, la imagen estéreo fluctúa de manera distinta que con Joint Stereo.
- **Blocks** — Selecciona 4, 8, 12 o 16 bloques de muestras de subbanda por trama SBC. Menos bloques acortan la trama y aumentan la sobrecarga fija relativa; más bloques actualizan los factores de escala con menor frecuencia.
- **Bitrate** — Bitrate actual de solo lectura, en kbit/s, calculado con los bytes exactos de trama y la frecuencia del códec. Se actualiza al cambiar Bitpool, Channel Mode, Blocks, la familia de frecuencia de muestreo del host o el enrutamiento de la salida del host entre mono y estéreo.
- **Packet Loss** — Define la tasa de pérdida de paquetes del enlace Bluetooth entre 0 % y 20 % (predeterminado 0 %). Al 0 % no se pierde ninguna trama. Los valores altos descartan tramas SBC completas en ráfagas (modelo de Gilbert-Elliott) y la ocultación integrada repite la trama anterior atenuándola antes de fundir a silencio, igual que en un enlace inalámbrico real.
- **Output** — Ajusta el nivel decodificado entre -24,0 y +12,0 dB. Redúcelo si la sobreoscilación de los filtros del códec eleva demasiado los picos.
- **Mix** — Mezcla entre 0 y 100 % la señal original alineada en latencia con el resultado decodificado.

## Simple Jitter

Un efecto que agrega variaciones sutiles de tiempo para crear ese sonido digital vintage imperfecto. Puede hacer que la música suene como si se reprodujera a través de reproductores de CD antiguos o equipos digitales vintage.

### Guía de Carácter de Sonido
- Sensación Vintage Sutil:
  - Agrega inestabilidad suave como equipos antiguos
  - Crea un sonido más orgánico y menos perfecto
  - Perfecto para agregar carácter sutilmente
- Sonido Clásico de Reproductor de CD:
  - Recrea el sonido de reproductores digitales tempranos
  - Agrega carácter digital nostálgico
  - Genial para apreciación de música de los 90
- Efectos Creativos:
  - Crea efectos únicos de fluctuación
  - Transforma sonidos modernos en vintage
  - Agrega carácter experimental

### Parámetros
- **RMS Jitter** - Controla la cantidad de variación de tiempo (1ps a 10ms)
  - Sutil (1-10ps): Carácter vintage suave
  - Medio (10-100ps): Sensación clásica de reproductor de CD
  - Fuerte (100ps-1ms): Efectos creativos de fluctuación

### Configuraciones Recomendadas para Diferentes Estilos

1. Apenas Perceptible
   - RMS Jitter: 1-5ps
   - Perfecto para: Hacer que la reproducción se sienta apenas menos perfectamente digital

2. Carácter Clásico de CD Player
   - RMS Jitter: 50-100ps
   - Perfecto para: Recrear el sonido de los primeros equipos de reproducción digital

3. Máquina DAT Vintage
   - RMS Jitter: 200-500ps
   - Perfecto para: Carácter de equipos de grabación digital de los 90

4. Equipo Digital Desgastado
   - RMS Jitter: 1-2ns (1000-2000ps)
   - Perfecto para: Crear el sonido de equipos digitales envejecidos o mal mantenidos

5. Efecto Creativo de Fluctuación
   - RMS Jitter: 10-100µs (0.01-0.1ms)
   - Perfecto para: Efectos experimentales y modulación de tono notable

## SW Radio Simulator

SW Radio Simulator hace pasar la música por una cadena modelada de onda corta: procesado del transmisor y modulación AM o de banda lateral única, propagación ionosférica con desvanecimiento selectivo profundo, estática atmosférica y una emisora que comparte el canal, un receptor de comunicaciones de banda estrecha con detección de envolvente, síncrona o por BFO y AGC, y un altavoz de radio opcional. Úsalo para escuchar la música tal como llega una emisión internacional lejana a un receptor de onda corta: estrecha y hueca, subiendo y bajando con la ionosfera, con silbidos allí donde otro transmisor está cerca en frecuencia. Pon Mode en USB o LSB y la misma cadena se convierte en un receptor de comunicaciones, donde un dial que no está exactamente en frecuencia desplaza todo el sonido y lo vuelve nasal e inarmónico.

Este efecto necesita un entorno compatible con su procesamiento en tiempo real. Cuando ese procesamiento no está disponible, el audio no se modifica y el HUD indica que el efecto no está disponible.

### Diferencias frente a AM, FM y los efectos lo-fi aditivos

- **AM Radio Simulator** modela la recepción en onda media, donde normalmente domina una onda terrestre estable y el desvanecimiento es un efecto secundario. Su banda de paso es más ancha y ofrece estéreo C-QUAM.
- **SW Radio Simulator** modela la onda corta, donde la señal llega por reflexión ionosférica. El desvanecimiento selectivo profundo es el protagonista, la banda de audio es más estrecha y el silbido de heterodino de una emisora en el mismo canal forma parte del sonido. También ofrece recepción USB y LSB, algo que ningún otro efecto de aquí incluye. La transmisión en onda corta es mono, así que la señal procesada siempre es mono.
- **FM Radio Simulator** reproduce la FM de banda ancha con su multiplexado estéreo, su siseo creciente y sus chasquidos de umbral: otra familia de degradación.
- **Noise Blender** y **Hum Generator** añaden ruido o zumbido sobre una música que no cambia. Este efecto, en cambio, modula, propaga y detecta la música, por lo que su ruido, sus interferencias y su distorsión reaccionan a Tuning, al filtro IF y al AGC como en una recepción real.

### Guía de carácter del sonido

- **Estrecho y hueco:** el ancho de banda del transmisor y el IF estrecho del receptor eliminan la mayor parte de los agudos y dan el timbre limitado y cajonero de un receptor de onda corta.
- **Desvanecimiento lento y profundo (QSB):** el nivel recibido sube y baja continuamente. Es el comportamiento que define la onda corta y está activo con los valores por defecto.
- **Distorsión acuosa del desvanecimiento:** en un desvanecimiento profundo la portadora y las bandas laterales caen de forma distinta, así que el detector de envolvente ya no reconstruye el audio limpiamente. En el fondo de cada desvanecimiento el sonido se vuelve hueco, inestable y "submarino" en lugar de limitarse a bajar de volumen. Delay Spread controla su intensidad y la detección síncrona lo elimina en gran medida.
- **Flúter:** con Fading Speed alta las ondulaciones se convierten en un centelleo rápido, como una recepción por un trayecto perturbado o polar.
- **Silbido de heterodino (QRM):** el transmisor que comparte canal bate contra tu portadora y produce un tono continuo cuya altura es igual a Interf. Offset.
- **Estática atmosférica (QRN):** los rayos lejanos llegan como chasquidos que resuenan en el filtro IF.
- **Bombeo:** al pasar los desvanecimientos, el AGC persigue el nivel y el ruido de fondo respira entre pasajes.
- **Estrechez de banda lateral única (USB, LSB):** el audio recuperado llega solo hasta la mitad de IF Bandwidth en todos los modos —unos 3 kHz con el valor por defecto de 6 kHz— y, con la portadora suprimida y una sola banda lateral transmitida, la otra mitad de la banda de paso no lleva señal alguna y solo deja pasar ruido e interferencia, que es el sonido seco y limitado de un canal de comunicaciones.
- **Desintonía "voz de pato" (USB, LSB):** el BFO desplaza todos los componentes el mismo número de hercios en lugar de escalarlos, así que los armónicos dejan de ser múltiplos enteros del fundamental. Las voces y los instrumentos se vuelven nasales e inarmónicos, y USB y LSB desplazan en sentidos opuestos.
- **AGC silábico (USB, LSB):** entre frases no se transmite nada, así que el AGC sigue al propio programa. El fondo sube en las pausas y cada frase nueva empieza con un ataque audible.
- **Instante fuerte tras el silencio:** cuando la música arranca —al empezar la reproducción o tras una pausa— la ganancia sigue completamente abierta desde el silencio, así que el primer instante suena fuerte antes de que el AGC se asiente, y se nota sobre todo en USB y LSB. Es lo que hace un receptor encendido sobre un canal en calma, y se ha mantenido a propósito.
- **Desvanecimientos delgados y con huecos (USB, LSB):** un desvanecimiento profundo atenúa de forma desigual partes de la única banda lateral en lugar de producir la distorsión acuosa del detector de envolvente de AM, así que el sonido adelgaza y desaparecen trozos.

### Parámetros

#### Station

- **Radio** (activado o desactivado) - Activa y desactiva la transmisión de la emisora. Al desactivarla, la portadora desaparece por completo y en el receptor solo quedan la estática atmosférica, la emisora que comparte el canal y su propio ruido, con el AGC abierto del todo y ese fondo sonando fuerte. Permite recrear el cambio de sonido justo cuando una emisora empieza o termina su emisión. No es lo mismo que desactivar el efecto, que deja pasar la música sin alterarla.
- **TX Bandwidth** (2.0 a 10.0 kHz) - Define el ancho de banda de audio del transmisor. Los canales de onda corta están separados 5 kHz, así que el valor por defecto, estrecho, ya suena más oscuro que una emisora de onda media; súbelo para un transmisor más abierto.
- **Pre-emphasis** (0 a 100%) - Refuerza las frecuencias altas antes de transmitir. Los ajustes altos añaden presencia dentro de la banda estrecha, pero también hacen que los picos brillantes exciten más el limitador de emisión.
- **Mod Depth** (10 a 125%) - Define la profundidad de modulación AM. Por encima del 100% se producen sobremodulación y recorte de picos negativos.
- **Compression** (0 a 20 dB) - Define la intensidad del limitador de emisión. Los ajustes altos contienen los picos y mantienen la modulación más uniforme, que es como las emisoras internacionales siguen siendo inteligibles durante los desvanecimientos.

#### Propagation

- **Signal** (-50 a 0 dB) - Define la intensidad de la señal recibida. Las señales débiles dejan oír más ruido del receptor y requieren más ganancia de AGC.
- **Fading** (0 a 100%) - Reparte la potencia recibida entre un trayecto directo estable y dos trayectos ionosféricos retardados. Al 0% la recepción de corta distancia es estable; el valor por defecto da el desvanecimiento continuo de una señal lejana; al 100% los desvanecimientos son más profundos y la distorsión selectiva más intensa.
- **Fading Speed** (0.1 a 10.0 Hz) - Define la rapidez con la que cambian los trayectos ionosféricos. Los valores bajos producen ondulaciones lentas; a partir de unos pocos hercios el movimiento se convierte en un flúter rápido.
- **Delay Spread** (0.2 a 8.0 ms) - Define la diferencia de retardo entre los dos trayectos ionosféricos. Determina lo juntos que quedan los valles de desvanecimiento dentro de la banda de audio (unos 1 kHz de separación con 1 ms, y menos a medida que sube el valor), que es lo que hace que un desvanecimiento profundo suene acuoso en lugar de solo silencioso. Con valores cortos toda la banda se desvanece a la vez; con valores largos cada zona del espectro se desvanece en un momento distinto.
- **Static** (0 a 100/s) - Define la frecuencia de eventos de estática similares a rayos. Cada evento se inyecta antes del filtro IF y resuena en él. Con 0 se desactivan.
- **Interference** (-80 a 0 dB) - Define la intensidad de una emisora que comparte el canal. -80 dB la deja prácticamente desactivada; cuanto más se acerca a 0 dB, más intensa resulta.
- **Interf. Offset** (0.1 a 10 kHz) - Define a qué distancia está la portadora interferente de la tuya. Ambas portadoras baten a esa diferencia y producen el silbido de heterodino, así que este control fija su altura: por debajo de unos 3 kHz es un tono claro y, al subirlo, sube de altura hasta que el filtro IF empieza a atenuarlo. El programa de la emisora interferente se modela como ruido conformado, de modo que aporta una textura áspera y siseante en lugar de voz inteligible.

#### Tuning

- **Mode** (AM, USB o LSB) - Selecciona cómo se transmite y se recibe la emisora. AM es la emisión de doble banda lateral que da por supuesta el resto de esta descripción. USB y LSB suprimen la portadora y transmiten una sola banda lateral, como hacen las estaciones de radioaficionados y de servicio, y el receptor recupera el audio contra su propio oscilador de batido. Mode también decide qué controles se aplican: BFO Offset solo funciona en USB y LSB, y Detector y Detector RC solo en AM. Los controles que no se aplican aparecen desactivados y conservan su valor. USB y LSB salen a un nivel muy parecido al de AM con los mismos ajustes, y la diferencia que queda depende del factor de cresta del programa y de cuántas pausas tenga: el material denso se mide alrededor de un decibelio por encima de AM, mientras que el material de tipo vocal con pausas frecuentes llega a unos decibelios por encima, porque el AGC levanta el fondo durante las pausas. Es lo que hace un receptor real: el AGC normaliza el nivel dentro de la banda de paso IF y, con la portadora suprimida, ese nivel es el propio programa en vez de una portadora constante, así que la ganancia sigue al programa y sube en cada pausa.
- **Tuning** (-5.0 a +5.0 kHz) - Desintoniza el receptor respecto a la emisora. Las desviaciones pequeñas apagan el sonido, añaden distorsión por filtrado asimétrico y cambian el volumen del silbido de heterodino; las mayores sacan a la emisora de la estrecha banda de paso IF. En USB y LSB también desplaza el audio recuperado, junto con BFO Offset, y la altura del silbido de heterodino de una emisora interferente se mueve otro tanto.
- **BFO Offset** (-1000 a +1000 Hz) - Ajusta finamente el oscilador de batido en USB y LSB; no tiene efecto en AM. Junto con Tuning fija el desplazamiento de frecuencia que se aplica a todo lo que recupera el receptor. Ese desplazamiento es Tuning × 1000 − BFO Offset hercios: en USB se suma a cada componente y en LSB se resta de cada uno. Cero es exactamente en frecuencia, unas pocas decenas de hercios ya vuelven nasal el sonido, y valores mayores lo hacen ininteligible igual que un receptor desintonizado.
- **IF Bandwidth** (2.0 a 10.0 kHz) - Define la banda de paso IF del receptor. Los ajustes estrechos corresponden a la respuesta de un receptor de comunicaciones, que rechaza más ruido y más emisora interferente pero elimina más agudos; los anchos conservan más detalle y más interferencia. El audio recuperado llega a la mitad de este ajuste en todos los modos: unos 3 kHz con el valor por defecto de 6 kHz; en USB y LSB solo hay una banda lateral, así que la otra mitad de la banda de paso solo deja pasar ruido e interferencia. Mode no cambia este control por ti; bájalo tú mismo para un sonido de comunicaciones más estrecho.

#### Receiver

- **Detector** (Envelope o Synchronous) - Envelope es el detector de diodo habitual, y es lo que convierte un desvanecimiento selectivo profundo en distorsión acuosa. Synchronous recupera la portadora con un PLL y demodula respecto a ella, lo que reduce mucho esa distorsión mientras el desvanecimiento es profundo. Engancha en un margen de aproximadamente ±1 kHz de Tuning y pierde el enganche más allá, así que usa Envelope mientras mueves el dial. Cambiar de detector reinicia la adquisición de portadora. Solo se aplica en AM, porque USB y LSB usan siempre el detector de producto con BFO.
- **AGC Speed** (Slow, Mid o Fast) - Define la rapidez con la que el control automático de ganancia sigue los desvanecimientos. Slow deja audibles las variaciones de nivel y bombea al recuperarse la señal; Fast mantiene el nivel más contenido. En AM define tanto la rapidez con que la ganancia baja ante una subida como la rapidez con que vuelve a subir. En USB y LSB define solo la recuperación: la ganancia siempre baja en unos pocos milisegundos, como en un receptor de banda lateral única real, de modo que cada frase nueva queda controlada en lugar de dispararse.
- **Detector RC** (20 a 500 µs) - Define el tiempo de descarga del detector de envolvente. Los valores largos suavizan más la envolvente, pero aumentan la distorsión por recorte diagonal en agudos con modulación fuerte. No tiene efecto cuando Detector está en Synchronous, ni en USB y LSB.
- **Hum** (-80 a -20 dB) - Define el zumbido de la fuente de alimentación. -80 dB lo deja prácticamente desactivado. A diferencia de una capa de zumbido añadida, la mayor parte de este control modula la ganancia del receptor antes de la detección.
- **Hum Freq** (50 o 60 Hz) - Selecciona la frecuencia de red simulada.

#### Output

- **Speaker** (Off, Small o Table) - Selecciona salida de línea, el altavoz limitado de un receptor portátil de onda corta o la respuesta más plena de un receptor de comunicaciones de sobremesa.
- **Output Gain** (-24 a +24 dB) - Ajusta el nivel después del procesado del receptor y del altavoz.
- **Mix** (0 a 100%) - Mezcla la señal estéreo original con la recepción mono simulada. El 100% es recepción de onda corta completa, enviada igual a izquierda y derecha. Mix no retrasa la señal seca para alinearla, por lo que los ajustes intermedios combinan ambas con la diferencia temporal del receptor y de la propagación.

### Lectura del HUD

- **S METER** muestra, en una escala de S1 a S9, la intensidad de señal total que el receptor recibe dentro de su banda antes del AGC, en todos los modos. Igual que el S-metro de un receptor real, lee todo lo que hay dentro del paso de banda, así que la emisora del mismo canal, el ruido y la estática también hacen subir la lectura junto con la emisora deseada. En AM ese total lo domina la portadora y por eso es estable; en USB y LSB la portadora está suprimida, así que la lectura sigue al programa y cae hacia el ruido entre frases.
- **FADE** muestra en dB el cambio actual de ganancia debido a la propagación, y oscila tanto por debajo como por encima de 0 dB según el trayecto directo y los dos trayectos ionosféricos se cancelen o se refuercen. En onda corta es el indicador que hay que mirar: se mueve continuamente con los valores por defecto, y los mínimos más profundos son donde el sonido se vuelve acuoso y distorsionado. Siempre es la ganancia del trayecto en la frecuencia de la portadora, así que en USB y LSB indica esa ganancia para la portadora suprimida: no es la atenuación de la banda lateral en su conjunto ni el nivel del programa.
- **AGC GAIN** muestra cuánta ganancia aplica el receptor. Aumenta cuando Signal baja o se profundiza un desvanecimiento. Se detiene en +42 dB, por lo que los desvanecimientos más profundos quedan a menor volumen en lugar de compensarse por completo.
- **MOD / EVENTS**, rotulado **TX / EVENTS** en USB y LSB, muestra el porcentaje de modulación efectivo —el nivel de excitación de la banda lateral en USB y LSB— y, a continuación, las tasas recientes por segundo de estática (⚡) y de recorte (▲), y parpadea cuando se producen esos eventos. Si buscas un resultado más limpio y el recorte es frecuente, reduce Mod Depth o Detector RC. El contador de recorte registra la sobremodulación de AM y el recorte del detector de envolvente, así que se queda quieto en USB y LSB.
- Si el motor **WASM** no está disponible, el HUD lo indica y el plugin deja pasar el audio sin cambios.

### Ajustes recomendados

1. **Emisión internacional lejana**
   - TX Bandwidth: 4.5 kHz, Mod Depth: 90%, Signal: -15 dB, Fading: 55%, Fading Speed: 0.5 Hz, Delay Spread: 1.4 ms, Static: 2/s
   - Interference: -47 dB, Interf. Offset: 1.0 kHz, Tuning: 0 kHz, IF Bandwidth: 6.0 kHz, Detector: Envelope, AGC Speed: Fast, Hum: -80 dB, Speaker: Small, Mix: 100%
   - El sonido cotidiano de la onda corta: estrecho, en desvanecimiento continuo, con algún chasquido y un silbido tenue.

2. **Desvanecimiento nocturno profundo**
   - Signal: -30 dB, Fading: 100%, Fading Speed: 0.3 Hz, Delay Spread: 5.0 ms, Static: 10/s
   - IF Bandwidth: 4.0 kHz, Detector: Envelope, AGC Speed: Slow, Detector RC: 150 µs, Speaker: Small, Mix: 100%
   - Ondulaciones largas y profundas con distorsión acuosa en el fondo de cada desvanecimiento y un bombeo de AGC claramente audible al recuperarse la señal.

3. **Banda congestionada**
   - Signal: -20 dB, Fading: 60%, Fading Speed: 0.5 Hz, Static: 8/s, Interference: -18 dB, Interf. Offset: 0.8 kHz
   - Tuning: +0.3 kHz, IF Bandwidth: 4.0 kHz, AGC Speed: Mid, Speaker: Small, Mix: 100%
   - Un silbido de heterodino constante sobre el programa. Cambia Interf. Offset para mover su altura y Tuning para variar su volumen.

4. **Detección síncrona**
   - Parte de Desvanecimiento nocturno profundo y pon Detector: Synchronous
   - Los desvanecimientos profundos siguen ahí, pero la distorsión del fondo de cada uno es mucho menor y el programa se mantiene inteligible. Mantén Tuning dentro de unos ±1 kHz para que el detector siga enganchado y compara con Envelope para oír qué hace.

5. **Flúter polar**
   - Signal: -25 dB, Fading: 90%, Fading Speed: 6 Hz, Delay Spread: 3.0 ms, Static: 5/s
   - IF Bandwidth: 5.0 kHz, Detector: Envelope, AGC Speed: Fast, Speaker: Small, Mix: 100%
   - El centelleo rápido de un trayecto perturbado o polar en lugar de una ondulación lenta.

6. **Estación en banda lateral única**
   - Mode: USB, Tuning: 0 kHz, BFO Offset: 0 Hz, TX Bandwidth: 3.0 kHz, IF Bandwidth: 6.0 kHz
   - Signal: -20 dB, Fading: 55%, Fading Speed: 0.5 Hz, Static: 2/s, AGC Speed: Fast, Speaker: Small, Output Gain: 0 dB, Mix: 100%
   - Audio de comunicaciones estrecho y seco, en frecuencia, con el AGC respirando entre frases. Ya queda a un nivel cercano al de una emisora de AM, así que no hace falta ningún retoque adicional.

7. **Voz de pato desintonizada**
   - Parte de Estación en banda lateral única y pon BFO Offset: -150 Hz
   - Todos los componentes suben 150 Hz, así que los armónicos ya no encajan y las voces y los instrumentos se vuelven nasales e inarmónicos. Cambia Mode a LSB con el mismo ajuste para que todo baje 150 Hz en su lugar, y usa Tuning para desviaciones mayores.

### Notas sobre el modelo

El efecto procesa el primer par estéreo como una única transmisión mono, igual que hace la onda corta real, y la señal recibida siempre es mono. Se modela una sola emisora en el mismo canal, y su programa es ruido conformado, no voz ni música. USB y LSB modelan la recepción de una señal de banda lateral única con portadora suprimida; la banda lateral se selecciona en el transmisor, así que el receptor no añade su propio rechazo de la banda lateral opuesta, y los modos CW y de datos no se modelan. Las condiciones reales de banda —cambios de propagación entre el día y la noche y bandas de radiodifusión concretas— quedan fuera de este modelo; ajusta las condiciones que quieras con Signal, Fading y el resto de controles de propagación.

## Tape Artifacts

Tape Artifacts graba la música en una máquina analógica de bobina abierta modelada y la reproduce. La señal pasa por el amplificador de grabación y el realce de agudos que este imprime en la cinta, la saturación magnética de la propia cinta, el borrado de agudos que provoca la polarización de grabación, las pérdidas por longitud de onda de la cabeza reproductora, el wow y el flutter del transporte, la elevación de graves de la cabeza y la curva de reproducción que retira exactamente ese mismo realce, antes de que se añadan el siseo de cinta y el ruido de modulación. Úsalo cuando quieras que la música suene como si hubiera pasado por una máquina de cinta, en lugar de limitarte a superponer ruido o inestabilidad.

### Diferencias frente a otros efectos lo-fi

- **Tape Artifacts** transforma la propia música. La compresión suave, la calidez añadida, los agudos atenuados y la inestabilidad de afinación proceden todos de la misma cadena de grabación y reproducción, así que responden en conjunto a Speed, Tape, Bias y Record Level.
- **Wow Flutter** (Modulation) reproduce únicamente la variación de velocidad de un transporte. Elígelo cuando quieras la inestabilidad sin la saturación, la ecualización ni el siseo de la cinta.
- **Saturation** y **Hard Clipping** añaden no linealidad por sí sola, sin el comportamiento dependiente de la frecuencia ni el transporte de una máquina de cinta.
- **Noise Blender** y **Hum Generator** añaden una capa de ruido o zumbido sobre una música que no cambia. Aquí el siseo y el ruido de modulación se generan en el punto correcto de la máquina, así que siguen a Speed y Tape como lo hace el ruido real de la cinta.

### Guía de carácter del sonido

- **Speed marca el tono básico:** 30 ips es lo más abierto, 15 ips es el sonido de estudio conocido y 7.5 ips resulta claramente más oscuro, con una elevación de graves más marcada. El ruido no sigue sin más a la velocidad: sin señal, el suelo de siseo es mayor a 15 ips y menor a 30 ips, mientras que el ruido de modulación que viaja sobre la música es más fuerte a 7.5 ips.
- **Compresión suave de nivel:** cuanto más alto ajustes Record Level, más redondea la cinta los picos antes de distorsionar de forma audible, así que los pasajes fuertes se vuelven más densos y estables en lugar de recortarse de manera evidente. Con el valor por defecto de +6.0 dB y el Bias de referencia de 0.0 dB, un tono de 1 kHz a fondo de escala sale con 0.17 dB de redondeo y un 0.49% de distorsión: una máquina en su nivel de trabajo normal, no un trayecto digital limpio. La cantidad crece de forma suave a partir de ahí: 0.68 dB y un 2.0% en +12.0 dB, y 2.49 dB y un 6.8% en el tope de +18.0 dB. Cualquier cambio de nivel mayor que veas con el valor por defecto viene del cambio de timbre, no de la compresión, y ese va en los dos sentidos según el material: la música con mucho grave puede salir aproximadamente 1 dB más alta y el material con mucho agudo aproximadamente 1 dB más baja.
- **Calidez:** la saturación es asimétrica, por lo que genera armónicos pares e impares, y la calidez crece gradualmente a medida que sube Record Level en vez de aparecer de golpe.
- **El transporte se oye en las notas sostenidas:** el wow lento y el flutter más rápido hacen que las notas mantenidas de piano, órgano y cuerdas deriven muy ligeramente (0.160%, la desviación que indica el ajuste, con Wow/Flutter y Speed por defecto). Es lo que más claramente distingue la cinta de un archivo digital.
- **Un fondo vivo:** con los ajustes normales, el siseo y el ruido de modulación que viaja sobre la propia música forman parte del sonido. El siseo está en la cinta, así que Record Level mueve un decibelio por cada decibelio lo que este mide a la salida. Baja Hiss del todo, hasta -89.0 dB re 320 nWb/m, cuando quieras un fondo silencioso.

### Parámetros

- **Speed** (7.5, 15 o 30 ips) - Selecciona la velocidad de cinta. Las velocidades altas extienden los agudos y llevan la elevación de graves de la cabeza a una frecuencia mayor haciéndola más pequeña: +1.4 dB a 41 Hz a 7.5 ips, +0.8 dB a 80 Hz a 15 ips y +0.4 dB a 159 Hz a 30 ips. Además hacen el wow y el flutter más rápidos y menos profundos: Wow/Flutter indica la desviación ponderada a 15 ips y la velocidad la multiplica por 1.5 a 7.5 ips y por 0.75 a 30 ips, así que el 0.04% que la máquina de referencia publica a 15 ips da el 0.06% y el 0.03% que publica para las otras dos. El ruido no va en una sola dirección con la velocidad: el suelo de siseo es mayor a 15 ips y menor a 30 ips, mientras que el ruido de modulación que viaja sobre la música es más fuerte a 7.5 ips. 15 ips es el ajuste habitual de estudio, 7.5 ips el más oscuro y 30 ips el más cercano al original. Wow/Flutter y Hiss se indican ambos a los 15 ips de referencia, y la última línea del efecto muestra en qué queda cada uno de ellos con el Speed, el Tape y el Record Level que hayas elegido, junto al propio convenio de Record Level.
- **Tape** (Standard o Master) - Selecciona la formulación de la cinta. Master tiene una capa más gruesa y unos 3 dB más de margen antes de que la cinta sature, así que se mantiene limpia durante más tiempo y su extremo agudo es algo más suave. Con valores bajos de Record Level ambas quedan a un nivel parecido (0.08 dB de diferencia con el valor por defecto), pero cuanto más alto pongas Record Level más alta se mantiene Master: 0.34 dB en +12.0 dB y 1.16 dB en +18.0 dB, precisamente porque satura más tarde, así que iguala el volumen con Output cuando las compares.
- **Bias** (-6.0 a +6.0 dB) - Ajusta la polarización de grabación. 0 dB es la máquina correctamente alineada y es el punto al que llega el propio procedimiento de ajuste del fabricante: grabar 10 kHz 20 dB por debajo del nivel de trabajo, buscar el máximo de la curva de sensibilidad y subir la polarización hasta que la reproducción haya caído la cantidad publicada, que en la cinta Standard es de 1.5 dB a 30 ips, 4.0 dB a 15 ips y 5.0 dB a 7.5 ips. La cinta Master solo se diferencia a 7.5 ips, donde la caída es de 6.5 dB. Los valores altos (sobrepolarización) son más limpios y apagados. Los bajos (subpolarización) son más brillantes y distorsionados, como en una pletina mal ajustada, pero solo hasta ese máximo, que en la cinta Standard se sitúa en torno a -2.7 dB a 30 ips, -4.5 dB a 15 ips y -5.0 dB a 7.5 ips, y en Master a 7.5 ips en torno a -5.7 dB. Por debajo los agudos vuelven a oscurecerse mientras la distorsión sigue creciendo. Cuánto brillo se gana depende tanto de la frecuencia como de la velocidad: a 30 ips el máximo vale 1.5 dB a 10 kHz pero 2.9 dB a 16 kHz, y en -6.0 dB el extremo agudo ya está más apagado que en 0 dB, 0.2 dB a 10 kHz y 0.5 dB a 16 kHz.
- **Record Level** (-12.0 a +18.0 dB) - Ajusta con cuánta fuerza graba la máquina. El número es el nivel de cinta que alcanza un pico de 0 dBFS, en dB por encima del flujo de referencia de 320 nWb/m, y la línea de estado indica ese convenio. El control no aplica ganancia por sí mismo: mientras la cinta no sature, la misma señal sale al mismo nivel en cualquier posición de Record Level. Ese nivel no es exactamente la unidad - queda dentro de 0.05 dB de ella, algo por encima a 30 ips y algo por debajo a 7.5 ips -, pero no se mueve con Record Level. El valor por defecto de +6.0 dB es una máquina en su nivel de trabajo normal, donde un tono de 1 kHz a fondo de escala distorsiona un 0.49%; +12.0 dB da un 2.0% y el tope de +18.0 dB un 6.8%, y así es como se obtienen de ella la compresión y la calidez de cinta. El aplanamiento de los picos es la cinta, no el control bajando nada, así que cuanta más fuerza reciba la cinta más bajo sonará el resultado, y Output está para recuperar el volumen. Además mueve el fondo un decibelio por cada decibelio en sentido contrario, porque el siseo está grabado en la cinta y la cinta queda ahora más lejos por debajo del pico.
- **Wow/Flutter** (0 a 1%) - Ajusta la variación de velocidad del transporte, como desviación en pico ponderada según DIN 45507, en porcentaje a 15 ips. 0% es una máquina perfectamente estable. 0.04% es la tolerancia que la máquina de estudio de referencia publica a esa velocidad, y marcarla da el 0.06% a 7.5 ips y el 0.03% a 30 ips que esa misma máquina publica para esas velocidades. El valor por defecto de 0.160% es cuatro veces esa tolerancia; los valores mayores dan la deriva y el temblor audibles de una pletina desgastada, hasta un 1.5% a 7.5 ips.
- **Hiss** (-89.0 a -39.0 dB re 320 nWb/m) - Ajusta a la vez el nivel del siseo de cinta y del ruido de modulación, como el flujo de siseo con ponderación A a 15 ips en cinta Standard, referido a la referencia de 320 nWb/m. Es la cifra de la hoja de datos de la propia cinta y no un nivel a la salida: el ruido está grabado en la cinta, así que lo que mide a la salida depende de Record Level. -89.0 dB re 320 nWb/m apaga ambos por completo. El valor por defecto de -62.5 dB re 320 nWb/m es el ruido de polarización que el fabricante publica para esa cinta a esa velocidad; las demás velocidades y la cinta Master se apartan de él en lo que indica la hoja de datos, así que con ese valor por defecto y Record Level en +6.0 dB las seis combinaciones van de -68.0 a -72.0 dBFS, y el conjunto entero se mueve con los dos controles. Todas ellas están antes de Output, así que un medidor puesto después de Output las lee subidas por lo que marque Output. Ese suelo es lo que se oye en los silencios; mientras suena la música, lo que este control añade sobre todo es el ruido de modulación que viaja sobre la señal, unos 57 dB por debajo de un tono estable en cinta Standard a 15 ips, y unos pocos decibelios por encima o por debajo de eso con los demás ajustes de Speed y Tape y con material real. Los valores más altos hacen el fondo más evidente.
- **Output** (-24.0 a +24.0 dB) - Ajusta el nivel después de toda la cadena. Sirve para igualar el volumen al comparar con el bypass o para recuperar el volumen que ha costado un Record Level alto.
- **Mix** (0 a 100%) - Mezcla la señal de cinta con la original. El 100% es reproducción de cinta completa. La señal seca está alineada temporalmente con el trayecto de cinta, así que la zona media se mezcla con limpieza - 1 kHz se mantiene dentro de 0.1 dB de la unidad en cualquier posición de Mix y a cualquier velocidad con el Bias de referencia de 0.0 dB, y dentro de 0.5 dB en cualquier punto del recorrido de Bias -, pero la octava más alta no, porque allí seca y cinta ya no comparten fase y se cancelan en parte. Al 50% el nivel a 16 kHz sale 1.7 dB por debajo con un anfitrión a 44.1 kHz, 2.1 dB a 48 kHz, 4.6 dB a 96 kHz y 5.7 dB a 192 kHz, y con un anfitrión a 96 o 192 kHz el punto más apagado del control no es el 100% sino en torno al 70%. Con un anfitrión a 44.1 kHz solo se va apagando según lo subes, y con uno a 48 kHz el punto más apagado es el 89%, 0.06 dB por debajo del 100%, de modo que en ambos la zona media del control tiene el extremo agudo más brillante que el 100%. Al 0% la entrada pasa sin ningún cambio y el efecto no añade latencia; en cualquier otro ajuste añade 5.26 ms con un anfitrión a 44.1 kHz y 5.06 ms con uno a 192 kHz.

### Ajustes recomendados

1. **Cinta máster de estudio (por defecto)**
   - Speed: 15 ips, Tape: Standard, Bias: 0.0 dB, Record Level: +6.0 dB
   - Wow/Flutter: 0.160%, Hiss: -62.5 dB re 320 nWb/m, Output: 0.0 dB, Mix: 100%
   - El sonido de cinta cotidiano, y el valor por defecto del propio plugin: los agudos suavizados 3.5 dB a 16 kHz, una elevación de 0.8 dB en torno a 80 Hz, un 0.49% de distorsión y 0.17 dB de redondeo en un tono a fondo de escala, un fondo de -68.5 dBFS y un 0.160% de wow y flutter, audible en las notas mantenidas y no en los transitorios.

2. **Copia limpia a alta velocidad**
   - Speed: 30 ips, Tape: Master, Bias: 0.0 dB, Record Level: 0.0 dB
   - Wow/Flutter: 0.070%, Hiss: -68.5 dB re 320 nWb/m, Output: 0.0 dB, Mix: 100%
   - Muy cerca del original: un 0.07% de distorsión y 0.02 dB de redondeo en un tono a fondo de escala, 2.2 dB menos a 16 kHz, un fondo de -72.0 dBFS - en lo que se convierte el ajuste Base de -68.5 dB re 320 nWb/m a 30 ips con cinta Master y con este Record Level - y un 0.053% de wow y flutter. La cinta está grabada 6 dB por debajo del valor por defecto, y eso es lo que la mantiene tan limpia. Útil como referencia al comparar los demás ajustes.

3. **Cálido y comprimido**
   - Speed: 15 ips, Tape: Standard, Bias: 0.0 dB, Record Level: +18.0 dB
   - Wow/Flutter: 0.200%, Hiss: -62.5 dB re 320 nWb/m, Output: +1.5 dB, Mix: 100%
   - La cinta está grabada 12 dB por encima del valor por defecto, en el tope del recorrido: un tono a fondo de escala sale con 2.49 dB de redondeo y un 6.8% de distorsión, de modo que la mezcla se vuelve más densa y cálida mientras los picos se aplanan. Al mismo tiempo el fondo baja a -80.5 dBFS, porque el siseo está en la cinta y la cinta queda ahora esa misma cantidad más arriba. Output sube, no baja, porque la compresión cuesta volumen; ajústalo de oído.

4. **Pletina doméstica a 7.5 ips**
   - Speed: 7.5 ips, Tape: Standard, Bias: +2.0 dB, Record Level: +12.0 dB
   - Wow/Flutter: 0.300%, Hiss: -59.5 dB re 320 nWb/m, Output: +0.5 dB, Mix: 100%
   - Más oscuro (10.2 dB menos a 16 kHz, con una elevación de 1.4 dB a 50 Hz) y más ruidoso (un fondo de -72.5 dBFS, que es el suelo de cinta propio de -73.0 dBFS más sus +0.5 dB de Output), y menos estable (0.450% de wow y flutter), con un 1.3% de distorsión en un tono a fondo de escala. La polarización está algo alta, como suele estarlo en una pletina doméstica que usa cinta genérica: una máquina corriente en lugar de una de estudio.

5. **Transporte desgastado**
   - Speed: 7.5 ips, Tape: Standard, Bias: -2.0 dB, Record Level: +15.0 dB
   - Wow/Flutter: 0.480%, Hiss: -56.5 dB re 320 nWb/m, Output: +1.0 dB, Mix: 100%
   - Un 0.720% de wow y flutter, un 5.2% de distorsión y 1.80 dB de redondeo en un tono a fondo de escala, y un fondo de -72.0 dBFS - el suelo de cinta propio de -73.0 dBFS más sus +1.0 dB de Output - con el extremo agudo áspero y adelantado de una máquina subpolarizada, solo 4.4 dB menos a 16 kHz donde una máquina alineada a esta velocidad cae 7.2 dB. Output tiene que subir para recuperar el volumen. Un efecto lo-fi deliberadamente degradado.

### Notas sobre el modelo

El efecto modela una pasada de grabación y reproducción en una máquina correctamente alineada. El lado de grabación realza los agudos antes de la cinta y el de reproducción retira exactamente ese mismo realce, a todas las velocidades, en lugar de seguir una norma de ecualización publicada como la NAB. La copia por contacto, las caídas de señal de la cinta, el error de acimut, el ruido de empalme y las normas de ecualización propias de cada máquina quedan fuera del modelo. El trayecto de cinta lleva entre 5.06 y 5.26 ms de retardo de transporte y proceso con anfitriones de 44.1 a 192 kHz. Las cifras de timbre citadas arriba están medidas con un anfitrión a 96 kHz y con el Bias de referencia de 0.0 dB; el extremo agudo depende de la frecuencia de muestreo del anfitrión, así que los 3.5 dB a 16 kHz del ajuste por defecto pasan a ser 2.7 dB a 44.1 o 48 kHz.

## Vinyl Artifacts

Un efecto que añade artefactos de reproducción tipo vinilo, como pops, crackle, hiss, rumble y ruido de superficie reactivo. Añade ruido de disco generado a la música; no cambia el tono de la señal musical original como lo haría un modelo completo de tocadiscos, cápsula o preamplificador phono.

### Guía de Carácter de Sonido
- Experiencia de Disco de Vinilo:
  - Recrea el sonido auténtico de reproducir discos de vinilo
  - Agrega el ruido de superficie característico y artefactos
  - Crea una sensación nostálgica de reproducción en vinilo
- Sistema de Reproducción Vintage:
  - Añade artefactos de reproducción generados alrededor de la música
  - Moldea el tono del ruido de vinilo generado
  - Agrega ruido reactivo que responde a la música
- Textura Atmosférica:
  - Crea textura de fondo rica y orgánica
  - Agrega profundidad y carácter a las grabaciones digitales
  - Perfecto para crear experiencias de escucha acogedoras e íntimas

### Parámetros
- **Pops/min** - Controla la frecuencia de ruidos de clic grandes por minuto (0 a 120)
  - 0-20: Pops suaves ocasionales
  - 20-60: Carácter vintage moderado
  - 60-120: Sonido de desgaste pesado
- **Pop Level** - Controla el nivel de volumen de los clics (-80.0 a 0.0 dB)
  - -80 a -48 dB: Clics suaves
  - -48 a -24 dB: Clics moderados
  - -24 a 0 dB: Clics fuertes (configuraciones extremas)
- **Crackles/min** - Controla la densidad del ruido de crujido fino por minuto (0 a 2000)
  - 0-200: Textura de superficie sutil
  - 200-1000: Carácter de vinilo clásico
  - 1000-2000: Ruido de superficie pesado
- **Crackle Level** - Controla el nivel de volumen del crujido (-80.0 a 0.0 dB)
  - -80 a -48 dB: Crujido suave
  - -48 a -24 dB: Crujido moderado
  - -24 a 0 dB: Crujido fuerte (configuraciones extremas)
- **Hiss** - Controla el nivel de ruido de superficie constante (-80.0 a 0.0 dB)
  - -80 a -48 dB: Textura de fondo sutil
  - -48 a -30 dB: Ruido de superficie notable
  - -30 a 0 dB: Siseo prominente (configuraciones extremas)
- **Rumble** - Controla el retumbo de baja frecuencia del tocadiscos (-80.0 a 0.0 dB)
  - -80 a -60 dB: Calidez sutil en bajas frecuencias
  - -60 a -40 dB: Retumbo notable
  - -40 a 0 dB: Retumbo pesado (configuraciones extremas)
- **Crosstalk** - Mezcla el ruido de artefactos generado entre los canales izquierdo y derecho; la señal musical original conserva su separación estéreo (0 a 100%)
  - 0%: El ruido generado conserva su separación de canales original
  - 30-60%: Fuga de ruido realista al estilo vinilo
  - 100%: El ruido generado se vuelve casi igual entre izquierda y derecha
- **Noise Profile** - Ajusta la respuesta de frecuencia del ruido generado (0.0 a 10.0)
  - 0: Tono de ruido más oscuro y cálido
  - 5: Tono de ruido parcialmente moldeado
  - 10: Tono de ruido plano / modelado tonal omitido
- **Wear** - Escala artefactos de desgaste de superficie como pops, crackles y hiss (0 a 200%)
  - 0-50%: Ruido de superficie más limpio
  - 50-100%: Desgaste normal de superficie
  - 100-200%: Ruido de superficie muy desgastada
  - Rumble, Crosstalk y Noise Profile se controlan por separado
- **React** - Cuánto responde el ruido a la señal de entrada (0 a 100%)
  - 0%: Niveles de ruido estáticos
  - 25-50%: Respuesta moderada a la música
  - 75-100%: Altamente reactivo a la entrada
- **React Mode** - Selecciona qué aspecto de la señal controla la reacción
  - Velocity: Responde al contenido de alta frecuencia (velocidad de aguja)
  - Amplitude: Responde al nivel general de la señal
- **Mix** - Controla la cantidad de ruido añadido a la señal seca (0 a 100%)
  - 0%: Sin ruido añadido (solo señal seca)
  - 50%: Adición de ruido moderada
  - 100%: Máxima adición de ruido
  - Nota: El nivel de la señal seca permanece sin cambios; este parámetro solo controla la cantidad de ruido

### Configuraciones Recomendadas para Diferentes Estilos

1. Carácter de Vinilo Sutil
   - Pops/min: 20, Pop Level: -48dB, Crackles/min: 200, Crackle Level: -48dB
   - Hiss: -48dB, Rumble: -60dB, Crosstalk: 30%, Noise Profile: 5.0
   - Wear: 25%, React: 20%, React Mode: Velocity, Mix: 100%
   - Perfecto para: Añadir una textura suave de superficie de vinilo

2. Experiencia de Vinilo Clásica
   - Pops/min: 40, Pop Level: -36dB, Crackles/min: 400, Crackle Level: -36dB
   - Hiss: -36dB, Rumble: -50dB, Crosstalk: 50%, Noise Profile: 4.0
   - Wear: 60%, React: 30%, React Mode: Velocity, Mix: 100%
   - Perfecto para: Experiencia auténtica de escucha de vinilo

3. Disco Muy Desgastado
   - Pops/min: 80, Pop Level: -24dB, Crackles/min: 800, Crackle Level: -24dB
   - Hiss: -30dB, Rumble: -40dB, Crosstalk: 70%, Noise Profile: 3.0
   - Wear: 120%, React: 50%, React Mode: Velocity, Mix: 100%
   - Perfecto para: Carácter de disco muy envejecido

4. Lo-Fi Ambiental
   - Pops/min: 15, Pop Level: -54dB, Crackles/min: 150, Crackle Level: -54dB
   - Hiss: -42dB, Rumble: -66dB, Crosstalk: 25%, Noise Profile: 6.0
   - Wear: 40%, React: 15%, React Mode: Amplitude, Mix: 100%
   - Perfecto para: Textura ambiental de fondo

5. Vinilo Dinámico
   - Pops/min: 60, Pop Level: -30dB, Crackles/min: 600, Crackle Level: -30dB
   - Hiss: -39dB, Rumble: -45dB, Crosstalk: 60%, Noise Profile: 5.0
   - Wear: 80%, React: 75%, React Mode: Velocity, Mix: 100%
   - Perfecto para: Ruido que responde dramáticamente a la música

## Vinyl Simulator

Vinyl Simulator transforma la propia música mediante un modelo físico de corte y reproducción. Aplica los filtros de corte y la curva RIAA de grabación, escribe la señal en un surco con rugosidad y residuos, la sigue con una simulación mecánica de aguja y brazo, y aplica la ecualización RIAA de reproducción. Úsalo cuando quieras que la geometría del surco, el seguimiento y la superficie interactúen con la música.

### Diferencia frente a Vinyl Artifacts

- **Vinyl Simulator** modifica la señal al pasarla por el surco y la aguja modelados. Roughness, Dust, Static, Tracking Force, la forma de la aguja, Speed y Radius intervienen en el resultado.
- **Vinyl Artifacts** deja intacta la música y añade pops, crackle, hiss, rumble y fuga de ruido. Es la opción ligera y predecible, o la alternativa cuando no hay WASM.
- Se pueden combinar, pero ajustes de superficie intensos en ambos acumulan clics y ruido con rapidez.

### Guía de mejora del sonido

- **Reproducción suave:** Cut Level cerca de 0 dB, Shape en Elliptical, Roughness moderado, poco Dust y Static, y menor Mix para conservar más señal original.
- **Carácter de surco interior:** acerca Radius a 60 mm. La menor velocidad lineal exige más al seguimiento y a los agudos.
- **Reproducción limpia y estable:** reduce Roughness, Dust, Static y Scratch, mantén Tracking Force alrededor de 2 g y usa Standard o High.
- **Superficie envejecida:** sube primero Roughness y después Dust, Static y un poco de Scratch; cada control representa un fenómeno físico distinto.
- **Coloración más evidente:** sube Cut Level con cuidado, baja HF Cutoff o reduce Radius. Vigila la caída de Tracking S/E y el aumento de mistrack/skip.
- No incluye wow/flutter, excentricidad, alabeo ni rumble del plato. Añade **Wow Flutter** a la cadena si los necesitas.

### Parámetros

#### Cutting

- **Cut Level** (-20 a +20 dB) — Intensidad con la que la entrada mueve el cabezal de corte. Más nivel acentúa el desplazamiento y la no linealidad; menos deja mayor margen mecánico.
- **HF Cutoff** (6000 a 24000 Hz) — Límite de agudos antes del corte. Más bajo oscurece y facilita el seguimiento; más alto conserva detalle y exige más a la aguja.
- **Bass Mono Below** (50 a 1000 Hz) — Rango donde se reduce el componente Side. Al subirlo, más graves quedan centrados.
- **Side Mix** (0 a 100%) — Side que permanece bajo Bass Mono Below. 0% vuelve mono ese rango; 100% conserva el Side original.

#### Record

- **Speed** (33⅓, 45 o 78 rpm) — Velocidad de giro. A igual Radius, más velocidad aumenta la velocidad lineal y facilita seguir detalles finos.
- **Radius** (60 a 146 mm) — Posición de la aguja. Valores pequeños representan el surco interior, más lento y difícil en agudos.
- **Roughness** (0,1 a 100 nm) — Rugosidad microscópica; al subirla aumenta la textura continua de superficie.
- **Dust** (0 a 10000/s) — Frecuencia de partículas de polvo y perturbaciones breves.
- **Static** (0 a 10000/s) — Frecuencia de descargas eléctricas, añadidas como pops a la salida de la cápsula.
- **Scratch** (0 a 1000/s) — Frecuencia de defectos de surco mayores.

#### Stylus

- **Shape** (Spherical o Elliptical) — Geometría de contacto. En Spherical, Scan Radius sigue a Side Radius. Cambiarla reconstruye el estado de simulación.
- **Side Radius** (5 a 25 µm) — Radio transversal sobre la pared; cambia la huella y la presión de contacto.
- **Scan Radius** (2 a 25 µm) — Radio en la dirección del surco. Pequeño sigue detalles finos; grande promedia sobre un contacto más amplio.
- **Tracking Force** (0,5 a 5,0 g) — Fuerza de apoyo. Más puede estabilizar el contacto, pero eleva fuerza y presión; muy poca favorece mistrack y skip.
- **Tip Mass** (0,1 a 1,5 mg) — Masa móvil de la punta. Más masa añade inercia y dificulta seguir movimientos rápidos.
- **Compliance** (5 a 35 cu) — Flexibilidad de la suspensión. Valores altos permiten más movimiento y cambian la respuesta mecánica.
- **Damping** (0,05 a 1,0 ζ) — Amortiguación de resonancias. Valores altos reducen más el ringing.

#### Output

- **Quality** (Eco, Standard, High o Ultra) — Define el número base de subpasos físicos y puntos de contacto. Para estabilizar la resonancia de contacto, el motor puede aumentar automáticamente los subpasos efectivos según la frecuencia de muestreo, Tracking Force, Tip Mass, Compliance, Shape, Side Radius y Scan Radius. Standard es el valor predeterminado en tiempo real; cambiarlo reconstruye la simulación.
- **Output Gain** (-24 a +24 dB) — Nivel después de la ecualización RIAA y la normalización.
- **Mix** (0 a 100%) — Mezcla la reproducción simulada con la señal seca alineada en latencia. 0% = seca; 100% = simulada.

### Cómo leer el HUD

- **Force L/R (mN):** fuerza en cada pared; valores altos o desiguales indican un pasaje exigente.
- **Pressure (GPa):** mayor presión de contacto actual; léela junto a Force al ajustar la aguja.
- **Tip (cm/s, dB):** velocidad de la punta y nivel de reproducción resultante.
- **Tracking S/E L/R (dB):** relación entre señal seguida y error. Más alto significa seguimiento más limpio; una caída sostenida indica dificultad.
- **Jitter (ns):** variación temporal del punto de lectura, visible en Stylus.
- **Mistrack, Skip, Static Pop y Dust Hit (/s):** tasas recientes con un destello en cada evento. Si se repiten, baja Cut Level, sube moderadamente Tracking Force, aumenta Radius o Quality.

El HUD se activa con la telemetría DSP nativa. Al parar o suspender la telemetría para ahorrar energía, puede mostrar un estado inactivo.

### Ajustes recomendados

1. **Reproducción suave:** Cut Level 0 dB, HF Cutoff 16 kHz, 33⅓ rpm, Radius 120 mm, Roughness 5 nm, Dust 0,5/s, Static 0,02/s, Scratch 0/s, Elliptical, Tracking Force 2,0 g, Standard, Mix 75%.
2. **Surco exterior clásico:** Cut Level 0 dB, 33⅓ rpm, Radius 135 mm, Roughness 13,17 nm, Dust 2/s, Static 0,08/s, Elliptical, Tracking Force 2,0 g, Standard, Mix 100%.
3. **Demostración interior:** Cut Level +3 dB, HF Cutoff 14 kHz, Radius 60 mm, Elliptical, Scan Radius 8 µm, Tracking Force 2,0 g, High, Mix 100%; compara Tracking S/E con un Radius mayor.
4. **Superficie gastada:** Radius 100 mm, Roughness 35 nm, Dust 25/s, Static 1/s, Scratch 0,5/s, Tracking Force 2,2 g, Standard, Output Gain -3 dB, Mix 100%.

### Quality y carga de CPU

Cada preset Quality fija unos subpasos base y unos puntos de contacto. Para mantener la estabilidad, el motor también calcula `Nmin = ceil(8 × f_c / sampleRate)`, donde la frecuencia de resonancia de contacto `f_c` depende de Tracking Force, Tip Mass, Compliance, Shape, Side Radius y Scan Radius, y utiliza `effectiveSubsteps = max(base, Nmin)`. Con los ajustes predeterminados, Standard a 96 kHz permanece en su base de 4 subpasos, por lo que el objetivo de rendimiento existente no cambia.

La carga principal es proporcional a frecuencia de muestreo × subpasos efectivos × puntos de contacto. Las evaluaciones y cargas relativas de la tabla son valores base cuando el límite de estabilidad no aumenta los subpasos, no porcentajes de CPU medidos; también influyen el procesador, el navegador y WASM SIMD.

| Quality | Detalle base | Evaluaciones base a 96 kHz | Carga relativa base | Uso |
|---|---:|---:|---:|---|
| Eco | 2 × 7 | 2,7 millones/s | 0,39× | Móvil, bajo consumo, varias instancias |
| Standard | 4 × 9 | 6,9 millones/s | 1,00× | Escucha normal en tiempo real |
| High | 8 × 13 | 20 millones/s | 2,89× | Sistemas rápidos, comparación detallada |
| Ultra | 20 × 25 | 96 millones/s | 13,89× | Renderizado sin conexión y verificación |

Cuando el límite de estabilidad está inactivo, aplica a la carga relativa base estos multiplicadores: 44,1 kHz = 0,46×; 48 = 0,50×; 88,2 = 0,92×; 96 = 1,00×; 176,4 = 1,84×; 192 = 2,00×. La frecuencia de muestreo y los ajustes Tracking Force, Tip Mass, Compliance, Shape, Side Radius y Scan Radius pueden activar el límite y elevar la carga real sobre esta estimación base. Si hay cortes, baja primero Quality.

### Requisito de WASM y límites

Vinyl Simulator necesita el núcleo DSP WebAssembly nativo para el proceso en tiempo real. Si WASM está desactivado mediante `?dsp=off`, no es compatible o falla al iniciarse, la entrada pasa sin cambios y la interfaz indica que se requiere WASM. No usa como alternativa la simulación JavaScript de referencia, mucho más lenta.

El modelo procesa el primer par estéreo. La deformación del polvo solo dura mientras cada partícula está activa y la aguja avanza siempre por surco recién generado; el desgaste no se acumula entre vueltas ni se guarda en presets. Desgaste a largo plazo, vista 3D, medidores SNR/THD en tiempo real, wow/flutter, excentricidad, alabeo, rumble del plato y carga eléctrica de la cápsula quedan fuera del modelo.

¡Recuerda: Estos efectos están diseñados para agregar carácter y nostalgia a tu música. ¡Comienza con ajustes sutiles y ajusta al gusto!
