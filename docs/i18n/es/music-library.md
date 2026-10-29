---
title: "Cómo usar la Biblioteca musical - Buscar y reproducir archivos de música locales - EffeTune"
description: "Explica cómo crear una Biblioteca musical en EffeTune, buscar y reproducir música por subcarpetas o metadatos, y gestionar listas de reproducción."
lang: es
---

# Cómo usar la Biblioteca musical

La Biblioteca musical indexa las carpetas de música seleccionadas para que puedas explorar tu colección local por pistas, archivos, álbumes, artistas, géneros, subcarpetas, carpetas, elementos añadidos recientemente o listas de reproducción. La reproducción pasa por el pipeline de efectos actual de EffeTune, igual que durante la reproducción normal de archivos de música.

La Biblioteca musical guarda dentro de la aplicación su catálogo, la caché de carátulas y las listas de reproducción. No edita, cambia de nombre, mueve ni elimina tus archivos de audio.

## Disponibilidad {#availability}

- **Aplicación de escritorio:** Usa el escáner completo de carpetas y mantiene disponibles las carpetas seleccionadas entre inicios. Las versiones de escritorio también pueden mostrar una pista en su carpeta.
- **Navegadores Chromium en PC con File System Access:** Pueden conservar el acceso a las carpetas seleccionadas después de recargar, aunque el navegador puede volver a pedir permiso.
- **Navegadores móviles, Safari, Firefox y otros sin File System Access:** Conservan el acceso a los archivos seleccionados solo durante la sesión actual de la página. El catálogo permanece guardado, pero vuelve a seleccionar la carpeta o los archivos después de cada recarga para reconectarlos.

La Biblioteca musical indexa extensiones de audio habituales como MP3, WAV, OGG, FLAC, Opus, M4A y AAC. También puede usar una hoja CUE externa para dividir en pistas individuales un álbum WAV o FLAC situado en la misma carpeta.

