# Frieve EffeTune <img src="../../../images/icon_64x64.png" alt="EffeTune Icon" width="30" height="30" align="bottom">

<div class="doc-primary-actions" aria-label="Acciones principales">
  <a class="button button-primary" href="https://effetune.frieve.com/effetune.html">Abrir aplicación web</a>
  <install class="button button-secondary"><a href="https://effetune.frieve.com/effetune.html">Instalar versión PWA</a></install>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune/releases/">Descargar aplicación de escritorio</a>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune-mixwright/releases">Descargar versión VST</a>
  <a class="button button-secondary" href="https://chromewebstore.google.com/detail/effetune/fhjhnpepnhkcdggogicifibfegpbhibp">Instalar extensión para Chrome</a>
  <a class="button button-secondary" href="https://microsoftedge.microsoft.com/addons/detail/effetune/kjpcfdidpphaclfkfdahchhibgjcngdk">Instalar extensión para Edge</a>
  <a class="button button-secondary" href="/dsp/">DSP Library</a>
</div>

Un procesador de efectos de audio en tiempo real, diseñado para entusiastas del audio que desean mejorar su experiencia musical. EffeTune te permite procesar cualquier fuente de audio a través de diversos efectos de alta calidad, lo que te posibilita personalizar y perfeccionar tu experiencia auditiva en tiempo real.

