---
title: "Medición y corrección de la respuesta en frecuencia - EffeTune"
description: "Mide con un micrófono la respuesta en frecuencia de tu sistema de audio en EffeTune, crea un EQ de corrección e importa, calibra y exporta respuestas impulsionales."
lang: es
---

# Medición y corrección de la respuesta en frecuencia

Para medir la respuesta en frecuencia de tu sistema de audio y crear un EQ de corrección plano:
1. Abre la [herramienta de medición de respuesta en frecuencia](https://effetune.frieve.com/features/measurement/measurement.html) o selecciona **Medición de respuesta en frecuencia** en el menú Configuración.
2. Sigue la configuración guiada para preparar el micrófono de medición y el dispositivo de salida.
3. Mide la respuesta en frecuencia de tu sistema en una o varias posiciones de escucha.
4. Genera una corrección de EQ paramétrico que se puede importar directamente en EffeTune.
5. Aplica la corrección para lograr una reproducción más precisa y neutral.

## Canales de salida

Ajusta **Número de canales del dispositivo de salida** según tu dispositivo de salida: **6** para 5.1 u **8** para 7.1. Las opciones de canal de salida y de ancho de banda por canal se limitan a este rango. Las señales de prueba y las mediciones siempre usan este número de canales, así que mantén **6** aunque solo midas Ch 3 (central) y Ch 4 (subwoofer) en un dispositivo 5.1.

Para un sistema multicanal, selecciona **Todos los canales** para medir todas las salidas juntas, o selecciona elementos individuales de **Canal de salida** para medirlos uno a uno. En **Ajustes avanzados**, elige **Desactivado**, **El mismo para todos los canales** o **Por canal** para el ancho de banda del barrido. Con **Por canal**, usa **Canal que se configurará** para ajustar el rango de frecuencias de cada canal de salida seleccionado. Durante el ajuste de nivel, **Modo de canal** empieza en **Rotación automática**; selecciona un canal de señal de prueba o **Manual** cuando sea necesario.

## Importar una respuesta al impulso

Si ya tienes un archivo WAV de respuesta impulsional, elige **Importar** y selecciónalo. EffeTune guarda cada canal del WAV como un resultado de medición que puedes usar en **Room EQ** y en otras funciones basadas en mediciones.

## Calibración de la interfaz de audio

Para eliminar la respuesta propia de la interfaz de audio, conecta directamente su salida a su entrada y guarda ese bucle como una medición normal sin calibrar que incluya una respuesta impulsional. Al medir los altavoces, selecciona ese punto guardado en **Calibración de la interfaz de audio** y mantén la misma interfaz, los mismos canales, la misma frecuencia de muestreo y los mismos ajustes de ganancia de entrada y salida. Elige **Ninguna (sin calibrar)** para medir sin calibración por bucle.

## Ver y exportar resultados

Las mediciones guardadas que incluyen datos de respuesta impulsional muestran un gráfico normalizado de **Respuesta impulsional** que se abre en el intervalo de 0 a 10 ms desde el inicio detectado. Usa la rueda del ratón o los botones para ampliar o reducir el eje temporal, y arrastra el gráfico o usa el control deslizante para desplazarte. Al seleccionar un punto de medición se actualiza el gráfico; **Todos (promedio)** muestra el primer punto con una respuesta impulsional guardada y lo identifica sobre el gráfico. Usa **Exportar respuesta impulsional (WAV)** debajo del gráfico para guardar la respuesta completa y sin normalizar del punto mostrado como un WAV mono de coma flotante de 32 bits con la frecuencia de muestreo de la medición.

Para revisar las respuestas Frequency, Phase, Min Group Delay, Excess Group Delay e Impulse del pipeline activo, incluidas hasta cuatro salidas seleccionadas y, si quieres, respuestas de altavoz guardadas, consulta la [guía de Pipeline Analyzer](pipeline-analyzer.md).

[← Volver al README](README.md)
