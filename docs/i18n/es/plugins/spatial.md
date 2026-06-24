---
title: "Plugins espaciales - EffeTune"
description: "Plugins de audio espacial como Stereo Blend, Crossfeed Filter, MS Matrix y Multiband Balance."
lang: es
---

# Plugins de audio espacial

Una colección de plugins que mejoran cómo suena la música en tus auriculares o altavoces ajustando el balance estéreo (izquierda y derecha). Estos efectos pueden hacer que tu música suene más espaciosa y natural, especialmente al escuchar con auriculares.

## Lista de Plugins

- [Crossfeed Filter](#crossfeed-filter) - Filtro de crossfeed para auriculares para imagen estéreo natural
- [MS Matrix](#ms-matrix) - Convierte estéreo a Mid/Side y de vuelta para cadenas avanzadas de ajuste estéreo
- [Multiband Balance](#multiband-balance) - Control de balance estéreo dependiente de frecuencia de 5 bandas
- [Stereo Blend](#stereo-blend) - Controla el ancho estéreo desde estéreo con polaridad lateral invertida, pasando por mono, hasta estéreo ampliado

## Crossfeed Filter

Un filtro de crossfeed para auriculares que simula la diafonía acústica natural que ocurre al escuchar a través de altavoces. Este efecto ayuda a reducir la separación estéreo exagerada que a menudo se experimenta con auriculares, creando una experiencia de escucha más natural y cómoda que imita la forma en que el sonido llega a nuestros oídos en un entorno acústico real.

### Características principales
- Simula la diafonía acústica natural para escucha con auriculares
- Nivel de crossfeed y temporización ajustables
- Filtrado paso bajo para imitar la diafonía dependiente de frecuencia
- Procesamiento solo estéreo (se bypassa automáticamente con señales mono u otras señales no estéreo)

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
   - Rock/Pop: Niveles moderados (-12 a -8 dB) pueden suavizar guitarras o voces paneadas al extremo manteniendo la energía
   - Electrónica o mezclas muy amplias: Usa niveles bajos a moderados (-18 a -10 dB) para conservar amplitud, o niveles más altos solo cuando quieras domar una separación izquierda-derecha excesiva

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

MS Matrix convierte audio estéreo normal a formato Mid/Side, o convierte audio Mid/Side de vuelta a estéreo normal. Úsalo cuando quieras ajustar por separado la información central y lateral dentro de una cadena de efectos, por ejemplo codificar a M/S, cambiar el nivel Mid o Side y después decodificar de vuelta a estéreo. Para ajustar de forma simple el ancho estéreo en música normal, [Stereo Blend](#stereo-blend) es la herramienta más directa.

### Características principales
- Ganancia Mid y Side por separado (–18 dB a +18 dB)  
- Selector Mode: Encode (Stereo→M/S) o Decode (M/S→Stereo)  
- Intercambio opcional Left/Right antes de la codificación o después de la decodificación  

### Parámetros
- **Mode** (Encode/Decode): Encode convierte estéreo izquierda/derecha en Mid en el canal izquierdo y Side en el canal derecho. Decode trata el canal izquierdo como Mid y el derecho como Side, y reconstruye estéreo normal.
- **Mid Gain** (–18 dB a +18 dB): Ajusta el nivel de Mid durante la conversión seleccionada.
- **Side Gain** (–18 dB a +18 dB): Ajusta el nivel de Side durante la conversión seleccionada.
- **Swap L/R** (Off/On): Intercambia los canales izquierdo y derecho antes de la codificación o después de la decodificación  

### Ajustes recomendados
1. **Ensanchamiento sutil para estéreo normal**
   - Primer MS Matrix: Mode: Encode, Mid Gain: 0 dB, Side Gain: +3 dB, Swap: Off
   - Segundo MS Matrix después: Mode: Decode, Mid Gain: 0 dB, Side Gain: 0 dB, Swap: Off
   - Efecto: Refuerza ligeramente el componente Side y devuelve el resultado a estéreo normal
2. **Enfoque central para estéreo normal**
   - Primer MS Matrix: Mode: Encode, Mid Gain: +3 dB, Side Gain: -3 dB, Swap: Off
   - Segundo MS Matrix después: Mode: Decode, Mid Gain: 0 dB, Side Gain: 0 dB, Swap: Off
   - Efecto: Adelanta voces y sonidos centrados mientras reduce el ambiente lateral
3. **Decodificar audio M/S existente**
   - Mode: Decode
   - Mid Gain: 0 dB
   - Side Gain: 0 dB
   - Swap: Off
   - Úsalo solo cuando la señal entrante ya esté en formato Mid/Side
4. **Volteo creativo**
   - Mode: Encode  
   - Mid Gain: 0 dB  
   - Side Gain: 0 dB  
   - Swap: On  

### Guía de inicio rápido
1. Decide si necesitas una sola conversión o una cadena completa Encode -> ajustar -> Decode.
2. Para escucha estéreo normal, coloca un MS Matrix en modo Encode y otro después en modo Decode.
3. Ajusta **Mid Gain** y **Side Gain** en la etapa Encode.
4. Activa **Swap L/R** solo para corrección de canales o inversión creativa.
5. Activa Bypass para comparar y asegurarte de que la imagen estéreo siga sonando natural.

## Multiband Balance

Un procesador de balance dependiente de frecuencia que divide el audio en cinco bandas y permite desplazar cada banda ligeramente hacia la izquierda o la derecha. Úsalo cuando graves, voces, platillos u otros rangos de frecuencia parezcan tirados hacia un lado y quieras reequilibrar solo esa parte del sonido sin mover toda la pista.

### Características Principales
- Control de balance estéreo dependiente de frecuencia de 5 bandas
- Filtros de cruce Linkwitz-Riley de alta calidad
- Control de balance lineal para ajuste estéreo preciso
- Procesamiento independiente de canales izquierdo y derecho
- Manejo automático de fundidos cuando se reinician los filtros de cruce

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

1. Corregir un Tirón de Agudos hacia la Derecha
   - Banda Baja (20-100 Hz): 0% (centrado)
   - Medio-Baja (100-500 Hz): 0%
   - Media (500-2000 Hz): 0%
   - Medio-Alta (2000-8000 Hz): -10% a -25%
   - Alta (8000+ Hz): -10% a -30%
   - Efecto: Mueve el contenido brillante ligeramente a la izquierda mientras mantiene estables los graves y las voces

2. Corregir un Tirón de Medios-Graves hacia la Izquierda
   - Banda Baja: 0%
   - Medio-Baja: +10% a +25%
   - Media: +5% a +15%
   - Medio-Alta: 0%
   - Alta: 0%
   - Efecto: Mueve el cuerpo cálido y las voces graves ligeramente a la derecha sin cambiar toda la imagen estéreo

3. Mantener Graves Centrados al Ajustar el Aire
   - Banda Baja: 0%
   - Medio-Baja: 0%
   - Media: 0%
   - Medio-Alta: +5% a +15%
   - Alta: +10% a +20%
   - Efecto: Mueve suavemente el ambiente superior hacia la derecha mientras el extremo grave permanece centrado

### Guía de Aplicación

1. Corrección de Balance de Escucha
   - Mantén las frecuencias bajas (por debajo de 100 Hz) centradas para bajos estables
   - Desplaza solo el rango de frecuencia que se siente descentrado
   - Usa primero valores pequeños con signo (aprox. 5-20%)
   - Comprueba la reproducción mono por si cambia el tono o el nivel

2. Solución de Problemas
   - Reequilibra rangos de frecuencia que se sienten demasiado a la izquierda o a la derecha
   - Ajusta bajos sin foco centrando las frecuencias bajas
   - Reduce artefactos estéreo ásperos en altas frecuencias
   - Mejora grabaciones en las que distintas partes del sonido se inclinan hacia lados diferentes

3. Efectos Creativos de Escucha
   - Crea colocaciones inusuales dependientes de frecuencia
   - Haz que las altas frecuencias se inclinen hacia un lado mientras los graves permanecen centrados
   - Construye una sensación de ambiente más amplia con pequeños desplazamientos de balance en bandas superiores

4. Ajuste del Campo Estéreo
   - Ajuste fino del balance estéreo por banda de frecuencia
   - Corrección de distribución estéreo desigual
   - Evita tratarlo como control de ancho estéreo; usa Stereo Blend cuando quieras ampliar o estrechar toda la imagen
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
  - Usa ancho negativo solo para inversión correctiva o creativa de polaridad lateral
  - Optimiza para tu entorno específico de escucha

### Parámetros
- **Stereo** - Controla el ancho estéreo (-200% a 200%)
  - Valores negativos: Invierten la polaridad del componente lateral estéreo (L-R) antes de la reconstrucción
  - -200%: Ancho máximo con polaridad lateral invertida; úsalo solo para corrección o casos especiales
  - -100%: Ancho estéreo original con la imagen izquierda/derecha intercambiada
  - 0%: Mono completo (canales izquierdo y derecho sumados)
  - 100%: Imagen estéreo original
  - 200%: Ensanchamiento máximo; conserva el componente central mientras refuerza mucho la diferencia lateral estéreo

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
