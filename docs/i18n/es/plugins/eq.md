---
title: "Plugins de EQ - Ecualizador paramétrico, gráfico, de fase lineal y corrección de sala - EffeTune"
description: "EQ paramétrico con importación de AutoEQ, EQ gráfico, dinámico y de fase lineal, Room EQ con tus propias mediciones, Tonal Balance EQ, Loudness Equalizer y filtros."
lang: es
---

# Plugins de Ecualización

Una colección de plugins que te permiten ajustar diferentes aspectos del sonido de tu música, desde los graves profundos hasta los agudos nítidos. Estas herramientas te ayudan a personalizar tu experiencia auditiva al realzar o reducir elementos específicos del sonido.

## Controles del gráfico

En los gráficos de puntos arrastrables de 5Band PEQ, 15Band PEQ, 5Band FIR PEQ, Group Delay PEQ y Additional EQ de Room EQ, arrastra un punto normalmente para cambiar ambos ejes. Mantén pulsada la tecla Shift mientras arrastras para limitar el movimiento a un solo eje: empieza a moverlo principalmente en horizontal para cambiar solo Frequency, o principalmente en vertical para cambiar solo Level (Delay en Group Delay PEQ). Suelta Shift para volver al movimiento libre. Coloca el puntero sobre un punto y desplaza la rueda hacia arriba para aumentar Q o hacia abajo para reducirlo.

## Selección de bandas en móviles

En móvil, 5Band PEQ, 5Band FIR PEQ, Group Delay PEQ, Additional EQ de Room EQ y Target Adjust de Tonal Balance EQ muestran los ajustes de una sola banda a la vez. Toca un botón numerado para cambiar de banda. Los ajustes de todas las bandas se conservan.

## Lista de Plugins

