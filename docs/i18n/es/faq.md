---
title: "Preguntas frecuentes y solución de problemas - EffeTune"
description: "Preguntas frecuentes y guía de solución de problemas para el procesador de audio Frieve EffeTune."
lang: es
---

# Preguntas frecuentes sobre EffeTune

EffeTune es una aplicación DSP en tiempo real para entusiastas del audio disponible como aplicación web y de escritorio. Este documento cubre la configuración, solución de problemas, uso multicanal, operación de efectos y corrección de frecuencia.

## Contenido
1. Configuración inicial para streaming
   1.1. Instalación de VB-CABLE y uso de 96 kHz
   1.2. Entrada de servicio de streaming (ejemplo con Spotify)
   1.3. Configuración de audio de EffeTune
   1.4. Comprobación de funcionamiento
2. Solución de problemas
   2.1. Calidad de reproducción de audio
   2.2. Uso de CPU
   2.3. Eco
   2.4. Problemas de entrada, salida o efectos
   2.5. Discrepancia de salida multicanal
3. Conexiones multicanal y hardware
   3.1. HDMI + receptor AV
   3.2. Interfaces sin controladores multicanal
   3.3. Retardo de canal y alineación temporal
   3.4. Límite de 8 canales y expansión
4. Preguntas frecuentes
5. Respuesta de frecuencia y corrección de sala
6. Consejos para la operación de efectos
7. Enlaces de referencia

---

## 1. Configuración inicial para streaming

Ejemplo en Windows: Spotify → VB-CABLE → EffeTune → DAC/AMP. Los conceptos son similares para otros servicios y sistemas operativos.

### 1.1. Instalación de VB-CABLE y habilitación de 96 kHz
Descargue el paquete de controladores VB-CABLE, ejecute `VBCABLE_Setup_x64.exe` como administrador y reinicie. Devuelva la salida predeterminada del sistema operativo a sus altavoces/DAC y configure los formatos de **CABLE Input** y **CABLE Output** a 24 bits, 96,000 Hz. Ejecute `VBCABLE_ControlPanel.exe` como administrador, elija **Menú▸Frecuencia de muestreo interna = 96000 Hz**, y luego haga clic en **Reiniciar motor de audio**.

### 1.2. Enrutamiento del servicio de streaming (ejemplo de Spotify)
Abra **Configuración▸Sistema▸Sonido▸Mezclador de volumen**, y configure la salida de `Spotify.exe` a **CABLE Input**. Reproduzca una pista para confirmar que no hay sonido desde los altavoces.
En macOS, utilice **SoundSource** de Rogue Amoeba para asignar la salida de Spotify a **CABLE Input** del mismo modo.

### 1.3. Configuración de audio de EffeTune
Inicie la aplicación de escritorio y abra **Configurar audio**.
- **Dispositivo de entrada:** CABLE Output (VB-Audio Virtual Cable)
- **Dispositivo de salida:** DAC/Altavoces físicos
- **Frecuencia de muestreo:** 96,000 Hz (tasas más bajas pueden degradar la calidad)

### 1.4. Comprobación de funcionamiento
Con Spotify reproduciendo, alterne el **ON/OFF** principal en EffeTune y confirme que el sonido cambia.

---

## 2. Solución de problemas

### 2.1. Problemas de calidad de reproducción de audio

| Síntoma | Solución |
| ------ | ------ |
| Cortes o fallos | Elija **Reiniciar audio** desde el menú **Configuración** o el menú de desbordamiento en móvil para reconstruir el pipeline de audio. En la aplicación de escritorio también puede usar **Ver▸Recargar**. Si es necesario, reduzca el número de efectos activos o aumente **Latencia:** en **Configuración de audio** para mejorar la estabilidad (puede afectar la sincronización con video). |
| Distorsión o recorte | Inserte **Level Meter** al final de la cadena y mantenga los niveles por debajo de 0 dBFS. Añada **Brickwall Limiter** antes del Level Meter si es necesario. |
| Aliasing por encima de 20 kHz | VB-CABLE puede seguir funcionando a 48 kHz. Revise la configuración inicial. |

### 2.2. Alto uso de CPU
Desactive los efectos que no esté utilizando o elimínelos del **Effect Pipeline**.