Para incluir archivos MP4, WebM, M4V, MOV, MKV y 3GP, activa **Incluir formatos de vídeo en la Biblioteca musical** en **Configuración > Configuración... > General** y después añade o vuelve a escanear una carpeta. Esta opción está desactivada de forma predeterminada; cambiarla no modifica de inmediato el catálogo existente. La reproducción efectiva, incluido el códec de audio dentro de un archivo de vídeo, depende del decodificador del navegador o del sistema operativo. Para ver cómo se muestra el vídeo, consulta la [guía del Reproductor de música](music-player.md#video).

## Abrir la Biblioteca musical

- **Diseño de PC:** Haz clic en el botón **Biblioteca musical** del encabezado.
- **Diseño móvil:** Abre la pestaña **Biblioteca** en la navegación inferior.
- **Aplicación de escritorio:** También puedes usar **Ver > Biblioteca musical** o **Ctrl+L** (**Command+L** en macOS).

Para volver a editar efectos, haz clic en el botón **Effect Pipeline** en el diseño de PC, vuelve a la pestaña **Efectos** en el diseño móvil o usa **Ver > Effect Pipeline** o **Ctrl+E** (**Command+E** en macOS) en la aplicación de escritorio.

Si quieres que la Biblioteca musical sea la primera vista al iniciar, abre **Configuración > Configuración...** y establece **Vista al inicio:** en **Biblioteca musical**. En la lista situada junto a **Biblioteca musical**, elige qué sección aparecerá primero: **Pistas**, **Archivos**, **Álbumes**, **Artistas**, **Géneros**, **Subcarpetas**, **Carpetas** o **Listas de reproducción**.

## Añadir carpetas de música

1. Abre la Biblioteca musical.
2. Selecciona **Añadir carpeta de música**.
3. Elige la carpeta que contiene tu música. En navegadores móviles o con el método alternativo, el selector puede pedirte que elijas los archivos de la carpeta en vez de conceder acceso persistente a la carpeta.
4. Espera a que termine el escaneo. La línea de estado muestra el número de pistas y álbumes, así como el progreso mientras se indexa.

Si intentas añadir una carpeta que ya está dentro de una carpeta existente de la biblioteca, EffeTune te avisa en lugar de indexar contenido duplicado. Si añades una carpeta superior que contiene carpetas ya indexadas, EffeTune puede combinarlas en la nueva carpeta.

## Explorar y buscar

Usa las pestañas de navegación para recorrer tu colección:

- **Pistas:** Todas las pistas indexadas (una tabla ordenable en PC; una lista compacta en móvil).
- **Archivos:** Pistas ordenadas por ruta de archivo para elegir un archivo directamente. Las pistas definidas por una hoja CUE aparecen como entradas individuales.
- **Álbumes:** Álbumes agrupados a partir de los metadatos de las pistas.
- **Artistas:** Artistas y artistas del álbum obtenidos de los metadatos (los valores separados por punto y coma, como `Artist A; Artist B`, se indexan bajo cada artista manteniendo visible el crédito completo).
- **Géneros:** Grupos de género obtenidos de los metadatos.
- **Subcarpetas:** Pistas agrupadas por la subcarpeta superior directa dentro de cada carpeta raíz indexada (por ejemplo, `Artist/Album`).
- **Carpetas:** Carpetas raíz registradas, su estado de escaneo y su jerarquía de carpetas.
- **Añadidas recientemente:** Pistas indexadas recientemente.
- **Listas de reproducción:** Listas de reproducción creadas o importadas dentro de la Biblioteca musical.

En **Carpetas**, abre una raíz registrada para recorrer sus carpetas en **Vista de árbol** o cambia a **Vista plana** para listar de una vez todas las pistas de esa raíz. En **Vista de árbol**, las carpetas con una sola subcarpeta y sin pistas directas se combinan en una sola fila (como `Artist / Album`) para ir directamente a la carpeta del álbum, mientras que la ruta de navegación permite abrir cualquier carpeta intermedia.

Usa **Buscar en la biblioteca** para filtrar pistas, álbumes, artistas y listas de reproducción. Los términos de tres o más caracteres coinciden en cualquier parte del título, artista, álbum, género, nombre de archivo o ruta; los de uno o dos caracteres coinciden con el inicio de una palabra. En PC, haz clic en los encabezados de la tabla de pistas (**N.º de pista**, **Título**, **Artista**, **Álbum**, **Género** o **Duración**) o usa la lista **Ordenar** en las demás vistas. En móvil, usa la lista **Ordenar** para cambiar el orden en cualquier vista fuera de las listas de reproducción guardadas.

Cuando un resultado de búsqueda, nivel de carpeta, álbum, artista, género, subcarpeta o lista de reproducción contiene 300 pistas o menos, todas quedan seleccionadas de forma predeterminada para empezar a reproducir de inmediato. Los resultados con 301 pistas o más no se seleccionan automáticamente; usa las casillas de las filas, **Seleccionar todo** o **Deseleccionar todo** para cambiar la selección. En móvil, mantén pulsada cualquier fila de pista para mostrar las casillas y los controles de selección.

Si faltan etiquetas, EffeTune recurre al nombre del archivo y de la carpeta. En **Propiedades de la pista** se muestran la ruta del archivo, el formato, la tasa de muestreo, la profundidad de bits, la tasa de bits, los metadatos y, en las pistas CUE, la ruta de la hoja CUE y el intervalo de la pista.

## Archivos de álbum con CUE

Coloca una hoja `.cue` externa en la misma carpeta que los archivos WAV o FLAC a los que hace referencia y añade o vuelve a escanear la carpeta. Cada entrada `TRACK ... AUDIO` válida aparece como una pista independiente en la Biblioteca musical.

Para la carátula, la Biblioteca musical comprueba primero la imagen incrustada en el audio de origen y, si no existe, busca junto al archivo `.cue` los archivos `cover.jpg`, `cover.png`, `front.jpg`, `front.png` o una imagen que coincida con el nombre del archivo de audio.

También puedes abrir una hoja `.cue` directamente desde el reproductor (**Abrir archivos de música**, **Archivo > Abrir archivo de música...** en escritorio o **Abrir música** en móvil):
- **Aplicación de escritorio:** Selecciona únicamente el archivo `.cue`.
- **Navegador Chromium en PC:** Si la carpeta del álbum ya está registrada en la Biblioteca musical con permiso concedido, selecciona únicamente el archivo `.cue`.
- **Otros navegadores:** Selecciona el archivo `.cue` junto con todos los archivos WAV/FLAC a los que hace referencia, y solo esos, además de una imagen de portada coincidente si quieres usarla.

Si una hoja CUE no es válida o no se pueden asociar sus archivos de audio, EffeTune lo notifica e importa los archivos WAV o FLAC como pistas individuales de archivo completo. Corrige la hoja CUE o los nombres de archivo y vuelve a escanear la carpeta para intentarlo de nuevo.

## Reproducir desde la biblioteca

Selecciona una pista, álbum, artista, género, subcarpeta, carpeta, resultado de búsqueda o lista de reproducción y elige:

- **Reproducir:** Sustituye la cola actual del reproductor e inicia la reproducción.
- **Aleatorio:** Reproduce la selección en orden aleatorio.
- **Reproducir a continuación:** Inserta la selección después de la pista actual.
- **Añadir a la cola:** Añade la selección al final de la cola.
- **Añadir a lista:** Añade la selección a una lista de reproducción de la Biblioteca musical.

En PC, haz doble clic en la fila de una pista para reproducir desde esa pista, o haz clic derecho / abre **Más** para ver las acciones de la pista. En móvil, toca una pista para reproducirla o mantenla pulsada para seleccionar varias pistas.

## Actualizar y reconectar carpetas

Usa **Volver a escanear** después de añadir, eliminar, cambiar de nombre o volver a etiquetar archivos en tus carpetas de música. Al volver a escanear se actualizan las pistas modificadas, se eliminan del catálogo los archivos borrados y se vuelven a enlazar las entradas de listas de reproducción cuando se encuentran archivos coincidentes.

Estado de las carpetas en **Carpetas**:
- **OK:** Lista para explorar y reproducir.
- **Sin escanear:** Añadida, pero aún no indexada.
- **No encontrado:** Ya no se encuentra la ruta de la carpeta.
- **Reconectar:** Se necesita de nuevo permiso del navegador o de la carpeta; haz clic en **Reconectar** y concede acceso a la misma carpeta.

Si no se puede abrir una pista de la biblioteca porque su carpeta no está disponible, vuelve a conectar o a importar la carpeta.

Elegir **Quitar** solo retira la carpeta del catálogo de EffeTune; tus archivos en el disco nunca se borran.

## Listas de reproducción

Las listas de reproducción de la Biblioteca musical se guardan dentro de EffeTune y pueden incluir pistas de cualquier carpeta indexada:

- Crea una lista de reproducción a partir de las pistas seleccionadas en la biblioteca o guarda la cola actual del reproductor como lista de reproducción.
- Usa **Cambiar nombre**, **Duplicar** y **Eliminar** para gestionar las listas de reproducción, y arrastra las pistas (o usa **Subir** / **Bajar**) para reordenarlas.
- Usa **Importar lista** para archivos M3U, M3U8, PLS y XSPF, y **Exportar M3U8** o **Exportar XSPF** dentro de una lista para exportarla.

### Reproducidas recientemente y Favoritos

Dos listas de reproducción automáticas aparecen en la cuadrícula de listas de reproducción una vez utilizadas:

- **Reproducidas recientemente:** Conserva las últimas 100 pistas distintas reproducidas desde la Biblioteca musical, ordenadas de la más reciente a la más antigua.
- **Favoritos:** Reúne las pistas marcadas con la **☆** situada junto a cada pista en PC o con **Añadir a Favoritos** en el menú **Más** de la pista (en PC también se abre con clic derecho). Haz clic en el botón de reproducción de la tarjeta **Favoritos** para iniciarla al instante.

Sus nombres siguen el idioma actual de la interfaz y no se pueden cambiar, aunque puedes duplicarlas, exportarlas o eliminarlas como cualquier otra lista de reproducción.

### Importar y exportar listas de reproducción

Los escaneos de carpetas importan automáticamente los archivos de listas de reproducción compatibles que se encuentran dentro de tus carpetas de música y los actualizan al volver a escanear cuando el archivo cambia en el disco; esta actualización sustituye los cambios que hayas hecho en esa lista dentro de EffeTune. Las entradas sin coincidencia se conservan como elementos no resueltos para enlazarse automáticamente cuando se añada o reconecte la carpeta correspondiente.

Al exportar una lista de reproducción, activa **Rutas relativas** si quieres mover el archivo M3U8 o XSPF exportado junto con tu carpeta de música. Dado que los archivos M3U8 y XSPF estándar no guardan intervalos de subpistas CUE, las pistas CUE se omiten durante la exportación y EffeTune informa de cuántas se han omitido.

## Seguridad y almacenamiento

- La Biblioteca musical lee archivos de audio y metadatos sin modificar tus archivos en el disco.
- Borrar los datos del sitio en el navegador elimina el catálogo y las listas de reproducción de la aplicación web; exporta las listas importantes para conservarlas.
- Las colecciones grandes se cargan progresivamente a medida que te desplazas. Usa la Biblioteca musical en una sola ventana de EffeTune a la vez.

## Música en tu red (aplicación de escritorio)

Usa **Library** para explorar este dispositivo o un servidor detectado, y el selector de dispositivos de la parte superior de la ventana para elegir dónde sonará la música. Cambiar de biblioteca solo cambia la exploración y la búsqueda. Añadir carpetas, volver a escanear y otras tareas locales están disponibles con **This device** seleccionado.

Al explorar la biblioteca de otro EffeTune, puedes usar **Tracks**, **Albums**, **Artists**, **Genres**, **Subfolders**, **Files**, **Folders**, **Recently Added** y **Playlists** igual que en tu dispositivo. Busca en la biblioteca seleccionada, ordena sus listas y abre un álbum, artista o género para ver sus pistas. En **Folders**, usa **Tree** para recorrer la estructura de carpetas o **Flat** para listar todas las pistas de la carpeta seleccionada. Solo aparece la música compartida. Puedes explorar y reproducir las listas remotas; para editarlas, usa el ordenador de origen.

Los demás servidores de música muestran las categorías y la estructura de carpetas que publican; la búsqueda y la ordenación solo están disponibles si el servidor las admite.

<a id="subsonic"></a>

### Servidores Subsonic / OpenSubsonic

En el escritorio, abre **Configuración > Configuración... > Red > Subsonic / OpenSubsonic**. Introduce **Nombre**, **URL del servidor**, **Usuario** y **Contraseña**, y pulsa **Añadir**. Selecciona el servidor en **Library** para explorar álbumes, pistas y listas del servidor, buscar y reproducir o añadir música a la cola del destino elegido. Se conservan el orden y las pistas repetidas; edita las listas en el servidor. **Probar conexión** comprueba la conexión guardada y **Quitar** la desconecta.

En la PWA, elige **Library > Añadir servidor de música…** para conectar directamente por HTTPS. El servidor debe permitir el acceso del navegador (CORS); la conexión y el inicio de sesión solo se mantienen durante la sesión actual. Para reproducir en otro dispositivo, o si el navegador no puede conectar directamente, añade el servidor en un ordenador EffeTune registrado y permite allí explorar otros servidores. Elige la biblioteca ofrecida por ese ordenador; consulta la [configuración de la PWA](openhome.md#pwa).

Se prefiere el audio original. Si el destino lo necesita, puede usarse una conversión ofrecida por el servidor, cuyo formato y calidad pueden diferir del archivo guardado. EffeTune no añade códecs ni convierte el audio. Los formatos y el desplazamiento dependen del servidor y el reproductor.

Para reproducir pistas de Music Library en otro reproductor, primero comparte su carpeta en **Configuración > Configuración... > Red > Compartir biblioteca**. Los formatos y efectos disponibles dependen del destino; las pistas parciales CUE no están disponibles como pistas de red independientes. Consulta [música en red y control remoto](openhome.md) para configurar la conexión, emparejar los efectos y resolver problemas de acceso.

Para reproducir archivos locales sueltos sin activar el uso compartido de la biblioteca, elige otro reproductor y usa **Open music files**. EffeTune facilita únicamente los archivos seleccionados a ese reproductor; mantén abierta la aplicación en el equipo de origen.

## Música compartida en la PWA

La PWA puede reproducir música compartida de un ordenador EffeTune registrado y bibliotecas de red autorizadas con los efectos de este dispositivo, o controlar un reproductor de red autorizado. También puedes conectar directamente a Subsonic. Los archivos locales de la PWA no se pueden enviar a otro reproductor. Consulta [configuración y reproducción desde la PWA](openhome.md#pwa) para añadir dispositivos y conocer los permisos del navegador y los requisitos de conexión.

[← Volver al README](README.md)
