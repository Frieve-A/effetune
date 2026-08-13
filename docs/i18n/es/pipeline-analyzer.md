# Pipeline Analyzer

Pipeline Analyzer mide la respuesta del Effect Pipeline activo sin modificar el audio que escuchas. Permanece junto al pipeline en ventanas anchas y pasa debajo de su encabezado en ventanas estrechas, para que puedas ajustar un efecto mientras observas cómo cambia el resultado.

Ábrelo con el botón de gráfico del encabezado de Effect Pipeline o con **View > Pipeline Analyzer** en la aplicación de escritorio. Con **Auto** seleccionado, los cambios del pipeline inician automáticamente una nueva medición. Desactiva **Auto** para medir los cambios del pipeline solo al seleccionar **Refresh measurements**. Los cambios de los ajustes de medición siempre inician una nueva medición.

## Canales y respuestas de altavoz

Selecciona un canal de entrada. Al principio aparece una salida; usa **+ Añadir salida** para agregar hasta cuatro canales distintos disponibles en el dispositivo actual. Al eliminar una salida también se elimina su respuesta de altavoz. La última salida no se puede eliminar.

Cada salida puede usar **Sin IR de altavoz** o un punto de medición guardado del tweeter, woofer u otra unidad conectada. Elegir una medición sin seleccionar un punto se considera **Sin IR de altavoz**. Cuando ninguna salida usa una IR de altavoz, **Antes** es el impulso unitario ideal: 1,0 a 0 ms y 0 en el resto. Con IR de altavoz, **Antes** es la suma con signo de las respuestas alineadas y **Después** es la suma con signo tras procesar cada salida con el pipeline elegido. Así puedes comprobar un FIR Crossover junto con sus altavoces. Una respuesta guardada que falte seguirá indicada como tal hasta que la sustituyas o la quites.

Las respuestas guardadas se alinean por su inicio detectado. Las mediciones independientes no conservan la diferencia acústica de llegada entre unidades; ajusta el retardo relativo y la polaridad en el pipeline antes de evaluar Total.

## Ajustes de medición

Abre **Ajustes de medición** para cambiar:

- **Señal** usa **MLS** de forma predeterminada. **TSP** es una señal de prueba periódica alternativa y **Impulso unitario** captura directamente la respuesta temporal. Cada opción puede medir el pipeline de forma distinta cuando los efectos son no lineales o varían con el tiempo.
- **Nivel** establece el pico de la señal de prueba y vale -12 dBFS de forma predeterminada. Los efectos lineales suelen dar la misma respuesta normalizada a cualquier nivel; los no lineales o dependientes del nivel pueden cambiar.
- **Longitud de secuencia** determina cuánto tiempo de respuesta pueden medir MLS o TSP sin solapamiento. Los valores mayores requieren más tiempo y memoria. Auméntala para delays, reverbs u otros efectos con cola larga, sobre todo si el analizador lo recomienda.
- **Periodos de estabilización** vale 12 de forma predeterminada y deja que el pipeline se estabilice antes de capturar. Auméntalo si un efecto lento aún no ha alcanzado un estado estable.
- **Promedios** vale 2 de forma predeterminada. Auméntalo para reducir las diferencias entre mediciones cuando el gráfico sea inestable; la medición tardará más.

Los detalles indican si la longitud actual es suficiente, la longitud y estabilización recomendadas y el tiempo total de medición. Son recomendaciones: aplícalas cuando correspondan a los efectos que estás midiendo.

Longitud de secuencia, Periodos de estabilización y Promedios solo se desactivan con Impulso unitario. Cambiar Frequency, Phase, Group Delay o Impulse solo cambia el gráfico y no repite la medición.

## Lectura y método

**Frequency** muestra el nivel, **Phase** la fase, **Group Delay** el retardo según la frecuencia e **Impulse** la respuesta temporal. El gráfico siempre muestra **Antes** y **Después**. Mueve el puntero para leer ambos valores; al pasar por **Antes**, **Después** se oculta temporalmente. Frequency y Group Delay comparten **Suavizado (oct)**. Cada curva de frecuencia se referencia por separado a 0 dB; cada impulso se normaliza con su propio pico completo y se muestra desde -2 ms hasta el **Rango del impulso (ms)** elegido.

Cada medición captura el pipeline activo, sus ajustes y rutas actuales, y las respuestas de altavoz seleccionadas. Los gráficos muestran las respuestas de frecuencia, fase, retardo de grupo e impulso; **Después** compensa la latencia indicada por el pipeline.

MLS y TSP son adecuados para la medición general. Si un delay, reverb u otra cola supera la ventana seleccionada, la respuesta puede solaparse consigo misma; aumenta **Longitud de secuencia**. **Impulso unitario** registra directamente la respuesta durante un tiempo limitado, por lo que puede cortar colas excepcionalmente largas.

Los efectos no lineales, variables en el tiempo, aleatorios, ruidosos o generadores de sonido pueden dar resultados distintos según el nivel o entre mediciones. Considera los gráficos como instantáneas de los ajustes seleccionados, no como características fijas.
