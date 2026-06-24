---
title: "Plugins básicos - EffeTune"
description: "Plugins de audio esenciales, incluidos Volume, Mute, Stereo Balance, enrutamiento Matrix y más."
lang: es
---

# Plugins básicos de audio

Una colección de herramientas esenciales para ajustar los aspectos fundamentales de la reproducción de tu música. Estos complementos te ayudan a controlar el volumen, el balance y otros aspectos básicos de tu experiencia de escucha.

## Lista de complementos

* [Channel Divider](#channel-divider) - Divide audio estéreo en bandas de frecuencia a través de pares de salida estéreo
* [DC Offset](#dc-offset) - Añade o corrige un desplazamiento DC constante
* [Matrix](#matrix) - Enruta y mezcla canales de audio con control flexible
* [MultiChannel Panel](#multichannel-panel) - Controla múltiples canales de audio con ajustes individuales
* [Mute](#mute) - Silencia la salida de audio
* [Polarity Inversion](#polarity-inversion) - Invierte la polaridad de la señal para corrección o casos especiales de enrutamiento
* [Stereo Balance](#stereo-balance) - Ajusta el balance izquierda-derecha de tu música
* [Volume](#volume) - Controla qué tan fuerte se reproduce la música

## Channel Divider

Una herramienta especializada que divide tu señal estéreo en bandas de frecuencia separadas y dirige cada banda a un par de salida estéreo distinto. Es útil para configuraciones con varios amplificadores, varios altavoces o crossovers personalizados.

Para usar este efecto, debes utilizar la aplicación de escritorio, configurar el número de canales de salida en los ajustes de audio a 4, 6 u 8 según el número de bandas, y establecer el canal en el enrutamiento del bus de efectos en "All".

### Cuándo usarlo

* Cuando uses salidas de audio multicanal (4, 6 u 8 canales)
* Para crear un enrutamiento de canales basado en frecuencias personalizado
* Para configuraciones con múltiples amplificadores o altavoces

### Parámetros

* **Band Count** - Número de bandas de frecuencia a crear (2-4 bandas)

  * 2 bandas: división Low/High, requiere 4 canales de salida
  * 3 bandas: división Low/Mid/High, requiere 6 canales de salida
  * 4 bandas: división Low/Mid-Low/Mid-High/High, requiere 8 canales de salida
  * Los conteos de banda más altos no están disponibles si el número de canales de salida seleccionado es demasiado bajo

* **Crossover Frequencies** - Definen dónde se divide el audio entre bandas

  * F1: Primer punto de cruce
  * F2: Segundo punto de cruce (para 3+ bandas)
  * F3: Tercer punto de cruce (para 4 bandas)
  * Cada crossover se puede ajustar de 10 Hz a 40000 Hz
  * El plugin mantiene F1, F2 y F3 en orden ascendente con al menos 1 Hz de separación

* **Slopes** - Controlan cuán bruscamente se separan las bandas

  * Opciones: -12dB a -96dB por octava
  * Pendientes más pronunciadas ofrecen una separación más clara
  * Pendientes menores ofrecen transiciones más naturales

### Notas técnicas

* Procesa solo los dos primeros canales de entrada
* Los canales de salida deben ser múltiplos de 2 (4, 6 u 8)
* Cada banda conserva el par estéreo original: en modo de 2 bandas, Low sale por los canales 1-2 y High por 3-4; en modo de 3 bandas se usan 1-2, 3-4 y 5-6; en modo de 4 bandas se usan 1-2, 3-4, 5-6 y 7-8
* Utiliza filtros de cruce Linkwitz-Riley de alta calidad
* Gráfico de respuesta de frecuencia visual para una configuración sencilla

## DC Offset

Una utilidad para corregir una señal cuya forma de onda está desplazada respecto a la línea cero. La mayoría de los oyentes deberían dejarla en 0.0, pero puede ayudar con archivos poco habituales o cadenas de procesamiento que contienen desplazamiento DC.

### Cuándo usarlo

* Cuando el audio tiene un sesgo DC constante o causa clics/problemas de margen después de otros procesamientos
* Cuando una herramienta de diagnóstico o medidor muestra que la forma de onda está desplazada respecto a cero
* Déjalo en 0.0 para escucha normal

### Parámetros

* **Offset** - Añade un valor constante a cada muestra (-1.0 a +1.0)

  * 0.0: Sin desplazamiento
  * Los valores positivos desplazan la señal hacia arriba
  * Los valores negativos desplazan la señal hacia abajo
  * Usa ajustes muy pequeños cuando haga falta corregir

## Matrix

Una herramienta de enrutamiento de canales para corregir distribuciones poco habituales de altavoces o auriculares, intercambiar canales, combinar canales o enviar un canal a más de una salida disponible.

### Cuándo usarlo

* Para crear enrutamientos personalizados entre canales
* Cuando necesites mezclar o dividir señales de formas específicas
* Cuando la reproducción izquierda/derecha o multicanal sale por altavoces incorrectos
* Para combinar estéreo a mono o duplicar un canal en otra salida disponible

### Funciones

* Matriz de enrutamiento flexible para hasta 8 canales
* Control individual de conexión entre cualquier par entrada/salida
* Opciones de inversión de fase para cada conexión
* Interfaz de matriz visual para una configuración intuitiva

### Cómo funciona

* Cada punto de conexión representa el enrutamiento de una fila de entrada a una columna de salida
* Las conexiones activas permiten que la señal fluya entre canales
* La opción de inversión de fase invierte la polaridad de la señal
* Varias conexiones de entrada a una salida se mezclan juntas
* Cuando varias entradas se envían a la misma salida, sus niveles se suman, así que puede que tengas que bajar el volumen
* Matrix no crea canales de salida adicionales por sí mismo; enruta audio dentro de los canales disponibles actualmente

### Aplicaciones prácticas

* Downmix, intercambio de canales o enrutamiento personalizado dentro de los canales disponibles
* Combinar izquierda y derecha en mono
* Duplicar un canal en otra salida disponible
* Corregir distribuciones de reproducción multicanal poco habituales

## MultiChannel Panel

Un panel de control completo para gestionar múltiples canales de audio individualmente. Este complemento proporciona control total sobre volumen, silencio, solo y retardo para hasta 8 canales, con un medidor de nivel visual para cada canal.

### Cuándo usarlo

* Al trabajar con audio multicanal (hasta 8 canales)
* Para crear un balance de volumen personalizado entre diferentes canales
* Cuando necesites aplicar retardo individual a canales específicos
* Para monitorizar niveles en múltiples canales simultáneamente

### Funciones

* Control individual para hasta 8 canales de audio
* Medidores de nivel en tiempo real con retención de picos para monitorización visual
* Capacidad de enlace entre canales para cambios de parámetros agrupados

### Parámetros

#### Controles por canal

* **Mute (M)** - Silencia canales individuales
  * Activación/desactivación para cada canal
  * Funciona en conjunto con la función solo

* **Solo (S)** - Aísla canales individuales
  * Cuando cualquier canal está en solo, sólo los canales en solo se reproducen
  * Se pueden establecer múltiples canales en solo simultáneamente

* **Volume** - Ajusta el volumen de canales individuales (-20dB a +10dB)
  * Control preciso con deslizador o entrada directa de valores
  * Los canales enlazados mantienen el mismo volumen

* **Delay** - Añade retardo temporal a canales individuales (0-30ms)
  * Control preciso de retardo en milisegundos
  * Útil para alineación temporal entre canales
  * Permite ajuste de fase entre canales

#### Enlace de canales

* **Link** - Conecta canales adyacentes para control sincronizado
  * Los cambios en un canal enlazado afectan a todos los canales conectados
  * Mantiene ajustes consistentes en grupos de canales enlazados
  * Útil para pares estéreo o grupos de múltiples canales

### Monitorización visual

* Los medidores de nivel en tiempo real muestran la intensidad actual de la señal
* Los indicadores de retención de picos muestran los niveles máximos
* Lectura numérica clara de los niveles de pico en dB
* Medidores con código de color para fácil reconocimiento de niveles:
  * Verde: Niveles seguros
  * Amarillo: Aproximándose al máximo
  * Rojo: Cerca o en el nivel máximo

### Aplicaciones prácticas

* Equilibrar sistemas de sonido envolvente
* Equilibrar reproducción surround o con varios altavoces
* Ajustar el tiempo de los altavoces cuando están a distintas distancias
* Silenciar o poner en solo temporalmente altavoces individuales durante la configuración
* Enlazar pares estéreo o grupos de altavoces para ajustarlos con más facilidad

## Mute

Una utilidad simple que silencia toda la salida de audio llenando el búfer con ceros. Útil para silenciar señales de audio al instante.

### Cuándo usarlo

* Para silenciar el audio al instante sin fundido
* Durante secciones silenciosas o pausas
* Para evitar la salida de ruido no deseado

## Polarity Inversion

Una utilidad que invierte la polaridad de la señal de audio. Invertir todos los canales normalmente no cambia lo que oyes por sí solo, pero puede ayudar cuando un altavoz, cable o canal parece estar cableado con polaridad opuesta.

Para corregir una posible falta de coincidencia de polaridad izquierda/derecha o multicanal, limita los canales procesados en los ajustes comunes de enrutamiento del efecto e invierte solo el canal afectado.

### Cuándo usarlo

* Cuando la imagen central suena débil, hueca o demasiado extendida porque un canal podría tener polaridad opuesta
* Cuando compruebas o corriges la polaridad de altavoces, cables o canales en una configuración de reproducción
* Cuando lo combinas con enrutamiento o efectos estéreo que necesitan invertir la polaridad de un canal

## Stereo Balance

Te permite ajustar cómo se distribuye la música entre tus altavoces o auriculares izquierdo y derecho. Perfecto para corregir un estéreo desequilibrado o crear tu colocación de sonido preferida.

### Guía de mejora de escucha

* Balance perfecto:

  * Posición centrada para estéreo natural
  * Volumen igual en ambos oídos
  * Ideal para la mayoría de la música

* Balance ajustado:

  * Compensar la acústica de la sala
  * Ajustar según diferencias auditivas
  * Crear escenario de sonido preferido

### Parámetros

* **Balance** - Controla la distribución izquierda-derecha (-100% a +100%)

  * Center (0%): Igual en ambos lados
  * Left (-100%): Más sonido en izquierda
  * Right (+100%): Más sonido en derecha

### Visualización

* Control deslizante fácil de usar
* Visualización clara de números
* Indicador visual de posición estéreo

### Usos recomendados

1. Escucha general

   * Mantén el balance centrado (0%)
   * Ajusta si el estéreo se siente desequilibrado
   * Utiliza ajustes sutiles

2. Escucha con auriculares

   * Ajusta finamente para mayor comodidad
   * Compensa las diferencias auditivas
   * Crea una imagen estéreo preferida

3. Escucha en altavoces

   * Ajusta según la configuración de la sala
   * Equilibra para la posición de escucha
   * Compensa la acústica de la sala

## Volume

Un control simple pero esencial que te permite ajustar cuán alto se reproduce tu música. Perfecto para encontrar el nivel de escucha adecuado para diferentes situaciones.

### Guía de mejora de escucha

* Ajusta para diferentes escenarios de escucha:

  * Música de fondo mientras trabajas
  * Sesiones de escucha activa
  * Escucha tranquila a altas horas de la noche

* Mantén el volumen en niveles cómodos para evitar:

  * Fatiga auditiva
  * Distorsión del sonido
  * Posible daño auditivo

### Parámetros

* **Volume** - Controla la sonoridad general (-60dB a +24dB)

  * Valores bajos: reproducción más suave
  * Valores altos: reproducción más alta
  * 0dB: Nivel de volumen original

Recuerda: Estos controles básicos son la base de un buen sonido. Comienza con estos ajustes antes de usar efectos más complejos!
