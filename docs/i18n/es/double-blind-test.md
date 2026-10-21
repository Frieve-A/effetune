---
title: "Guía de la prueba de doble ciego - Pruebas de escucha a ciegas ABX y A/B - EffeTune"
description: "Ejecuta pruebas de escucha a ciegas ABX y de preferencia A/B entre dos pipelines de efectos en EffeTune y revisa los resultados con significación estadística."
lang: es
---

# Cómo usar la prueba de doble ciego

La prueba de doble ciego permite comparar de oído **Pipeline A** y **Pipeline B**. Es una forma controlada de comprobar si una diferencia que *crees* oír se distingue de verdad y si realmente prefieres un pipeline frente al otro.

Hay dos tipos de prueba disponibles:

- **Prueba ABX** – Comprueba si puedes distinguir de forma fiable los dos pipelines.
- **Prueba de preferencia A/B** – Elige qué pipeline prefieres sin saber cuál es cuál.

En ambos casos, EffeTune registra tus respuestas y calcula un valor p para que veas si el resultado es estadísticamente significativo.

## Preparar los dos pipelines

La prueba compara los dos pipelines descritos en [Usando Funciones de Pipeline AB](README.md#usando-funciones-de-pipeline-ab):

- **Pipeline A** y **Pipeline B** deben contener al menos un efecto cada uno.
- Coloca una configuración en Pipeline A y la otra en Pipeline B, manteniendo idéntico todo lo demás (por ejemplo, *Con EQ* frente a *Sin EQ*) para evaluar únicamente esa diferencia.
- Recuerda qué configuración pusiste en Pipeline A y cuál en Pipeline B. En una prueba de preferencia A/B, el resultado indica si se prefirió de forma significativa Pipeline A o Pipeline B.
- La opción «Prueba de doble ciego» del menú y los botones de inicio permanecen desactivados hasta que Pipeline A y Pipeline B contengan al menos un efecto cada uno.

## Abrir la prueba

- **Aplicación web:** En el encabezado de Effect Pipeline, haz clic en el botón **▼** situado justo a la derecha del botón de alternancia A/B (el botón que muestra "A" o "B" según el pipeline actual) y elige **Prueba de doble ciego** en el menú que aparece.
- **Aplicación de escritorio:** Además del mismo menú **▼**, también puedes abrir la prueba desde el menú **Archivo**.

Mientras la prueba está abierta, la vista del pipeline de efectos se oculta para que no veas qué efectos están activos y se mantenga la escucha a ciegas. Cierra la prueba en cualquier momento con el botón **×** para volver a la vista normal.

## Configurar la prueba

La pantalla de configuración incluye los siguientes campos:

- **Nombre de la prueba** – Describe la diferencia que estás probando (por ejemplo, *Con EQ vs. Sin EQ*). El cuadro combinado funciona igual que Preajustes de efecto: puedes **guardar**, **cargar** y **eliminar** pruebas con nombre. Una prueba guardada conserva ambos pipelines y el número de ensayos para que puedas repetir la misma comparación más adelante. Es necesario indicar un nombre antes de compartir una prueba.
- **Tu nombre** – Opcional. Se muestra en el resultado; si se deja en blanco aparece como *Anónimo*.
- **Número de ensayos** – Número de ensayos que se realizarán (ajústalo con el cuadro numérico o el control deslizante). Más ensayos ofrecen un resultado más fiable, pero llevan más tiempo. El valor predeterminado es 20.
- **Mantener A/B fijos en las pruebas ABX** – Activado de forma predeterminada. Durante toda la prueba ABX, A corresponde al Pipeline A original y B al Pipeline B original. X sigue eligiéndose al azar en cada ensayo. Desmarca la casilla para que las asignaciones de A y B también se elijan al azar en cada ensayo. Esta opción se conserva al guardar o compartir la prueba.

Pulsa **Iniciar prueba ABX** o **Iniciar prueba de preferencia A/B** para comenzar.

> **Nota:** En una prueba de preferencia A/B, las asignaciones de A y B siempre se eligen al azar en cada ensayo, independientemente de esta casilla. Por tanto, la A de la prueba no corresponde necesariamente al Pipeline A original, y la asignación permanece oculta.

## Reproducir audio

La prueba solo conmuta entre pipelines; tú reproduces la música como de costumbre:

- Arrastra y suelta un archivo de música (o ábrelo desde el menú Archivo), o
- Introduce audio en EffeTune desde una fuente física.

La frecuencia de muestreo del dispositivo de audio se muestra en la pantalla de la prueba como referencia.

## Realizar una prueba ABX

1. Usa los botones **Cambiar a A**, **Cambiar a B** y **Cambiar a X** para alternar el audio en directo entre las muestras. **X** es igual a A o a B, elegido al azar en cada ensayo.
2. Alterna entre ellas tantas veces como quieras hasta identificar con qué muestra coincide **X**.
3. Haz clic en **X coincide con A** o **X coincide con B** para registrar tu respuesta y pasar al siguiente ensayo.

También puedes cambiar con el teclado: pulsa las teclas **A**, **B** o **X** —o **1**, **2** o **3** (fila superior o teclado numérico)— para cambiar la muestra activa igual que con los botones. Para responder, pulsa **Q** para **X coincide con A** o **W** para **X coincide con B**.

## Realizar una prueba de preferencia A/B

1. Usa los botones **Cambiar a A** y **Cambiar a B** para comparar las dos muestras (en este modo no hay X).
2. Cuando decidas cuál prefieres, haz clic en **Prefiero A** o **Prefiero B**.

También puedes cambiar con el teclado: pulsa las teclas **A** o **B** —o **1** o **2** (fila superior o teclado numérico)— para cambiar la muestra activa. Para responder, pulsa **Q** para **Prefiero A** o **W** para **Prefiero B**.

## Leer el resultado

Al completar todos los ensayos, EffeTune muestra el resultado:

- **Prueba ABX** – Tu puntuación (porcentaje y aciertos / total) y el valor p de una prueba binomial unilateral. Si **p < 0.05**, el resultado es estadísticamente significativo: es improbable que tus respuestas se deban solo al azar y pudiste distinguir los dos pipelines. De lo contrario, no puede afirmarse que los hayas distinguido.
- **Prueba de preferencia A/B** – El pipeline elegido más veces (mostrado como Pipeline A en caso de empate) y cuántas veces se eligió (recuento / total), junto con el valor p de una prueba binomial bilateral. El porcentaje mostrado es siempre del 50% o superior porque refleja el lado ganador, por lo que un porcentaje alto por sí solo no implica una preferencia real. Lo determinante es el valor p: si **p < 0.05**, tu preferencia es significativa; en caso contrario, no puede afirmarse que hubiera una preferencia significativa (un valor cercano al 50% entra dentro del azar).

También se muestra el tiempo total empleado.

## Compartir una prueba

Haz clic en **Compartir esta prueba** para copiar una URL al portapapeles. La URL reproduce **ambos pipelines de efectos y abre la prueba a ciegas**, de modo que quien la abra pueda realizar la misma comparación de pipelines. Puedes compartirla en cualquier momento: desde la pantalla de configuración antes de empezar o al finalizar. Si compartes antes de empezar, lo importante que se comparte es la comparación entre los dos pipelines; confirma el número de ensayos antes de comenzar. Si compartes tras completar la prueba, también se incluye tu resultado y el destinatario lo verá antes de realizar la prueba por su cuenta.

Para compartir se requieren ambos pipelines y un nombre de prueba, de modo que la comparación compartida tenga sentido y pueda reproducirse en el otro extremo.

Cómo usar una URL de prueba compartida:

- **Aplicación web:** Abre la URL compartida en el navegador. EffeTune restaura ambos pipelines y abre la prueba de doble ciego automáticamente.
- **Aplicación de escritorio:** Copia la URL compartida, cambia a EffeTune y pégala con **Editar > Pegar**, **Ctrl+V** (o **Command+V** en macOS) o el botón **Pegar efectos** de la barra de herramientas. EffeTune lee la URL del portapapeles, restaura ambos pipelines y abre la prueba de doble ciego. Pega la URL mientras el panel de la prueba de doble ciego no esté abierto.

[← Volver al README](README.md)
