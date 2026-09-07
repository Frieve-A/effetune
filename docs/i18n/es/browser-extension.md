---
title: "Extensión de navegador - EffeTune"
description: "Procesa el audio de una pestaña de Chrome o Edge con la extensión de EffeTune."
lang: es
---

# Extensión de navegador de EffeTune

La extensión procesa el audio de una sola pestaña con el mismo **Effect Pipeline** estéreo de EffeTune. Sirve para escuchar un sitio de vídeo o música sin iniciar la aplicación de escritorio ni configurar un dispositivo de audio virtual.

## Compatibilidad e instalación

Úsala en un PC con Chrome 116 o posterior, o una versión compatible de Microsoft Edge basada en Chromium. Firefox, Safari, los navegadores móviles y la navegación privada no son compatibles. Procesa una pestaña seleccionada cada vez mediante una cadena estéreo en serie.

Instala una extensión obtenida de una tienda desde esa tienda. Para un paquete local, extrae `effetune-extension-<version>.zip` en una carpeta que conservarás. Abre `chrome://extensions` en Chrome o `edge://extensions` en Edge, activa **Developer mode**, elige **Load unpacked** y selecciona esa carpeta. **Load unpacked** no instala el archivo ZIP; vuelve a cargar la extensión en esta página después de sustituir archivos.

## Iniciar, comparar y detener

1. Abre la pestaña cuyo audio quieres procesar e inicia la reproducción.
2. Abre la extensión EffeTune desde la barra de herramientas del navegador.
3. Elige **Start processing**. Cuando la cadena esté lista, el estado pasa de **Starting…** a **Processing**.

La pestaña elegida queda fijada durante la sesión. Para procesar otra, elige **Stop processing**, abre la extensión desde la otra pestaña y vuelve a iniciar el procesamiento. **Bypass effects** permite escuchar la pestaña capturada sin efectos y mantiene la sesión. **Stop processing** libera el audio de la pestaña y restablece su ruta de reproducción normal.

El procesamiento continúa si cierras la ventana emergente o el editor. Al abrirlos de nuevo muestran la pestaña y el estado actuales. Después de reiniciar el navegador, inicia una nueva sesión manualmente: la extensión no captura pestañas de forma automática.

## Editar y usar preajustes

Elige **Edit pipeline** para abrir **EffeTune Pipeline Editor**. Puedes añadir, ordenar, activar o desactivar efectos, ajustar parámetros y usar las visualizaciones disponibles como en EffeTune. **Saved preset** y **Apply** cambian toda la cadena desde la ventana emergente. En el editor, abre **Pipeline Presets** para guardar un preajuste completo con **Save as**. Para importar o exportar preajustes completos, abre **Settings** y elige **Import preset…** o **Export preset**.

Los preajustes y ajustes guardados permanecen en la extensión; no se sincronizan automáticamente con la aplicación web ni con la de escritorio. Si un preajuste requiere un enrutamiento, efecto o recurso externo no disponible, no se aplica y la cadena actual se conserva.

Para usar en Room EQ o Crosstalk Cancellation una medición de la aplicación web o de escritorio, expórtala allí como JSON. En el editor de la extensión, abre **Settings**, elige **Import measurement…** y selecciona ese archivo JSON. Incluye las respuestas al impulso al exportar si vas a usar Crosstalk Cancellation o la corrección de fase de Room EQ. Las mediciones importadas permanecen en el almacenamiento del navegador de la extensión y no se sincronizan automáticamente. Para eliminar una, elige **Delete imported measurement…** en **Settings**; antes de borrarla se quitan las asignaciones que la utilizan.

## Permisos, límites y ayuda

La extensión captura audio solo de la pestaña donde inicias explícitamente el procesamiento. No necesita acceso al micrófono, a todos los sitios web, grabación ni envío de audio a otro lugar.

Admite cadenas estéreo normales. No están disponibles las cadenas multibus o con bifurcaciones, más de dos canales, realizar nuevas mediciones y controlar dispositivos, Music Library, conversión por lotes ni funciones exclusivas de escritorio que dependan de dispositivos o rutas de archivos.

Parte del contenido protegido puede no estar disponible para captura; la extensión no elude la protección. Si no puede iniciar la captura, EffeTune detiene el procesamiento y la pestaña vuelve a su reproducción normal. Comprueba que la pestaña reproduce audio y elige **Start processing** de nuevo. Si aparece **Needs attention**, haz lo mismo. Si un preajuste no se aplica, la cadena actual se conserva; cambia el preajuste o proporciona los recursos necesarios antes de intentarlo de nuevo.
