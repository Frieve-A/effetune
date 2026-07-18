---
title: "Plugins lo-fi - EffeTune"
description: "Plugins de efecto lo-fi, incluidos Bit Crusher, Noise Blender, Vinyl Artifacts y más."
lang: es
---

# Plugins Lo-Fi

Una colección de plugins que agregan carácter vintage y cualidades nostálgicas a tu música. Estos efectos pueden hacer que la música digital moderna suene como si se reprodujera a través de equipos clásicos o darle ese popular sonido "lo-fi" que es tanto relajante como atmosférico.

## Lista de Plugins

- [Bit Crusher](#bit-crusher) - Crea sonidos retro de juegos y digitales vintage
- [Digital Error Emulator](#digital-error-emulator) - Simula varios errores de transmisión de audio digital
- [DSD64 IMD Simulator](#dsd64-imd-simulator) - Simula la distorsión por intermodulación audible que genera el ruido ultrasónico del DSD64
- [Hum Generator](#hum-generator) - Añade una atmósfera ajustable de zumbido eléctrico para escucha vintage/lo-fi
- [Noise Blender](#noise-blender) - Agrega textura atmosférica de fondo
- [Simple Jitter](#simple-jitter) - Crea sutiles imperfecciones digitales vintage
- [Vinyl Artifacts](#vinyl-artifacts) - Añade pops, crackle, hiss, rumble y fuga de ruido estéreo al estilo vinilo
- [Vinyl Simulator](#vinyl-simulator) - Graba la entrada en un surco modelado y la reproduce con una aguja física simulada

## Bit Crusher

Un efecto que recrea el sonido de dispositivos digitales vintage como consolas de juegos antiguas y samplers tempranos. Perfecto para agregar carácter retro o crear una atmósfera lo-fi.

### Guía de Carácter de Sonido
- Estilo Retro Gaming:
  - Crea sonidos clásicos de consola de 8 bits
  - Perfecto para nostalgia de música de videojuegos
  - Agrega textura pixelada al sonido
- Estilo Lo-Fi Hip Hop:
  - Crea ese sonido relajante de ritmos para estudiar
  - Degradación digital cálida y suave
  - Perfecto para escucha de fondo
- Efectos Creativos:
  - Crea sonidos únicos estilo glitch
  - Transforma música moderna en versiones retro
  - Agrega carácter digital a cualquier música

### Parámetros
- **Bit Depth** - Controla qué tan "digital" se vuelve el sonido (4 a 24 bits)
  - 4-6 bits: Sonido retro gaming extremo
  - 8 bits: Digital vintage clásico
  - 12-16 bits: Carácter lo-fi sutil
  - Valores más altos: Efecto muy suave
- **TPDF Dither** - Hace que el efecto suene más suave
  - On: Sonido más suave y musical
  - Off: Efecto más crudo y agresivo
- **ZOH Frequency** - Afecta la claridad general (4000Hz a 96000Hz)
  - Valores más bajos: Más retro, menos claro
  - Valores más altos: Efecto más claro y sutil
- **Bit Error** - Agrega carácter de hardware vintage (0.00% a 10.00%)
  - 0%: Sin desajuste de ponderación de bits del DAC; Random Seed no tiene efecto audible
  - 0.1-1%: Coloración digital sutil de DAC
  - 1-3%: Imperfecciones clásicas de hardware
  - 3-10%: Carácter lo-fi creativo
- **Random Seed** - Controla la unicidad de las imperfecciones (0 a 1000)
  - Cambia el patrón fijo de imperfección usado por Bit Error
  - Solo es audible cuando Bit Error está por encima de 0%
  - El mismo valor siempre recrea el mismo patrón de imperfección

## Digital Error Emulator

Un efecto que simula el sonido de errores de transmisión de audio digital, desde clics leves de interfaz hasta imperfecciones de reproductores de CD antiguos y cortes inalámbricos. Úsalo cuando quieras carácter digital nostálgico o una textura glitch evidente durante la escucha.

### Guía de Carácter de Sonido
- Carácter Sutil de Reproducción Digital:
  - Simula artefactos de transmisión S/PDIF, AES3 y MADI
  - Añade imperfecciones digitales leves y ocasionales
  - Útil cuando la reproducción limpia se siente demasiado perfecta
- Dropouts Digitales de Consumo:
  - Recrea el comportamiento de corrección de errores de reproductores de CD clásicos
  - Simula glitches de interfaz de audio USB
  - Ideal para nostalgia de música digital de los 90/2000
- Artefactos de Streaming y Audio Inalámbrico:
  - Simula errores de transmisión Bluetooth
  - Dropouts y artefactos de streaming de red
  - Imperfecciones de la vida digital moderna
- Texturas Digitales Creativas:
  - Interferencia RF y errores de transmisión inalámbrica
  - Efectos de corrupción de audio HDMI/DisplayPort
  - Posibilidades de sonido experimental únicas

### Parámetros
- **Bit Error Rate** - Controla la frecuencia de ocurrencia de errores (10^-12 a 10^-2)
  - Muy Raro (10^-10 a 10^-8): Artefactos sutiles ocasionales
  - Ocasional (10^-8 a 10^-6): Comportamiento clásico de equipos de consumo
  - Frecuente (10^-6 a 10^-4): Carácter vintage notable
  - Extremo (10^-4 a 10^-2): Efectos experimentales creativos
  - Por defecto: 10^-6 (equipos de consumo típicos)
- **Mode** - Selecciona el tipo de transmisión digital a simular
  - AES3/S-PDIF: Errores de bits de interfaz con retención de muestra
  - ADAT/TDIF/MADI: Errores de ráfaga multicanal (retención o silencio)
  - HDMI/DP: Corrupción de fila de audio de pantalla o silenciamiento
  - USB/FireWire/Thunderbolt: Dropouts de microtrama con interpolación
  - Dante/AES67/AVB: Pérdida de paquetes de audio de red (64/128/256 muestras)
  - Bluetooth A2DP/LE: Errores de transmisión inalámbrica con ocultación
  - WiSA: Errores de bloques FEC de altavoces inalámbricos
  - RF Systems: Silenciamiento de radiofrecuencia e interferencia
  - CD Audio: Simulación de corrección de errores CIRC
  - Por defecto: CD Audio — CIRC Error Correction (Interpolated)
- **Reference Fs (kHz)** - Establece la frecuencia de muestreo de referencia usada solo por los modos de pérdida de paquetes Dante / AES67 / AVB para escalar la longitud de paquetes de 64/128/256 muestras
  - Frecuencias disponibles: 44.1, 48, 88.2, 96, 176.4, 192 kHz
  - Solo la usan los modos de pérdida de paquetes Dante / AES67 / AVB para escalar la longitud de paquetes de 64/128/256 muestras
  - Los demás modos usan su propio timing fijo o la tasa de muestreo actual
  - Por defecto: 48 kHz
- **Wet Mix** - Controla la mezcla entre audio original y procesado (0-100%)
  - Nota: Para simulación realista de errores digitales, mantener al 100%
  - Valores más bajos crean errores "parciales" irreales que no ocurren en sistemas digitales reales
  - Por defecto: 100% (comportamiento auténtico de errores digitales)

### Detalles de Modos

**Interfaces digitales especializadas:**
- AES3/S-PDIF: Errores de muestra única con retención de muestra anterior
- ADAT/TDIF/MADI: Errores de ráfaga de 32 muestras - retener últimas muestras buenas o silenciar
- HDMI/DisplayPort: Corrupción de fila de 192 muestras con errores a nivel de bit o silenciamiento completo

**Audio de Computadora:**
- USB/FireWire/Thunderbolt: Dropouts de microtrama con ocultación por interpolación
- Audio de Red (Dante/AES67/AVB): Pérdida de paquetes con diferentes opciones de tamaño y ocultación

**Inalámbrico de Consumo:**
- Bluetooth A2DP: Errores de transmisión post-códec con artefactos de vibración y decaimiento
- Bluetooth LE: Ocultación mejorada con filtrado de alta frecuencia y ruido
- WiSA: Silenciamiento de bloques FEC de altavoces inalámbricos

**Sistemas Especializados:**
- RF Systems: Eventos de silenciamiento de longitud variable simulando interferencia de radio
- CD Audio: Simulación de corrección de errores CIRC con comportamiento estilo Reed-Solomon

### Ajustes Recomendados para Diferentes Estilos

1. Carácter Sutil de Reproducción Digital
   - Modo: AES3 / S-PDIF (I²S) — Bit Error (Hold), BER: 10^-8, Fs: 48kHz, Wet: 100%
   - Perfecto para: Añadir imperfecciones digitales leves y ocasionales

2. Experiencia Clásica de Reproductor de CD
   - Modo: CD Audio — CIRC Error Correction (Interpolated), BER: 10^-7, Fs: 44.1kHz, Wet: 100%
   - Perfecto para: Nostalgia de música digital de los 90

3. Glitches de Streaming Moderno
   - Modo: Dante / AES67 / AVB — UDP Drop (128 samp), BER: 10^-6, Fs: 48kHz, Wet: 100%
   - Perfecto para: Imperfecciones de la vida digital contemporánea

4. Experiencia de Escucha Bluetooth
   - Modo: Bluetooth A2DP — Digital Transmission, BER: 10^-6, Fs: 48kHz, Wet: 100%
   - Perfecto para: Memorias de audio inalámbrico

5. Textura de Corte Inalámbrico
   - Modo: WMAS / DECT / Axient — RF Squelch, BER: 10^-5, Fs: 48kHz, Wet: 100%
   - Perfecto para: Interrupciones evidentes tipo radio y textura glitch

Nota: Todas las recomendaciones usan 100% de Wet Mix para comportamiento realista de errores digitales. Los valores de mezcla húmeda más bajos pueden usarse para efectos creativos, pero no representan cómo ocurren realmente los errores digitales reales.

## DSD64 IMD Simulator

Un efecto que recrea un efecto secundario sutil, y a menudo debatido, de la reproducción DSD64: el ruido ultrasónico que el DSD transporta por encima del rango audible puede, a través de las pequeñas imperfecciones de los DAC, amplificadores y altavoces reales, generar distorsión por intermodulación (IMD), es decir, aspereza y tonos adicionales que terminan cayendo de nuevo dentro del rango que puedes oír. Este efecto reproduce ese resultado audible para que puedas escucharlo y ajustarlo. Se trata de una simulación y no genera un flujo DSD real.

**Este efecto requiere una frecuencia de muestreo de 88.2 kHz o superior** (88.2 / 96 / 176.4 / 192 kHz). A 44.1 / 48 kHz no puede funcionar y se omite (la señal seca pasa sin alteraciones), mostrando una advertencia. Configura la frecuencia de muestreo a 88.2 kHz o superior en los ajustes de audio de la aplicación para usar este efecto.

### Guía de Carácter de Sonido
- "Aspereza digital" muy sutil: un leve y constante piso de ruido arenoso, más una fina dureza que sigue a la música.
- Herramienta de demostración: hace audible y ajustable la IMD ultrasónica del DSD64, normalmente inaudible.
- Textura creativa: con valores más altos de Amount y Analog Nonlinearity se convierte en un evidente efecto lo-fi de rasguño/filo.

### Parámetros

Parámetros principales
- **Amount** (-40.0 a +50.0 dB) - Nivel general de la distorsión generada.
- **Dry-Wet** (100:0 a 0:100) - Balance entre la señal seca y la distorsión generada, expresado como una proporción seco:húmedo. 100:0 = solo señal seca; 100:100 (centro) = señal seca completa más distorsión completa; 0:100 = solo distorsión.
- **Ultrasonic Level** (-48.0 a -18.0 dBFS RMS) - Nivel del ruido ultrasónico DSD simulado. Más ruido produce más distorsión.
- **Noise Color** (-100 a +100%) - Desplaza el ruido ultrasónico hacia frecuencias más bajas o más altas e inclina su balance.
- **Analog Nonlinearity** (0.00 a 10.00%) - Cuán imperfecto (no lineal) es el equipo analógico simulado. Valores más altos producen más distorsión.
- **Even Bias** (0 a 100%) - Equilibra la composición de la distorsión. Los valores bajos favorecen la distorsión que sigue a la música (Attached); los valores altos favorecen la distorsión constante de tipo ruido (Additive) más el componente Cross.
- **Signal Coupling** (0 a 200%) - Intensidad de la distorsión dependiente de la música (Attached y Cross). En 0, solo permanece el ruido Additive constante.
- **IMD Path HPF** (0.0 a 8.0 kHz) - Limita la generación de distorsión a las frecuencias por encima de este punto. 0.0 = Off (rango completo, como un amplificador); alrededor de 2.5 kHz emula un sistema en el que solo el tweeter produce la distorsión. La señal seca nunca se ve afectada.
- **Scratch Tone** (3.0 a 14.0 kHz) - Frecuencia central del carácter audible de "rasguño".

Parámetros avanzados / de utilidad
- **Noise Texture** (0 a 100%) - Añade una ondulación resonante al ruido ultrasónico para una textura ligeramente distinta.
- **Cross Sideband** (0 a 100%) - Cantidad de distorsión creada por la mezcla de la música con el ruido ultrasónico.
- **Output Trim** (-24.0 a +12.0 dB) - Ajuste final del nivel de salida.

### Visualizaciones
- **Medidores Term Contribution** - Niveles en tiempo real de cada parte del efecto:
  - **Additive** - la distorsión constante, presente solo a partir del ruido, incluso sin señal de entrada.
  - **Attached** - distorsión que se adhiere a la música y la sigue.
  - **Cross** - distorsión producida por la mezcla de la música con el ruido ultrasónico.
  - **Total IMD** - la distorsión combinada que se genera.
  - **Output** - el nivel de salida final (señal seca más distorsión, después de Dry-Wet y Output Trim).
- **Analog Transfer Curve** - Muestra la curva de distorsión creada por Analog Nonlinearity y Even Bias, con el mismo estilo de entrada/salida que los plugins de Saturation.
- **Vista Difference-Frequency** - Un gráfico estático que muestra qué frecuencias audibles produce el ruido ultrasónico, según los ajustes de ruido actuales.

### Ajustes Recomendados
- Sutil (por defecto): Amount +24 dB, Ultrasonic Level -30 dBFS, Analog Nonlinearity 1.40%, Even Bias 20%, Signal Coupling 150%, Cross Sideband 75%, Scratch Tone 10.5 kHz.
- IMD solo en el tweeter: IMD Path HPF 2.5 kHz, Signal Coupling 80–150%, Cross Sideband 50–100%, Scratch Tone 9–14 kHz.
- Efecto evidente: aumenta Amount, Ultrasonic Level y Analog Nonlinearity.

## Hum Generator

Añade una capa ajustable de zumbido eléctrico de 50/60 Hz para un ánimo de escucha vintage o lo-fi. Usa niveles bajos cuando la reproducción limpia se siente demasiado estéril, o sube Level para un zumbido evidente de efecto sonoro.

### Guía de Carácter Sonoro
- Ambiente de Equipos Vintage:
  - Recrea el zumbido sutil de amplificadores y equipos clásicos
  - Agrega el carácter de estar "conectado" a alimentación AC
  - Crea una atmósfera de reproducción vintage
- Características de Fuente de Alimentación:
  - Simula diferentes tipos de ruido de fuente de alimentación
  - Recrea características regionales de red eléctrica (50Hz vs 60Hz)
  - Agrega carácter sutil de infraestructura eléctrica
- Textura de Fondo:
  - Crea presencia orgánica de bajo nivel en el fondo
  - Agrega profundidad y "vida" a reproducciones muy limpias
  - Útil para un ambiente de escucha vintage o lo-fi

### Parámetros
- **Frequency** - Establece la frecuencia fundamental del zumbido (10-120 Hz)
  - 50 Hz: Estándar de red eléctrica europea/asiática
  - 60 Hz: Estándar de red eléctrica norteamericana
  - Otros valores: Frecuencias personalizadas para efectos creativos
- **Type** - Controla la estructura armónica del zumbido
  - Standard: Contiene solo armónicos impares (más puro, tipo transformador)
  - Rich: Contiene todos los armónicos (complejo, tipo equipo)
  - Dirty: Armónicos ricos con distorsión sutil (carácter de equipo vintage)
- **Harmonics** - Controla el brillo y contenido armónico (0-100%)
  - 0-30%: Zumbido cálido y suave con armónicos superiores mínimos
  - 30-70%: Contenido armónico equilibrado típico de equipos reales
  - 70-100%: Zumbido brillante y complejo con armónicos superiores fuertes
  - En Type: Dirty, valores más altos de Harmonics también aumentan la distorsión y aspereza
- **Tone** - Frecuencia de corte del filtro de modelado tonal final (1.0-20.0 kHz)
  - 1-5 kHz: Carácter cálido y apagado
  - 5-10 kHz: Tono natural tipo equipo
  - 10-20 kHz: Carácter brillante y presente
- **Instability** - Cantidad de variación sutil de frecuencia y amplitud (0-10%)
  - 0%: Zumbido perfectamente estable (precisión digital)
  - 1-3%: Deriva natural leve
  - 3-10%: Fluctuación más perceptible, pero aún suave
- **Level** - Nivel de salida de la señal de zumbido (-80.0 a 0.0 dB)
  - -80 a -60 dB: Presencia de fondo apenas audible
  - -60 a -40 dB: Zumbido sutil pero notable
  - -40 a -20 dB: Carácter vintage prominente
  - -20 a 0 dB: Niveles creativos o de efectos especiales

### Configuraciones Recomendadas para Diferentes Estilos

1. Amplificador Vintage Sutil
   - Frequency: 50/60 Hz, Type: Standard, Harmonics: 25%
   - Tone: 8.0 kHz, Instability: 1.5%, Level: -54 dB
   - Perfecto para: Agregar carácter suave de amplificador vintage

2. Reproducción Vintage Clásica
   - Frequency: 60 Hz, Type: Rich, Harmonics: 45%
   - Tone: 6.0 kHz, Instability: 2.0%, Level: -48 dB
   - Perfecto para: Ambiente eléctrico de fondo de equipos de reproducción antiguos

3. Equipo Vintage de Tubos
   - Frequency: 50 Hz, Type: Dirty, Harmonics: 60%
   - Tone: 5.0 kHz, Instability: 3.5%, Level: -42 dB
   - Perfecto para: Carácter cálido de amplificador de tubos

4. Ambiente de Red Eléctrica
   - Frequency: 50/60 Hz, Type: Standard, Harmonics: 35%
   - Tone: 10.0 kHz, Instability: 1.0%, Level: -60 dB
   - Perfecto para: Fondo realista de fuente de alimentación

5. Textura de Zumbido Más Fuerte
   - Frequency: 40 Hz, Type: Dirty, Harmonics: 80%
   - Tone: 15.0 kHz, Instability: 6.0%, Level: -36 dB
   - Perfecto para: Una textura de zumbido más fuerte y audible

## Noise Blender

Un efecto que agrega textura atmosférica de fondo a tu música, similar al sonido de discos de vinilo o equipos vintage. Perfecto para crear atmósferas acogedoras y nostálgicas.

### Guía de Carácter de Sonido
- Sonido de Equipo Vintage:
  - Recrea la calidez de equipos de audio antiguos
  - Agrega "vida" sutil a grabaciones digitales
  - Crea una sensación vintage auténtica
- Experiencia de Disco de Vinilo:
  - Agrega esa atmósfera clásica de tocadiscos
  - Crea una sensación acogedora y familiar
  - Perfecto para escucha nocturna
- Textura Ambiental:
  - Agrega fondo atmosférico
  - Crea profundidad y espacio
  - Hace que la música digital se sienta más orgánica

### Parámetros
- **Noise Type** - Elige el carácter de la textura de fondo
  - White: Textura más brillante y presente
  - Pink: Sonido más cálido y natural
  - Brown: Textura más profunda y suave, con más peso en bajas frecuencias
- **Level** - Controla qué tan notable es el efecto (-96dB a 0dB)
  - Muy Sutil (-96dB a -72dB): Solo un toque
  - Suave (-72dB a -48dB): Textura notable
  - Fuerte (-48dB a -24dB): Carácter vintage dominante
- **Per Channel** - Crea un efecto más espacioso
  - On: Sonido más amplio e inmersivo
  - Off: Textura más enfocada y centrada

## Simple Jitter

Un efecto que agrega variaciones sutiles de tiempo para crear ese sonido digital vintage imperfecto. Puede hacer que la música suene como si se reprodujera a través de reproductores de CD antiguos o equipos digitales vintage.

### Guía de Carácter de Sonido
- Sensación Vintage Sutil:
  - Agrega inestabilidad suave como equipos antiguos
  - Crea un sonido más orgánico y menos perfecto
  - Perfecto para agregar carácter sutilmente
- Sonido Clásico de Reproductor de CD:
  - Recrea el sonido de reproductores digitales tempranos
  - Agrega carácter digital nostálgico
  - Genial para apreciación de música de los 90
- Efectos Creativos:
  - Crea efectos únicos de fluctuación
  - Transforma sonidos modernos en vintage
  - Agrega carácter experimental

### Parámetros
- **RMS Jitter** - Controla la cantidad de variación de tiempo (1ps a 10ms)
  - Sutil (1-10ps): Carácter vintage suave
  - Medio (10-100ps): Sensación clásica de reproductor de CD
  - Fuerte (100ps-1ms): Efectos creativos de fluctuación

### Configuraciones Recomendadas para Diferentes Estilos

1. Apenas Perceptible
   - RMS Jitter: 1-5ps
   - Perfecto para: Hacer que la reproducción se sienta apenas menos perfectamente digital

2. Carácter Clásico de CD Player
   - RMS Jitter: 50-100ps
   - Perfecto para: Recrear el sonido de los primeros equipos de reproducción digital

3. Máquina DAT Vintage
   - RMS Jitter: 200-500ps
   - Perfecto para: Carácter de equipos de grabación digital de los 90

4. Equipo Digital Desgastado
   - RMS Jitter: 1-2ns (1000-2000ps)
   - Perfecto para: Crear el sonido de equipos digitales envejecidos o mal mantenidos

5. Efecto Creativo de Fluctuación
   - RMS Jitter: 10-100µs (0.01-0.1ms)
   - Perfecto para: Efectos experimentales y modulación de tono notable

## Vinyl Artifacts

Un efecto que añade artefactos de reproducción tipo vinilo, como pops, crackle, hiss, rumble y ruido de superficie reactivo. Añade ruido de disco generado a la música; no cambia el tono de la señal musical original como lo haría un modelo completo de tocadiscos, cápsula o preamplificador phono.

### Guía de Carácter de Sonido
- Experiencia de Disco de Vinilo:
  - Recrea el sonido auténtico de reproducir discos de vinilo
  - Agrega el ruido de superficie característico y artefactos
  - Crea una sensación nostálgica de reproducción en vinilo
- Sistema de Reproducción Vintage:
  - Añade artefactos de reproducción generados alrededor de la música
  - Moldea el tono del ruido de vinilo generado
  - Agrega ruido reactivo que responde a la música
- Textura Atmosférica:
  - Crea textura de fondo rica y orgánica
  - Agrega profundidad y carácter a las grabaciones digitales
  - Perfecto para crear experiencias de escucha acogedoras e íntimas

### Parámetros
- **Pops/min** - Controla la frecuencia de ruidos de clic grandes por minuto (0 a 120)
  - 0-20: Pops suaves ocasionales
  - 20-60: Carácter vintage moderado
  - 60-120: Sonido de desgaste pesado
- **Pop Level** - Controla el nivel de volumen de los clics (-80.0 a 0.0 dB)
  - -80 a -48 dB: Clics suaves
  - -48 a -24 dB: Clics moderados
  - -24 a 0 dB: Clics fuertes (configuraciones extremas)
- **Crackles/min** - Controla la densidad del ruido de crujido fino por minuto (0 a 2000)
  - 0-200: Textura de superficie sutil
  - 200-1000: Carácter de vinilo clásico
  - 1000-2000: Ruido de superficie pesado
- **Crackle Level** - Controla el nivel de volumen del crujido (-80.0 a 0.0 dB)
  - -80 a -48 dB: Crujido suave
  - -48 a -24 dB: Crujido moderado
  - -24 a 0 dB: Crujido fuerte (configuraciones extremas)
- **Hiss** - Controla el nivel de ruido de superficie constante (-80.0 a 0.0 dB)
  - -80 a -48 dB: Textura de fondo sutil
  - -48 a -30 dB: Ruido de superficie notable
  - -30 a 0 dB: Siseo prominente (configuraciones extremas)
- **Rumble** - Controla el retumbo de baja frecuencia del tocadiscos (-80.0 a 0.0 dB)
  - -80 a -60 dB: Calidez sutil en bajas frecuencias
  - -60 a -40 dB: Retumbo notable
  - -40 a 0 dB: Retumbo pesado (configuraciones extremas)
- **Crosstalk** - Mezcla el ruido de artefactos generado entre los canales izquierdo y derecho; la señal musical original conserva su separación estéreo (0 a 100%)
  - 0%: El ruido generado conserva su separación de canales original
  - 30-60%: Fuga de ruido realista al estilo vinilo
  - 100%: El ruido generado se vuelve casi igual entre izquierda y derecha
- **Noise Profile** - Ajusta la respuesta de frecuencia del ruido generado (0.0 a 10.0)
  - 0: Tono de ruido más oscuro y cálido
  - 5: Tono de ruido parcialmente moldeado
  - 10: Tono de ruido plano / modelado tonal omitido
- **Wear** - Escala artefactos de desgaste de superficie como pops, crackles y hiss (0 a 200%)
  - 0-50%: Ruido de superficie más limpio
  - 50-100%: Desgaste normal de superficie
  - 100-200%: Ruido de superficie muy desgastada
  - Rumble, Crosstalk y Noise Profile se controlan por separado
- **React** - Cuánto responde el ruido a la señal de entrada (0 a 100%)
  - 0%: Niveles de ruido estáticos
  - 25-50%: Respuesta moderada a la música
  - 75-100%: Altamente reactivo a la entrada
- **React Mode** - Selecciona qué aspecto de la señal controla la reacción
  - Velocity: Responde al contenido de alta frecuencia (velocidad de aguja)
  - Amplitude: Responde al nivel general de la señal
- **Mix** - Controla la cantidad de ruido añadido a la señal seca (0 a 100%)
  - 0%: Sin ruido añadido (solo señal seca)
  - 50%: Adición de ruido moderada
  - 100%: Máxima adición de ruido
  - Nota: El nivel de la señal seca permanece sin cambios; este parámetro solo controla la cantidad de ruido

### Configuraciones Recomendadas para Diferentes Estilos

1. Carácter de Vinilo Sutil
   - Pops/min: 20, Pop Level: -48dB, Crackles/min: 200, Crackle Level: -48dB
   - Hiss: -48dB, Rumble: -60dB, Crosstalk: 30%, Noise Profile: 5.0
   - Wear: 25%, React: 20%, React Mode: Velocity, Mix: 100%
   - Perfecto para: Añadir una textura suave de superficie de vinilo

2. Experiencia de Vinilo Clásica
   - Pops/min: 40, Pop Level: -36dB, Crackles/min: 400, Crackle Level: -36dB
   - Hiss: -36dB, Rumble: -50dB, Crosstalk: 50%, Noise Profile: 4.0
   - Wear: 60%, React: 30%, React Mode: Velocity, Mix: 100%
   - Perfecto para: Experiencia auténtica de escucha de vinilo

3. Disco Muy Desgastado
   - Pops/min: 80, Pop Level: -24dB, Crackles/min: 800, Crackle Level: -24dB
   - Hiss: -30dB, Rumble: -40dB, Crosstalk: 70%, Noise Profile: 3.0
   - Wear: 120%, React: 50%, React Mode: Velocity, Mix: 100%
   - Perfecto para: Carácter de disco muy envejecido

4. Lo-Fi Ambiental
   - Pops/min: 15, Pop Level: -54dB, Crackles/min: 150, Crackle Level: -54dB
   - Hiss: -42dB, Rumble: -66dB, Crosstalk: 25%, Noise Profile: 6.0
   - Wear: 40%, React: 15%, React Mode: Amplitude, Mix: 100%
   - Perfecto para: Textura ambiental de fondo

5. Vinilo Dinámico
   - Pops/min: 60, Pop Level: -30dB, Crackles/min: 600, Crackle Level: -30dB
   - Hiss: -39dB, Rumble: -45dB, Crosstalk: 60%, Noise Profile: 5.0
   - Wear: 80%, React: 75%, React Mode: Velocity, Mix: 100%
   - Perfecto para: Ruido que responde dramáticamente a la música

## Vinyl Simulator

Vinyl Simulator transforma la propia música mediante un modelo físico de corte y reproducción. Aplica los filtros de corte y la curva RIAA de grabación, escribe la señal en un surco con rugosidad y residuos, la sigue con una simulación mecánica de aguja y brazo, y aplica la ecualización RIAA de reproducción. Úsalo cuando quieras que la geometría del surco, el seguimiento y la superficie interactúen con la música.

### Diferencia frente a Vinyl Artifacts

- **Vinyl Simulator** modifica la señal al pasarla por el surco y la aguja modelados. Roughness, Dust, Static, Tracking Force, la forma de la aguja, Speed y Radius intervienen en el resultado.
- **Vinyl Artifacts** deja intacta la música y añade pops, crackle, hiss, rumble y fuga de ruido. Es la opción ligera y predecible, o la alternativa cuando no hay WASM.
- Se pueden combinar, pero ajustes de superficie intensos en ambos acumulan clics y ruido con rapidez.

### Guía de mejora del sonido

- **Reproducción suave:** Cut Level cerca de 0 dB, Shape en Elliptical, Roughness moderado, poco Dust y Static, y menor Mix para conservar más señal original.
- **Carácter de surco interior:** acerca Radius a 60 mm. La menor velocidad lineal exige más al seguimiento y a los agudos.
- **Reproducción limpia y estable:** reduce Roughness, Dust, Static y Scratch, mantén Tracking Force alrededor de 2 g y usa Standard o High.
- **Superficie envejecida:** sube primero Roughness y después Dust, Static y un poco de Scratch; cada control representa un fenómeno físico distinto.
- **Coloración más evidente:** sube Cut Level con cuidado, baja HF Cutoff o reduce Radius. Vigila la caída de Tracking S/E y el aumento de mistrack/skip.
- No incluye wow/flutter, excentricidad, alabeo ni rumble del plato. Añade **Wow Flutter** a la cadena si los necesitas.

### Parámetros

#### Cutting

- **Cut Level** (-20 a +20 dB) — Intensidad con la que la entrada mueve el cabezal de corte. Más nivel acentúa el desplazamiento y la no linealidad; menos deja mayor margen mecánico.
- **HF Cutoff** (6000 a 24000 Hz) — Límite de agudos antes del corte. Más bajo oscurece y facilita el seguimiento; más alto conserva detalle y exige más a la aguja.
- **Bass Mono Below** (50 a 1000 Hz) — Rango donde se reduce el componente Side. Al subirlo, más graves quedan centrados.
- **Side Mix** (0 a 100%) — Side que permanece bajo Bass Mono Below. 0% vuelve mono ese rango; 100% conserva el Side original.

#### Record

- **Speed** (33⅓, 45 o 78 rpm) — Velocidad de giro. A igual Radius, más velocidad aumenta la velocidad lineal y facilita seguir detalles finos.
- **Radius** (60 a 146 mm) — Posición de la aguja. Valores pequeños representan el surco interior, más lento y difícil en agudos.
- **Roughness** (0,1 a 100 nm) — Rugosidad microscópica; al subirla aumenta la textura continua de superficie.
- **Dust** (0 a 10000/s) — Frecuencia de partículas de polvo y perturbaciones breves.
- **Static** (0 a 10000/s) — Frecuencia de descargas eléctricas, añadidas como pops a la salida de la cápsula.
- **Scratch** (0 a 1000/s) — Frecuencia de defectos de surco mayores.

#### Stylus

- **Shape** (Spherical o Elliptical) — Geometría de contacto. En Spherical, Scan Radius sigue a Side Radius. Cambiarla reconstruye el estado de simulación.
- **Side Radius** (5 a 25 µm) — Radio transversal sobre la pared; cambia la huella y la presión de contacto.
- **Scan Radius** (2 a 25 µm) — Radio en la dirección del surco. Pequeño sigue detalles finos; grande promedia sobre un contacto más amplio.
- **Tracking Force** (0,5 a 5,0 g) — Fuerza de apoyo. Más puede estabilizar el contacto, pero eleva fuerza y presión; muy poca favorece mistrack y skip.
- **Tip Mass** (0,1 a 1,5 mg) — Masa móvil de la punta. Más masa añade inercia y dificulta seguir movimientos rápidos.
- **Compliance** (5 a 35 cu) — Flexibilidad de la suspensión. Valores altos permiten más movimiento y cambian la respuesta mecánica.
- **Damping** (0,05 a 1,0 ζ) — Amortiguación de resonancias. Valores altos reducen más el ringing.

#### Output

- **Quality** (Eco, Standard, High o Ultra) — Define el número base de subpasos físicos y puntos de contacto. Para estabilizar la resonancia de contacto, el motor puede aumentar automáticamente los subpasos efectivos según la frecuencia de muestreo, Tracking Force, Tip Mass, Compliance, Shape, Side Radius y Scan Radius. Standard es el valor predeterminado en tiempo real; cambiarlo reconstruye la simulación.
- **Output Gain** (-24 a +24 dB) — Nivel después de la ecualización RIAA y la normalización.
- **Mix** (0 a 100%) — Mezcla la reproducción simulada con la señal seca alineada en latencia. 0% = seca; 100% = simulada.

### Cómo leer el HUD

- **Force L/R (mN):** fuerza en cada pared; valores altos o desiguales indican un pasaje exigente.
- **Pressure (GPa):** mayor presión de contacto actual; léela junto a Force al ajustar la aguja.
- **Tip (cm/s, dB):** velocidad de la punta y nivel de reproducción resultante.
- **Tracking S/E L/R (dB):** relación entre señal seguida y error. Más alto significa seguimiento más limpio; una caída sostenida indica dificultad.
- **Jitter (ns):** variación temporal del punto de lectura, visible en Stylus.
- **Mistrack, Skip, Static Pop y Dust Hit (/s):** tasas recientes con un destello en cada evento. Si se repiten, baja Cut Level, sube moderadamente Tracking Force, aumenta Radius o Quality.

El HUD se activa con la telemetría DSP nativa. Al parar o suspender la telemetría para ahorrar energía, puede mostrar un estado inactivo.

### Ajustes recomendados

1. **Reproducción suave:** Cut Level 0 dB, HF Cutoff 16 kHz, 33⅓ rpm, Radius 120 mm, Roughness 5 nm, Dust 0,5/s, Static 0,02/s, Scratch 0/s, Elliptical, Tracking Force 2,0 g, Standard, Mix 75%.
2. **Surco exterior clásico:** Cut Level 0 dB, 33⅓ rpm, Radius 135 mm, Roughness 13,17 nm, Dust 2/s, Static 0,08/s, Elliptical, Tracking Force 2,0 g, Standard, Mix 100%.
3. **Demostración interior:** Cut Level +3 dB, HF Cutoff 14 kHz, Radius 60 mm, Elliptical, Scan Radius 8 µm, Tracking Force 2,0 g, High, Mix 100%; compara Tracking S/E con un Radius mayor.
4. **Superficie gastada:** Radius 100 mm, Roughness 35 nm, Dust 25/s, Static 1/s, Scratch 0,5/s, Tracking Force 2,2 g, Standard, Output Gain -3 dB, Mix 100%.

### Quality y carga de CPU

Cada preset Quality fija unos subpasos base y unos puntos de contacto. Para mantener la estabilidad, el motor también calcula `Nmin = ceil(8 × f_c / sampleRate)`, donde la frecuencia de resonancia de contacto `f_c` depende de Tracking Force, Tip Mass, Compliance, Shape, Side Radius y Scan Radius, y utiliza `effectiveSubsteps = max(base, Nmin)`. Con los ajustes predeterminados, Standard a 96 kHz permanece en su base de 4 subpasos, por lo que el objetivo de rendimiento existente no cambia.

La carga principal es proporcional a frecuencia de muestreo × subpasos efectivos × puntos de contacto. Las evaluaciones y cargas relativas de la tabla son valores base cuando el límite de estabilidad no aumenta los subpasos, no porcentajes de CPU medidos; también influyen el procesador, el navegador y WASM SIMD.

| Quality | Detalle base | Evaluaciones base a 96 kHz | Carga relativa base | Uso |
|---|---:|---:|---:|---|
| Eco | 2 × 7 | 2,7 millones/s | 0,39× | Móvil, bajo consumo, varias instancias |
| Standard | 4 × 9 | 6,9 millones/s | 1,00× | Escucha normal en tiempo real |
| High | 8 × 13 | 20 millones/s | 2,89× | Sistemas rápidos, comparación detallada |
| Ultra | 20 × 25 | 96 millones/s | 13,89× | Renderizado sin conexión y verificación |

Cuando el límite de estabilidad está inactivo, aplica a la carga relativa base estos multiplicadores: 44,1 kHz = 0,46×; 48 = 0,50×; 88,2 = 0,92×; 96 = 1,00×; 176,4 = 1,84×; 192 = 2,00×. La frecuencia de muestreo y los ajustes Tracking Force, Tip Mass, Compliance, Shape, Side Radius y Scan Radius pueden activar el límite y elevar la carga real sobre esta estimación base. Si hay cortes, baja primero Quality.

### Requisito de WASM y límites

Vinyl Simulator necesita el núcleo DSP WebAssembly nativo para el proceso en tiempo real. Si WASM está desactivado mediante `?dsp=off`, no es compatible o falla al iniciarse, la entrada pasa sin cambios y la interfaz indica que se requiere WASM. No usa como alternativa la simulación JavaScript de referencia, mucho más lenta.

El modelo procesa el primer par estéreo. La deformación del polvo solo dura mientras cada partícula está activa y la aguja avanza siempre por surco recién generado; el desgaste no se acumula entre vueltas ni se guarda en presets. Desgaste a largo plazo, vista 3D, medidores SNR/THD en tiempo real, wow/flutter, excentricidad, alabeo, rumble del plato y carga eléctrica de la cápsula quedan fuera del modelo.

¡Recuerda: Estos efectos están diseñados para agregar carácter y nostalgia a tu música. ¡Comienza con ajustes sutiles y ajusta al gusto!
