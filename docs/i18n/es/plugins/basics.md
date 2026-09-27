---
title: "Plugins básicos - EffeTune"
description: "Plugins de audio esenciales, incluidos Bass Management, Volume, Mute, Stereo Balance, FIR Crossover, enrutamiento Matrix y más."
lang: es
---

# Plugins básicos de audio

Una colección de herramientas esenciales para ajustar los aspectos fundamentales de la reproducción de tu música. Estos complementos te ayudan a controlar el volumen, el balance y otros aspectos básicos de tu experiencia de escucha.

<!-- spectrum-overlay -->
## Superposición de espectro

Pulsa el icono de espectro de un gráfico compatible para alternar entre After, Before + After y Off. After muestra solo el espectro procesado mediante una línea azul. Before + After rellena el cambio entre el espectro sin procesar y el procesado: el color cálido marca las frecuencias cuyo nivel aumenta tras el procesamiento, el azul marca las que disminuyen y una línea gris señala el espectro After. Los espectros de entrada y salida se alinean en el mismo instante de reproducción, por lo que la diferencia compara el mismo audio. El modo **Normal** aplica un suavizado de 1/12 de octava; **Alta calidad** analiza las frecuencias bajas con más detalle. Usa la comparación para ver cómo cada ajuste cambia graves, medios y agudos mientras escuchas. Lee los niveles del espectro en la escala dBFS a la derecha del gráfico. Es distinta de la escala de ganancia del gráfico; 0 dBFS es la referencia digital de escala completa y los valores inferiores son más silenciosos. En Configuración, elige **Normal** o **Alta calidad** para la calidad del espectro superpuesto, y **Valor instantáneo** o **Retención de picos** para su visualización. Retención de picos mantiene visibles los máximos recientes y los deja bajar gradualmente. En After solo se recopila el espectro procesado; en Off se detienen la recopilación y el dibujo.

## Lista de complementos

