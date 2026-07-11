---
title: "Cómo usar la Biblioteca musical - EffeTune"
description: "Explica cómo crear una Biblioteca musical en EffeTune, buscar y reproducir música por carpetas y metadatos, y gestionar listas de reproducción."
lang: es
---

# Cómo usar la Biblioteca musical

La Biblioteca musical indexa las carpetas de música que seleccionas y te permite explorar tu colección local por pistas, álbumes, artistas, géneros, carpetas, elementos añadidos recientemente y listas de reproducción. El audio reproducido pasa por el pipeline de efectos actual de EffeTune, igual que durante la reproducción normal de archivos de música.

La Biblioteca musical guarda dentro de la aplicación su catálogo, la caché de carátulas y las listas de reproducción. No edita, cambia de nombre, mueve ni elimina los archivos de audio.

## Disponibilidad

- **Aplicación de escritorio:** Usa el escáner completo de carpetas y puede mantener disponibles las carpetas seleccionadas entre reinicios de la aplicación. La versión de escritorio también puede mostrar una pista en la carpeta donde está su archivo.
- **Navegadores Chromium en PC:** Usan File System Access cuando está disponible. El acceso a las carpetas puede conservarse, aunque el navegador también puede volver a pedir permiso.
- **Navegadores móviles, Safari y Firefox:** Usan el selector de carpetas o archivos que ofrezca el navegador. En el modo alternativo, se pueden indexar los archivos de la carpeta seleccionada, pero después de recargar la página o de perder permisos puede que tengas que seleccionar otra vez la carpeta o los archivos.

La Biblioteca musical indexa extensiones de archivos multimedia habituales, como MP3, WAV, OGG, FLAC, Opus, M4A, AAC, WebM y MP4. En los archivos MP4, EffeTune reproduce solo la pista de audio y no muestra el vídeo. La reproducción efectiva, incluido el códec de audio del archivo MP4, también depende de las funciones de decodificación del navegador o del sistema operativo.

## Abrir la Biblioteca musical

- **Diseño de PC:** Haz clic en el botón **Biblioteca musical** del encabezado.
- **Diseño móvil:** Abre la pestaña **Biblioteca** en la navegación inferior.
- **Aplicación de escritorio:** También puedes abrirla desde **Ver > Biblioteca musical** o con **Ctrl+L** (**Command+L** en macOS).

Para volver a editar efectos, haz clic en el botón **Effect Pipeline** en el diseño de PC o vuelve a la pestaña **Efectos** en el diseño móvil. En la aplicación de escritorio también puedes usar **Ver > Effect Pipeline** o **Ctrl+E** (**Command+E** en macOS).

Si quieres que la Biblioteca musical sea la primera vista al iniciar, abre **Configuración > Configuración...** y cambia **Vista al inicio:** a **Biblioteca musical**.

## Añadir carpetas de música

1. Abre la Biblioteca musical.
2. Selecciona **Añadir carpeta de música**.
3. Elige la carpeta que contiene tus archivos de música. En navegadores móviles o con el método alternativo, puede aparecer un selector para elegir los archivos de la carpeta en vez de conceder acceso permanente a la carpeta.
4. Espera a que termine el escaneo. La línea de estado muestra el número de pistas y álbumes y, mientras se indexa, también el progreso.

Si intentas añadir una carpeta que ya está dentro de una carpeta registrada, EffeTune te avisa sin indexar contenido duplicado. Si añades una carpeta principal que contiene carpetas ya registradas, puedes combinarlas en la nueva carpeta.

## Explorar y buscar

Usa las pestañas de navegación para cambiar de vista en el catálogo.

- **Pistas** - Muestra todas las pistas indexadas. En el diseño de PC se presenta como una tabla ordenable; en el diseño móvil, como una lista compacta.
- **Álbumes** - Agrupa los álbumes a partir de los metadatos.
- **Artistas** - Agrupa por artistas y artistas de álbum indicados en los metadatos.
- **Géneros** - Agrupa por los géneros indicados en los metadatos.
- **Carpetas** - Muestra las carpetas registradas en la biblioteca y su estado de escaneo.
- **Añadidas recientemente** - Muestra las pistas indexadas recientemente.
- **Listas de reproducción** - Muestra las listas de reproducción creadas o importadas dentro de la Biblioteca musical.

Con **Buscar en la biblioteca** puedes buscar en pistas, álbumes, artistas y listas de reproducción. En el diseño de PC, los encabezados de la lista de pistas permiten ordenar por título, artista, álbum, género o duración.

