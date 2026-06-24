---
title: "Plugins de EQ - EffeTune"
description: "Plugins de ecualización, incluidos Parametric EQ, Graphic EQ, Dynamic EQ, filtros y Tone Control."
lang: es
---

# Plugins de Ecualización

Una colección de plugins que te permiten ajustar diferentes aspectos del sonido de tu música, desde los graves profundos hasta los agudos nítidos. Estas herramientas te ayudan a personalizar tu experiencia auditiva al realzar o reducir elementos específicos del sonido.

## Lista de Plugins

- [15Band GEQ](#15band-geq) - Ajuste detallado del sonido con 15 controles precisos
- [15Band PEQ](#15band-peq) - Ecualizador paramétrico de 15 bandas para ajustes detallados del tono de escucha
- [5Band Dynamic EQ](#5band-dynamic-eq) - Ecualizador dinámico que responde a tu música
- [5Band PEQ](#5band-peq) - Ecualizador flexible de 5 bandas para moldear graves, medios y agudos
- [Band Pass Filter](#band-pass-filter) - Enfoca frecuencias específicas
- [Comb Filter](#comb-filter) - Añade una coloración faseada, hueca o metálica
- [Hi Pass Filter](#hi-pass-filter) - Elimina frecuencias bajas no deseadas con precisión
- [Lo Pass Filter](#lo-pass-filter) - Elimina frecuencias altas no deseadas con precisión
- [Loudness Equalizer](#loudness-equalizer) - Corrección del balance de frecuencias para escuchar a bajo volumen
- [Narrow Range](#narrow-range) - Enfoca partes específicas del sonido
- [Tilt EQ](#tilt-eq) - Ecualizador de inclinación para ajuste tonal simple
- [Tone Control](#tone-control) - Ajuste sencillo de bajos, medios y agudos

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
- **Bandas de Precisión**
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
- Cálculo en tiempo real de la función de transferencia
- Cuadrícula calibrada de frecuencia y ganancia
- Lecturas numéricas precisas para todos los parámetros

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
- **Bandas de Precisión**
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
- Cálculo en tiempo real de la función de transferencia
- Cuadrícula calibrada de frecuencia y ganancia
- Lecturas numéricas precisas para todos los parámetros

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

## Loudness Equalizer

Un ecualizador especializado que ajusta el balance de frecuencias según el valor Average SPL que configures. Úsalo para escuchar a bajo volumen, cuando graves y agudos pueden sentirse más débiles, y mantener la música equilibrada y agradable.

### Guía de Mejora Auditiva
- Escucha a Bajo Volumen:
  - Realza las frecuencias de bajos y agudos
  - Mantiene el balance musical en niveles bajos
  - Compensa las características de la audición humana
- Ajuste Average SPL:
  - Más realce con valores Average SPL más bajos
  - Reducción gradual del procesamiento a medida que sube el ajuste
  - Sonido natural a niveles de escucha más altos
- Balance de Frecuencias:
  - Estantería baja para el realce de bajos (100-300Hz)
  - Estantería alta para el realce de agudos (3-6kHz)
  - Transición suave entre rangos de frecuencia

### Parámetros
- **Average SPL** - Nivel medio estimado de escucha usado para la corrección (60dB a 85dB)
  - Valores más bajos: Mayor realce
  - Valores más altos: Menor realce
  - Ajusta este valor manualmente para que coincida con tu volumen típico de escucha
- **Controles de bajas frecuencias**
  - Frequency: Centro de realce de bajos (100Hz a 300Hz)
  - Gain: Potenciación máxima de bajos (0dB a 15dB)
  - Q: Forma del realce de bajos (0.5 a 1.0)
- **Controles de altas frecuencias**
  - Frequency: Centro de realce de agudos (3kHz a 6kHz)
  - Gain: Potenciación máxima de agudos (0dB a 15dB)
  - Q: Forma del realce de agudos (0.5 a 1.0)

### Visualización
- Gráfico en tiempo real de la respuesta en frecuencia
- Controles interactivos de parámetros
- Visualización de curva dependiente del volumen
- Lecturas numéricas precisas

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

## Tilt EQ

Un ecualizador simple pero efectivo que inclina suavemente el balance de frecuencia de tu música. Está diseñado para ajustes sutiles, haciendo que tu música suene más cálida o brillante sin controles complejos. Ideal para adaptar rápidamente el tono general a tu preferencia.

### Guía de Mejora Auditiva
- Haz la Música Más Cálida:
  - Utiliza valores de Slope negativos para reducir las frecuencias altas y aumentar las frecuencias bajas.
  - Perfecto para grabaciones brillantes o auriculares que suenan demasiado nítidos.
  - Crea una experiencia auditiva acogedora y relajada.
- Haz la Música Más Brillante:
  - Utiliza valores de Slope positivos para aumentar las frecuencias altas y reducir las frecuencias bajas.
  - Ideal para grabaciones opacas o altavoces que suenan apagados.
  - Añade claridad y brillo a tu música.
- Ajustes Sutiles de Tono:
  - Utiliza valores pequeños de Slope para dar forma suave al tono general.
  - Ajusta con precisión el balance para que coincida con tu entorno auditivo o estado de ánimo.

### Parámetros
- **Pivot Frequency** - Controla la frecuencia central de la inclinación (20Hz a ~20kHz)
  - Ajusta para establecer el punto de frecuencia alrededor del cual se produce la inclinación.
- **Slope** - Controla la inclinación de la pendiente alrededor de la Frecuencia Pivote (-12 a +12dB/octava)
  - Los valores positivos hacen el sonido más brillante; los valores negativos lo hacen más cálido.
  - Los valores más pequeños producen cambios más suaves.

### Visualización
- Deslizador simple para ajustar fácilmente la pendiente
- Curva de respuesta de frecuencia en tiempo real para mostrar el efecto de inclinación
- Indicación clara del valor de pendiente actual
- Botón de reinicio rápido
