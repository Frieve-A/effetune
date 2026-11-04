---
title: "Reproductor de música - EffeTune"
description: "Reproduce archivos de música y de vídeo con la cadena de efectos de EffeTune, cambia la velocidad de reproducción, usa el reproductor mini y configura la reproducción sin pausas."
lang: es
---

# Reproductor de música

Abre un archivo de música en EffeTune para escucharlo con la cadena de efectos actual. Usa los controles del reproductor para pausar, reanudar o ajustar la velocidad de reproducción.

## Abrir archivos de música

- Haz clic en **Abrir archivos de música** (el botón de carpeta de la cabecera) o arrastra archivos de música a la ventana.
- **Aplicación de escritorio:** elige **Archivo > Abrir archivo de música...** o abre un archivo de música con EffeTune desde el sistema operativo.
- **Diseño móvil:** toca **Abrir música**.

Si solo vas a usar el reproductor, ajusta **Dispositivo de entrada:** en **Ninguno (solo reproductor de archivos de música)** en **Configuración de audio** para que EffeTune no use una entrada de audio en directo.

## Archivos DSD {#dsd-files}

Abre archivos `.dsf` (DSF) o `.dff` (DSDIFF) como cualquier otro archivo de música. Se admiten archivos DFF sin comprimir y comprimidos con DST. EffeTune convierte DSD64, DSD128 y DSD256 mono o estéreo a PCM para reproducirlos con los efectos actuales. El dispositivo de audio recibe PCM, no DSD nativo ni DoP.

No se admiten algunas variantes de codificación DST (tramas segmentadas), archivos de más de dos canales, DSD512 ni DSD basado en 48 kHz. Si un archivo no se reproduce, utiliza un DFF sin comprimir o una copia PCM compatible, como FLAC o WAV. Los archivos DSD se pueden reproducir en la aplicación de escritorio y en el reproductor web/PWA, pero no en la aplicación nativa de Android.

Los archivos DSD de alta frecuencia requieren más capacidad de procesamiento, sobre todo al aumentar la velocidad de reproducción. Si el audio se entrecorta o se detiene, reduce la velocidad.

## Archivos MIDI

La reproducción de MIDI y MusicXML y su incorporación a la biblioteca están disponibles en la aplicación de escritorio y en el reproductor web/PWA. No se admiten en la aplicación de Android.

