---
title: "Extensión de navegador - EffeTune"
description: "La extensión procesa simultáneamente el audio de hasta cuatro pestañas, cada una con su propio Effect Pipeline estéreo."
lang: es
---

# Extensión de navegador de EffeTune

La extensión procesa simultáneamente el audio de hasta cuatro pestañas, cada una con su propio **Effect Pipeline** estéreo. Sirve para escuchar un sitio de vídeo o música sin iniciar la aplicación de escritorio ni configurar un dispositivo de audio virtual.

## Compatibilidad e instalación

Úsala en un PC con Chrome 116 o posterior, o una versión compatible de Microsoft Edge basada en Chromium. Firefox, Safari, los navegadores móviles y la navegación privada no son compatibles. Cada pestaña utiliza una cadena de efectos estéreo.

Instala una extensión obtenida de una tienda desde esa tienda. Para un paquete local, extrae `effetune-extension-<version>.zip` en una carpeta que conservarás. Abre `chrome://extensions` en Chrome o `edge://extensions` en Edge, activa **Developer mode**, elige **Load unpacked** y selecciona esa carpeta. **Load unpacked** no instala el archivo ZIP; vuelve a cargar la extensión en esta página después de sustituir archivos.

## Iniciar, comparar y detener

1. Abre la pestaña cuyo audio quieres procesar e inicia la reproducción.
2. Abre la extensión EffeTune desde la barra de herramientas del navegador.
3. Elige **Start on this tab**. Cuando la cadena esté lista, el estado pasa de **Starting…** a **Processing**.

Para añadir otra pestaña, abre la extensión desde ella y elige **Start on this tab**. La ventana muestra todas las sesiones. Puedes procesar hasta cuatro pestañas a la vez; detén una antes de iniciar una quinta. **Bypass** permite escuchar una pestaña sin efectos manteniendo su sesión. **Stop** devuelve esa pestaña a la reproducción normal sin interrumpir las demás.

El procesamiento continúa si cierras la ventana emergente o el editor. Al abrirlos de nuevo muestran la pestaña y el estado actuales. Después de reiniciar el navegador, inicia una nueva sesión manualmente: la extensión no captura pestañas de forma automática.

## Editar y usar preajustes

Elige **Edit pipeline** para abrir **EffeTune Pipeline Editor**. Puedes añadir, ordenar, activar o desactivar efectos, ajustar parámetros y usar las visualizaciones disponibles como en EffeTune. **Saved preset** y **Apply to selected tab** cambian toda la cadena desde la ventana emergente. En el editor, abre **Pipeline Presets** para guardar un preajuste completo con **Save as**. Para importar o exportar preajustes completos, abre **Settings** y elige **Import preset…** o **Export preset**. Selecciona la pestaña en la cabecera del editor para ver su cadena y sus análisis. Sin sesiones activas, **Offline pipeline** permite editar la cadena predeterminada del próximo inicio. En la ventana emergente, selecciona la pestaña a la que aplicarás el preajuste.

Elige **Visualizer** en la cabecera del editor para ver en [Visualizer](visualizer.md) el audio procesado de la pestaña seleccionada; vuelve a elegirlo para regresar a la cadena. Si esa pestaña no se está procesando, Visualizer muestra «Start EffeTune on a tab to show Visualizer.». En la extensión no se muestran los títulos ni las carátulas. **Share** e **Import Link** funcionan igual que en la aplicación web, y los enlaces compartidos se abren en la versión web. Los diseños y preajustes de Visualizer permanecen en la extensión y no se sincronizan con la aplicación web ni con la de escritorio.

Los preajustes y ajustes guardados permanecen en la extensión; no se sincronizan automáticamente con la aplicación web ni con la de escritorio. Si un preajuste requiere un enrutamiento, efecto o recurso externo no disponible, no se aplica y la cadena actual se conserva.

