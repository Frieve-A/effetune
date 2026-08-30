---
title: "Asignación de controladores - EffeTune"
description: "Controla los parámetros de EffeTune mediante MIDI, un mando o el teclado."
lang: es
---

# Asignación de controladores

Esta función permite ajustar parámetros sin arrastrar los controles de la pantalla. Puedes usar un controlador MIDI, un mando o teclas mientras EffeTune tenga el foco; el cambio también se refleja en la interfaz.

## Añadir una asignación

1. Abre **Settings** y elige **Asignación de controladores...**.
2. Elige **Añadir (Learn)** y mueve el control, pulsa la tecla o usa el mando.
3. Selecciona el efecto, la regla de instancia y el parámetro.
4. Si hace falta, ajusta Min, Max, Sensitivity, la dirección o el modo. Los cambios se guardan de inmediato.

Para disponer de botones separados de aumento y reducción, crea dos asignaciones: una **+** y otra **−**. Si una tecla coincide con un atajo de EffeTune, aparece un aviso y la asignación tiene prioridad mientras la aplicación tenga el foco.

Para asignaciones de botones, elige **Modo de botón**: **Alternar** cambia el estado con cada pulsación y **Momentáneo** lo mantiene activo solo mientras mantienes el control pulsado.

## Automatizar por tiempo o al azar

Elige **Añadir automatización** para cambiar un parámetro numérico sin un controlador físico. La nueva asignación empieza con **Temporizador** y un intervalo seguro de un segundo. Con **Reloj**, elige **Hora**, **Minuto** o **Segundo**, y una onda **Ascendente**, **Seno** o **Coseno**. La hora local se lee una vez por segundo y se ajusta entre Min y Max.

Con Temporizador, fija **Intervalo (segundos)** en 1 o más. **Cambiar por cantidad** suma o resta la **Cantidad** en cada evento; **Valor aleatorio del rango** elige un valor nuevo entre Min y Max; y **Paso aleatorio desde el valor actual** sube o baja desde el valor vigente.

La **Programación** ofrece **Intervalo**, **Una vez** y **Diario**. El intervalo admite de 1 a 2.147.483,647 segundos y mide el tiempo transcurrido mientras la aplicación está en ejecución. Si se retrasa, solo aplica un cambio, inicia desde ahí el siguiente intervalo y no repite eventos perdidos. Una vez usa la **Fecha** y la **Hora** locales; Diario usa la hora local y espera al día siguiente si la de hoy ya pasó. Ambos siguen el calendario y el reloj locales del equipo, incluidos los cambios manuales y el horario de verano; Diario se ejecuta como máximo una vez por fecha local. Una cita pasada aparece como **Caducado** y no se recupera; cambia la fecha o la hora a un valor futuro para activarla otra vez.

Reloj y Temporizador solo pueden controlar parámetros numéricos de efectos, no Enabled, listas, Master Bypass ni A/B Toggle. Las acciones aleatorias también están disponibles para botones o teclas físicos asignados a un parámetro numérico. Si la aplicación o el equipo retrasan un evento, se aplica un solo cambio al reanudarse y no se repiten los eventos perdidos. Una misma configuración no produce siempre la misma secuencia aleatoria.

**Primero** y **Último** eligen la primera o la última instancia coincidente. **Todos** aplica el mismo valor a todas y usa la primera como punto de partida para cambios relativos. **Enabled** activa o desactiva el efecto; **Global** ofrece Master Bypass y A/B Toggle. Min y Max limitan el recorrido y se introducen en la unidad mostrada del parámetro; intercambiarlos invierte la dirección. Empieza con Sensitivity 1.

## Fuentes de control

- **MIDI:** admite CC, notas y pitch bend mediante Web MIDI. CC empieza en modo absoluto; elige el modo relativo adecuado para un codificador sin fin. Chromium y Firefox admiten Web MIDI, Safari no. BLE-MIDI y MIDI por red funcionan si el sistema los presenta como puertos MIDI.
- **Mackie Control (MCU):** selecciona **MCU** como protocol. Se admiten faders motorizados y su contacto, V-Pot y anillos LED, y LED de botones. No se admiten texto LCD, medidores, pantalla de tiempo ni handshake. Tras cambiar entre Generic y MCU, vuelve a aprender las asignaciones.
- **Mando:** los botones avanzan o conmutan y pueden repetir al mantenerlos pulsados para valores continuos o listas. Los ejes empiezan en modo relativo, idóneo para sticks autocentrados; usa absoluto para controles que no vuelven al centro.
- **Teclado:** solo funciona con EffeTune enfocado y no actúa al escribir en campos de texto. Los toggles ignoran la repetición del sistema; las acciones de aumento y reducción sí pueden repetirse.

## Conexión y solución de problemas

Las asignaciones se conservan al desconectar y se reanudan cuando vuelve un dispositivo con el mismo nombre. Si una actualización del sistema o del controlador cambia el nombre, vuelve a aprender las asignaciones afectadas. Los mandos idénticos comparten asignaciones y los puertos MIDI con el mismo nombre solo se distinguen por el orden de conexión.

Si no aparecen dispositivos MIDI, permite el acceso MIDI a EffeTune y vuelve a abrir el cuadro. En Safari siguen disponibles el teclado y el mando.