Abre archivos `.mid`, `.midi` o `.kar` con el selector de música habitual o arrastrándolos a la ventana. MIDI contiene notas y tiempos, no sonido grabado. Añade [**SoundFont Player**](plugins/others.md#soundfont-player) desde **Others** a Effect Pipeline y elige un instrumento con **SoundFont Library…**. Abrir el archivo no añade un instrumento automáticamente. También puedes incluirlo en Music Library.
Para ver la letra en **Lyrics** de Visualizer, usa la letra integrada en el MIDI o coloca un archivo `.wrd` con el mismo nombre a su lado. En la web, selecciona o arrastra ambos archivos juntos, salvo si la carpeta está accesible desde Music Library. `.wrd` acompaña a la canción, no aparece como otra pista; si no se puede leer, el MIDI sigue sonando.

Para mostrar una carátula con MIDI o MusicXML, coloca `cover.jpg` (preferido) o `folder.jpg` en la misma carpeta. En la web, selecciona o arrastra la imagen junto con el archivo de música, salvo que la carpeta sea accesible desde Music Library.

Si falta SoundFont Player, no hay un instrumento cargado o todavía se está cargando, el reproductor muestra indicaciones y sigue enviando MIDI a su ritmo, en silencio, sin saltar a la siguiente canción. La canción termina con normalidad. Puedes añadir SoundFont Player o cargar un instrumento durante la reproducción: cuando esté listo, responderá a los eventos MIDI que lleguen a partir de ese momento, con los sonidos y ajustes de control actuales de cada canal. Las notas anteriores no se vuelven a tocar, aunque sigan sostenidas en la canción.

Usa los controles habituales de reproducción, pausa, búsqueda, repetición, orden aleatorio, velocidad, volumen y silencio. La velocidad cambia el ritmo del MIDI sin alterar la altura de las notas. **Mantener el tono** no se puede cambiar durante la reproducción MIDI. Con una colección SF2/SF3, un solo SoundFont Player sigue Bank Select y Program Change de forma independiente en los 16 canales, con el banco de percusión en el canal 10 de forma predeterminada. Usa **MIDI Mixer** para ajustar el **Patch**, el nivel y otros controles de interpretación de cada canal. Los cambios son temporales, siguen los mensajes MIDI posteriores y se restablecen para la siguiente canción. Los instrumentos SFZ mantienen sus propias asignaciones.

Para guardar audio, prepara el instrumento en SoundFont Player y selecciona el MIDI en el procesamiento de archivos sin conexión. Se procesa la canción completa, con el instrumento y los efectos posteriores, a velocidad 1 y ganancia de canción unitaria, y se guarda en WAV o FLAC según los ajustes de salida. Si se alcanza el límite de cola, la aplicación avisa y corta el sonido restante.

Se admiten Standard MIDI File de formato 0 y 1. Convierte los archivos de formato 2 o RMID a un `.mid` estándar de formato 0 o 1 antes de abrirlos.

## Archivos MusicXML {#musicxml-files}

Abre archivos `.musicxml`, `.xml` o `.mxl` comprimidos igual que los MIDI. Para escucharlos, añade **SoundFont Player** y carga un instrumento. Se usan los controles MIDI descritos arriba, pero no se muestra la partitura. También puedes incluir estos archivos en Music Library.
La letra de MusicXML puede aparecer en **Lyrics** de Visualizer durante la reproducción. Elige **Parte** y **Estrofa** si hay varias, o deja **Automático**.

Se reproducen notas, silencios, acordes, voces, ligaduras, cambios de tempo y repeticiones habituales con finales alternativos. Algunos detalles de la notación, como adornos y notas de adorno, no se reproducen. Si la partitura tiene repeticiones anidadas, símbolos de repetición de compases o notas microtonales, o depende de D.C., D.S., Coda o Fine, o el archivo es una colección opus de varias partituras, expórtala como MIDI estándar desde un programa de partituras y abre ese archivo.

## Controles de reproducción

- Al pausar, reanudar o cerrar el reproductor con **×**, se aplica un breve fundido para evitar chasquidos.
- Haz clic en el botón de velocidad situado junto a **Aleatorio** para elegir uno de los nueve ajustes predefinidos o fijar cualquier velocidad entre `0.25x` y `4x` en pasos de `0.01x`. **Mantener el tono** está activado de forma predeterminada, así que el tono no cambia al variar la velocidad; desactívalo para que el tono suba y baje con la velocidad, como en una cinta o un disco.
- En la aplicación de escritorio, elige **Ver > Reproductor mini** (`Ctrl/Cmd+Shift+M`) o haz clic en el botón de reproductor mini del reproductor para cambiar a una ventana compacta. Haz clic en el botón de chincheta para mantenerla siempre visible por encima de las demás ventanas.

El reproductor de escritorio también muestra [música en red y AirPlay](openhome.md). Durante AirPlay, los detalles de la pista, la carátula y el tiempo aparecen cuando los envía el emisor; pasa el puntero por el título para ver más información. Controla la reproducción y el volumen en el dispositivo emisor. Cerrar el reproductor con **×**, o usar **Detener**, finaliza esa sesión, pero el receptor sigue habilitado y disponible para otra conexión.

El deslizador de volumen y el botón de silencio permiten ajustar el sonido del reproductor antes de que pase por los efectos. Los cambios realizados a distancia también se reflejan aquí, de modo que puedes comprobar el volumen y desactivar el silencio desde el dispositivo que reproduce la música.

## Reproducción sin pausas

**Reproducción sin pausas**, en **Configuración de audio**, está activada de forma predeterminada y reproduce sin pausa las pistas locales compatibles; su compatibilidad está limitada por el formato del archivo y por el entorno del navegador o de la aplicación. Los formatos no compatibles y algunos entornos móviles usan un modo alternativo seguro que ahorra memoria, por lo que puede quedar una pausa breve. Al desactivarla se da prioridad a un menor uso de memoria y a la estabilidad, a costa de una posible pausa breve; el cambio no interrumpe la pista actual. La reproducción sin pausas solo funciona a velocidad 1x; si cambias la velocidad durante la reproducción sin pausas, la pista se reanuda desde la misma posición tras una breve interrupción.

## Vídeo {#video}

El vídeo aparece en la zona de la carátula del reproductor. En el diseño de escritorio, al iniciar un vídeo se expande automáticamente el panel del reproductor. Puedes volver a contraerlo durante la reproducción actual. Mueve el puntero sobre el vídeo o tócalo para mostrar el botón de ampliación; se oculta tras un breve período de inactividad. Selecciona **⛶** para que ocupe toda el área de visualización de la aplicación; mueve el puntero sobre el vídeo o tócalo para mostrar los controles de reproducción en la parte inferior. También puedes añadir un elemento **Video** en Visualizer. Para incluir archivos de vídeo en la Biblioteca musical, consulta la [guía de la Biblioteca musical](music-library.md#availability).

En el diseño móvil, el vídeo ampliado y sus controles giran juntos cuando así el vídeo aprovecha mejor la pantalla. **Girar el vídeo ampliado en móviles**, en **Configuración > Configuración... > Visualización**, está activado de forma predeterminada; desactívalo para que la imagen no gire. Al volver al reproductor pequeño se restaura la vista normal. No se modifican el diseño de escritorio ni los ajustes de orientación del dispositivo.

Fuera de Mini Player, puedes usar estos gestos sobre el vídeo o sus bordes negros:

- **Ratón:** Haz clic para reproducir o pausar. Haz doble clic para ampliar o restaurar el vídeo sin cambiar su estado de reproducción o pausa.
- **Pantalla táctil:** Toca para mostrar los controles. Con el vídeo ampliado, toca dos veces la mitad izquierda para retroceder 10 segundos o la derecha para avanzar 10 segundos. El doble toque en la vista previa pequeña no cambia la posición de reproducción.

Los botones y deslizadores mantienen su funcionamiento habitual.

## Reproducir en otro dispositivo

Usa el selector de dispositivos de la parte superior para elegir **This device**, un reproductor OpenHome o uno UPnP AV / DLNA. La biblioteca y el destino se eligen por separado. Cambiar de reproductor no detiene el anterior ni mueve su cola. Se muestran la pista, la cola, la posición y los controles compatibles, incluidos **Volumen** y **Silenciar** cuando estén disponibles. También se reflejan los cambios de otros controladores.

Se transmite el audio original, sin los efectos del ordenador de origen. Un destino EffeTune aplica sus propios efectos. El servidor y el reproductor deben poder comunicarse. La cola propia de OpenHome puede continuar al desconectar el controlador; una secuencia gestionada por EffeTune o una conexión a través de un ordenador EffeTune requiere que ese ordenador siga encendido.

[música en red y control remoto](openhome.md)

[← Volver al README](README.md)
