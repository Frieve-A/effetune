---
title: "Cómo usar la Biblioteca musical - EffeTune"
description: "Explica cómo crear una Biblioteca musical en EffeTune, buscar y reproducir música por subcarpetas o metadatos, y gestionar listas de reproducción."
lang: es
---

# Cómo usar la Biblioteca musical

La versión 2.1.0 incorpora la Biblioteca musical compatible con CUE y el esquema de catálogo v3. Las carpetas y listas de reproducción de la Biblioteca musical anterior no se transfieren a este catálogo: vuelve a añadir tus carpetas de música y crea o importa de nuevo tus listas. El catálogo anterior y los archivos de audio no se modifican.

La Biblioteca musical indexa las carpetas de música que seleccionas y te permite explorar tu colección local por pistas, álbumes, artistas, géneros, subcarpetas, carpetas, elementos añadidos recientemente y listas de reproducción. El audio reproducido pasa por el pipeline de efectos actual de EffeTune, igual que durante la reproducción normal de archivos de música.

La Biblioteca musical guarda dentro de la aplicación su catálogo, la caché de carátulas y las listas de reproducción. No edita, cambia de nombre, mueve ni elimina los archivos de audio.

## Disponibilidad

- **Aplicación de escritorio:** Usa el escáner completo de carpetas y puede mantener disponibles las carpetas seleccionadas entre reinicios de la aplicación. La versión de escritorio también puede mostrar una pista en la carpeta donde está su archivo.
- **Navegadores Chromium en PC con File System Access:** Guardan de forma persistente el identificador de la carpeta seleccionada. Puede reutilizarse tras recargar una vez concedido el acceso, aunque el navegador puede volver a pedir permiso.
- **Navegadores móviles, Safari, Firefox y otros sin File System Access:** Conservan los objetos `File` seleccionados solo durante la sesión actual de la página. El catálogo permanece guardado, pero los archivos no pueden volver a abrirse tras recargar. Selecciona otra vez la carpeta o los archivos después de cada recarga; EffeTune los enlaza con las entradas existentes mediante la ruta relativa normalizada.

La Biblioteca musical indexa extensiones de archivos multimedia habituales, como MP3, WAV, OGG, FLAC, Opus, M4A, AAC, WebM y MP4. También puede usar una hoja CUE externa para dividir en pistas un archivo de álbum WAV o FLAC situado en la misma carpeta. En los archivos MP4, EffeTune reproduce solo la pista de audio y no muestra el vídeo. La reproducción efectiva, incluido el códec de audio del archivo MP4, también depende de las funciones de decodificación del navegador o del sistema operativo.

## Abrir la Biblioteca musical

- **Diseño de PC:** Haz clic en el botón **Biblioteca musical** del encabezado.
- **Diseño móvil:** Abre la pestaña **Biblioteca** en la navegación inferior.
- **Aplicación de escritorio:** También puedes abrirla desde **Ver > Biblioteca musical** o con **Ctrl+L** (**Command+L** en macOS).

Para volver a editar efectos, haz clic en el botón **Effect Pipeline** en el diseño de PC o vuelve a la pestaña **Efectos** en el diseño móvil. En la aplicación de escritorio también puedes usar **Ver > Effect Pipeline** o **Ctrl+E** (**Command+E** en macOS).

Si quieres que la Biblioteca musical sea la primera vista al iniciar, abre **Configuración > Configuración...** y cambia **Vista al inicio:** a **Biblioteca musical**. En la lista situada junto a **Biblioteca musical**, elige la sección que aparecerá primero: **Pistas**, **Álbumes**, **Artistas**, **Géneros**, **Subcarpetas**, **Carpetas** o **Listas de reproducción**.

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
- **Subcarpetas** - Agrupa las pistas por la subcarpeta que las contiene.
- **Carpetas** - Muestra las raíces de música registradas, su estado de escaneo y su estructura real de directorios.
- **Añadidas recientemente** - Muestra las pistas indexadas recientemente.
- **Listas de reproducción** - Muestra las listas de reproducción creadas o importadas dentro de la Biblioteca musical.

