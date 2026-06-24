---
title: "Plugins de delay - EffeTune"
description: "Plugins de efecto delay, incluidos Delay estándar y Time Alignment para ajustes precisos de tiempo."
lang: es
---

# Plugins de Delay

Una colección de herramientas para ajustar la sincronización de tus señales de audio o añadir repeticiones distintivas. Estos plugins te ayudan a afinar la alineación temporal de tu audio, crear ecos rítmicos o añadir una sensación de espacio y profundidad a tu experiencia auditiva.

## Lista de Plugins

- [Delay](#delay) - Crea ecos con control sobre el tiempo, tono y dispersión estéreo.
- [Time Alignment](#time-alignment) - Ajusta con precisión el tiempo de reproducción para alinear altavoces y posición de escucha

## Delay

Este efecto añade ecos distintivos a tu audio. Puedes controlar la rapidez con la que se repiten los ecos, cómo se desvanecen y cómo se dispersan entre tus altavoces, permitiéndote añadir una profundidad sutil, interés rítmico o efectos espaciales creativos a tu reproducción de música.

### Guía de Experiencia Auditiva

- **Profundidad y Espacio Sutiles:**
  - Añade una suave sensación de espacio sin enturbiar el sonido.
  - Puede hacer que las voces o los instrumentos principales se sientan ligeramente más grandes o presentes.
  - Usa tiempos de delay cortos y bajo feedback/mix.
- **Mejora Rítmica:**
  - Crea ecos que se sincronizan con el tempo de la música (ajustado manualmente).
  - Añade ritmo y energía, especialmente a la música electrónica, baterías o guitarras.
  - Experimenta con diferentes tiempos de delay (p. ej., igualando corcheas o negras de oído).
- **Eco Slapback:**
  - Un eco muy corto y único, usado a menudo en voces o guitarras en rock y country.
  - Añade un efecto percusivo de duplicación.
  - Usa tiempos de delay muy cortos (30-120ms), feedback cero y mix moderado.
- **Dispersión Estéreo Creativa:**
  - Usando el control Ping-Pong, los ecos pueden rebotar entre los altavoces izquierdo y derecho.
  - Crea una imagen estéreo más amplia y atractiva.
  - Puede hacer que el sonido se sienta más dinámico e interesante.

### Parámetros

- **Pre-Delay (ms)** - Añade tiempo extra antes de que la señal entre al delay de eco (0 a 100 ms). El primer eco se oye después de Pre-Delay + Delay Size.
  - Valores bajos (0-20ms): El patrón de eco empieza casi inmediatamente.
  - Valores altos (20-100ms): Añade un espacio notable antes del patrón de eco, separándolo del sonido original.
- **Delay Size (ms)** - El tiempo entre cada eco (1 a 5000 ms).
  - Corto (1-100ms): Crea efectos de engrosamiento o 'slapback'.
  - Medio (100-600ms): Efectos de eco estándar, buenos para la mejora rítmica.
  - Largo (600ms+): Ecos distintivos y muy espaciados.
  - *Consejo:* Intenta seguir el ritmo de la música con los dedos para encontrar un tiempo de delay que se sienta rítmico.
- **Damping (%)** - Controla cuánto se desvanecen las frecuencias altas y bajas con cada eco (0 a 100%).
  - 0%: Los ecos mantienen su tono original (más brillante).
  - 50%: Un desvanecimiento natural y equilibrado.
  - 100%: Los ecos se vuelven significativamente más oscuros y delgados rápidamente (más apagados).
  - Usar junto con High/Low Damp.
- **High Damp (Hz)** - Establece la frecuencia por encima de la cual los ecos empiezan a perder brillo (20 a 20000 Hz).
  - Valores bajos (p. ej., 2000Hz): Los ecos se oscurecen rápidamente.
  - Valores altos (p. ej., 10000Hz): Los ecos permanecen brillantes por más tiempo.
  - Ajustar con Damping para el control tonal de los ecos.
- **Low Damp (Hz)** - Establece la frecuencia por debajo de la cual los ecos empiezan a perder cuerpo (20 a 20000 Hz).
  - Valores bajos (p. ej., 50Hz): Los ecos retienen más graves.
  - Valores altos (p. ej., 500Hz): Los ecos se vuelven más delgados rápidamente.
  - Ajustar con Damping para el control tonal de los ecos.
  - Para un modelado tonal predecible, mantén Low Damp por debajo de High Damp. Si los valores se cruzan, el procesador los ordena internamente.
- **Feedback (%)** - Cuántos ecos escuchas, o cuánto duran (0 a 99%).
  - 0%: Solo se escucha un eco.
  - 10-40%: Unas pocas repeticiones notables.
  - 40-70%: Colas de ecos más largas y que se desvanecen.
  - 70-99%: Colas muy largas, acercándose a la auto-oscilación (¡usar con cuidado!).
- **Ping-Pong (%)** - Controla cómo rebotan los ecos entre los canales estéreo (0 a 100%). (Solo afecta la reproducción estéreo).
  - 0%: Delay estándar - el eco de la entrada izquierda en la izquierda, el de la derecha en la derecha.
  - 50%: Feedback mono - los ecos se centran entre los altavoces.
  - 100%: Ping-Pong completo - los ecos alternan entre los altavoces izquierdo y derecho.
  - Los valores intermedios crean grados variables de dispersión estéreo.
- **Mix (%)** - Equilibra el volumen de los ecos con el sonido original (0 a 100%).
  - 0%: Sin efecto.
  - 5-15%: Profundidad o ritmo sutil.
  - 15-30%: Ecos claramente audibles (buen punto de partida).
  - 30%+: Efecto más fuerte y pronunciado. El valor predeterminado es 16%.

### Configuraciones Recomendadas para la Mejora Auditiva

1.  **Profundidad Sutil Vocal/Instrumental:**
    - Delay Size: 80-150ms
    - Feedback: 0-15%
    - Mix: 8-16%
    - Ping-Pong: 0% (o prueba 20-40% para una ligera amplitud)
    - Damping: 40-60%
2.  **Mejora Rítmica (Electrónica/Pop):**
    - Delay Size: Intenta igualar el tempo de oído (p. ej., 120-500ms)
    - Feedback: 20-40%
    - Mix: 15-25%
    - Ping-Pong: 0% o 100%
    - Damping: Ajusta al gusto (más bajo para repeticiones más brillantes)
3.  **Slapback Rock Clásico (Guitarras/Voces):**
    - Delay Size: 50-120ms
    - Feedback: 0%
    - Mix: 15-30%
    - Ping-Pong: 0%
    - Damping: 20-40%
4.  **Ecos Estéreo Amplios (Ambient/Pads):**
    - Delay Size: 300-800ms
    - Feedback: 40-60%
    - Mix: 20-35%
    - Ping-Pong: 70-100%
    - Damping: 50-70% (para colas más suaves)

### Guía de Inicio Rápido

1.  **Establecer el Tiempo:**
    - Comienza con `Delay Size` para establecer el ritmo principal del eco.
    - Ajusta `Feedback` para controlar cuántos ecos escuchas.
    - Usa `Pre-Delay` para añadir un espacio extra antes de que empiece el patrón de eco.
2.  **Ajustar el Tono:**
    - Usa `Damping`, `High Damp` y `Low Damp` juntos para dar forma a cómo suenan los ecos mientras se desvanecen. Comienza con Damping alrededor del 50% y ajusta las frecuencias de Damp.
3.  **Posición en Estéreo (Opcional):**
    - Si escuchas en estéreo, experimenta con `Ping-Pong` para controlar la amplitud de los ecos.
4.  **Mezclar:**
    - Usa `Mix` para equilibrar el volumen del eco con la música original. Comienza bajo (alrededor del 16%) y aumenta hasta que el efecto se sienta bien.

## Time Alignment

Ajusta el tiempo de reproducción en pequeñas cantidades. Es útil cuando quieres compensar diferencias de distancia entre altavoces o afinar cómo llega el sonido a tu posición de escucha.

### Cuándo Usar
- Compensar pequeñas diferencias de distancia entre los altavoces y tu posición de escucha
- Ajustar con precisión el tiempo de los canales enrutados a través de este plugin
- Comprobar si un pequeño retardo hace que la imagen estéreo se sienta más estable o natural

### Parámetros
- **Delay** - Controla el tiempo de retardo aplicado a los canales enrutados a través de este plugin (0 a 100 ms)
  - 0 ms: Sin retardo
  - Valores pequeños: Útiles para compensar diferencias mínimas de llegada entre altavoces
  - Valores más altos: Crean un desplazamiento temporal más perceptible

### Usos Recomendados

1. Compensación de Distancia de Altavoces
   - Añade un pequeño retardo cuando un altavoz o canal llega antes a la posición de escucha
   - Ajusta en pasos pequeños mientras escuchas voces centradas u otros sonidos enfocados

2. Ajuste Fino de la Posición de Escucha
   - Prueba primero valores muy pequeños
   - Detente cuando la imagen central se sienta estable y el sonido siga siendo natural

Recuerda: El objetivo es mejorar tu disfrute auditivo. Experimenta con los controles para encontrar sonidos que añadan interés y profundidad a tu música favorita sin sobrecargarla.
