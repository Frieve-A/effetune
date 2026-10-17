---
title: "Pipeline Analyzer - Respuesta en frecuencia y fase de la cadena de efectos - EffeTune"
description: "Pipeline Analyzer mide la respuesta en frecuencia, la fase, el retardo de grupo y la respuesta al impulso del Effect Pipeline activo sin modificar el audio que escuchas."
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

- **Signal:** **MLS** (predeterminado), **TSP** o **Unit Impulse**. MLS y TSP utilizan señales de prueba periódicas (`2^n - 1` y `2^n` muestras), mientras que **Unit Impulse** captura directamente la respuesta al impulso en el dominio temporal (`2^n` muestras).
- **Level:** Nivel de pico de la señal de prueba (`-12 dBFS` de forma predeterminada). Los filtros lineales miden igual a cualquier nivel, mientras que compresores, saturadores y otros efectos dependientes del nivel cambian según **Level**.
- **Sequence Length:** Duración de la ventana de medición. Auméntala al medir reverberación, retardo o filtros pronunciados de baja frecuencia con cola larga, especialmente cuando el analizador recomiende una longitud mayor.
- **Stabilization Periods:** Número de periodos reproducidos antes de capturar (`12` de forma predeterminada, usado por MLS y TSP) para que los efectos de evolución lenta se estabilicen.
- **Averages:** Número de periodos capturados que se promedian (`2` de forma predeterminada, usado por MLS y TSP) para reducir la variación.

## Lectura de los gráficos

Usa el selector **Graph** situado sobre la gráfica para cambiar de vista sin volver a medir:

- **Frequency:** Respuesta de magnitud (dB) frente a frecuencia, referenciada a 0 dB.
- **Phase:** Respuesta de fase (grados) frente a frecuencia.
- **Min Group Delay:** Retardo de grupo implícito en la respuesta de magnitud de fase mínima.
- **Excess Group Delay:** Retardo de grupo restante tras eliminar la parte de fase mínima (la gráfica se limita a ±100 ms, mientras que las lecturas del cursor muestran el valor real), lo que facilita distinguir el retardo puro y el comportamiento temporal de fase lineal o paso todo.
- **Impulse:** Respuesta al impulso en el dominio temporal desde `-2 ms` hasta **Impulse Range (ms)**, normalizada a su pico.

Pasa el cursor sobre la gráfica para leer los valores de **Before** y **After** en la posición del cursor; pasa el cursor sobre la etiqueta **Before** de la leyenda para ocultar temporalmente **After**. Usa **Smoothing (oct)** en las gráficas de frecuencia, fase y retardo de grupo, e **Impulse Range (ms)** en la gráfica de impulso.

## Cómo funciona la medición

Pipeline Analyzer captura el pipeline activo, su enrutamiento y las respuestas de altavoz seleccionadas, y compensa automáticamente en **After** la latencia comunicada por el pipeline. Si una cola de reverberación o la resonancia de un filtro supera **Sequence Length**, aumenta **Sequence Length** para evitar solapamiento (MLS/TSP) o recorte (**Unit Impulse**). En efectos no lineales, modulados o aleatorios, interpreta la gráfica como una instantánea con los ajustes y el **Level** actuales.

[← Volver al README](README.md)
