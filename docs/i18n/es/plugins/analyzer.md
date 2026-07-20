---
title: "Plugins de análisis - EffeTune"
description: "Plugins de análisis de audio, incluidos Level Meter, Oscilloscope, Spectrogram, Spectrum Analyzer y Stereo Meter."
lang: es
---

# Plugins de Análisis

Una colección de plugins que te permiten ver tu música de formas fascinantes. Estas herramientas visuales te ayudan a entender lo que estás escuchando mostrando diferentes aspectos del sonido, haciendo tu experiencia de escucha más atractiva e interactiva.

## Lista de Plugins

- [Level Meter](#level-meter) - Muestra el nivel de señal digital y posibles recortes
- [Oscilloscope](#oscilloscope) - Muestra la visualización de forma de onda en tiempo real
- [Spectrogram](#spectrogram) - Crea hermosos patrones visuales a partir de tu música
- [Spectrum Analyzer](#spectrum-analyzer) - Muestra las diferentes frecuencias en tu música
- [Stereo Meter](#stereo-meter) - Visualiza el balance estéreo y las relaciones de fase

## Level Meter

Una visualización que muestra en tiempo real el nivel de señal digital de tu música. Te ayuda a revisar los niveles después de aplicar efectos y a detectar posibles recortes antes de que se vuelvan distorsión audible.

### Guía de Visualización
- La barra horizontal se extiende más hacia la derecha cuanto mayor es el nivel de señal
- El marcador blanco muestra durante un breve momento el nivel máximo reciente
- OVERLOAD indica que la señal superó el rango digital seguro y puede distorsionar
- Para una reproducción limpia, evita niveles rojos o avisos OVERLOAD frecuentes; ajusta el volumen real de escucha en tu dispositivo

## Oscilloscope

Muestra la forma de la onda sonora en tiempo real para que puedas ver golpes, ataques marcados y cambios de volumen mientras escuchas. Los ajustes de Trigger ayudan a estabilizar la visualización cuando la forma de onda se repite.

### Guía de Visualización
- El eje horizontal muestra el tiempo (milisegundos)
- El eje vertical muestra amplitud normalizada; el rango visible cambia con Display Level y Vertical Offset
- La línea verde traza la forma de onda real
- Las líneas de cuadrícula ayudan a medir valores de tiempo y amplitud
- Los ajustes de Trigger determinan dónde empieza la captura de la forma de onda; no se muestra un marcador aparte

### Parámetros
- **Display Time** - Cuánto tiempo mostrar (1 a 100 ms)
  - Valores más bajos: Ver más detalle en eventos más cortos
  - Valores más altos: Ver patrones más largos
- **Trigger Mode**
  - Auto: Actualizaciones continuas incluso sin disparo
  - Normal: Congela la visualización hasta el siguiente disparo
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

## Spectrogram

Crea patrones coloridos que muestran cómo cambia tu música con el tiempo. Los colores indican la intensidad de cada sonido, mientras que la posición vertical muestra su frecuencia.

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
- **Points** - Tamaño de FFT usado para la visualización (256 a 16384)
  - Números más altos: Más detalle de frecuencia, pero actualizaciones temporales más lentas
  - Números más bajos: Movimiento más rápido, pero menos detalle de frecuencia
- El analizador usa el promedio de los canales izquierdo y derecho. La entrada mono se analiza directamente.

## Spectrum Analyzer

Crea una visualización en tiempo real de las frecuencias de tu música, desde graves profundos hasta agudos altos. Es como ver los ingredientes individuales que componen el sonido completo de tu música.

### Guía de Visualización
- El lado izquierdo muestra frecuencias graves (batería, bajo)
- El medio muestra frecuencias principales (voces, guitarras, piano)
- El lado derecho muestra frecuencias altas (platillos, brillo, aire)
- Picos más altos significan mayor presencia de esas frecuencias
- La línea verde más oscura muestra el sonido actual
- La línea verde más brillante retiene brevemente los picos recientes para que puedas ver sonidos fuertes que acaban de pasar
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
- **Points** - Cuánta separación muestra entre frecuencias cercanas (256 a 16384)
  - Números más altos: Más detalle de frecuencia, con actualizaciones más lentas
  - Números más bajos: Actualizaciones más rápidas, con menos detalle de frecuencia
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