* [Bass Management](#bass-management) - Envía graves gestionados y LFE a las salidas de subwoofer elegidas
* [Channel Divider](#channel-divider) - Divide audio estéreo en bandas de frecuencia a través de pares de salida estéreo
* [DC Offset](#dc-offset) - Añade o corrige un desplazamiento DC constante
* [FIR Crossover](#fir-crossover) - Divide el estéreo en bandas de pendiente pronunciada mediante filtros FIR
* [Matrix](#matrix) - Enruta y mezcla canales de audio con control flexible
* [MultiChannel Panel](#multichannel-panel) - Controla múltiples canales de audio con ajustes individuales
* [Mute](#mute) - Silencia la salida de audio
* [Polarity Inversion](#polarity-inversion) - Invierte la polaridad de la señal para corrección o casos especiales de enrutamiento
* [Stereo Balance](#stereo-balance) - Ajusta el balance izquierda-derecha de tu música
* [Volume](#volume) - Controla qué tan fuerte se reproduce la música

## Bass Management

Bass Management envía los graves de los canales principales seleccionados y cualquier entrada LFE dedicada a las salidas de subwoofer elegidas. Cada canal **Managed** conserva los agudos en su salida principal y envía graves a los subwoofers. Se usa con un bus multicanal que alimenta altavoces principales y uno o más subwoofers, y requiere el motor WASM DSP.

Hasta que seleccione una **Sub Outputs**, Bass Management no divide los graves ni los distribuye a los subwoofers; los canales de entrada pasan sin crossover. Una instancia nueva empieza con los canales reales del bus en **Managed** y sin ninguna **Sub Outputs** seleccionada.

Selecciona **All** en el enrutamiento del bus del efecto y configura suficientes canales de salida para todos los altavoces y subwoofers. La tabla muestra el rol de entrada y las salidas de subwoofer. Una salida de subwoofer no puede ser también un canal principal **Full Range** o **Managed**. Una entrada **LFE** puede compartir el número con una salida de subwoofer: se recoge antes de crear las salidas y se envía una sola vez.

### Guía de mejora del sonido

- Para estéreo con dos subwoofers, usa cuatro canales: pon los canales 1 y 2 en **Managed** y selecciona los canales 3 y 4 como **Sub Outputs**. Sus roles cambian automáticamente a **LFE**; usa Matrix para mantener o desactivar cada ruta de principal a subwoofer.
- Para contenido envolvente, usa **Managed** solo para los canales principales reales y **LFE** para el canal LFE de la fuente. Elige explícitamente las salidas de subwoofer.
- Empieza con 80 Hz y 24 dB/oct en cada canal gestionado. Sube la frecuencia si el altavoz principal tiene poca extensión de graves; usa una pendiente mayor para reducir el solapamiento. Comprueba el rango útil del altavoz antes de subir el nivel.
- Una entrada enviada a varios subwoofers se divide por igual eléctricamente, pero eso no evita picos al combinar señales. Reduce **Headroom** si hace falta, vigila el medidor posterior y usa Brickwall Limiter al final si necesitas controlar picos.
- Usa **LFE Gain** solo si la fuente no ha aplicado ya el ajuste LFE deseado. No hay corrección automática de nivel de cine. Después de Bass Management, aplica filtro pasaaltos, EQ o polaridad por subwoofer; usa MultiChannel Panel para trim, mute/solo y hasta 30 ms de delay, y un limitador al final si es necesario.

### Parámetros

- **Phase**: **IIR** ofrece menor latencia y cambia la fase alrededor del cruce. **Linear** alinea temporalmente la división, pero añade latencia visible y puede producir pre-ringing.
- **Taps**: elige 8192, 16384 o 32768 para Linear. Más Taps mejoran la precisión de graves y pendientes fuertes, pero aumentan preparación y latencia. El valor inicial es 16384 y afecta a Linear.
- **Headroom** atenúa todas las salidas por igual. **Bass Gain** ajusta los graves separados de **Managed** antes de mezclarlos; **LFE Gain** ajusta de igual modo las entradas **LFE**.
- **Channel Role** establece cada entrada: **Full Range** conserva toda la fuente en su salida principal; **Managed** conserva allí los agudos y envía graves a subwoofers; **LFE** envía la fuente solo a subwoofers; **Unused** reserva normalmente una entrada para una salida de subwoofer.
- **Crossover Frequency** ajusta cada cruce **Managed** entre 20 y 300 Hz; un valor mayor envía más graves al subwoofer. **Slope** ofrece 24, 48 o 96 dB/oct; un valor mayor reduce el solapamiento.
- **Sub Outputs** selecciona las salidas de cada entrada **Managed** o **LFE**. Al seleccionar un canal, su **Channel Role** cambia a **LFE**. Una salida recién seleccionada empieza con rutas **ON** de todos los inputs del bus y con polaridad normal; usa Matrix para desactivar una ruta individual. Sin **Sub Outputs**, se detiene la división de graves y el enrutamiento a subwoofers, y los canales de entrada pasan sin crossover. **LFE Low-pass**, **LFE Frequency** y **LFE Slope** limitan opcionalmente LFE por encima de 20 a 300 Hz con 24, 48 o 96 dB/oct, sin filtrar de nuevo los graves ya separados.
- **ON** y **Ø**: en cada celda de la tabla de canales, **ON** envía esa entrada **Managed** o **LFE** a la salida de subwoofer elegida. **Ø** invierte la polaridad solo de esa ruta entre la entrada y el subwoofer, para ajustarla al resultado medido o audible. **Ø** solo está disponible mientras **ON** está seleccionado; al desactivar **ON** también se desactiva **Ø**. No cambia la salida principal de la entrada.

### Pantalla y estado

- El resumen de rutas muestra qué entradas alimentan cada subwoofer. Revísalo antes de subir el nivel, especialmente después de cambiar los canales. Al seleccionar un canal **Managed** se ven las respuestas pasaaltos y pasabajos activas, no una curva idealizada.
- El estado muestra el modo, la preparación Linear y la latencia efectiva en muestras y ms.
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

### Preparación del filtro
Al cambiar ajustes Linear el sonido puede reducirse o detenerse brevemente. Si no se pueden preparar los filtros, reduce **Taps** y vuelve a intentarlo. Si no puede usarse la configuración anterior, los canales principales normales pasan con retardo equivalente, las salidas reservadas quedan silenciosas y LFE no se reproduce hasta que la preparación termine.

### Bypass y calibración

- El bypass del host restaura el audio y la asignación originales; el enrutamiento, la protección y la alineación de Bass Management no continúan. Para comparar o silenciar conservando el cableado, usa MultiChannel Panel después. El modo Linear describe el cruce: EQ/pasaaltos IIR o delay relativo posterior cambia la fase del sistema completo. Guarda la cadena calibrada como un solo preset.

## Channel Divider

Una herramienta especializada que divide tu señal estéreo en bandas de frecuencia separadas y dirige cada banda a un par de salida estéreo distinto. Es útil para configuraciones con varios amplificadores, varios altavoces o crossovers personalizados.

Para usar este efecto, utiliza la aplicación de escritorio, configura un número par de canales de salida entre 4 y 16 y establece el canal en el enrutamiento del bus de efectos en "All". Band Count determina los pares de salida que usa el efecto.

### Cuándo usarlo

* Cuando uses salidas de audio multicanal pares de 4 a 16 canales
* Para crear un enrutamiento de canales basado en frecuencias personalizado
* Para configuraciones con múltiples amplificadores o altavoces

### Parámetros

* **Band Count** - Número de bandas de frecuencia a crear (2-4 bandas)

  * 2 bandas: división Low/High, requiere 4 canales de salida
  * 3 bandas: división Low/Mid/High, requiere 6 canales de salida
  * 4 bandas: división Low/Mid-Low/Mid-High/High, requiere 8 canales de salida
  * Band Count sigue limitado a cuatro bandas; más canales de salida no añaden más bandas

* **Crossover Frequencies** - Definen dónde se divide el audio entre bandas

  * F1: Primer punto de cruce
  * F2: Segundo punto de cruce (para 3+ bandas)
  * F3: Tercer punto de cruce (para 4 bandas)
  * Cada crossover se puede ajustar de 10 Hz a 40000 Hz
  * El plugin mantiene F1, F2 y F3 en orden ascendente con al menos 1 Hz de separación

* **Slopes** - Controlan cuán bruscamente se separan las bandas

  * Opciones: -12dB a -96dB por octava
  * Pendientes más pronunciadas ofrecen una separación más clara
  * Pendientes menores ofrecen transiciones más naturales

### Notas técnicas

* Procesa solo los dos primeros canales de entrada
* Los canales de salida deben ser un número par de 4 a 16
* Cada banda conserva el par estéreo original: en modo de 2 bandas, Low sale por los canales 1-2 y High por 3-4; en modo de 3 bandas se usan 1-2, 3-4 y 5-6; en modo de 4 bandas se usan 1-2, 3-4, 5-6 y 7-8
* Utiliza filtros de cruce Linkwitz-Riley de alta calidad

### Visualización
- El gráfico muestra la respuesta de frecuencia de cada banda de salida.
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

## DC Offset

Una utilidad para corregir una señal cuya forma de onda está desplazada respecto a la línea cero. La mayoría de los oyentes deberían dejarla en 0.0, pero puede ayudar con archivos poco habituales o cadenas de procesamiento que contienen desplazamiento DC.

### Cuándo usarlo

* Cuando el audio tiene un sesgo DC constante o causa clics/problemas de margen después de otros procesamientos
* Cuando una herramienta de diagnóstico o medidor muestra que la forma de onda está desplazada respecto a cero
* Déjalo en 0.0 para escucha normal

### Parámetros

* **Offset** - Añade un valor constante a cada muestra (-1.0 a +1.0)

  * 0.0: Sin desplazamiento
  * Los valores positivos desplazan la señal hacia arriba
  * Los valores negativos desplazan la señal hacia abajo
  * Usa ajustes muy pequeños cuando haga falta corregir

## FIR Crossover

FIR Crossover divide una entrada estéreo en dos, tres o cuatro bandas y envía cada una a un par de salidas independiente. Está pensado para equipos de escritorio con un número par de 4 a 16 canales de salida y funciona únicamente con WASM DSP. Band Count sigue limitado a cuatro bandas, por lo que usa como máximo los canales 1-8.

Cuando el efecto recibe dos canales, deja pasar el audio sin modificarlo.

El diseño FIR permite pendientes muy pronunciadas sin la resonancia de los filtros convencionales. Minimum Phase utiliza una construcción causal que conserva la recombinación de las bandas; Linear Phase ofrece una respuesta de fase simétrica a cambio de una latencia fija.

### Guía de uso

- Empieza con los valores predeterminados y ajusta Crossover Frequencies a los rangos de tus altavoces.
- Las salidas se ordenan desde la banda más grave a la más aguda; cada banda ocupa un par estéreo.
- Para ajustes habituales, prueba entre 48 y 96 dB/oct. Las pendientes más fuertes suelen requerir más Taps.
- Elige Minimum Phase para reducir la latencia o Linear Phase cuando la alineación de fase sea prioritaria.
- Prueba el enrutamiento multicanal a volumen bajo para proteger los altavoces.

### Parámetros

- **Phase**: selecciona **Minimum Phase** o **Linear Phase**.
- **Taps**: define la longitud del filtro FIR. Un valor mayor mejora la resolución en graves y aumenta la carga.
- **Latency**: añade 0, 128, 256, 512 o 1024 muestras de latencia declarada.
- **Band Count**: selecciona dos, tres o cuatro bandas, que requieren 4, 6 u 8 canales de salida respectivamente.
- **Crossover Frequencies**: define en orden ascendente los límites entre bandas.
- **Slope**: selecciona entre 24 y 384 dB/oct para cada cruce.

### Cómo leer la pantalla

- El gráfico muestra la respuesta objetivo de cada banda según la frecuencia.
- Cada color corresponde al par de salidas de esa banda.
- La línea de estado muestra la latencia y la resolución del filtro, o avisa si el número de canales no es compatible.
- Pasa el cursor sobre el gráfico, o tócalo y desliza el dedo sobre él, para leer los valores en ese punto.

## Matrix

Una herramienta de enrutamiento de canales para corregir distribuciones poco habituales de altavoces o auriculares, intercambiar canales, combinar canales o enviar un canal a más de una salida disponible.

### Cuándo usarlo

* Para crear enrutamientos personalizados entre canales
* Cuando necesites mezclar o dividir señales de formas específicas
* Cuando la reproducción izquierda/derecha o multicanal sale por altavoces incorrectos
* Para combinar estéreo a mono o duplicar un canal en otra salida disponible

### Funciones

* Matriz de enrutamiento flexible para hasta 16 canales
* Control individual de conexión entre cualquier par entrada/salida
* Opciones de inversión de fase para cada conexión
* Interfaz de matriz visual para una configuración intuitiva

### Cómo funciona

* Cada punto de conexión representa el enrutamiento de una fila de entrada a una columna de salida
* Las conexiones activas permiten que la señal fluya entre canales
* La opción de inversión de fase invierte la polaridad de la señal
* Varias conexiones de entrada a una salida se mezclan juntas
* Cuando varias entradas se envían a la misma salida, sus niveles se suman, así que puede que tengas que bajar el volumen
* Matrix no crea canales de salida adicionales por sí mismo; enruta audio dentro de los canales disponibles actualmente

### Aplicaciones prácticas

* Downmix, intercambio de canales o enrutamiento personalizado dentro de los canales disponibles
* Combinar izquierda y derecha en mono
* Duplicar un canal en otra salida disponible
* Corregir distribuciones de reproducción multicanal poco habituales

## MultiChannel Panel

Un panel de control completo para gestionar múltiples canales de audio individualmente. Este complemento proporciona control total sobre volumen, silencio, solo y retardo para hasta 16 canales, con un medidor de nivel visual para cada canal.

Desplázate dentro del panel para ver los canales que quedan por debajo del área visible.

### Cuándo usarlo

* Al trabajar con audio multicanal (hasta 16 canales)
* Para crear un balance de volumen personalizado entre diferentes canales
* Cuando necesites aplicar retardo individual a canales específicos
* Para monitorizar niveles en múltiples canales simultáneamente

### Funciones

* Control individual para hasta 16 canales de audio
* Medidores de nivel en tiempo real con retención de picos para monitorización visual
* Capacidad de enlace entre canales para cambios de parámetros agrupados

### Parámetros

#### Controles por canal

* **Mute (M)** - Silencia canales individuales
  * Activación/desactivación para cada canal
  * Funciona en conjunto con la función solo

* **Solo (S)** - Aísla canales individuales
  * Cuando cualquier canal está en solo, sólo los canales en solo se reproducen
  * Se pueden establecer múltiples canales en solo simultáneamente

* **Volume** - Ajusta el volumen de canales individuales (-20dB a +10dB)
  * Control preciso con deslizador o entrada directa de valores
  * Los canales enlazados mantienen el mismo volumen

* **Delay** - Añade retardo temporal a canales individuales (0-30ms)
  * Control preciso de retardo en milisegundos
  * Útil para alineación temporal entre canales
  * Permite ajuste de fase entre canales

#### Enlace de canales

* **Link** - Conecta canales adyacentes para control sincronizado
  * Los cambios en un canal enlazado afectan a todos los canales conectados
  * Mantiene ajustes consistentes en grupos de canales enlazados
  * Útil para pares estéreo o grupos de múltiples canales

### Monitorización visual

* Los medidores de nivel en tiempo real muestran la intensidad actual de la señal
* Los indicadores de retención de picos muestran los niveles máximos
* Lectura numérica clara de los niveles de pico en dB
* Medidores con código de color para fácil reconocimiento de niveles:
  * Verde: Niveles seguros
  * Amarillo: Aproximándose al máximo
  * Rojo: Cerca o en el nivel máximo

### Aplicaciones prácticas

* Equilibrar sistemas de sonido envolvente
* Equilibrar reproducción surround o con varios altavoces
* Ajustar el tiempo de los altavoces cuando están a distintas distancias
* Silenciar o poner en solo temporalmente altavoces individuales durante la configuración
* Enlazar pares estéreo o grupos de altavoces para ajustarlos con más facilidad

## Mute

Una utilidad simple que silencia toda la salida de audio llenando el búfer con ceros. Útil para silenciar señales de audio al instante.

### Cuándo usarlo

* Para silenciar el audio al instante sin fundido
* Durante secciones silenciosas o pausas
* Para evitar la salida de ruido no deseado

## Polarity Inversion

Una utilidad que invierte la polaridad de la señal de audio. Invertir todos los canales normalmente no cambia lo que oyes por sí solo, pero puede ayudar cuando un altavoz, cable o canal parece estar cableado con polaridad opuesta.

Para corregir una posible falta de coincidencia de polaridad izquierda/derecha o multicanal, limita los canales procesados en los ajustes comunes de enrutamiento del efecto e invierte solo el canal afectado.

### Cuándo usarlo

* Cuando la imagen central suena débil, hueca o demasiado extendida porque un canal podría tener polaridad opuesta
* Cuando compruebas o corriges la polaridad de altavoces, cables o canales en una configuración de reproducción
* Cuando lo combinas con enrutamiento o efectos estéreo que necesitan invertir la polaridad de un canal

## Stereo Balance

Te permite ajustar cómo se distribuye la música entre tus altavoces o auriculares izquierdo y derecho. Perfecto para corregir un estéreo desequilibrado o crear tu colocación de sonido preferida.

### Guía de mejora de escucha

* Balance perfecto:

  * Posición centrada para estéreo natural
  * Volumen igual en ambos oídos
  * Ideal para la mayoría de la música

* Balance ajustado:

  * Compensar la acústica de la sala
  * Ajustar según diferencias auditivas
  * Crear escenario de sonido preferido

### Parámetros

* **Balance** - Controla la distribución izquierda-derecha (-100% a +100%)

  * Center (0%): Igual en ambos lados
  * Left (-100%): Más sonido en izquierda
  * Right (+100%): Más sonido en derecha

### Visualización

* Control deslizante fácil de usar
* Visualización clara de números
* Indicador visual de posición estéreo

### Usos recomendados

1. Escucha general

   * Mantén el balance centrado (0%)
   * Ajusta si el estéreo se siente desequilibrado
   * Utiliza ajustes sutiles

2. Escucha con auriculares

   * Ajusta finamente para mayor comodidad
   * Compensa las diferencias auditivas
   * Crea una imagen estéreo preferida

3. Escucha en altavoces

   * Ajusta según la configuración de la sala
   * Equilibra para la posición de escucha
   * Compensa la acústica de la sala

## Volume

Un control simple pero esencial que te permite ajustar cuán alto se reproduce tu música. Perfecto para encontrar el nivel de escucha adecuado para diferentes situaciones.

### Guía de mejora de escucha

* Ajusta para diferentes escenarios de escucha:

  * Música de fondo mientras trabajas
  * Sesiones de escucha activa
  * Escucha tranquila a altas horas de la noche

* Mantén el volumen en niveles cómodos para evitar:

  * Fatiga auditiva
  * Distorsión del sonido
  * Posible daño auditivo

### Parámetros

* **Volume** - Controla la sonoridad general (-60dB a +24dB)

  * Valores bajos: reproducción más suave
  * Valores altos: reproducción más alta
  * 0dB: Nivel de volumen original

Recuerda: Estos controles básicos son la base de un buen sonido. Comienza con estos ajustes antes de usar efectos más complejos!
