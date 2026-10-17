---
title: "Asignación de controladores - Control con MIDI, gamepad y teclado - EffeTune"
description: "Controla los parámetros de efectos de EffeTune desde controladores MIDI, mandos y el teclado."
lang: es
---

# Asignación de controladores

La asignación de controladores permite ajustar parámetros de efectos sin arrastrar los controles en pantalla. Puedes usar un controlador MIDI, un mando o teclas del teclado mientras EffeTune tenga el foco. Los cambios usan los mismos rangos que la interfaz del efecto y se reflejan en pantalla.

## Añadir una asignación

1. Abre **Configuración** y elige **Asignación de controladores...**.
2. Elige **Añadir (Learn)**.
3. Mueve un control MIDI, pulsa una tecla o acciona un botón o eje del mando.
4. Selecciona el efecto de destino, la regla de instancia y el parámetro.
5. Ajusta Mín., Máx., Sensibilidad, la dirección o el modo de entrada si es necesario. Los cambios se guardan de inmediato.

Usa dos asignaciones cuando quieras botones o teclas separados para aumentar y reducir. Ajusta **Dirección** en **Aumentar (+)** en una y en **Reducir (−)** en la otra. Si una tecla aprendida ya es un atajo de EffeTune, el cuadro de diálogo muestra un aviso; la asignación tiene prioridad mientras la aplicación tenga el foco.

En asignaciones de botones, elige **Modo de botón**: **Alternar** cambia el estado en cada pulsación y **Momentáneo** lo mantiene activo solo mientras mantienes pulsado el control.

## Elegir el objetivo

- **Primero** controla el primer efecto coincidente del pipeline actual.
- **Último** controla el último efecto coincidente.
- **Todos** envía el mismo valor a todos los efectos coincidentes, tomando el primero como valor inicial en cambios relativos.
- **Activado** activa o desactiva un efecto.

**Global** controla la aplicación y el reproductor de música en lugar de un efecto: **Bypass maestro**, **Cambio A/B**, **Reproducir/Pausar**, **Detener**, **Pista siguiente/anterior**, **Avanzar/retroceder 10 s**, **Velocidad de reproducción**, **Mantener el tono**, **Repetir**, **Aleatorio** y **Preset siguiente/anterior**.

- En **Pista siguiente/anterior**, **Avanzar/retroceder 10 s** y **Preset siguiente/anterior**, **Dirección** fija **Aumentar (+)** (avanzar) o **Reducir (−)** (retroceder). Un codificador sin fin o una rueda jog sigue el sentido de giro.
- **Velocidad de reproducción** cambia de forma continua con un fader o potenciómetro (`1x` en el centro), o avanza por velocidades estándar al asignarse a un botón o tecla.
- **Preset siguiente/anterior** recorre los preajustes de usuario por orden de nombre y vuelve al principio al llegar al final.
- Las acciones del reproductor requieren que el reproductor de música esté abierto. Si las reglas de reproducción automática del navegador bloquean el inicio del audio, pulsa primero Reproducir en el reproductor.

**Mín.** y **Máx.** limitan el rango activo del parámetro (en la unidad del parámetro); intercámbialos para invertir el sentido del control. **Sensibilidad** escala el tamaño del paso relativo (empieza en `1`).

## Automatizar por tiempo o al azar

Elige **Añadir automatización** cuando quieras que un parámetro numérico de un efecto cambie automáticamente sin un controlador físico. Selecciona primero el efecto y el parámetro de destino y luego configura estos controles:

- **Fuente**: Elige **Temporizador** (predeterminado, intervalo de 1 segundo) o **Reloj**.
- **Reloj**: **Parte de la hora** selecciona **Hora**, **Minuto** o **Segundo**, y **Onda** selecciona **Ascendente**, **Seno** o **Coseno**. La hora local actual se lee una vez por segundo y se asigna entre **Mín.** y **Máx.**.
- **Temporizador**: **Programación** ofrece **Intervalo**, **Una vez** y **Diario**. **Intervalo** usa **Intervalo (segundos)** de `1` a `2.147.483,647` segundos. **Una vez** se activa en una **Fecha** y **Hora** locales; **Diario** se activa a una **Hora** local una vez por día natural.
- **Acción** (Temporizador y botones o teclas asignados a parámetros numéricos): **Cambiar por cantidad** suma o resta la **Cantidad** cada vez, **Valor aleatorio del rango** elige un valor nuevo entre **Mín.** y **Máx.**, y **Paso aleatorio desde el valor actual** sube o baja al azar según la **Cantidad**.

