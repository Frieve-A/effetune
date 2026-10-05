---
title: "Plugins resonadores - EffeTune"
description: "Plugins resonadores: Adaptive Prediction, Horn Resonator y Modal Resonator."
lang: es
---

# Plugins resonadores

Una colección de plugins que añaden carácter resonante a la música, desde simulaciones de objetos y altavoces hasta resonancias que evolucionan a partir del propio audio.

## Lista de Plugins

- [Adaptive Prediction](#adaptive-prediction) - Aprende a predecir el audio para extraer el residuo o crear resonancias que evolucionan
- [Horn Resonator](#horn-resonator) - Simula la resonancia de sistemas de altavoces horn
- [Horn Resonator Plus](#horn-resonator-plus) - Resonancia de altavoz horn más suave para añadir color natural a la escucha
- [Modal Resonator](#modal-resonator) - Efecto de resonancia de frecuencia con hasta 5 resonadores

## Adaptive Prediction

Adaptive Prediction aprende a predecir la forma de onda entrante a partir del audio anterior. Úsalo para reducir componentes previsibles, escuchar la predicción o realimentarla para crear una resonancia que desarrolla su propio sonido. Los canales izquierdo y derecho aprenden por separado.

**Residual** es el sonido original menos la predicción. Al aprender, los tonos repetidos pueden disminuir en el residuo y dejar más presentes los cambios y detalles imprevisibles. Por encima de 0, **Autonomy** hace que la predicción también siga el sonido generado. En 1, la generación se desconecta de la entrada externa; el aprendizaje sigue usando esa entrada salvo que se congele.

### Guía de escucha y presets del sistema

Abre **Preajustes de efecto** en la cabecera del efecto. Cambiar de preset conserva lo que el efecto en ejecución ya ha aprendido.

| Preset | Gap | Autonomy | Original / Residual / Prediction | Uso inicial |
| --- | --- | --- | --- | --- |
| **Surprise** (predeterminado) | 1 ms | 0 | 0 / 1 / 0 | Destaca detalles cambiantes al reducir tonos previsibles. |
| **Prediction** | 5 ms | 0 | 0 / 0 / 1 | Sustituye el original por la predicción. Deja sonar una entrada audible durante unos segundos. |
| **Resonator** | 10 ms | 0.98 | 0.6 / 0 / 0.6 | Mezcla el original con una resonancia cambiante influida por la música. |
| **Hold** | 10 ms | 1 | 0 / 0 / 1 | Congela el aprendizaje y genera sonido autónomo con el modelo aprendido. |

Compara **Surprise** y **Prediction** con un tono sostenido o un pasaje repetitivo. Para generar sonido autónomo, deja aprender a Prediction y después elige **Hold** o activa su casilla. Hold fija las reglas aprendidas: la altura, el timbre y el nivel pueden seguir cambiando o desvanecerse. No mantiene una nota ni repite una grabación. Un efecto sin entrenar o recién reiniciado no puede empezar a generar sonido desde el silencio.

### Parámetros

- **Gap (ms)** — Excluye los últimos 0–500 ms de la información de onda usada para predecir (inicial: 1 ms). Al aumentarlo, predice desde un pasado más lejano y puede cambiar el timbre o perder precisión. Incluso en 0 usa muestras anteriores. No es latencia de salida ni duración de una ventana de grabación. Conserva el modelo al cambiar y lo readapta a la nueva distancia.
- **Learn** — Velocidad de adaptación a la entrada, de 0 a 0.1 (inicial: 0.02). Un valor mayor aprende más rápido; uno menor cambia más despacio. En 0 se detienen las correcciones por error, pero un Weight Decay finito aún puede reducir los coeficientes.
- **Weight Decay (s)** — Tiempo de decaimiento de los coeficientes mientras el aprendizaje está activo, de 0.5 a 60 segundos. Los tiempos cortos debilitan antes lo aprendido; los largos lo conservan más. No es la duración del historial de audio.
- **Infinity** — Desactiva Weight Decay (activado inicialmente). Desmárcalo para usar el tiempo de Weight Decay.
- **Autonomy** — Mezcla predicción de la entrada y generación realimentada, de 0 a 1 (inicial: 0). Al aumentarlo, el sonido generado influye más sobre sí mismo. En 1 solo entra su propia realimentación en la vía de generación. Los niveles de mezcla de salida no cambian esa realimentación.
- **Original / Residual / Prediction** — Ganancias independientes de −2 a +2, inicialmente 0 / 1 / 0. Cero silencia, los valores positivos suman y los negativos invierten la polaridad. Una magnitud mayor de 1 aumenta el nivel. La mezcla no se normaliza automáticamente. Como Residual = Original − Prediction, 0 / 1 / 1 reconstruye el original antes de limitar los picos de salida.
- **Freeze** — Detiene el aprendizaje y Weight Decay, pero continúa el procesamiento y la generación. Desactívalo para volver a aprender.
- **Hold** — Aplica Freeze y Autonomy 1 juntos. Sus controles quedan deshabilitados mientras está activo; al desactivarlo se recuperan los ajustes individuales.
- **Reset** — Borra los coeficientes aprendidos, los estados y el historial de audio. Conserva los controles. La predicción comienza en silencio y necesita aprender de nuevo.

El aprendizaje y Weight Decay se pausan si la entrada externa cae por debajo de −60 dBFS, para que el silencio no borre el modelo. El sonido generado no interviene en esta decisión. Los coeficientes y el sonido en curso son temporales y no se guardan en presets; al crear de nuevo el efecto hay que volver a entrenarlo. Mientras está activo, Adaptive Prediction sigue procesando durante el silencio para conservar el sonido aprendido. Omite el efecto cuando ya no lo necesites.

### Si el resultado no es el esperado

- Si Prediction o Hold está en silencio, desactiva Hold y Freeze, usa Learn mayor de 0 y reproduce una entrada audible. Empieza con Autonomy 0.
- Si la resonancia es demasiado intensa, reduce Prediction o Autonomy. El limitador controla los picos de muestra, pero una mezcla alta puede cambiar el timbre.
- Si se informa de un problema de procesamiento, pulsa Reset y reproduce audio para aprender de nuevo.
- Adaptive Prediction admite mono o estéreo. Activa **Usar el procesamiento de audio WebAssembly** en **Configuración de audio**. Selecciona un canal o un par estéreo en el enrutamiento del efecto. Los formatos no compatibles hacen que el efecto se omita.

## Horn Resonator

Un complemento que simula la resonancia de un horn-loaded speaker utilizando un modelo de guía de onda digital. Añade un carácter cálido y natural de horn speaker al modelar reflexiones de onda en la garganta y la boca, permitiéndote moldear el sonido con controles sencillos.

### Guía de Escucha

- Realce de medios cálido: acentúa voces e instrumentos acústicos sin dureza.
- Ambiente natural de altavoz horn: añade coloración de altavoz vintage para una escucha más rica.
- Amortiguación suave de altas frecuencias: previene picos agudos para un tono relajado.

### Presets del sistema

Haz clic en **Preajustes de efecto** en el encabezado del efecto para comenzar con un carácter de bocina completo.

- **Gramophone** - Bocina muy abierta con color de gramófono acústico antiguo.
- **Vintage Theater** - Respuesta de una gran bocina de teatro que llega a frecuencias bajas.
- **Megaphone** - Bocina cónica corta con medios directos y enfáticos.

### Parámetros

- **Crossover (Hz)** - Establece la división de frecuencia entre la ruta de baja frecuencia (retrasada) y la ruta de alta frecuencia procesada por el modelo horn. (20–5000 Hz)
- **Horn Length (cm)** - Ajusta la longitud del horn simulado. Los horns más largos desplazan las resonancias hacia frecuencias más bajas y las acercan entre sí; los horns más cortos las desplazan hacia frecuencias más altas y las separan más para un sonido más compacto. (20–120 cm)
- **Throat Diameter (cm)** - Controla el tamaño de apertura en la garganta del horn (entrada). Los valores más pequeños tienden a aumentar el brillo y el énfasis en los medios altos, los valores más grandes añaden calidez. (0.5–50 cm)
- **Mouth Diameter (cm)** - Controla el tamaño de apertura en la boca del horn (salida). Esto afecta a la adaptación de impedancia con el aire circundante e influye en la reflexión dependiente de la frecuencia en la boca. Los valores más grandes generalmente amplían el sonido percibido y reducen la reflexión de baja frecuencia, los valores más pequeños lo focalizan y aumentan la reflexión de baja frecuencia. (5–200 cm)
- **Curve (%)** - Ajusta la forma de expansión del horn (cómo aumenta el radio desde la garganta hasta la boca).
    - `0 %`: Crea un horn cónico (el radio aumenta linealmente con la distancia).
    - Valores positivos (`> 0 %`): Crea expansiones que se amplían más rápidamente hacia la boca (p. ej., exponencial). Los valores más altos significan una expansión más lenta cerca de la garganta y una expansión muy rápida cerca de la boca.
    - Valores negativos (`< 0 %`): Crea expansiones que se amplían muy rápidamente cerca de la garganta y luego más lentamente hacia la boca (p. ej., parabólica o similar a tractrix). Los valores más negativos significan una expansión inicial más rápida.
    (-100–100 %)
- **Damping (dB/m)** - Establece la atenuación interna (absorción de sonido) por metro dentro de la guía de onda del horn. Los valores más altos reducen los picos de resonancia y crean un sonido más suave y amortiguado. (0–10 dB/m)
- **Throat Reflection** - Ajusta el coeficiente de reflexión en la garganta del horn (entrada). Los valores más altos aumentan la cantidad de sonido reflejado de vuelta al horn desde el límite de la garganta, lo que puede iluminar la respuesta y enfatizar ciertas resonancias. (0–0.99)
- **Output Gain (dB)** - Controla el nivel de salida general de la ruta de señal procesada (alta frecuencia) antes de mezclarse con la ruta de baja frecuencia retrasada. Úsalo para igualar o aumentar el nivel del efecto. (-36–36 dB)

### Inicio Rápido

1. Establece **Crossover** para definir el rango de frecuencia enviado al modelo horn (p. ej., 800–2000 Hz). Las frecuencias por debajo de esto se retrasan y se mezclan de nuevo.
2. Comienza con una **Horn Length** de alrededor de 60-70 cm para un carácter típico de rango medio.
3. Ajusta **Throat Diameter** y **Mouth Diameter** para dar forma al tono central (brillo vs. calidez, enfoque vs. amplitud).
4. Utiliza **Curve** para afinar el carácter resonante (prueba 0% para cónico, positivo para tipo exponencial, negativo para expansión tipo tractrix).
5. Ajusta **Damping** y **Throat Reflection** para suavidad o énfasis de las resonancias del horn.
6. Utiliza **Output Gain** para equilibrar el nivel del sonido del horn contra las frecuencias bajas derivadas.

## Horn Resonator Plus

Horn Resonator Plus añade a la música un carácter de altavoz horn más suave y natural. Úsalo cuando quieras que voces, metales, instrumentos acústicos o mezclas completas se sientan más cálidos y vivos, manteniendo una resonancia menos marcada que con el Horn Resonator estándar.

Se basa en el mismo modelo horn que [Horn Resonator](#horn-resonator), con un modelo más detallado de reflexión en la boca y la garganta para que las resonancias decaigan con mayor suavidad.

### Guía de Escucha

- Color horn más suave: añade carácter de altavoz horn con menos repique agudo.
- Presencia más cálida: puede hacer que voces, metales y música acústica se sientan más vivos.
- Comportamiento natural en altas frecuencias: el rango alto se acerca más al de un horn acústico o un altavoz horn que la versión estándar.

### Presets del sistema

Haz clic en **Preajustes de efecto** en el encabezado del efecto para probar los mismos tres caracteres de bocina con el modelo Plus más suave.

- **Gramophone** - Bocina muy abierta con color de gramófono acústico antiguo.
- **Vintage Theater** - Respuesta de una gran bocina de teatro que llega a frecuencias bajas.
- **Megaphone** - Bocina cónica corta con medios directos y enfáticos.

### Mejoras Técnicas

- **Filtro de reflexión de boca de 2º orden**: Modelado más suave de la reflexión dependiente de la frecuencia en la abertura de la boca.
- **Reflexión de garganta dependiente de la frecuencia**: La reflexión de garganta cambia con la frecuencia para un comportamiento horn más natural.

### Parámetros y Uso

Horn Resonator Plus utiliza los mismos parámetros que [Horn Resonator](#horn-resonator). Por favor consulta la sección Horn Resonator para descripciones de parámetros, configuraciones y valores recomendados.

### Pautas de Uso

- **Horn Resonator**: Elige esta opción cuando quieras procesamiento más ligero con un carácter horn básico.
- **Horn Resonator Plus**: Elige esta opción cuando quieras una coloración horn más suave y natural y puedas aceptar un uso de CPU ligeramente mayor.

### Guía de Inicio Rápido

Utiliza los mismos controles que [Horn Resonator](#horn-resonator). Elige Horn Resonator Plus cuando quieras un carácter de altavoz horn más suave.

## Modal Resonator

Un efecto que añade resonancias afinadas a tu música, de forma parecida a cómo los objetos físicos o las partes de un altavoz vibran en sus frecuencias naturales. Úsalo cuando quieras añadir brillo, cuerpo, color metálico o resonancia de tipo altavoz durante la escucha.

### Preajustes del sistema

Haz clic en **Preajustes de efecto** en la cabecera del efecto para cargar un patrón completo de resonancias.

- **Wooden Body** - Modos de resonancia graves y más duraderos que aportan el carácter de una caja de madera.
- **Metal Can** - Modos de resonancia más agudos que resuenan durante más tiempo, con carácter metálico.
- **Plastic Enclosure** - Modos de resonancia más agudos y breves que aportan el carácter de una carcasa ligera.

### Guía de Experiencia Auditiva

- **Resonancia Metálica:**
  - Crea tonos metálicos o similares a campanas que siguen la dinámica del material de origen.
  - Útil para añadir brillo o carácter metálico a percusión, sintetizadores o mezclas completas.
  - Utiliza múltiples resonadores en frecuencias cuidadosamente afinadas con tiempos de decaimiento moderados.
- **Mejora Tonal:**
  - Refuerza sutilmente frecuencias específicas en la música.
  - Puede acentuar armónicos o añadir plenitud a rangos de frecuencia específicos.
  - Utiliza con valores de mezcla bajos (10-20%) para una mejora sutil.
- **Simulación de Altavoces de Rango Completo:**
  - Simula el comportamiento modal de altavoces físicos.
  - Recrea resonancias distintivas que ocurren cuando los drivers dividen sus vibraciones a diferentes frecuencias.
  - Ayuda a simular el sonido característico de tipos específicos de altavoces.
- **Efectos Especiales:**
  - Crea cualidades tímbricas inusuales y texturas sobrenaturales.
  - Útil cuando quieres un efecto de resonancia evidente en lugar de una mejora natural.
  - Prueba configuraciones extremas solo cuando quieras que las resonancias pasen a formar parte del sonido.

### Parámetros

- **Resonator Selection (1-5)** - Cinco resonadores independientes que pueden ser habilitados/deshabilitados y configurados por separado.
  - Utiliza múltiples resonadores para efectos de resonancia complejos y en capas.
  - Cada resonador puede apuntar a diferentes regiones de frecuencia.
  - Prueba relaciones armónicas entre resonadores para resultados más musicales.

Para cada resonador:

- **Enable** - Activa/desactiva el resonador individual.
- **Freq (Hz)** - Establece la frecuencia resonante primaria (20 a 20,000 Hz).
- **Decay (ms)** - Controla cuánto tiempo continúa la resonancia después del sonido de entrada (1 a 500 ms).
- **LPF Freq (Hz)** - Filtro paso bajo que da forma al tono de la resonancia (20 a 20,000 Hz).
- **HPF Freq (Hz)** - Filtro paso alto que elimina frecuencias bajas no deseadas de la resonancia (20 a 20,000 Hz).
- **Gain (dB)** - Controla el nivel de salida individual de cada resonador (-18 a +18 dB).

Control global:

- **Mix (%)** - Equilibra la salida combinada de todos los resonadores habilitados con el sonido original (0 a 100%).

### Configuraciones Recomendadas para Mejora Auditiva

1. **Mejora Sutil de Altavoz:**
   - Habilita 2-3 resonadores
   - Configuraciones de Freq: 400 Hz, 900 Hz, 1600 Hz
   - Decay: 60-100ms
   - LPF Freq: 2000-4000 Hz
   - Mix: 10-20%

2. **Carácter Metálico:**
   - Habilita 3-5 resonadores
   - Configuraciones de Freq: distribuidas entre 1000-6500 Hz
   - Decay: 100-200ms
   - LPF Freq: 4000-8000 Hz
   - Mix: 15-30%

3. **Mejora de Graves:**
   - Habilita 1-2 resonadores
   - Configuraciones de Freq: 50-150 Hz
   - HPF Freq: 20-60 Hz, manteniéndolo por debajo de la resonancia objetivo
   - Decay: 50-100ms
   - LPF Freq: 1000-2000 Hz
   - Mix: 10-25%

4. **Simulación de Altavoz de Rango Completo:**
   - Habilita los 5 resonadores
   - Configuraciones de Freq: 100 Hz, 400 Hz, 800 Hz, 1600 Hz, 3000 Hz
   - Configuraciones de HPF Freq: 20 Hz, 120 Hz, 250 Hz, 500 Hz, 1000 Hz
   - Decay: Progresivamente más corto de bajo a alto (100ms a 30ms)
   - LPF Freq: Progresivamente más alto de bajo a alto (2000Hz a 4000Hz)
   - Mix: 20-40%

### Guía de Inicio Rápido

1. **Elige Puntos de Resonancia:**
   - Comienza habilitando uno o dos resonadores.
   - Establece sus frecuencias para apuntar a áreas que quieras mejorar.
   - Para efectos más complejos, añade más resonadores con frecuencias complementarias.

2. **Ajusta el Carácter:**
   - Utiliza el parámetro `Decay` para controlar cuánto tiempo se mantienen las resonancias.
   - Da forma al tono con el control `LPF Freq`.
   - Establece `HPF Freq` por debajo de la resonancia que quieres conservar, especialmente en ajustes de graves.
   - Los tiempos de decaimiento más largos crean tonos más obvios, similares a campanas.

3. **Mezcla con el Original:**
   - Utiliza `Mix` para equilibrar el efecto con tu material de origen.
   - Comienza con valores de mezcla más bajos (10-20%) para una mejora sutil.
   - Aumenta para efectos más dramáticos.

4. **Ajuste Fino:**
   - Haz pequeños ajustes a las frecuencias y tiempos de decaimiento.
   - Activa/desactiva resonadores individuales para encontrar la combinación perfecta.
   - Recuerda que cambios sutiles pueden tener un impacto significativo en el sonido general.

Recuerda que cambios sutiles pueden tener un impacto significativo en el sonido general.
