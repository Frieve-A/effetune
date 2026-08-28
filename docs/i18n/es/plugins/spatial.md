---
title: "Plugins espaciales - EffeTune"
description: "Plugins de audio espacial como Crossfeed Filter, MS Matrix, Multiband Balance, Phase Select EQ y Stereo Blend."
lang: es
---

# Plugins de audio espacial

Una colección de plugins que mejoran cómo suena la música en tus auriculares o altavoces ajustando el balance estéreo (izquierda y derecha). Estos efectos pueden hacer que tu música suene más espaciosa y natural, especialmente al escuchar con auriculares.

## Lista de Plugins

- [Crossfeed Filter](#crossfeed-filter) - Filtro de crossfeed para auriculares para imagen estéreo natural
- [MS Matrix](#ms-matrix) - Convierte estéreo a Mid/Side y de vuelta para cadenas avanzadas de ajuste estéreo
- [Multiband Balance](#multiband-balance) - Control de balance estéreo dependiente de frecuencia de 5 bandas
- [Phase Select EQ](#phase-select-eq) - Realza o atenúa componentes de frecuencia según la diferencia de fase L/R y Balance
- [Stereo Blend](#stereo-blend) - Controla el ancho estéreo desde estéreo con polaridad lateral invertida, pasando por mono, hasta estéreo ampliado

## Crossfeed Filter

Un filtro de crossfeed para auriculares que simula la diafonía acústica natural que ocurre al escuchar a través de altavoces. Este efecto ayuda a reducir la separación estéreo exagerada que a menudo se experimenta con auriculares, creando una experiencia de escucha más natural y cómoda que imita la forma en que el sonido llega a nuestros oídos en un entorno acústico real.

### Características principales
- Simula la diafonía acústica natural para escucha con auriculares
- Nivel de crossfeed y temporización ajustables
- Filtrado paso bajo para imitar la diafonía dependiente de frecuencia
- Procesamiento solo estéreo (se bypassa automáticamente con señales mono u otras señales no estéreo)

### Presets del sistema

Haz clic en **Preajustes de efecto** en el encabezado del efecto para elegir una cantidad completa de crossfeed para auriculares.

- **Subtle Blend** - Crossfeed muy ligero que conserva casi toda la anchura original.
- **Vintage Receiver** - Crossfeed moderado parecido al de un adaptador de auriculares tradicional.
- **Living Room Speakers** - Mezcla intensa similar a altavoces para grabaciones con separación estéreo muy amplia.

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

## Phase Select EQ

Phase Select EQ realza o atenúa componentes estéreo seleccionados por frecuencia, diferencia de fase absoluta y balance de nivel entre izquierda y derecha. Las tres condiciones deben coincidir. Aplica la misma ganancia positiva a ambos espectros, por lo que no gira, corrige ni crea diferencias de fase. Úsalo para separar un sonido centrado de otro abierto o desplazado a un lado en las mismas frecuencias.

Siempre hay cinco Bands independientes. Cada Band tiene un **Core**, donde se aplica todo el Gain, y una **Transition**, donde el multiplicador vuelve suavemente a 100%. Los Gains de Bands superpuestos se multiplican; por ejemplo, 150% y 50% producen 75%. Varias amplificaciones pueden superar 0 dBFS, así que deja margen suficiente y compara con bypass.

La latencia de procesamiento que informa Phase Select EQ es la suma del tamaño de la FFT y el tamaño de salto (hop). A 48 kHz, 4.096 + 1.024 = 5.120 muestras, unos 106,7 ms (unos 116,1 ms a 44,1 kHz). Puedes consultar el retardo total de la cadena en **Total Delay** de la aplicación. Esta latencia puede afectar a la monitorización en tiempo real y a la sincronización de audio y vídeo.

### Cómo leer el mapa de selección

- El eje vertical muestra la frecuencia en escala logarítmica: graves abajo y agudos arriba.
- Las opciones **Phase** y **Balance** cambian el eje horizontal; al editar un control de Phase o Balance se abre automáticamente la vista correspondiente. En Phase, 0° está en el centro y -180° y +180° son el mismo punto de fase opuesta. Como la selección usa la diferencia **absoluta**, el marco se refleja alrededor de 0° y trata +60° y -60° por igual. En Balance, 50:50 está en el centro, el extremo izquierdo contiene solo el canal izquierdo y el derecho solo el canal derecho. Balance es `(amplitud derecha - amplitud izquierda) / (amplitud izquierda + amplitud derecha) × 100%`: los valores negativos favorecen la izquierda y los positivos la derecha. El marco es un solo rectángulo, no una imagen especular.
- Cada punto representa un componente de entrada medido recientemente. Los más intensos aparecen más grandes y brillantes; los antiguos se desvanecen.
- Los componentes medidos se muestran como puntos blancos. Solo se dibujan los marcos de los Bands activados: el Band en edición aparece en verde brillante y los demás en verde claro. El número de la esquina superior izquierda identifica el Band.
- La etiqueta corta junto a cada número de Core muestra la selección completa de ese Band en el eje oculto. Por ejemplo, `P 20°›40°–80°›100°` indica límite exterior inferior › Core inferior–superior › límite exterior superior de Phase. En Balance se usa el mismo orden con proporciones izquierda:derecha, como `B 100:0›80:20–70:30›0:100`. `P full` o `B full` significa que ese Band no limita el eje oculto.
- La selección usa el valor **absoluto** de la diferencia de fase. Por eso una región lógica se refleja alrededor de 0° y procesa +60° y -60° por igual. Intercambiar L/R refleja los puntos, pero no cambia qué componentes se procesan.
- El área interior delimitada es el Core y el área exterior más clara es la Transition. Una región que incluye 0° se une en el centro; si llega a 180°, continúa por ambos bordes del mapa.
- La insignia junto a las opciones de Graph muestra el intervalo Core del eje oculto y, cuando hace falta, el intervalo Transition. Los puntos que el Band seleccionado rechaza en ese eje aparecen atenuados. Un componente solo izquierdo se muestra como Balance -100% y Phase -180°; uno solo derecho, como Balance +100% y Phase +180°.

La cuadrícula de Balance muestra proporciones izquierda:derecha. Balance 0%, ±17%, ±33%, ±60%, ±82% y ±100% corresponde a 50:50 y, hacia uno u otro lado, aproximadamente 59:41, 67:33, 80:20, 91:9 y 100:0. Las diferencias de nivel L/R son aproximadamente 0, ±3, ±6, ±12 y ±20 dB; ±100% significa que solo hay señal en un canal.

### Guía de mejora del sonido

1. **Suavizar agudos muy abiertos**: ajusta un Band alrededor de 4–12 kHz y 90–180°. Empieza con 70–90% y transiciones amplias.
2. **Dar presencia a voces centradas**: ajusta un Band alrededor de 1–4 kHz y 0–30°. Empieza con 110–125%.
3. **Controlar ambiente difuso en graves-medios**: ajusta un Band alrededor de 150–600 Hz y 60–150°. Empieza con 80–90% y amplía las transiciones hasta obtener un cambio suave.
4. **Atenuar un instrumento paneado al extremo**: en Balance, selecciona de -100% a -70% para la izquierda o de +70% a +100% para la derecha y limita la frecuencia. Ajusta el Phase Core a 150–180° para incluir los puntos unilaterales de -180° o +180°; si quieres que decida solo Balance, usa todo el Phase Core de 0–180°. Empieza con Gain de 70–90%.
5. **Realzar una fuente centrada**: usa Balance de -17% a +17% y Phase de 0–30°, limita la frecuencia y empieza con Gain de 105–120%.

Estos rangos de fase son tendencias habituales, no posiciones fijas de las fuentes. Observa dónde aparecen los puntos en la grabación, realiza cambios pequeños y comprueba el resultado con auriculares y altavoces.

### Parámetros

- **Band 1-5 / casilla** (Off/On): Selecciona un Band para editarlo y lo activa o desactiva sin cambiar sus ajustes.
- **Gain** (0% a 200%): Define el multiplicador de nivel dentro del Core. 100% no cambia el nivel, 0% elimina el componente seleccionado y 200% duplica su amplitud.
- **Solo** (Off/On): Permite escuchar solo lo que seleccionan los Band con Solo activado. Mientras algún Band activo tenga Solo en On, Gain no se aplica y todo lo que queda fuera de esos Band se silencia, con el mismo desvanecimiento suave del Transition en los bordes. Si activas Solo en varios Band, se escucha la combinación de sus zonas. Al desactivar todos los Solo se vuelve al procesado normal.
- **Core Low Frequency / Core High Frequency** (20 Hz a 40 kHz, con el límite del muestreo actual): Definen el intervalo de frecuencias procesado al 100%.
- **Core Low Phase / Core High Phase** (0° a 180°): Definen el intervalo absoluto de diferencia de fase L/R procesado al 100%.
- **Outer Low Balance / Core Low Balance / Core High Balance / Outer High Balance** (-100% a +100%): Definen directamente los cuatro límites de Balance. El par Core establece el intervalo de balance entre izquierda y derecha que se procesa por completo; el par Outer establece dónde la Transition llega a no aplicar procesamiento. Los valores negativos seleccionan hacia la izquierda y los positivos hacia la derecha.
- **Low Frequency Transition / High Frequency Transition**: Definen cuánto se desvanece el efecto por debajo y por encima del Core de frecuencia.
- **Low Phase Transition / High Phase Transition**: Definen cuánto se desvanece el efecto hacia 0° y 180°.

Los tiradores del mapa, los deslizadores y los campos numéricos modifican los mismos valores. Con ratón o toque, arrastra dentro del marco exterior del Band seleccionado para mover todo el Band, los bordes o las esquinas del Core para cambiar su tamaño y los tiradores del borde exterior para ajustar cada Transition por separado. Un tirador del límite inferior de Phase se detiene en el centro: Core Low Phase termina en 0° y Low Phase Transition en su anchura máxima. Si Core Low Phase está exactamente en 0°, el tirador central puede empezar hacia cualquier lado; después del primer movimiento queda fijado a ese lado hasta terminar el arrastre.

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
