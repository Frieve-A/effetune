---
title: "Música en red y control remoto (aplicación de escritorio) - EffeTune"
description: "Reproduce música en red con EffeTune, recibe audio OpenHome, UPnP AV / DLNA y AirPlay, comparte música y controla la reproducción en tu red local."
lang: es
---

# Música en red y control remoto (aplicación de escritorio)

La aplicación de escritorio puede recibir música de otros dispositivos de la red local y procesarla con tus efectos de EffeTune. La recepción por OpenHome, UPnP AV / DLNA y AirPlay se configura por separado y empieza desactivada. Activa solo los métodos que utilices en **Configuración > Configuración... > Red**.

## Recibir música con OpenHome

En las compilaciones de escritorio compatibles (Windows x64, macOS para Intel/Apple silicon y Linux x64), EffeTune puede aparecer como reproductor OpenHome para aplicaciones de control en la misma red local. Abre **Configuración > Configuración... > Red**, activa **Permitir controladores OpenHome en esta red** (desactivado de forma predeterminada) y espera hasta que el estado indique que EffeTune está disponible.

**Nombre del dispositivo**, en **Red**, establece el nombre del reproductor de red, el receptor AirPlay y la biblioteca compartida. De forma predeterminada se usa el nombre de este equipo. Introduce un nombre personalizado, como `Living Room`, o vacía el campo para volver a usar el nombre del equipo. UPnP AV / DLNA aparece como un destino aparte con un sufijo breve; ambos destinos usan el mismo reproductor de EffeTune.

OpenHome no requiere iniciar sesión. Mientras esté activado, otros dispositivos de la red local pueden ver los metadatos de reproducción, editar la cola del reproductor y controlar la reproducción. Si el Firewall de Windows solicita permiso, permite EffeTune solo en **redes privadas**, no en **redes públicas**. Desactiva la opción cuando no necesites el control remoto.

Los controladores pueden añadir flujos de audio HTTP o HTTPS, gestionar la cola de reproducción remota y controlar reproducción, pausa, parada, salto de pista, búsqueda, repetición y modo aleatorio. El audio remoto pasa por el pipeline de efectos activo de EffeTune como de costumbre. El control básico de cola y reproducción por OpenHome se ha verificado con BubbleUPnP en Android; otras aplicaciones OpenHome pueden mostrar los servicios de forma distinta. El destino OpenHome ofrece una fuente OpenHome Playlist y no expone edición de efectos, rutas de archivos locales, volumen maestro, Radio, Songcast ni sincronización multiroom mediante OpenHome.

La reproducción sin pausas no está garantizada, y los datos técnicos de la pista pueden seguir siendo desconocidos hasta que la fuente los proporcione. Tras una suspensión, una reactivación, una conexión VPN o un cambio de red, el reproductor puede desaparecer brevemente mientras se vuelve a conectar.

## Recibir música con UPnP AV / DLNA

Activa **Permitir reproducción UPnP AV / DLNA en esta red** en **Configuración > Configuración... > Red**. En la aplicación de control, elige el destino UPnP AV / DLNA de EffeTune y una canción de un servidor al que el equipo pueda acceder. El permiso de OpenHome es independiente y puede seguir desactivado.

Este destino recibe MP3, FLAC, WAV con PCM y AAC (ADTS o MP4/M4A) por HTTP o HTTPS. También admite Ogg (Vorbis/Opus/FLAC), WebM (Vorbis/Opus) y audio Matroska (PCM/FLAC/MP3/Opus/Vorbis/AAC). Aunque el tipo de archivo sea compatible, el códec que contiene también debe serlo; ALAC no es compatible.

Los controladores pueden reproducir, pausar, detener, cambiar de pista, desplazarse cuando la fuente lo permita y ajustar el volumen o silenciar el reproductor. Ese volumen también afecta a la música local y OpenHome; no cambia el volumen del equipo ni los efectos. Elegir una canción nueva sustituye la cola actual por esa canción. El controlador y EffeTune muestran el mismo estado de reproducción. Cuando el servidor de música los proporciona, las etiquetas y los detalles del audio de origen también están disponibles en **Información de la pista** de Visualizer.

