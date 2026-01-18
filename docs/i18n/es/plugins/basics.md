---
title: "Basic Plugins - EffeTune"
description: "Essential audio plugins including Volume, Mute, Stereo Balance, Matrix routing, and more."
lang: en
---

# Basic Audio Plugins

Una colección de herramientas esenciales para ajustar los aspectos fundamentales de la reproducción de tu música. Estos complementos te ayudan a controlar el volumen, el balance y otros aspectos básicos de tu experiencia de escucha.

## Lista de complementos

* [Channel Divider](#channel-divider) - Divide el audio en bandas de frecuencia a través de múltiples canales
* [DC Offset](#dc-offset) - Ayuda a corregir audio que suena desequilibrado
* [Matrix](#matrix) - Enruta y mezcla canales de audio con control flexible
* [MultiChannel Panel](#multichannel-panel) - Controla múltiples canales de audio con ajustes individuales
* [Mute](#mute) - Silencia la salida de audio
* [Polarity Inversion](#polarity-inversion) - Puede mejorar cómo suena la música estéreo
* [Stereo Balance](#stereo-balance) - Ajusta el balance izquierda-derecha de tu música
* [Volume](#volume) - Controla el volumen de la reproducción musical

## Channel Divider

Una herramienta especializada que divide tu señal estéreo en bandas de frecuencia separadas y dirige cada banda a diferentes canales de salida. Perfecta para sistemas multicanal o configuraciones de cruce personalizadas.

Para usar este efecto, debes utilizar la aplicación de escritorio, configurar el número de canales de salida en los ajustes de audio a 4 o más, y establecer el canal en el enrutamiento del bus de efectos en "All".

### Cuándo usarlo

* Cuando uses salidas de audio multicanal (4, 6 u 8 canales)
* Para crear un enrutamiento de canales basado en frecuencias personalizado
* Para configuraciones con múltiples amplificadores o altavoces

### Parámetros

* **Band Count** - Número de bandas de frecuencia a crear (2-4 bandas)

  * 2 bandas: división Low/High
  * 3 bandas: división Low/Mid/High
  * 4 bandas: división Low/Mid-Low/Mid-High/High

* **Crossover Frequencies** - Definen dónde se divide el audio entre bandas

  * F1: Primer punto de cruce
  * F2: Segundo punto de cruce (para 3+ bandas)
  * F3: Tercer punto de cruce (para 4 bandas)

* **Slopes** - Controlan cuán bruscamente se separan las bandas

  * Opciones: -12dB a -96dB por octava
  * Pendientes más pronunciadas ofrecen una separación más clara
  * Pendientes menores ofrecen transiciones más naturales

### Notas técnicas

* Procesa solo los dos primeros canales de entrada
* Los canales de salida deben ser múltiplos de 2 (4, 6 u 8)
* Utiliza filtros de cruce Linkwitz-Riley de alta calidad
* Gráfico de respuesta de frecuencia visual para una configuración sencilla

## DC Offset

Una utilidad que puede ayudar a corregir audio que suena desequilibrado o extraño. La mayoría de los oyentes no la necesitarán a menudo, pero es útil cuando te encuentras con audio que no suena del todo bien.

### Cuándo usarlo

* Si la música suena inusualmente desequilibrada
* Cuando un canal parece más fuerte de lo que debería
* Si otros efectos no funcionan como se espera

### Parámetros

* **Offset** - Ajusta el balance de audio (-1.0 a +1.0)

  * 0.0: Ajuste normal
  * Ajustar si algo suena mal
  * Los ajustes pequeños suelen ser los más efectivos

## Matrix

Una potente herramienta de enrutamiento de canales que te permite crear rutas de señal personalizadas entre canales de entrada y salida. Ofrece flexibilidad total en cómo se conectan y mezclan las señales de audio.

### Cuándo usarlo

* Para crear enrutamientos personalizados entre canales
* Cuando necesites mezclar o dividir señales de formas específicas
* Para diseño de sonido creativo utilizando interacciones de canales

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

### Aplicaciones prácticas

* Configuraciones personalizadas de downmix o upmix
* Aislar o combinar canales específicos
* Crear relaciones de fase entre canales
* Resolver requisitos de enrutamiento complejos

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
* Crear mezclas personalizadas para auriculares
* Alineación temporal de configuraciones multi-micrófono
* Monitorización y ajuste de fuentes de audio multicanal

## Mute

Una utilidad simple que silencia toda la salida de audio llenando el búfer con ceros. Útil para silenciar señales de audio al instante.

### Cuándo usarlo

* Para silenciar el audio al instante sin fundido
* Durante secciones silenciosas o pausas
* Para evitar la salida de ruido no deseado

## Polarity Inversion

Una herramienta que puede mejorar cómo suena la música estéreo en ciertas situaciones. Es como "voltear" la onda de audio para potencialmente mejorar su sonido.

También puedes invertir la polaridad de canales específicos limitando los canales que se procesan en la configuración común del efecto.

### Cuándo usarlo

* Cuando la música estéreo suena "vacía" o "extraña"
* Si lo combinas con otros efectos estéreo
* Cuando intentes mejorar la imagen estéreo

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
