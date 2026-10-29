---
title: "Pipeline Analyzer - Respuesta en frecuencia y fase de la cadena de efectos - EffeTune"
description: "Pipeline Analyzer mide la respuesta en frecuencia, la fase, el retardo de grupo, la respuesta al impulso, la distorsión y el decaimiento del Effect Pipeline activo sin modificar el audio que escuchas."
lang: es
---

# Pipeline Analyzer

Pipeline Analyzer mide la respuesta del Effect Pipeline activo sin modificar el audio que escuchas. Se sitúa junto al pipeline en ventanas anchas o debajo de su encabezado en ventanas estrechas, lo que permite ajustar efectos mientras observas cómo se actualiza la respuesta.

Ábrelo con el botón de gráfico del encabezado de Effect Pipeline o con **Ver > Pipeline Analyzer** en la aplicación de escritorio. Cuando **Auto** está activado, los cambios en el pipeline inician automáticamente una nueva medición. Desactiva **Auto** para que los cambios en el pipeline solo se vuelvan a medir cuando hagas clic en **Refresh measurements**; cambiar los canales, las respuestas de altavoz o los ajustes de medición siempre inicia una nueva medición.

## Elección de canales y respuestas de altavoz

Selecciona un canal de entrada del pipeline activo (hasta 16 canales) y hasta cuatro canales de salida mediante **+ Add Output**. Siempre queda al menos una salida, por lo que la última no se puede eliminar. Al eliminar una salida, también se elimina su respuesta de altavoz.

Cada salida puede usar **No speaker IR** o un punto de medición guardado del altavoz o transductor conectado:

- **Sin IR de altavoces:** **Before** es un impulso de referencia plano ideal y **After** muestra únicamente la respuesta del pipeline de efectos.
- **Con IR de altavoces:** **Before** es la respuesta combinada de las mediciones de altavoz seleccionadas y **After** es la respuesta combinada tras procesar cada salida con el pipeline. Esto permite verificar un **Channel Divider** o **FIR Crossover** junto con las mediciones reales de cada unidad.

Una respuesta guardada que ya no está disponible sigue seleccionada, pero aparece como — hasta que la sustituyas o la quites.

Dado que las mediciones independientes de altavoz se alinean por su inicio detectado y no conservan las diferencias físicas de tiempo de llegada entre unidades, configura el retardo relativo y la polaridad de cada unidad en el pipeline antes de evaluar la respuesta sumada.

## Ajustes de medición

Abre **Measurement settings** para configurar cómo se mide el pipeline:

- **Signal:** **Log Sweep** (predeterminado), **MLS**, **TSP** o **Unit Impulse**. Usa **Log Sweep** si también quieres examinar la distorsión armónica. El barrido cubre de 20 Hz a 20 kHz dentro de los límites de la frecuencia de muestreo. **MLS** y **TSP** utilizan señales periódicas; **Unit Impulse** captura directamente la respuesta al impulso.
- **Level:** Nivel de pico de la señal de prueba (`-12 dBFS` de forma predeterminada). Los filtros lineales miden igual a cualquier nivel, mientras que compresores, saturadores y otros efectos dependientes del nivel cambian según **Level**.
- **Requested sweep length** (**Log Sweep**) / **Sequence Length** (otras señales): **Log Sweep** empieza con `131072` muestras y puede usar un barrido más largo para separar los armónicos; la **Sweep length** y el **Total stimulus time** reales aparecen después de la medición. La respuesta solo abarca hasta 1,5 segundos después del pico principal del impulso, aunque alargues el barrido. Para examinar colas de reverberación, retardos o resonancias más largos, elige **MLS**, **TSP** o **Unit Impulse** y aumenta **Sequence Length** según sea necesario.
- **Stabilization Periods:** Número de periodos reproducidos antes de capturar (`12` de forma predeterminada, usado por MLS y TSP) para que los efectos de evolución lenta se estabilicen. No está disponible con **Log Sweep** ni **Unit Impulse**.
- **Averages:** Número de capturas que se promedian (`2` de forma predeterminada, usado por **Log Sweep**, MLS y TSP) para reducir la variación.

## Lectura de los gráficos

Usa el selector **Graph** situado sobre la gráfica para cambiar de vista sin volver a medir:

- **Frequency:** Respuesta de magnitud (dB) frente a frecuencia, referenciada a 0 dB.
- **Phase:** Respuesta de fase (grados) frente a frecuencia.
- **Min Group Delay:** Retardo de grupo implícito en la respuesta de magnitud de fase mínima.
- **Excess Group Delay:** Retardo de grupo restante tras eliminar la parte de fase mínima (la gráfica se limita a ±100 ms, mientras que las lecturas del cursor muestran el valor real), lo que facilita distinguir el retardo puro y el comportamiento temporal de fase lineal o paso todo.
- **Impulse:** Respuesta al impulso en el dominio temporal desde `-2 ms` hasta **Impulse Range (ms)**, normalizada a su pico.
- **Distortion:** Con **Log Sweep**, muestra la distorsión armónica como porcentaje de la componente fundamental en cada frecuencia. Al principio se muestran H2, H3 y THD (órdenes 2–3); puedes añadir H4–H10 sin repetir la medición. Cuanto mayor sea el valor, mayor será la distorsión. Si esta gráfica no está disponible con otra señal, selecciona **Log Sweep**. Una salida silenciosa o sin datos válidos no permite calcularla. Las respuestas de altavoz guardadas aportan su respuesta lineal, no la distorsión propia del altavoz.
- **Waterfall:** Muestra frecuencia, nivel relativo (dB) y tiempo de decaimiento (ms). En **Response**, elige **After** (predeterminado) o **Before** para examinar la salida del pipeline o las respuestas de altavoz seleccionadas antes del procesamiento. Cada vista se normaliza a su propio pico: compara la forma del decaimiento, no los niveles absolutos. Arrastra para girar la gráfica 3D y usa la rueda del ratón o un gesto de pellizco para ampliar o reducir.

En las gráficas de frecuencia, fase, retardo de grupo e impulso, pasa el cursor para leer los valores de **Before** y **After** en esa posición; pasa el cursor sobre la etiqueta **Before** de la leyenda para ocultar temporalmente **After**. Usa **Smoothing (oct)** en las gráficas de frecuencia, fase y retardo de grupo, e **Impulse Range (ms)** en la gráfica de impulso.

## Cómo funciona la medición

Pipeline Analyzer captura el pipeline activo, su enrutamiento y las respuestas de altavoz seleccionadas, y compensa automáticamente en **After** la latencia comunicada por el pipeline. En efectos no lineales, modulados o aleatorios, interpreta la gráfica como una instantánea con los ajustes y el **Level** actuales.

[← Volver al README](README.md)