Un valor de artista del álbum separado por punto y coma, como `Artist A; Artist B`, se indexa bajo cada artista y conserva el crédito completo en pantalla. `&`, `/` y `feat.` no se tratan como separadores.

Abre una raíz en **Carpetas** para recorrerla en **Vista de árbol**. Las subcarpetas aparecen encima de la lista de pistas; selecciona una para entrar en ella y usa la ruta de navegación o **Anterior** para subir de nivel. La lista solo muestra las pistas guardadas directamente en el nivel actual. **Vista plana** muestra, en cambio, todas las pistas indexadas de la raíz registrada, incluidas las de sus subcarpetas. Al cambiar de vista se conserva la ubicación actual, de modo que puedes volver al mismo punto en **Vista de árbol**. **Buscar en la biblioteca** sigue buscando en toda la biblioteca, por lo que la lista de subcarpetas se oculta durante la búsqueda.

El árbol de **Carpetas** respeta las rutas relativas físicas exactas e incluye todas las entradas de pista encontradas en el catálogo, incluso mientras se analizan sus metadatos o si el análisis falla. El número de una carpeta incluye las pistas de esa carpeta y de todos sus descendientes. Las pistas CUE se cuentan por separado: varias pistas lógicas que comparten un único WAV o FLAC cuentan como varias pistas, no como un solo archivo de audio físico. **Subcarpetas** tiene otra finalidad: agrupa las pistas analizadas correctamente según la identidad normalizada de su carpeta superior directa, por lo que puede combinar variantes que solo difieren en mayúsculas, minúsculas o normalización Unicode.

Por ejemplo, `Artist/Album/01 Song.flac` aparece en el grupo de subcarpeta `Artist/Album` y bajo `Artist` y después `Album` en el árbol físico de **Carpetas**. Las rutas relativas idénticas de distintas raíces indexadas se mantienen separadas. Los archivos situados directamente en una raíz no crean un grupo de subcarpeta, pero siguen disponibles en **Pistas** y en la lista de pistas directas de esa raíz en **Carpetas**.

Con **Buscar en la biblioteca** puedes buscar en pistas, álbumes, artistas y listas de reproducción. En el diseño de PC, los encabezados de la lista de pistas permiten ordenar por título, artista, álbum, género o duración. Las vistas de álbumes, artistas, géneros, subcarpetas y listas de reproducción incluyen una lista **Ordenar** basada en el catálogo. Según la vista, permite ordenar por nombre, artista, año, ruta, número de pistas, duración total, fecha de actualización o fecha de creación, en ambos sentidos. Cada vista conserva su propia selección.

Al buscar pistas, los términos de tres o más caracteres coinciden en cualquier parte del título, artista, álbum, género, nombre de archivo o ruta. Los términos de uno o dos caracteres solo coinciden al principio de una palabra. Escribe al menos tres caracteres para buscar dentro de una palabra.

Tanto en el diseño para PC como en el móvil, si una búsqueda de pistas, las pistas directas del nivel actual en **Vista de árbol** o los detalles de un álbum, artista, género, subcarpeta o lista de reproducción devuelven 300 pistas o menos, todas se seleccionan de forma predeterminada. Con 301 pistas o más no hay selección automática. Usa las casillas de las filas, **Seleccionar todo** o **Deseleccionar todo** para cambiar la selección.

En móvil se muestra primero la lista normal de títulos, sin columnas de artista ni duración. Solo mantener pulsada una pista abre el modo de selección; entonces aparecen las casillas, **Seleccionar todo** y **Deseleccionar todo**, mientras las acciones habituales de las filas siguen disponibles. La selección automática y los cambios posteriores —incluidos **Seleccionar todo**, **Deseleccionar todo** y las casillas individuales— solo cambian el estado de selección; no abren ni cierran el modo de selección.

Si faltan metadatos o no se pueden leer, EffeTune usa el nombre del archivo y la información de la carpeta como alternativa. En **Propiedades de la pista** puedes consultar la ruta del archivo, el formato, la tasa de muestreo, la profundidad de bits, la tasa de bits y los principales campos de metadatos. En una pista CUE también se muestran su tipo, la ruta del archivo CUE, la ruta del audio de origen y el intervalo que ocupa dentro de ese archivo.

