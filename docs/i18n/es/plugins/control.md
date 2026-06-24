---
title: "Plugins de control - EffeTune"
description: "Plugins de control para organizar cadenas de efectos con agrupación mediante Section."
lang: es
---

# Efectos de control

Los efectos de control son utilidades especiales: no procesan el audio directamente, sino que ayudan a organizar cómo se usan otros efectos dentro de la cadena.

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
