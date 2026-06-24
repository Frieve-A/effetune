---
title: "Plugins de modulación - EffeTune"
description: "Plugins de modulación como Tremolo, Wow Flutter, Pitch Shifter y Doppler Distortion."
lang: es
---

# Plugins de modulación

Una colección de plugins que añaden movimiento y variación a tu música mediante efectos de modulación. Estos efectos pueden hacer que tu música digital se sienta más orgánica y dinámica, mejorando tu experiencia auditiva con variaciones sutiles o dramáticas en el sonido.

## Lista de Plugins

- [Doppler Distortion](#doppler-distortion) - Simula los cambios naturales y dinámicos en el sonido producidos por el sutil movimiento del cono del altavoz.
- [Pitch Shifter](#pitch-shifter) - Cambia el tono de tu música sin afectar la velocidad de reproducción
- [Tremolo](#tremolo) - Crea variaciones rítmicas de volumen para un sonido pulsante y dinámico
- [Wow Flutter](#wow-flutter) - Recrea las suaves variaciones de tono de los discos de vinilo y los reproductores de cinta

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