Si faltan metadatos o no se pueden leer, EffeTune usa el nombre del archivo y la información de la carpeta como alternativa. En **Propiedades de la pista** puedes consultar la ruta del archivo, el formato, la tasa de muestreo, la profundidad de bits, la tasa de bits y los principales campos de metadatos.

## Reproducir desde la biblioteca

Selecciona una pista, álbum, artista, género, carpeta, resultado de búsqueda o lista de reproducción y usa estas acciones.

- **Reproducir** - Sustituye la cola actual del reproductor e inicia la reproducción.
- **Aleatorio** - Reproduce el grupo seleccionado en orden aleatorio.
- **Reproducir a continuación** - Inserta las pistas seleccionadas justo después de la pista actual.
- **Añadir a la cola** - Añade las pistas seleccionadas al final de la cola.
- **Añadir a lista** - Guarda las pistas seleccionadas en una lista de reproducción de la Biblioteca musical.

En PC, puedes hacer doble clic en la fila de una pista para reproducir desde ese punto, o abrir las acciones de la pista con el clic derecho o el menú **Más**. En móvil, toca el botón de reproducción de la fila de una pista para reproducirla, o mantén pulsada una pista para abrir la hoja de acciones.

Los controles normales del reproductor de música y los ajustes de repetición y aleatorio siguen funcionando. En dispositivos con teclado, también funcionan los atajos habituales del reproductor. Si no se puede abrir una pista de la biblioteca porque la carpeta está sin conexión, reconecta o vuelve a importar esa carpeta.

## Actualizar y reconectar carpetas

Usa **Volver a escanear** después de añadir, eliminar, cambiar de nombre o editar las etiquetas de archivos en tus carpetas de música. Al volver a escanear, se actualizan las pistas modificadas, se quitan del catálogo los archivos que ya no se encuentran y se intenta resolver de nuevo los elementos de listas de reproducción que antes no estaban disponibles.

Los estados de la pantalla **Carpetas** indican si cada carpeta está disponible.

- **OK** - La carpeta está disponible.
- **Sin escanear** - La carpeta todavía no se ha indexado.
- **No encontrado** - La carpeta o la ruta guardada no está disponible.
- **Reconectar** - EffeTune necesita permiso de acceso otra vez.

Cuando una carpeta muestre **Reconectar**, selecciona **Reconectar** y vuelve a conceder acceso a la misma carpeta. Quitar una carpeta solo la elimina del catálogo de la Biblioteca musical; los archivos del disco no se borran.

## Listas de reproducción

Las listas de reproducción de la Biblioteca musical se guardan dentro de EffeTune y pueden contener pistas de tus carpetas indexadas.

Puedes hacer lo siguiente.

- Crear una lista de reproducción a partir de pistas seleccionadas de la biblioteca.
- Guardar la cola actual del reproductor como lista de reproducción.
- Cambiar el nombre, duplicar, eliminar y reordenar listas de reproducción.
- Arrastrar pistas dentro de una lista de reproducción para cambiar su orden. En entornos donde arrastrar no sea cómodo, usa **Subir** y **Bajar**.
- Usar **Importar lista** para importar listas de reproducción en formato M3U, M3U8, PLS y XSPF.
- Usar **Exportar M3U8** o **Exportar XSPF** para exportar listas de reproducción.

Al importar, se muestra una vista previa del número de elementos que coinciden con pistas de la biblioteca actual. Los elementos que no coincidan también se conservan, siempre que sea posible, como elementos sin resolver para que puedan resolverse más adelante al añadir o reconectar la carpeta correspondiente.

Al exportar, si eliges **Rutas relativas**, las rutas se escriben, cuando es posible, en relación con la ubicación de exportación. Esto resulta útil si quieres mover la lista de reproducción junto con la carpeta de música.

## Seguridad y almacenamiento

- La Biblioteca musical lee archivos de audio y metadatos, pero no escribe cambios en los archivos de audio.
- La caché de carátulas y las listas de reproducción son datos de la aplicación, no cambios incrustados en los archivos de música.
- El almacenamiento del navegador puede borrarse desde la configuración del navegador o por acciones del usuario. Exporta las listas de reproducción importantes si lo necesitas.
- En la aplicación web, la gestión de permisos del navegador determina si las carpetas siguen disponibles después de recargar.

[← Volver al README](README.md)
