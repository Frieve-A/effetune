---
title: "FAQ & Troubleshooting - EffeTune"
description: "Frequently asked questions and troubleshooting guide for Frieve EffeTune audio processor."
lang: en
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
Descargue el paquete de controladores VB-CABLE, ejecute `VBCABLE_Setup_x64.exe` como administrador y reinicie. Devuelva la salida predeterminada del sistema operativo a sus altavoces/DAC y configure los formatos de **CABLE Input** y **CABLE Output** a 24 bits, 96,000 Hz. Ejecute `VBCABLE_ControlPanel.exe` como administrador, elija **Menu▸Internal Sample Rate = 96000 Hz**, y luego haga clic en **Restart Audio Engine**.

### 1.2. Enrutamiento del servicio de streaming (ejemplo de Spotify)
Abra **Settings▸System▸Sound▸Volume mixer**, y configure la salida de `Spotify.exe` a **CABLE Input**. Reproduzca una pista para confirmar que no hay sonido desde los altavoces.
En macOS, utilice **SoundSource** de Rogue Amoeba para asignar la salida de Spotify a **CABLE Input** del mismo modo.

### 1.3. Configuración de audio de EffeTune
Inicie la aplicación de escritorio y abra **Config Audio**.
- **Input Device:** CABLE Output (VB-Audio Virtual Cable)
- **Output Device:** DAC/Altavoces físicos
- **Sample Rate:** 96,000 Hz (tasas más bajas pueden degradar la calidad)

### 1.4. Comprobación de funcionamiento
Con Spotify reproduciendo, alterne el **ON/OFF** principal en EffeTune y confirme que el sonido cambia.

---

## 2. Solución de problemas

### 2.1. Problemas de calidad de reproducción de audio

| Síntoma | Solución |
| ------ | ------ |
| Cortes o fallos | Haga clic en el botón **Reset Audio** en la esquina superior izquierda de la aplicación web o elija **Reload** del menú **View** en la aplicación de escritorio. Reduzca el número de efectos activos si es necesario. |
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
| No hay salida de audio | Para la aplicación web, compruebe que las salidas del sistema operativo y del navegador apuntan a su DAC/AMP. Para la aplicación de escritorio, compruebe el dispositivo de salida en **Config Audio**. |
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
| ¿Entrada surround (5.1ch, etc.)? | La API Web Audio limita la entrada a 2 canales. La salida y los efectos admiten hasta 8 canales. |
| ¿Longitud recomendada de la cadena de efectos? | Use tantos efectos como su CPU permita sin causar cortes o alta latencia. |
| ¿Cómo obtener la mejor calidad de sonido? | Use 96 kHz o superior, comience con ajustes sutiles, monitoree el headroom con **Level Meter**, y añada **Brickwall Limiter** si es necesario. |
| ¿Funciona con cualquier fuente? | Sí. Con un dispositivo de audio virtual puede procesar streaming, archivos locales o equipos físicos. |
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
* Versión web de EffeTune: <https://effetune.frieve.com/features/measurement/measurement.html>
* VB-CABLE: <https://vb-audio.com/Cable/>
* Voicemeeter: <https://vb-audio.com/Voicemeeter/>
* ASIO Link Pro (versión fija no oficial): busque "ASIO Link Pro 2.4.1"
