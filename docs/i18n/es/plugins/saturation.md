---
title: "Plugins de saturación - EffeTune"
description: "Plugins de saturación y distorsión como Saturation, Exciter, Hard Clipping y otros."
lang: es
---

# Plugins de Saturación

Una colección de plugins que agregan calidez y carácter a tu música. Estos efectos pueden hacer que la música digital suene más analógica y agregar una agradable riqueza al sonido, similar a cómo el equipo de audio vintage colorea el sonido.

## Lista de Plugins

- [Dynamic Saturation](#dynamic-saturation) - Simula el desplazamiento no lineal de los conos de altavoces
- [Exciter](#exciter) - Agrega contenido armónico para mejorar la claridad y presencia
- [Hard Clipping](#hard-clipping) - Agrega intensidad y borde al sonido
- [Harmonic Distortion](#harmonic-distortion) - Añade carácter con distorsión no lineal ajustable de 2º a 5º orden
- [Multiband Saturation](#multiband-saturation) - Moldea los rangos de frecuencia bajos, medios y altos de forma independiente
- [Saturation](#saturation) - Agrega calidez y riqueza como equipo vintage
- [Sub Synth](#sub-synth) - Añade una señal filtrada de baja frecuencia para reforzar los graves
- [Tube Simulator](#tube-simulator) - Modela etapas de línea a válvulas y un amplificador de potencia push-pull

## Dynamic Saturation

Un efecto basado en la física que simula el desplazamiento no lineal de los conos de altavoces bajo diferentes condiciones. Al modelar el comportamiento mecánico de un altavoz y luego aplicar saturación a ese desplazamiento, crea una forma única de distorsión que responde dinámicamente a tu música.

### Guía de Mejora de Escucha
- **Mejora Sutil:**
  - Añade calidez suave y un ligero redondeo de picos
  - Crea un sonido naturalmente "empujado" sin distorsión obvia
  - Agrega movimiento y profundidad sutiles al sonido
- **Efecto Moderado:**
  - Crea una distorsión más dinámica y receptiva
  - Añade movimiento único y vivacidad a pasajes sostenidos
  - Da a los transientes un carácter móvil y sensible a la señal
- **Efecto Creativo:**
  - Produce patrones de distorsión complejos que evolucionan con la entrada
  - Crea comportamientos resonantes similares a los de un altavoz
  - Crea un carácter intenso y cambiante para escucha experimental

### Parámetros
- **Speaker Drive** (0.0-10.0) - Controla cuán fuertemente la señal de audio mueve el cono
  - Valores bajos: Movimiento sutil y efecto suave
  - Valores altos: Movimiento dramático y carácter más fuerte
- **Speaker Stiffness** (0.0-10.0) - Simula la rigidez de la suspensión del cono
  - Valores bajos: Movimiento libre y suelto con decaimiento más largo
  - Valores altos: Movimiento controlado y ajustado con respuesta rápida
- **Speaker Damping** (0.1-10.0) - Controla cuán rápidamente se asienta el movimiento del cono
  - Valores bajos cerca de 0.1: Vibración y resonancia prolongadas
  - Valores altos: Amortiguación rápida para un sonido controlado
- **Speaker Mass** (0.1-5.0) - Simula la inercia del cono
  - Valores bajos: Movimiento rápido y receptivo
  - Valores altos: Movimiento más lento y pronunciado
- **Distortion Drive** (0.0-10.0) - Controla la intensidad de la saturación del desplazamiento
  - Valores bajos: No linealidad sutil
  - Valores altos: Carácter de saturación fuerte
- **Distortion Bias** (-1.0-1.0) - Ajusta la simetría de la curva de saturación
  - Cero: Saturación simétrica
  - Positivo/Negativo: Añade carácter asimétrico al cambiar qué lado del desplazamiento se satura con más fuerza
- **Distortion Mix** (0-100%) - Mezcla entre desplazamiento lineal y saturado
  - Valores bajos: Respuesta más lineal
  - Valores altos: Carácter más saturado
- **Cone Motion Mix** (0-100%) - Controla cuánto el movimiento del cono afecta al sonido original
  - Valores bajos: Mejora sutil
  - Valores altos: Efecto dramático
- **Output Gain** (-18.0-18.0dB) - Ajusta el nivel de salida final

### Visualización
- Gráfico en vivo de curva de transferencia que muestra cómo se satura el desplazamiento
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

- Para Efecto Experimental Fuerte:
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
  - Útil cuando quieres un sonido más brillante y directo, pero conviene usarlo con moderación

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
  - Cero: Saturación simétrica
  - Positivo/Negativo: Añade carácter asimétrico al cambiar qué lado de la mejora generada se satura con más fuerza
- **Mix** (0-100%) - Controla cuánta mejora armónica generada se añade al sonido original
  - Bajo (0-30%): Brillo añadido sutil
  - Medio (30-60%): Presencia y detalle más claros
  - Alto (60-100%): Armónicos añadidos fuertes; úsalo con cuidado para evitar aspereza

### Visualización
- Gráfico de respuesta de frecuencia del filtro paso alto
- Visualización de la curva de transferencia de saturación
- Retroalimentación visual clara tanto para el filtro como para la saturación

### Consejos para Mejorar la Música
- Para Voces más Claras en Canciones, Podcasts o Vídeos:
  - HPF Freq: 3000-5000Hz
  - HPF Slope: 6dB/oct
  - Drive: 2.0-4.0
  - Bias: 0.05 a 0.1
  - Mix: 20-40%

- Para Mayor Detalle Medio/Alto en Grabaciones Densas:
  - HPF Freq: 2000-4000Hz
  - HPF Slope: 12dB/oct
  - Drive: 3.0-5.0
  - Bias: 0.0
  - Mix: 30-50%

- Para Brillo Sutil en una Pista Completa:
  - HPF Freq: 5000-8000Hz
  - HPF Slope: 6dB/oct
  - Drive: 1.0-3.0
  - Bias: 0.0 a 0.1
  - Mix: 10-25%

### Guía de Inicio Rápido
1. Establece HPF Freq para apuntar al rango de frecuencia deseado
2. Elige HPF Slope (comienza con 6dB/oct)
3. Comienza con Drive moderado (3.0)
4. Mantén Bias cerca de 0.1 para un carácter ligeramente asimétrico
5. Establece Mix en 25% y ajusta a gusto
6. Afina todos los parámetros mientras escuchas

## Hard Clipping

Un efecto de clipping digital que limita los picos por encima de un umbral definido. Úsalo cuando quieras más borde, densidad o distorsión creativa; mantén Threshold alto para un control ligero de picos y bájalo gradualmente para un carácter más fuerte.

### Guía de Mejora de Escucha
- Mejora Sutil:
  - Añade un poco de borde y densidad cuando Threshold permanece alto
  - Puede recortar picos agudos si se usa con moderación
  - Compara con bypass porque el clipping puede volverse áspero si se fuerza demasiado
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
  - Valores más altos (-6dB a 0dB): Control ligero de picos o borde sutil
  - Valores medios (-24dB a -6dB): Carácter de clipping y densidad notables
  - Valores más bajos (-60dB a -24dB): Distorsión fuerte y efecto dramático
- **Mode** - Elige qué partes del sonido afectar
  - Both Sides: Recorta picos positivos y negativos de forma simétrica; es el modo más predecible
  - Positive Only: Recorta solo los picos positivos, creando clipping asimétrico y un carácter tonal distinto
  - Negative Only: Recorta solo los picos negativos, creando clipping asimétrico con una sensación diferente a Positive Only

### Visualización
- Gráfico en tiempo real mostrando cómo se está moldeando el sonido
- Retroalimentación visual clara al ajustar configuraciones
- Líneas de referencia para ayudar a guiar tus ajustes

### Consejos de Escucha
- Para mejora sutil:
  1. Comienza con Threshold en 0dB
  2. Usa modo "Both Sides"
  3. Bájalo gradualmente hacia -3dB a -6dB y detente cuando el efecto apenas sea audible
- Para efectos creativos:
  1. Baja el Threshold gradualmente
  2. Prueba diferentes Modos
  3. Combina con otros efectos para sonidos únicos

## Harmonic Distortion

Harmonic Distortion moldea la forma de onda con términos no lineales ajustables de 2º a 5º orden. Permite afinar el carácter de distorsión de orden par e impar, desde una calidez sutil hasta una coloración más fuerte, lo que puede ayudar a que música demasiado limpia, delgada o plana se sienta más viva.

### Guía para la Mejora Auditiva
- **Efecto Sutil:**
  - Añade una capa suave de calidez armónica
  - Realza el tono natural sin sobrecargar la señal original
  - Ideal para añadir una sutil profundidad similar a la analógica
- **Efecto Moderado:**
  - Añade un carácter armónico más pronunciado
  - Puede añadir cuerpo, brillo o borde a toda la grabación
  - Útil cuando el sonido se siente demasiado plano o contenido
- **Efecto Agresivo:**
  - Intensifica múltiples armónicos para crear una distorsión rica y compleja
  - Crea texturas atrevidas para escucha experimental
  - Puede sonar filoso o poco convencional cuando se fuerza mucho
- **Valores Positivos vs. Negativos:**
  - Los valores positivos y negativos invierten la dirección de cada término no lineal
  - Los términos de orden par cambian sobre todo la asimetría y el color tonal
  - Los términos de orden impar cambian sobre todo el carácter de la distorsión simétrica

### Parámetros
- **2nd Harm (%):** Establece el término de distorsión de segundo orden (-30 a 30%, predeterminado: 2%)
- **3rd Harm (%):** Establece el término de distorsión de tercer orden (-30 a 30%, predeterminado: 3%)
- **4th Harm (%):** Establece el término de distorsión de cuarto orden (-30 a 30%, predeterminado: 0.5%)
- **5th Harm (%):** Establece el término de distorsión de quinto orden (-30 a 30%, predeterminado: 0.3%)
- **Sensitivity (x):** Ajusta la sensibilidad general de entrada (0.1–2.0, predeterminado: 0.5)
  - Una sensibilidad menor proporciona un efecto más sutil
  - Una sensibilidad mayor aumenta la intensidad de la distorsión
  - Funciona como un control global que afecta a la intensidad del modelado no lineal

### Visualización
- Curva de transferencia que muestra cómo los niveles de entrada se moldean en niveles de salida
- Controles deslizantes e campos de entrada intuitivos que ofrecen retroalimentación inmediata
- El gráfico se actualiza a medida que cambian los ajustes de armónicos y sensibilidad

### Guía de Inicio Rápido
1. **Inicialización:** Comienza con la configuración predeterminada (2nd: 2%, 3rd: 3%, 4th: 0.5%, 5th: 0.3%, Sensitivity: 0.5)
2. **Ajusta los Parámetros:** Cambia uno o dos controles armónicos cada vez mientras escuchas si aparece aspereza o pérdida de claridad
3. **Mezcla Tu Sonido:** Equilibra el efecto utilizando Sensitivity para lograr una calidez sutil o una distorsión pronunciada

## Multiband Saturation

Un efecto versátil que te permite añadir calidez y carácter a rangos de frecuencia específicos de toda la señal de reproducción. Al dividir el sonido en bandas bajas, medias y altas, puedes moldear cada rango de forma independiente para un realce preciso.

### Guía de Mejora de Escucha
- Mejora de Graves:
  - Añade calidez y golpe suave a las frecuencias bajas
  - Añade plenitud al rango grave de toda la señal de reproducción
  - Crea graves más llenos y ricos
- Claridad de Medios:
  - Añade cuerpo y definición al rango medio, donde aparecen muchas voces e instrumentos
  - Ayuda a que grabaciones densas se sientan más claras
  - Crea un sonido más definido
- Mejora de Agudos:
  - Añade brillo al rango de altas frecuencias
  - Mejora el aire y la brillantez
  - Crea agudos nítidos y detallados

Como procesa bandas de frecuencia, afecta a todos los sonidos del rango seleccionado, no a instrumentos o voces aislados.

### Parámetros
- **Frecuencias de Crossover**
  - Freq 1 (20Hz-2kHz): Define dónde termina la banda baja y comienza la media
  - Freq 2 (200Hz-20kHz, siempre mantenida en o por encima de Freq 1): Define dónde termina la banda media y comienza la alta
  - Si Freq 2 se ajusta por debajo de Freq 1, se eleva automáticamente para preservar el orden baja-media-alta
- **Controles de Banda** (para cada banda Baja, Media y Alta):
  - **Drive** (0.0-10.0): Controla la intensidad de saturación
    - Ligero (0.0-3.0): Mejora sutil
    - Medio (3.0-6.0): Calidez notable
    - Alto (6.0-10.0): Carácter fuerte
  - **Bias** (-0.3 a 0.3): Ajusta la simetría de la curva de saturación
    - Cero: Saturación simétrica
    - Positivo/Negativo: Añade carácter asimétrico al cambiar qué lado de la forma de onda se satura con más fuerza
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

- Para Presencia de Medios:
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
  - Positivo: Hace más prominente el lado negativo de la forma de onda
  - Negativo: Hace más prominente el lado positivo de la forma de onda
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

Un efecto especializado que refuerza el extremo grave mezclando una señal filtrada de baja frecuencia derivada del audio original. Es útil cuando música con pocos graves necesita más calidez, plenitud o impacto agradable en auriculares.

### Guía de Mejora de Escucha
- Mejora de Graves:
  - Agrega profundidad y potencia a grabaciones delgadas
  - Crea graves más llenos y ricos
  - Perfecto para escucha con auriculares
- Control de Frecuencia:
  - Controla qué rango de baja frecuencia añadido se conserva
  - Filtrado independiente para graves limpios
  - Mantiene la claridad mientras agrega potencia

### Parámetros
- **Sub Level** - Controla el nivel de la señal de baja frecuencia añadida (0-200%)
  - Ligero (0-50%): Mejora sutil de graves
  - Medio (50-100%): Refuerzo equilibrado de graves
  - Alto (100-200%): Efecto dramático de graves
- **Dry Level** - Ajusta el nivel de la señal original (0-200%)
  - Usado para equilibrar con la señal de baja frecuencia añadida
  - Mantiene la claridad del sonido original
- **Sub LPF** - Filtro paso bajo para la señal de baja frecuencia añadida (5-400Hz)
  - Frecuencia: Controla el límite superior de la señal de baja frecuencia añadida
  - Pendiente: Ajusta la pendiente del filtro (Off a -24dB/oct)
- **Sub HPF** - Filtro paso alto para la señal de baja frecuencia añadida (5-400Hz)
  - Frecuencia: Elimina retumbe no deseado de la señal de baja frecuencia añadida
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
  4. Ajusta Dry HPF a 40Hz (-6dB/oct)

- Para Máximo Impacto:
  1. Aumenta Sub Level a 150%
  2. Ajusta Sub LPF a 120Hz (-24dB/oct)
  3. Mantén Sub HPF en 15Hz (-6dB/oct)
  4. Equilibra con Dry Level

### Guía de Inicio Rápido
1. Comienza con Sub Level moderado (50-70%)
2. Ajusta Sub LPF alrededor de 100Hz
3. Activa Sub HPF alrededor de 20Hz (-6dB/oct)
4. Ajusta Dry Level para equilibrio
5. Afina filtros a gusto
6. ¡Confía en tus oídos y ajusta gradualmente!

## Tube Simulator

Tube Simulator modela una cadena eléctrica completa a partir de valores de componentes de circuitos a válvulas. **Line** utiliza por sí solo el amplificador de pequeña señal de dos etapas. **Push-Pull Power** envía ese mismo driver, a través de un control de volumen fijo, a un inversor de fase 12AX7 que se resuelve como un par diferencial de válvulas reales y, desde ahí, a dos válvulas de salida EL84 o EL34, un transformador de salida y una carga de altavoz dependiente de la frecuencia. El bias, B+, el transformador y la carga se resuelven a medida que cambia la señal, por lo que los armónicos, la compresión, la caída de alimentación y el amortiguamiento eléctrico reaccionan a la música. La carga de altavoz representa la carga eléctrica vista por el amplificador; no simula una pantalla ni un micrófono.

### Guía de Ajuste del Sonido

- El plugin arranca en **EL84 Pentode @2%**, así que un convertidor D/A de 2 Vrms no necesita ajustes. Los valores predeterminados reales del producto son Input Reference 2.828 Vpk, Input Volume -55.9648dB, 12AX7, Negative Feedback 3dB y Output Trim +4.626dB, que sitúan el circuito push-pull EL84 en un 2% de distorsión armónica total con ganancia unitaria.
- Si satura demasiado, baja Input Volume para reducir la tensión interna y recupera solo el volumen de escucha con Output Trim. Output Trim no recupera margen dentro del circuito.
- Elige **Line Default** cuando quieras el circuito de línea de pequeña señal por sí solo en lugar de un amplificador de potencia.
- Usa los presets **Listening (THD-matched)** cuando quieras comparar válvulas y circuitos solo por su carácter. Ya están igualados entre sí en volumen, así que no hace falta retocar nada al cambiar de uno a otro.
- Para una respuesta de potencia contenida, empieza con **EL84 Distributed 10 W**. Compáralo con **EL84 Pentode 10 W** para oír el efecto de la conexión de pantalla y de la carga del transformador con la misma familia de válvulas.
- Usa **EL34 Distributed 20–37 W** para explorar el circuito EL34 de mayor tensión. Iguala el volumen con Output Trim antes de compararlo con EL84.
- Al bajar Negative Feedback se perciben más los armónicos y cambios de nivel de lazo abierto; al subirlo, la respuesta de lazo cerrado queda más controlada. Si una combinación extrema activa el bypass de seguridad, vuelve a un preset.
- Baja Wet/Dry Mix si solo quieres una aportación sutil del circuito.

### Disposición del Panel

Los 20 parámetros se reparten en cinco pestañas situadas bajo el desplegable **Preset**.

- **Input** - Input Volume, Input Reference, Source Z
- **Driver** - Tube, Bias, Plate, Supply, Negative Feedback
- **Power** - Output Circuit, Power Tubes, Output B+, Cathode Resistor
- **Transformer** - Screen Tap, Transformer Primary, Assumed Speaker Load, Actual Speaker Load
- **Output** - Output Trim, Output Safety Trim, Auto Gain Reduction, Wet/Dry Mix

El desplegable Preset empieza por **Custom** y continúa con los grupos **Listening (THD-matched)** y **Circuit**; Custom aparece cuando los ajustes actuales no coinciden con ningún preset; los ajustes de protección de salida (Output Safety Trim y Auto Gain Reduction) no forman parte de esa comparación. Mientras Output Circuit sea Line, los siete controles del circuito de potencia de las pestañas Power y Transformer se muestran atenuados. Siguen siendo ajustables y conservan sus valores.

### Presets de Circuito y Valores Predeterminados

El plugin se inicia con el preset de escucha **EL84 Pentode @2%**. Un preset escribe el circuito completo de la tabla; cualquier cambio posterior crea un ajuste personalizado.

| Circuit Preset | Output Circuit | Driver / válvulas de salida | Negative Feedback | Ajustes de potencia | Entrada / salida |
| --- | --- | --- | ---: | --- | --- |
| Line Default | Line | 12AU7 / — | 30dB | Conserva los controles de potencia, pero se muestran atenuados | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim +9dB |
| EL84 Pentode 10 W | Push-Pull Power | 12AX7 / EL84 ×2 | 3dB | Output B+ 329.696 V, Cathode Resistor 270 Ω / valve, Screen Tap 0%, Transformer Primary 8.0 kΩ, Assumed Speaker Load 15 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim 0dB |
| EL84 Distributed 10 W | Push-Pull Power | 12AX7 / EL84 ×2 | 3dB | Output B+ 330.107 V, Cathode Resistor 270 Ω / valve, Screen Tap 20%, Transformer Primary 6.6 kΩ, Assumed Speaker Load 15 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim 0dB |
| EL34 Distributed 20–37 W | Push-Pull Power | 12AX7 / EL34 ×2 | 4dB | Output B+ 443.775 V, Cathode Resistor 470 Ω / valve, Screen Tap 43%, Transformer Primary 6.6 kΩ, Assumed Speaker Load 8 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim 0dB |

Los cuatro presets usan Bias 0%, Plate 250 V, Source Z 10 kΩ, Supply 10 kΩ y Wet/Dry Mix 100%. Cada preset ajusta además Actual Speaker Load al valor de su Assumed Speaker Load, de modo que parte del punto de diseño del circuito.

### Presets de Escucha

El grupo **Listening (THD-matched)** contiene siete ajustes calibrados. Cada uno hereda todos los valores de circuito del preset de Circuit en el que se basa y solo se calibran Input Volume, Input Reference y Output Trim, de modo que el circuito en sí no cambia. Los siete quedan dentro de ±0.0005dB del mismo nivel a 1 kHz, así que al cambiar de uno a otro varía el carácter y no el volumen.

| Listening Preset | Basado en | Cambio de circuito | Input Volume | Input Reference | Output Trim |
| --- | --- | --- | ---: | ---: | ---: |
| Line 12AU7 @1% | Line Default | — | 0dB | 20 Vpk | -7.749dB |
| Line 12AT7 @1% | Line Default | Tube 12AT7 | -3.6973dB | 2.828 Vpk | -9.42dB |
| Line 12AX7 @1% | Line Default | Tube 12AX7 | -4.4805dB | 2.828 Vpk | -11.276dB |
| Line 12AU7 Open-Loop @3% | Line Default | Negative Feedback 0dB | -16.793dB | 2.828 Vpk | +26.427dB |
| EL84 Pentode @2% | EL84 Pentode 10 W | — | -55.9648dB | 2.828 Vpk | +4.626dB |
| EL84 Distributed @2% | EL84 Distributed 10 W | — | -52.9414dB | 2.828 Vpk | +4.908dB |
| EL34 Distributed @2% | EL34 Distributed 20–37 W | — | -43.6504dB | 2.828 Vpk | +5.212dB |

El circuito de línea con 12AU7 se queda algo por debajo del 1% de distorsión incluso en el tope de Input Reference, así que Line 12AU7 @1% se sitúa en el valor máximo que alcanza ese circuito.

### Parámetros
- **Preset** - Carga un preset de Circuit (Line Default o uno de los tres circuitos de potencia completos) o uno de los ajustes de Listening (THD-matched)
- **Input Volume** (-96 a 0dB) - Atenuador pasivo situado después del terminal de entrada
  - 0dB corresponde a la apertura total y nunca amplifica la tensión del terminal
  - Los valores más bajos reducen la tensión que entra en Stage 1 y aumentan el margen interno
- **Tube** (12AX7, 12AT7 o 12AU7) - Selecciona las válvulas del driver de dos etapas
  - 12AX7 ofrece la mayor ganancia de tensión y es la que se fuerza con más facilidad
  - 12AT7 ofrece una ganancia intermedia
  - 12AU7 ofrece menos ganancia y más margen
  - En Power, este circuito sigue siendo el driver y alimenta el inversor de fase 12AX7 fijo a través de un control de volumen fijo; cambiar Tube reinicia el estado para la válvula seleccionada
- **Bias** (-50 a +50%) - Desplaza el punto de operación de polarización de cátodo
  - Al subirlo, disminuye la resistencia de cátodo modelada y las etapas se desplazan hacia una corriente mayor
  - Al bajarlo, aumenta la resistencia de cátodo y las etapas se desplazan hacia una corriente menor
- **Plate** (150 a 300V) - Ajusta la tensión de alimentación de placa modelada
  - Al subirlo suele aumentar el margen de tensión y la respuesta se vuelve más firme
  - Al bajarlo, la compresión y el comportamiento no lineal aparecen antes
- **Source Z** (0.6 a 100kΩ) - Ajusta la impedancia de la fuente que alimenta la primera etapa
  - Al subirla aumenta la interacción con las capacitancias de entrada modeladas, lo que suaviza los agudos y los transitorios
  - Al bajarla, la entrada se excita con más firmeza y conserva más energía de alta frecuencia
- **Supply** (0.1 a 47kΩ) - Ajusta la resistencia de la alimentación B+ modelada
  - Al subirla se produce una mayor caída de B+ cuando las etapas consumen corriente, lo que acentúa la caída de alimentación
  - Al bajarla, la alimentación se vuelve más rígida y varía menos
- **Negative Feedback** (0 a 30dB) - Ajusta la realimentación negativa global calibrada
  - Line devuelve la respuesta de placa de la segunda etapa; Push-Pull Power usa un devanado fijo de realimentación del secundario
  - Al aumentarla suelen reducirse la ganancia y la distorsión de lazo abierto y la respuesta se vuelve más firme; 0dB abre el lazo
  - El amortiguamiento eléctrico de la carga del altavoz nace de este mismo lazo, así que subirla también refuerza el control del amplificador sobre la carga
- **Output Trim** (-48 a +48dB) - Aplica una calibración digital de nivel después del circuito modelado
  - Solo cambia el nivel de la señal procesada y no aumenta el margen interno de las etapas de válvulas
- **Output Safety Trim** (-96 a 0dB) - Aplica un recorte lineal después del circuito modelado, independiente de Output Trim, para que la protección de nivel de salida disponga de su propio control
  - Auto Gain Reduction solo baja este recorte; nunca escribe en Output Trim
  - El deslizador y su casilla de valor muestran el recorte efectivo, es decir, el valor que usted fija menos la reducción automática aplicada en ese momento; el ajuste almacenado es el último valor que usted fijó, y es el que se guarda
  - Al tomar el deslizador, el valor efectivo mostrado pasa a ser su ajuste, de modo que el nivel no salta, y en ese momento se borra la reducción acumulada
- **Auto Gain Reduction** (activado de forma predeterminada) - Permite que la protección de nivel de salida reduzca Output Safety Trim por sí sola
  - Con la opción desactivada no se acumula ninguna reducción nueva y la reducción ya aplicada se mantiene
- **Wet/Dry Mix** (0 a 100%) - Mezcla la señal original y la procesada, alineadas en el tiempo
  - Los valores bajos conservan más señal original; los altos realzan la respuesta del modelo de válvulas
  - Incluso al 0%, la ruta original conserva un retardo de 64 samples para mantener la alineación
- **Input Reference** (0.100 a 20.000 Vpk) - Ajusta la tensión de pico del terminal de entrada que representa un pico digital de 0dBFS
  - 2.828 Vpk corresponde a una onda sinusoidal de 2 Vrms a escala completa; 5.657 Vpk corresponde a 4 Vrms
  - Stage 1 recibe Input Reference multiplicado por Input Volume antes del sobremuestreo
  - Es una calibración física de entrada, no un control adicional de excitación
- **Output Circuit** (Line o Push-Pull Power) - Selecciona la topología. Line termina después del driver de dos etapas; Power añade el inversor de fase, las válvulas de salida, el transformador y la carga
- **Power Tubes** (EL84 ×2 o EL34 ×2) - Selecciona el modelo de corriente de las válvulas de salida y sus componentes; solo actúa en Power
  - Ambos modelos siguen datos reales de válvulas de salida en placa, pantalla y rejilla, incluido el corte total que se alcanza al llevar la rejilla lo bastante negativa
- **Output B+** (300 a 470 V) - Ajusta la alimentación de potencia; al subirla aumentan la excursión disponible y la disipación de las válvulas
- **Cathode Resistor** (270 a 500 Ω / valve) - Ajusta la resistencia de bias de cada válvula; al subirla baja la corriente de reposo y al bajarla aumenta
- **Screen Tap** (0%, 20% o 43%) - 0% usa la alimentación de pantalla fija; 20% y 43% conectan las pantallas a las tomas primarias correspondientes para carga distribuida (ultralineal)
  - La toma es una relación de espiras, así que las pantallas siguen esa proporción del acoplamiento magnético del devanado primario
- **Transformer Primary** (6.0, 6.6 u 8.0 kΩ) - Selecciona la impedancia primaria placa a placa y, junto con Assumed Speaker Load, la relación de espiras
- **Assumed Speaker Load** (4, 8, 15 o 16 Ω) - Selecciona la toma del secundario y la impedancia nominal sobre la que está diseñado el circuito. Cada opción usa una carga eléctrica RLC dependiente de la frecuencia, no una simple resistencia, y afecta a la carga del transformador y a la realimentación
- **Actual Speaker Load** (2 a 32 Ω) - Ajusta la impedancia del altavoz realmente conectado a esa toma
  - La red de carga se escala según su relación con Assumed Speaker Load, de modo que se conservan la frecuencia de resonancia y el Q y solo cambia el nivel de impedancia
  - La relación de espiras sigue basándose en Assumed Speaker Load, así que una discrepancia refleja otra impedancia hacia las válvulas de salida y modifica el amortiguamiento, la potencia disponible y la excitación; con ambos valores iguales el circuito trabaja en su punto de diseño

### Protección del Nivel de Salida

Los presets de Circuit no están igualados en volumen entre sí. Cambiar Tube de 12AU7 a 12AX7 sube el nivel unos 25dB, y cambiar Output Circuit de Line a Push-Pull Power lo sube unos 33dB, porque ambos circuitos se normalizan con referencias de fondo de escala distintas. Output Safety Trim y Auto Gain Reduction protegen de ese salto al equipo conectado a la salida.

- Cada vez que la magnitud de una muestra de salida supera 0 dBFS de pico, Output Safety Trim se reduce de inmediato exactamente en lo que esa muestra se excede. Se examinan todas las muestras, así que no hay ventana de detección ni promediado. El umbral es un valor de política fijo.
- La reducción se aplica mediante una rampa unidireccional de 20 ms, de modo que el nivel se mueve sin escalón.
- Solo reduce y nunca restaura. No hay release ni recuperación, así que no es un limitador ni un nivelador automático.
- El deslizador y su casilla de valor muestran el recorte efectivo, su ajuste menos la reducción aplicada en ese momento. El ajuste almacenado sigue siendo el último valor que usted fijó, y es el que se guarda.
- La reducción acumulada se borra cuando usted mismo toma Output Safety Trim. En ese momento el valor efectivo mostrado pasa a ser su ajuste, de modo que el nivel no salta.
- Cargar un preset devuelve Output Safety Trim a 0dB. La reducción acumulada se borra cuando cambia el propio valor del recorte o cuando una sola escritura cambia dos o más valores a la vez, como suele hacer la carga de un preset; volver a seleccionar el preset en el que ya está el circuito tras mover un solo control cambia únicamente ese valor y conserva la reducción.
- Con Auto Gain Reduction desactivado no se acumula ninguna reducción nueva y la reducción ya aplicada se mantiene.
- La reducción actual se indica en la línea de estado bajo el gráfico, incluso cuando es de 0.0 dB.
- El mecanismo queda fuera del modelo del amplificador. La resolución del circuito, los armónicos, la compresión y la caída de la alimentación no cambian; solo cambia el nivel de salida, nunca el carácter de la sobrecarga. Lo que suprime es el rebasamiento digital de fondo de escala en la salida, no la distorsión que produce el modelo.

### Bypass de Seguridad y Recuperación

- Si se detecta oscilación de realimentación, la señal procesada se desvanece hacia la ruta original alineada en latencia y se enclava el bypass seguro. Baja Negative Feedback, elige un preset o cambia otro ajuste del circuito. El nuevo ajuste se prueba manteniendo la salida original; si es estable, la señal procesada vuelve suavemente, y si no, continúa el bypass.
- Ante otro fallo de seguridad de procesamiento, el plugin cambia a la salida original segura. Restaura el circuito predeterminado y vuelve a cargar el efecto.
- Las frecuencias o modos de canal no compatibles, WebAssembly no disponible y la detención del motor también activan el bypass. El estado bajo el HUD indica qué hacer.

### Cómo Leer el HUD
- **Input Reference (0 dBFS)** muestra la tensión del terminal como Vpk, el valor Vrms de una onda sinusoidal y el valor de escala completa correspondiente en dBu (**dBuFS**)
- **Stage 1 External Input (0 dBFS)** muestra la tensión de pico después de Input Volume y antes de la red de entrada modelada
- **Stage 1 bias** y **Stage 2 bias** muestran la tensión actual de bias de cátodo de los canales izquierdo y derecho
- **B+** muestra la tensión de alimentación instantánea después de la caída modelada
- **Plate − B+ sag** muestra la tensión de placa de cada etapa respecto a B+; un valor más negativo indica una caída mayor
- En Line, los dos paneles muestran las características de placa y los puntos de operación recientes de Stage 1 y Stage 2, dibujados como puntos sueltos y no como una línea continua
  - El eje horizontal es la tensión ánodo-cátodo, **Vak (V)**, y el vertical es la corriente de placa, **Ia (mA)**
  - Las curvas grises finas son las características de placa estáticas de la válvula para varios valores de **Vgk**; la línea discontinua más clara es la recta de carga del circuito
  - El cian corresponde al canal izquierdo y el naranja al derecho; una nube de puntos más amplia indica que la etapa cubre un intervalo de operación mayor
- En Push-Pull Power, los paneles pasan a las rectas de carga **Push** y **Pull** y dibujan como puntos las corrientes recientes de las dos válvulas de salida
- **Power LTP Balance** muestra la tensión diferencial del inversor de fase y **Power B+** la alimentación de potencia después de la caída
- **Speaker Output (100 ms)** y **Speaker Real Power (100 ms)** son mediciones eléctricas en ventanas no solapadas de 100 ms. Real Power usa la tensión y corriente instantáneas, no una simple operación Vrms²/impedancia nominal
- **Transformer Flux** muestra el flujo magnético modelado en webers. Las lecturas de potencia solo son significativas con Push-Pull Power
- El estado bajo el gráfico indica si el procesamiento se está cargando, está activo o está en bypass seguro, y muestra siempre la reducción actual de la protección de salida en dB, incluso cuando es de 0.0 dB

### Requisitos de Procesamiento y Latencia
- Tube Simulator procesa audio a 44.1, 48, 88.2, 96, 176.4 y 192 kHz mediante WebAssembly
- La familia de 44.1 kHz se procesa internamente a 352.8 kHz, y la familia de 48 kHz, a 384 kHz
- A 44.1 o 48 kHz, la advertencia general de frecuencia de muestreo baja de la aplicación permanece visible porque la fuente no contiene la información de alta frecuencia disponible a frecuencias superiores
- Admite Stereo y pares de canales; con otras frecuencias o modos de canal utiliza la ruta de bypass
- Los filtros de sobremuestreo añaden una latencia fija de 64 samples en todas las frecuencias compatibles (aproximadamente 1.45ms a 44.1 kHz y 0.33ms a 192 kHz)
