---
title: "Plugins de dinámica - EffeTune"
description: "Plugins de procesamiento dinámico, incluidos Compressor, Limiter, Gate, Multiband Compressor y Transient Shaper."
lang: es
---

# Plugins de Dinámica

Una colección de plugins que ayudan a equilibrar las partes fuertes y suaves de tu música, haciendo tu experiencia de escucha más agradable y cómoda.

## Lista de Plugins

- [Auto Leveler](#auto-leveler) - Ajuste automático de volumen para una experiencia de escucha consistente
- [Brickwall Limiter](#brickwall-limiter) - Control transparente de picos para una escucha segura y cómoda
- [Compressor](#compressor) - Equilibra automáticamente los niveles de volumen para una escucha más cómoda (incluye expansión hacia arriba)
- [Expander](#expander) - Expansión de rango dinámico por debajo del umbral con control de ratio y knee (incluye compresión hacia arriba)
- [Gate](#gate) - Reduce sonidos de bajo nivel en silencios o pausas por debajo de un umbral
- [Multiband Compressor](#multiband-compressor) - Balance de volumen de 5 bandas para un sonido estable tipo radio
- [Multiband Expander](#multiband-expander) - Control de contraste dinámico de 5 bandas para grabaciones que se sienten demasiado planas
- [Multiband Transient](#multiband-transient) - Ajusta golpe y sustain por separado en graves, medios y agudos
- [Power Amp Sag](#power-amp-sag) - Añade compresión tipo amplificador que suaviza ligeramente los pasajes fuertes
- [Transient Shaper](#transient-shaper) - Controla las partes de ataque y sostenimiento de la señal

## Auto Leveler

Un control de volumen inteligente que ajusta automáticamente tu música para mantener un nivel de escucha constante. Usa una estimación de nivel de estilo LUFS para acercar la reproducción a tu objetivo elegido, tanto si escuchas piezas clásicas tranquilas como canciones pop dinámicas.

### Guía de Mejora de Escucha
- **Música Clásica:**
  - Disfruta de pasajes tranquilos y crescendos intensos sin necesidad de ajustar el volumen
  - Percibe todos los detalles sutiles en las piezas de piano
  - Ideal para álbumes con niveles de grabación variables
- **Música Pop/Rock:**
  - Mantén un volumen constante entre diferentes canciones
  - Sin sorpresas por pistas excesivamente fuertes o suaves
  - Escucha cómoda durante sesiones prolongadas
- **Música de Fondo:**
  - Conserva un volumen estable mientras trabajas o estudias
  - Nunca resulta demasiado alto ni demasiado bajo
  - Perfecto para listas de reproducción con contenido variado

### Parámetros

- **Target** (-36.0dB a 0.0dB LUFS)
  - Establece el nivel de escucha deseado
  - El valor predeterminado de -18.0dB LUFS es cómodo para la mayoría de la música
  - Valores más bajos para una escucha de fondo más discreta
  - Valores más altos para un sonido más impactante

- **Time Window** (1000ms a 10000ms)
  - Define la rapidez con la que se mide el nivel
  - Tiempos más cortos: Responde más rápidamente a los cambios
  - Tiempos más largos: Ofrece un sonido más estable y natural
  - El valor predeterminado de 3000ms funciona bien para la mayoría de la música

- **Max Gain** (0.0dB a 12.0dB)
  - Limita el aumento de los sonidos silenciosos
  - Valores más altos: Volumen más consistente
  - Valores más bajos: Dinámica más natural
  - Comienza con 6.0dB para un control suave

- **Min Gain** (-36.0dB a 0.0dB)
  - Limita la reducción de los sonidos fuertes
  - Valores más altos: Sonido más natural
  - Valores más bajos: Volumen más consistente
  - Prueba con -12.0dB como punto de partida

- **Attack Time** (1ms a 1000ms)
  - Define la rapidez con la que se reduce el volumen
  - Tiempos más rápidos: Mejor control de sonidos fuertes repentinos
  - Tiempos más lentos: Transiciones más naturales
  - El valor predeterminado de 50ms equilibra el control y la naturalidad

- **Release Time** (10ms a 10000ms)
  - Define la rapidez con la que el volumen vuelve a la normalidad
  - Tiempos más rápidos: Mayor capacidad de respuesta
  - Tiempos más lentos: Transiciones más suaves
  - El valor predeterminado de 5000ms ofrece cambios de nivel suaves y naturales

- **Noise Gate** (-96dB a -24dB)
  - Evita que pasajes muy silenciosos o ruido de fondo se amplifiquen
  - Valores más altos: Menos realce del ruido de fondo silencioso
  - Valores más bajos: Permite que el nivelador reaccione a pasajes más suaves
  - Empieza en -60dB y ajusta si es necesario

### Visualización
- Visualización en tiempo real del nivel LUFS
- Nivel de entrada (línea verde)
- Nivel de salida (línea blanca)
- Retroalimentación visual clara de los ajustes de volumen
- Gráfico temporal de fácil lectura

### Ajustes Recomendados

#### Escucha General
- Target: -18.0dB LUFS
- Time Window: 3000ms
- Max Gain: 6.0dB
- Min Gain: -12.0dB
- Attack Time: 50ms
- Release Time: 1000ms
- Noise Gate: -60dB

#### Música de Fondo
- Target: -23.0dB LUFS
- Time Window: 5000ms
- Max Gain: 9.0dB
- Min Gain: -18.0dB
- Attack Time: 100ms
- Release Time: 2000ms
- Noise Gate: -54dB

#### Música Dinámica
- Target: -16.0dB LUFS
- Time Window: 2000ms
- Max Gain: 3.0dB
- Min Gain: -6.0dB
- Attack Time: 30ms
- Release Time: 500ms
- Noise Gate: -72dB

## Brickwall Limiter

Un limitador de picos de alta calidad que asegura que tu música nunca exceda un nivel específico, previniendo la saturación digital mientras mantiene la calidad natural del sonido. Perfecto para proteger tu sistema de audio y asegurar niveles de escucha cómodos sin comprometer la dinámica de la música.

### Guía de Mejora de Escucha
- Música Clásica:
  - Disfruta de forma segura los crescendos orquestales completos
  - Mantiene la dinámica natural de las piezas de piano
  - Protege contra picos inesperados en grabaciones en vivo
- Música Pop/Rock:
  - Mantiene un volumen consistente durante pasajes intensos
  - Disfruta de música dinámica a cualquier nivel de escucha
  - Previene la distorsión en secciones con mucho bajo
- Música Electrónica:
  - Controla los picos de sintetizador de forma transparente
  - Mantiene el impacto mientras previene la sobrecarga
  - Mantiene los drops de bajo potentes pero controlados

### Parámetros
- **Input Gain** (-18dB a +18dB)
  - Ajusta el nivel que entra al limitador
  - Aumenta para impulsar más el limitador
  - Disminuye si escuchas demasiada limitación
  - Valor predeterminado 0dB

- **Threshold** (-24dB a 0dB)
  - Establece el nivel de pico donde empieza la limitación antes de aplicar Margin
  - El techo efectivo es Threshold + Margin
  - Valores más bajos proporcionan más margen de seguridad
  - Valores más altos preservan más dinámica
  - Comienza en -3dB para protección suave

- **Release Time** (10ms a 500ms)
  - Qué tan rápido se libera la limitación
  - Tiempos más rápidos mantienen más dinámica
  - Tiempos más lentos para sonido más suave
  - Prueba con 100ms como punto de partida

- **Lookahead** (0ms a 10ms)
  - Permite al limitador anticipar los picos
  - Valores más altos para limitación más transparente
  - Valores más bajos para menos latencia
  - 3ms es un buen equilibrio

- **Margin** (-1.000dB a 0.000dB)
  - Añade un desplazamiento fino de seguridad al Threshold
  - El techo real es Threshold + Margin
  - Por ejemplo, Threshold -3dB con Margin -1.000dB limita alrededor de -4dB
  - Valor predeterminado -1.000dB funciona bien para la mayoría del material
  - Ajusta para control preciso de picos

- **Oversampling** (1x, 2x, 4x, 8x)
  - Valores más altos para limitación más limpia
  - Valores más bajos para menos uso de CPU
  - 4x es un buen equilibrio entre calidad y rendimiento

### Controles y Medición
- Controles directos para Input Gain, Threshold, Margin, Release, Lookahead y Oversampling
- La información de reducción de ganancia del limitador se informa internamente para medición del host o estado
- El panel del plugin no muestra una gráfica separada de nivel de pico

### Ajustes Recomendados

#### Protección Transparente
- Input Gain: 0dB
- Threshold: -3dB
- Release: 100ms
- Lookahead: 3ms
- Margin: -1.000dB
- Oversampling: 4x
- Techo efectivo: alrededor de -4dB

#### Máxima Seguridad
- Input Gain: -6dB
- Threshold: -6dB
- Release: 50ms
- Lookahead: 5ms
- Margin: -1.000dB
- Oversampling: 8x
- Techo efectivo: alrededor de -7dB

#### Dinámica Natural
- Input Gain: 0dB
- Threshold: -1.5dB
- Release: 200ms
- Lookahead: 2ms
- Margin: -0.500dB
- Oversampling: 4x
- Techo efectivo: alrededor de -2dB

## Compressor

Un efecto que suaviza las diferencias de volumen reduciendo con suavidad los picos fuertes. Úsalo cuando los pasajes que suben de golpe resultan molestos, o cuando quieres un nivel de escucha más parejo y cómodo. Después de la compresión, sube Gain si quieres que el sonido general, incluidos los detalles más silenciosos, se sienta más fuerte.

### Guía de Mejora de Escucha
- Música Clásica:
  - Hace que los crescendos orquestales dramáticos sean más cómodos de escuchar
  - Equilibra la diferencia entre pasajes suaves y fuertes del piano
  - Ayuda a escuchar detalles silenciosos incluso en secciones potentes
- Música Pop/Rock:
  - Crea una experiencia de escucha más cómoda durante secciones intensas
  - Hace que las voces sean más claras y fáciles de entender
  - Reduce la fatiga auditiva durante sesiones largas
- Música Jazz:
  - Equilibra el volumen entre diferentes instrumentos
  - Hace que las secciones de solo se mezclen más naturalmente con el conjunto
  - Mantiene la claridad durante pasajes tanto suaves como fuertes

### Parámetros

- **Threshold** - Establece el nivel de volumen donde el efecto comienza a trabajar (-60dB a 0dB)
  - Ajustes más altos: Solo afecta las partes más fuertes de la música
  - Ajustes más bajos: Crea más balance general
  - Comienza en -24dB para un balance suave
- **Ratio** - Controla qué tan fuertemente el efecto equilibra el volumen (1:0.5 a 1:20)
  - 1:0.5: Expansión hacia arriba (potencia sonidos fuertes)
  - 1:1: Sin efecto (sonido original)
  - 1:2: Compresión suave
  - 1:4: Compresión moderada
  - 1:8+: Control de volumen fuerte
- **Attack Time** - Qué tan rápido responde el efecto a los sonidos fuertes (0.1ms a 100ms)
  - Tiempos más rápidos: Control de volumen más inmediato
  - Tiempos más lentos: Sonido más natural
  - Prueba 20ms como punto de partida
- **Release Time** - Qué tan rápido el volumen vuelve a la normalidad (10ms a 1000ms)
  - Tiempos más rápidos: Sonido más dinámico
  - Tiempos más lentos: Transiciones más suaves y naturales
  - Comienza con 200ms para escucha general
- **Knee** - Qué tan suavemente transiciona el efecto (0dB a 12dB)
  - Valores más bajos: Control más preciso
  - Valores más altos: Sonido más suave y natural
  - 6dB es un buen punto de partida
- **Gain** - Ajusta el volumen general después del procesamiento (-12dB a +12dB)
  - Usa esto para igualar el volumen con el sonido original
  - Aumenta si la música se siente muy silenciosa
  - Disminuye si está muy fuerte

### Visualización

- Gráfico interactivo que muestra cómo está funcionando el efecto
- Indicadores de nivel de volumen fáciles de leer
- Retroalimentación visual para todos los ajustes de parámetros
- Líneas de referencia para ayudar a guiar tus ajustes

### Ajustes Recomendados para Diferentes Escenarios de Escucha
- Escucha Casual de Fondo:
  - Threshold: -24dB
  - Ratio: 1:2
  - Attack: 20ms
  - Release: 200ms
  - Knee: 6dB
  - Gain: +2dB
- Sesiones de Escucha Crítica:
  - Threshold: -18dB
  - Ratio: 1:1.5
  - Attack: 30ms
  - Release: 300ms
  - Knee: 3dB
  - Gain: +1dB
- Escucha Nocturna:
  - Threshold: -30dB
  - Ratio: 1:4
  - Attack: 10ms
  - Release: 150ms
  - Knee: 9dB
  - Gain: +3dB
- Mejora de Sonidos Fuertes:
  - Threshold: -12dB
  - Ratio: 1:0.5
  - Attack: 50ms
  - Release: 400ms
  - Knee: 6dB
  - Gain: 0dB

## Expander

Un procesador de rango dinámico que expande el rango dinámico de señales por debajo de un umbral, haciendo que los sonidos suaves sean aún más suaves mientras deja los sonidos fuertes sin cambios. Esto crea dinámicas más dramáticas y puede ayudar a restaurar dinámicas naturales a material sobre-comprimido.

### Guía de Mejora de Escucha
- Música Clásica:
  - Restaura dinámicas naturales a grabaciones sobre-comprimidas
  - Mejora el contraste entre pasajes suaves y crescendos fuertes
  - Devuelve el flujo natural de las interpretaciones orquestales
- Música Pop/Rock:
  - Añade más punch e impacto a secciones dinámicas
  - Crea contraste más dramático entre versos y coros
  - Restaura dinámicas naturales a pistas fuertemente comprimidas
- Música Jazz:
  - Mejora las dinámicas naturales entre instrumentos
  - Hace que los solos suaves sean más íntimos y las secciones fuertes más poderosas
  - Restaura la respiración natural de las interpretaciones de jazz

### Parámetros

- **Threshold** - Establece el nivel de volumen donde comienza la expansión (-60dB a 0dB)
  - Ajustes más altos: Solo afecta las partes más suaves de la música
  - Ajustes más bajos: Crea más expansión dinámica general
  - Comienza en -24dB para expansión suave
- **Ratio** - Controla qué tan fuertemente el efecto expande el rango dinámico (1:0.05 a 1:20)
  - 1:0.5: Compresión hacia arriba (potencia sonidos suaves)
  - 1:1: Sin efecto (sonido original)
  - 1:2: Expansión suave
  - 1:4: Expansión moderada
  - 1:8+: Expansión dinámica fuerte
- **Attack Time** - Qué tan rápido responde el efecto a los sonidos suaves (0.1ms a 100ms)
  - Tiempos más rápidos: Control dinámico más inmediato
  - Tiempos más lentos: Sonido más natural
  - Prueba 10ms como punto de partida
- **Release Time** - Qué tan rápido las dinámicas vuelven a la normalidad (10ms a 1000ms)
  - Tiempos más rápidos: Sonido más dinámico
  - Tiempos más lentos: Transiciones más suaves y naturales
  - Comienza con 100ms para escucha general
- **Knee** - Qué tan suavemente hace la transición el efecto (0dB a 12dB)
  - Valores más bajos: Control más preciso
  - Valores más altos: Sonido más suave y natural
  - 3dB es un buen punto de partida
- **Gain** - Ajusta el volumen general después del procesamiento (-12dB a +12dB)
  - Úsalo para igualar el volumen con el sonido original
  - Aumenta si la música se siente muy suave
  - Disminuye si está muy fuerte

### Visualización

- Gráfico interactivo mostrando cómo funciona la expansión
- Indicadores de nivel de volumen fáciles de leer
- Retroalimentación visual para todos los ajustes de parámetros
- Líneas de referencia para ayudar a guiar tus ajustes

### Ajustes Recomendados para Diferentes Escenarios de Escucha
- Restauración de Dinámicas Naturales:
  - Threshold: -18dB
  - Ratio: 1:2
  - Attack: 10ms
  - Release: 100ms
  - Knee: 3dB
- Mejora Dinámica Dramática:
  - Threshold: -12dB
  - Ratio: 1:4
  - Attack: 5ms
  - Release: 50ms
  - Knee: 1dB
- Mejora de Sonidos Suaves:
  - Threshold: -30dB
  - Ratio: 1:0.5
  - Attack: 20ms
  - Release: 200ms
  - Knee: 6dB
- Mejora Dinámica Sutil:
  - Threshold: -24dB
  - Ratio: 1:1.5
  - Attack: 15ms
  - Release: 150ms
  - Knee: 6dB

## Gate

Una puerta de ruido de banda completa que baja toda la señal cuando el nivel cae por debajo de un umbral específico. Sirve para reducir ruido de bajo nivel durante huecos, fades o entre frases habladas. No separa ni elimina ruido de ventilador, zumbidos o ruido de sala mientras la música o la voz suenan por encima.

### Características Principales
- Control preciso del umbral para detección exacta de ruido
- Ratio ajustable para reducción de ruido natural o agresiva
- Tiempos de ataque y liberación variables para control óptimo de tiempo
- Opción de knee suave para transiciones suaves
- Medición de reducción de ganancia en tiempo real
- Visualización interactiva de función de transferencia

### Parámetros

- **Threshold** (-96dB a 0dB)
  - Establece el nivel donde comienza la reducción de ruido
  - Las señales por debajo de este nivel serán atenuadas
  - Valores más altos: Reducción de ruido más agresiva
  - Valores más bajos: Efecto más sutil
  - Comienza en -40dB y ajusta según tu piso de ruido

- **Ratio** (1:1 a 100:1)
  - Controla qué tan fuertemente se atenúan las señales por debajo del umbral
  - 1:1: Sin efecto
  - 10:1: Reducción de ruido fuerte
  - 100:1: Silencio casi completo por debajo del umbral
  - Comienza en 10:1 para reducción de ruido típica

- **Attack Time** (0.01ms a 50ms)
  - Qué tan rápido responde la puerta cuando la señal sube por encima del umbral
  - Tiempos más rápidos: Más preciso pero puede sonar abrupto
  - Tiempos más lentos: Transiciones más naturales
  - Prueba 1ms como punto de partida

- **Release Time** (10ms a 2000ms)
  - Qué tan rápido se cierra la puerta cuando la señal cae por debajo del umbral
  - Tiempos más rápidos: Control de ruido más ajustado
  - Tiempos más lentos: Decaimiento más natural
  - Comienza con 200ms para un sonido natural

- **Knee** (0dB a 6dB)
  - Controla qué tan gradualmente transiciona la puerta alrededor del umbral
  - 0dB: Knee duro para puerta precisa
  - 6dB: Knee suave para transiciones más suaves
  - Usa 1dB para reducción de ruido de propósito general

- **Gain** (-12dB a +12dB)
  - Ajusta el nivel de salida después del gating
  - Usa para compensar cualquier pérdida de volumen percibida
  - Típicamente se deja en 0dB a menos que sea necesario

### Retroalimentación Visual
- Gráfico de función de transferencia interactivo mostrando:
  - Relación entrada/salida
  - Punto de umbral
  - Curva de knee
  - Pendiente de ratio
- Medidor de reducción de ganancia en tiempo real mostrando:
  - Cantidad actual de reducción de ruido
  - Retroalimentación visual de actividad de la puerta

### Ajustes Recomendados

#### Reducción de Ruido Ligera
- Threshold: -50dB
- Ratio: 2:1
- Attack: 5ms
- Release: 300ms
- Knee: 3dB
- Gain: 0dB

#### Ruido de Fondo Moderado
- Threshold: -40dB
- Ratio: 10:1
- Attack: 1ms
- Release: 200ms
- Knee: 1dB
- Gain: 0dB

#### Puerta Muy Agresiva
- Úsalo solo cuando quieras casi silencio en los huecos, como en grabaciones habladas o pausas muy ruidosas
- Threshold: -30dB
- Ratio: 50:1
- Attack: 0.1ms
- Release: 100ms
- Knee: 0dB
- Gain: 0dB

### Consejos de Aplicación
- Establece el threshold justo por encima del piso de ruido para resultados óptimos
- Usa tiempos de release más largos para un sonido más natural
- Agrega algo de knee cuando proceses material complejo
- Monitorea el medidor de reducción de ganancia para asegurar un gating apropiado
- En música, evita umbrales o ratios muy altos salvo que quieras cortar intencionalmente colas silenciosas
- Combina con otros procesadores de dinámica para control integral


## Multiband Compressor

Un procesador de escucha de cinco bandas que equilibra la sonoridad por separado en distintos rangos de frecuencia. Úsalo cuando los graves sobresalen demasiado, las voces quedan muy al frente o los agudos se vuelven punzantes. Los ajustes predeterminados crean un sonido estable tipo radio para escucha casual.

### Características Principales
- Procesamiento de 5 bandas con frecuencias de cruce ajustables
- Controles de compresión independientes para cada banda
- Ajustes predeterminados optimizados para sonido estilo radio FM
- Visualización en tiempo real de reducción de ganancia por banda
- Filtros de cruce Linkwitz-Riley de alta calidad

### Bandas de Frecuencia Predeterminadas
Las frecuencias de cruce son ajustables; estos son los rangos predeterminados.

- Banda 1 (Graves): Por debajo de 100 Hz
  - Controla los graves profundos y subfrecuencias
  - Ratio más alto y release más largo para graves controlados y ajustados
- Banda 2 (Medios-Graves): 100-500 Hz
  - Maneja los graves superiores y medios inferiores
  - Compresión moderada para mantener la calidez
- Banda 3 (Medios): 500-2000 Hz
  - Rango crítico de presencia vocal e instrumental
  - Compresión suave para preservar la naturalidad
- Banda 4 (Medios-Agudos): 2000-8000 Hz
  - Controla presencia y aire
  - Compresión ligera con respuesta más rápida
- Banda 5 (Agudos): Por encima de 8000 Hz
  - Gestiona brillo y chispa
  - Tiempos de respuesta rápidos con ratio más alto

### Parámetros

#### Frecuencias de Cruce
- **Freq 1** (20Hz a 500Hz, predeterminado 100Hz)
  - Define el punto de cruce Low/Low-Mid
- **Freq 2** (100Hz a 2000Hz, predeterminado 500Hz)
  - Define el punto de cruce Low-Mid/Mid
- **Freq 3** (500Hz a 8000Hz, predeterminado 2000Hz)
  - Define el punto de cruce Mid/High-Mid
- **Freq 4** (1000Hz a 20000Hz, predeterminado 8000Hz)
  - Define el punto de cruce High-Mid/High
- Las frecuencias se mantienen automáticamente en orden ascendente, así que mover un control puede elevar el siguiente cruce si hace falta

#### Controles por Banda
- **Threshold** (-60dB a 0dB)
  - Establece el nivel donde comienza la compresión
  - Ajustes más bajos crean niveles más consistentes
- **Ratio** (0.5:1 a 20:1)
  - 1:1: Sin cambio
  - Por encima de 1:1: Comprime las partes fuertes de esa banda
  - Por debajo de 1:1: Realza los sonidos por encima del umbral para un carácter de banda más marcado
  - Para control normal de escucha, empieza alrededor de 2:1 a 5:1
- **Attack** (0.1ms a 100ms)
  - Qué tan rápido responde la compresión
  - Tiempos más rápidos para control de transientes
- **Release** (10ms a 1000ms)
  - Qué tan rápido la ganancia vuelve a la normalidad
  - Tiempos más largos para sonido más suave
- **Knee** (0dB a 12dB)
  - Suavidad del inicio de la compresión
  - Valores más altos para transición más natural
- **Gain** (-12dB a +12dB)
  - Ajuste de nivel de salida por banda
  - Ajuste fino del balance de frecuencias

### Procesamiento Estilo Radio FM
El Multiband Compressor viene con ajustes predeterminados optimizados para un sonido de escucha estable al estilo radio FM:

- Banda Grave (< 100 Hz)
  - Ratio más alto (4:1) para control de graves ajustado
  - Attack/release más lentos para mantener el punch
  - Ligera reducción para prevenir empastamiento

- Banda Media-Grave (100-500 Hz)
  - Compresión moderada (3:1)
  - Tiempos equilibrados para respuesta natural
  - Ganancia neutral para mantener calidez

- Banda Media (500-2000 Hz)
  - Compresión suave (2.5:1)
  - Tiempos de respuesta rápidos
  - Ligero realce para presencia vocal

- Banda Media-Aguda (2000-8000 Hz)
  - Compresión ligera (2:1)
  - Attack/release rápidos
  - Realce de presencia mejorado

- Banda Aguda (> 8000 Hz)
  - Ratio más alto (5:1) para brillo consistente
  - Tiempos de respuesta muy rápidos
  - Reducción controlada para pulido

Esta configuración crea el característico sonido "listo para radio":
- Graves consistentes e impactantes
- Voces claras y frontales
- Dinámica controlada en todas las frecuencias
- Presentación general más suave y pulida
- Presencia y claridad mejoradas
- Fatiga auditiva reducida

### Retroalimentación Visual
- Gráficos de función de transferencia interactivos para cada banda
- Medidores de reducción de ganancia en tiempo real
- Visualización de actividad de banda de frecuencia
- Indicadores claros de puntos de cruce

### Consejos de Uso
- Comienza con el preset predeterminado de radio FM
- Ajusta las frecuencias de cruce para que coincidan con tu material
- Ajusta el threshold de cada banda para la cantidad deseada de control
- Usa los controles de ganancia para moldear el balance de frecuencia final
- Monitorea los medidores de reducción de ganancia para asegurar un procesamiento apropiado

## Multiband Expander

Un procesador de escucha de cinco bandas que puede devolver algo de contraste natural a grabaciones demasiado planas o muy comprimidas. Trabaja por separado en cada rango de frecuencia: normalmente hace más silenciosos los sonidos por debajo del umbral, mientras que los ratios por debajo de 1:1 pueden levantar sonidos más suaves.

### Características Principales
- Procesamiento de 5 bandas con frecuencias de cruce ajustables
- Controles de expansión independientes para cada banda
- Ajustes predeterminados optimizados para recuperar contraste dinámico con suavidad
- Visualización en tiempo real de la actividad de expansión por banda
- Filtros de cruce Linkwitz-Riley de alta calidad

### Guía de Mejora de Escucha
- **Música Pop/Rock:**
  - Reduce el efecto de "muro de sonido" de grabaciones sobrecomprimidas
  - Restaura el contraste dinámico entre versos y coros
  - Mejora la impresión plana de las fuentes de audio en streaming
- **Música Clásica:**
  - Restaura el flujo y reflujo dinámico natural de las grabaciones
  - Mejora el contraste entre pasajes suaves y crescendos fuertes
  - Recupera la expresión vívida de las interpretaciones orquestales
- **Música Jazz:**
  - Mejora la dinámica natural entre instrumentos
  - Hace los solos suaves más íntimos y las secciones fuertes más poderosas
  - Restaura la respiración natural de las interpretaciones de jazz

### Bandas de Frecuencia Predeterminadas
Las frecuencias de cruce son ajustables; estos son los rangos predeterminados.

- Banda 1 (Grave): Por debajo de 100 Hz
  - Controla los graves profundos y las sub frecuencias
  - Expansión suave con attack/release más largo para dinámica de graves natural
- Banda 2 (Grave-Medio): 100-500 Hz
  - Maneja los graves superiores y los medios bajos
  - Expansión moderada para restaurar calidez y cuerpo
- Banda 3 (Medio): 500-2000 Hz
  - Rango crítico de presencia vocal e instrumental
  - Expansión equilibrada para preservar la naturalidad
- Banda 4 (Medio-Agudo): 2000-8000 Hz
  - Controla la presencia y el aire
  - Expansión ligera con respuesta más rápida
- Banda 5 (Agudo): Por encima de 8000 Hz
  - Gestiona el brillo y el destello
  - Tiempos de respuesta rápidos con expansión más suave

### Parámetros

#### Frecuencias de Cruce
- **Freq 1** (20Hz a 500Hz, predeterminado 100Hz)
  - Define el punto de cruce Low/Low-Mid
- **Freq 2** (100Hz a 2000Hz, predeterminado 500Hz)
  - Define el punto de cruce Low-Mid/Mid
- **Freq 3** (500Hz a 8000Hz, predeterminado 2000Hz)
  - Define el punto de cruce Mid/High-Mid
- **Freq 4** (1000Hz a 20000Hz, predeterminado 8000Hz)
  - Define el punto de cruce High-Mid/High
- Las frecuencias se mantienen automáticamente en orden ascendente, así que mover un control puede elevar el siguiente cruce si hace falta

#### Controles por Banda
- **Threshold** (-60dB a 0dB)
  - Establece el nivel donde comienza la expansión
  - Las señales por debajo de este nivel son procesadas por el ajuste Ratio
- **Ratio** (1:0.05 a 1:20)
  - 1:1: Sin cambio
  - Por encima de 1:1: Hace más silenciosos los sonidos por debajo del umbral
  - Por debajo de 1:1: Eleva los sonidos más suaves en vez de reducirlos
  - Para recuperar dinámica de forma natural, empieza alrededor de 1.1:1 a 1.2:1
- **Attack** (0.1ms a 100ms)
  - Qué tan rápido responde la expansión
  - Tiempos más rápidos para control preciso de transientes
- **Release** (10ms a 1000ms)
  - Qué tan rápido la ganancia vuelve a la normalidad
  - Tiempos más largos para sonido más suave y natural
- **Knee** (0dB a 12dB)
  - Suavidad del inicio de la expansión
  - Valores más altos para transición más natural
- **Gain** (-12dB a +12dB)
  - Ajuste de nivel de salida por banda
  - Ajuste fino del balance de frecuencia

### Restauración de Rango Dinámico
Multiband Expander viene con ajustes predeterminados optimizados para restaurar contraste con suavidad en material sobrecomprimido:

- Banda Grave (< 100 Hz)
  - Expansión suave (1.2:1) para dinámica de graves controlada
  - Attack/release más largo para mantener el punch
  - Threshold establecido para acomodar la energía típica de graves

- Banda Grave-Medio (100-500 Hz)
  - Expansión moderada (1.2:1)
  - Temporización equilibrada para respuesta natural
  - Threshold ajustado para energía típica de graves-medios

- Banda Medio (500-2000 Hz)
  - Expansión equilibrada (1.2:1)
  - Tiempos de respuesta medios
  - Optimizada para dinámica vocal e instrumental

- Banda Medio-Agudo (2000-8000 Hz)
  - Expansión ligera (1.1:1)
  - Attack/release más rápido
  - Restauración natural de presencia

- Banda Agudo (> 8000 Hz)
  - Expansión más suave (1.1:1)
  - Tiempos de respuesta muy rápidos
  - Mejora sutil de aire y brillo

Esta configuración crea restauración dinámica de sonido natural:
- Dinámica natural restaurada en todas las frecuencias
- Contraste mejorado entre pasajes suaves y fuertes
- Control específico por frecuencia para resultados óptimos
- Expansión natural y musical sin artefactos
- Claridad y separación mejoradas
- Planitud reducida en grabaciones sobre-comprimidas

### Retroalimentación Visual
- Gráficos de función de transferencia interactivos para cada banda
- Medidores de actividad de expansión en tiempo real que muestran cuánto se reduce o se eleva cada banda
- Visualización de actividad de banda de frecuencia
- Indicadores claros de puntos de cruce

### Consejos de Uso
- Comienza con la configuración predeterminada para restauración dinámica general
- Ajusta las frecuencias de cruce para que coincidan con tu material
- Ajusta el threshold de cada banda según el contenido de frecuencia
- Usa los controles de ganancia para compensar cambios de volumen percibidos
- Monitorea los medidores de actividad de expansión para asegurar un procesamiento apropiado

## Multiband Transient

Un transient shaper de tres bandas para música ya terminada. Divide el sonido en rangos Low, Mid y High, y permite ajustar ataque y sustain en cada rango para que la música se sienta con más pegada, más firme, más suave o más relajada sin cambiar todas las frecuencias de la misma manera.

### Guía de Mejora de Escucha
- **Música Clásica:**
  - Haz que los ataques de cuerda sean un poco más claros mientras controlas la resonancia grave de la sala
  - Moldea los transientes del piano de forma distinta según la frecuencia para un sonido más equilibrado
  - Suaviza ataques agudos intensos manteniendo el peso orquestal

- **Música Rock/Pop:**
  - Haz que los golpes de batería en pistas terminadas se sientan más inmediatos sin subir toda la canción
  - Ajusta el sustain grave cuando se vuelve retumbante manteniendo clara la presencia de medios
  - Suaviza ataques agudos cuando una grabación suena áspera

- **Música Electrónica:**
  - Haz que los golpes de bajo se sientan más firmes mientras el resto de la pista se mantiene controlado
  - Reduce sustain grave largo cuando el bajo se siente borroso
  - Añade o reduce mordida en rangos brillantes de sintetizadores y percusión

### Bandas de Frecuencia

El procesador Multiband Transient divide tu audio en tres bandas de frecuencia cuidadosamente diseñadas. Como trabaja por banda de frecuencia y no por separación de fuentes, cada ajuste afecta a todos los sonidos de esa banda.

- **Low Band** (Por debajo de Freq 1)
  - Controla las frecuencias graves y sub-graves
  - Útil para moldear impacto de graves, golpes de baja frecuencia y resonancia
  - Frecuencia de cruce por defecto: 200 Hz

- **Mid Band** (Entre Freq 1 y Freq 2)
  - Maneja las frecuencias medias críticas
  - Contiene la mayor parte de la presencia vocal e instrumental
  - Frecuencia de cruce por defecto: 200 Hz a 4000 Hz

- **High Band** (Por encima de Freq 2)
  - Gestiona las frecuencias agudas y de aire
  - Controla platillos, ataques de guitarra y brillo
  - Frecuencia de cruce por defecto: Por encima de 4000 Hz

### Parámetros

#### Frecuencias de Cruce
- **Freq 1** (20Hz a 2000Hz)
  - Establece el punto de cruce Grave/Medio
  - Valores más bajos: Más contenido en bandas media y aguda
  - Valores más altos: Más contenido en banda grave
  - Por defecto: 200Hz

- **Freq 2** (max(Freq 1, 200Hz) a 20000Hz)
  - Establece el punto de cruce Medio/Agudo
  - Valores más bajos: Más contenido en banda aguda
  - Valores más altos: Más contenido en banda media
  - Si se ajusta por debajo de Freq 1, se eleva automáticamente hasta Freq 1
  - Por defecto: 4000Hz

#### Controles por Banda (Low, Mid, High)
Cada banda de frecuencia tiene controles independientes de modelado de transientes:

- **Fast Attack** (0.1ms a 10.0ms)
  - Qué tan rápido responde la envolvente rápida a los transientes
  - Valores más bajos: Detección más precisa de transientes
  - Valores más altos: Respuesta de transientes más suave
  - Rango típico: 0.5ms a 5.0ms

- **Fast Release** (1ms a 200ms)
  - Qué tan rápido se reinicia la envolvente rápida
  - Valores más bajos: Control más estricto de transientes
  - Valores más altos: Decaimiento más natural de transientes
  - Rango típico: 20ms a 50ms

- **Slow Attack** (1ms a 100ms)
  - Controla el tiempo de respuesta de la envolvente lenta
  - Valores más bajos: La envolvente lenta sigue los ataques antes, produciendo un énfasis de transiente más suave o más corto
  - Valores más altos: Mayor separación entre ataque y sustain, haciendo que el modelado de transientes sea más fuerte y largo
  - Rango típico: 10ms a 50ms

- **Slow Release** (50ms a 1000ms)
  - Duración del seguimiento de la parte de sostenimiento
  - Valores más bajos: Detección más corta de sostenimiento
  - Valores más altos: Seguimiento más largo de cola de sostenimiento
  - Rango típico: 150ms a 500ms

- **Transient Gain** (-24dB a +24dB)
  - Mejora o reduce la parte de ataque
  - Valores positivos: Más punch y definición
  - Valores negativos: Ataques más suaves, menos agresivos
  - Rango típico: 0dB a +12dB

- **Sustain Gain** (-24dB a +24dB)
  - Mejora o reduce la parte de sostenimiento
  - Valores positivos: Más cuerpo y resonancia
  - Valores negativos: Sonido más ajustado, más controlado
  - Rango típico: -6dB a +6dB

- **Smoothing** (0.1ms a 20.0ms)
  - Controla qué tan suavemente se aplican los cambios de ganancia
  - Valores más bajos: Modelado más preciso
  - Valores más altos: Procesamiento más natural, transparente
  - Rango típico: 3ms a 8ms

### Retroalimentación Visual
- Tres gráficos independientes de visualización de ganancia (uno por banda)
- Visualización en tiempo real del historial de ganancia para cada banda de frecuencia
- Marcadores de tiempo de referencia
- Selección interactiva de bandas
- Retroalimentación visual clara de la actividad de modelado de transientes

### Ajustes Recomendados

#### Escucha Pop/Rock con Más Pegada
- **Low Band (pegada de graves):**
  - Fast Attack: 2.0ms, Fast Release: 50ms
  - Slow Attack: 25ms, Slow Release: 250ms
  - Transient Gain: +6dB, Sustain Gain: -3dB
  - Smoothing: 5.0ms

- **Mid Band (ataque y presencia):**
  - Fast Attack: 1.0ms, Fast Release: 30ms
  - Slow Attack: 15ms, Slow Release: 150ms
  - Transient Gain: +9dB, Sustain Gain: 0dB
  - Smoothing: 3.0ms

- **High Band (impacto de agudos):**
  - Fast Attack: 0.5ms, Fast Release: 20ms
  - Slow Attack: 10ms, Slow Release: 100ms
  - Transient Gain: +3dB, Sustain Gain: -6dB
  - Smoothing: 2.0ms

#### Pista Completa Equilibrada
- **Todas las Bandas:**
  - Fast Attack: 2.0ms, Fast Release: 30ms
  - Slow Attack: 20ms, Slow Release: 200ms
  - Transient Gain: +3dB, Sustain Gain: 0dB
  - Smoothing: 5.0ms

#### Mejora Acústica Natural
- **Low Band:**
  - Fast Attack: 5.0ms, Fast Release: 50ms
  - Slow Attack: 30ms, Slow Release: 400ms
  - Transient Gain: +2dB, Sustain Gain: +1dB
  - Smoothing: 8.0ms

- **Mid Band:**
  - Fast Attack: 3.0ms, Fast Release: 35ms
  - Slow Attack: 25ms, Slow Release: 300ms
  - Transient Gain: +4dB, Sustain Gain: +1dB
  - Smoothing: 6.0ms

- **High Band:**
  - Fast Attack: 1.5ms, Fast Release: 25ms
  - Slow Attack: 15ms, Slow Release: 200ms
  - Transient Gain: +3dB, Sustain Gain: -2dB
  - Smoothing: 4.0ms

### Consejos de Aplicación
- Comienza con ajustes moderados y ajusta cada banda independientemente
- Usa la retroalimentación visual para monitorear la cantidad de modelado de transientes aplicado
- Considera el contenido musical al configurar las frecuencias de cruce
- Las bandas de alta frecuencia generalmente se benefician de tiempos de ataque más rápidos
- Las bandas de baja frecuencia a menudo necesitan tiempos de release más largos para un sonido natural
- Combina con otros procesadores de dinámica para control integral

## Power Amp Sag

Simula el comportamiento de caída de voltaje de amplificadores de potencia bajo cargas altas. Este efecto crea una compresión dinámica tipo amplificador al bajar suavemente el nivel en pasajes musicales exigentes y recuperarlo cuando el pasaje se relaja.

### Guía de Mejora de Escucha
- Sistemas de Audio Vintage:
  - Recrea el carácter clásico del amplificador con compresión natural
  - Añade compresión suave tipo amplificador a pasajes fuertes
  - Útil cuando quieres una respuesta más blanda y menos rígida en los picos
- Música Rock/Pop:
  - Mejora el punch y presencia durante pasajes poderosos
  - Agrega compresión natural sin aspereza
  - Crea una ligera caída y recuperación de nivel en secciones potentes
- Música Clásica:
  - Suaviza ligeramente los crescendos orquestales sin limitación dura
  - Suaviza picos fuertes de cuerdas y metales
  - Mejora el realismo de interpretaciones amplificadas
- Música Jazz:
  - Recrea el comportamiento clásico de compresión del amplificador
  - Añade movimiento sutil de compresión a grabaciones centradas en solos
  - Mantiene el flujo dinámico natural

### Parámetros

- **Sensitivity** (-18.0dB a +18.0dB)
  - Controla qué tan sensible es el efecto de sag a los niveles de entrada
  - Valores más altos: Más sag en volúmenes bajos
  - Valores más bajos: Solo afecta señales fuertes
  - Comienza con 0dB para respuesta natural

- **Stability** (0% a 100%)
  - Simula el tamaño de la capacitancia de la fuente de alimentación
  - Valores más bajos: Capacitores más pequeños (sag más dramático)
  - Valores más altos: Capacitores más grandes (voltaje más estable)
  - Representa físicamente la capacidad de almacenamiento de energía de la fuente
  - 50% proporciona carácter equilibrado

- **Recovery Speed** (0% a 100%)
  - Controla la capacidad de recarga de la fuente de alimentación
  - Valores más bajos: Tasa de recarga más lenta (compresión sostenida)
  - Valores más altos: Tasa de recarga más rápida (recuperación más rápida)
  - Representa físicamente la capacidad de entrega de corriente del circuito de carga
  - 40% proporciona comportamiento natural

- **Monoblock** (Casilla de verificación)
  - Habilita procesamiento independiente por canal
  - Sin marcar: Fuente de alimentación compartida (amplificador estéreo)
  - Marcado: Fuentes independientes (configuración monoblock)
  - Usar para mejor separación de canales e imagen

### Visualización

- Gráficos duales en tiempo real mostrando envolvente de entrada y reducción de ganancia
- Envolvente de entrada (verde): Energía de señal que impulsa el efecto
- Reducción de ganancia (blanco): Cantidad de caída de voltaje aplicada
- Visualización basada en tiempo con marcadores de referencia de 1 segundo
- Valores actuales mostrados en tiempo real

### Configuraciones Recomendadas

#### Carácter Vintage
- Sensitivity: +3.0dB
- Stability: 30% (capacitores más pequeños)
- Recovery Speed: 25% (recarga más lenta)
- Monoblock: Sin marcar

#### Mejora Hi-Fi Moderna
- Sensitivity: 0.0dB
- Stability: 70% (capacitores más grandes)
- Recovery Speed: 60% (recarga más rápida)
- Monoblock: Marcado

#### Rock/Pop Dinámico
- Sensitivity: +6.0dB
- Stability: 40% (capacitores moderados)
- Recovery Speed: 50% (recarga moderada)
- Monoblock: Sin marcar

## Transient Shaper

Un procesador de dinámica especializado que permite realzar o reducir de forma independiente las partes de ataque y sustain del audio. Úsalo para cambiar la pegada y el cuerpo de la música, teniendo en cuenta que valores positivos de Transient Gain o Sustain Gain pueden elevar los picos y la sonoridad percibida.

### Guía de Mejora de Escucha
- Percusión:
  - Añade punch y definición a los tambores mejorando los transientes
  - Reduce la resonancia de la sala controlando la porción de sostenimiento
  - Crea una sensación de impacto más fuerte al enfatizar los ataques de batería; usa un limitador después si los picos suben demasiado
- Guitarra Acústica:
  - Mejora los ataques de púa para mayor claridad y presencia
  - Controla el sustain para que el instrumento se sienta más firme o con más cuerpo
  - Moldea patrones de rasgueo para una escucha más clara o más relajada
- Música Electrónica:
  - Acentúa los ataques de sintetizador para una sensación más percusiva
  - Controla el sustain de sonidos graves para una impresión más firme
  - Añade punch a baterías electrónicas vigilando el nivel de pico

### Parámetros

- **Fast Attack** (0.1ms a 10.0ms)
  - Controla qué tan rápido responde el seguidor de envolvente rápido
  - Valores más bajos: Más sensible a transientes agudos
  - Valores más altos: Detección de transientes más suave
  - Comienza con 1.0ms para la mayoría del material

- **Fast Release** (1ms a 200ms)
  - Qué tan rápido se reinicia el seguidor de envolvente rápido
  - Valores más bajos: Seguimiento de transientes más preciso
  - Valores más altos: Moldeado de transientes más natural
  - 20ms funciona bien como punto de partida

- **Slow Attack** (1ms a 100ms)
  - Controla qué tan rápido responde el seguidor de envolvente lento
  - Valores más bajos: La envolvente lenta sigue los ataques antes, produciendo un énfasis de transiente más suave o más corto
  - Valores más altos: Mayor separación entre ataque y sustain, haciendo que el modelado de transientes sea más fuerte y largo
  - 20ms es un buen ajuste predeterminado

- **Slow Release** (50ms a 1000ms)
  - Qué tan rápido el envolvente lento vuelve al estado de reposo
  - Valores más bajos: Porción de sostenimiento más corta
  - Valores más altos: Detección de colas de sostenimiento más largas
  - Prueba 300ms como punto de partida

- **Transient Gain** (-24dB a +24dB)
  - Aumenta o suprime la parte de ataque del sonido
  - Valores positivos: Enfatiza punch y claridad
  - Valores negativos: Crea un sonido más suave y menos agresivo
  - Los valores positivos pueden elevar el nivel de pico
  - Comienza con +6dB para enfatizar transientes

- **Sustain Gain** (-24dB a +24dB)
  - Aumenta o suprime la parte de sostenimiento del sonido
  - Valores positivos: Añade más riqueza y cuerpo
  - Valores negativos: Crea un sonido más ajustado y controlado
  - Los valores positivos pueden elevar la sonoridad percibida
  - Comienza con 0dB y ajusta al gusto

- **Smoothing** (0.1ms a 20.0ms)
  - Controla la suavidad de los cambios de ganancia
  - Valores más bajos: Moldeado más preciso pero potencialmente más agresivo
  - Valores más altos: Procesamiento más natural y transparente
  - 5.0ms proporciona un buen equilibrio para la mayoría del material

### Visualización
- Visualización de ganancia en tiempo real
- Visualización clara del historial de ganancia
- Marcadores de tiempo para referencia
- Interfaz intuitiva para todos los parámetros

### Ajustes Recomendados

#### Percusión Mejorada
- Fast Attack: 0.5ms
- Fast Release: 10ms
- Slow Attack: 15ms
- Slow Release: 200ms
- Transient Gain: +9dB
- Sustain Gain: -3dB
- Smoothing: 3.0ms

#### Instrumentos Acústicos Naturales
- Fast Attack: 2.0ms
- Fast Release: 30ms
- Slow Attack: 25ms
- Slow Release: 400ms
- Transient Gain: +3dB
- Sustain Gain: 0dB
- Smoothing: 8.0ms

#### Sonido Electrónico Ajustado
- Fast Attack: 1.0ms
- Fast Release: 15ms
- Slow Attack: 10ms
- Slow Release: 250ms
- Transient Gain: +6dB
- Sustain Gain: -6dB
- Smoothing: 4.0ms