[![Screenshot](../../../images/screenshot.png)](https://effetune.frieve.com/effetune.html)

## Video de introducción

[![YouTube Video](../../../images/video_thumbnail.jpg)](https://www.youtube.com/watch?v=Qb5Airg0kI8)

## Concepto

EffeTune ha sido creado para los entusiastas del audio que quieren elevar su experiencia musical. Ya sea que escuches música en streaming o desde un medio físico, EffeTune te permite añadir efectos de alta calidad para ajustar el sonido a tu gusto. Transforma tu computadora en un potente procesador de efectos de audio que se sitúa entre tu fuente de audio y tus altavoces o amplificador.

Sin mitos audiophiles, solo pura ciencia.

## Características

- Procesamiento de audio en tiempo real
- Interfaz de arrastrar y soltar para construir cadenas de efectos
- Sistema de efectos ampliable con efectos categorizados
- Visualización de audio en vivo
- Diseños de Visualizer personalizables con gráficos animados, carátulas y datos de pistas
- Cadena de procesamiento de audio que se puede modificar en tiempo real
- Procesamiento de archivos de audio sin conexión con la cadena de efectos actual
- Exploración de subcarpetas locales, metadatos y listas de reproducción con la Biblioteca musical
- Reproductor mini compacto y siempre visible para la aplicación de escritorio
- Medición y corrección de respuesta en frecuencia para calibración del sistema
- Procesamiento y salida multicanal
- Diseño web adaptado para teléfonos y tabletas

## Guía de Configuración

### Aplicación para Android

Utiliza Android 10 o posterior y mantén Android System WebView actualizado. Abre archivos de música o elige una carpeta en la biblioteca musical; Android te permite seleccionar los archivos y carpetas a los que EffeTune puede acceder. Si una carpeta deja de estar disponible, selecciónala de nuevo en la biblioteca. La reproducción continúa con la pantalla apagada y puedes controlar el mismo reproductor desde las notificaciones y la pantalla de bloqueo.

Guarda o comparte los archivos exportados mediante las pantallas de archivos y de compartir de Android. Para exportar audio por lotes, elige una carpeta de destino y mantén la aplicación abierta. La aplicación Android y la web guardan sus datos por separado. Copia de seguridad / Restauración permite intercambiar presets, respuestas al impulso, mediciones y datos del visualizador (hasta 256 MB); no incluye archivos de música, el catálogo musical, credenciales de conexión ni ajustes. Los efectos procesan el audio reproducido o recibido por EffeTune, sin sustituir el sonido de otras aplicaciones Android.

Las asignaciones MIDI de parámetros y los cambios programados siguen funcionando con la pantalla apagada. Para usar el teclado o un mando, mantén la aplicación abierta. Android admite entrada MIDI, pero no envía información de retorno a los faders motorizados ni a los LED. Toca el icono **Remote Control** de la barra de herramientas para permitir el control remoto y copiar un enlace de emparejamiento. No compartas públicamente ese enlace.

Elige el método de configuración que corresponda a la fuente de audio que quieras escuchar.

### Configuración del Reproductor de Archivos de Música

- Abre la aplicación web EffeTune en tu navegador, o inicia la aplicación de escritorio EffeTune
- Abre y reproduce un archivo de música para asegurar una reproducción adecuada
   - Haz clic en el botón **Abrir archivos de música** y selecciona un archivo de música
   - O abre un archivo de música y selecciona EffeTune como la aplicación (solo aplicación de escritorio)
   - O selecciona **Abrir archivo de música...** desde el menú **Archivo** (solo aplicación de escritorio)
   - O arrastra el archivo de música a la ventana
- Para usar solo el reproductor, selecciona Ninguno (solo reproductor de archivos de música) como dispositivo de entrada en Configuración de audio y evita usar una entrada de audio en vivo. Este es el ajuste predeterminado de la aplicación de escritorio; si ya has guardado un dispositivo de entrada, se mantiene tu selección.

[Reproductor de música](music-player.md)

### Navegador integrado de la aplicación de escritorio

En la aplicación de escritorio, **Navegador** reproduce el audio de los sitios web con los efectos actuales, sin necesidad de un dispositivo de audio virtual.

1. Haz clic en **Navegador** en la cabecera. Se inicia el procesamiento del audio del navegador.
2. Introduce una dirección HTTP o HTTPS, inicia sesión y reproduce música con los controles del sitio. Si omites el protocolo, se utiliza HTTPS.
3. Cambia a **Effect Pipeline** para ajustar el sonido. Cambiar de vista mantiene la reproducción del navegador.

Usa Atrás, Adelante, Recargar y Detener carga para navegar. Abre **Marcadores** para añadir la página actual, abrir una página guardada, cambiar el nombre de un marcador o eliminarlo. El menú del navegador incluye **Mostrar página de inicio**, **Abrir en el navegador predeterminado**, **Usar como página de inicio** y **Borrar datos de sitios**. Los marcadores y la página de inicio elegida se guardan. Las sesiones de los sitios se conservan por separado y siguen disponibles al reiniciar la aplicación. Las páginas del navegador siguen el nivel de zoom de la aplicación.

Con el foco en la barra del navegador, usa **F5** para recargar, **F6** para seleccionar la dirección, **Alt+Izquierda/Derecha** para retroceder o avanzar y **Alt+Home** para abrir la página de inicio. También funcionan dentro de la página. Con el foco en la página, **Ctrl/Cmd+L** selecciona la dirección, **Ctrl/Cmd+R** recarga y **Ctrl/Cmd+D** abre Marcadores. En macOS, **Cmd+[/]** también permite retroceder o avanzar. **Escape** detiene la carga. Haz clic derecho en la página para navegar, en un enlace para abrirlo aquí o en el navegador predeterminado o copiar su dirección, y en texto seleccionado o un campo de texto para ver las opciones de edición disponibles. Fuera de la página, los atajos de la aplicación conservan sus funciones habituales.

Al abrir **Navegador** o volver a él, se selecciona automáticamente el audio del navegador. El audio del navegador se mezcla con el dispositivo de entrada seleccionado. Elige **Ninguno** como dispositivo de entrada para escuchar solo el audio del navegador. La opción de entrada del reproductor no afecta a la reproducción del navegador. La música local puede reproducirse junto con el audio del navegador. Si la captura se detiene, pulsa **Navegador** otra vez para reintentar. **Borrar datos de sitios** cierra la sesión en los sitios y borra sus datos guardados, conservando los marcadores.

Usa **Cerrar** en la barra de herramientas del navegador para detener el procesamiento de su audio y volver a **Effect Pipeline**. Se conservan la página y el historial de navegación. Abre **Navegador** de nuevo para reanudar el procesamiento de audio en la misma página.

En **Configuración > Configuración... > Navegador**:

- **Página de inicio** establece la dirección HTTP o HTTPS que se abre al abrir el navegador por primera vez. El campo está vacío de forma predeterminada; cuando está vacío, se abre la [guía de streaming de EffeTune](https://effetune.frieve.com/streaming/). **Restablecer** vacía el campo sin cambiar la página actual.
- **Abrir nuevas pestañas en el navegador predeterminado** está activado de forma predeterminada. Desactívalo para abrir esos enlaces en el navegador de EffeTune. Las ventanas independientes, como las de inicio de sesión, permanecen dentro de EffeTune en ambos casos.
- **User-Agent** es la identificación del navegador que se envía a los sitios web. El valor predeterminado identifica el navegador como compatible con Chrome e incluye el nombre EffeTune. Deja el campo vacío o pulsa **Restablecer** para recuperar el valor predeterminado. Después de cambiarlo, recarga la página en el navegador.

Para cambiar los efectos automáticamente según el sitio, guarda primero tus cadenas como preajustes. En **Reglas de URL**, pulsa **Añadir regla**, introduce un sitio y una ruta como `example.com/music/*` y selecciona un preajuste de cadena. Omite `http://` o `https://`, las cadenas de consulta y los fragmentos `#`; `*` coincide con cualquier texto. Ajusta la prioridad con los botones de subir y bajar y pulsa **Guardar reglas**. Se usa la primera regla activada que coincida y tenga un preajuste disponible.

Las reglas funcionan mientras esté seleccionado el audio del navegador, aunque cambies de vista. Al guardar las reglas, abrir el navegador o navegar a una página coincidente, se puede cargar su preajuste. La navegación entre páginas que usan el mismo preajuste conserva tus ajustes manuales. Si ninguna regla coincide, la cadena actual se mantiene.

Algunos sitios no permiten navegadores integrados, el inicio de sesión, la reproducción protegida o la captura de audio. La disponibilidad depende del sitio y del sistema operativo; no se garantiza la reproducción con DRM. Si se rechaza el inicio de sesión, prueba otro método que ofrezca el sitio o usa tu navegador habitual. Iniciar sesión allí no inicia la sesión dentro de EffeTune. navegador solo está disponible en la aplicación de escritorio.

### Configuración de la extensión de navegador

Procesa hasta cuatro pestañas de Chrome o Edge con cadenas independientes, preajustes según la URL y frecuencia de muestreo ajustable, sin un dispositivo de audio virtual. Consulta la [guía de la extensión de navegador](browser-extension.md).

1. Instala la extensión EffeTune desde la tienda de [Chrome](https://chromewebstore.google.com/detail/effetune/fhjhnpepnhkcdggogicifibfegpbhibp) o [Edge](https://microsoftedge.microsoft.com/addons/detail/effetune/kjpcfdidpphaclfkfdahchhibgjcngdk).
2. Reproduce audio en la pestaña que quieras procesar, abre EffeTune desde la barra de herramientas del navegador y selecciona **Start on this tab**.
3. Selecciona **Edit pipeline** para añadir efectos y ajustar el sonido.

### Configuración para Servicios de Streaming

Para procesar audio de servicios de streaming (Spotify, YouTube Music, etc.):

En la aplicación de escritorio, prueba primero el [navegador integrado](#navegador-integrado-de-la-aplicación-de-escritorio). Si usas una aplicación de streaming independiente o una fuente que el navegador integrado no puede reproducir, sigue la configuración de audio que se indica a continuación.

1. Requisitos:
   - Instala un dispositivo de audio virtual (por ejemplo, VB Cable, Voice Meeter o ASIO Link Tool)
   - Configura tu servicio de streaming para enviar el audio al dispositivo de audio virtual

2. Configuración:
   - Abre la aplicación web EffeTune en tu navegador, o inicia la aplicación de escritorio EffeTune
   - Selecciona el dispositivo de audio virtual como fuente de entrada
     - En Chrome, la primera vez que lo abras, aparecerá un cuadro de diálogo pidiéndote que selecciones y permitas la entrada de audio
     - Abre Configuración de audio desde el menú Configuración para elegir los dispositivos de entrada y salida y el formato de audio
   - Comienza a reproducir música desde tu servicio de streaming
   - Verifica que el audio esté fluyendo a través de EffeTune
   - Para instrucciones de configuración más detalladas, consulta la [FAQ](faq.md)

### Configuración para Fuentes de Audio Físicas

Para usar EffeTune con reproductores de CD, reproductores de red u otras fuentes físicas:

- Conecta tu interfaz de audio a tu computadora
- Abre la aplicación web EffeTune en tu navegador, o inicia la aplicación de escritorio EffeTune
- Selecciona tu interfaz de audio como fuente de entrada y salida
   - En Chrome, la primera vez que lo abras, aparecerá un cuadro de diálogo pidiéndote que selecciones y permitas la entrada de audio
   - Abre Configuración de audio desde el menú Configuración para elegir los dispositivos de entrada y salida y el formato de audio
- Tu interfaz de audio ahora funciona como un procesador de múltiples efectos:
   * Entrada: Tu reproductor de CD, reproductor de red u otra fuente de audio
   * Procesamiento: Efectos en tiempo real a través de EffeTune
   * Salida: Audio procesado hacia tu amplificador o altavoces

## Uso

La aplicación de escritorio se abre con la ventana maximizada la primera vez. En los siguientes inicios, restaura el tamaño, la posición y el estado de maximización anteriores de la ventana.

Al abrir la aplicación por primera vez, un breve recorrido te muestra dónde reproducir música, añadir efectos y ajustar el sonido. Puedes repetirlo en cualquier momento con **Recorrer la aplicación** en el menú de configuración, en el menú **Ayuda** de la aplicación de escritorio o con el botón de menú en el móvil.

### Creando tu Cadena de Efectos

1. Los **Available Effects** se encuentran listados en el lado izquierdo de la pantalla  
   - Utiliza el botón de búsqueda al lado de **Available Effects** para filtrar los efectos  
   - Escribe cualquier texto para encontrar efectos por nombre o categoría  
   - Presiona ESC para limpiar la búsqueda
2. Arrastra los efectos desde la lista hasta el área de **Effect Pipeline**
   - En móvil, abre la pestaña **Efectos** y toca el botón **+** para añadir efectos desde la lista a pantalla completa
3. Los efectos se procesan en orden de arriba a abajo
4. Arrastra el manejador (⋮) o pulsa los botones ▲▼ para reordenar los efectos
   - Para efectos Section: Shift+clic en los botones ▲▼ para mover secciones completas (de una Section a la siguiente Section, inicio de pipeline, o final de pipeline)
5. Haz clic en el nombre de un efecto para expandir o colapsar sus ajustes
   - Shift+clic en un efecto Section para colapsar/expandir todos los efectos dentro de esa sección
   - Shift+clic en otros efectos para colapsar/expandir todos los efectos excepto los de la categoría Analyzer
   - Ctrl+clic para colapsar/expandir todos los efectos
6. Utiliza el botón **ON** para omitir efectos individuales
7. Haz clic en el botón **?** para abrir su documentación detallada en una nueva pestaña
8. Elimina efectos utilizando el botón ×
   - Para efectos Section: Shift+clic en el botón × para eliminar secciones completas
9. Haz clic en el botón de enrutamiento para configurar los canales que se procesarán y los buses de entrada y salida
   - [Más información sobre las funciones de los buses](bus-function.md)
10. Haz clic en el botón Preajustes de efecto de cada efecto para guardar o aplicar ajustes solo para ese efecto

Haz clic en el candado junto a × para bloquear o desbloquear los ajustes del efecto. Mientras esté bloqueado, no podrás cambiar sus parámetros, restablecerlos, aplicar preajustes ni modificar el enrutamiento. El procesamiento de audio, ON/OFF, la reordenación, el plegado y la eliminación siguen disponibles. El estado plegado y el bloqueo se guardan y restauran con la cadena de efectos, incluidos sus preajustes y la última sesión. El candado se vuelve amarillo al bloquearse y parpadea si intentas editar. Puedes seguir consultando los valores de los gráficos y cambiando de pestaña.

### Buscar música en la Biblioteca musical

Puedes organizar en una biblioteca los archivos de música guardados en tu dispositivo.

1. En PC, ábrela con el botón **Biblioteca musical** del encabezado; en móvil, con la pestaña **Biblioteca**; en la aplicación de escritorio, desde **Ver > Biblioteca musical**.
2. Selecciona **Añadir carpeta de música** para indexar una carpeta de archivos de música. Las hojas CUE externas pueden dividir en pistas individuales los álbumes en archivos WAV o FLAC de la misma carpeta.
3. Explora **Pistas**, **Álbumes**, **Artistas**, **Géneros**, **Subcarpetas**, **Carpetas**, **Añadidas recientemente** o **Listas de reproducción**, y usa **Buscar en la biblioteca** para filtrar tu colección.
4. Usa **Reproducir** para escuchar a través del pipeline de efectos actual, o **Reproducir a continuación**, **Añadir a la cola** y **Añadir a lista** para gestionar la reproducción.
5. Usa **Volver a escanear** después de cambiar archivos, y **Reconectar** si se pierde un permiso del navegador o de una carpeta.
   - [Más detalles sobre la Biblioteca musical](music-library.md)

### Visualizer

Puedes disfrutar de visualizaciones basadas en la música que se está reproduciendo.

Abre **Visualizer** desde la cabecera en PC, la pestaña **Reproductor** en móvil o el menú **Ver** de la aplicación de escritorio. Elige un diseño incluido o selecciona **Edit** para organizar gráficos de audio, carátula y datos de la pista. Los cambios se aplican al instante y se conservan para el siguiente inicio; usa el diálogo de preajustes para guardar una copia con nombre. Pasa el puntero sobre la pantalla o tócala y selecciona **⛶** para que ocupe toda la ventana de la aplicación. Consulta la [guía de Visualizer](visualizer.md) para la edición, los efectos y las opciones de visualización.

### Uso de preajustes

Puedes guardar y cargar las cadenas de efectos que crees.

Haz clic en el botón **Preajustes de cadena de efectos** del encabezado de Effect Pipeline para abrir el diálogo de preajustes.

1. Carga un preajuste seleccionándolo en la lista de preajustes guardados. Se restaura la cadena de efectos completa, incluidos el orden de los efectos, los ajustes y los estados ON/OFF.
2. Guarda la cadena de efectos actual introduciendo un nombre y seleccionando **Guardar**.
3. Cambia el nombre de un preajuste guardado con su botón de cambio de nombre.
4. Selecciona uno o más preajustes guardados, elige **Eliminar seleccionados** y confirma para quitarlos.
5. Pulsa Ctrl+S (o Cmd+S en macOS) para abrir el diálogo con el nombre del preajuste actual listo para editar.

Cada efecto también tiene su propio botón **Preajustes de efecto**. Abre los preajustes del sistema cuando el efecto los ofrece y te permite guardar, cambiar el nombre, cargar o eliminar tus propios ajustes para ese efecto. Los preajustes de efecto solo cambian los parámetros de ese efecto; no cambian su estado ON/OFF ni su enrutamiento.

La importación, la exportación y el uso compartido de archivos `.effetune_preset` siguen usando preajustes de la cadena de efectos completa.

### Controles comunes de los efectos

- Para ajustar un control deslizante con precisión, mantén pulsada la tecla Shift mientras lo arrastras; el valor cambia de paso mínimo en paso mínimo
   - En los deslizadores que admiten valores negativos y positivos, el relleno va de 0 al valor actual. Los deslizadores Ratio toman 1.0 como punto de partida.
- En los gráficos compatibles de frecuencia y de notas, arrastra a lo largo del eje del gráfico para escuchar la frecuencia seleccionada a través de la cadena de efectos. En **Configuración > General > Sonido de preescucha de frecuencia**, elige **Onda sinusoidal** (predeterminado, -12 dB) o **Ruido de banda limitada**, que reproduce ruido centrado en esa frecuencia. Note Spectrogram, Pitch Meter, Chroma Spiral y las vistas con teclado de piano siempre usan una onda sinusoidal. Las vistas con teclado de piano se ajustan al semitono más cercano; al arrastrar sobre una tecla, se escucha la nota de esa tecla

[Controlar efectos mediante MIDI, mando o teclado](controller-mapping.md)

### Usando Secciones

Puedes agrupar varios efectos y controlarlos juntos.

1. Uso del Efecto de Sección:
   - Añade un efecto de Sección al principio de un grupo de efectos
   - Ingresa un nombre descriptivo en el campo de comentario
   - Al cambiar el ON/OFF de Section, se omite o se restaura toda esa sección sin cambiar el estado ON/OFF propio de cada efecto
   - Usa múltiples efectos de Sección para organizar tu cadena de efectos en grupos lógicos
   - [Más sobre efectos de control](plugins/control.md)

### Usando Funciones de Pipeline AB

Puedes alternar entre dos cadenas de efectos para comparar cómo suenan.

1. Resumen de Pipeline AB:
   - EffeTune puede mantener dos pipelines de efectos separados: Pipeline A y Pipeline B
   - Al inicio, solo se carga el Pipeline A; el Pipeline B se crea cuando es necesario
   - Todas las operaciones de procesamiento, guardado, carga y edición funcionan en el pipeline seleccionado actualmente

2. Botón de Alternancia AB:
   - Ubicado a la derecha del encabezado de Effect Pipeline
   - Muestra "A" por defecto (Pipeline A activo)
   - Haz clic para alternar entre Pipeline A y Pipeline B
   - Si el Pipeline B no existe al alternar, la configuración del Pipeline A se copia al Pipeline B

3. Menú AB (botón desplegable):
   - Ubicado a la derecha del botón de alternancia AB
   - "A → B": Copia la configuración del Pipeline A al Pipeline B y cambia al Pipeline B
   - "B → A": Copia la configuración del Pipeline B al Pipeline A y cambia al Pipeline A

4. Prueba de doble ciego:
   - Compara Pipeline A y Pipeline B de oído sin saber cuál se está reproduciendo
   - Ejecuta una prueba ABX para comprobar si realmente puedes distinguir los dos pipelines, o una prueba de preferencia A/B para saber cuál prefieres, con una comprobación de significación estadística
   - Ábrela desde el menú de pipeline ▼ situado a la derecha del botón de alternancia AB (también disponible desde el menú Archivo en la aplicación de escritorio)
   - [Más información sobre la prueba de doble ciego](double-blind-test.md)

### Selección de Efectos y Atajos de Teclado

1. Métodos de Selección de Efectos:
   - Haz clic en los encabezados de los efectos para seleccionar efectos individuales
   - Mantén presionada la tecla Ctrl mientras haces clic para seleccionar múltiples efectos
   - Haz clic en un espacio vacío en el área de Pipeline para deseleccionar todos los efectos

2. Atajos de Teclado:
   - Ctrl + Z: Deshacer
   - Ctrl + Y: Rehacer
   - Ctrl + S: Guardar el pipeline actual
   - Ctrl + Shift + S: Guardar el pipeline actual como
   - Ctrl + X: Cortar los efectos seleccionados
   - Ctrl + C: Copiar los efectos seleccionados
   - Ctrl + V: Pegar los efectos desde el portapapeles
   - Ctrl + F: Buscar efectos
   - Ctrl + A: Seleccionar todos los efectos en el pipeline
   - Delete: Eliminar los efectos seleccionados
   - ESC: Deseleccionar todos los efectos
   - T: Alternar entre Pipeline A y Pipeline B
   - A: Cambiar al Pipeline A
   - B: Cambiar al Pipeline B

3. Atajos de teclado (al usar el reproductor):
   - Espacio: Reproducir/Pausar
   - Ctrl + → o N: Siguiente pista
   - Ctrl + ← o P: Pista anterior
   - Shift + → o F o .: Avanzar 10 segundos
   - Shift + ← o R o ,: Retroceder 10 segundos
   - Ctrl + M: Alternar modo repetición
   - Ctrl + H: Alternar modo aleatorio
   - T: Alternar entre Pipeline A y Pipeline B
   - A: Cambiar al Pipeline A
   - B: Cambiar al Pipeline B

### Procesamiento de Archivos de Audio

Puedes aplicar la cadena de efectos a archivos de música y guardar el audio procesado en archivos nuevos.

1. Área de Arrastre o Especificación de Archivos:
   - Un área de arrastre dedicada siempre es visible debajo del **Effect Pipeline**
   - Soporta uno o múltiples archivos de audio
   - Los archivos se procesan utilizando la configuración actual del pipeline
   - Los efectos se procesan a la frecuencia de muestreo del pipeline; cualquier conversión de la frecuencia de muestreo de salida se realiza después

2. Estado del Procesamiento:
   - La barra de progreso muestra el estado actual del procesamiento
   - El tiempo de procesamiento depende del tamaño del archivo y la complejidad de la cadena de efectos

3. Opciones de Descarga o Guardado:
   - En **Configuración > Configuración... > Salida de archivos sin conexión**, elige WAV o FLAC, además de su frecuencia de muestreo y su calidad. Para FLAC, elige codificación sin pérdida de 16 o 24 bits. El valor inicial es WAV a 96 kHz con PCM de 24 bits
   - Cada formato tiene un límite de canales distinto. Si un archivo supera el límite elegido, EffeTune se detiene y muestra cómo resolverlo, sin mezclar canales automáticamente
   - Para múltiples archivos, selecciona una carpeta de salida antes de procesar; cada archivo se guarda directamente en esa carpeta al completarse
   - En navegadores más antiguos sin soporte de selección de carpeta, los archivos múltiples se empaquetan en un ZIP para descargar

### Compartir Cadenas de Efectos

Puedes compartir la configuración de tu cadena de efectos con otros usuarios.
1. Después de configurar la cadena de efectos deseada, haz clic en el botón "Compartir" en la esquina superior derecha del área de **Effect Pipeline**
2. La URL de la aplicación web se copiará automáticamente en tu portapapeles
3. Comparte la URL copiada con otros: podrán recrear exactamente tu cadena de efectos al abrirla
4. Las URL compartidas guardan los ajustes de efectos necesarios para su reproducción; la aplicación web también conserva tu estado habitual de trabajo en el navegador
5. En la versión de aplicación de escritorio, exporta la configuración a un archivo `.effetune_preset` desde el menú **Archivo**
6. Comparte el archivo `.effetune_preset` exportado. El archivo `.effetune_preset` también puede cargarse arrastrándolo a la ventana de la aplicación web

### Copia de seguridad y restauración de datos guardados

Abre **Configuración > Copia de seguridad / Restaurar** para transferir preajustes de cadena de efectos, preajustes de efecto, respuestas al impulso y mediciones guardados entre la aplicación web, la aplicación de escritorio y la extensión de navegador. En las aplicaciones web y de escritorio también puedes incluir los preajustes de Visualizer con nombre. Al seleccionar un preajuste, se seleccionan automáticamente los datos de medición o de respuesta al impulso que utiliza.

**Incluir datos de medición** e **Incluir datos de respuesta impulsional** están activados de forma predeterminada para que las copias de seguridad sean autónomas. Desactiva cualquiera de las dos opciones solo cuando el destino ya tenga los archivos de medición o de respuesta al impulso correspondientes. Las respuestas al impulso restauradas se añaden a la **Biblioteca de respuestas al impulso** de EffeTune. Restaurar una copia de seguridad no cambia el pipeline actual, el volumen, el preajuste seleccionado, los ajustes de dispositivo, la Biblioteca musical ni las reglas de URL de la extensión. Cada archivo `.effetune_backup` admite hasta 256 MB; si es necesario, divide las copias de seguridad más grandes en varios archivos. Si la restauración se interrumpe, los elementos ya completados se conservan y puedes volver a restaurar el mismo archivo con seguridad.

Antes de compartir una copia de seguridad, revisa la selección: puede contener nombres y comentarios de preajustes, los archivos originales de respuesta al impulso y detalles de las mediciones. No se incluyen archivos de música, datos de la Biblioteca musical, preferencias de la aplicación, dispositivos elegidos, reglas de URL, credenciales ni el pipeline actual sin guardar.

### Configuración de la aplicación

Abre **Configuración > Configuración...** para elegir el **Idioma**, ajustar **Vista al inicio:** (`Effect Pipeline (predeterminado)`, `Biblioteca musical` o `Visualizer`), configurar **Pipeline de efectos al inicio:** y seleccionar un **Tema** (`Graphite`, `Paper`, `Midnight`, `Ember` o `Mint`). Si **Vista al inicio:** es **Biblioteca musical**, también puedes elegir qué categoría de la biblioteca se abre primero. En la aplicación de escritorio, también puedes elegir **Browser** como vista al inicio.

En **Columnas de la cadena de efectos**, elige **Manual** para ajustar el número de columnas con los botones +/−, o **Automático** (predeterminado) para que las columnas y la lista de efectos quepan en el ancho de la ventana. El modo automático ajusta el número de columnas al cambiar el tamaño de la ventana.

La edición de Microsoft Store recibe las actualizaciones a través de Microsoft Store. En **Configuración > Configuración...**, usa **Abrir las actualizaciones de Microsoft Store** para buscar actualizaciones y **Abrir la configuración de inicio de Windows** para elegir si EffeTune se inicia automáticamente. Esta edición guarda su configuración y las sesiones de Browser por separado de las demás ediciones de escritorio.

### Medición acústica

Mide tu sistema de audio con un micrófono para revisar la respuesta en frecuencia, la respuesta impulsional, la distorsión y el decaimiento, y crea un EQ de corrección que se puede importar en EffeTune; consulta [Medición acústica](measurement.md) y la [guía de Pipeline Analyzer](pipeline-analyzer.md).

### Reinicio de Audio

Si experimentas problemas de audio (interrupciones, fallos):
1. Elige **Reiniciar audio** en el menú **Configuración** o en el menú adicional en móvil. En la aplicación de escritorio también puedes seleccionar **Recargar** en el menú **Ver**
2. El pipeline de audio se reconstruirá automáticamente
3. La configuración de tu cadena de efectos se conservará

### Música en red y control remoto

**Aplicación de escritorio:** Explora servidores de música, incluidos Subsonic / OpenSubsonic, comparte carpetas elegidas y reproduce en este dispositivo o en un reproductor OpenHome o UPnP AV / DLNA. Tras emparejar un reproductor EffeTune, puedes editar sus efectos en la misma ventana. El uso compartido y el acceso por control remoto están desactivados inicialmente. Consulta [música en red y control remoto](openhome.md). También puedes activar la recepción UPnP AV / DLNA y AirPlay para escuchar música enviada desde otros dispositivos con los efectos de este equipo.

La PWA puede reproducir música compartida de un ordenador EffeTune registrado y bibliotecas de red autorizadas con los efectos de este dispositivo, o controlar un reproductor de red autorizado. También puedes conectar directamente a Subsonic. Consulta [configuración y reproducción desde la PWA](openhome.md#pwa) para conocer los requisitos del navegador y de conexión.

### Controlar EffeTune con un asistente de IA (MCP)

Puedes encargar a Codex o Claude Code la configuración de MCP y después pedirle que añada efectos, ajuste sus parámetros y cargue o guarde preajustes en EffeTune para escritorio. Utiliza un agente que pueda ejecutar comandos en tu ordenador.

1. En EffeTune para escritorio, abre **Configuración > Control remoto...**, activa **Permitir control remoto** y pulsa **Copiar enlace**.
2. Envía el siguiente texto a tu agente de IA, sustituyendo el marcador por el enlace que has copiado:

```text
Configura EffeTune MCP siguiendo la guía oficial:
https://github.com/Frieve-A/effetune/blob/main/mcp/README.md
Enlace de conexión: <pega aquí el enlace copiado>
```

Tras la configuración, reinicia el cliente si se te indica y prueba a pedir: «Muéstrame mis efectos actuales». Mantén el enlace de conexión en privado; si pulsas **Nuevo token** o cambias el puerto, repite la configuración con el nuevo enlace.

Añade canciones a Music Library en el EffeTune conectado y pide: «Reproduce [canción]». El asistente busca primero en la biblioteca de ese EffeTune y reproduce en su reproductor de forma predeterminada; no necesitas compartir su carpeta de música. Para usar otra biblioteca u otro reproductor, indícalo en la petición: «Busca [canción] en [biblioteca] y reprodúcela en [reproductor]». Si la música está en otro ordenador con EffeTune, comparte allí primero la carpeta.

## Combinaciones Comunes de Efectos

Aquí hay algunas combinaciones populares de efectos para mejorar tu experiencia de escucha:

### Mejora para Auriculares
1. Stereo Blend -> RS Reverb
   - Stereo Blend: Ajusta la anchura estéreo para mayor comodidad (60-100%)
   - RS Reverb: Añade una sutil ambientación de sala (mix 10-20%)
   - Resultado: Escucha con auriculares más natural y menos fatigante

### Simulación de Vinilo
1. Wow Flutter -> Noise Blender -> Saturation
   - Wow Flutter: Añade una suave variación de tono
   - Noise Blender: Crea una atmósfera similar a la de un vinilo
   - Saturation: Añade calidez analógica
   - Resultado: Experiencia auténtica de un disco de vinilo

### Estilo de Radio FM
1. Multiband Compressor -> Stereo Blend
   - Multiband Compressor: Crea ese sonido de "radio"
   - Stereo Blend: Ajusta la anchura estéreo para mayor comodidad (100-150%)
   - Resultado: Sonido pulido al estilo radio FM

### Carácter Lo-Fi
1. Bit Crusher -> Simple Jitter -> RS Reverb
   - Bit Crusher: Reduce la profundidad de bits para una sensación retro
   - Simple Jitter: Añade imperfecciones digitales
   - RS Reverb: Crea un espacio atmosférico
   - Resultado: Estética clásica lo-fi

## Resolución de Problemas y Preguntas Frecuentes

Si tienes algún inconveniente, consulta [Resolución de problemas y preguntas frecuentes](faq.md).
Si el problema persiste, repórtalo a través de [GitHub Issues](https://github.com/Frieve-A/effetune/issues).

## Efectos Disponibles

| Categoría | Efecto             | Descripción                                                               | Documentación                                           |
| --------- | ------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| Analyzer  | Analog Meter       | Muestra los niveles de canal en un medidor de aguja con escalas VU, PPM, pico y sonoridad | [Detalles](plugins/analyzer.md#analog-meter)            |
| Analyzer  | Chroma Spiral      | Muestra los componentes de frecuencia por nota y octava en una espiral    | [Detalles](plugins/analyzer.md#chroma-spiral)           |
| Analyzer  | Level Meter        | Muestra el nivel de audio con retención de pico                           | [Detalles](plugins/analyzer.md#level-meter)             |
| Analyzer  | Note Spectrogram | Muestra las alturas estimadas a lo largo del tiempo en un piano roll      | [Detalles](plugins/analyzer.md#note-spectrogram)     |
| Analyzer  | Oscilloscope       | Visualización de la forma de onda en tiempo real                          | [Detalles](plugins/analyzer.md#oscilloscope)            |
| Analyzer  | Pitch Meter | Sigue una frecuencia fundamental y su afinación a lo largo del tiempo | [Detalles](plugins/analyzer.md#pitch-meter) |
| Analyzer  | Rhythm Analyzer | Muestra el tempo y los ataques por banda de frecuencia o tipo de batería | [Detalles](plugins/analyzer.md#rhythm-analyzer) |
| Analyzer  | Spectrogram        | Muestra los cambios del espectro de frecuencias a lo largo del tiempo     | [Detalles](plugins/analyzer.md#spectrogram)             |
| Analyzer  | Spectrum Analyzer  | Muestra en tiempo real la intensidad de graves, medios y agudos           | [Detalles](plugins/analyzer.md#spectrum-analyzer)       |
| Analyzer  | Stereo Meter       | Visualiza el equilibrio estéreo y la correlación entre canales            | [Detalles](plugins/analyzer.md#stereo-meter)            |
| Basics    | Bass Management    | Redirige las frecuencias bajas a uno o más subwoofers y suma el canal LFE con los graves de los canales principales | [Detalles](plugins/basics.md#bass-management) |
| Basics    | Channel Divider    | Divide la señal estéreo en bandas de frecuencia y enruta cada banda a pares de salida estéreo separados | [Detalles](plugins/basics.md#channel-divider)      |
| Basics    | DC Offset          | Ajuste de desplazamiento de corriente continua                             | [Detalles](plugins/basics.md#dc-offset)                 |
| Basics    | FIR Crossover      | Crossover FIR que envía bandas de separación pronunciada a pares de salida estéreo | [Detalles](plugins/basics.md#fir-crossover) |
| Basics    | Matrix             | Enruta y mezcla canales de audio con control flexible                      | [Detalles](plugins/basics.md#matrix)                    |
| Basics    | MultiChannel Panel | Panel de control para múltiples canales con volumen, silencio, solo y retardo | [Detalles](plugins/basics.md#multichannel-panel)      |
| Basics    | Mute               | Silencia completamente la señal de audio                                  | [Detalles](plugins/basics.md#mute)                      |
| Basics    | Polarity Inversion | Inversión de polaridad de la señal                                        | [Detalles](plugins/basics.md#polarity-inversion)        |
| Basics    | Stereo Balance     | Control de balance de canales estéreo                                     | [Detalles](plugins/basics.md#stereo-balance)            |
| Basics    | Volume             | Control básico de volumen                                                 | [Detalles](plugins/basics.md#volume)                    |
| Delay     | Delay          | Efecto de retardo estándar | [Detalles](plugins/delay.md#delay) |
| Delay     | Time Alignment | Ajusta con precisión el tiempo de reproducción para alinear altavoces y posición de escucha | [Detalles](plugins/delay.md#time-alignment) |
| Dynamics  | Attack Tonal Balance | Equilibra ataques breves y estructura tonal sostenida | [Detalles](plugins/dynamics.md#attack-tonal-balance) |
| Dynamics  | Auto Leveler | Ajuste automático de volumen basado en medición LUFS para una experiencia de escucha uniforme | [Detalles](plugins/dynamics.md#auto-leveler) |
| Dynamics  | Brickwall Limiter | Limita los picos de señal para evitar el recorte digital | [Detalles](plugins/dynamics.md#brickwall-limiter) |
| Dynamics  | Compressor | Suaviza los pasajes que se vuelven fuertes de golpe para una escucha más cómoda | [Detalles](plugins/dynamics.md#compressor) |
| Dynamics  | Expander | Recupera contraste dinámico haciendo más silenciosos los sonidos bajos por debajo del umbral | [Detalles](plugins/dynamics.md#expander) |
| Dynamics  | Gate | Reduce sonidos de bajo nivel durante pausas o secciones tranquilas | [Detalles](plugins/dynamics.md#gate) |
| Dynamics  | Multiband Compressor | Balance de volumen de 5 bandas para un sonido estable tipo radio | [Detalles](plugins/dynamics.md#multiband-compressor) |
| Dynamics  | Multiband Expander | Expansor de 5 bandas para devolver contraste natural a grabaciones demasiado planas | [Detalles](plugins/dynamics.md#multiband-expander) |
| Dynamics  | Multiband Transient | Moldea ataque y sustain por separado en graves, medios y agudos | [Detalles](plugins/dynamics.md#multiband-transient) |
| Dynamics  | Power Amp Sag | Simula la caída de voltaje del amplificador de potencia bajo condiciones de alta carga | [Detalles](plugins/dynamics.md#power-amp-sag) |
| Dynamics  | Transient Shaper | Ajusta el golpe y el cuerpo de la música moldeando ataques y sustain | [Detalles](plugins/dynamics.md#transient-shaper) |
| EQ        | 15Band GEQ | Ecualizador gráfico de 15 bandas | [Detalles](plugins/eq.md#15band-geq) |
| EQ        | 15Band PEQ | Ecualizador paramétrico de 15 bandas para ajustes detallados del tono de escucha | [Detalles](plugins/eq.md#15band-peq) |
| EQ        | 5Band Dynamic EQ | Ecualizador dinámico de 5 bandas con ajuste de frecuencia basado en umbral | [Detalles](plugins/eq.md#5band-dynamic-eq) |
| EQ        | 5Band FIR PEQ | Ecualizador paramétrico de 5 bandas con filtrado FIR Minimum Phase o Linear Phase | [Detalles](plugins/eq.md#5band-fir-peq) |
| EQ        | 5Band PEQ | Ecualizador flexible de 5 bandas para moldear graves, medios y agudos | [Detalles](plugins/eq.md#5band-peq) |
| EQ        | Band Pass Filter | Enfócate en frecuencias específicas | [Detalles](plugins/eq.md#band-pass-filter) |
| EQ        | Comb Filter | Añade una coloración faseada, hueca o metálica | [Detalles](plugins/eq.md#comb-filter) |
| EQ        | Earphone Cable Sim | Ayuda a comprobar lo pequeñas que suelen ser las variaciones de respuesta en frecuencia causadas por cables de auriculares normales | [Detalles](plugins/eq.md#earphone-cable-sim) |
| EQ        | Group Delay EQ | Ajusta el retardo de cada banda de frecuencia sin cambiar el tono | [Detalles](plugins/eq.md#group-delay-eq) |
| EQ        | Group Delay PEQ | Control paramétrico de cinco bandas del retardo por frecuencia sin cambiar el tono | [Detalles](plugins/eq.md#group-delay-peq) |
| EQ        | Hi Pass Filter | Elimina con precisión las frecuencias bajas no deseadas | [Detalles](plugins/eq.md#hi-pass-filter) |
| EQ        | Lo Pass Filter | Elimina con precisión las frecuencias altas no deseadas | [Detalles](plugins/eq.md#lo-pass-filter) |
| EQ        | Loudness Equalizer | Corrección del equilibrio de frecuencias para escucha a bajo volumen | [Detalles](plugins/eq.md#loudness-equalizer) |
| EQ        | Narrow Range | Combinación de filtros pasaaltos y pasabajos | [Detalles](plugins/eq.md#narrow-range) |
| EQ        | Room EQ      | Corrección FIR basada en mediciones de sala guardadas | [Detalles](plugins/eq.md#room-eq) |
| EQ        | Tilt EQ      | Ecualizador de inclinación para modelado rápido del tono | [Detalles](plugins/eq.md#tilt-eq)      |
| EQ        | Tonal Balance EQ | Corrige automáticamente el balance tonal a largo plazo hacia un objetivo según el estilo musical | [Detalles](plugins/eq.md#tonal-balance-eq) |
| EQ        | Tone Control | Control de tono de tres bandas | [Detalles](plugins/eq.md#tone-control) |
| Lo-Fi     | AM Radio Simulator | Pasa la música por una cadena modelada de transmisión y recepción AM | [Detalles](plugins/lofi.md#am-radio-simulator) |
| Lo-Fi     | Bit Crusher | Reducción de profundidad de bits y efecto de retención de orden cero | [Detalles](plugins/lofi.md#bit-crusher) |
| Lo-Fi     | Cassette Artifacts | Graba la música en un casete compacto modelado y la reproduce en una pletina Type I/II/IV con Dolby B/C | [Detalles](plugins/lofi.md#cassette-artifacts) |
| Lo-Fi     | Digital Error Emulator | Simula varios errores de transmisión de audio digital y características de equipos digitales vintage | [Detalles](plugins/lofi.md#digital-error-emulator) |
| Lo-Fi     | DSD64 IMD Simulator | Simula la distorsión por intermodulación audible que genera el ruido ultrasónico del DSD64 | [Detalles](plugins/lofi.md#dsd64-imd-simulator) |
| Lo-Fi     | FM Radio Simulator | Hace pasar la música por una cadena de emisión y recepción FM simulada físicamente | [Detalles](plugins/lofi.md#fm-radio-simulator) |
| Lo-Fi     | G.726 Simulator | Simula una conversión de codificación y decodificación de voz ITU-T G.726 con un enlace de radio ruidoso opcional | [Detalles](plugins/lofi.md#g726-simulator) |
| Lo-Fi     | GSM-FR Simulator | Simula una conversión de codificación y decodificación de voz GSM-FR a 13 kbit/s por enlace de radio con ocultación de pérdidas de trama | [Detalles](plugins/lofi.md#gsm-fr-simulator) |
| Lo-Fi     | Hum Generator | Añade una atmósfera ajustable de zumbido eléctrico de 50/60 Hz para escucha vintage/lo-fi | [Detalles](plugins/lofi.md#hum-generator) |
| Lo-Fi     | MD Simulator | Simula una conversión de codificación y decodificación ATRAC de la era MiniDisc | [Detalles](plugins/lofi.md#md-simulator) |
| Lo-Fi     | MP3 Codec Simulator | Simula una conversión limpia de codificación y decodificación MPEG Layer III a baja tasa | [Detalles](plugins/lofi.md#mp3-codec-simulator) |
| Lo-Fi     | Noise Blender | Añade una textura de ruido de fondo ajustable para ambiente lo-fi | [Detalles](plugins/lofi.md#noise-blender) |
| Lo-Fi     | SBC Codec Simulator | Reproduce una conversión de codificación y decodificación Bluetooth A2DP SBC con pérdida de paquetes del enlace y ocultación opcionales | [Detalles](plugins/lofi.md#sbc-codec-simulator) |
| Lo-Fi     | Simple Jitter | Simulación de jitter digital | [Detalles](plugins/lofi.md#simple-jitter) |
| Lo-Fi     | SW Radio Simulator | Pasa la música por una cadena modelada de emisión en onda corta, propagación ionosférica y recepción | [Detalles](plugins/lofi.md#sw-radio-simulator) |
| Lo-Fi     | Tape Artifacts | Graba la música en una cinta de bobina abierta modelada y la reproduce | [Detalles](plugins/lofi.md#tape-artifacts) |
| Lo-Fi     | TV Audio Simulator | Pasa la música por trayectos de sonido de televisión analógica y NICAM modelados | [Detalles](plugins/lofi.md#tv-audio-simulator) |
| Lo-Fi     | Vinyl Artifacts | Añade pops, crackle, hiss, rumble y fuga de ruido estéreo al estilo vinilo | [Detalles](plugins/lofi.md#vinyl-artifacts) |
| Lo-Fi     | Vinyl Simulator | Graba la entrada en un surco modelado y la reproduce con una aguja física simulada | [Detalles](plugins/lofi.md#vinyl-simulator) |
| Modulation | Auto Filter | Barre un filtro resonante mediante un LFO o la envolvente de amplitud | [Detalles](plugins/modulation.md#auto-filter) |
| Modulation | Auto Pan | Desplaza suavemente el nivel de cada par estéreo por el campo sonoro | [Detalles](plugins/modulation.md#auto-pan) |
| Modulation | Chorus | Añade chorus, ensemble, flanging o vibrato mediante retardos móviles | [Detalles](plugins/modulation.md#chorus) |
| Modulation | Doppler Distortion | Simula cambios dinámicos y naturales en el sonido causados por movimientos sutiles del cono del altavoz | [Detalles](plugins/modulation.md#doppler-distortion) |
| Modulation | Frequency Shifter | Traslada frecuencias, aplica modulación en anillo o un desplazamiento barber-pole | [Detalles](plugins/modulation.md#frequency-shifter) |
| Modulation | Phaser | Crea picos y muescas móviles con barridos clásicos o barber-pole | [Detalles](plugins/modulation.md#phaser) |
| Modulation | Pitch Shifter | Sube o baja el tono de la música sin cambiar el tempo | [Detalles](plugins/modulation.md#pitch-shifter) |
| Modulation | Pitch Shifter HQ | Sube o baja el tono con menos artefactos de fase para una escucha atenta | [Detalles](plugins/modulation.md#pitch-shifter-hq) |
| Modulation | Rotary Speaker | Combina el movimiento independiente de bocina y tambor | [Detalles](plugins/modulation.md#rotary-speaker) |
| Modulation | Tremolo | Efecto de modulación basado en volumen | [Detalles](plugins/modulation.md#tremolo) |
| Modulation | Wow Flutter | Añade una sutil fluctuación de tono tipo cinta o disco para carácter vintage | [Detalles](plugins/modulation.md#wow-flutter) |
| Resonator | Adaptive Prediction | Aprende a predecir el audio para extraer el residuo o crear resonancias que evolucionan | [Detalles](plugins/resonator.md#adaptive-prediction) |
| Resonator | Horn Resonator | Simulación de resonancia de bocina con dimensiones personalizables | [Detalles](plugins/resonator.md#horn-resonator) |
| Resonator | Horn Resonator Plus | Resonancia de bocina más suave para una coloración natural en la escucha | [Detalles](plugins/resonator.md#horn-resonator-plus) |
| Resonator | Modal Resonator | Efecto de resonancia de frecuencia con hasta 5 resonadores | [Detalles](plugins/resonator.md#modal-resonator) |
| Restoration | Click Remover | Repara clics, crujidos, chasquidos y cortes breves | [Detalles](plugins/restoration.md#click-remover) |
| Restoration | Clip Restorer | Restaura picos aplanados por recorte duro | [Detalles](plugins/restoration.md#clip-restorer) |
| Restoration | Hum Remover | Elimina el zumbido eléctrico constante y sus armónicos | [Detalles](plugins/restoration.md#hum-remover) |
| Restoration | Noise Reduction | Reduce el ruido de fondo constante sin afectar la música | [Detalles](plugins/restoration.md#noise-reduction) |
| Reverb    | Dattorro Plate Reverb | Reverb de placa clásico basado en el algoritmo Dattorro | [Detalles](plugins/reverb.md#dattorro-plate-reverb) |
| Reverb    | FDN Reverb | Reverberación de red de retardo con retroalimentación que produce texturas de reverb ricas y densas | [Detalles](plugins/reverb.md#fdn-reverb) |
| Reverb    | IR Reverb | Reverberación por convolución con respuestas al impulso importadas de salas y equipos | [Detalles](plugins/reverb.md#ir-reverb) |
| Reverb    | RS Reverb | Reverberación de dispersión aleatoria con difusión natural | [Detalles](plugins/reverb.md#rs-reverb) |
| Saturation| Bandwidth Extender | Genera contenido de alta frecuencia por encima de un corte detectado o especificado | [Detalles](plugins/saturation.md#bandwidth-extender) |
| Saturation| Bass Extender | Genera graves una octava por debajo del contenido adecuado | [Detalles](plugins/saturation.md#bass-extender) |
| Saturation| Dynamic Saturation | Simula el desplazamiento no lineal de conos de altavoz | [Detalles](plugins/saturation.md#dynamic-saturation) |
| Saturation| Exciter | Añade contenido armónico para mejorar la claridad y presencia | [Detalles](plugins/saturation.md#exciter) |
| Saturation| Hard Clipping | Efecto de recorte duro digital | [Detalles](plugins/saturation.md#hard-clipping) |
| Saturation | Harmonic Distortion | Añade carácter con distorsión armónica ajustable de 2.º a 5.º orden | [Detalles](plugins/saturation.md#harmonic-distortion) |
| Saturation| Multiband Saturation | Añade calidez o filo por separado a graves, medios y agudos | [Detalles](plugins/saturation.md#multiband-saturation) |
| Saturation| Saturation | Añade riqueza y carácter cálidos de estilo analógico | [Detalles](plugins/saturation.md#saturation) |
| Saturation| Sub Synth | Mezcla una señal de baja frecuencia filtrada para reforzar los graves | [Detalles](plugins/saturation.md#sub-synth) |
| Saturation| Tube Simulator | Modela etapas de línea a válvulas y amplificadores de potencia push-pull o de triodo single-ended 300B/2A3 | [Detalles](plugins/saturation.md#tube-simulator) |
| Spatial   | Crossfeed Filter | Filtro de alimentación cruzada para auriculares para imagen estéreo natural | [Detalles](plugins/spatial.md#crossfeed-filter) |
| Spatial   | Crosstalk Cancellation | Usa mediciones en los oídos para reducir la diafonía entre altavoces estéreo | [Detalles](plugins/spatial.md#crosstalk-cancellation) |
| Spatial   | MS Matrix | Convierte entre estéreo y Mid/Side para ajustar centro y ambiente | [Detalles](plugins/spatial.md#ms-matrix) |
| Spatial   | Multiband Balance | Control de balance estéreo dependiente de frecuencia de 5 bandas | [Detalles](plugins/spatial.md#multiband-balance) |
| Spatial   | Phase Select EQ | Realza o atenúa componentes de frecuencia según la diferencia de fase L/R y Balance | [Detalles](plugins/spatial.md#phase-select-eq) |
| Spatial   | Spatial Mapper | Separa sonido Direct, Diffuse y Residual para un enrutamiento multicanal flexible | [Detalles](plugins/spatial.md#spatial-mapper) |
| Spatial   | Stereo Blend | Controla la anchura estéreo desde polaridad lateral invertida, pasando por mono, hasta estéreo ampliado | [Detalles](plugins/spatial.md#stereo-blend) |
| Others    | Oscillator | Generador de tonos de prueba y ruido para comprobar altavoces/auriculares | [Detalles](plugins/others.md#oscillator) |
| Others    | SFZ Note Player | Reproduce un instrumento SFZ importado a partir de las notas detectadas | [Detalles](plugins/others.md#sfz-note-player) |
| Control   | Section | Agrupa efectos para poder omitir o restaurar una sección completa | [Detalles](plugins/control.md) |

## Información Técnica

### Compatibilidad del Navegador

Frieve EffeTune ha sido probado y se ha verificado que funciona en Google Chrome. La aplicación requiere un navegador moderno con soporte para:
- Web Audio API
- Audio Worklet
- getUserMedia API
- Drag and Drop API
- Service Worker, para compatibilidad con aplicación web instalable y uso sin conexión

### Detalles de Soporte del Navegador
1. **Chrome/Chromium**
   - Totalmente soportado y recomendado
   - Actualiza a la última versión para un mejor rendimiento

2. **Firefox/Safari**
   - Soporte limitado
   - Algunas funciones, como la selección del dispositivo de salida, Wake Lock, el comportamiento de instalación o los formatos de audio compatibles, pueden variar según el navegador
   - Considera usar Chrome para una mejor experiencia

### Tasa de Muestreo Recomendada

Ajusta la **Tasa de muestreo** de EffeTune a 96 kHz. Así se reduce el aliasing audible que generan los efectos no lineales, como la saturación. Este ajuste controla la frecuencia de procesamiento interna de EffeTune y funciona con independencia de la frecuencia de muestreo del sistema operativo, de la interfaz de audio o del dispositivo de audio virtual. Comprueba la Tasa de muestreo efectiva que muestra la aplicación: hasta que guardes un ajuste, puede seguir el valor predeterminado del sistema operativo o del navegador, y la aplicación web puede recurrir a otra frecuencia si 96 kHz no está disponible. Si el sonido se corta, desactiva primero los efectos exigentes o acorta la cadena; baja la frecuencia de muestreo solo si es necesario.

## Guía de Desarrollo

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Frieve-A/effetune)

¿Quieres crear tus propios plugins de audio? Consulta nuestra [guía de desarrollo de plugins](../../plugin-development.md).

## Biblioteca DSP

El motor DSP de EffeTune también es una biblioteca independiente y determinista con licencia MIT para Python, JavaScript y AudioWorklet del navegador. Su esquema Chain público y el catálogo de efectos generado automáticamente pueden usarse sin la aplicación EffeTune. Consulta la [documentación de EffeTune DSP Library](https://effetune.frieve.com/dsp/).

Las guías de inicio rápido de cada paquete explican la instalación e incluyen ejemplos completos listos para ejecutar:

- [Paquete de Python](https://effetune.frieve.com/dsp/getting-started/python/)
- [Paquete de JavaScript y AudioWorklet](https://effetune.frieve.com/dsp/getting-started/javascript/)

La [guía de DSP Library](https://effetune.frieve.com/dsp/) describe los efectos, los esquemas, el comportamiento del procesamiento y los recursos necesarios.

## Enlaces

[Historial de versiones](../../version-history.md)

[Código fuente](https://github.com/Frieve-A/effetune)

[YouTube](https://www.youtube.com/@frieveamusic)

[Discord](https://discord.gg/gf95v3Gza2)

[Apóyanos en Ko-fi](https://ko-fi.com/frievea)