Utiliza una red local de confianza: los controladores habilitados pueden cambiar la reproducción sin iniciar sesión. Permite el acceso a redes privadas si el cortafuegos lo solicita. No se convierte el audio y la compatibilidad depende del controlador y la fuente. Es un receptor de audio; no se garantiza certificación DLNA, reproducción de vídeo ni compatibilidad con todos los formatos DLNA.

## Recibir audio con AirPlay

Activa **Permitir audio AirPlay en esta red** en **Configuración > Configuración... > Red** y elige el **Nombre del dispositivo** en la lista de salidas de audio AirPlay del emisor. El estado indica si el receptor está disponible o está recibiendo audio. Mantén EffeTune abierto y ambos dispositivos en la misma red local de confianza. Cualquier dispositivo que pueda acceder al receptor habilitado puede enviar audio sin iniciar sesión.

AirPlay recibe audio estéreo de un solo emisor a la vez. Inicia y detén la reproducción y ajusta el volumen en el emisor. Los ajustes locales y UPnP AV de volumen y silencio solo se aplican a la reproducción de archivos y URL. Cuando el audio AirPlay está listo, sustituye a la música que estaba sonando. Iniciar música local, OpenHome o UPnP AV termina la recepción AirPlay. Al finalizar AirPlay no se reanuda automáticamente la pista anterior. Cerrar el reproductor de EffeTune con **×**, o usar **Detener**, finaliza la sesión de AirPlay actual; el receptor sigue habilitado y disponible para otra conexión.

Cuando el emisor los proporciona, el reproductor muestra el título, el artista, la carátula y el tiempo de reproducción. Pasa el puntero por el título para consultar más información, como álbum, compositor, género, comentarios, emisor y formato de audio. La información disponible depende de la aplicación emisora y del contenido; el tiempo se actualiza cuando lo comunica el emisor. También puedes mostrarla en [Visualizer](visualizer.md).

**Audio recibido** identifica el códec de AirPlay, como ALAC o AAC-ELD. **PCM del receptor** describe el audio que recibe EffeTune para procesarlo: estéreo de 44.1 kHz y 16 bits. Estos valores no indican la calidad del archivo de música original. Cuando se proporciona, **Volumen del emisor** muestra la posición del control de volumen del dispositivo emisor como un porcentaje de solo lectura; ajústalo en ese dispositivo.

El almacenamiento en búfer de la red y los efectos de EffeTune añaden latencia, por lo que el sonido puede retrasarse respecto al vídeo. No se admiten las funciones de AirPlay 2, la sincronización multiroom, la duplicación de pantalla, el vídeo ni el contenido protegido. La compatibilidad puede variar según el dispositivo y la aplicación emisora.

La detección AirPlay necesita Bonjour en Windows y macOS, o un servicio Avahi / DNS-SD activo en Linux. El instalador estándar de Windows añade el servicio de detección si hace falta; las versiones portátil y de Microsoft Store requieren que ya esté instalado. En Linux, instala el servicio Avahi / DNS-SD de tu distribución y actívalo con sus herramientas habituales de gestión de servicios. Si el receptor no está disponible, comprueba estos requisitos y el permiso del cortafuegos para redes privadas antes de reintentar. El Wi-Fi de invitados, las VPN o el aislamiento de red pueden impedir que los dispositivos se encuentren.

## Elegir una biblioteca y un reproductor

En la aplicación de escritorio, el selector **Library** de Music Library permite elegir **This device** o un servidor de música de la red local. Las bibliotecas compartidas de EffeTune ofrecen las categorías habituales, la búsqueda y la ordenación descritas en la [guía de Music Library](music-library.md). Los demás servidores de música muestran las categorías y la estructura de carpetas que publican; la búsqueda y la ordenación solo están disponibles si el servidor las admite.

