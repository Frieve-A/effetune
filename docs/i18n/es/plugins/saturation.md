---
title: "Plugins de saturación - EffeTune"
description: "Plugins de saturación y distorsión como Saturation, Exciter, Hard Clipping y otros."
lang: es
---

# Plugins de Saturación

Una colección de plugins que agregan calidez y carácter a tu música. Estos efectos pueden hacer que la música digital suene más analógica y agregar una agradable riqueza al sonido, similar a cómo el equipo de audio vintage colorea el sonido.

## Lista de Plugins

- [Bandwidth Extender](#bandwidth-extender) - Genera agudos por encima de un corte detectado o especificado
- [Dynamic Saturation](#dynamic-saturation) - Simula el desplazamiento no lineal de los conos de altavoces
- [Exciter](#exciter) - Agrega contenido armónico para mejorar la claridad y presencia
- [Hard Clipping](#hard-clipping) - Agrega intensidad y borde al sonido
- [Harmonic Distortion](#harmonic-distortion) - Añade carácter con distorsión no lineal ajustable de 2º a 5º orden
- [Multiband Saturation](#multiband-saturation) - Moldea los rangos de frecuencia bajos, medios y altos de forma independiente
- [Saturation](#saturation) - Agrega calidez y riqueza como equipo vintage
- [Sub Synth](#sub-synth) - Añade una señal filtrada de baja frecuencia para reforzar los graves
- [Tube Simulator](#tube-simulator) - Modela etapas de línea a válvulas y amplificadores de potencia push-pull o single-ended

## Bandwidth Extender

Bandwidth Extender está pensado para audio con un corte de agudos claro, como algunos MP3 de baja tasa de bits. Analiza ambos canales conjuntamente y añade contenido nuevo solo por encima del límite detectado o especificado. No recupera la forma de onda original; en Auto permanece inactivo si no encuentra un corte estable.

La banda generada consta de dos componentes ajustables por separado: una continuación armónica relacionada con la entrada y ruido conformado determinista. La señal original se conserva mientras se añaden estos componentes.

### Guía de mejora auditiva

- Empieza con **Auto** y ambos controles Amount al 100%, su valor predeterminado. Usa **Manual** si conoces el corte exacto.
- Reduce **Noise Amount** para material tonal sostenido o **Harmonic Amount** para percusión y sonidos de respiración. Mantén ambos activos en material mixto.
- Compáralo con bypass al mismo nivel. No lo uses como abrillantador general de audio de banda completa; para eso está Exciter.

### Parámetros

- **Harmonic Amount** (0-200%, predeterminado: 100%) controla solo la continuación armónica: 0% la elimina, 100% es su nivel de referencia y 200% la duplica sin alterar el ruido ni la señal seca.
- **Noise Amount** (0-200%, predeterminado: 100%) controla solo el ruido conformado: 0% lo elimina, 100% es su nivel de referencia y 200% lo duplica sin alterar los armónicos ni la señal seca.
- **Cutoff** elige **Auto**, que busca una caída espectral pronunciada y persistente común a ambos canales, o **Manual**. En Manual, la banda generada se limita automáticamente al rango disponible durante la reproducción.
- **Manual Cutoff** (6000-20000 Hz) fija el inicio de la generación en modo Manual.

Bandwidth Extender añade unos 21 ms de latencia. Si no puede funcionar con la frecuencia de muestreo, la configuración de canales o el dispositivo actuales, el panel muestra un mensaje de bypass y el audio no cambia. Usa una configuración compatible o desactiva el plugin.

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

Tube Simulator añade los armónicos, la compresión y la respuesta de alimentación que cambian con la señal en circuitos de línea y potencia a válvulas. **Line** utiliza solo el driver, **Push-Pull Power** ofrece circuitos equilibrados con EL84, EL34, 6L6GC y KT88, y **SE Triode** ofrece circuitos single-ended con 300B y 2A3. Ambos circuitos de potencia modelan también el núcleo del transformador de salida, cuya saturación magnética e histéresis añaden distorsión en los graves a alto volumen. Modela la carga eléctrica del altavoz vista por el amplificador, pero no añade el sonido de una pantalla ni de un micrófono.

### Guía de Ajuste del Sonido

- Para una coloración discreta, elige en el grupo **Pre** un preset con el sufijo **@0.01%** o **@0.1%**. Usa el sufijo **@1%** o **@2%** cuando quieras oír con más claridad los armónicos y la compresión.
- Elige **Pre** para el sonido de la etapa de línea, **Power** solo para la etapa de salida o **Pre+Power** para la ruta completa del amplificador.
- Empieza con **EL84 Distributed 10 W @2%** para un sonido push-pull contenido. Compáralo con **EL84 Pentode 10 W @2%** para obtener un carácter más firme y directo.
- Prueba **300B SE @2%** o **2A3 SE @2%** para conseguir armónicos pares más marcados y una respuesta single-ended más suave.
- Si el sonido queda demasiado comprimido o distorsionado, baja **Input Volume** y después iguala el volumen de escucha con **Output Trim**.
- Baja **Negative Feedback** para una respuesta más suelta y rica en armónicos; súbelo para un control más firme. En SE Triode, empieza en 3dB y mantente normalmente cerca de 0–6dB.
- Baja **Wet/Dry Mix** cuando solo quieras un toque del efecto.

### Disposición del Panel

Los controles se reparten en cinco pestañas bajo **Preset**.

- **Input** - Input Volume, Input Reference, Source Z
- **Driver** - Driver Type, Bias, Plate, Supply, Negative Feedback
- **Power** - Output Circuit; Power Tubes, Output B+ y Cathode Resistor para push-pull; SE Triode, SE B+ y SE Cathode Resistor para single-ended
- **Transformer** - Screen Tap, Push-Pull Primary, SE Primary, Assumed Speaker Load, Actual Speaker Load
- **Output** - Output Trim, Output Safety Trim, Auto Gain Reduction, Wet/Dry Mix

Las pestañas Power y Transformer muestran solo los controles que utiliza el Output Circuit seleccionado. **Custom** aparece al cambiar un parámetro de circuito o de tono con respecto a un preset.

### Elegir un Preset

Tube Simulator se inicia con **EL84 Pentode @2%**; al cambiar un parámetro de circuito o tono, el nombre del preset pasa a **Custom**, mientras que **Output Safety Trim** y **Auto Gain Reduction** no intervienen en la correspondencia del preset, por lo que modificarlos no cambia su nombre.

El sufijo del preset sirve como guía práctica de intensidad: **@0.01%** es muy sutil, **@0.1%** añade una coloración ligera y **@1%** o **@2%** hacen más evidentes los armónicos y la compresión. Los presets también ajustan Output Trim para facilitar la comparación, pero el volumen percibido puede variar según la música. Iguala el nivel con Output Trim antes de decidir qué sonido prefieres.

### Parámetros

- **Preset** - Carga un ajuste Pre, Power o Pre+Power.
- **Input Volume** (-96 a 0dB) - Reduce el nivel que alimenta el circuito elegido. Los valores más bajos reducen la compresión y la distorsión y aumentan el margen.
- **Driver Type** (12AX7, 12AT7, 12AU7 o Bypass) - Selecciona las válvulas del driver de dos etapas o lo retira de la ruta. 12AX7 ofrece la mayor ganancia, 12AT7 queda en medio y 12AU7 ofrece la menor ganancia y el mayor margen.
- **Bias** (-50 a +50%) - Desplaza el punto de polarización del driver. Al subirlo, las etapas se mueven hacia una corriente mayor; al bajarlo, hacia una menor, lo que cambia los armónicos y la compresión.
- **Plate** (150 a 300 V) - Ajusta la tensión de placa del driver. Los valores más altos suelen dar más margen; los más bajos hacen aparecer antes la compresión y la no linealidad.
- **Source Z** (0.6 a 100 kΩ) - Ajusta la impedancia de la fuente que alimenta la primera etapa. Los valores más altos pueden suavizar los agudos y los transitorios.
- **Supply** (0.1 a 47 kΩ) - Ajusta la resistencia de alimentación del driver. Los valores más altos producen más caída de alimentación; los más bajos dan una respuesta más firme.
- **Negative Feedback** (0 a 30dB) - Ajusta la realimentación negativa global. Al subirla suele reducirse la distorsión y reforzarse el control de la respuesta y del altavoz; 0dB abre el lazo.
- **Output Trim** (-48 a +48dB) - Iguala el volumen procesado sin cambiar la excitación dentro del circuito.
- **Output Safety Trim** (-96 a 0dB) - Es un control de nivel independiente para la protección de salida. Auto Gain Reduction solo reduce este control, no Output Trim.
- **Auto Gain Reduction** (activado de forma predeterminada) - Reduce automáticamente Output Safety Trim cuando la salida procesada se acercaría al máximo digital. Al desactivarlo no se añade reducción nueva, pero se conserva la ya aplicada.
- **Wet/Dry Mix** (0 a 100%) - Mezcla la señal procesada con la original. Los valores más bajos hacen que el efecto sea más sutil.
- **Input Reference** (0.100 a 300.000 Vpk) - Define la tensión de entrada representada por un pico digital a escala completa. Los valores más altos excitan más el circuito; usa Input Volume como ajuste principal de intensidad.
- **Output Circuit** (Line, Push-Pull Power o SE Triode) - Selecciona la topología. Line usa solo el driver; los otros dos modos añaden la etapa de potencia, el transformador y la carga del altavoz.
- **Power Tubes** (EL84 ×2, EL34 ×2, 6L6GC ×2 o KT88 ×2) - Selecciona las válvulas de salida push-pull y su carácter.
- **Output B+** (300 a 470 V) - Ajusta la alimentación de la etapa push-pull. Los valores más altos aumentan la excursión disponible y el margen de las válvulas.
- **Cathode Resistor** (270 a 500 Ω / valve) - Ajusta la resistencia de polarización de cada válvula push-pull. Al subirla baja la corriente de reposo; al bajarla aumenta.
- **SE Triode** (300B o 2A3) - Selecciona la válvula de salida single-ended.
- **SE B+** (250 a 450 V) - Ajusta la alimentación de la etapa single-ended.
- **SE Cathode Resistor** (700 a 1300 Ω) - Ajusta la resistencia de polarización de la válvula single-ended, cambiando el punto de trabajo y la compresión.
- **Screen Tap** (0%, 20% o 43%) - Selecciona la conexión de pantalla. 0% corresponde al funcionamiento pentodo; 20% y 43% ofrecen carga distribuida.
- **Push-Pull Primary** (6.0, 6.6 u 8.0 kΩ) - Ajusta la impedancia primaria del transformador push-pull y cambia la carga y la respuesta de las válvulas. También fija el flujo de saturación magnética del núcleo.
- **SE Primary** (2.5, 3.5 o 5.0 kΩ) - Ajusta la impedancia primaria del transformador single-ended. También determina cuánto flujo introduce una señal dada en el núcleo con entrehierro, así que las impedancias más altas alcanzan la saturación antes con el mismo nivel. La corriente de reposo del funcionamiento single-ended mantiene un flujo permanente en el núcleo, así que la señal lo satura de forma asimétrica y añade armónicos de orden par en los graves.
- **Assumed Speaker Load** (4, 8, 15 o 16 Ω) - Selecciona la impedancia nominal y la toma secundaria para las que está diseñado el circuito.
- **Actual Speaker Load** (2 a 32 Ω) - Ajusta la impedancia del altavoz conectado. Si difiere de Assumed Speaker Load, cambian la carga reflejada a las válvulas, el amortiguamiento y la potencia disponible; los valores iguales corresponden al punto de diseño.

### Protección del Nivel de Salida

Cambiar parámetros del circuito puede causar un salto de nivel importante. Con **Auto Gain Reduction** activado, Tube Simulator reduce **Output Safety Trim** cuando la salida procesada superaría la escala digital. La reducción se mantiene en lugar de recuperarse automáticamente y aparece en el estado bajo el gráfico.

- Si la reducción se hace grande, baja Input Volume o Output Trim y después vuelve a seleccionar un preset o ajusta Output Safety Trim.
- Desactiva Auto Gain Reduction solo cuando ya estés supervisando los picos de salida por otro medio.
- Esta protección reduce el nivel de salida; no elimina los armónicos ni la compresión creados dentro del circuito elegido.

### Bypass de Seguridad y Recuperación

- Si un ajuste inestable activa el bypass, baja Negative Feedback o selecciona un preset. El sonido procesado vuelve automáticamente cuando el ajuste se estabiliza.
- Si el estado sigue indicando bypass, restaura un preset y vuelve a cargar el efecto. Cuando el procesamiento no está disponible en el dispositivo, el audio pasa sin cambios.

### Cómo Leer el HUD

- Los puntos muestran posiciones de funcionamiento recientes. Cuanto más se extienden, más intensamente está excitando la música esa etapa.
- En Line, los paneles muestran las dos etapas del driver. Push-Pull muestra los dos lados de salida y SE Triode muestra los canales izquierdo y derecho.
- **Speaker Output** y **Speaker Real Power** indican cuánto se están excitando la etapa de potencia y la carga del altavoz.
- **Transformer Flux** muestra la magnitud del flujo concatenado del transformador de salida en Wb. Cuanto más empujan los graves esta lectura hacia arriba, más distorsión añade el propio transformador. En SE Triode la lectura incluye el flujo de polarización permanente del núcleo con entrehierro, así que se mantiene por encima de cero incluso sin señal.
- El estado bajo el gráfico indica si el efecto está activo o en bypass y muestra cualquier reducción automática de salida.

Tube Simulator añade un breve retardo de procesamiento de unos 0.3 a 1.5ms, según la frecuencia de muestreo.
