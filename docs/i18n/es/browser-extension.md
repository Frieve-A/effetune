---
title: "Extensión de navegador - Ecualizador y efectos de audio para Chrome y Edge - EffeTune"
description: "Procesa el audio de hasta cuatro pestañas de Chrome o Edge con EffeTune, con preajustes por URL y frecuencia de muestreo seleccionable."
lang: es
---

# Extensión de navegador de EffeTune

La extensión de navegador de EffeTune procesa simultáneamente el audio de hasta cuatro pestañas del navegador, cada una con su propio Effect Pipeline estéreo. Resulta útil para escuchar sitios de vídeo o música sin iniciar la aplicación de escritorio ni configurar un dispositivo de audio virtual.

Para consultar cómo se tratan los datos locales y los enlaces externos opcionales, lee la [Política de privacidad de la extensión de navegador](../../browser-extension-privacy.md). Si necesitas ayuda, utiliza [GitHub Issues](https://github.com/Frieve-A/effetune/issues), pero no publiques audio, títulos ni URL de pestañas, preajustes, mediciones, respuestas al impulso ni otra información privada en una incidencia pública.

## Compatibilidad

Usa la extensión en un PC con Chrome 116 o posterior, o con una versión compatible de Microsoft Edge basada en Chromium. Firefox, Safari, los navegadores móviles y la navegación privada no son compatibles. Cada pestaña utiliza una cadena de efectos estéreo.

## Instalación de un paquete local

Si obtuviste la extensión desde la tienda del navegador, instálala allí. Para un paquete local, extrae `effetune-extension-<version>.zip` en una carpeta que vayas a conservar y carga esa carpeta extraída:

1. En Chrome, abre `chrome://extensions`. En Edge, abre `edge://extensions`.
2. Activa **Developer mode**.
3. Elige **Load unpacked** y selecciona la carpeta extraída de la extensión.

**Load unpacked** no puede instalar directamente el archivo ZIP. Vuelve a cargar la extensión desde esta página tras sustituir archivos en la carpeta extraída.

## Iniciar, comparar y detener el procesamiento

1. Abre la pestaña cuyo audio quieras procesar e inicia la reproducción.
2. Abre la extensión EffeTune desde la barra de herramientas del navegador.
3. Elige **Start on this tab**. El estado cambia de **Starting…** a **Processing** cuando la cadena de efectos está lista.

Para añadir otra pestaña, abre la extensión desde esa pestaña y elige **Start on this tab**. La ventana emergente enumera todas las sesiones. Pueden ejecutarse hasta cuatro pestañas a la vez; detén una antes de iniciar una quinta.

Usa **Bypass** junto a una pestaña para escucharla sin efectos mientras mantienes activa su sesión. Elige **Stop** junto a esa pestaña cuando termines; la pestaña volverá a la reproducción normal sin interrumpir las demás.

Puedes cerrar la ventana emergente o el editor mientras continúa el procesamiento. Al volver a abrir cualquiera de los dos, mostrará la pestaña actual y su estado. Después de reiniciar el navegador, inicia una sesión nueva; la extensión no captura pestañas automáticamente.

## Editar el Effect Pipeline y usar preajustes

Elige **Edit pipeline** para abrir **EffeTune Pipeline Editor** y selecciona la pestaña de destino en la cabecera. Añade, reordena, activa o desactiva y ajusta efectos igual que en EffeTune; los analizadores siguen a la pestaña seleccionada. Cuando no hay ninguna pestaña activa, **Offline pipeline** edita la cadena predeterminada que se usará en la próxima pestaña que inicies.

Selecciona **Visualizer** en la cabecera del editor para ver el audio procesado de la pestaña seleccionada en [Visualizer](visualizer.md), o vuelve a pulsarlo para regresar al pipeline. En la extensión no se muestran títulos de pistas ni carátulas, y **Share** / **Import Link** funcionan igual que en la aplicación web.

Para cambiar de preajuste rápidamente desde la ventana emergente, selecciona una pestaña, elige un **Saved preset** y haz clic en **Apply to selected tab**. En el editor, usa **Pipeline Presets > Save as** para guardar un preajuste, o **Settings > Import preset…** / **Export preset** para intercambiar archivos `.effetune_preset`. Si un preajuste requiere enrutamiento multicanal no compatible, efectos no admitidos o recursos externos que faltan, se conserva la cadena actual sin cambios.

Para usar una medición de sala o de altavoz de la aplicación web o de escritorio con **Room EQ** o **Crosstalk Cancellation**:

1. Exporta la medición como JSON desde la aplicación web o de escritorio (incluye las respuestas al impulso si vas a usar **Crosstalk Cancellation** o la corrección de fase de **Room EQ**).
2. En el editor de la extensión, abre **Settings > Import measurement…** y selecciona el archivo JSON.
3. Selecciona la medición importada en **Room EQ** o **Crosstalk Cancellation**. Para eliminar una copia importada, selecciónala en la lista **Measurement** de Room EQ y elige **Delete**; tras confirmarlo, se borran todas las asignaciones de Room EQ y Crosstalk Cancellation que la usan.

Para trasladar conjuntamente preajustes, preajustes de efectos, preajustes de Visualizer, respuestas al impulso y mediciones importadas entre la aplicación web, la de escritorio y la extensión, usa **Settings > Backup / Restore** (`.effetune_backup`). Los preajustes, diseños y mediciones importadas de la extensión se guardan localmente dentro de la extensión y no se sincronizan automáticamente con la aplicación web ni con la de escritorio. Las copias de seguridad no incluyen las reglas de URL ni el ajuste de frecuencia de muestreo de la extensión.

## Preajustes por URL y frecuencia de muestreo

Abre **Settings > URL rules…** para cargar automáticamente un preajuste guardado cuando la URL de una pestaña coincida con un patrón `host/path` (como `example.com/music/*`, donde `*` coincide con cualquier texto). Cada pestaña la sigues iniciando tú; las reglas solo eligen su preajuste al iniciarla y cuando cambia su URL. Tiene prioridad la primera regla activa que coincida en la lista; si ninguna coincide, se utiliza la cadena predeterminada. Los cambios en las reglas se aplican en el siguiente inicio o al navegar a otra página. Editar una cadena cargada por una regla de URL actualiza el preajuste guardado de esa regla, mientras que el resto de ediciones, incluidas las realizadas tras aplicar un preajuste manualmente, actualizan la cadena predeterminada. Al eliminar un preajuste se desactivan sus reglas y las pestañas que las usaban vuelven a la cadena predeterminada.

**Sample rate** en **Settings** se aplica a todas las pestañas activas (**Auto**, **44.1 kHz**, **48 kHz**, **96 kHz** o **192 kHz**). **Auto** deja que el navegador elija. Al cambiar la frecuencia se reinicia brevemente el procesamiento en las pestañas activas, que conservan sus capturas. Si una pestaña no puede ejecutarse a la nueva frecuencia, vuelve a la reproducción normal; selecciona otra frecuencia y vuelve a iniciar la pestaña.

## Permisos y límites

La extensión captura audio únicamente de las pestañas donde haces clic en **Start on this tab** y lee las URL de esas pestañas solo para comparar reglas de preajustes por URL. Nunca lee el contenido de las páginas, ni inserta scripts, ni usa el micrófono, ni envía audio por la red.

Cada pestaña ejecuta una cadena estéreo compatible con **Main** y **Bus 1–4**. La salida multicanal (>2 canales), la ejecución de mediciones acústicas, Music Library, la conversión de archivos por lotes sin conexión y las funciones de hardware exclusivas de escritorio no están disponibles en la extensión. Las transmisiones protegidas (DRM) que bloquean la captura del navegador vuelven a la reproducción normal.

## Si algo falla

- **El estado muestra "Needs attention" o la captura no se inicia:** Asegúrate de que la pestaña esté reproduciendo audio activamente y vuelve a hacer clic en **Start on this tab**.
- **No se puede aplicar un preajuste:** El editor conserva la cadena actual. Comprueba que las mediciones o respuestas al impulso necesarias se hayan importado antes en la extensión.

[← Volver al README](README.md)
