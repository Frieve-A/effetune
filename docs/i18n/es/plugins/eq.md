---
title: "EQ Plugins - EffeTune"
description: "Equalizer plugins including Parametric EQ, Graphic EQ, Dynamic EQ, Filters, and Tone Control."
lang: en
---

# Plugins de Ecualización

Una colección de plugins que te permiten ajustar diferentes aspectos del sonido de tu música, desde los graves profundos hasta los agudos nítidos. Estas herramientas te ayudan a personalizar tu experiencia auditiva al realzar o reducir elementos específicos del sonido.

## Lista de Plugins

- [15Band GEQ](#15band-geq) - Ajuste detallado del sonido con 15 controles precisos
- [15Band PEQ](#15band-peq) - Ecualizador paramétrico profesional con 15 bandas y máxima flexibilidad
- [5Band Dynamic EQ](#5band-dynamic-eq) - Ecualizador dinámico que responde a tu música
- [5Band PEQ](#5band-peq) - Ecualizador paramétrico profesional con controles flexibles
- [Band Pass Filter](#band-pass-filter) - Enfoca frecuencias específicas
- [Comb Filter](#comb-filter) - Filtro peine digital para coloración armónica y simulación de resonancia
- [Hi Pass Filter](#hi-pass-filter) - Elimina frecuencias bajas no deseadas con precisión
- [Lo Pass Filter](#lo-pass-filter) - Elimina frecuencias altas no deseadas con precisión
- [Loudness Equalizer](#loudness-equalizer) - Corrección del balance de frecuencias para escuchar a bajo volumen
- [Narrow Range](#narrow-range) - Enfoca partes específicas del sonido
- [Tilt EQ](#tilt-eq) - Ecualizador de inclinación para ajuste tonal simple
- [Tone Control](#tone-control) - Ajuste sencillo de bajos, mid y treble

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

Un ecualizador paramétrico de grado profesional con un amplio control de 15 bandas, ofreciendo ajustes de frecuencia precisos. Perfecto tanto para un refinamiento sutil del sonido como para un procesamiento de audio correctivo con máxima flexibilidad.

### Guía de Mejora del Sonido
- Claridad de Voces e Instrumentos:
  - Utiliza la banda de 3.2kHz con un Q moderado (1.0-2.0) para una presencia natural
  - Aplica cortes con Q estrecho (4.0-8.0) para eliminar resonancias
  - Añade un leve toque de aire con la estantería alta de 10kHz (+2 a +4dB)
- Control de la Calidad de los Bajos:
  - Moldea los fundamentos con un filtro peaking de 100Hz
  - Elimina la resonancia de la sala utilizando un Q estrecho en frecuencias específicas
  - Crea una extensión suave de los bajos con una estantería baja
- Ajuste Científico del Sonido:
  - Apunta a frecuencias específicas con precisión
  - Utiliza analizadores para identificar áreas problemáticas
  - Aplica correcciones medibles con un impacto mínimo en la fase

### Parámetros Técnicos
- **Bandas de Precisión**
  - 15 bandas de frecuencia completamente configurables
  - Configuración inicial de frecuencias:
    - 25Hz, 40Hz, 63Hz, 100Hz, 160Hz (Bajos profundos)
    - 250Hz, 400Hz, 630Hz (Sonidos bajos)
    - 1kHz, 1.6kHz, 2.5kHz (Sonidos medios)
    - 4kHz, 6.3kHz, 10kHz, 16kHz (Sonidos altos)
- **Controles Profesionales por Banda**
  - Center Frequency: Espaciada logarítmicamente para una cobertura óptima
  - Gain Range: Ajuste preciso de ±20dB
  - Q Factor: De 0.1 (amplio) a 10.0 (preciso)
  - Múltiples Tipos de Filtro:
    - Peaking: Ajuste simétrico de frecuencia
    - Low/High Pass: Pendiente de 12dB/octave
    - Low/High Shelf: Modelado espectral suave
    - Band Pass: Aislamiento enfocado de frecuencias
    - Notch: Eliminación precisa de frecuencia
    - AllPass: Alineación de frecuencia centrada en fase
- **Gestión de Presets**
  - Importar: Carga ajustes de EQ desde archivos de texto en formato estándar
    - Formato de ejemplo:
      ```
      Preamp: -6.0 dB
      Filter 1: ON PK Fc 50 Hz Gain -3.0 dB Q 2.00
      Filter 2: ON HS Fc 12000 Hz Gain 4.0 dB Q 0.70
      ...
      ```

### Visualización Técnica
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
  - Utiliza un realce de frecuencias altas estilo BBE (Filter Type: Highshelf, SC Freq: 1200Hz, Ratio: 0.5, Attack: 1ms)
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
  - Ratio: Controla la intensidad del procesamiento (0.1-10.0)
    - Por debajo de 1.0: Expander (realza cuando la señal supera el threshold)
    - Por encima de 1.0: Compressor (reduce cuando la señal supera el threshold)
  - Knee Width: Transición suave alrededor del threshold (0-30dB)
  - Attack: Rapidez con que comienza el procesamiento (0.1-100ms)
  - Release: Rapidez con que finaliza el procesamiento (1-1000ms)
  - Sidechain Frequency: Frecuencia de detección (20Hz-20kHz)
  - Sidechain Q: Ancho de banda de detección (0.1-10.0)

### Visualización
- Gráfico de respuesta de frecuencia en tiempo real
- Indicadores de reducción de ganancia por banda
- Controles interactivos de frecuencia y ganancia

## 5Band PEQ

Un ecualizador paramétrico de grado profesional basado en principios científicos, que ofrece cinco bandas completamente configurables con un control de frecuencia preciso. Perfecto tanto para un refinamiento sutil del sonido como para un procesamiento de audio correctivo.

### Guía de Mejora del Sonido
- Claridad de Voces e Instrumentos:
  - Utiliza la banda de 3.2kHz con un Q moderado (1.0-2.0) para una presencia natural
  - Aplica cortes con Q estrecho (4.0-8.0) para eliminar resonancias
  - Añade un leve toque de aire con la estantería alta de 10kHz (+2 a +4dB)
- Control de la Calidad de los Bajos:
  - Moldea los fundamentos con un filtro peaking de 100Hz
  - Elimina la resonancia de la sala utilizando un Q estrecho en frecuencias específicas
  - Crea una extensión suave de los bajos con una estantería baja
- Ajuste Científico del Sonido:
  - Apunta a frecuencias específicas con precisión
  - Utiliza analizadores para identificar áreas problemáticas
  - Aplica correcciones medibles con un impacto mínimo en la fase

### Parámetros Técnicos
- **Bandas de Precisión**
  - Band 1: 100Hz (Control de Sub & Bass)
  - Band 2: 316Hz (Definición de Medios Bajos)
  - Band 3: 1.0kHz (Presencia de Medios)
  - Band 4: 3.2kHz (Detalle de Medios Altos)
  - Band 5: 10kHz (Extensión de Altas Frecuencias)
- **Controles Profesionales por Banda**
  - Center Frequency: Espaciada logarítmicamente para una cobertura óptima
  - Gain Range: Ajuste preciso de ±20dB
  - Q Factor: De 0.1 (amplio) a 10.0 (preciso)
  - Múltiples Tipos de Filtro:
    - Peaking: Ajuste simétrico de frecuencia
    - Low/High Pass: Pendiente de 12dB/octave
    - Low/High Shelf: Modelado espectral suave
    - Band Pass: Aislamiento enfocado de frecuencias
    - Notch: Eliminación precisa de frecuencia
    - AllPass: Alineación de frecuencia centrada en fase

### Visualización Técnica
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
  - Ayuda a que las voces destaquen en mezclas complejas
- Crea Efectos Especiales:
  - Establece rangos de frecuencia estrechos para efectos de teléfono, radio o megáfono
  - Usa pendientes más pronunciadas (-36dB/oct o más) para un filtrado más dramático
  - Experimenta con diferentes rangos de frecuencia para sonidos creativos
- Limpia Rangos de Frecuencia Específicos:
  - Apunta a frecuencias problemáticas con control preciso
  - Usa diferentes pendientes para las secciones de paso alto y paso bajo según sea necesario
  - Perfecto para eliminar simultáneamente ruido de baja frecuencia y ruido de alta frecuencia

### Parámetros
- **HPF Frequency (Hz)** - Controla dónde se filtran las frecuencias bajas (1Hz a 40000Hz)
  - Valores más bajos: Solo se eliminan las frecuencias más bajas
  - Valores más altos: Se eliminan más frecuencias bajas
  - Ajusta según el contenido específico de baja frecuencia que deseas eliminar
- **HPF Slope** - Controla cuán agresivamente se reducen las frecuencias por debajo del corte
  - Off: No se aplica filtrado
  - -12dB/oct: Filtrado suave (LR2 - Linkwitz-Riley de 2º orden)
  - -24dB/oct: Filtrado estándar (LR4 - Linkwitz-Riley de 4º orden)
  - -36dB/oct: Filtrado más fuerte (LR6 - Linkwitz-Riley de 6º orden)
  - -48dB/oct: Filtrado muy fuerte (LR8 - Linkwitz-Riley de 8º orden)
- **LPF Frequency (Hz)** - Controla dónde se filtran las frecuencias altas (1Hz a 40000Hz)
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

Un filtro peine digital que crea efectos de coloración armónica y resonancia a través de retardos de tiempo precisos. Este plugin simula fenómenos acústicos como las reflexiones tempranas de paredes y superficies, siendo perfecto para entusiastas del audio que quieren entender y recrear las complejas interacciones entre el sonido y el espacio.

### Guía de Mejora Auditiva
- Simula la Acústica de la Habitación:
  - Usa frecuencias fundamentales entre 100-500Hz para simular reflexiones de paredes
  - Ajusta la ganancia de retroalimentación para controlar la intensidad de la reflexión
  - Perfecto para entender cómo las dimensiones de la habitación afectan el sonido
- Crea Coloración Armónica:
  - Usa el modo de alimentación directa para realce armónico sutil
  - Usa el modo de retroalimentación para efectos de resonancia más pronunciados
  - Experimenta con diferentes frecuencias fundamentales para un carácter tonal único
- Simulación de Reflexiones Tempranas:
  - Establece la frecuencia fundamental basada en las dimensiones de la habitación (ej., 343Hz para 1 metro de distancia)
  - Usa ganancia de retroalimentación moderada (0.3-0.7) para simulación realista de reflexiones
  - Ayuda a recrear las características acústicas de diferentes espacios de escucha
- Efectos de Resonancia y Eco:
  - Valores más altos de ganancia de retroalimentación crean resonancia más pronunciada
  - Frecuencias fundamentales más bajas crean tiempos de retardo más largos
  - Combina con otros efectos para procesamiento espacial complejo

### Parámetros
- **Frecuencia Fundamental (Hz)** - Controla el tiempo de retardo y el espaciado armónico (20Hz a 20000Hz)
  - Valores más bajos: Retardos más largos, armónicos más espaciados
  - Valores más altos: Retardos más cortos, armónicos más cercanos
  - Basado en acústica de habitación: Frecuencia = Velocidad del Sonido / Distancia
- **Ganancia de Retroalimentación** - Controla la intensidad del efecto del filtro peine (-1.0 a 1.0)
  - Valores negativos: Crea patrones armónicos inversos
  - Valores positivos: Crea patrones armónicos de refuerzo
  - Cero: Sin efecto (solo señal seca)
  - Valores absolutos más altos: Efecto más pronunciado
- **Tipo de Peine** - Controla la estructura del filtro
  - Alimentación Directa: Crea realce armónico sin retroalimentación
  - Retroalimentación: Crea efectos de resonancia y eco
- **Mezcla Seco/Húmedo** - Controla el balance entre la señal procesada y la original (0% a 100%)
  - 0%: Solo señal original
  - 50%: Mezcla igual de señal original y procesada
  - 100%: Solo señal procesada

### Detalles Técnicos
- **Cálculo de Retardo**: Tiempo de retardo = 1 / Frecuencia Fundamental
- **Respuesta Armónica**: Crea picos y valles en múltiplos enteros de la frecuencia fundamental
- **Simulación Espacial**: Puede simular reflexiones tempranas de paredes y superficies
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
  - Establece la frecuencia entre 200-500Hz para un efecto de voz similar al de un teléfono
  - Utiliza pendientes pronunciadas (-48dB/oct o mayores) para un filtrado dramático
  - Combina con Lo Pass Filter para efectos de paso de banda

### Parámetros
- **Frequency (Hz)** - Controla dónde se filtran las frecuencias bajas (1Hz a 40000Hz)
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
  - Establece la frecuencia entre 1-3kHz para un efecto de radio vintage
  - Utiliza pendientes pronunciadas (-48dB/oct o mayores) para un filtrado dramático
  - Combina con Hi Pass Filter para efectos de paso de banda
- Controla el ruido y el siseo:
  - Establece la frecuencia justo por encima del contenido musical (típicamente 14-18kHz)
  - Utiliza pendientes más pronunciadas (-36dB/oct o mayores) para un control efectivo del ruido
  - Reduce el siseo de la cinta o el ruido de fondo mientras preserva la mayor parte del contenido musical

### Parámetros
- **Frequency (Hz)** - Controla dónde se filtran las frecuencias altas (1Hz a 40000Hz)
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

Un ecualizador especializado que ajusta automáticamente el balance de frecuencias basado en tu volumen de escucha. Este plugin compensa la sensibilidad reducida del oído humano a las frecuencias bajas y altas a volúmenes bajos, garantizando una experiencia auditiva consistente y agradable sin importar el nivel de reproducción.

### Guía de Mejora Auditiva
- Escucha a Bajo Volumen:
  - Realza las frecuencias de bajos y agudos
  - Mantiene el balance musical en niveles bajos
  - Compensa las características de la audición humana
- Procesamiento Dependiente del Volumen:
  - Mayor realce a volúmenes bajos
  - Reducción gradual del procesamiento a medida que aumenta el volumen
  - Sonido natural a niveles de escucha más altos
- Balance de Frecuencias:
  - Estantería baja para el realce de bajos (100-300Hz)
  - Estantería alta para el realce de agudos (3-6kHz)
  - Transición suave entre rangos de frecuencia

### Parámetros
- **Average SPL** - Nivel actual de escucha (60dB a 85dB)
  - Valores más bajos: Mayor realce
  - Valores más altos: Menor realce
  - Representa el volumen típico de escucha
- **Low Frequency Controls**
  - Frequency: Centro de realce de bajos (100Hz a 300Hz)
  - Gain: Potenciación máxima de bajos (0dB a 15dB)
  - Q: Forma del realce de bajos (0.5 a 1.0)
- **High Frequency Controls**
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
- Enfoca instrumentos específicos:
  - Aísla las frecuencias de bajos
  - Enfoca el rango vocal
  - Resalta instrumentos específicos
- Elimina sonidos no deseados:
  - Reduce el retumbo de baja frecuencia
  - Elimina el siseo excesivo de alta frecuencia
  - Enfoca las partes más importantes de la música

### Parámetros
- **HPF Frequency** - Controla dónde comienzan a reducirse los sonidos bajos (20Hz a 1000Hz)
  - Valores más altos: Elimina más bajos
  - Valores más bajos: Conserva más bajos
  - Comienza con valores bajos y ajusta al gusto
- **HPF Slope** - Cuán rápidamente se reducen los sonidos bajos (0 a -48 dB/octava)
  - 0dB: Sin reducción (off)
  - -6dB a -48dB: Reducción progresivamente más fuerte en pasos de 6dB
- **LPF Frequency** - Controla dónde comienzan a reducirse los sonidos altos (200Hz a 20000Hz)
  - Valores más bajos: Elimina más agudos
  - Valores más altos: Conserva más agudos
  - Comienza con valores altos y ajusta hacia abajo según sea necesario
- **LPF Slope** - Cuán rápidamente se reducen los sonidos altos (0 a -48 dB/octava)
  - 0dB: Sin reducción (off)
  - -6dB a -48dB: Reducción progresivamente más fuerte en pasos de 6dB

### Visualización
- Gráfico claro que muestra la respuesta en frecuencia
- Controles de frecuencia fáciles de ajustar
- Botones de selección de pendiente simples

## Tilt EQ

Un ecualizador simple pero efectivo que inclina suavemente el balance de frecuencia de tu música. Está diseñado para ajustes sutiles, haciendo que tu música suene más cálida o brillante sin controles complejos. Ideal para adaptar rápidamente el tono general a tu preferencia.

### Guía de Mejora Auditiva
- Haz la Música Más Cálida:
  - Utiliza valores de ganancia negativos para reducir las frecuencias altas y aumentar las frecuencias bajas.
  - Perfecto para grabaciones brillantes o auriculares que suenan demasiado nítidos.
  - Crea una experiencia auditiva acogedora y relajada.
- Haz la Música Más Brillante:
  - Utiliza valores de ganancia positivos para aumentar las frecuencias altas y reducir las frecuencias bajas.
  - Ideal para grabaciones opacas o altavoces que suenan apagados.
  - Añade claridad y brillo a tu música.
- Ajustes Sutiles de Tono:
  - Utiliza pequeños valores de ganancia para dar forma suave al tono general.
  - Ajusta con precisión el balance para que coincida con tu entorno auditivo o estado de ánimo.

### Parámetros
- **Pivot Frequency** - Controla la frecuencia central de la inclinación (20Hz a ~20kHz)
  - Ajusta para establecer el punto de frecuencia alrededor del cual se produce la inclinación.
- **Slope** - Controla la inclinación de la pendiente alrededor de la Frecuencia Pivote (-12 a +12dB/octava)
  - Ajusta para controlar cuán inclinadas están las frecuencias alrededor de la Frecuencia Pivote.

### Visualización
- Deslizador simple para un fácil ajuste de ganancia
- Curva de respuesta de frecuencia en tiempo real para mostrar el efecto de inclinación
- Indicación clara del valor de ganancia actual

- Botón de reinicio rápido

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
- **Bass** - Controls the low sounds (-24dB to +24dB)
  - Aumenta para obtener unos bajos más potentes
  - Disminuye para un sonido más ligero y limpio
  - Afecta el "peso" de la música
- **Mid** - Controls the main body of sound (-24dB to +24dB)
  - Aumenta para voces/instrumentos más destacados
  - Disminuye para un sonido más espacioso
  - Afecta la "plenitud" de la música
- **Treble** - Controls the high sounds (-24dB to +24dB)
  - Aumenta para más brillo y detalle
  - Disminuye para un sonido más suave y delicado
  - Afecta el "brillo" de la música

### Visualización
- Gráfico fácil de leer que muestra tus ajustes
- Controles deslizantes simples para cada ajuste
- Botón de reinicio rápido
