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