### 2.3. Eco
Es posible que sus dispositivos de entrada y salida estén en bucle. Asegúrese de que la salida de EffeTune no vuelve a su entrada.

### 2.4. Problemas de entrada, salida o efectos

| Síntoma | Solución |
| ------ | ------ |
| No hay entrada de audio | Asegúrese de que el reproductor envía la salida a **CABLE Input**. Permita el permiso de micrófono en el navegador y seleccione **CABLE Output** como dispositivo de entrada. |
| El efecto no funciona | Confirme que el maestro, cada efecto y cualquier **Section** están **ON**. Restablezca los parámetros si es necesario. |
| No hay salida de audio | Para la aplicación web, compruebe que las salidas del sistema operativo y del navegador apuntan a su DAC/AMP. Para la aplicación de escritorio, compruebe el dispositivo de salida en **Configurar audio**. |
| Otros reproductores informan "CABLE Input en uso" | Asegúrese de que ninguna otra aplicación está utilizando **CABLE Input**. |

### 2.5. Discrepancia de salida multicanal
EffeTune envía canales en orden 1→2→…→8. Si Windows está configurado para 4 canales, los canales traseros pueden mapearse al centro/subwoofer. **Solución alternativa:** configure el dispositivo a 7.1ch, salida 8ch desde EffeTune, y use los canales 5 y 6 para el audio trasero.

---

## 3. Conexiones multicanal y hardware

### 3.1. HDMI + receptor AV
Configure la salida HDMI de su PC a 7.1ch y conéctela a un receptor AV. EffeTune puede enviar hasta 8 canales a través de un solo cable. Los receptores más antiguos pueden degradar la calidad del sonido o reasignar canales de manera inesperada.

### 3.2. Interfaces sin controladores multicanal (p.ej., MOTU M4)
Out 1‑2 y Out 3‑4 aparecen como dispositivos separados, impidiendo la salida de 4 canales. Soluciones alternativas:
- Use **Voicemeeter** para combinar canales a través de ASIO.
- Use **ASIO Link Pro** para exponer un dispositivo virtual de 4 canales (avanzado).

### 3.3. Retardo de canal y alineación temporal
Use **MultiChannel Panel** o **Time Alignment** para retrasar canales en pasos de 10 µs (mínimo 1 muestra). Para retrasos grandes, retrase los canales frontales entre 100-400 ms. La sincronización de video debe ajustarse en el lado del reproductor.

### 3.4. Límite de 8 canales y expansión
Los controladores actuales del sistema operativo admiten hasta 8 canales. EffeTune puede soportar más canales cuando los sistemas operativos lo permitan.

---

## 4. Preguntas frecuentes