Las automatizaciones de Reloj y Temporizador solo se aplican a parámetros numéricos de efectos (no a **Activado**, listas ni operaciones de **Global**) y se ejecutan como máximo una vez por segundo. Si la aplicación o el equipo están en pausa o en reposo cuando vence un temporizador de **Intervalo**, EffeTune aplica un único paso al reanudarse e inicia desde ahí el siguiente intervalo. Una programación **Una vez** cuya hora haya pasado mientras EffeTune estaba cerrado se marca como **Caducado**; establece una **Fecha** u **Hora** futuras para volver a activarla.

### Ejemplos prácticos

- Radius de Vinyl Simulator: Usa **Temporizador**, fija **Intervalo (segundos)** en `1`, elige **Cambiar por cantidad**, ajusta **Dirección** en **Reducir (−)** y **Cantidad** en `1 mm`, y ajusta **Mín.** y **Máx.** en `60` y `146 mm` para que la aguja avance desde el borde exterior hasta el surco interior y se detenga en **Mín.**.
- Variación tonal según la hora: Usa **Reloj** con **Minuto** y **Seno** para recorrer suavemente un parámetro numérico de Radio Simulator entre **Mín.** y **Máx.**
- Deriva aleatoria lenta: Usa **Temporizador** con un intervalo más largo y **Paso aleatorio desde el valor actual**, empezando con una **Cantidad** pequeña para que los cambios sean graduales.
- Cambio programado: Selecciona **Una vez** para una fecha y hora locales concretas, o **Diario** para la misma hora local todos los días.

## Tipos de entrada

### MIDI

EffeTune admite MIDI CC, notas y pitch bend mediante Web MIDI (disponible en navegadores basados en Chromium, Firefox y la aplicación de escritorio; no compatible con Safari). Los dispositivos genéricos usan CC absoluto de forma predeterminada; selecciona un modo relativo para codificadores sin fin. BLE-MIDI y MIDI en red funcionan cuando el sistema operativo los expone como puertos MIDI.

### Mackie Control (MCU)

Configura el protocolo del dispositivo en **MCU** para superficies de control compatibles. Se admiten faders motorizados, contacto de fader, entrada V-Pot, anillos LED y LED de botones (no se usan texto LCD, medidores de nivel, pantallas de código de tiempo ni handshakes de dispositivo). Vuelve a aprender las asignaciones tras cambiar un dispositivo entre **Generic** y **MCU**.

### Mando

Los botones pueden alternar o avanzar parámetros por pasos y repetirse al mantenerlos pulsados. Los ejes usan modo relativo de forma predeterminada para que los sticks autocentrados dejen el parámetro donde lo sueltes; cambia a modo absoluto en ejes tipo acelerador que mantienen su posición.

### Teclado

Las asignaciones de teclado funcionan mientras EffeTune tiene el foco y se ignoran al escribir en campos de texto. Las asignaciones de conmutación ignoran la repetición de teclas, mientras que las de aumento y reducción se repiten al mantenerlas pulsadas, a la velocidad de repetición de teclas del sistema operativo.

## Conexión y solución de problemas

Cada dispositivo MIDI muestra **Conectado** o **Desconectado** debajo de su nombre. Las asignaciones se conservan al desconectar un controlador y se reconectan automáticamente cuando vuelve un dispositivo con el mismo puerto MIDI o nombre de mando. Si una actualización del controlador o del sistema operativo cambia el nombre del dispositivo, vuelve a aprender las asignaciones afectadas. Los mandos con el mismo nombre comparten asignaciones, y los puertos MIDI con el mismo nombre solo se distinguen por el orden en que se conectan. Si no aparecen dispositivos MIDI, concede permiso MIDI y vuelve a abrir **Asignación de controladores...**. En Safari puedes seguir usando asignaciones de teclado y de mando.

[← Volver al README](README.md)
