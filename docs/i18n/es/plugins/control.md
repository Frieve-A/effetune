---
title: "Plugins de control - EffeTune"
description: "Plugins de control para organizar cadenas de efectos con agrupación mediante Section."
lang: es
---

# Efectos de control

Los efectos de control son utilidades especiales: no procesan el audio directamente, sino que ayudan a organizar cómo se usan otros efectos dentro de la cadena.

## Live Audio Receive

Recibe el audio en directo de otro EffeTune en esta posición. Los efectos anteriores se omiten y los posteriores procesan el sonido. La música normal se procesa desde el principio. No hay parámetros ajustables. Si falta el marcador o está desactivado, se usa toda la cadena. La señal recibida no se reenvía por Network Output.

## Live Audio Send

Envía el audio de esta posición a Network Output y lo deja pasar a los efectos locales posteriores. Coloca, por ejemplo, un EQ compartido antes y un Room EQ local después. Activa Network Output y elige los dispositivos. Sin un marcador activo se envía la salida final. Solo se usa el primer marcador activo de cada tipo; los demás indican que se usa otro. No hay parámetros ajustables.

## Section

El efecto Section agrupa varios efectos para que puedas omitir o restaurar esa parte completa de la cadena con un solo conmutador ON/OFF. Cada efecto conserva su propio estado ON/OFF.

### Resumen

- **Nombre**: Section
- **Categoría**: Control
- **Descripción**: Agrupa efectos para que toda una sección pueda omitirse o restaurarse

### Parámetros

| Parámetro | Descripción |
|-----------|-------------|
| Comment   | Nombre o descripción de la finalidad de la sección |

### Uso

1. Coloca el efecto Section al principio del grupo de efectos que quieras controlar como bloque
2. Introduce un nombre descriptivo en el campo "Comment" para identificar la finalidad de la sección
3. Cambia Section a OFF para omitir los efectos de esa sección; vuelve a ponerlo en ON para restaurarla sin cambiar el estado ON/OFF propio de cada efecto
4. Los efectos colocados después de Section pertenecen a esa sección hasta que aparece otro efecto Section

### Ejemplos de uso

- Agrupar efectos relacionados, por ejemplo "EQ Adjustments" o "Spatial Effects"
- Crear partes alternativas de una cadena que se puedan activar u omitir fácilmente
- Ordenar cadenas complejas en secciones lógicas
- Omitir temporalmente un grupo de efectos sin eliminarlo
