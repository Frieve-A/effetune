---
title: "Resonator Plugins - EffeTune"
description: "Resonator effect plugins including Horn Resonator and Modal Resonator."
lang: en
---

# Resonator Plugins

Una colección de complementos que enfatizan características resonantes para añadir texturas tonales únicas y color a tu música. Estos efectos simulan resonancias presentes en objetos físicos o sistemas de altavoces, mejorando tu experiencia de escucha con calidez, brillo o carácter vintage.

## Lista de Plugins

- [Horn Resonator](#horn-resonator) - Simula la resonancia de sistemas de altavoces horn
- [Horn Resonator Plus](#horn-resonator-plus) - Modelo horn mejorado con reflexiones avanzadas
- [Modal Resonator](#modal-resonator) - Efecto de resonancia de frecuencia con hasta 5 resonators

## Horn Resonator

Un complemento que simula la resonancia de un horn-loaded speaker utilizando un modelo de guía de onda digital. Añade un carácter cálido y natural de horn speaker al modelar reflexiones de onda en la garganta y la boca, permitiéndote moldear el sonido con controles sencillos.

### Guía de Escucha

- Realce de medios cálido: acentúa voces e instrumentos acústicos sin dureza.
- Ambiente natural de altavoz horn: añade coloración de altavoz vintage para una escucha más rica.
- Amortiguación suave de altas frecuencias: previene picos agudos para un tono relajado.

### Parámetros

- **Crossover (Hz)** - Establece la división de frecuencia entre la ruta de baja frecuencia (retrasada) y la ruta de alta frecuencia procesada por el modelo horn. (20–5000 Hz)
- **Horn Length (cm)** - Ajusta la longitud del horn simulado. Los horns más largos enfatizan frecuencias más bajas y aumentan el espaciado de resonancia, los horns más cortos enfatizan frecuencias más altas y ajustan el sonido. (20–120 cm)
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

Un modelo horn mejorado que utiliza un filtro de reflexión de boca de 2º orden y reflexión de garganta dependiente de la frecuencia para una resonancia más suave.

Horn Resonator Plus es una implementación avanzada basada en [Horn Resonator](#horn-resonator), con un modelo de línea de transmisión horn más riguroso con las siguientes mejoras técnicas:

### Mejoras Técnicas

- **Filtro de reflexión de boca de 2º orden**: Modelado más preciso de la reflexión dependiente de la frecuencia en la abertura de la boca para características de resonancia más suaves
- **Reflexión de garganta dependiente de la frecuencia**: Características de reflexión de garganta que se adaptan a la frecuencia para un comportamiento acústico más natural

### Características Acústicas

Horn Resonator Plus proporciona calidad de sonido superior comparado con el Horn Resonator estándar en los siguientes aspectos:

- **Respuesta de frecuencia más suave**: El filtro de reflexión de boca de 2º orden crea una caída de pico de resonancia más natural
- **Comportamiento de alta frecuencia más realista**: Las características de retardo de grupo en el rango de alta frecuencia se asemejan más a instrumentos acústicos reales

### Parámetros y Uso

Horn Resonator Plus utiliza los mismos parámetros que [Horn Resonator](#horn-resonator). Por favor consulta la sección Horn Resonator para descripciones de parámetros, configuraciones y valores recomendados.

### Pautas de Uso

- **Horn Resonator**: Elige cuando necesites procesamiento ligero con características horn básicas
- **Horn Resonator Plus**: Elige cuando requieras mayor calidad y características acústicas horn más naturales (aproximadamente +10% costo de CPU)

### Guía de Inicio Rápido

Utiliza los mismos controles que [Horn Resonator](#horn-resonator). Elige Horn Resonator Plus cuando quieras resultados de alta calidad.

## Modal Resonator

Un efecto creativo que añade frecuencias resonantes a tu audio. Este plugin crea resonancias afinadas en frecuencias específicas, similar a cómo los objetos físicos vibran en sus frecuencias resonantes naturales. Es perfecto para añadir características tonales únicas, simular las propiedades resonantes de diferentes materiales o crear efectos especiales.

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
  - Excelente para diseño de sonido y procesamiento experimental.
  - Prueba configuraciones extremas para transformación creativa del sonido.

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
- **Mix (%)** - Equilibra el volumen de las resonancias contra el sonido original (0 a 100%).

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
   - Decay: 50-100ms
   - LPF Freq: 1000-2000 Hz
   - Mix: 10-25%

4. **Simulación de Altavoz de Rango Completo:**
   - Habilita los 5 resonadores
   - Configuraciones de Freq: 100 Hz, 400 Hz, 800 Hz, 1600 Hz, 3000 Hz
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