## Archivos de álbum con CUE

Coloca el archivo `.cue` externo junto a los archivos WAV o FLAC que menciona y añade o vuelve a analizar esa carpeta. Cada entrada `TRACK ... AUDIO` válida aparecerá como una pista independiente en la Biblioteca musical. Cuando están disponibles, se usan el título, el intérprete, la fecha, el género y la numeración del CUE; los datos técnicos proceden del WAV o FLAC de origen.

Para las pistas añadidas a la Biblioteca musical, EffeTune usa primero la carátula incrustada en el audio de origen. Si no hay ninguna, busca junto al archivo CUE, por este orden, `cover.jpg`, `cover.png`, `front.jpg`, `front.png` y después un JPEG o PNG con el nombre del archivo de audio, con o sin su extensión de audio. La reproducción directa en la aplicación de escritorio usa automáticamente esos mismos archivos de imagen contiguos; esta vía de reproducción no extrae la carátula incrustada del audio de origen. La reproducción directa en el navegador usa la imagen correspondiente a la que se pueda acceder desde los archivos seleccionados o la carpeta registrada.

También puedes reproducir directamente un álbum CUE con **Open music files** o, en dispositivos móviles, **Open Music**. En la aplicación de escritorio también puedes usar **File > Open music file...**; selecciona solo el archivo `.cue`. En un navegador Chromium para PC, añade primero la carpeta del álbum a la Biblioteca musical y permite el acceso. Después podrás seleccionar solo el archivo `.cue`, y EffeTune abrirá los WAV o FLAC referenciados y la carátula correspondiente desde esa carpeta registrada, sin añadir la selección al catálogo. Los navegadores sin File System Access todavía deben recibir el archivo `.cue` junto con todos y únicamente los WAV o FLAC que menciona, además de la carátula correspondiente si quieres usarla. Una selección válida sustituye la cola actual. Si la validación falla, la cola no cambia.

Si la hoja CUE no es válida o no permite identificar con seguridad sus archivos de origen, EffeTune explica el problema e importa los WAV o FLAC como pistas normales de archivo completo. Corrige la hoja CUE o los nombres de archivo y vuelve a analizar la carpeta para intentarlo de nuevo.

## Reproducir desde la biblioteca

Selecciona una pista, álbum, artista, género, subcarpeta, carpeta, resultado de búsqueda o lista de reproducción y usa estas acciones.

- **Reproducir** - Sustituye la cola actual del reproductor e inicia la reproducción.
- **Aleatorio** - Reproduce el grupo seleccionado en orden aleatorio.
- **Reproducir a continuación** - Inserta las pistas seleccionadas justo después de la pista actual.
- **Añadir a la cola** - Añade las pistas seleccionadas al final de la cola.
- **Añadir a lista** - Guarda las pistas seleccionadas en una lista de reproducción de la Biblioteca musical.

En PC, puedes hacer doble clic en la fila de una pista para reproducir desde ese punto, o abrir sus acciones con el clic derecho o el menú **Más**. En móvil, toca una pista de la lista normal para reproducirla; mantenerla pulsada entra en el modo de selección descrito arriba.

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
- Abrir una lista de reproducción concreta y exportarla con **Exportar M3U8** o **Exportar XSPF**.

### Reproducidas recientemente y Favoritos

EffeTune muestra dos listas especiales junto a las listas normales, en la misma cuadrícula de tarjetas. Solo se crean cuando hacen falta: **Reproducidas recientemente** al iniciar la reproducción de una pista indexada y **Favoritos** al marcar una pista con la estrella por primera vez.

- **Reproducidas recientemente** conserva las 100 últimas pistas distintas, con la más reciente al principio. Si vuelves a reproducir una pista, esta regresa al primer puesto.
- **Favoritos** contiene las pistas que marcas con ☆. En PC, usa la estrella situada junto a la pista; en el móvil, abre el menú **Más** de la pista. También puedes abrir ese menú haciendo clic derecho en una pista en PC.