Para usar en Room EQ o Crosstalk Cancellation una medición de la aplicación web o de escritorio, expórtala allí como JSON. En el editor de la extensión, abre **Settings**, elige **Import measurement…** y selecciona ese archivo JSON. Incluye las respuestas al impulso al exportar si vas a usar Crosstalk Cancellation o la corrección de fase de Room EQ. Las mediciones importadas aparecen inmediatamente en la lista **Measurement** de Room EQ, permanecen en el almacenamiento del navegador de la extensión y no se sincronizan automáticamente. Para eliminar una copia importada, selecciónala en esa lista y elige **Delete** junto a ella. Tras la confirmación, se quitan todas las asignaciones de Room EQ y Crosstalk Cancellation que la utilizan antes de eliminar la copia.

Para elegir qué datos guardados quieres trasladar, abre **Settings > Backup / Restore** en el editor. El mismo archivo `.effetune_backup` funciona en las aplicaciones web y de escritorio y puede incluir preajustes de la cadena, preajustes de efectos, preajustes de Visualizer, respuestas al impulso y mediciones importadas. Las cadenas que usen un enrutamiento o efectos no compatibles con la extensión se conservan y pueden volver a incluirse en una copia de seguridad, aunque no se puedan aplicar en la extensión. No se incluyen las reglas de URL ni el ajuste Sample rate de la extensión.

## Preajustes por URL y frecuencia de muestreo

En **Settings**, abre **URL rules…**, añade un patrón, elige un preajuste guardado y activa la regla. Los patrones usan `host/path`, como `example.com/music/*`; `*` coincide con cualquier texto. Se utiliza la primera regla activa que coincida. No se distinguen mayúsculas del nombre de host y se ignoran el protocolo, los parámetros de consulta y el fragmento. Reordena las reglas para ajustar su prioridad, o desactívalas o elimínalas.

Cada pestaña sigue iniciándose manualmente. El preajuste se elige al iniciar y cuando cambia la URL; si ninguna regla coincide, se usa la cadena predeterminada. Los cambios de reglas se aplican en el próximo inicio o navegación. Editar una cadena elegida por una regla actualiza ese preajuste guardado. Las demás ediciones, incluidas las posteriores a aplicar un preajuste manualmente, actualizan la cadena predeterminada. Eliminar un preajuste desactiva sus reglas y devuelve las pestañas que las usan a la cadena predeterminada.

**Sample rate**, en **Settings**, afecta a todas las pestañas activas: **Auto**, **44.1 kHz**, **48 kHz**, **96 kHz** o **192 kHz**. Auto deja que el navegador elija. Al cambiarla, el procesamiento de todas las pestañas se reinicia brevemente sin perder sus capturas. Si una pestaña no puede funcionar a esa frecuencia, vuelve a reproducirse normalmente; elige otra frecuencia e inicia de nuevo su procesamiento.

## Permisos, límites y ayuda

La extensión solo captura audio de las pestañas donde inicias expresamente el procesamiento. Lee sus URL, también después de navegar, para elegir preajustes guardados. No lee el contenido de las páginas, no inserta scripts, no usa el micrófono, no graba audio ni lo envía a otros servicios.

Las cadenas estéreo admiten Bus Routing con Main y Bus 1–4, incluidas las rutas de efectos en paralelo. En la extensión no están disponibles más de dos canales, realizar nuevas mediciones y controlar dispositivos, Music Library, la conversión de archivos por lotes ni las funciones exclusivas de escritorio que dependan de dispositivos o rutas de archivos.

Parte del contenido protegido puede no estar disponible para captura; la extensión no elude la protección. Si no puede iniciar la captura, EffeTune detiene el procesamiento y la pestaña vuelve a su reproducción normal. Comprueba que la pestaña reproduce audio y elige **Start on this tab** de nuevo. Si aparece **Needs attention**, haz lo mismo. Si un preajuste no se aplica, la cadena actual se conserva; cambia el preajuste o proporciona los recursos necesarios antes de intentarlo de nuevo.
