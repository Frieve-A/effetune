---
title: "Otros plugins - EffeTune"
description: "Plugins de utilidad adicionales, incluido Oscillator para generar señales de prueba."
lang: es
---

# Otras herramientas de audio

Una colección de herramientas de audio especializadas y generadores que complementan las categorías principales de efectos. Estos plugins son útiles para comprobar altavoces, auriculares, balance de canales y comportamiento de reproducción antes o durante la escucha.

## Lista de Plugins

- [Oscillator](#oscillator) - Generador de tonos y ruido de prueba para comprobar altavoces y auriculares

## Oscillator

Un generador de tonos y ruido de prueba para comprobar tu sistema de escucha. Úsalo a niveles bajos para confirmar la salida de altavoces o auriculares, la posición izquierda/derecha, el balance de nivel, vibraciones, zumbidos o problemas sencillos de respuesta en frecuencia.

El tono o ruido generado se mezcla en la ruta de audio actual en lugar de sustituir la entrada. Baja Volume antes de activarlo, sobre todo si ya se está reproduciendo música.

### Características
- Múltiples tipos de forma de onda:
  - Onda sinusoidal pura para comprobaciones de tono sencillas
  - Onda cuadrada para contenido armónico rico
  - Onda triangular para armónicos más suaves
  - Onda de sierra para timbres brillantes
  - Ruido blanco para comprobaciones de banda ancha en altavoces o auriculares
  - Ruido rosa para un balance de ruido más suave y natural
- Modo de operación pulsado para tonos intermitentes o ráfagas de ruido

### Parámetros
- **Frequency (Hz)** - Controla el tono de la señal generada (20 Hz a 96 kHz)
  - Frecuencias bajas: Tonos graves profundos
  - Frecuencias medias: Rango musical
  - Frecuencias altas: Úsalas con cuidado y solo a niveles de escucha seguros
  - Se aplica solo a Sine, Square, Triangle y Sawtooth; está desactivado para White Noise y Pink Noise
  - La salida de alta frecuencia disponible depende de la frecuencia de muestreo de audio actual; los tonos por encima de la frecuencia de Nyquist utilizable se silencian
- **Volume (dB)** - Ajusta el nivel de salida (-96 dB a 0 dB)
  - Empieza bajo y sube lentamente
  - Los valores altos pueden sonar fuertes o cansar el oído
- **Panning (L/R)** - Controla la ubicación estéreo
  - Centro: Igual en ambos canales
  - Izquierda/Derecha: Comprobación de enrutamiento y balance de canales
- **Waveform Type** - Selecciona el tipo de señal
  - Sine: Tono de referencia limpio
  - Square: Rico en armónicos impares
  - Triangle: Contenido armónico más suave
  - Sawtooth: Serie armónica completa
  - White Noise: Energía igual por Hz; Frequency no le afecta
  - Pink Noise: Energía igual por octava; Frequency no le afecta
- **Mode** - Controla el patrón de generación de señal
  - Continuous: Generación de señal continua sin interrupciones
  - Pulsed: Señal intermitente con temporización controlable
- **Interval (ms)** - Tiempo entre ráfagas de pulsos en modo pulsado (100-2000 ms, paso 10 ms)
  - Intervalos cortos: Secuencias de pulsos rápidas
  - Intervalos largos: Pulsos ampliamente espaciados
  - Solo activo cuando Mode está establecido en Pulsed
- **Width (ms)** - Tiempo de rampa del pulso en modo pulsado (2-100 ms, limitado a la mitad de Interval, paso 1 ms)
  - Controla el tiempo de entrada/salida gradual de cada pulso
  - El pulso generado dura aproximadamente el doble de Width, sin una sección sostenida plana
  - Anchuras cortas: Bordes de pulso nítidos
  - Anchuras largas: Transiciones de pulso más suaves
  - Solo activo cuando Mode está establecido en Pulsed

### Ejemplos de Uso

1. Comprobación de altavoces o auriculares
   - Comprobar la reproducción básica de frecuencias
     * Usar barrido de onda sinusoidal de frecuencias bajas a altas
     * Notar dónde el sonido se vuelve inaudible o distorsionado
   - Escuchar vibraciones, zumbidos o resonancias ásperas
     * Usar primero un Volume bajo
     * Probar un rango de frecuencias cada vez
   - Comparar la salida izquierda y derecha
     * Poner Panning totalmente a la izquierda y a la derecha
     * Confirmar que cada lado suena desde el altavoz o driver esperado

2. Balance de canales y nivel
   - Comprobar la posición estéreo
     * Usar una onda sinusoidal centrada o ruido rosa
     * Confirmar que el sonido aparece centrado
   - Comparar el volumen izquierdo y derecho
     * Enviar la señal a cada lado con el mismo Volume
     * Ajustar tu sistema de reproducción si un lado parece más fuerte
   - Comprobar cadenas de plugins
     * Colocar Oscillator antes o después de otros efectos para oír cómo la cadena trata una señal sencilla

3. Comprobaciones rápidas de resonancia de sala o escritorio
   - Encontrar acumulaciones de graves o vibraciones evidentes
     * Usar tonos sinusoidales graves a niveles seguros
     * Moverse alrededor de la posición de escucha y notar picos o caídas fuertes
   - Comprobar objetos propensos a vibrar
     * Barrer lentamente por frecuencias graves y medio-graves
     * Reducir Volume de inmediato si algo vibra con fuerza

4. Comprobaciones de balance con ruido
   - Usar Pink Noise como referencia amplia y estable
     * Escuchar desequilibrios evidentes entre izquierda/derecha o de tono
     * Mantener el nivel cómodo y evitar ruido fuerte durante mucho tiempo
   - Usar White Noise solo cuando necesites una señal de banda ancha más brillante

5. Comprobaciones de señal pulsada
   - Usar el modo Pulsed para que las ráfagas cortas sean más fáciles de identificar
     * Los intervalos más largos hacen que cada ráfaga se oiga por separado con más claridad
     * Los valores de Width más cortos crean comienzos y finales más definidos
     * Comparar el comportamiento a diferentes niveles de volumen

Recuerda: Oscillator es un generador de señales de prueba. Empieza con Volume bajo, súbelo gradualmente y evita tonos fuertes o de alta frecuencia que puedan dañar el equipo o fatigar el oído.