| Pregunta | Respuesta |
| ------ | ------ |
| ¿En qué dispositivos se puede usar la versión PWA? | Se puede usar en los principales entornos móviles y de escritorio, incluidos teléfonos y tablets Android, iPhone/iPad, Windows, macOS, Linux y ChromeOS. Al ser una PWA, no es una aplicación nativa específica de cada dispositivo, sino que funciona en el navegador; el método de instalación, la selección de dispositivos de entrada/salida de audio y los formatos de música compatibles dependen del navegador y del sistema operativo. |
| No puedo instalar la versión PWA | Use el botón **Instalar versión PWA** del sitio de EffeTune o, en la versión web, abra el menú de engranaje de la esquina superior derecha y elija **Instalar aplicación**. Si la opción no aparece, en Android o PC abra EffeTune con Chrome, Edge u otro navegador basado en Chrome. En iPhone/iPad, ábralo con Safari y use el menú Compartir para añadirlo a la pantalla de inicio. En navegadores integrados en otras aplicaciones, navegación privada o navegadores antiguos, puede que la opción de instalación no aparezca. |
| ¿Entrada surround (5.1ch, etc.)? | La API Web Audio limita la entrada a 2 canales. La salida y los efectos admiten hasta 8 canales. |
| ¿Longitud recomendada de la cadena de efectos? | Use tantos efectos como su CPU permita sin causar cortes o alta latencia. |
| ¿Cómo obtener la mejor calidad de sonido? | Use 96 kHz o superior, comience con ajustes sutiles, monitoree el headroom con **Level Meter**, y añada **Brickwall Limiter** si es necesario. |
| ¿Funciona con cualquier fuente? | Sí. Con un dispositivo de audio virtual puede procesar streaming, archivos locales o equipos físicos. |
| ¿Puedo usar solo el reproductor de archivos de música, sin entrada de audio? | Sí. Si al iniciar EffeTune el sonido del micrófono se filtra a los auriculares, elija **Ninguno (solo reproductor de archivos de música)** en **Dispositivo de entrada:** dentro de **Configuración de audio**. EffeTune mantiene la cadena de efectos activa con una fuente silenciosa, por lo que el reproductor y los efectos generadores de señal como **Oscillator** siguen funcionando. Si selecciona una entrada de audio, puede procesar el sonido de equipos externos conectados mediante una interfaz de audio USB o comprobar la señal de entrada con **Spectrum Analyzer**. |
| ¿La aplicación web móvil puede procesar el audio de otras aplicaciones? | Normalmente no. Los navegadores móviles no ofrecen una entrada de loopback general para el audio de otras aplicaciones, por lo que en móvil EffeTune se usa principalmente con el reproductor integrado. |
| ¿Qué formatos de archivo de música admite? | Depende de la capacidad de decodificación de audio del navegador y del sistema operativo. Como referencia, MP3, WAV y AAC/M4A suelen funcionar en muchos entornos; FLAC, OGG/Vorbis y Opus/WebM varían según el entorno. EffeTune también puede reproducir la pista de audio de un archivo MP4 sin mostrar el vídeo; su reproducción depende del códec de audio interno, y AAC es la opción compatible más habitual. Si un archivo no se reproduce, pruebe con MP3, AAC/M4A o WAV. |
| ¿Puedo reproducir varios archivos de música? | Sí. Use **Abrir archivos de música** y, en el selector de archivos estándar del dispositivo, elija varios archivos antes de abrirlos; se cargarán como una lista de reproducción. Que sea posible seleccionar varios archivos o todos los archivos de una carpeta depende del dispositivo, el navegador y el selector de archivos. |
| ¿Qué hace la Biblioteca musical? | Indexa las carpetas de música seleccionadas para que pueda explorar y buscar por pista, álbum, artista, género o subcarpeta, y reproducir los resultados en EffeTune. Guarda los metadatos de la biblioteca y las listas de reproducción en la aplicación, no en los archivos de audio. |
| ¿Dónde está disponible la Biblioteca musical? | La aplicación de escritorio incluye el escáner completo de carpetas. Los navegadores Chromium usan File System Access cuando está disponible. Safari y Firefox usan una importación alternativa, por lo que puede ser necesario volver a seleccionar carpetas o archivos tras recargar o perder permisos. |
| ¿Cómo actualizo o reconecto carpetas de la Biblioteca musical? | Use **Volver a escanear** después de añadir, eliminar o editar archivos. Si una carpeta indica que falta el acceso, use su botón **Reconectar** y conceda de nuevo acceso a la misma carpeta. |
| ¿Qué formatos de listas de reproducción puede importar o exportar la Biblioteca musical? | La Biblioteca musical puede importar listas M3U, M3U8, PLS y XSPF, y exportar listas M3U8 o XSPF. |
| ¿La Biblioteca musical modifica mis archivos de audio? | No. El escaneo, la lectura de metadatos, la caché de carátulas, la edición de listas y la reproducción se mantienen dentro de la aplicación y nunca modifican los archivos de audio en disco. |
| No puedo seleccionar el dispositivo de salida en la aplicación web | Depende de la compatibilidad del navegador y de los permisos. Pruebe en un contexto seguro con Chrome/Chromium o configure el DAC/AMP que quiere usar como salida predeterminada en el sistema operativo o el navegador. |
| ¿Por qué **Tasa de muestreo:** o **Canales de salida:** no quedan en el valor elegido? | El navegador o el dispositivo pueden redondear o ignorar valores no admitidos. EffeTune funciona con el valor que realmente queda activo. |
| ¿El reproductor web recuerda la lista de reproducción? | Se guardan los ajustes de repetición y aleatorio, pero la selección normal de archivos no se restaura tras recargar debido a las restricciones del navegador. |
| ¿Se puede reproducir en móvil con la pantalla apagada? | Depende del navegador y no se puede garantizar, especialmente en iOS. En entornos compatibles se usa Wake Lock, pero la reproducción en segundo plano no está garantizada. |
| ¿En qué se diferencian los modos de ahorro de energía de EffeTune? | Están disponibles tanto en la versión Web/PWA como en la aplicación de escritorio Electron. Se eligen en **Configuración** → **Ahorro de energía**. **Prioridad al procesamiento en segundo plano** mantiene el procesamiento de la entrada externa durante el silencio. **Ahorro de energía equilibrado (Predeterminado)** suele conservar la entrada seleccionada, pero reduce el DSP y las actualizaciones visuales durante el silencio. **Máximo ahorro de energía** también puede detener una entrada sin uso o silenciosa en segundo plano después del intervalo elegido. Cuando la ruta actual permite comprobar que es seguro, la reproducción puede seguir avanzando mientras se omite el DSP o se mantiene la salida a cero. No hay un indicador de estado independiente; **Reanudar el procesamiento de audio** o **Reanudar la entrada de audio** solo aparece en el menú cuando se requiere una acción del usuario. |
| ¿Qué cambian “Umbral de silencio” y “Detener la entrada de audio después de”? | **Umbral de silencio** (de -90 a -20 dBFS, en incrementos de 10 dB) fija el nivel de potencia medido en la entrada y la salida por debajo del cual el audio se considera silencioso; un valor más bajo reduce la probabilidad de confundir audio tenue con silencio. En **Máximo ahorro de energía**, **Detener la entrada de audio después de** (1/5/15 minutos o **Nunca**) controla únicamente la liberación del micrófono o de la entrada. Es independiente del retardo más corto que suspende un grafo sin ruta, por lo que el grafo puede quedar en Suspended mientras la entrada sigue retenida. |
| ¿“Prioridad al procesamiento en segundo plano” garantiza el procesamiento con la versión Web/PWA oculta? | No. EffeTune da prioridad a la continuidad y evita su propia suspensión automática por silencio en una ruta de entrada externa, pero el navegador y el sistema operativo aún pueden congelar, suspender o descartar una página oculta. Si **Máximo ahorro de energía** detuvo la entrada, volver a la página o recibir de nuevo una señal no solicita el permiso del micrófono de forma automática; usa **Reanudar el procesamiento de audio** mediante una acción explícita. |
| ¿Costo de receptor AV vs. interfaz? | Reutilizar un receptor AV con HDMI es simple. Para configuraciones centradas en PC, una interfaz multicanal más amplificadores pequeños ofrece buen costo y calidad. |
| No hay sonido de otras aplicaciones justo después de instalar VB-CABLE | La salida predeterminada del sistema operativo se cambió a **CABLE Input**. Cámbiela de nuevo en la configuración de sonido. |
| Solo los canales 3+4 cambian de volumen después de dividir | Coloque un efecto **Volume** después del divisor y configure **Channel** a 3+4. Si se coloca antes, todos los canales cambian. |

