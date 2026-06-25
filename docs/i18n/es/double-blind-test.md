---
title: "Guía de Double Blind Test - EffeTune"
description: "Ejecuta pruebas de escucha a ciegas ABX y de preferencia A/B entre dos pipelines de efectos en EffeTune y revisa los resultados con significación estadística."
lang: es
---

# Cómo usar Double Blind Test

Double Blind Test te permite comparar de oído **Pipeline A** y **Pipeline B** sin saber cuál estás escuchando. Sirve para comprobar, sin sesgos, si una diferencia que *crees* oír realmente se distingue y cuál de los dos pipelines prefieres de verdad.

Hay dos tipos de prueba:

- **ABX Test**: comprueba si puedes distinguir de forma fiable los dos pipelines.
- **A/B Preference Test**: eliges cuál prefieres sin saber cuál es cuál.

En ambos casos, EffeTune registra tus respuestas y muestra un valor p para que puedas ver si el resultado es estadísticamente significativo.

## Preparar los dos pipelines

La prueba compara los dos pipelines descritos en [Usando Funciones de Pipeline AB](README.md#usando-funciones-de-pipeline-ab):

- **Pipeline A** y **Pipeline B** deben contener al menos un efecto cada uno.
- Coloca una de las configuraciones que quieres comparar en Pipeline A y la otra en Pipeline B. Mantén igual todo lo demás salvo el punto que quieres probar, por ejemplo *Con EQ* y *Sin EQ*, para comprobar solo esa diferencia.
- En un **A/B Preference Test**, no importa cuál de las dos configuraciones pongas en Pipeline A y cuál en Pipeline B. Durante la prueba, qué sonido se presenta como A o B se decide aleatoriamente en cada ensayo, así que ninguna posición tiene ventaja o desventaja. Si intercambias las configuraciones, también se intercambiará la etiqueta del pipeline ganador que muestra el resultado, pero la interpretación estadística no cambia. Lo importante es recordar qué configuraste en cada pipeline: el resultado indica si se prefirió de forma significativa Pipeline A o Pipeline B, y debes compararlo con tu propia configuración para saber cuál sonido preferiste. Un resultado claro suele indicar que elegiste de manera constante una diferencia que realmente separa tus preferencias. Si ambos suenan igual o tus elecciones varían, normalmente no aparecerá una preferencia significativa.
- Puedes abrir el panel de prueba en cualquier momento, pero los botones de inicio permanecen desactivados hasta que existan ambos pipelines. Si falta Pipeline B, se muestra un aviso.

## Abrir la prueba

- **Aplicación web:** en el encabezado Effect Pipeline, haz clic en el botón **▼** situado justo a la derecha del botón de alternancia A/B, el botón que muestra "A" o "B" según el pipeline actual, y elige **Double Blind Test** en el menú que aparece.
- **Aplicación de escritorio:** además del mismo menú **▼**, también puedes abrir la prueba desde **Archivo > Double Blind Test**.

Mientras la prueba está abierta, la visualización del Effect Pipeline queda oculta para que no puedas ver qué efectos están activos y se mantenga la escucha a ciegas. Puedes cerrar la prueba en cualquier momento con el botón **×** para volver a la vista normal.

## Configurar la prueba

La pantalla de configuración ofrece estos elementos:

- **Test name:** describe la diferencia que estás probando, por ejemplo *Con EQ vs. Sin EQ*. El selector funciona como Effect Presets: puedes guardar, recuperar y eliminar pruebas con nombre. Una prueba guardada incluye ambos pipelines y el número de ensayos, de modo que puedes volver a cargar la misma comparación más adelante. Para compartir una prueba, el nombre es obligatorio.
- **Your name:** opcional. Se muestra en el resultado. Si se deja vacío, aparecerá como *Anonymous*.
- **Number of tests:** cuántos ensayos se ejecutarán, ajustados con el campo de entrada o el control deslizante. Más ensayos dan un resultado más fiable, pero requieren más tiempo. El valor predeterminado es 20.

Pulsa **Start ABX Test** o **Start A/B Preference Test** para comenzar.

> **Nota:** Las letras **A** y **B** dentro de la prueba no son lo mismo que Pipeline A y Pipeline B del Effect Pipeline. En cada ensayo, EffeTune decide de nuevo al azar qué pipeline se asigna a A y cuál a B, y esa correspondencia no se muestra en pantalla. Por eso no puedes saber qué pipeline real estás escuchando como A en ese momento, ni asumir que "A" significa Pipeline A. Así se mantiene la prueba a ciegas.

## Reproducir audio

La prueba solo cambia de pipeline; tú proporcionas la música como siempre:

- arrastra y suelta un archivo de música, o ábrelo desde el menú Archivo, o
- introduce audio en EffeTune desde una fuente física.

La tasa de muestreo del dispositivo de audio se muestra en la pantalla de la prueba como referencia.

## Realizar una prueba ABX

1. Usa los botones **Switch to A**, **Switch to B** y **Switch to X** para cambiar el audio en reproducción entre las muestras. **X** es igual a A o a B, elegido aleatoriamente en cada ensayo.
2. Cambia de una muestra a otra tantas veces como necesites hasta decidir con cuál coincide **X**.
3. Haz clic en **X matches A** o **X matches B** para registrar tu respuesta y pasar al siguiente ensayo.

También puedes cambiar con el teclado: pulsa la tecla **A**, **B** o **X**, o la tecla **1**, **2** o **3** de la fila superior o del teclado numérico, para activar la muestra correspondiente como si hubieras pulsado el botón. Para votar, pulsa **Q** para **X matches A** o **W** para **X matches B**.

## Realizar un A/B Preference Test

1. Usa **Switch to A** y **Switch to B** para comparar los dos sonidos. En este modo no hay X.
2. Cuando hayas decidido cuál prefieres, haz clic en **Prefer A** o **Prefer B**.

También puedes cambiar con el teclado: pulsa **A** o **B**, o **1** o **2** en la fila superior o el teclado numérico, para cambiar la muestra activa. Para votar, pulsa **Q** para **Prefer A** o **W** para **Prefer B**.

## Leer el resultado

Cuando terminan todos los ensayos, EffeTune muestra el resultado:

- **ABX Test:** se muestran el porcentaje de aciertos, los aciertos sobre el total y el valor p de una prueba binomial unilateral. Si **p < 0.05**, el resultado es estadísticamente significativo, por lo que tus respuestas difícilmente se explican solo por azar y puede decirse que pudiste distinguir los dos pipelines. En caso contrario, no puede decirse que los hayas distinguido.
- **A/B Preference Test:** se muestra el pipeline elegido más veces, Pipeline A si hay empate, junto con cuántas veces fue elegido, como recuento sobre el total, y el valor p de una prueba binomial bilateral. El porcentaje mostrado corresponde siempre al lado ganador, por lo que siempre es del 50% o más; un porcentaje alto por sí solo no significa que exista una preferencia real. La decisión se basa en el valor p: si **p < 0.05**, hubo una preferencia significativa. En caso contrario, no puede decirse que hubiera una preferencia significativa; un resultado cercano al 50% está dentro de lo esperable por azar.

También se muestra el tiempo total empleado en completar la prueba.

## Compartir una prueba

Haz clic en **Share this test** para copiar una URL al portapapeles. Esa URL reproduce **ambos pipelines de efectos y abre la prueba a ciegas**, de modo que quien la reciba puede ejecutar la misma comparación de pipelines. Puedes compartirla desde la pantalla de configuración antes de empezar o después de terminar. Si compartes antes de empezar, lo principal que se comparte es la comparación entre los dos pipelines; confirma el número de ensayos antes de iniciar. Si compartes después de completar la prueba, también se incluye tu resultado, y la persona que reciba la URL podrá revisarlo antes de probar la misma comparación por su cuenta.

Para compartir, necesitas ambos pipelines y un nombre de prueba. Esto hace que la comparación compartida tenga sentido y pueda reproducirse en el otro equipo.

Cómo usar una URL de prueba compartida:

- **Aplicación web:** abre la URL compartida en un navegador. EffeTune restaura ambos pipelines y abre Double Blind Test automáticamente.
- **Aplicación de escritorio:** copia la URL compartida, cambia a EffeTune y pégala con **Editar > Pegar**, **Ctrl+V** o **Command+V** en macOS, o con el botón **Pegar efectos** de la barra de herramientas. EffeTune lee la URL del portapapeles, restaura ambos pipelines y abre Double Blind Test. Pega la URL cuando el panel Double Blind Test todavía no esté abierto.

[← Volver al README](README.md)
