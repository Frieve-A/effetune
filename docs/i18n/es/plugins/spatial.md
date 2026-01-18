---
title: "Spatial Plugins - EffeTune"
description: "Spatial audio plugins including Stereo Blend, Crossfeed Filter, MS Matrix, and Multiband Balance."
lang: en
---

# Plugins de Audio Espacial

Una colección de plugins que mejoran cómo suena la música en tus auriculares o altavoces ajustando el balance estéreo (izquierda y derecha). Estos efectos pueden hacer que tu música suene más espaciosa y natural, especialmente al escuchar con auriculares.

## Lista de Plugins

- [Crossfeed Filter](#crossfeed-filter) - Filtro de crossfeed para auriculares para imagen estéreo natural
- [MS Matrix](#ms-matrix) - Ajusta la imagen estéreo controlando por separado los niveles Mid y Side, con un intercambio opcional Left/Right  
- [Multiband Balance](#multiband-balance) - Control de balance estéreo dependiente de frecuencia de 5 bandas
- [Stereo Blend](#stereo-blend) - Controla el ancho estéreo desde mono hasta estéreo mejorado

## Crossfeed Filter

Un filtro de crossfeed para auriculares que simula la diafonía acústica natural que ocurre al escuchar a través de altavoces. Este efecto ayuda a reducir la separación estéreo exagerada que a menudo se experimenta con auriculares, creando una experiencia de escucha más natural y cómoda que imita la forma en que el sonido llega a nuestros oídos en un entorno acústico real.

### Características principales
- Simula la diafonía acústica natural para escucha con auriculares
- Nivel de crossfeed y temporización ajustables
- Filtrado paso bajo para imitar la diafonía dependiente de frecuencia
- Procesamiento solo estéreo (automáticamente bypassado para señales mono)

### Parámetros
- **Level** (-60 dB a 0 dB): Controla la cantidad de señal de crossfeed
  - Valores más bajos (-20 dB a -6 dB): Crossfeed sutil y natural
  - Valores más altos (-6 dB a 0 dB): Efecto más pronunciado
- **Delay** (0 ms a 1 ms): Simula la diferencia de tiempo de la diafonía acústica
  - Valores más bajos (0.1-0.3 ms): Imagen más ajustada y enfocada
  - Valores más altos (0.3-1.0 ms): Presentación más espaciosa, similar a altavoces
- **LPF Freq** (100 Hz a 20000 Hz): Controla la respuesta de frecuencia del crossfeed
  - Valores más bajos (500-1000 Hz): Diafonía más natural dependiente de frecuencia
  - Valores más altos (1000-20000 Hz): Respuesta de frecuencia más amplia

### Ajustes recomendados

1. Escucha Natural con Auriculares
   - Level: -12 dB
   - Delay: 0.3 ms
   - LPF Freq: 700 Hz
   - Efecto: Crossfeed sutil para escucha cómoda a largo plazo

2. Simulación de Altavoces
   - Level: -6 dB
   - Delay: 0.5 ms
   - LPF Freq: 1000 Hz
   - Efecto: Presentación más pronunciada similar a altavoces

3. Mejora Sutil
   - Level: -20 dB
   - Delay: 0.2 ms
   - LPF Freq: 500 Hz
   - Efecto: Crossfeed muy suave para oyentes sensibles

### Guía de aplicación

1. Optimización de Auriculares
   - Comienza con ajustes conservadores (-15 dB level, 0.3 ms delay)
   - Ajusta el nivel para comodidad y naturalidad
   - Afina el delay para percepción espacial
   - Usa LPF para controlar la respuesta de frecuencia

2. Consideraciones de Estilo Musical
   - Clásica/Jazz: Niveles más bajos (-15 a -10 dB) para presentación natural
   - Rock/Pop: Niveles moderados (-10 a -6 dB) para energía
   - Electrónica: Niveles más altos (-6 a 0 dB) para espacialidad

3. Entorno de Escucha
   - Entornos tranquilos: Niveles más bajos para efecto sutil
   - Entornos ruidosos: Niveles más altos para mejor enfoque
   - Sesiones de escucha largas: Ajustes conservadores para reducir fatiga

### Guía de inicio rápido

1. Configuración inicial
   - Establece Level en -12 dB
   - Establece Delay en 0.3 ms
   - Establece LPF Freq en 700 Hz

2. Ajuste fino
   - Ajusta Level para la cantidad deseada de crossfeed
   - Modifica Delay para percepción espacial
   - Afina LPF Freq para respuesta de frecuencia

3. Optimización
   - Escucha para presentación natural y cómoda
   - Evita ajustes excesivos que suenen artificiales
   - Prueba con varios estilos musicales

Recuerda: El Crossfeed Filter está diseñado para hacer la escucha con auriculares más natural y cómoda. Comienza con ajustes conservadores y ajusta gradualmente para encontrar el equilibrio óptimo para tus preferencias de escucha y material musical.

## MS Matrix

Un procesador mid/side flexible que te permite controlar de forma independiente el centro (mid) y el ancho (side) de tu señal estéreo. Utiliza controles de ganancia sencillos y un intercambio opcional Left/Right para ajustar con precisión cómo se sitúa tu audio en el campo estéreo sin enrutamientos complejos.

### Características principales
- Ganancia Mid y Side por separado (–18 dB a +18 dB)  
- Selector Mode: Encode (Stereo→M/S) o Decode (M/S→Stereo)  
- Intercambio opcional Left/Right antes de la codificación o después de la decodificación  
- Cambios de parámetros sin clics para ajustes fluidos  

### Parámetros
- **Mode** (Encode/Decode)  
- **Mid Gain** (–18 dB a +18 dB): Ajusta el nivel del contenido central  
- **Side Gain** (–18 dB a +18 dB): Ajusta el nivel de la diferencia estéreo (ancho)  
- **Swap L/R** (Off/On): Intercambia los canales izquierdo y derecho antes de la codificación o después de la decodificación  

### Ajustes recomendados
1. **Ensanchamiento sutil**  
   - Mode: Decode  
   - Mid Gain: 0 dB  
   - Side Gain: +3 dB  
   - Swap: Off  
2. **Enfoque central**  
   - Mode: Decode  
   - Mid Gain: +3 dB  
   - Side Gain: –3 dB  
   - Swap: Off  
3. **Volteo creativo**  
   - Mode: Encode  
   - Mid Gain: 0 dB  
   - Side Gain: 0 dB  
   - Swap: On  

### Guía de inicio rápido
1. Selecciona **Mode** para la conversión  
2. Ajusta **Mid Gain** y **Side Gain**  
3. Activa **Swap L/R** para la corrección de canales o inversión creativa  
4. Activa Bypass para comparar y verificar que no haya problemas de fase  

## Multiband Balance

Un procesador espacial sofisticado que divide el audio en cinco bandas de frecuencia y permite el control de balance estéreo independiente de cada banda. Este plugin permite un control preciso de la imagen estéreo a través del espectro de frecuencias, ofreciendo posibilidades creativas para el diseño de sonido y la mezcla, así como aplicaciones correctivas para grabaciones estéreo problemáticas.

### Características Principales
- Control de balance estéreo dependiente de frecuencia de 5 bandas
- Filtros de cruce Linkwitz-Riley de alta calidad
- Control de balance lineal para ajuste estéreo preciso
- Procesamiento independiente de canales izquierdo y derecho
- Cambios de parámetros sin clics con manejo automático de fundidos

### Parámetros

#### Frecuencias de Cruce
- **Freq 1** (20-500 Hz): Separa bandas bajas y medio-bajas
- **Freq 2** (100-2000 Hz): Separa bandas medio-bajas y medias
- **Freq 3** (500-8000 Hz): Separa bandas medias y medio-altas
- **Freq 4** (1000-20000 Hz): Separa bandas medio-altas y altas

#### Controles de Banda
Cada banda tiene control de balance independiente:
- **Band 1 Bal.** (-100% a +100%): Controla balance estéreo de frecuencias bajas
- **Band 2 Bal.** (-100% a +100%): Controla balance estéreo de frecuencias medio-bajas
- **Band 3 Bal.** (-100% a +100%): Controla balance estéreo de frecuencias medias
- **Band 4 Bal.** (-100% a +100%): Controla balance estéreo de frecuencias medio-altas
- **Band 5 Bal.** (-100% a +100%): Controla balance estéreo de frecuencias altas

### Ajustes Recomendados

1. Mejora Estéreo Natural
   - Banda Baja (20-100 Hz): 0% (centrado)
   - Medio-Baja (100-500 Hz): ±20%
   - Media (500-2000 Hz): ±40%
   - Medio-Alta (2000-8000 Hz): ±60%
   - Alta (8000+ Hz): ±80%
   - Efecto: Crea una expansión estéreo graduada que aumenta con la frecuencia

2. Mezcla Enfocada
   - Banda Baja: 0%
   - Medio-Baja: ±10%
   - Media: ±30%
   - Medio-Alta: ±20%
   - Alta: ±40%
   - Efecto: Mantiene el enfoque central mientras añade amplitud sutil

3. Paisaje Sonoro Inmersivo
   - Banda Baja: 0%
   - Medio-Baja: ±40%
   - Media: ±60%
   - Medio-Alta: ±80%
   - Alta: ±100%
   - Efecto: Crea un campo sonoro envolvente con bajos anclados

### Guía de Aplicación

1. Mejora de Mezcla
   - Mantén las frecuencias bajas (por debajo de 100 Hz) centradas para bajos estables
   - Aumenta gradualmente el ancho estéreo con la frecuencia
   - Usa ajustes moderados (±30-50%) para mejora natural
   - Monitorea en mono para verificar problemas de fase

2. Solución de Problemas
   - Corrige problemas de fase en rangos de frecuencia específicos
   - Ajusta bajos sin foco centrando las frecuencias bajas
   - Reduce artefactos estéreo ásperos en altas frecuencias
   - Arregla pistas estéreo mal grabadas

3. Diseño de Sonido Creativo
   - Crea movimiento dependiente de frecuencia
   - Diseña efectos espaciales únicos
   - Construye paisajes sonoros inmersivos
   - Mejora instrumentos o elementos específicos

4. Ajuste del Campo Estéreo
   - Ajuste fino del balance estéreo por banda de frecuencia
   - Corrección de distribución estéreo desigual
   - Mejora de la separación estéreo donde sea necesario
   - Mantenimiento de compatibilidad mono

### Guía de Inicio Rápido

1. Configuración Inicial
   - Comienza con todas las bandas centradas (0%)
   - Establece frecuencias de cruce en puntos estándar:
     * Freq 1: 100 Hz
     * Freq 2: 500 Hz
     * Freq 3: 2000 Hz
     * Freq 4: 8000 Hz

2. Mejora Básica
   - Mantén Band 1 (bajos) centrada
   - Haz pequeños ajustes a las bandas más altas
   - Escucha los cambios en la imagen espacial
   - Verifica compatibilidad mono

3. Ajuste Fino
   - Ajusta puntos de cruce para coincidir con tu material
   - Realiza cambios graduales en las posiciones de banda
   - Escucha artefactos no deseados
   - Compara con bypass para perspectiva

Recuerda: El Multiband Balance es una herramienta poderosa que requiere ajuste cuidadoso. Comienza con ajustes sutiles y aumenta la complejidad según sea necesario. Siempre verifica tus ajustes tanto en estéreo como en mono para asegurar compatibilidad.

## Stereo Blend

Un efecto que ayuda a lograr un campo sonoro más natural ajustando el ancho estéreo de tu música. Es particularmente útil para escucha con auriculares, donde puede reducir la separación estéreo exagerada que a menudo ocurre con auriculares, haciendo la experiencia de escucha más natural y menos fatigante. También puede mejorar la imagen estéreo para escucha con altavoces cuando sea necesario.

### Guía de Mejora de Escucha
- Optimización para Auriculares:
  - Reduce el ancho estéreo (60-90%) para una presentación más natural, similar a altavoces
  - Minimiza la fatiga auditiva por separación estéreo excesiva
  - Crea un escenario sonoro frontal más realista
- Mejora para Altavoces:
  - Mantiene la imagen estéreo original (100%) para reproducción precisa
  - Mejora sutil (110-130%) para escenario sonoro más amplio cuando sea necesario
  - Ajuste cuidadoso para mantener campo sonoro natural
- Control de Campo Sonoro:
  - Enfoque en presentación natural y realista
  - Evita ancho excesivo que podría sonar artificial
  - Optimiza para tu entorno específico de escucha

### Parámetros
- **Stereo** - Controla el ancho estéreo (0-200%)
  - 0%: Mono completo (canales izquierdo y derecho sumados)
  - 100%: Imagen estéreo original
  - 200%: Estéreo mejorado con ancho máximo (L-R/R-L)

### Ajustes Recomendados para Diferentes Escenarios de Escucha

1. Escucha con Auriculares (Natural)
   - Stereo: 60-90%
   - Efecto: Separación estéreo reducida
   - Perfecto para: Sesiones largas de escucha, reducir fatiga

2. Escucha con Altavoces (Referencia)
   - Stereo: 100%
   - Efecto: Imagen estéreo original
   - Perfecto para: Reproducción precisa

3. Mejora de Altavoces
   - Stereo: 110-130%
   - Efecto: Mejora sutil de ancho
   - Perfecto para: Salas con colocación cercana de altavoces

### Guía de Optimización por Estilo Musical

- Música Clásica
  - Auriculares: 70-80%
  - Altavoces: 100%
  - Beneficio: Perspectiva natural de sala de conciertos

- Jazz y Acústica
  - Auriculares: 80-90%
  - Altavoces: 100-110%
  - Beneficio: Sonido de conjunto íntimo y realista

- Rock y Pop
  - Auriculares: 85-95%
  - Altavoces: 100-120%
  - Beneficio: Impacto balanceado sin ancho artificial

- Música Electrónica
  - Auriculares: 90-100%
  - Altavoces: 100-130%
  - Beneficio: Espaciosidad controlada manteniendo el enfoque

### Guía de Inicio Rápido

1. Elige Tu Configuración de Escucha
   - Identifica si estás usando auriculares o altavoces
   - Esto determina tu punto de partida para el ajuste

2. Comienza con Ajustes Conservadores
   - Auriculares: Comienza en 80%
   - Altavoces: Comienza en 100%
   - Escucha la colocación natural del sonido

3. Ajuste Fino para Tu Música
   - Haz ajustes pequeños (5-10% a la vez)
   - Enfócate en lograr un campo sonoro natural
   - Presta atención al confort de escucha

Recuerda: El objetivo es lograr una experiencia de escucha natural y cómoda que reduzca la fatiga y mantenga la presentación musical pretendida. Evita ajustes extremos que podrían sonar impresionantes al principio pero se vuelven fatigantes con el tiempo.