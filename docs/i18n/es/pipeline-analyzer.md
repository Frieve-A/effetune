# Pipeline Analyzer

Pipeline Analyzer mide la respuesta del Effect Pipeline activo sin modificar el audio que escuchas. Permanece junto al pipeline en ventanas anchas y pasa debajo de su encabezado en ventanas estrechas, para que puedas ajustar un efecto mientras observas cómo cambia el resultado.

Ábrelo con el botón de gráfico del encabezado de Effect Pipeline o con **View > Pipeline Analyzer** en la aplicación de escritorio. Los cambios del pipeline o de los ajustes de medición inician automáticamente una nueva medición.

## Canales y respuestas de altavoz

Selecciona un canal de entrada. Al principio aparece una salida; usa **+ Añadir salida** para agregar hasta cuatro canales distintos disponibles en el dispositivo actual. Al eliminar una salida también se elimina su respuesta de altavoz. La última salida no se puede eliminar.

Cada salida puede usar **Sin IR de altavoz** o un punto de medición guardado del tweeter, woofer u otra unidad conectada. **Antes** es la suma con signo de esas respuestas alineadas y **Después** es la suma con signo tras procesar cada salida con el pipeline elegido. Así puedes comprobar un FIR Crossover junto con sus altavoces. Una respuesta guardada que falte seguirá indicada como tal hasta que la sustituyas o la quites.

Las respuestas guardadas se alinean por su inicio detectado. Las mediciones independientes no conservan la diferencia acústica de llegada entre unidades; ajusta el retardo relativo y la polaridad en el pipeline antes de evaluar Total.

## Ajustes de medición

Abre **Ajustes de medición** para cambiar:

- **Señal**: **MLS** es el valor predeterminado. **TSP** ofrece una señal periódica de fase barrida con los mismos controles de estabilización y promedio. **Impulso unitario** captura directamente el dominio temporal.
- **Nivel**: pico de la señal de prueba, `-12 dBFS` de forma predeterminada. Los efectos no lineales o dependientes del nivel pueden dar resultados distintos.
- **Longitud de secuencia**: MLS usa de 32.767 a 524.287 muestras y TSP las potencias de dos correspondientes, de 32.768 a 524.288. Al cambiar de señal se conserva el mismo orden. Una secuencia más larga admite una respuesta más larga antes del solapamiento circular. El analizador puede recomendar otra longitud, pero nunca la cambia automáticamente.
- **Periodos de estabilización**: 12 de forma predeterminada. MLS o TSP se ejecuta continuamente durante esos periodos antes de capturar y se muestra la duración real.
- **Promedios**: 2 de forma predeterminada. Más periodos reducen las variaciones entre repeticiones.

Los detalles también muestran el **intervalo actual**, la **longitud recomendada**, la **estabilización recomendada** en periodos y segundos, y el **tiempo total de la señal de prueba**. Son solo valores orientativos; Pipeline Analyzer nunca modifica los ajustes automáticamente.

Longitud de secuencia, Periodos de estabilización y Promedios solo se desactivan con Impulso unitario. Cambiar entre Frequency, Phase, Group Delay e Impulse solo cambia el gráfico y no repite la medición.

## Lectura y método

**Frequency** muestra el nivel, **Phase** la fase, **Group Delay** el retardo según la frecuencia e **Impulse** la respuesta temporal. El gráfico siempre muestra solo **Antes** y **Después**. Mueve el puntero para leer ambos valores; al pasar por **Antes**, **Después** se oculta temporalmente. Frequency y Group Delay comparten **Suavizado (oct)**. Cada curva de frecuencia se referencia por separado a 0 dB; cada impulso se normaliza con su propio pico completo y se muestra desde -2 ms hasta el **Rango del impulso (ms)** elegido.

Cada ejecución congela el pipeline, sus recursos, el enrutamiento, las respuestas de altavoz y los ajustes en un worker aislado. MLS usa correlación circular y TSP su barrido inverso para recuperar la respuesta periódica excepto en DC. La latencia indicada por el pipeline se resta de la fase, el retardo de grupo y el tiempo de impulso mostrados. Impulso unitario normaliza la captura por el nivel elegido y mantiene una captura de cola limitada.

Con efectos no lineales, variables en el tiempo, aleatorios, ruidosos o que generan sonido, el resultado es una sola captura al nivel y estado inicial elegidos, no una función de transferencia universal. Puede variar entre mediciones. Si la salida numérica no es válida o falta un procesador o recurso necesario, la medición falla.
