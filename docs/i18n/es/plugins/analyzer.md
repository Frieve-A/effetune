---
title: "Analyzer Plugins - EffeTune"
description: "Audio analysis plugins including Level Meter, Oscilloscope, Spectrogram, Spectrum Analyzer, and Stereo Meter."
lang: en
---

# Plugins de Análisis

Una colección de plugins que te permiten ver tu música de formas fascinantes. Estas herramientas visuales te ayudan a entender lo que estás escuchando mostrando diferentes aspectos del sonido, haciendo tu experiencia de escucha más atractiva e interactiva.

## Lista de Plugins

- [Level Meter](#level-meter) - Muestra qué tan fuerte se está reproduciendo la música
- [Oscilloscope](#oscilloscope) - Muestra la visualización de forma de onda en tiempo real
- [Spectrogram](#spectrogram) - Crea hermosos patrones visuales a partir de tu música
- [Spectrum Analyzer](#spectrum-analyzer) - Muestra las diferentes frecuencias en tu música
- [Stereo Meter](#stereo-meter) - Visualiza el balance estéreo y el movimiento del sonido

## Level Meter

Una visualización que muestra en tiempo real qué tan fuerte se está reproduciendo tu música. Te ayuda a asegurar que estás escuchando a niveles cómodos y evitar cualquier distorsión por volumen demasiado alto.

### Guía de Visualización
- El medidor se mueve arriba y abajo con el volumen de la música
- Más alto en el medidor significa sonido más fuerte
- El marcador rojo muestra el nivel más alto reciente
- La advertencia roja en la parte superior significa que el volumen podría ser demasiado alto
- Para una escucha cómoda, intenta mantener los niveles en el rango medio

## Oscilloscope

Un osciloscopio de grado profesional que muestra formas de onda de audio en tiempo real, ayudándote a visualizar la forma real de tus ondas sonoras. Cuenta con funcionalidad de disparo para una visualización estable de la forma de onda, facilitando el análisis de señales periódicas y transitorias.

### Guía de Visualización
- El eje horizontal muestra el tiempo (milisegundos)
- El eje vertical muestra la amplitud (-1 a 1)
- La línea verde traza la forma de onda real
- Las líneas de cuadrícula ayudan a medir valores de tiempo y amplitud
- El punto de disparo marca dónde comienza la captura de forma de onda

### Parámetros
- **Display Time** - Cuánto tiempo mostrar (1 a 100 ms)
  - Valores más bajos: Ver más detalle en eventos más cortos
  - Valores más altos: Ver patrones más largos
- **Trigger Mode**
  - Auto: Actualizaciones continuas incluso sin disparo
  - Normal: Congela la visualización hasta el siguiente disparo
- **Trigger Source** - Qué canal usar para el disparo
  - Selección de canal izquierdo/derecho
- **Trigger Level** - Nivel de amplitud que inicia la captura
  - Rango: -1 a 1 (amplitud normalizada)
- **Trigger Edge**
  - Rising: Dispara cuando la señal sube
  - Falling: Dispara cuando la señal baja
- **Holdoff** - Tiempo mínimo entre disparos (0.1 a 10 ms)
- **Display Level** - Escala vertical en dB (-96 a 0 dB)
- **Vertical Offset** - Desplaza la forma de onda arriba/abajo (-1 a 1)

### Nota sobre la Visualización de Forma de Onda
La forma de onda mostrada utiliza interpolación lineal entre puntos de muestra para una visualización suave. Esto significa que la señal de audio real entre muestras puede diferir de lo que se muestra. Para la representación más precisa, especialmente al analizar contenido de alta frecuencia, considera usar tasas de muestreo más altas (96kHz o superior).

## Spectrogram

Crea hermosos patrones coloridos que muestran cómo tu música cambia con el tiempo. Es como ver una pintura de tu música, donde diferentes colores representan diferentes sonidos y frecuencias.

### Guía de Visualización
- Los colores muestran qué tan fuertes son diferentes frecuencias:
  - Colores oscuros: Sonidos suaves
  - Colores brillantes: Sonidos fuertes
  - Observa cómo los patrones cambian con la música
- La posición vertical muestra la frecuencia:
  - Abajo: Sonidos graves
  - Medio: Instrumentos principales
  - Arriba: Frecuencias altas

### Lo Que Puedes Ver
- Melodías: Líneas fluidas de color
- Ritmos: Franjas verticales
- Graves: Colores brillantes en la parte inferior
- Armonías: Múltiples líneas paralelas
- Diferentes instrumentos crean patrones únicos

### Parámetros
- **DB Range** - Qué tan vibrantes son los colores (-144dB a -48dB)
  - Números más bajos: Ver más detalles sutiles
  - Números más altos: Enfocarse en los sonidos principales
- **Points** - Qué tan detallados son los patrones (256 a 16384)
  - Números más altos: Patrones más precisos
  - Números más bajos: Visuales más suaves
- **Channel** - Qué parte del campo estéreo mostrar
  - All: Todo combinado
  - Left/Right: Lados individuales

## Spectrum Analyzer

Crea una visualización en tiempo real de las frecuencias de tu música, desde graves profundos hasta agudos altos. Es como ver los ingredientes individuales que componen el sonido completo de tu música.

### Guía de Visualización
- El lado izquierdo muestra frecuencias graves (batería, bajo)
- El medio muestra frecuencias principales (voces, guitarras, piano)
- El lado derecho muestra frecuencias altas (platillos, brillo, aire)
- Picos más altos significan mayor presencia de esas frecuencias
- Observa cómo diferentes instrumentos crean diferentes patrones

### Lo Que Puedes Ver
- Caídas de Graves: Grandes movimientos a la izquierda
- Melodías Vocales: Actividad en el medio
- Agudos Nítidos: Destellos a la derecha
- Mezcla Completa: Cómo todas las frecuencias trabajan juntas

### Parámetros
- **DB Range** - Qué tan sensible es la visualización (-144dB a -48dB)
  - Números más bajos: Ver más detalles sutiles
  - Números más altos: Enfocarse en los sonidos principales
- **Points** - Qué tan detallada es la visualización (256 a 16384)
  - Números más altos: Más detalle preciso
  - Números más bajos: Movimiento más suave
- **Channel** - Qué parte del campo estéreo mostrar
  - All: Todo combinado
  - Left/Right: Lados individuales

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
   - Usa el Level Meter para encontrar volúmenes de escucha cómodos
   - Mira el Spectrum Analyzer bailar con la música
   - Crea un espectáculo de luces visual con el Spectrogram

## Stereo Meter

Una fascinante herramienta de visualización que te permite ver cómo tu música crea una sensación de espacio a través del sonido estéreo. Observa cómo diferentes instrumentos y sonidos se mueven entre tus altavoces o auriculares, añadiendo una emocionante dimensión visual a tu experiencia de escucha.

### Guía de Visualización
- **Pantalla de Diamante** - La ventana principal donde la música cobra vida:
  - Centro: Cuando el sonido está perfectamente equilibrado
  - Arriba/Abajo: Cuando la música llena ambos altavoces uniformemente
  - Izquierda/Derecha: Cuando el sonido viene más de un altavoz
  - Los puntos verdes bailan con la música actual
  - La línea blanca traza los picos musicales
- **Barra de Movimiento** (Lado izquierdo)
  - Muestra cómo trabajan juntos tus altavoces
  - Arriba (+1.0): Ambos altavoces reproduciendo el mismo sonido
  - Medio (0.0): Altavoces creando un buen efecto estéreo
  - Abajo (-1.0): Altavoces creando efectos especiales
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
- **Movimiento del Sonido**: Qué tan alta sube la barra izquierda

### Parámetros
- **Window Time** (10-1000 ms)
  - Valores más bajos: Ver cambios musicales rápidos
  - Valores más altos: Ver patrones de sonido generales
  - Por defecto: 100 ms funciona bien para la mayoría de la música

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