Sus nombres son fijos y se muestran en el idioma actual de la interfaz, por lo que no se pueden cambiar. Sí puedes duplicar, exportar o eliminar estas listas como cualquier otra. Si eliminas una, se vuelve a crear vacía la próxima vez que la reproducción o una acción de favoritos la necesite. Sus tarjetas muestran un reloj o una estrella en el área de la carátula; el botón de reproducción de la esquina inferior derecha de **Favoritos** inicia la lista al instante. Las listas especiales no se incluyen en los resultados de búsqueda de listas normales.

Al escanear una carpeta, EffeTune importa automáticamente los archivos de listas de reproducción compatibles una vez indexizadas sus pistas y omite los archivos cuyo contenido no ha cambiado. Si cambia el contenido de un archivo ubicado en la misma carpeta y ruta relativa, EffeTune sustituye de forma atómica los elementos de la lista importada automáticamente; esto también sustituye las modificaciones de elementos realizadas en EffeTune. Una importación fallida o cancelada se reintenta en el siguiente escaneo. Eliminar o cambiar el nombre del archivo de origen no elimina la lista existente, y un archivo renombrado se importa como una lista nueva.

Al importar, se muestra una vista previa del número de elementos que coinciden con pistas de la biblioteca actual. Los elementos que no coincidan también se conservan, siempre que sea posible, como elementos sin resolver para que puedan resolverse más adelante al añadir o reconectar la carpeta correspondiente.

Al exportar, si eliges **Rutas relativas**, las rutas se escriben, cuando es posible, en relación con la ubicación de exportación. Esto resulta útil si quieres mover la lista de reproducción junto con la carpeta de música. M3U8 y XSPF no pueden conservar el intervalo de una pista CUE dentro del archivo del álbum, por lo que EffeTune omite esas pistas e indica cuántas se excluyeron. Nunca escribe en su lugar la ruta física del archivo del álbum.

## Seguridad y almacenamiento

- La Biblioteca musical lee archivos de audio y metadatos, pero no escribe cambios en los archivos de audio.
- La caché de carátulas y las listas de reproducción son datos de la aplicación, no cambios incrustados en los archivos de música.
- La clasificación por **Subcarpetas** se obtiene de las rutas relativas guardadas en el catálogo.
- El almacenamiento del navegador puede borrarse desde la configuración del navegador o por acciones del usuario. Exporta las listas de reproducción importantes si lo necesitas.
- En navegadores con File System Access, los permisos determinan si se puede reutilizar el identificador persistente de la carpeta tras recargar. En los navegadores alternativos, los archivos seleccionados son solo de sesión y siempre deben elegirse de nuevo después de recargar.

## Bibliotecas grandes

El catálogo conserva los datos en el disco y divide el trabajo en páginas o lotes limitados, por lo que no necesita cargar una colección grande completa en la memoria. Las mediciones de escala y de referencia fija son diagnósticos locales y opcionales para el desarrollo. No condicionan commits, versiones, `verify` ni GitHub Actions y no constituyen una garantía general de rendimiento. El tiempo de análisis y los límites prácticos dependen de la velocidad del almacenamiento, la memoria disponible, los metadatos, las carátulas y las restricciones del navegador o del sistema operativo.

Mientras desplazas la lista de pistas, EffeTune mantiene en caché las páginas cercanas. En la disposición móvil, lee por adelantado hasta dos páginas en la dirección actual, da prioridad a la página necesaria en pantalla frente a lecturas anticipadas adicionales y reutiliza las filas visibles que se solapan. Aunque el desplazamiento continúe, las lecturas completadas para la vista se publican de inmediato en esta caché limitada. Las solicitudes de posición se agrupan en la más reciente y, si esta queda dentro de la página que acaba de cargarse, no se realiza otra lectura de la base de datos. Las lecturas anticipadas pendientes que dejan de ser necesarias se descartan. SQLite admite interrupciones, pero los adaptadores del catálogo ejecutan actualmente cada sentencia de forma síncrona y no ofrecen una vía para interrumpirla desde otro worker. Por eso, un salto excepcionalmente rápido todavía puede mostrar un breve espacio vacío hasta que termine la lectura en curso, sobre todo si el almacenamiento es lento.

[← Volver al README](README.md)