Usa el selector de dispositivos de la parte superior de la ventana para elegir **This device** o un reproductor OpenHome. Biblioteca y reproductor se eligen por separado: puedes explorar la música de un ordenador y reproducirla en otro. Cambiar el reproductor solo cambia el destino de los controles; no detiene el anterior ni traslada su cola. Se muestran la pista, la cola, la posición, la repetición y el modo aleatorio del destino, con las funciones que admite. También se reflejan los cambios de otros controladores.

## Compartir carpetas de música

Abre **Configuración > Configuración... > Red**. En **Compartir biblioteca**, selecciona las carpetas, activa **Compartir las carpetas seleccionadas en esta red** y pulsa **Guardar**. Si no aparece ninguna carpeta, añádela primero a Music Library. El uso compartido está desactivado inicialmente y solo publica las carpetas registradas que hayas elegido. Los dispositivos de la misma red pueden explorarlas y reproducirlas sin iniciar sesión. Desactiva el uso compartido o desmarca una carpeta y pulsa **Guardar** para retirar el acceso. Mantén EffeTune abierto en el ordenador que contiene la música.

Para reproducir archivos locales sueltos sin activar el uso compartido de la biblioteca, elige otro reproductor y usa **Open music files**. EffeTune facilita únicamente los archivos seleccionados a ese reproductor; mantén abierta la aplicación en el equipo de origen.

Se comparte el audio original, sin los efectos del ordenador de origen. Si el destino es EffeTune, aplica sus propios efectos. El dispositivo usado para elegir música no procesa ni retransmite continuamente el audio. El servidor y el reproductor deben poder comunicarse entre sí; la cola puede seguir reproduciéndose cuando se desconecta la aplicación de control.

## Editar los efectos del reproductor (aplicación de escritorio)

Selecciona un reproductor EffeTune y abre **Effect Pipeline**. Antes de conectar por primera vez, activa **Permitir control remoto** en ese reproductor desde **Configuración > Configuración... > Red** o **Configuración > Control remoto...**. Elige **Connect effects** aquí y luego **Permitir** en la solicitud que aparece en el ordenador del reproductor. No necesitas introducir un enlace de emparejamiento. La conexión autorizada se guarda y, al seleccionar ese reproductor más adelante, sus efectos se conectan automáticamente. Detectar un dispositivo o compartir su biblioteca no autoriza la edición de efectos.

El encabezado muestra el reproductor que estás editando. Puedes usar su cadena, bypass, A/B, deshacer/rehacer y presets de cadena guardados según las funciones disponibles. El selector de IR también usa la biblioteca IR de ese reproductor. Guardar o borrar presets de cadena modifica ese destino. Cada efecto ofrece sus presets integrados; los presets de usuario de efectos individuales no están disponibles en remoto. Las operaciones no compatibles no están disponibles. Los reproductores de otros fabricantes pueden reproducir música, pero no usar el editor de efectos de EffeTune.

En la biblioteca de IR Reverb, **Subir archivo…** importa un archivo IR de hasta 64 MiB al reproductor seleccionado, y **Descargar** guarda un IR de un solo archivo en el dispositivo que estás usando. Los pares True Stereo se pueden seleccionar, pero no transferir. Para borrar IR, abre la biblioteca en el propio reproductor. Las transferencias solo se realizan cuando las solicitas; las bibliotecas no se copian automáticamente entre dispositivos.

Si se pierde la conexión, el reproductor sigue seleccionado y la edición se desactiva hasta reconectar. Al reconectar se leen sus ajustes actuales, sin reenviar cambios sin confirmar. Para volver a conectar, elige **Change connection** y luego **Connect effects**. El botón de control remoto sigue gestionando el acceso a este ordenador; los enlaces de emparejamiento, el editor del navegador y las ventanas remotas independientes siguen disponibles.