---

## 5. Respuesta de frecuencia y corrección de sala

### 5.1. Importación de ajustes de AutoEQ a 15Band PEQ
Desde EffeTune v1.51 o posterior, puede importar ajustes de ecualizador AutoEQ directamente desde el botón en la parte superior derecha.

### 5.2. Pegado de ajustes de corrección de medición
Copie los ajustes de 5Band PEQ desde la página de medición y péguelos en la vista **Effect Pipeline** usando **Ctrl+V** o el menú.

---

## 6. Consejos para la operación de efectos
* El flujo de señal es de arriba a abajo.
* Use el efecto **Matrix** para conversiones como 2→4ch o 8→2ch (configure **Channel = All** en el enrutamiento de bus).
* Gestione el nivel, silencio y retardo para hasta 8 canales con **MultiChannel Panel**.

---

## 7. Enlaces de referencia
* EffeTune Desktop: <https://github.com/Frieve-A/effetune/releases>
* Versión web de EffeTune: <https://effetune.frieve.com/effetune.html>
* Medición de respuesta en frecuencia: <https://effetune.frieve.com/features/measurement/measurement.html>
* VB-CABLE: <https://vb-audio.com/Cable/>
* Voicemeeter: <https://vb-audio.com/Voicemeeter/>
* ASIO Link Pro (versión fija no oficial): busque "ASIO Link Pro 2.4.1"
