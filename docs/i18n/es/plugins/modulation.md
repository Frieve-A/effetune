---
title: "Plugins de modulación - EffeTune"
description: "Efectos de modulación como Auto Filter, Auto Pan, Chorus, Frequency Shifter, Phaser y Rotary Speaker."
lang: es
---

# Plugins de modulación

Una colección de plugins que añaden movimiento y variación a tu música mediante efectos de modulación. Estos efectos pueden hacer que tu música digital se sienta más orgánica y dinámica, mejorando tu experiencia auditiva con variaciones sutiles o dramáticas en el sonido.

## Lista de Plugins

- [Auto Filter](#auto-filter) - Barre un filtro resonante con un LFO o con la envolvente de la señal
- [Auto Pan](#auto-pan) - Mueve suavemente cada par estéreo por el campo sonoro
- [Chorus](#chorus) - Ofrece chorus, ensemble, flanger y vibrato mediante retardos móviles
- [Doppler Distortion](#doppler-distortion) - Simula los cambios naturales y dinámicos en el sonido producidos por el sutil movimiento del cono del altavoz.
- [Frequency Shifter](#frequency-shifter) - Traslada frecuencias, aplica Ring Mod o un barrido Barber-pole
- [Phaser](#phaser) - Crea picos y muescas móviles mediante barridos de fase
- [Pitch Shifter](#pitch-shifter) - Cambia el tono de tu música sin afectar la velocidad de reproducción
- [Pitch Shifter HQ](#pitch-shifter-hq) - Cambia el tono con menos artefactos de fase cuando la calidad importa más que la latencia o el uso de CPU
- [Rotary Speaker](#rotary-speaker) - Combina el movimiento independiente de bocina y tambor
- [Tremolo](#tremolo) - Crea variaciones rítmicas de volumen para un sonido pulsante y dinámico
- [Wow Flutter](#wow-flutter) - Recrea las suaves variaciones de tono de los discos de vinilo y los reproductores de cinta

## Auto Filter

Mueve automáticamente un filtro de variable de estado mediante un LFO o la envolvente de la señal de entrada. El modo Envelope puede usarse como Envelope Filter o Auto Wah. La latencia algorítmica es 0.

### Consejos de ajuste

- Para un cambio tonal suave, empiece con LFO, Low-pass, una Resonance baja y un Mix de aproximadamente 30–50%.
- Para Auto Wah, elija Envelope y Band-pass, y ajuste Sensitivity para que los sonidos fuertes abran el filtro en la medida adecuada.
- Un Attack más largo suaviza la respuesta a los ataques, mientras que un Release más largo hace que el filtro regrese con mayor suavidad.

### Parámetros

- **Style**: Ajuste de fábrica completo que define todos los parámetros. Las opciones son **Auto Filter Sweep** (LFO), **Stereo Filter Sweep** (LFO), **Envelope Filter** (Envelope), **Auto Wah** (Envelope) y **Reverse Auto Wah** (Envelope). Al modificar un parámetro individual, cambia a **Custom**.
- **Mode**: Alterna entre LFO, que se mueve de forma periódica, y Envelope, que sigue el volumen.
- **Filter Type**: Permite elegir Low-pass, Band-pass o High-pass.
- **Minimum Frequency / Maximum Frequency** (20–20.000 Hz): Definen el intervalo de movimiento. Si están en orden inverso, se reordenan automáticamente; si son iguales, el filtro queda fijo. Durante el procesamiento se limitan a un margen seguro por debajo de la frecuencia de Nyquist.
- **Resonance** (Q 0,5–20): Los valores más altos realzan más la zona cercana a la frecuencia de corte.
- **Mix** (0–100%): Proporción entre la señal original y la señal filtrada. Al 0% solo se oye la señal original.
- **Rate**, **Waveform**, **Stereo Phase**: Velocidad, trayectoria y diferencia de fase dentro de cada par estéreo del LFO. Solo se usan en el modo LFO.
- **Sensitivity**, **Attack**, **Release**, **Direction**: Cantidad de respuesta, tiempo de subida, tiempo de retorno y dirección del movimiento de la envolvente. Solo se usan en el modo Envelope.

## Auto Pan

Mueve el volumen de cada par estéreo adyacente de izquierda a derecha. No mezcla audio entre pares y, si queda un último canal sin pareja, lo trata como mono. La latencia algorítmica es 0.

### Consejos de ajuste

- Empiece con una Rate de aproximadamente 0,2–0,5 Hz y una Depth moderada para obtener un movimiento relajado.
- Si el efecto resulta demasiado amplio con auriculares, reduzca Width; ajuste la posición base izquierda/derecha con Center.
- Sine se desplaza más despacio en los extremos, mientras que Triangle mantiene una velocidad más uniforme.

### Parámetros

- **Style**: Ajuste de fábrica completo que define todos los parámetros. Las opciones son **Gentle Auto Pan**, **Wide Auto Pan** y **Fast Auto Pan**. Al modificar un parámetro individual, cambia a **Custom**.
- **Rate** (0,05–20 Hz): Velocidad del movimiento.
- **Depth** (0–100%): Cantidad de movimiento alrededor de Center. Al 0% no hay cambio.
- **Center** (-100–100%): Desplaza la posición central hacia la izquierda o la derecha.
- **Width** (0–100%): Amplitud estéreo utilizada.
- **Waveform**: Sine o Triangle.
- **Phase** (0–360°): Posición inicial del movimiento periódico.

## Chorus

Añade varias señales de retardo variable con interpolación cúbica de cuatro puntos. Mode permite elegir Stereo Chorus, Ensemble, Flanger o Vibrato, además de Chorus. Los retardos variables producen un retraso audible, pero no constituyen una latencia fija; por ello, la latencia algorítmica indicada es 0.

### Consejos de ajuste

- Para añadir grosor natural, use Classic Chorus o Stereo Chorus con valores moderados de Rate y Depth.
- Ensemble se vuelve más denso al aumentar Voices. Una Depth excesiva hace más evidente la variación de tono.
- Solo Flanger utiliza Feedback. Los valores positivos y negativos cambian la polaridad del filtro de peine.
- Vibrato siempre usa una señal 100% procesada.

### Parámetros

- **Style**: Ajuste de fábrica completo que define todos los parámetros. Las opciones son **Classic Chorus** (Chorus), **Stereo Chorus** (Stereo Chorus), **Ensemble** (Ensemble), **Flanger** (Flanger), **Jet Flanger** (Flanger) y **Vibrato** (Vibrato). Al modificar un parámetro individual, cambia a **Custom**.
- **Mode**: Permite elegir Chorus, Stereo Chorus, Ensemble, Flanger o Vibrato.
- **Rate** (0,05–10 Hz): Velocidad de la modulación.
- **Delay** (0,5–30 ms): Retardo de referencia de la señal procesada.
- **Depth** (0–20 ms): Cantidad de variación del retardo. Para evitar lecturas con retardo negativo, el valor guardado se limita a Delay.
- **Voices** (1–6): Número de derivaciones variables en Chorus y Ensemble. Se ignora en los demás modos.
- **Stereo Spread** (0–100%): Diferencia de modulación dentro de cada par estéreo. Se ignora en el modo Chorus.
- **Feedback** (-75–75%): Solo se usa en Flanger.
- **Mix** (0–100%): Proporción lineal entre la señal original y la procesada. En Vibrato se ignora y la señal es siempre 100% procesada.

## Doppler Distortion

Experimenta un efecto de audio único que aporta un toque de movimiento natural a tu música. Doppler Distortion simula las suaves distorsiones creadas por el movimiento físico de un cono de altavoz. Este efecto introduce leves cambios en la profundidad y el tono del sonido, al igual que los cambios de tono habituales que escuchas cuando una fuente de sonido se mueve en relación a ti. Añade una cualidad dinámica e inmersiva a tu experiencia auditiva, haciendo que el audio se sienta más vivo y atractivo.

### Parámetros

- **Coil Force (N / V)**
  Controla la fuerza del movimiento simulado de la bobina del altavoz. Los valores más altos producen una distorsión más pronunciada.

- **Speaker Mass (kg)**  
  Simula el peso del cono del altavoz, afectando la naturalidad con la que se reproduce el movimiento.  
  - **Valores más altos:** Aumentan la inercia, resultando en una respuesta más lenta y en distorsiones más suaves y sutiles.  
  - **Valores más bajos:** Reducen la inercia, provocando un efecto de modulación más rápido y marcado.

- **Spring Constant (N/m)**  
  Determina la rigidez de la suspensión del altavoz. Un spring constant mayor produce una respuesta más nítida y definida.

- **Damping Factor (N·s/m)**  
  Ajusta la rapidez con la que se estabiliza el movimiento simulado, equilibrando un movimiento dinámico con transiciones suaves.  
  - **Valores más altos:** Conducen a una estabilización más rápida, reduciendo las oscilaciones y produciendo un efecto más ajustado y controlado.  
  - **Valores más bajos:** Permiten que el movimiento persista por más tiempo, resultando en una fluctuación dinámica más suelta y prolongada.

### Configuración recomendada

Para una mejora equilibrada y natural, comienza con:
- **Coil Force:** 8.0 N / V
- **Speaker Mass:** 0.03 kg  
- **Spring Constant:** 6000 N/m  
- **Damping Factor:** 1.5 N·s/m  

Estos ajustes proporcionan un sutil Doppler Distortion que enriquece la experiencia auditiva sin opacar el sonido original.

## Frequency Shifter

Desplaza cada componente de frecuencia una cantidad fija en Hz, no según una relación de tono. Ring Mod multiplica por una portadora, mientras que Barber-pole superpone desplazamientos para crear la sensación de un ascenso o descenso continuo. Shift y Barber-pole usan un FIR de señal analítica de Hilbert; Ring Mod multiplica por la portadora la señal real con el mismo retardo, extraída de la misma FIFO. Así, la señal original y la procesada quedan alineadas en todos los modos. La latencia fija depende de la frecuencia de muestreo y la comunica DSP Library.

### Consejos de ajuste

- Para un cambio discreto, elija Shift y empiece con aproximadamente ±5–15 Hz. A diferencia de Pitch Shifter, también cambia el espaciado entre armónicos.
- Para un timbre metálico, use Ring Mod. Una Carrier Frequency más baja ayuda a conservar el ritmo de la señal original.
- Para una sensación de movimiento continuo, use Barber-pole con una Rate baja y mantenga Mix moderado para conservar la claridad.

### Parámetros

- **Style**: Ajuste de fábrica completo que define todos los parámetros. Las opciones son **Shift Up** (Shift), **Shift Down** (Shift), **Fine Detune** (Shift), **Ring Modulator** (Ring Mod), **Barber-pole Up** (Barber-pole) y **Barber-pole Down** (Barber-pole). Al modificar un parámetro individual, cambia a **Custom**.
- **Mode**: Shift, Ring Mod o Barber-pole.
- **Shift** (-5.000–5.000 Hz): Cantidad de desplazamiento en el modo Shift. Los valores positivos desplazan hacia arriba y los negativos hacia abajo.
- **Carrier Frequency** (0,1–10.000 Hz): Frecuencia de la portadora de Ring Mod.
- **Minimum Shift / Maximum Shift** (0–5.000 Hz): Intervalo de Barber-pole. Si están en orden inverso, se reordenan; si son iguales, el desplazamiento queda fijo.
- **Rate** (0,01–2 Hz), **Direction**: Velocidad y dirección de Barber-pole.
- **Stereo Phase** (0–180°): En todos los modos, introduce un desfase de la portadora o del barrido entre los canales izquierdo y derecho de cada par estéreo.
- **Mix** (0–100%): Proporción entre la señal original con retardo compensado y la señal procesada. Incluso al 0% se mantiene la latencia fija indicada.

Los desplazamientos grandes pueden generar componentes por encima de la frecuencia de Nyquist y producir aliasing audible. La versión inicial no aplica sobremuestreo.

## Phaser

Mezcla la señal original con la salida de una cadena de filtros all-pass para crear picos y muescas móviles. Classic oscila en ambos sentidos; Barber-pole superpone tres ventanas de potencia constante para dar una sensación continua de ascenso o descenso. La latencia algorítmica es 0.

### Consejos de ajuste

- Para obtener muescas claras, empiece con Classic, 4–6 Stages, un Range moderado y un Mix cercano al 50%.
- Al aumentar Stages y Feedback, el efecto se vuelve más profundo y resonante. Redúzcalos si colorea demasiado los ataques.
- Ajuste la amplitud con Stereo Phase y elija Barber-pole Up/Down para un movimiento continuo.

### Parámetros

- **Style**: Ajuste de fábrica completo que define todos los parámetros. Las opciones son **Classic Phaser** (Classic), **Deep Phaser** (Classic), **Stereo Phaser** (Classic), **Barber-pole Up** (Barber-pole) y **Barber-pole Down** (Barber-pole). Al modificar un parámetro individual, cambia a **Custom**.
- **Mode**: Classic o Barber-pole.
- **Rate** (0,05–10 Hz): Velocidad del barrido.
- **Center Frequency** (80–8.000 Hz): Centro del barrido logarítmico.
- **Range** (0–6 octavas): Amplitud del barrido.
- **Stages** (números pares de 2 a 12): Número de etapas all-pass. Al aumentarlo se añaden más muescas.
- **Feedback** (-90–90%): Cantidad de señal procesada que vuelve a la entrada. El valor absoluto determina la intensidad y el signo cambia la forma del realce.
- **Stereo Phase** (0–180°): Diferencia de movimiento dentro de cada par estéreo.
- **Direction**: Up/Down de Barber-pole. Se ignora en Classic.
- **Mix** (0–100%): Proporción lineal entre la señal original y la procesada. La cancelación es más profunda cerca del punto medio.

## Pitch Shifter

Un efecto que cambia el tono de tu música sin afectar su velocidad de reproducción. Esto te permite experimentar tus canciones favoritas en diferentes tonalidades, haciendo que suenen más altas o más bajas mientras se mantiene el tempo y ritmo original.

### Parámetros
- **Pitch Shift** - Cambia el tono general en semitonos (-6 a +6)
  - Valores negativos: Baja el tono (sonido más profundo y grave)
  - Cero: Sin cambio (tono original)
  - Valores positivos: Eleva el tono (sonido más agudo y brillante)
- **Fine Tune** - Realiza ajustes sutiles en el tono en centésimas (-50 a +50)
  - Permite una afinación precisa entre semitonos
  - Perfecto para ajustes menores cuando un semitono completo es excesivo
- **Window Size** - Controla el tamaño de la ventana de análisis en milisegundos (80 a 500ms)
  - Valores más pequeños (80-150ms): Mejor para material rico en transitorios como la percusión
  - Valores medios (150-300ms): Buen equilibrio para la mayoría de la música
  - Valores más grandes (300-500ms): Mejor para sonidos suaves y sostenidos
- **XFade Time** - Establece el tiempo de crossfade entre segmentos procesados en milisegundos (20 a 40ms)
  - Afecta la suavidad con la que se mezclan los segmentos con cambio de tono
  - Valores más bajos pueden sonar más inmediatos pero potencialmente menos suaves
  - Valores más altos crean transiciones más suaves entre segmentos, pero pueden aumentar la fluctuación del sonido y generar una sensación de superposición

## Pitch Shifter HQ

Un cambiador de tono de mayor calidad para una escucha atenta, pensado para cuando reducir el emborronamiento de fase importa más que una baja latencia o un menor uso de CPU. Cambia el tono sin alterar la velocidad de reproducción y mantiene los componentes espectrales mejor agrupados que el Pitch Shifter estándar. A cambio, usa más CPU y añade un retardo de procesamiento fijo de unos 106,7–116,1ms: unos 106,7ms a 48, 96 y 192kHz, y unos 116,1ms a 44,1, 88,2 y 176,4kHz. Requiere el motor DSP WASM de EffeTune; si ese motor no está disponible, el audio pasa sin procesarse.

Pitch Shifter HQ no conserva los formantes. Por tanto, los cambios grandes modifican tanto el carácter aparente de las voces y los instrumentos como su tono.

### Guía de experiencia auditiva

- Para un cambio sutil, empieza con **Pitch Shift** en -1 o +1 y deja **Fine Tune** en 0.
- Usa **Fine Tune** para ajustar música que esté ligeramente alta o baja sin desplazarla un semitono completo.
- Elige Pitch Shifter HQ en lugar del Pitch Shifter estándar cuando merezca la pena aceptar más uso de CPU y retardo a cambio de menos artefactos de fase. Usa la versión estándar si la latencia es importante o el dispositivo tiene menos potencia.
- Compara con cuidado los cambios grandes: el tono cambia de forma estable, pero la falta de conservación de formantes hace más evidente el cambio de timbre.

### Parámetros

- **Pitch Shift** - Cambia el tono general en semitonos (-6 a +6)
  - Los valores negativos bajan el tono y los positivos lo suben
  - Cero no cambia el tono
- **Fine Tune** - Ajusta el tono en cents (-50 a +50)
  - Permite un ajuste preciso entre semitonos
  - 100 cents equivalen a un semitono

## Rotary Speaker

Divide la señal entre una bocina de agudos y un tambor de graves mediante un crossover Linkwitz–Riley, y aplica a cada uno una velocidad de rotación, una modulación de volumen y un breve retardo Doppler diferentes. No reproduce mediciones de un recinto Leslie concreto. Debido al retardo variable, no se comunica como latencia algorítmica fija.

### Consejos de ajuste

- Slow produce un movimiento relajado y Fast una rotación más intensa. Una Acceleration más larga hace que los cambios de velocidad suenen más naturales.
- Ajuste el movimiento de tono con Doppler Depth y el movimiento de volumen con Amplitude Depth.
- Use Rotor Balance para equilibrar tambor y bocina, y Stereo Width para ajustar la amplitud.

### Parámetros

- **Style**: Ajuste de fábrica completo que define todos los parámetros. Las opciones son **Rotary Slow** (Slow), **Rotary Fast** (Fast), **Gentle Rotary** (Slow), **Leslie Slow** (Slow) y **Leslie Fast** (Fast). Al modificar un parámetro individual, cambia a **Custom**.
- **Speed State**: Stop, Slow o Fast. Al cambiar, acelera o desacelera de forma continua sin silenciarse.
- **Speed** (25–200%): Multiplicador de velocidad tanto de la bocina como del tambor.
- **Acceleration** (0,1–10 s): Determina la rapidez con la que los rotores se aproximan a una nueva velocidad.
- **Crossover** (200–2.000 Hz): Frecuencia que separa las bandas del tambor y la bocina.
- **Rotor Balance** (-100–100%): Los valores negativos realzan el tambor y los positivos la bocina.
- **Stereo Width** (0–100%): Amplitud de cada par estéreo.
- **Doppler Depth** (0–100%): Cantidad de variación de tono producida por el retardo variable.
- **Amplitude Depth** (0–100%): Cantidad de variación de volumen producida por la dirección del rotor virtual.
- **Mix** (0–100%): Proporción entre la señal original y la señal rotatoria. Al 0% solo se oye la señal original.

## Tremolo

Un efecto que añade variaciones rítmicas en el volumen a tu música, similar al sonido pulsante que se encuentra en amplificadores vintage y grabaciones clásicas. Esto crea una cualidad dinámica y expresiva que aporta movimiento e interés a tu experiencia auditiva.

### Guía de Experiencia Auditiva
- Experiencia de Amplificador Clásico:
  - Recrea el icónico sonido pulsante de los amplificadores de válvulas vintage
  - Añade movimiento rítmico a grabaciones estáticas
  - Crea una experiencia auditiva hipnótica y cautivadora
- Carácter de Grabación Vintage:
  - Simula los efectos de tremolo naturales usados en grabaciones clásicas
  - Aporta carácter vintage y calidez
  - Perfecto para escuchar jazz, blues y rock
- Ambiente Creativo:
  - Crea aumentos y disminuciones dramáticas
  - Añade intensidad emocional a la música
  - Perfecto para música ambiental y de atmósfera

### Parámetros
- **Rate** - La velocidad a la que cambia el volumen (0.1 a 50 Hz)
  - Más lento (0.1-2 Hz): Pulsación suave y sutil
  - Medio (2-6 Hz): Efecto de tremolo clásico
  - Más rápido (6-20 Hz): Efectos dramáticos y entrecortados
  - Muy rápido (20-50 Hz): modulación de volumen extremadamente rápida que puede añadir una textura áspera o zumbante; úsala con moderación para una escucha cómoda
- **Depth** - La magnitud del cambio de volumen (0 a 12 dB)
  - Sutil (0-3 dB): Variaciones suaves de volumen
  - Medio (3-6 dB): Efecto de pulsación notable
  - Fuerte (6-12 dB): Incrementos dramáticos de volumen
- **Ch Phase** - Diferencia de fase entre los canales estéreo (-180 a 180 grados)
  - 0°: Ambos canales pulsan juntos (tremolo mono)
  - 90° o -90°: Crea un efecto giratorio y remolinado
  - 180° o -180°: Los canales pulsan en direcciones opuestas (anchura estéreo máxima)
- **Randomness** - Qué tan irregulares se vuelven los cambios de volumen (0 a 96 dB)
  - Bajo: Pulsaciones más predecibles y regulares
  - Medio: Variación vintage natural
  - Alto: Sonido más inestable y orgánico
- **Randomness Cutoff** - Qué tan rápido ocurren los cambios aleatorios (1 a 1000 Hz)
  - Más bajo: Variaciones aleatorias más lentas y suaves
  - Más alto: Cambios más rápidos e impredecibles
- **Randomness Slope** - Controla la intensidad del filtrado de aleatoriedad (-12 a 0 dB)
  - -12 dB: Variaciones aleatorias más suaves y graduales (efecto más sutil)
  - -6 dB: Respuesta equilibrada
  - 0 dB: Variaciones aleatorias más pronunciadas y acentuadas (efecto más fuerte)
- **Ch Sync** - Qué tan sincronizada está la aleatoriedad entre canales (0 a 100%)
  - 0%: Cada canal tiene una aleatoriedad independiente
  - 50%: Sincronización parcial entre canales
  - 100%: Ambos canales comparten el mismo patrón de aleatoriedad

### Configuraciones Recomendadas para Diferentes Estilos

1. Tremolo clásico de amplificador de guitarra
   - Rate: 4-6 Hz (velocidad media)
   - Depth: 6-8 dB
   - Ch Phase: 0° (mono)
   - Randomness: 0-5 dB
   - Perfecto para: Blues, rock, surf

2. Efecto psicodélico estéreo
   - Rate: 2-4 Hz
   - Depth: 4-6 dB
   - Ch Phase: 180° (canales opuestos)
   - Randomness: 10-20 dB
   - Perfecto para: Rock psicodélico, electrónica, experimental

3. Mejora sutil
   - Rate: 1-2 Hz
   - Depth: 2-3 dB
   - Ch Phase: 0-45°
   - Randomness: 5-10 dB
   - Perfecto para: Cualquier música que necesite un movimiento sutil

4. Pulsación dramática
   - Rate: 8-12 Hz
   - Depth: 8-12 dB
   - Ch Phase: 90°
   - Randomness: 20-30 dB
   - Perfecto para: Electrónica, dance, ambient

### Guía Rápida de Inicio

1. Para un sonido clásico de Tremolo:
   - Comienza con un Rate medio (4-5 Hz)
   - Añade un Depth moderado (6 dB)
   - Configura Ch Phase en 0° para mono o 90° para movimiento estéreo
   - Mantén Randomness bajo (0-5 dB)
   - Ajusta según tu preferencia

2. Para mayor carácter:
   - Incrementa Randomness gradualmente
   - Experimenta con diferentes configuraciones de Ch Phase
   - Prueba distintas combinaciones de Rate y Depth
   - Confía en tu oído

## Wow Flutter

Un efecto que añade sutiles variaciones en el tono a tu música, similar al sonido de fluctuación natural que podrías recordar de los discos de vinilo o casetes. Esto crea una sensación cálida y nostálgica que muchas personas encuentran agradable y relajante.

### Guía de Experiencia Auditiva
- Experiencia de Disco de Vinilo:
  - Recrea la suave fluctuación de los tocadiscos
  - Añade un movimiento orgánico al sonido
  - Crea una atmósfera acogedora y nostálgica
- Recuerdo de Casete:
  - Simula el característico flutter de las grabadoras de casetes
  - Aporta el carácter de las grabadoras vintage
  - Perfecto para ambientes lo-fi y retro
- Ambiente Creativo:
  - Crea efectos oníricos, como si estuvieras bajo el agua
  - Añade movimiento y vitalidad a sonidos estáticos
  - Perfecto para escuchar ambient y experimental

### Parámetros
- **Rate** - La velocidad a la que fluctúa el sonido (0.1 a 20 Hz)
  - Más lento (0.1-2 Hz): Movimiento similar al de un disco de vinilo
  - Medio (2-6 Hz): Flutter similar al de un casete
  - Más rápido (6-20 Hz): Efectos creativos
- **Depth** - Qué tan fuerte se modula el tiempo de retardo, lo que hace oscilar el tono (0 a 40 ms)
  - Sutil (0-6 ms): Carácter vintage suave
  - Medio (6-15 ms): Sensación clásica de casete/vinilo
  - Fuerte (15-40 ms): Efectos dramáticos
- **Ch Phase** - Diferencia de fase entre canales estéreo (-180 a 180 grados)
  - 0°: Ambos canales fluctúan juntos
  - 90° o -90°: Crea un efecto giratorio y remolinado
  - 180° o -180°: Los canales fluctúan en direcciones opuestas
- **Randomness** - Qué tan irregular se vuelve la fluctuación (0 a 40 ms)
  - Bajo: Movimiento más predecible y regular
  - Medio: Variación vintage natural
  - Alto: Sonido más inestable, como de equipo desgastado
- **Randomness Cutoff** - La velocidad a la que ocurren los cambios aleatorios (0.1 a 20 Hz)
  - Más bajo: Cambios más lentos y suaves
  - Más alto: Cambios más rápidos y erráticos
- **Randomness Slope** - Controla la intensidad del filtrado de aleatoriedad (-12 a 0 dB)
  - -12 dB: Variaciones aleatorias más suaves y graduales (efecto más sutil)
  - -6 dB: Respuesta equilibrada
  - 0 dB: Variaciones aleatorias más pronunciadas y acentuadas (efecto más fuerte)
- **Ch Sync** - Qué tan sincronizada está la aleatoriedad entre canales (0 a 100%)
  - 0%: Cada canal tiene una aleatoriedad independiente
  - 50%: Sincronización parcial entre los canales
  - 100%: Ambos canales comparten el mismo patrón de aleatoriedad

### Configuraciones Recomendadas para Diferentes Estilos

1. Experiencia clásica de vinilo
   - Rate: 0.3-0.8 Hz (movimiento lento y suave)
   - Depth: 2-6 ms
   - Randomness: 1-4 ms
   - Randomness Cutoff: 0.5-3 Hz
   - Ch Phase: 0°
   - Ch Sync: 100%
   - Perfecto para: Jazz, clásica, rock vintage

2. Sensación de casete retro
   - Rate: 4-6 Hz (flutter más rápido)
   - Depth: 1-3 ms
   - Randomness: 1-5 ms
   - Randomness Cutoff: 3-8 Hz
   - Ch Phase: 0-30°
   - Ch Sync: 80-100%
   - Perfecto para: Lo-fi, pop, rock

3. Atmósfera de ensueño
   - Rate: 1-2 Hz
   - Depth: 25-30 ms
   - Randomness: 20-25 ms
   - Ch Phase: 90-180°
   - Ch Sync: 50-70%
   - Perfecto para: Ambient, electrónica, experimental

4. Mejora sutil
   - Rate: 1-2 Hz
   - Depth: 2-5 ms
   - Randomness: 1-3 ms
   - Ch Phase: 0°
   - Ch Sync: 100%
   - Perfecto para: Cualquier música que necesite un carácter vintage sutil

### Guía Rápida de Inicio

1. Para un sonido vintage natural:
   - Comienza con un Rate lento (0.5-1 Hz)
   - Añade un Depth ligero (2-6 ms)
   - Incluye un poco de Randomness (1-4 ms)
   - Ajusta Randomness Cutoff alrededor de 0.5-3 Hz
   - Mantén Ch Phase en 0° y Ch Sync en 100%
   - Ajusta a tu gusto

2. Para mayor carácter:
   - Incrementa Depth gradualmente
   - Añade más Randomness
   - Experimenta con diferentes configuraciones de Ch Phase
   - Reduce Ch Sync para obtener más variación estéreo
   - Confía en tus oídos

Recuerda: El objetivo es añadir un agradable carácter vintage a tu música. Comienza de manera sutil y ajusta hasta encontrar el punto óptimo que realce tu experiencia auditiva!