<a id="pwa"></a>

## Escuchar y controlar desde la PWA

En la misma red, la [PWA de EffeTune](https://effetune.frieve.com/effetune.html) puede reproducir la música compartida de un ordenador con los efectos de EffeTune de tu teléfono, o controlar la reproducción y los efectos de ordenadores EffeTune registrados. **Library** y el dispositivo de reproducción empiezan en **This device**. La PWA usa los dispositivos que añadas; no detecta otros servidores de música.

1. En el ordenador, abre **Configuración > Control remoto...**, activa **Permitir control remoto** y elige **Copiar enlace**. Para explorar su música, comparte también carpetas mediante **Compartir biblioteca**, como se explica arriba. No es necesario permitir los controladores OpenHome.
2. En el selector de dispositivos de reproducción de la PWA, elige **Add device…**. Pega el enlace copiado en **Pairing link** y pulsa **Connect**. Permite el acceso a la red local cuando se solicite. Puedes usar **Scan QR code** si aparece; de lo contrario, pega el enlace. Abrir el código QR con la cámara habitual del teléfono abre el editor remoto independiente.

Elige el ordenador en **Library** para usar las mismas nueve vistas de exploración. Mantén **This device** como dispositivo de reproducción para escuchar con los efectos de la PWA, o elige un ordenador registrado y abre **Effect Pipeline** para editar sus efectos. Para reproducir la música del ordenador A en el B, añade ambos y elige A como biblioteca y B como reproductor. Cambiar la selección no detiene el reproductor anterior ni mueve su cola.

Abre de nuevo **Add device…** para gestionar **Saved devices**. Si cambia la dirección o el código de conexión, usa **Update connection** con un enlace nuevo; usa **Remove** para eliminar el registro. **Refresh** actualiza la disponibilidad y los ajustes de uso compartido. Borrar los datos del navegador elimina los dispositivos guardados; si el almacenamiento no está disponible, el registro dura solo la sesión actual. Los equipos antiguos pueden ofrecer **Open remote editor** en lugar de reproducción desde la PWA.

Usa un navegador Chromium reciente y permite el acceso a la red local. La compatibilidad varía; consulta la [guía de permisos de red local de Chrome](https://developer.chrome.com/blog/local-network-access) y el [soporte de WebSocket](https://developer.chrome.com/release-notes/147). Los enlaces HTTP no están cifrados: úsalos solo en una red de confianza. Safari/iOS y los navegadores sin soporte de HTTP local necesitan una [configuración HTTPS de confianza](../../remote-v1.md#encrypted-connections), con un certificado que corresponda a la dirección IP del ordenador y que el navegador considere fiable. Las políticas del navegador o del sistema pueden seguir bloqueando el acceso; escanear un código QR no hace que el certificado sea fiable.

La PWA no puede enviar sus archivos locales a otro reproductor; selecciona una biblioteca compartida de un ordenador. Mantén el origen y el reproductor activos y conectados. Cerrar la PWA no detiene la reproducción en otro ordenador mientras el origen y el reproductor puedan comunicarse. La reproducción en el teléfono depende de los formatos que admita y puede pausarse cuando la aplicación pasa a segundo plano.

## Límites de la reproducción en red

La detección automática de servidores y el uso compartido de carpetas de música requieren la aplicación de escritorio. La PWA se conecta a ordenadores EffeTune registrados como se explica arriba. Los formatos reproducibles y la búsqueda de posición dependen del destino y del archivo; no se convierte el audio. Las pistas parciales CUE no se pueden enviar como pistas de red independientes. No se garantiza la reproducción sin pausas ni la sincronización entre habitaciones. Si un servidor o reproductor desaparece, comprueba que esté activo, en la misma red y permitido por el cortafuegos de la red privada; después actualiza la lista. El uso compartido se detiene al cerrar la aplicación de origen o suspender su ordenador.

[← Volver al README](README.md)
