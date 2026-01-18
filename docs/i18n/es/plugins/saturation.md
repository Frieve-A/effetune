---
title: "Saturation Plugins - EffeTune"
description: "Saturation and distortion plugins including Saturation, Exciter, Hard Clipping, and more."
lang: en
---

# Plugins de Saturación

Una colección de plugins que agregan calidez y carácter a tu música. Estos efectos pueden hacer que la música digital suene más analógica y agregar una agradable riqueza al sonido, similar a cómo el equipo de audio vintage colorea el sonido.

## Lista de Plugins

- [Dynamic Saturation](#dynamic-saturation) - Simula el desplazamiento no lineal de los conos de altavoces
- [Exciter](#exciter) - Agrega contenido armónico para mejorar la claridad y presencia
- [Hard Clipping](#hard-clipping) - Agrega intensidad y borde al sonido
- [Harmonic Distortion](#harmonic-distortion) - Añade un carácter único a través de la distorsión armónica con control independiente de cada armónico
- [Multiband Saturation](#multiband-saturation) - Moldea y mejora diferentes rangos de frecuencia independientemente
- [Saturation](#saturation) - Agrega calidez y riqueza como equipo vintage
- [Sub Synth](#sub-synth) - Genera y mezcla señales subarmónicas para mejorar los graves

## Dynamic Saturation

Un efecto basado en la física que simula el desplazamiento no lineal de los conos de altavoces bajo diferentes condiciones. Al modelar el comportamiento mecánico de un altavoz y luego aplicar saturación a ese desplazamiento, crea una forma única de distorsión que responde dinámicamente a tu música.

### Guía de Mejora de Escucha
- **Mejora Sutil:**
  - Añade calidez suave y un comportamiento similar a la compresión
  - Crea un sonido naturalmente "empujado" sin distorsión obvia
  - Agrega profundidad y dimensionalidad sutiles al sonido
- **Efecto Moderado:**
  - Crea una distorsión más dinámica y receptiva
  - Añade movimiento único y vivacidad a los sonidos sostenidos
  - Enfatiza los transientes con una compresión de sensación natural
- **Efecto Creativo:**
  - Produce patrones de distorsión complejos que evolucionan con la entrada
  - Crea comportamientos resonantes similares a los de un altavoz
  - Permite posibilidades dramáticas de diseño de sonido

### Parámetros
- **Speaker Drive** (0.0-10.0) - Controla cuán fuertemente la señal de audio mueve el cono
  - Valores bajos: Movimiento sutil y efecto suave
  - Valores altos: Movimiento dramático y carácter más fuerte
- **Speaker Stiffness** (0.0-10.0) - Simula la rigidez de la suspensión del cono
  - Valores bajos: Movimiento libre y suelto con decaimiento más largo
  - Valores altos: Movimiento controlado y ajustado con respuesta rápida
- **Speaker Damping** (0.0-10.0) - Controla cuán rápidamente se asienta el movimiento del cono
  - Valores bajos: Vibración y resonancia prolongadas
  - Valores altos: Amortiguación rápida para un sonido controlado
- **Speaker Mass** (0.1-5.0) - Simula la inercia del cono
  - Valores bajos: Movimiento rápido y receptivo
  - Valores altos: Movimiento más lento y pronunciado
- **Distortion Drive** (0.0-10.0) - Controla la intensidad de la saturación del desplazamiento
  - Valores bajos: No linealidad sutil
  - Valores altos: Carácter de saturación fuerte
- **Distortion Bias** (-1.0-1.0) - Ajusta la simetría de la curva de saturación
  - Negativo: Enfatiza el desplazamiento negativo
  - Cero: Saturación simétrica
  - Positivo: Enfatiza el desplazamiento positivo
- **Distortion Mix** (0-100%) - Mezcla entre desplazamiento lineal y saturado
  - Valores bajos: Respuesta más lineal
  - Valores altos: Carácter más saturado
- **Cone Motion Mix** (0-100%) - Controla cuánto el movimiento del cono afecta al sonido original
  - Valores bajos: Mejora sutil
  - Valores altos: Efecto dramático
- **Output Gain** (-18.0-18.0dB) - Ajusta el nivel de salida final

### Visualización
- Gráfico interactivo de curva de transferencia que muestra cómo se satura el desplazamiento
- Retroalimentación visual clara de las características de distorsión
- Representación visual de cómo el Distortion Drive y el Bias afectan al sonido

### Consejos para Mejorar la Música
- Para Calidez Sutil:
  - Speaker Drive: 2.0-3.0
  - Speaker Stiffness: 1.5-2.5
  - Speaker Damping: 0.5-1.5
  - Distortion Drive: 1.0-2.0
  - Cone Motion Mix: 20-40%
  - Distortion Mix: 30-50%

- Para Carácter Dinámico:
  - Speaker Drive: 3.0-5.0
  - Speaker Stiffness: 2.0-4.0
  - Speaker Mass: 0.5-1.5
  - Distortion Drive: 3.0-6.0
  - Distortion Bias: Prueba ±0.2 para carácter asimétrico
  - Cone Motion Mix: 40-70%

- Para Diseño de Sonido Creativo:
  - Speaker Drive: 6.0-10.0
  - Speaker Stiffness: Prueba valores extremos (muy bajos o altos)
  - Speaker Mass: 2.0-5.0 para movimiento exagerado
  - Distortion Drive: 5.0-10.0
  - Experimenta con valores de Bias
  - Cone Motion Mix: 70-100%

### Guía de Inicio Rápido
1. Comienza con Speaker Drive moderado (3.0) y Stiffness (2.0)
2. Establece Speaker Damping para controlar la resonancia (1.0 para respuesta equilibrada)
3. Ajusta Distortion Drive a gusto (3.0 para efecto moderado)
4. Mantén inicialmente Distortion Bias en 0.0
5. Establece Distortion Mix en 50% y Cone Motion Mix en 50%
6. Ajusta Speaker Mass para cambiar el carácter del efecto
7. Afina con Output Gain para equilibrar niveles

## Exciter

Un efecto que agrega contenido armónico para mejorar la claridad y presencia. Al filtrar el contenido de alta frecuencia y aplicar saturación, crea armónicos adicionales que iluminan y mejoran tu música.

### Guía de Mejora de Escucha
- **Mejora Sutil:**
  - Añade claridad y aire a las voces
  - Mejora la presencia de los instrumentos
  - Crea un sonido más abierto y detallado
- **Efecto Moderado:**
  - Saca a relucir detalles ocultos en la mezcla
  - Añade brillo y brillantez
  - Hace que la música suene más "hi-fi"
- **Efecto Creativo:**
  - Crea tonos brillantes y cortantes
  - Añade presencia agresiva
  - Perfecto para estilos de producción modernos

### Parámetros
- **HPF Freq** (500-10000Hz) - Establece la frecuencia de corte para el filtrado de paso alto
  - Valores bajos (500-2000Hz): Afecta más de la señal
  - Valores medios (2000-5000Hz): Se enfoca en frecuencias de presencia
  - Valores altos (5000-10000Hz): Se concentra en aire y brillantez
- **HPF Slope** - Controla la pendiente del filtro
  - Off: Sin filtrado, procesa todo el espectro
  - 6dB/oct: Filtrado suave
  - 12dB/oct: Filtrado más pronunciado
- **Drive** (0.0-10.0) - Controla la intensidad de saturación
  - Ligero (0.0-3.0): Mejora armónica sutil
  - Medio (3.0-6.0): Brillo notable
  - Alto (6.0-10.0): Excitación fuerte
- **Bias** (-0.3 a 0.3) - Ajusta la asimetría de saturación
  - Negativo: Enfatiza las porciones negativas de la señal
  - Cero: Saturación simétrica
  - Positivo: Enfatiza las porciones positivas de la señal
- **Mix** (0-100%) - Mezcla la señal excitada con la seca
  - Bajo (0-30%): Mejora sutil
  - Medio (30-60%): Efecto equilibrado
  - Alto (60-100%): Excitación fuerte

### Visualización
- Gráfico de respuesta de frecuencia del filtro paso alto
- Visualización de la curva de transferencia de saturación
- Retroalimentación visual clara tanto para el filtro como para la saturación

### Consejos para Mejorar la Música
- Para Presencia Vocal:
  - HPF Freq: 3000-5000Hz
  - HPF Slope: 6dB/oct
  - Drive: 2.0-4.0
  - Bias: 0.05 a 0.1
  - Mix: 20-40%

- Para Claridad de Instrumentos:
  - HPF Freq: 2000-4000Hz
  - HPF Slope: 12dB/oct
  - Drive: 3.0-5.0
  - Bias: 0.0
  - Mix: 30-50%

- Para Mejora del Bus Maestro:
  - HPF Freq: 5000-8000Hz
  - HPF Slope: 6dB/oct
  - Drive: 1.0-3.0
  - Bias: 0.0 a 0.1
  - Mix: 10-25%

### Guía de Inicio Rápido
1. Establece HPF Freq para apuntar al rango de frecuencia deseado
2. Elige HPF Slope (comienza con 6dB/oct)
3. Comienza con Drive moderado (3.0)
4. Mantén Bias cerca de 0.1 para brillo
5. Establece Mix en 25% y ajusta a gusto
6. Afina todos los parámetros mientras escuchas

## Hard Clipping

Un efecto que puede agregar desde calidez sutil hasta carácter intenso a tu música. Funciona moldeando suave o agresivamente las ondas sonoras, creando desde mejoras sutiles hasta efectos dramáticos.

### Guía de Mejora de Escucha
- Mejora Sutil:
  - Hace que la música digital suene ligeramente más cálida
  - Agrega una suave cualidad "tipo analógica"
  - Mantiene la claridad mientras reduce la dureza
- Efecto Moderado:
  - Crea un sonido más enérgico
  - Agrega emoción a elementos rítmicos
  - Hace que la música se sienta más "impulsada"
- Efecto Creativo:
  - Crea transformaciones dramáticas del sonido
  - Agrega carácter agresivo a la música
  - Perfecto para escucha experimental

### Parámetros
- **Threshold** - Controla cuánto del sonido es afectado (-60dB a 0dB)
  - Valores más altos (-6dB a 0dB): Calidez sutil
  - Valores medios (-24dB a -6dB): Carácter notable
  - Valores más bajos (-60dB a -24dB): Efecto dramático
- **Mode** - Elige qué partes del sonido afectar
  - Both Sides: Efecto equilibrado y natural
  - Positive Only: Sonido más brillante y agresivo
  - Negative Only: Carácter más oscuro y único

### Visualización
- Gráfico en tiempo real mostrando cómo se está moldeando el sonido
- Retroalimentación visual clara al ajustar configuraciones
- Líneas de referencia para ayudar a guiar tus ajustes

### Consejos de Escucha
- Para mejora sutil:
  1. Comienza con un Threshold alto (-6dB)
  2. Usa modo "Both Sides"
  3. Escucha la calidez agregada
- Para efectos creativos:
  1. Baja el Threshold gradualmente
  2. Prueba diferentes Modos
  3. Combina con otros efectos para sonidos únicos

## Harmonic Distortion

El plugin Harmonic Distortion introduce un efecto de distorsión armónica que va más allá de la saturación tradicional. A diferencia de la saturación estándar que añade armónicos en un patrón fijo, este efecto permite un control independiente de cada componente armónico. Al inyectar intencionalmente componentes armónicos controlados con ajustes individuales precisos, crea interacciones complejas que enriquecen tu sonido con nuevas texturas y un carácter dinámico.

### Guía para la Mejora Auditiva
- **Efecto Sutil:**
  - Añade una capa suave de calidez armónica
  - Realza el tono natural sin sobrecargar la señal original
  - Ideal para añadir una sutil profundidad similar a la analógica
- **Efecto Moderado:**
  - Enfatiza armónicos definidos para otorgar un carácter más pronunciado
  - Aporta claridad y brillo a diversos elementos musicales
  - Adecuado para géneros que requieren un sonido equilibrado pero enriquecido
- **Efecto Agresivo:**
  - Intensifica múltiples armónicos para crear una distorsión rica y compleja
  - Proporciona posibilidades creativas de diseño sonoro para pistas experimentales
  - Perfecto para agregar texturas atrevidas y poco convencionales
- **Valores Positivos vs. Negativos:**
  - Valores positivos: Crean un efecto tipo compresión, controlando picos y añadiendo calidez con mayor densidad
  - Valores negativos: Generan un efecto tipo expansión, enfatizando la dinámica y creando sonidos más abiertos

### Parámetros
- **2nd Harm (%):** Controla la cantidad de segundo armónico añadido (-30 a 30%, predeterminado: 2%)
- **3rd Harm (%):** Ajusta la contribución del tercer armónico (-30 a 30%, predeterminado: 3%)
- **4th Harm (%):** Modifica la intensidad del cuarto armónico (-30 a 30%, predeterminado: 0.5%)
- **5th Harm (%):** Establece el nivel del quinto armónico (-30 a 30%, predeterminado: 0.3%)
- **Sensitivity (x):** Ajusta la sensibilidad general de entrada (0.1–2.0, predeterminado: 0.5)
  - Una sensibilidad menor proporciona un efecto más sutil
  - Una sensibilidad mayor aumenta la intensidad de la distorsión
  - Funciona como un control global que afecta a la intensidad de todos los armónicos

### Visualización
- Visualización en tiempo real de la interacción armónica y la curva de distorsión
- Controles deslizantes e campos de entrada intuitivos que ofrecen retroalimentación inmediata
- Gráfico dinámico que muestra los cambios en el contenido armónico a medida que se ajustan los parámetros

### Guía de Inicio Rápido
1. **Inicialización:** Comienza con la configuración predeterminada (2nd: 2%, 3rd: 3%, 4th: 0.5%, 5th: 0.3%, Sensitivity: 0.5)
2. **Ajusta los Parámetros:** Utiliza la retroalimentación en tiempo real para ajustar finamente cada nivel armónico según tu contexto musical
3. **Mezcla Tu Sonido:** Equilibra el efecto utilizando Sensitivity para lograr una calidez sutil o una distorsión pronunciada

## Multiband Saturation

Un efecto versátil que te permite agregar calidez y carácter a rangos de frecuencia específicos de tu música. Al dividir el sonido en bandas bajas, medias y altas, puedes moldear cada rango independientemente para una mejora precisa del sonido.

### Guía de Mejora de Escucha
- Mejora de Graves:
  - Agrega calidez y punch a las frecuencias bajas
  - Perfecto para mejorar bajos y bombos
  - Crea graves más llenos y ricos
- Moldeado de Medios:
  - Resalta el cuerpo de voces e instrumentos
  - Agrega presencia a guitarras y teclados
  - Crea un sonido más claro y definido
- Mejora de Agudos:
  - Agrega brillo a platillos y hi-hats
  - Mejora el aire y la brillantez
  - Crea agudos nítidos y detallados

### Parámetros
- **Frecuencias de Crossover**
  - Freq 1 (20Hz-2kHz): Define dónde termina la banda baja y comienza la media
  - Freq 2 (200Hz-20kHz): Define dónde termina la banda media y comienza la alta
- **Controles de Banda** (para cada banda Baja, Media y Alta):
  - **Drive** (0.0-10.0): Controla la intensidad de saturación
    - Ligero (0.0-3.0): Mejora sutil
    - Medio (3.0-6.0): Calidez notable
    - Alto (6.0-10.0): Carácter fuerte
  - **Bias** (-0.3 a 0.3): Ajusta la simetría de la curva de saturación
    - Negativo: Enfatiza picos negativos
    - Cero: Saturación simétrica
    - Positivo: Enfatiza picos positivos
  - **Mix** (0-100%): Mezcla el efecto con el original
    - Bajo (0-30%): Mejora sutil
    - Medio (30-70%): Efecto equilibrado
    - Alto (70-100%): Carácter fuerte
  - **Gain** (-18dB a +18dB): Ajusta el volumen de la banda
    - Usado para equilibrar las bandas entre sí
    - Compensa cambios de volumen

### Visualización
- Pestañas interactivas de selección de banda
- Gráfico de curva de transferencia en tiempo real para cada banda
- Retroalimentación visual clara al ajustar configuraciones

### Consejos de Mejora Musical
- Para Mejora Global del Mix:
  1. Comienza con Drive suave (2.0-3.0) en todas las bandas
  2. Mantén Bias en 0.0 para saturación natural
  3. Ajusta Mix alrededor de 40-50% para mezcla natural
  4. Afina el Gain para cada banda

- Para Mejora de Graves:
  1. Concéntrate en la banda baja
  2. Usa Drive moderado (3.0-5.0)
  3. Mantén Bias neutral para respuesta consistente
  4. Mantén Mix alrededor de 50-70%

- Para Mejora de Voces:
  1. Concéntrate en la banda media
  2. Usa Drive ligero (1.0-3.0)
  3. Mantén Bias en 0.0 para sonido natural
  4. Ajusta Mix al gusto (30-50%)

- Para Agregar Brillo:
  1. Concéntrate en la banda alta
  2. Usa Drive suave (1.0-2.0)
  3. Mantén Bias neutral para saturación limpia
  4. Mantén Mix sutil (20-40%)

### Guía de Inicio Rápido
1. Ajusta frecuencias de crossover para dividir tu sonido
2. Comienza con valores bajos de Drive en todas las bandas
3. Mantén inicialmente Bias en 0.0
4. Usa Mix para mezclar el efecto naturalmente
5. Afina con controles de Gain
6. ¡Confía en tus oídos y ajusta a gusto!

## Saturation

Un efecto que simula el sonido cálido y agradable del equipo de válvulas vintage. Puede agregar riqueza y carácter a tu música, haciéndola sonar más "analógica" y menos "digital".

### Guía de Mejora de Escucha
- Agregando Calidez:
  - Hace que la música digital suene más natural
  - Agrega riqueza agradable al sonido
  - Perfecto para jazz y música acústica
- Carácter Rico:
  - Crea un sonido más "vintage"
  - Agrega profundidad y dimensión
  - Genial para rock y música electrónica
- Efecto Fuerte:
  - Transforma el sonido dramáticamente
  - Crea tonos audaces y con carácter
  - Ideal para escucha experimental

### Parámetros
- **Drive** - Controla la cantidad de calidez y carácter (0.0 a 10.0)
  - Ligero (0.0-3.0): Calidez analógica sutil
  - Medio (3.0-6.0): Carácter vintage rico
  - Fuerte (6.0-10.0): Efecto audaz y dramático
- **Bias** - Ajusta la simetría de la curva de saturación (-0.3 a 0.3)
  - 0.0: Saturación simétrica
  - Positivo: Enfatiza picos positivos
  - Negativo: Enfatiza picos negativos
- **Mix** - Equilibra el efecto con el sonido original (0% a 100%)
  - 0-30%: Mejora sutil
  - 30-70%: Efecto equilibrado
  - 70-100%: Carácter fuerte
- **Gain** - Ajusta el volumen general (-18dB a +18dB)
  - Usa valores negativos si el efecto está muy fuerte
  - Usa valores positivos si el efecto está muy suave

### Visualización
- Gráfico claro mostrando cómo se está moldeando el sonido
- Retroalimentación visual en tiempo real
- Controles fáciles de leer

### Consejos de Mejora Musical
- Clásica y Jazz:
  - Drive ligero (1.0-2.0) para calidez natural
  - Mantén Bias en 0.0 para saturación limpia
  - Mix bajo (20-40%) para sutileza
- Rock y Pop:
  - Drive medio (3.0-5.0) para carácter rico
  - Mantén Bias neutral para respuesta consistente
  - Mix medio (40-60%) para balance
- Electrónica:
  - Drive más alto (4.0-7.0) para efecto audaz
  - Experimenta con diferentes valores de Bias
  - Mix más alto (60-80%) para carácter

### Guía de Inicio Rápido
1. Comienza con Drive bajo para calidez suave
2. Mantén inicialmente Bias en 0.0
3. Ajusta Mix para equilibrar el efecto
4. Ajusta Gain si es necesario para volumen adecuado
5. ¡Experimenta y confía en tus oídos!

## Sub Synth

Un efecto especializado que mejora los graves de tu música mediante la generación y mezcla de señales subarmónicas. Perfecto para agregar profundidad y potencia a grabaciones con pocos graves o crear sonidos graves ricos y corpulentos.

### Guía de Mejora de Escucha
- Mejora de Graves:
  - Agrega profundidad y potencia a grabaciones delgadas
  - Crea graves más llenos y ricos
  - Perfecto para escucha con auriculares
- Control de Frecuencia:
  - Control preciso sobre frecuencias subarmónicas
  - Filtrado independiente para graves limpios
  - Mantiene la claridad mientras agrega potencia

### Parámetros
- **Sub Level** - Controla el nivel de la señal subarmónica (0-200%)
  - Ligero (0-50%): Mejora sutil de graves
  - Medio (50-100%): Refuerzo equilibrado de graves
  - Alto (100-200%): Efecto dramático de graves
- **Dry Level** - Ajusta el nivel de la señal original (0-200%)
  - Usado para equilibrar con la señal subarmónica
  - Mantiene la claridad del sonido original
- **Sub LPF** - Filtro paso bajo para señal subarmónica (5-400Hz)
  - Frecuencia: Controla el límite superior del sub
  - Pendiente: Ajusta la pendiente del filtro (Off a -24dB/oct)
- **Sub HPF** - Filtro paso alto para señal subarmónica (5-400Hz)
  - Frecuencia: Elimina retumbe no deseado
  - Pendiente: Controla la pendiente del filtro (Off a -24dB/oct)
- **Dry HPF** - Filtro paso alto para señal original (5-400Hz)
  - Frecuencia: Previene acumulación de graves
  - Pendiente: Ajusta la pendiente del filtro (Off a -24dB/oct)

### Visualización
- Gráfico interactivo de respuesta en frecuencia
- Visualización clara de curvas de filtro
- Retroalimentación visual en tiempo real

### Consejos de Mejora Musical
- Para Mejora General de Graves:
  1. Comienza con Sub Level al 50%
  2. Ajusta Sub LPF alrededor de 100Hz (-12dB/oct)
  3. Mantén Sub HPF en 20Hz (-6dB/oct)
  4. Ajusta Dry Level a gusto

- Para Refuerzo Limpio de Graves:
  1. Ajusta Sub Level a 70-100%
  2. Usa Sub LPF en 80Hz (-18dB/oct)
  3. Ajusta Sub HPF a 30Hz (-12dB/oct)
  4. Activa Dry HPF en 40Hz

- Para Máximo Impacto:
  1. Aumenta Sub Level a 150%
  2. Ajusta Sub LPF a 120Hz (-24dB/oct)
  3. Mantén Sub HPF en 15Hz (-6dB/oct)
  4. Equilibra con Dry Level

### Guía de Inicio Rápido
1. Comienza con Sub Level moderado (50-70%)
2. Ajusta Sub LPF alrededor de 100Hz
3. Activa Sub HPF alrededor de 20Hz
4. Ajusta Dry Level para equilibrio
5. Afina filtros a gusto
6. ¡Confía en tus oídos y ajusta gradualmente!