- [15Band GEQ](#15band-geq) - Ajuste detallado del sonido con 15 controles precisos
- [15Band PEQ](#15band-peq) - Ajuste detallado del tono en 15 bandas para la reproducción de música
- [5Band Dynamic EQ](#5band-dynamic-eq) - Ecualizador dinámico que responde a tu música
- [5Band FIR PEQ](#5band-fir-peq) - Ajuste del tono en cinco bandas con filtrado FIR de fase mínima o lineal
- [5Band PEQ](#5band-peq) - Ecualizador flexible de 5 bandas para moldear graves, medios y agudos
- [Band Pass Filter](#band-pass-filter) - Enfoca frecuencias específicas
- [Comb Filter](#comb-filter) - Añade una coloración faseada, hueca o metálica
- [Earphone Cable Sim](#earphone-cable-sim) - Ayuda a comprobar lo pequeñas que suelen ser las variaciones de respuesta en frecuencia causadas por cables de auriculares normales
- [Group Delay EQ](#group-delay-eq) - Ajusta el retardo de cada banda de frecuencia sin cambiar el tono
- [Group Delay PEQ](#group-delay-peq) - Control paramétrico de cinco bandas del retardo por frecuencia sin cambiar el tono
- [Hi Pass Filter](#hi-pass-filter) - Elimina frecuencias bajas no deseadas con precisión
- [Lo Pass Filter](#lo-pass-filter) - Elimina frecuencias altas no deseadas con precisión
- [Loudness Equalizer](#loudness-equalizer) - Corrección del balance de frecuencias para escuchar a bajo volumen
- [Narrow Range](#narrow-range) - Enfoca partes específicas del sonido
- [Room EQ](#room-eq) - Corrección FIR basada en mediciones de sala guardadas
- [Tilt EQ](#tilt-eq) - EQ sencillo que inclina el espectro del sonido
- [Tonal Balance EQ](#tonal-balance-eq) - Corrige automáticamente el balance tonal a largo plazo hacia un objetivo según el estilo musical
- [Tone Control](#tone-control) - Ajuste sencillo de bajos, medios y agudos

<!-- spectrum-overlay -->
## Superposición de espectro

Pulsa el icono de espectro de un gráfico compatible para alternar entre After, Before + After y Off. After muestra solo el espectro procesado mediante una línea azul. Before + After rellena el cambio entre el espectro sin procesar y el procesado: el color cálido marca las frecuencias cuyo nivel aumenta tras el procesamiento, el azul marca las que disminuyen y una línea gris señala el espectro After. Los espectros de entrada y salida se alinean en el mismo instante de reproducción, por lo que la diferencia compara el mismo audio. El modo **Normal** aplica un suavizado de 1/12 de octava; **Alta calidad** analiza las frecuencias bajas con más detalle. Usa la comparación para ver cómo cada ajuste cambia graves, medios y agudos mientras escuchas. Lee los niveles del espectro en la escala dBFS a la derecha del gráfico. Es distinta de la escala de ganancia del gráfico; 0 dBFS es la referencia digital de escala completa y los valores inferiores son más silenciosos. En Configuración, elige **Normal** o **Alta calidad** para la calidad del espectro superpuesto, y **Valor instantáneo** o **Retención de picos** para su visualización. Retención de picos mantiene visibles los máximos recientes y los deja bajar gradualmente. En After solo se recopila el espectro procesado; en Off se detienen la recopilación y el dibujo.

## 15Band GEQ

Una herramienta de ajuste detallado del sonido con 15 controles individuales, cada uno afectando una parte específica del espectro sonoro. Perfecta para afinar tu música exactamente a tu gusto.

### Guía de Mejora Auditiva
- Región de Bajos (25Hz-160Hz):
  - Realza la potencia de los bombos y los graves profundos
  - Ajusta la plenitud de los instrumentos de bajo
  - Controla los subgraves que hacen vibrar la habitación
- Medios Bajos (250Hz-630Hz):
  - Ajusta la calidez de la música
  - Controla la plenitud del sonido general
  - Reduce o realza la "densidad" del sonido
- Medios Altos (1kHz-2.5kHz):
  - Realza la claridad y presencia de las voces
  - Ajusta la prominencia de los instrumentos principales
  - Controla la sensación "forward" del sonido
- Altas Frecuencias (4kHz-16kHz):
  - Realza la nitidez y el detalle
  - Controla el brillo y el aire en la música
  - Ajusta el brillo general

### Parámetros
- **Ganancias de Banda** - Controles individuales para cada rango de frecuencia (-12dB a +12dB)
  - Graves Profundos
    - 25Hz: Sensación de los bajos más profunda
    - 40Hz: Impacto de graves profundos
    - 63Hz: Potencia de los bajos
    - 100Hz: Plenitud de los bajos
    - 160Hz: Bajos superiores
  - Bajos
    - 250Hz: Calidez del sonido
    - 400Hz: Plenitud del sonido
    - 630Hz: Cuerpo del sonido
  - Medios
    - 1kHz: Presencia principal del sonido
    - 1.6kHz: Claridad del sonido
    - 2.5kHz: Detalle del sonido
  - Agudos
    - 4kHz: Nitidez del sonido
    - 6.3kHz: Brillantez del sonido
    - 10kHz: Aire del sonido
    - 16kHz: Brillo del sonido

### Visualización
- Gráfico en tiempo real que muestra tus ajustes de sonido
- Controles deslizantes fáciles de usar con control preciso
- Restablecimiento a los valores predeterminados con un solo clic
- Haz doble clic en un deslizador para devolver esa banda a 0dB
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

## 15Band PEQ

Un ecualizador paramétrico de 15 bandas para ajustar con detalle graves, voces, presencia y agudos mientras escuchas. Úsalo cuando quieras más control que con un EQ gráfico, desde pequeños cambios de tono hasta acotar una frecuencia concreta que molesta.

### Guía de Mejora del Sonido
- Claridad de Voces e Instrumentos:
  - Ajusta una banda alrededor de 3.2kHz con Q moderado (1.0-2.0) para una presencia natural
  - Aplica cortes con Q estrecho (4.0-8.0) solo cuando una resonancia concreta te moleste
  - Añade un leve toque de aire con la estantería alta de 10kHz (+2 a +4dB)
- Control de la Calidad de los Bajos:
  - Moldea los fundamentos con un filtro peaking de 100Hz
  - Usa un corte estrecho si una nota de bajo o una resonancia de sala destaca demasiado
  - Crea una extensión suave de los bajos con una estantería baja
- Ajustes Finos de Escucha:
  - Usa realces o cortes pequeños y amplios para resultados naturales
  - Usa ajustes estrechos para problemas concretos, no para el tono general
  - Compara a menudo con bypass para que la música siga sonando equilibrada

### Parámetros
- **Bandas configurables**
  - 15 bandas de frecuencia completamente configurables
  - Configuración inicial de frecuencias:
    - 25Hz, 40Hz, 63Hz, 100Hz, 160Hz (Bajos profundos)
    - 250Hz, 400Hz, 630Hz (Sonidos bajos)
    - 1kHz, 1.6kHz, 2.5kHz (Sonidos medios)
    - 4kHz, 6.3kHz, 10kHz, 16kHz (Sonidos altos)
- **Controles por Banda**
  - Center Frequency: Ajustable de 20Hz a 20kHz
  - Gain Range: ±20dB para filtros Peaking y Low/High Shelf
  - Q Factor: 0.1-10.0 para la mayoría de tipos de filtro; Low/High Shelf está limitado a 0.1-2.0
  - Un Q más alto afecta un rango más estrecho; un Q más bajo suena más suave y amplio
  - En Low/High Pass, Band Pass, Notch y AllPass, Frequency y Q moldean el filtro; Gain no se usa
  - Múltiples Tipos de Filtro:
    - Peaking: Ajuste simétrico de frecuencia
    - Low/High Pass: Pendiente de 12dB/octave
    - Low/High Shelf: Modelado espectral suave
    - Band Pass: Aislamiento enfocado de frecuencias
    - Notch: Eliminación precisa de frecuencia
    - AllPass: Alineación de frecuencia centrada en fase
- **Gestión de Presets**
  - Import: Carga líneas de filtro TXT de estilo Equalizer APO
  - Se importan hasta 15 filtros `ON` PK/LS/LSC/HS/HSC; se ignoran líneas `Preamp` y tipos de filtro no compatibles
    - Formato de ejemplo:
      ```
      Filter 1: ON PK Fc 50 Hz Gain -3.0 dB Q 2.00
      Filter 2: ON HS Fc 12000 Hz Gain 4.0 dB Q 0.70
      ...
      ```

### Visualización
- Visualización de la respuesta en frecuencia de alta resolución
- Puntos de control interactivos con visualización precisa de parámetros
- Actualización en tiempo real de la curva al ajustar los parámetros
- Cuadrícula de frecuencia y ganancia
- Lecturas numéricas precisas para todos los parámetros
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

## 5Band Dynamic EQ

Un ecualizador inteligente que ajusta automáticamente las bandas de frecuencia según el contenido de tu música. Combina una ecualización precisa con un procesamiento dinámico que reacciona a los cambios en tu música en tiempo real, creando una experiencia de escucha mejorada sin ajustes manuales constantes.

### Guía de mejora de escucha
- Domar voces agresivas:
  - Utiliza el filtro Peak a 3000Hz con un ratio alto (4.0-10.0)
  - Ajusta un threshold moderado (-24dB) y un attack rápido (10ms)
  - Reduce automáticamente la dureza solo cuando las voces sean demasiado agresivas
- Potenciar claridad y brillo:
  - Usa Band 5 con Filter Type: Highshelf, Frequency: alrededor de 10000Hz, SC Freq: alrededor de 1200Hz, Ratio: 0.5, Attack: 1ms
  - Las frecuencias medias desencadenan las altas para lograr claridad natural
  - Añade chispa a la música sin un brillo permanente
- Controlar graves excesivos:
  - Utiliza el filtro Lowshelf a 100Hz con un ratio moderado (2.0-4.0)
  - Conserva el impacto de los graves evitando la distorsión de los altavoces
  - Ideal para música con graves pronunciados en altavoces pequeños
- Ajuste sonoro adaptativo:
  - Permite que la dinámica de la música controle el equilibrio sonoro
  - Se ajusta automáticamente a distintas canciones y grabaciones
  - Mantiene una calidad de sonido consistente en toda tu lista de reproducción

### Parámetros
- **Controles de cinco bandas**: cada uno con ajustes independientes
  - Banda 1: 100Hz (región de graves)
  - Banda 2: 300Hz (medios bajos)
  - Banda 3: 1000Hz (medios)
  - Banda 4: 3000Hz (medios altos)
  - Banda 5: 10000Hz (frecuencias altas)
- **Ajustes de banda**
  - Filter Type: Elige entre Peak, Lowshelf o Highshelf
  - Frequency: Ajusta finamente la frecuencia central/esquina (20Hz-20kHz)
  - Q: Controla el ancho de banda/nitidez (0.1-10.0)
  - Max Gain: Establece la ganancia máxima (0-24dB)
  - Threshold: Define el nivel en que comienza el procesamiento (-60dB a 0dB)
  - Ratio: Controla la intensidad del procesamiento (0.1-100.0)
    - Por debajo de 1.0: Expander (realza cuando la señal supera el threshold)
    - Por encima de 1.0: Compressor (reduce cuando la señal supera el threshold)
  - Knee Width: Transición suave alrededor del threshold (0-10dB)
  - Attack: Rapidez con que comienza el procesamiento (0.1-100ms)
  - Release: Rapidez con que finaliza el procesamiento (1-1000ms)
  - Sidechain Frequency: Frecuencia de detección (20Hz-20kHz)
  - Sidechain Q: Ancho de banda de detección (0.1-10.0)

### Visualización
- Gráfico de respuesta de frecuencia en tiempo real
- Curva de respuesta dinámica que muestra los realces y cortes actuales
- Controles interactivos de frecuencia y ganancia
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

## 5Band FIR PEQ

5Band FIR PEQ conserva el manejo de cinco bandas de 5Band PEQ, pero construye la respuesta conjunta como un único filtro FIR. Úsalo para corregir con precisión el sonido durante la reproducción, aplicar cortes muy estrechos o crear transiciones de shelf pronunciadas sin las limitaciones de estabilidad de los filtros recursivos. Minimum Phase mantiene baja la latencia de procesamiento, mientras que Linear Phase retrasa todas las frecuencias el mismo tiempo. El plugin requiere el motor WASM DSP; sin él, la señal pasa sin cambios.

### Guía de mejora del sonido

- Empieza con **Minimum Phase**, 32768 Taps y una Latency de 128 muestras. Para ajustes habituales de graves, medios y agudos, usa valores de Q amplios, entre 0,7 y 2 aproximadamente.
- Para reducir un pico estrecho confirmado mediante una medición, selecciona Peaking, ajusta la frecuencia central al pico y aumenta Q poco a poco. Los valores superiores a 10 están pensados para correcciones precisas; comprueba el estado porque una respuesta extremadamente estrecha puede necesitar más Taps.
- Usa Low Shelf para equilibrar los graves y High Shelf para equilibrar los agudos. Para la escucha diaria, empieza con cambios pequeños de entre 1 y 3 dB.
- Usa LowPass o HighPass para eliminar extremos de frecuencia no deseados. Empieza con una Slope de 12 o 24 dB/oct y auméntala solo si necesitas un corte más pronunciado.
- Elige **Linear Phase** cuando sea importante mantener un retardo de fase constante en todo el espectro y puedas aceptar la latencia adicional. Puede aparecer energía antes de un transitorio, sobre todo con ajustes pronunciados, así que compáralo con Minimum Phase en música con ataques marcados.
- La construcción FIR evita la inestabilidad causada por polos de realimentación, pero un realce grande o un Q muy alto siguen produciendo una respuesta al impulso larga y selectiva. Para resonancias aisladas, prioriza los cortes y conserva suficiente margen de nivel durante la reproducción.

### Parámetros

- **Phase**
  - **Minimum Phase** - Crea una respuesta de fase mínima causal y no añade el retardo equivalente a la mitad de la longitud del FIR. La Latency seleccionada sí se aplica.
  - **Linear Phase** - Crea una respuesta de fase lineal simétrica y añade `Taps / 2` muestras de retardo FIR, además de la Latency seleccionada.
- **Taps** - Longitud del FIR: 8192, 16384, 32768, 65536 o 131072. Más taps mejoran la precisión en graves y con valores de Q muy altos, pero aumentan el uso de memoria, el tiempo de diseño y el retardo de Linear Phase.
- **Latency** - Latencia inicial del motor de convolución: 0, 128, 256, 512 o 1024 muestras. Los valores menores reducen el retardo, pero exigen más procesamiento.
- **Cinco bandas ajustables** - Las frecuencias centrales iniciales son 100 Hz, 316 Hz, 1 kHz, 3,16 kHz y 10 kHz. Cada banda se puede activar por separado.
- **Type** - Selecciona Peaking, LowPass, HighPass, Low Shelf, High Shelf, BandPass o Notch. Todas las bandas activas se combinan antes de diseñar el filtro FIR.
- **Freq** - Ajusta la frecuencia de la banda entre 20 Hz y 20 kHz.
- **Gain** - Ajusta el realce o la atenuación entre -20 y +20 dB para Peaking, Low Shelf y High Shelf. LowPass, HighPass, BandPass y Notch no usan Gain.
- **Q** - Ajusta la anchura de la respuesta entre 0,1 y 100. Los valores mayores producen un cambio más estrecho y los menores uno más amplio. El deslizador utiliza una escala logarítmica.
- **Slope** - Ajusta la pendiente de corte de LowPass o HighPass entre 0,1 y 384 dB/oct. El deslizador utiliza una escala logarítmica y el control solo está disponible para esos dos valores de Type.

### Visualización

- La curva gris muestra el «Target» combinado de los ajustes actuales de las bandas.
- La curva verde muestra la respuesta de magnitud que realiza el FIR diseñado. Una separación visible indica que los Taps seleccionados no pueden reproducir exactamente el objetivo.
- Los marcadores numerados corresponden a las cinco bandas. Arrastra en horizontal para cambiar Freq y en vertical para cambiar Gain; las bandas desactivadas aparecen atenuadas.
- La línea de estado indica si el FIR se está diseñando, preparando o utilizando, y muestra la latencia total de procesamiento en muestras y milisegundos.
- Si los Taps seleccionados no pueden reproducir con precisión una respuesta extrema, el estado recomienda aumentar Taps o reducir Q o Slope.
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

## 5Band PEQ

Un ecualizador flexible de 5 bandas para moldear la reproducción musical. Úsalo cuando los graves se sienten retumbantes, las voces suenan ásperas o los agudos necesitan un poco más de brillo sin abrir la versión más detallada de 15 bandas.

### Guía de Mejora del Sonido
- Claridad de Voces e Instrumentos:
  - Usa la banda de 3.16kHz con Q moderado (1.0-2.0) para una presencia natural
  - Aplica cortes con Q estrecho (4.0-8.0) solo cuando una resonancia concreta te moleste
  - Añade un leve toque de aire con la estantería alta de 10kHz (+2 a +4dB)
- Control de la Calidad de los Bajos:
  - Moldea los fundamentos con un filtro peaking de 100Hz
  - Usa un corte estrecho si una nota de bajo o una resonancia de sala destaca demasiado
  - Crea una extensión suave de los bajos con una estantería baja
- Ajuste Cotidiano del Sonido:
  - Usa ajustes amplios y pequeños para cambios de tono naturales
  - Reduce aspereza, retumbe o falta de brillo de oído
  - Compara a menudo con bypass para que la música siga sonando equilibrada

### Parámetros
- **Cinco bandas ajustables**
  - Band 1: 100Hz (Control de Sub & Bass)
  - Band 2: 316Hz (Definición de Medios Bajos)
  - Band 3: 1.0kHz (Presencia de Medios)
  - Band 4: 3.2kHz (Detalle de Medios Altos)
  - Band 5: 10kHz (Extensión de Altas Frecuencias)
- **Controles por Banda**
  - Center Frequency: Ajustable de 20Hz a 20kHz
  - Gain Range: ±20dB para filtros Peaking y Low/High Shelf
  - Q Factor: 0.1-10.0 para la mayoría de tipos de filtro; Low/High Shelf está limitado a 0.1-2.0
  - Un Q más alto afecta un rango más estrecho; un Q más bajo suena más suave y amplio
  - En Low/High Pass, Band Pass, Notch y AllPass, Frequency y Q moldean el filtro; Gain no se usa
  - Múltiples Tipos de Filtro:
    - Peaking: Ajuste simétrico de frecuencia
    - Low/High Pass: Pendiente de 12dB/octave
    - Low/High Shelf: Modelado espectral suave
    - Band Pass: Aislamiento enfocado de frecuencias
    - Notch: Eliminación precisa de frecuencia
    - AllPass: Alineación de frecuencia centrada en fase

### Visualización
- Visualización de la respuesta en frecuencia de alta resolución
- Puntos de control interactivos con visualización precisa de parámetros
- Actualización en tiempo real de la curva al ajustar los parámetros
- Cuadrícula de frecuencia y ganancia
- Lecturas numéricas precisas para todos los parámetros
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

## Band Pass Filter

Un filtro pasa-banda de precisión que combina filtros de paso alto y paso bajo para permitir que solo pasen frecuencias en un rango específico. Basado en el diseño de filtro Linkwitz-Riley para una respuesta de fase óptima y una calidad de sonido transparente.

### Guía de Mejora Auditiva
- Enfoque en el Rango Vocal:
  - Ajusta el HPF entre 100-300Hz y el LPF entre 4-8kHz para enfatizar la claridad vocal
  - Utiliza pendientes moderadas (-24dB/oct) para un sonido natural
  - Ayuda a que las voces se perciban con más claridad en música densa
- Crea Efectos Especiales:
  - Establece rangos de frecuencia estrechos para efectos de teléfono, radio o megáfono
  - Usa pendientes más pronunciadas (-36dB/oct o más) para un filtrado más dramático
  - Experimenta con diferentes rangos de frecuencia para sonidos creativos
- Limpia Rangos de Frecuencia Específicos:
  - Apunta a frecuencias problemáticas con control preciso
  - Usa diferentes pendientes para las secciones de paso alto y paso bajo según sea necesario
  - Perfecto para eliminar simultáneamente ruido de baja frecuencia y ruido de alta frecuencia

### Parámetros
- **HPF Frequency (Hz)** - Controla dónde se filtran las frecuencias bajas (10Hz a 40000Hz; el límite superior efectivo también depende de la tasa de muestreo)
  - Valores más bajos: Solo se eliminan las frecuencias más bajas
  - Valores más altos: Se eliminan más frecuencias bajas
  - Ajusta según el contenido específico de baja frecuencia que deseas eliminar
- **HPF Slope** - Controla cuán agresivamente se reducen las frecuencias por debajo del corte
  - Off: No se aplica filtrado
  - -12dB/oct: Filtrado suave (LR2 - Linkwitz-Riley de 2º orden)
  - -24dB/oct: Filtrado estándar (LR4 - Linkwitz-Riley de 4º orden)
  - -36dB/oct: Filtrado más fuerte (LR6 - Linkwitz-Riley de 6º orden)
  - -48dB/oct: Filtrado muy fuerte (LR8 - Linkwitz-Riley de 8º orden)
- **LPF Frequency (Hz)** - Controla dónde se filtran las frecuencias altas (10Hz a 40000Hz; el límite superior efectivo también depende de la tasa de muestreo)
  - Valores más bajos: Se eliminan más frecuencias altas
  - Valores más altos: Solo se eliminan las frecuencias más altas
  - Ajusta según el contenido específico de alta frecuencia que deseas eliminar
- **LPF Slope** - Controla cuán agresivamente se reducen las frecuencias por encima del corte
  - Off: No se aplica filtrado
  - -12dB/oct: Filtrado suave (LR2 - Linkwitz-Riley de 2º orden)
  - -24dB/oct: Filtrado estándar (LR4 - Linkwitz-Riley de 4º orden)
  - -36dB/oct: Filtrado más fuerte (LR6 - Linkwitz-Riley de 6º orden)
  - -48dB/oct: Filtrado muy fuerte (LR8 - Linkwitz-Riley de 8º orden)

### Visualización
- Gráfico de respuesta de frecuencia en tiempo real con escala logarítmica de frecuencia
- Visualización clara de ambas pendientes de filtro y puntos de corte
- Controles interactivos para un ajuste preciso
- Cuadrícula de frecuencia con marcadores en puntos de referencia clave
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

## Comb Filter

Un filtro peine que añade un carácter faseado, hueco, metálico o resonante al mezclar el sonido con una copia retrasada muy corta. Úsalo cuando quieras que una pista se sienta más coloreada, espaciosa o experimental.

### Guía de Mejora Auditiva
- Añade Coloración Sutil:
  - Empieza con Feedforward, Feedback Gain alrededor de 0.2-0.4 y Dry-Wet Mix alrededor de 20-40%
  - Ajusta Fundamental Frequency hasta que el tono hueco o faseado encaje con la música
  - Mantén el feedback bajo para un efecto más suave que se mezcle con el sonido original
- Crea Resonancia y Efectos de Eco:
  - Usa Feedback o un Feedback Gain más alto para una resonancia o un efecto tipo eco más marcado
  - Experimenta con diferentes frecuencias fundamentales para un carácter tonal único
  - Usa valores bajos de Dry-Wet Mix si el efecto se vuelve demasiado obvio
- Color Metálico Brillante:
  - Prueba valores altos de Fundamental Frequency para picos y valles más brillantes y espaciados
  - Usa Feedback Gain positivo o negativo para cambiar el patrón de picos y valles
  - Combina con otros efectos para sonidos de escucha más experimentales

### Parámetros
- **Fundamental Frequency (Hz)** - Controla el tiempo de retardo y el espaciado armónico (20Hz a 20000Hz)
  - Valores más bajos: Retardos más largos, picos y valles del filtro más cercanos
  - Valores más altos: Retardos más cortos, picos y valles más separados
- **Feedback Gain** - Controla la intensidad del efecto del filtro peine (-1.0 a 1.0)
  - Valores negativos: Crea patrones armónicos inversos
  - Valores positivos: Crea patrones armónicos de refuerzo
  - Cero: Sin efecto (solo señal seca)
  - Valores absolutos más altos: Efecto más pronunciado
- **Comb Type** - Controla la estructura del filtro
  - Feedforward: Crea realce armónico sin retroalimentación
  - Feedback: Crea efectos de resonancia y eco
- **Dry-Wet Mix** - Controla el balance entre la señal procesada y la original (0% a 100%)
  - 0%: Solo señal original
  - 50%: Mezcla igual de señal original y procesada
  - 100%: Solo señal procesada

### Detalles Técnicos
- **Cálculo de Retardo**: Tiempo de retardo = 1 / Fundamental Frequency
- **Respuesta Armónica**: Crea picos y valles espaciados regularmente a partir de la frecuencia fundamental
- **Coloración Espacial**: Puede recordar reflexiones cortas, coloración hueca o resonancia metálica
- **Visualización en Tiempo Real**: Muestra la respuesta de frecuencia con marcador de frecuencia fundamental

### Visualización
- Gráfico de respuesta de frecuencia en tiempo real con escala logarítmica de frecuencia
- Visualización clara de picos y valles del filtro peine
- Marcador de frecuencia fundamental que muestra el tiempo de retardo
- Controles interactivos para ajuste preciso
- Cálculo de distancia de retardo en milímetros
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

## Earphone Cable Sim

Reproduce las pequeñas variaciones de respuesta en frecuencia que aparecen cuando un auricular se alimenta desde un amplificador a través de la resistencia e inductancia reales del cable y de una impedancia de salida no nula. Como la impedancia del auricular cambia con la frecuencia (por las resonancias del transductor y la inductancia de la bobina móvil), la impedancia de la fuente y del cable produce cambios de nivel propios de cada auricular. También sirve como comprobación práctica: con cables de construcción y calidad normales, una impedancia de salida de amplificador común y auriculares que no tengan una impedancia inusualmente baja ni otras condiciones anómalas, el cambio audible entre cables normales para auriculares suele ser lo bastante pequeño como para resultar despreciable. El efecto es más fuerte con auriculares de baja impedancia que tienen grandes picos de impedancia, y normalmente es sutil con amplificadores modernos de baja impedancia de salida.

### Guía de Mejora Auditiva
- Evalúa la interacción de la impedancia de la fuente:
  - Sube Output Z para emular amplificadores de válvulas o salidas de auriculares de alta impedancia
  - Compara con el bypass para escuchar cómo cambian los graves y las zonas cercanas a los picos de impedancia
- Explora el comportamiento de auriculares con varios transductores:
  - Activa Resonances adicionales para modelar auriculares de armadura balanceada o híbridos con varios picos de impedancia
  - Los picos de impedancia más grandes, combinados con una impedancia de fuente más alta, generan una coloración más marcada
- Simula la resistencia y la inductancia del cable:
  - Aumenta Cable R para emular cables más largos o finos, con mayor resistencia de corriente continua
  - Aumenta Cable L para emular cables con mayor inductancia; su efecto aparece sobre todo en los agudos superiores
  - Cable R se suma a la resistencia total en serie, por lo que puede reforzar la interacción en toda la banda
- Comprueba la audibilidad de cables normales:
  - Usa valores realistas de Cable R y Cable L, y compáralos con el bypass para estimar lo pequeñas que son las diferencias habituales entre cables
  - Si el cambio solo se vuelve evidente con Output Z, Cable R o Base Z muy extremos, esa comparación sugiere que los cables normales probablemente no tendrán una importancia audible con ese auricular y ese amplificador

### Presets del sistema

Haz clic en **Preajustes de efecto** en el encabezado del efecto para comparar distintas combinaciones de fuente y cable con todos sus ajustes.

- **High Impedance Source** - Una fuente con alta impedancia de salida que alimenta un auricular de baja impedancia.
- **Long Thin Cable** - Mayor resistencia e inductancia del cable.
- **Vintage Portable Out** - Una salida portátil de mayor impedancia y un auricular de 32 Ω.

### Parámetros
- **Output Z (Ω)** - Impedancia de salida del amplificador (0 a 20). Los valores por debajo de 1Ω son típicos en amplificadores modernos; valores más altos refuerzan la coloración relacionada con la impedancia.
- **Cable R (Ω)** - Resistencia de corriente continua del cable (0 a 2). Los valores más altos representan cables más largos o finos y se suman a la resistencia total en serie.
- **Cable L (µH)** - Inductancia del cable (0 a 5). Afecta principalmente la respuesta de los agudos superiores, especialmente con auriculares de baja impedancia.
- **Voice Coil L (mH)** - Inductancia de la bobina móvil del auricular (0.01 a 2). Eleva la impedancia de carga hacia las frecuencias altas y cambia la interacción en la zona aguda.
- **Base Z (Ω)** - Impedancia nominal del auricular en bajas frecuencias (4 a 64). Los valores más bajos hacen que la impedancia de la fuente y del cable tenga más influencia.
- **Resonances (hasta 5)** - Cada una modela un pico de impedancia del transductor. La primera está activada por defecto; las demás están preajustadas a resonancias típicas de transductores y se pueden activar o desactivar.
  - **Enable** - Activa o desactiva cada resonancia
  - **Freq (Hz)** - Frecuencia de resonancia (20 a 20000)
  - **Q** - Agudeza del pico de impedancia (0.5 a 10)
  - **Peak Z (Ω)** - Impedancia en el pico de resonancia (16 a 116)

### Detalles Técnicos
- **Modelo físico**: Calcula `H(f) = Zload / (Zsource + Zload)`, donde `Zsource` es la impedancia de salida más la resistencia e inductancia del cable, y `Zload` es la impedancia del auricular (impedancia base, inductancia de la bobina móvil y picos de resonancia).
- **Realización**: La función de transferencia se factoriza y se convierte en una cascada de filtros biquad mediante matched-Z, con latencia cero y comportamiento de fase mínima comparable al de los demás plugins de EQ.
- **Normalización**: La respuesta se normaliza a una media de potencia de 0dB (20Hz a 20kHz), de modo que activar o desactivar el efecto no cambie el volumen general.

### Visualización
- Gráfico en tiempo real de la respuesta del filtro aplicada, con escala logarítmica de frecuencia
- Las etiquetas de la cuadrícula cubren de 20Hz a 20kHz; la curva se extiende por todo el rango del gráfico, de 10Hz a 40kHz
- Curva de respuesta verde sobre una cuadrícula oscura, con el eje de dB autoescalado alrededor de la referencia normalizada de 0dB
- Las desviaciones más grandes de la curva indican dónde el modelo cambia más el nivel de reproducción
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

## Group Delay EQ

Group Delay EQ es la contraparte de un ecualizador normal: en lugar de cambiar el volumen de cada banda, cambia **cuándo llega** cada banda. Quince deslizadores fijan el retardo de cada rango de frecuencias y el plugin construye un único filtro FIR diseñado para realizar esos retardos con una respuesta de magnitud plana. La respuesta plana es el objetivo de diseño, no una garantía: un número finito de Taps aproxima el objetivo ideal, y los ajustes de retardo grandes o que cambian bruscamente entre bandas pueden generar un rizado de magnitud medible. Úsalo para compensar los errores de tiempo de un altavoz o de un filtro divisor, o para comprobar por ti mismo cuánta distorsión de fase revelan realmente tu sistema y tus oídos. El plugin requiere el motor WASM DSP; sin él, la señal pasa sin cambios.

Para el sonido solo importan las diferencias entre bandas. Un filtro que retrasa todas las bandas por igual es solo un retardo, así que el plugin mantiene fijo un retardo interno y te deja adelantar o atrasar cada banda alrededor de él. Mientras todos los deslizadores están en 0 ms, el plugin es totalmente transparente y no añade latencia.

### Guía de mejora del sonido

- **Tiempo entre altavoces y subwoofer**: Si los graves llegan tarde respecto al resto de la música, retrasa las bandas por encima del corte la misma cantidad hasta que el gráfico quede plano en esa zona. Las correcciones típicas van de 2 a 10 ms y se juzgan mejor con bombo y bajo.
- **Cajas bass-reflex y modos de sala**: Una caja con puerto añade retardo de grupo cerca de su frecuencia de sintonía. Baja la banda grave afectada, o sube todas las demás, para que la curva quede más plana. Es normal que queden pequeñas diferencias por debajo de 50 Hz.
- **Prueba de audición de la distorsión de fase**: Pon una banda en +10 ms, compara con el efecto desactivado y luego reduce el valor hasta que ya no oigas diferencia. Interpreta el resultado como una comparación de fase solo cuando el «Ripple» de la línea de estado sea suficientemente pequeño y la curva verde «Realized» coincida estrechamente con la curva gris «Target». De lo contrario, los cambios de magnitud o un retardo realizado con poca precisión también pueden afectar a lo que oyes.
- **Trabaja banda por banda**: Mueve un deslizador cada vez y escucha. Los cambios de solo fase son sutiles en la mayoría del material y se notan sobre todo en transitorios como batería, cuerdas pulsadas y ataques de piano.
- **Observa las dos curvas**: Si la curva verde deja de seguir a la gris, el ajuste de Taps actual no puede realizar esa forma. Aumenta Taps o reduce la diferencia entre bandas vecinas.

### Parámetros

- **Taps** - Longitud del FIR: 4096, 8192, 16384 o 32768. Las frecuencias bajas necesitan un filtro largo: a 96 kHz, 16384 taps siguen incluso grandes diferencias de retardo hasta unos 60 Hz, mientras que los ajustes más cortos pierden precisión primero en los graves. Taps también decide cuánto retardo puede contener el filtro y, por tanto, hasta dónde llegan los deslizadores. Más taps significan más latencia y más proceso.
- **Latency** - Latencia inicial del motor de convolución: 0, 128, 256, 512 o 1024 muestras. Valores menores reducen el retardo pero exigen más proceso.
- **Deslizadores de banda (25 Hz a 16 kHz)** - Quince deslizadores fijan el retardo de grupo de cada banda. Los valores positivos hacen que ese rango llegue más tarde y los negativos más pronto. El rango cubre todo el retardo que el filtro puede contener: a 96 kHz son ±18,6 ms con 4096 taps y ±149,3 ms con 32768 taps. La banda más alta realiza esos valores por completo, mientras que las bandas bajas necesitan más taps para seguir un ajuste grande; el gráfico muestra hasta dónde llega cada una. Los valores se interpolan suavemente en frecuencia, por lo que las bandas vecinas siempre se funden entre sí.
- **Ángulo de fase** - Debajo de cada valor en milisegundos, el deslizador muestra el mismo retardo como rotación de fase en la frecuencia central de la banda. Más allá de una vuelta completa, la lectura se divide en ciclos enteros y el ángulo restante, de modo que `+2c180°` significa dos ciclos completos más media vuelta.
- **Reset** - Haz doble clic en un deslizador para devolver esa banda a 0 ms. El botón Reset del gráfico restablece todas las bandas a la vez.

La latencia total es el valor de Latency más la mitad de Taps. No cambia al mover los deslizadores, así que solo un cambio de Taps o de Latency altera el retardo de toda la cadena.

### Visualización

- La curva gris es el objetivo: el retardo solicitado, interpolado sobre un eje logarítmico de 20 Hz a 20 kHz. El eje de retardo se reescala para ajustarse a los ajustes actuales, con un mínimo de ±5 ms.
- La curva verde es lo que el filtro diseñado hace realmente. Donde ambas coinciden, el ajuste se realiza por completo; donde se separan, el filtro no puede seguir la petición con los Taps actuales.
- La línea de estado muestra la latencia total en muestras y milisegundos, y el Ripple de magnitud del filtro. Ripple mide cuánto se aparta la respuesta de magnitud realizada del objetivo de diseño plano: cuanto menor sea el valor, más cerca estará del objetivo, y 0,3 dB es el umbral del aviso de precisión.
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

## Group Delay PEQ

Group Delay PEQ es la versión paramétrica de Group Delay EQ. En lugar de quince deslizadores fijos ofrece cinco bandas de colocación libre, cada una con su propia forma, frecuencia, retardo y Q. Las bandas activas se suman en una única curva de retardo objetivo y el plugin construye un solo filtro FIR diseñado para realizar esa curva con una respuesta de magnitud plana. La respuesta plana es el objetivo de diseño, no una garantía: un número finito de Taps aproxima el objetivo ideal, y los retardos grandes o las formas muy estrechas pueden generar un rizado de magnitud medible. Úsalo cuando el error de tiempo que quieres corregir tenga una forma conocida —un filtro divisor, una caja bass-reflex, un paso alto pronunciado o una resonancia—, porque una o dos bandas pueden reproducir esa forma directamente. El plugin requiere el motor WASM DSP; sin él, la señal pasa sin cambios.

Para el sonido solo importan las diferencias entre frecuencias. Un filtro que retrasa todo por igual es solo un retardo, así que el plugin mantiene fijo un retardo interno y te deja adelantar o atrasar cada zona alrededor de él. Mientras todas las bandas activas están en 0 ms, el plugin es totalmente transparente y no añade latencia. Como la respuesta de magnitud no cambia, el efecto es sutil: modifica el tiempo, no el timbre, y se nota sobre todo en transitorios como batería, cuerdas pulsadas y ataques de piano.

### Guía de mejora del sonido

- **Copia un filtro conocido con Filter GD**: Una sección analógica de segundo orden tiene una joroba de retardo de grupo cuya forma queda fijada por su frecuencia de corte y su Q. Introduce esos dos valores en Freq y Q, y pon en Delay la altura de la joroba medida con signo negativo: la banda la cancela. Un subwoofer de caja cerrada o una suma LR2 necesitan una banda; una alineación bass-reflex de cuarto orden o una suma LR4 se cubren con una o dos.
- **Alinea una zona completa con los shelves**: Cuando una parte del espectro llega tarde en conjunto, y no alrededor de una sola frecuencia, usa Low Shelf o High Shelf con Q de 2 a 4. Se obtiene un escalón de aproximadamente una octava de ancho, de modo que todo lo que queda a un lado de la frecuencia de corte se desplaza la misma cantidad.
- **Retoca el resto con Peak**: Peak es una campana suave cuya anchura a media altura sigue a Q igual que en un ecualizador paramétrico. Úsala para los residuos que ninguna forma de filtro concreta explica.
- **Sé realista con los cortes de agudos**: Un filtro divisor LR4 a 3 kHz tiene un pico de retardo de grupo de solo unos 0,2 ms. Corregirlo queda por debajo del umbral de audibilidad, así que el beneficio allí es escaso; los errores de tiempo en graves valen mucho más la pena.
- **Los graves y los Q altos necesitan filtros largos**: Corregir una resonancia grave con un Q alto, en torno a Q 8, requiere 32768 taps a 96 kHz. Observa las dos curvas: si la verde no puede seguir a la gris, aumenta Taps o baja Q.
- **Trabaja banda por banda**: Cambia una banda cada vez y escucha. Los cambios de solo fase son sutiles en la mayoría del material, y comparar con el efecto desactivado dice más que mirar el gráfico.

### Parámetros

- **Type** - Selecciona la forma de retardo de la banda. Los cuatro tipos se describen con los mismos tres valores, Freq, Delay y Q, y Delay siempre es el valor extremo de la curva propia de esa banda.
  - **Peak** - Una campana centrada en Freq cuya anchura a media altura equivale al ancho de banda implicado por Q. Nunca sobrepasa, así que es la opción natural para correcciones de forma libre y retoques del residuo.
  - **Low Shelf** - Un escalón suave que mantiene Delay por debajo de Freq, pasa por la mitad de Delay en Freq y cae a cero por encima. Q fija la pendiente de la transición: con Q 1 coincide con la transición de retardo de grupo de un allpass de primer orden, mientras que Q de 2 a 4 da el escalón práctico de aproximadamente una octava usado para la alineación limitada en banda.
  - **High Shelf** - La imagen especular de Low Shelf, y su complemento: las dos formas con la misma Freq y Q suman un Delay constante.
  - **Filter GD** - Suma o resta tal cual la forma del retardo de grupo de una etapa de filtro analógico (paso alto, filtro divisor o resonancia). Introduce en Freq y Q la frecuencia de corte y la Q del filtro que quieres corregir, y en Delay la altura de la joroba de la curva de retardo de grupo medida, con valor negativo si quieres cancelarla.
- **Freq** - Ajusta la frecuencia de la banda entre 20 Hz y 20 kHz. Cerca de 18 a 20 kHz el objetivo se atenúa suavemente hasta cero, así que una banda situada cerca del límite superior tiene un efecto reducido.
- **Delay** - Ajusta en milisegundos el valor extremo de la curva propia de esa banda. Los valores positivos hacen que esa zona llegue más tarde y los negativos más pronto. El rango cubre todo el retardo que el filtro puede contener: a 96 kHz son ±18,6 ms con 4096 taps y ±149,3 ms con 32768 taps. Al cambiar Taps o la frecuencia de muestreo, los valores guardados se limitan al nuevo máximo.
- **Q** - Ajusta la anchura o la pendiente de la forma entre 0,1 y 100 con un deslizador logarítmico, y lo usan todos los Type. Los rangos útiles difieren: de 0,25 a 16 para Low Shelf y High Shelf, y de 0,1 a 10 para Filter GD. En la práctica, los shelves se usan con Q de 2 a 4 y Filter GD con Q de 0,5 a 8: 0,5 corresponde a un allpass de primer orden o una suma LR2, 0,7071 a una alineación Butterworth o una suma LR4, y 8 a una resonancia estrecha. Los ajustes fuera de esos rangos también se aceptan; la línea de estado avisa cuando los Taps actuales no pueden realizarlos.
- **Enabled** - Activa o desactiva cada una de las cinco bandas. Las bandas desactivadas no aportan nada a la curva objetivo y aparecen atenuadas en el gráfico.
- **Taps** - Longitud del FIR: 4096, 8192, 16384 o 32768. Las frecuencias bajas necesitan un filtro largo, y las formas de Q alto también. Taps también decide cuánto retardo puede contener el filtro y, por tanto, hasta dónde llega Delay. Más taps significan más latencia y más proceso.
- **Latency** - Latencia inicial del motor de convolución: 0, 128, 256, 512 o 1024 muestras. Valores menores reducen el retardo pero exigen más proceso.

La latencia total es el valor de Latency más la mitad de Taps. No cambia al mover las bandas, así que solo un cambio de Taps o de Latency altera el retardo de toda la cadena.

### Visualización

- La curva gris es el objetivo: la suma de las formas de las bandas activas, dibujada sobre un eje logarítmico de frecuencia. El eje de retardo se reescala para ajustarse a los ajustes actuales, con un mínimo de ±5 ms.
- La curva verde es lo que el filtro diseñado hace realmente. Donde ambas coinciden, el ajuste se realiza por completo; donde se separan, el filtro no puede seguir la petición con los Taps actuales.
- Los marcadores numerados corresponden a las cinco bandas. Arrastra en horizontal para cambiar Freq y en vertical para cambiar Delay. El marcador se sitúa sobre la curva solo con Peak: un shelf pasa por la mitad de Delay en Freq, y Filter GD alcanza su valor extremo por debajo de Freq: justo por debajo con Q alto y cada vez más abajo a medida que Q disminuye, hasta que con Q de aproximadamente 0,577 o menos el valor extremo queda en el extremo grave del gráfico.
- La línea de estado muestra la latencia total en muestras y milisegundos, y el Ripple de magnitud del filtro. Ripple mide cuánto se aparta la respuesta de magnitud realizada del objetivo de diseño plano: cuanto menor sea el valor, más cerca estará del objetivo, y 0,3 dB es el umbral del aviso de precisión.
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

## Hi Pass Filter

Un filtro pasa-altos de precisión que elimina las frecuencias bajas no deseadas mientras preserva la claridad de las frecuencias altas. Basado en el diseño de filtro Linkwitz-Riley para una respuesta de fase óptima y una calidad de sonido transparente.

### Guía de Mejora Auditiva
- Elimina el retumbo indeseado:
  - Establece la frecuencia entre 20-40Hz para eliminar el ruido sub-sónico
  - Utiliza pendientes más pronunciadas (-24dB/oct o mayores) para unos graves más limpios
  - Ideal para grabaciones en vinilo o actuaciones en vivo con vibraciones en el escenario
- Limpia música con exceso de bajos:
  - Establece la frecuencia entre 60-100Hz para ajustar la respuesta de los bajos
  - Utiliza pendientes moderadas (-12dB/oct a -24dB/oct) para una transición natural
  - Ayuda a prevenir la sobrecarga de los altavoces y mejora la claridad
- Crea efectos especiales:
  - Establece la frecuencia entre 200-500Hz para una voz más delgada con graves recortados
  - Utiliza pendientes pronunciadas (-48dB/oct o mayores) para un filtrado dramático
  - Para un efecto de voz tipo teléfono, combínalo con Lo Pass Filter alrededor de 3-4kHz

### Parámetros
- **Frequency (Hz)** - Controla dónde se filtran las frecuencias bajas (10Hz a 40000Hz; el límite superior efectivo también depende de la tasa de muestreo)
  - Valores más bajos: Se eliminan únicamente las frecuencias más bajas
  - Valores más altos: Se eliminan más frecuencias bajas
  - Ajusta según el contenido de frecuencias bajas específico que deseas eliminar
- **Slope** - Controla cuán agresivamente se reducen las frecuencias por debajo del punto de corte
  - Off: Sin filtrado aplicado
  - -12dB/oct: Filtrado suave (LR2 - filtro Linkwitz-Riley de 2º orden)
  - -24dB/oct: Filtrado estándar (LR4 - filtro Linkwitz-Riley de 4º orden)
  - -36dB/oct: Filtrado más fuerte (LR6 - filtro Linkwitz-Riley de 6º orden)
  - -48dB/oct: Filtrado muy fuerte (LR8 - filtro Linkwitz-Riley de 8º orden)
  - -60dB/oct a -96dB/oct: Filtrado extremadamente pronunciado para aplicaciones especiales

### Visualización
- Gráfico en tiempo real de la respuesta en frecuencia con escala logarítmica
- Visualización clara de la pendiente del filtro y del punto de corte
- Controles interactivos para un ajuste preciso
- Cuadrícula de frecuencia con marcadores en puntos de referencia clave
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

## Lo Pass Filter

Un filtro pasa-bajos de precisión que elimina las frecuencias altas no deseadas mientras preserva la calidez y el cuerpo de las frecuencias bajas. Basado en el diseño de filtro Linkwitz-Riley para una respuesta de fase óptima y una calidad de sonido transparente.

### Guía de Mejora Auditiva
- Reduce la aspereza y la sibilancia:
  - Establece la frecuencia entre 8-12kHz para domar grabaciones ásperas
  - Utiliza pendientes moderadas (-12dB/oct a -24dB/oct) para un sonido natural
  - Ayuda a reducir la fatiga auditiva en grabaciones brillantes
- Calienta grabaciones digitales:
  - Establece la frecuencia entre 12-16kHz para reducir el "edge" digital
  - Utiliza pendientes suaves (-12dB/oct) para un efecto sutil de calentamiento
  - Crea un carácter sonoro más parecido al analógico
- Crea efectos especiales:
  - Establece la frecuencia entre 1-3kHz con una pendiente pronunciada para un carácter apagado y de banda estrecha
  - Utiliza pendientes pronunciadas (-48dB/oct o mayores) para un filtrado dramático
  - Para un efecto de radio vintage, combínalo con Hi Pass Filter para quitar también las frecuencias bajas
- Controla el ruido y el siseo:
  - Establece la frecuencia justo por encima del contenido musical (típicamente 14-18kHz)
  - Utiliza pendientes más pronunciadas (-36dB/oct o mayores) para un control efectivo del ruido
  - Reduce el siseo de la cinta o el ruido de fondo mientras preserva la mayor parte del contenido musical

### Parámetros
- **Frequency (Hz)** - Controla dónde se filtran las frecuencias altas (10Hz a 40000Hz; el límite superior efectivo también depende de la tasa de muestreo)
  - Valores más bajos: Se eliminan más frecuencias altas
  - Valores más altos: Se eliminan únicamente las frecuencias más altas
  - Ajusta según el contenido específico de frecuencias altas que deseas eliminar
- **Slope** - Controla cuán agresivamente se reducen las frecuencias por encima del punto de corte
  - Off: Sin filtrado aplicado
  - -12dB/oct: Filtrado suave (LR2 - filtro Linkwitz-Riley de 2º orden)
  - -24dB/oct: Filtrado estándar (LR4 - filtro Linkwitz-Riley de 4º orden)
  - -36dB/oct: Filtrado más fuerte (LR6 - filtro Linkwitz-Riley de 6º orden)
  - -48dB/oct: Filtrado muy fuerte (LR8 - filtro Linkwitz-Riley de 8º orden)
  - -60dB/oct a -96dB/oct: Filtrado extremadamente pronunciado para aplicaciones especiales

### Visualización
- Gráfico en tiempo real de la respuesta en frecuencia con escala logarítmica
- Visualización clara de la pendiente del filtro y del punto de corte
- Controles interactivos para un ajuste preciso
- Cuadrícula de frecuencia con marcadores en puntos de referencia clave
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

## Loudness Equalizer

Un ecualizador especializado que vincula el ajuste de volumen con la corrección del balance de frecuencias. Configura Average SPL como el nivel medio estimado de presión sonora al usar 0dB en Relative Volume y utiliza Relative Volume para los cambios cotidianos de volumen. La corrección aumenta automáticamente al bajar el volumen y disminuye al subirlo.

### Guía de Mejora Auditiva
- Escucha a Bajo Volumen:
  - Realza las frecuencias de bajos y agudos
  - Mantiene el balance musical en niveles bajos
  - Compensa las características de la audición humana
- Ajuste Average SPL:
  - Ajústalo al nivel medio estimado de presión sonora con Relative Volume en 0dB
  - Es un valor de referencia manual; el plugin no mide el SPL
- Ajuste Relative Volume:
  - Los valores negativos reducen el nivel de salida y aumentan la corrección
  - Los valores positivos elevan el nivel de salida y reducen la corrección
  - La corrección de EQ se calcula a partir de `Average SPL + Relative Volume` y se limita al intervalo de corrección de 60dB a 85dB
- Balance de Frecuencias:
  - Shelf de graves para realzar los bajos (100-300Hz)
  - Shelf de agudos para realzar los agudos (3-6kHz)
  - Transición suave entre rangos de frecuencia

### Presets del sistema

Haz clic en **Preajustes de efecto** en el encabezado del efecto para empezar con una curva completa de compensación de sonoridad.

- **Late Night Listening** - Una compensación más intensa para niveles de escucha bajos.
- **Quiet Background** - Una curva de compensación moderada para el uso cotidiano.
- **Near Reference Level** - Una compensación mínima cerca de un nivel de referencia más alto.

### Parámetros
- **Average SPL** - Nivel medio estimado de presión sonora con Relative Volume en 0dB (60dB a 96dB)
  - Ajústalo manualmente al nivel medio de presión sonora en la posición de escucha
  - Los valores superiores a 85dB permiten fijar una referencia más alta; la corrección de EQ permanece desactivada hasta que `Average SPL + Relative Volume` baja de 85dB
- **Relative Volume** - Ajuste de volumen relativo a Average SPL (-30dB a +12dB)
  - 0dB: Nivel de salida correspondiente a Average SPL
  - Valores negativos: Menor volumen y mayor corrección de sonoridad
  - Valores positivos: Mayor volumen y menor corrección de sonoridad
  - Los valores positivos pueden causar recorte si la entrada o el realce de EQ ya son elevados
- **Controles de bajas frecuencias**
  - Frequency: Centro de realce de bajos (100Hz a 300Hz)
  - Gain: Potenciación máxima de bajos (0dB a 15dB)
  - Q: Forma del realce de bajos (0.5 a 1.0)
- **Controles de altas frecuencias**
  - Frequency: Centro de realce de agudos (3kHz a 6kHz)
  - Gain: Potenciación máxima de agudos (0dB a 15dB)
  - Q: Forma del realce de agudos (0.5 a 1.0)

### Visualización
- Gráfico en tiempo real de la respuesta del EQ
- Controles interactivos de parámetros
- Curva de corrección dependiente del volumen; el cambio uniforme de nivel de Relative Volume no aparece en el gráfico
- Lecturas numéricas precisas
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

## Narrow Range

Una herramienta que te permite enfocarte en partes específicas de la música filtrando frecuencias no deseadas. Útil para crear efectos sonoros especiales o eliminar sonidos no deseados.

### Guía de Mejora Auditiva
- Crea efectos sonoros únicos:
  - Efecto de "voz de teléfono"
  - Sonido de "radio antigua"
  - Efecto de "bajo el agua"
- Enfoca un rango de frecuencia:
  - Haz más fáciles de oír las partes con muchos graves
  - Enfoca el rango vocal
  - Estrecha el sonido al rango donde voces o instrumentos se notan más
- Elimina sonidos no deseados:
  - Reduce el retumbo de baja frecuencia
  - Elimina el siseo excesivo de alta frecuencia
  - Enfoca las partes más importantes de la música

### Parámetros
- **HPF Frequency** - Controla dónde comienzan a reducirse los sonidos bajos (20Hz a 4000Hz)
  - Valores más altos: Elimina más bajos
  - Valores más bajos: Conserva más bajos
  - Comienza con valores bajos y ajusta al gusto
- **HPF Slope** - Cuán rápidamente se reducen los sonidos bajos (0 a -48 dB/octava)
  - 0dB: Sin reducción (off)
  - -6dB a -48dB: Reducción progresivamente más fuerte en pasos de 6dB
- **LPF Frequency** - Controla dónde comienzan a reducirse los sonidos altos (200Hz a 40000Hz)
  - Valores más bajos: Elimina más agudos
  - Valores más altos: Conserva más agudos
  - Comienza con valores altos y ajusta hacia abajo según sea necesario
- **LPF Slope** - Cuán rápidamente se reducen los sonidos altos (0 a -48 dB/octava)
  - 0dB: Sin reducción (off)
  - -6dB a -48dB: Reducción progresivamente más fuerte en pasos de 6dB

### Visualización
- Gráfico claro que muestra la respuesta en frecuencia
- Controles de frecuencia fáciles de ajustar
- Selectores de pendiente sencillos
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

## Room EQ

Room EQ crea filtros de corrección FIR a partir de mediciones de respuesta en frecuencia guardadas por EffeTune. De forma predeterminada, diseña un único filtro compartido y lo aplica a todos los canales que pasan por el plugin; también puedes asignar una medición guardada distinta a canales concretos, mientras el resto de los ajustes de corrección siguen siendo comunes a toda la instancia. El filtro promedia todos los puntos de la medición elegida, suaviza la curva y reduce los picos y valles dentro del intervalo de frecuencias seleccionado. Úsalo cuando la interacción entre los altavoces y la sala provoque picos repetibles o un desequilibrio tonal amplio en tu posición de escucha. Además de la corrección de magnitud de fase mínima o de fase lineal, el modo **Correction** puede corregir el exceso de fase medido del sonido directo (**Phase Correction**) y de la reverberación de la sala (**Reverb Correction**). Room EQ necesita el motor DSP WASM; si no está disponible, la señal pasa sin cambios.

### Guía de mejora del sonido

- **Medición en varios puntos**: Mide el altavoz o grupo de canales desde varias posiciones cercanas del micrófono alrededor de tu asiento y selecciona esa medición guardada, para que la corrección no se ajuste en exceso a una única posición del micrófono.
- **Ajustes iniciales**: Empieza con **Phase: Minimum**, **Smoothing: 0.17 oct**, **Correction Low: 80 Hz**, **Correction High: 16000 Hz**, **Max Boost: 6 dB** y **Level Correction: 100%**. Activa y desactiva el efecto para comprobar que el balance tonal se vuelve más uniforme sin sonar delgado ni áspero.
- **No realzar en exceso los valles**: Si el filtro intenta rellenar cancelaciones acústicas estrechas, aumenta **Smoothing** o reduce **Max Boost** (con 0 dB se desactivan los realces automáticos y se mantienen los cortes de picos).
- **Graduar la intensidad de la corrección**: Reduce **Level Correction** si el 100% resulta demasiado intenso (al 50%, un realce de +6 dB pasa a +3 dB y un corte de −8 dB pasa a −4 dB).
- **Solo el intervalo fiable**: Mantén **Correction Low** y **Correction High** dentro del intervalo que el altavoz y el micrófono de medición reproducen con fiabilidad; corregir fuera de él hace que el resultado sea menos preciso.
- **Ajustar la curva objetivo**: Cuando los picos de la sala estén controlados, usa **Additional EQ** (integrado directamente en el filtro FIR) para ajustes tonales suaves a tu gusto, como un Low shelf amplio de +2 dB alrededor de 100 Hz.
- **Corrección del exceso de fase y de la reverberación**: Elige **Phase: Minimum** para la menor latencia o **Phase: Correction** para alinear también el exceso de fase. Empieza con **Reference Point: Consensus (all points)**, el valor predeterminado de **Direct Window** y **Phase Correction: 100%**. Activa **Low-frequency Phase Extension** solo si quieres corregir el exceso de fase por debajo de **Phase Low**, y desactívala si la temporización de los graves se vuelve menos uniforme entre posiciones de escucha. Sube **Reverb Correction** poco a poco con **Reverb Max Freq: 250 Hz** para contrarrestar la reverberación de baja frecuencia en toda la zona de escucha; al subir **Reverb Max Freq**, el resultado pasa a estar optimizado solo para la posición medida.
- **Retardo manual**: Room EQ no calcula la alineación por distancia de los altavoces. **Delay** se aplica a todos los canales de la instancia; usa instancias de Room EQ separadas si distintos grupos de canales necesitan retardos manuales diferentes.

> **Compartir mediciones entre dispositivos**: Los presets y las URL guardan el nombre y el identificador de la medición, no los datos acústicos. Para llevar una medición a otro dispositivo, activa **Incluir respuestas impulsionales al exportar mediciones en JSON** en la herramienta de medición antes de exportar (activado de forma predeterminada; puede aumentar el archivo en decenas de megabytes) y después importa el archivo JSON en el dispositivo de destino. Si falta la medición seleccionada, Room EQ muestra un aviso y deja pasar la señal sin corrección.

### Parámetros

- **Measurement**: Selecciona la medición guardada compartida (muestra el nombre, el número de puntos e `IR` cuando hay datos de respuesta al impulso). Haz clic en **Refresh measurements** después de añadir o editar mediciones.
- **Measurement ChN**: Asignación opcional de una medición propia para cada canal de bus enrutado. Déjala en **(Shared)** para usar la **Measurement** compartida.
- **Delay** (0 a 20 ms): Retardo manual aplicado a todos los canales enrutados; no se incluye en la latencia de procesamiento indicada.
- **Phase**: Selecciona el comportamiento de fase del FIR:
  - **Minimum**: Corrección de magnitud de fase mínima con la menor latencia.
  - **Linear**: Corrección de magnitud de fase lineal (añade `Taps / 2` muestras de retardo).
  - **Correction**: Corrección de magnitud de fase mínima más corrección del exceso de fase del sonido directo (**Phase Correction** dentro de **Direct Window**) y, opcionalmente, del decaimiento de la sala (**Reverb Correction** dentro de **Reverb Window**). Añade `Taps / 2` muestras de retardo y necesita datos de respuesta al impulso (`IR`). **Phase Smoothing**, **Phase Low**, **Low-frequency Phase Extension**, **Phase Correction**, los cuatro ajustes Reverb y **Reference Point** solo funcionan en este modo; en Minimum y Linear quedan desactivados y conservan sus valores.
- **Taps** (8192, 16384, 32768, 65536 o 131072): Longitud del filtro FIR. Los valores altos mejoran la resolución en graves a costa de memoria, tiempo de diseño y, en los modos Linear/Correction, retardo.
- **Latency** (0, 128, 256, 512 o 1024 muestras): Latencia de cabecera de la convolución. Los valores bajos reducen el retardo, pero aumentan la carga de procesamiento.
- **Smoothing** (0,02 a 1,00 oct): Suavizado gaussiano en frecuencia para la corrección de magnitud. Los valores altos dan una corrección más amplia y conservadora; los bajos siguen variaciones más finas de la respuesta.
- **Phase Smoothing** (0,02 a 1,00 oct, o **Auto**): Suavizado gaussiano para la corrección del exceso de fase del sonido directo en el modo Correction (sigue a **Smoothing** cuando **Auto** está marcado).
- **Correction Low / Correction High**: Límites inferior y superior de frecuencia de la corrección automática.
- **Direct Window** (1 a 50 ms): Ventana temporal tras el inicio del sonido que se analiza para la corrección de fase del sonido directo. Una ventana más larga baja el **Phase Low** automático, pero incluye más reflexiones de la sala.
- **Phase Low** (20 a 20000 Hz, o **Auto**): Límite inferior de frecuencia de la corrección de fase del sonido directo con ventana fija (de forma predeterminada, el mayor entre **Correction Low** y la frecuencia de la que caben tres ciclos en **Direct Window**; por ejemplo, 500 Hz con 6 ms). Con **Low-frequency Phase Extension** activada, marca en cambio dónde la ventana fija deja paso a las ventanas más largas de baja frecuencia.
- **Low-frequency Phase Extension** (desactivada de forma predeterminada): Extiende la corrección del exceso de fase por debajo de **Phase Low** hacia **Correction Low** mediante ventanas dependientes de la frecuencia que se alargan progresivamente.
- **Max Boost** (0 a 18 dB): Limita los realces de la corrección automática antes del suavizado, sin limitar los cortes ni los realces intencionados de **Additional EQ**.
- **Level Correction** (0% a 100%): Ajusta la corrección automática de magnitud de forma lineal en dB. Con 0% solo se detiene la corrección automática; **Phase Correction**, **Additional EQ**, **Delay** y **Gain** siguen activos.
- **Phase Correction** (0% a 100%): Ajusta la corrección del exceso de fase del sonido directo en el modo Correction, con independencia de **Reverb Correction**.
- **Reverb Correction** (0% a 100%; predeterminado 0%): Ajusta la corrección del exceso de fase de la reverberación posterior de la sala, analizada dentro de **Reverb Window** hasta **Reverb Max Freq**. No cambia la corrección de magnitud.
- **Reverb Window** (20 a 1000 ms): Ventana temporal tras el inicio del sonido que analiza **Reverb Correction**. Si no es más larga que **Direct Window** (o la medición es demasiado corta), la corrección de la reverberación se omite con un aviso y el resto del filtro sigue activo.
- **Reverb Max Freq** (20 a 20000 Hz; predeterminado 250 Hz): Límite superior de frecuencia de **Reverb Correction**, limitado por **Correction High** (mantenerlo alrededor de 250 Hz centra la corrección en el decaimiento de baja frecuencia de la sala, que se comporta de forma parecida en asientos cercanos).
- **Reverb Smoothing** (0,02 a 1,00 oct): Suavizado gaussiano aplicado al retardo de exceso de fase de la reverberación.
- **Reference Point**: Selecciona **Consensus (all points)** (promedio de los puntos de medición ponderado por su fiabilidad) o un único punto de medición para el análisis del exceso de fase. Si el punto seleccionado se elimina, vuelve a Consensus.
- **Additional EQ (integrado en el FIR)**: Cinco bandas paramétricas para ajustar la curva objetivo (Peak, Low shelf, High shelf; 20 Hz–20 kHz, ±20 dB, Q 0,1–10, hasta 2 en los shelves), integradas directamente en el filtro FIR. Su fase es cero en el modo Linear y de fase mínima en los modos Minimum y Correction.
- **Gain** (-12 a +12 dB): Ajuste del nivel de salida.

### Visualización

- **Graph**: Cambia entre **Frequency** (la medición suavizada en gris claro, la corrección automática en verde pálido, la corrección combinada con Additional EQ en verde brillante y la respuesta corregida estimada en blanco, que es una vista previa calculada y no una nueva medición), **Phase** (de −180° a +180° antes y después del FIR), **Min Group Delay**, **Excess Group Delay** e **Impulse** (forma de onda normalizada antes y después del FIR, desde 2 ms antes del inicio medido hasta el mayor de 5 ms, **Direct Window** y, cuando **Reverb Correction** supera el 0%, **Reverb Window**, con un máximo de 50 ms). En las vistas de fase, de retardo de grupo y de impulso, la línea gris **Before** es la respuesta antes de la corrección y la línea verde **After**, el resultado calculado tras el FIR. Dos líneas verticales blancas de puntos marcan **Correction Low** y **Correction High**.
- En la vista Frequency, las curvas gris y blanca se desplazan para que el nivel objetivo de la corrección automática completa (100%) quede en 0 dB; las desviaciones que quedan en la curva blanca se deben a límites como **Max Boost** o una **Level Correction** inferior al 100%, o a ajustes intencionados de **Additional EQ**.
- Las vistas de fase, de retardo de grupo y de impulso eliminan el inicio medido, y del resultado corregido se elimina el retardo fijo del FIR. El retardo de grupo no se vuelve a referenciar a 1 kHz, por lo que allí no tiene por qué ser 0 ms. **Min Group Delay** ajusta su rango automáticamente; **Excess Group Delay** se mantiene entre −100 y +100 ms, aunque la lectura muestra los valores que quedan fuera de ese rango. Sin datos de respuesta al impulso, estas vistas muestran un mensaje de datos no disponibles.
- **Graph Preview Ch**: Aparece cuando se han diseñado filtros para más de un canal; selecciona de qué canal se muestran las curvas y no afecta al audio.
- **Controles interactivos**: Arrastra los marcadores numerados en horizontal para cambiar la frecuencia de una banda de **Additional EQ** y en vertical para cambiar su ganancia (las bandas desactivadas aparecen atenuadas), y pasa el cursor o arrastra sobre el gráfico para leer los valores en cualquier punto.
- La línea de estado bajo los controles muestra la latencia total de procesamiento, la resolución del FIR y si el filtro está en bypass, staged, preparing, active o error.

## Tilt EQ

Inclina el balance de frecuencias general alrededor de una frecuencia pivote mediante un par emparejado de filtros shelving: un lado del espectro sube y el otro baja. Úsalo para ajustes amplios hacia un sonido más cálido o más brillante con un solo control, por ejemplo cuando una grabación o unos auriculares suenan siempre demasiado brillantes o demasiado apagados.

### Guía de mejora del sonido
- **Más cálido**: Usa un **Slope** negativo pequeño (por ejemplo, -1 dB/oct) para bajar los agudos y subir los graves, por ejemplo con grabaciones o auriculares brillantes.
- **Más brillante**: Usa un **Slope** positivo pequeño (por ejemplo, +1 dB/oct) para subir los agudos y bajar los graves, por ejemplo con grabaciones o altavoces apagados.
- **Dónde empieza el cambio**: Baja **Pivot Freq (Hz)** para extender el cambio del lado de los agudos hasta los medios; súbelo para limitarlo a las octavas más altas.

### Parámetros
- **Pivot Freq (Hz)** (20 Hz a ~20 kHz; predeterminado: aprox. 1 kHz): Frecuencia alrededor de la cual se inclina el balance.
- **Slope** (-12 a +12 dB/oct; predeterminado: 0): Cantidad y sentido de la inclinación. Los valores positivos hacen el sonido más brillante, los negativos más cálido, y 0 lo deja sin cambios.

### Visualización
- El gráfico muestra la respuesta en frecuencia resultante.
- **Reset** devuelve ambos parámetros a sus valores predeterminados.
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

## Tonal Balance EQ

Mide el balance tonal a largo plazo de lo que se está reproduciendo y lo acerca suavemente al balance espectral típico de la música publicada en el estilo elegido. Úsalo cuando las pistas de una lista de reproducción, un álbum o un streaming suenen de forma constante demasiado oscuras, demasiado brillantes, con graves retumbantes o delgadas, y quieras igualarlas automáticamente sin ajustar un EQ a mano para cada pista. (Corrige el balance de la grabación, no tus altavoces ni tu sala; para la corrección acústica usa [Room EQ](#room-eq)).

El plugin compara el espectro medido con el objetivo después de igualar la sonoridad global, atenúa las zonas demasiado fuertes y aplica una única ganancia de compensación para que las zonas más débiles ganen presencia sin cambiar la sonoridad percibida. Excluye de la medición los silencios y las pausas, y no realza el siseo ni las bandas estables parecidas al ruido (incluido un pad de sintetizador sostenido), de modo que los extremos de frecuencia vacíos no se realzan artificialmente. Todos los canales reciben la misma corrección sin latencia, lo que conserva la imagen estéreo.

### Guía de mejora del sonido
- **Listas variadas y streaming**: Empieza con los valores predeterminados (**Target: All**, **Amount: 100%**, **Averaging Time: 30 s**). La corrección se va formando durante decenas de segundos, a medida que la medición se vuelve fiable, así que deja sonar la música unos 30 segundos antes de compararla con el bypass.
- **Una corrección estable para un álbum**: Haz clic en **Reset** al empezar el álbum y pon **Averaging Time** en **∞**, para que la corrección promedie toda la sesión de reproducción y se asiente en una curva fija.
- **Objetivos por género**: Elige **Classical**, **Electronic**, **Pop** o **Rock** para ajustarte a un estilo concreto, o **All** si escuchas estilos variados.
- **Un ajuste más suave**: Baja **Amount** (por ejemplo, al 50%), reduce **Range** (por ejemplo, a 3 dB) o sube **Smoothing** (por ejemplo, a 1 oct) para inclinaciones amplias y sutiles.
- **Tu propia curva de la casa**: Usa las cinco bandas de **Target Adjust** bajo el gráfico para inclinar o dar forma al objetivo a tu gusto (por ejemplo, un High shelf de +1,5 dB a 8 kHz). Cada grabación se corrige entonces hacia tu objetivo personalizado solo en la medida necesaria.
- **Referencia de pendiente fija**: Selecciona **Target: Tilt** para una respuesta plana por debajo de **Corner** seguida de una caída constante según **Slope** (−5 dB/oct se aproxima a los masters comerciales típicos; −3 dB/oct corresponde al ruido rosa).

La ganancia de compensación mantiene la sonoridad, no el nivel de pico, por lo que los picos pueden subir; si se produce recorte en una etapa posterior, baja el nivel después de este plugin o añade un limitador.

### Parámetros
- **Target**: Balance tonal objetivo: **All** (predeterminado; mezcla a partes iguales de los cuatro estilos), **Classical**, **Electronic**, **Pop**, **Rock** o **Tilt** (referencia de pendiente fija).
- **Slope** (-18 a 0 dB/oct; predeterminado: -6 dB/oct; solo en modo Tilt): Velocidad de caída por encima de **Corner** (-3 dB/oct = ruido rosa; ~-5 dB/oct = publicaciones comerciales típicas). Los valores más suaves piden más agudos; el predeterminado pide un balance algo más oscuro que el de la música típica.
- **Corner** (20 a 1000 Hz; predeterminado: 250 Hz; solo en modo Tilt): Frecuencia por debajo de la cual el objetivo **Tilt** permanece plano. Los valores bajos piden más graves profundos; los altos, menos graves.
- **Amount** (0% a 100%; predeterminado: 100%): Intensidad global de la corrección. Con 0% el sonido no cambia, pero la medición y el gráfico siguen funcionando, y **Range**, **Smoothing**, **Low** y **High** se desactivan.
- **Range** (0 a 12 dB; predeterminado: 6 dB): Ajuste de ganancia máximo permitido en cualquier banda, hacia arriba o hacia abajo. Los valores bajos mantienen cambios sutiles (0 dB desactiva la corrección); los altos permiten acercar más al objetivo las grabaciones que se alejan mucho de él.
- **Smoothing** (0,1667 a 2 oct; predeterminado: 0,5 oct): Anchura de los detalles de la curva de corrección (los valores altos producen inclinaciones más amplias).
- **Averaging Time** (0,1 s a ∞; predeterminado: 30 s): Ventana de integración de la medición. Los valores cortos (por ejemplo, de 0,5 a 1 s) siguen los cambios dentro de una canción, como una estrofa oscura y un estribillo brillante; los largos dan una corrección estable (**∞** promedia de forma continua desde el último **Reset**).
- **Low** (20 a 200 Hz; predeterminado: 20 Hz) / **High** (2000 a 20000 Hz; predeterminado: 16000 Hz): Límites inferior y superior de frecuencia del remodelado activo (fuera de ellos, la corrección se mantiene constante). Sube **Low** para no tocar los graves más profundos, o baja **High** para no tocar la octava más aguda.
- **Average SPL** (60 a 96 dB; predeterminado: 83 dB): Nivel de escucha estimado que se usa para decidir qué bandas débiles son lo bastante audibles para realzarse; no cambia el nivel de salida. Con valores bajos, más bandas débiles se consideran inaudibles y no se realzan; con valores altos, se cuentan más como audibles.
- **Target Adjust**: Cinco bandas paramétricas (Peak, Low shelf, High shelf; 20 Hz–20 kHz, ±20 dB, Q 0,1–10, hasta 2 en los shelves; Q predeterminado 0,7) que remodelan la curva objetivo. Una ganancia positiva pide más de esa zona; una negativa, menos.

**Target Adjust** solo cambia el objetivo; cada grabación se sigue corrigiendo hacia él dentro de **Amount** y **Range**, por lo que un ajuste grande puede requerir un **Range** mayor. Subir todo el objetivo en la misma cantidad no cambia nada, porque los niveles globales se igualan antes de la comparación. Los picos y valles estrechos se suavizan; para correcciones estrechas usa 5Band PEQ.

### Visualización
- El eje horizontal es la frecuencia, de unos 26 Hz a 18,6 kHz, y el vertical, el nivel en dB por hercio, de modo que el ruido rosa aparece como una línea que desciende a -3 dB/oct. El rango vertical se amplía para abarcar las curvas y vuelve a ±12 dB con **Reset** o al cambiar **Target**. Las zonas por debajo de **Low** y por encima de **High** aparecen atenuadas.
- **Target** es el balance objetivo, incluido **Target Adjust**. En un estilo, la franja sombreada muestra la dispersión típica entre pistas, aprendida a partir de los espectros a largo plazo de una colección de música; **Tilt** no la tiene.
- **Measured** es la línea con puntos: el espectro a largo plazo medido, alineado con el objetivo. Donde queda por debajo de la franja del objetivo, la grabación es más débil de lo habitual en esa zona; donde queda por encima, más fuerte. La medición se pausa mientras previsualizas una frecuencia.
- **EQ response** es la línea gruesa: la ganancia aplicada, incluida la ganancia de compensación (0 dB = sin cambios).
- **Withheld lift** es el área sombreada que indica aproximadamente cuánto realce adicional recibiría una banda si no se retuviera por considerarse contenido parecido al ruido o no musical.
- **Target adjust** es la curva fina alrededor de 0 dB con marcadores numerados que muestran las bandas tal como las ajustas; los marcadores no están sobre la línea **Target**. Arrastra un marcador para cambiar la frecuencia y la ganancia, gira la rueda del ratón sobre él para cambiar Q y haz clic con el botón derecho para activar o desactivar la banda. Durante la reproducción, la línea **Target** sigue a los marcadores en un instante; con la reproducción detenida, conserva su última forma.
- Pasa el cursor o arrastra sobre el gráfico para consultar los valores de cada banda, **Presence** (% del tiempo en que se reconoce como contenido musical), **Make-up gain** y la **Loudness** integrada (LKFS). Antes de medir ningún audio, el gráfico muestra «Play audio to start measuring».
- **Reset** borra la medición acumulada; **Target Adjust** no cambia. La medición también se reinicia cuando el procesamiento se reanuda tras una pausa de ahorro de energía.
- **Copy as PEQ** copia la curva EQ response como ajustes de 5Band PEQ. Pulsa **Ctrl+V** en el Effect Pipeline para insertarla delante del efecto seleccionado (o al final) y después desactiva Tonal Balance EQ para dejar fija la corrección. La copia reproduce la forma de la curva entre **Low** y **High**, pero no su nivel general, así que la sonoridad puede variar ligeramente. Está disponible cuando el gráfico muestra una curva EQ response y **Amount** es mayor que 0%.

## Tone Control

Un ajustador de sonido de tres bandas sencillo para una personalización rápida y fácil del sonido. Perfecto para modelar el sonido de forma básica sin complicaciones técnicas.

### Guía de Mejora Musical
- Música Clásica:
  - Aumento leve de agudos para más detalle en las cuerdas
  - Aumento suave de bajos para un sonido orquestal más completo
  - Medios neutros para un sonido natural
- Música Rock/Pop:
  - Aumento moderado de bajos para mayor impacto
  - Reducción leve de medios para un sonido más claro
  - Aumento de agudos para platillos nítidos y más detalles
- Música Jazz:
  - Bajos cálidos para un sonido más completo
  - Medios claros para el detalle de los instrumentos
  - Agudos suaves para el brillo de los platillos
- Música Electrónica:
  - Bajos potentes para un impacto profundo
  - Medios reducidos para un sonido más limpio
  - Agudos realzados para detalles nítidos

### Parámetros
- **Bass** - Controla los sonidos graves (-24dB a +24dB)
  - Aumenta para obtener unos bajos más potentes
  - Disminuye para un sonido más ligero y limpio
  - Afecta el "peso" de la música
- **Mid** - Controla el cuerpo principal del sonido (-24dB a +24dB)
  - Aumenta para voces/instrumentos más destacados
  - Disminuye para un sonido más espacioso
  - Afecta la "plenitud" de la música
- **Treble** - Controla los sonidos agudos (-24dB a +24dB)
  - Aumenta para más brillo y detalle
  - Disminuye para un sonido más suave y delicado
  - Afecta el "brillo" de la música

### Visualización
- Gráfico fácil de leer que muestra tus ajustes
- Controles deslizantes simples para cada ajuste
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.
