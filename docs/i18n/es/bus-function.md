---
title: "Bus Function Guide - EffeTune"
description: "Learn how to use the Bus feature in EffeTune for flexible audio routing and complex effect chains."
lang: en
---

# Cómo usar la función Bus

La función Bus permite un enrutamiento flexible del audio entre efectos, posibilitando un procesamiento de audio más complejo y versátil.

## Concepto Básico

- Cada efecto permite especificar un **Bus de Entrada** que recibe la señal de audio a procesar y un **Bus de Salida** que envía el audio procesado.
- Por defecto, si no se especifica lo contrario, cada efecto utiliza el **Bus Principal** tanto para la entrada como para la salida.
- Se pueden utilizar hasta cuatro buses adicionales (**Bus 1 a Bus 4**).

![Función Bus](../../../images/bus_function.png)

## Configuración de Buses de Entrada y Salida para Efectos

- Haga clic en el **botón de Enrutamiento** ubicado a la izquierda de los botones de subir/bajar que se muestran en cada efecto.
- Al hacer clic en el botón de Enrutamiento se abre un diálogo de configuración, permitiendo la selección libre del Bus de Entrada y del Bus de Salida entre el Bus Principal o Bus 1 a Bus 4.
- Los cambios se aplican de inmediato.
- Para cerrar el diálogo, haga clic en el botón × en la esquina superior derecha o haga clic fuera del diálogo.

- Si el bus de entrada o salida se establece en Bus 1 o superior, se mostrará "Bus X→Bus Y" junto al botón de Enrutamiento.
  - Ejemplo: Al procesar audio desde Bus 2 y enviarlo a Bus 3, se mostrará "Bus 2→Bus 3".

## Mecanismo de Procesamiento de Audio

- Los efectos se procesan de forma secuencial de arriba hacia abajo.
- Cada efecto toma señales de audio del Bus de Entrada especificado, las procesa y envía el resultado al Bus de Salida.
- Si se utiliza un Bus de Entrada por primera vez, el procesamiento comienza desde el silencio.
- Si los buses de Entrada y Salida son iguales, el audio del Bus de Salida se sobrescribe con el resultado procesado.
- Si se especifican buses diferentes para la entrada y la salida, el audio procesado se añade al Bus de Salida.
- Finalmente, la reproducción del audio se realiza siempre desde el **Bus Principal**.

[← Volver al README](README.md)
