---
title: "Lo-Fi Plugins - EffeTune"
description: "Lo-Fi effect plugins including Bit Crusher, Noise Blender, Vinyl Artifacts, and more."
lang: en
---

# Plugins Lo-Fi

Una colección de plugins que agregan carácter vintage y cualidades nostálgicas a tu música. Estos efectos pueden hacer que la música digital moderna suene como si se reprodujera a través de equipos clásicos o darle ese popular sonido "lo-fi" que es tanto relajante como atmosférico.

## Lista de Plugins

- [Bit Crusher](#bit-crusher) - Crea sonidos retro de juegos y digitales vintage
- [Digital Error Emulator](#digital-error-emulator) - Simula varios errores de transmisión de audio digital
- [Hum Generator](#hum-generator) - Generador de ruido de zumbido de alta precisión
- [Noise Blender](#noise-blender) - Agrega textura atmosférica de fondo
- [Simple Jitter](#simple-jitter) - Crea sutiles imperfecciones digitales vintage
- [Vinyl Artifacts](#vinyl-artifacts) - Simulación física de ruido de discos analógicos

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
  - 0-1%: Calidez vintage sutil
  - 1-3%: Imperfecciones clásicas de hardware
  - 3-10%: Carácter lo-fi creativo
- **Random Seed** - Controla la unicidad de las imperfecciones (0 a 1000)
  - Diferentes valores crean diferentes "personalidades" vintage
  - El mismo valor siempre reproduce el mismo carácter
  - Perfecto para encontrar y guardar tu sonido vintage favorito

## Digital Error Emulator

Un efecto que simula el sonido de varios errores de transmisión de audio digital, desde sutiles glitches de interfaz profesional hasta imperfecciones de reproductores de CD vintage. Perfecto para agregar carácter digital vintage o crear experiencias de escucha únicas que te recuerden equipos de audio digital clásicos.

### Guía de Carácter de Sonido
- Glitches de Interfaz Digital Profesional:
  - Simula artefactos de transmisión S/PDIF, AES3 y MADI
  - Agrega el carácter de equipos profesionales envejecidos
  - Perfecto para sonido de estudio vintage
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
  - AES3/S-PDIF: Errores de bits de interfaz profesional con retención de muestra
  - ADAT/TDIF/MADI: Errores de ráfaga multicanal (retención o silencio)
  - HDMI/DP: Corrupción de fila de audio de pantalla o silenciamiento
  - USB/FireWire/Thunderbolt: Dropouts de microtrama con interpolación
  - Dante/AES67/AVB: Pérdida de paquetes de audio de red (64/128/256 muestras)
  - Bluetooth A2DP/LE: Errores de transmisión inalámbrica con ocultación
  - WiSA: Errores de bloques FEC de altavoces inalámbricos
  - RF Systems: Silenciamiento de radiofrecuencia e interferencia
  - CD Audio: Simulación de corrección de errores CIRC
  - Por defecto: CD Audio (más familiar para los oyentes de música)
- **Reference Fs (kHz)** - Establece la frecuencia de muestreo de referencia para cálculos de timing
  - Frecuencias disponibles: 44.1, 48, 88.2, 96, 176.4, 192 kHz
  - Afecta la precisión del timing para modos de audio de red
  - Por defecto: 48 kHz
- **Wet Mix** - Controla la mezcla entre audio original y procesado (0-100%)
  - Nota: Para simulación realista de errores digitales, mantener al 100%
  - Valores más bajos crean errores "parciales" irreales que no ocurren en sistemas digitales reales
  - Por defecto: 100% (comportamiento auténtico de errores digitales)

### Detalles de Modos

**Interfaces Profesionales:**
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

1. Carácter Sutil de Equipo Profesional
   - Modo: AES3/S-PDIF, BER: 10^-8, Fs: 48kHz, Wet: 100%
   - Perfecto para: Agregar envejecimiento sutil de equipo profesional

2. Experiencia Clásica de Reproductor de CD
   - Modo: CD Audio, BER: 10^-7, Fs: 44.1kHz, Wet: 100%
   - Perfecto para: Nostalgia de música digital de los 90

3. Glitches de Streaming Moderno
   - Modo: Dante/AES67 (128 samp), BER: 10^-6, Fs: 48kHz, Wet: 100%
   - Perfecto para: Imperfecciones de la vida digital contemporánea

4. Experiencia de Escucha Bluetooth
   - Modo: Bluetooth A2DP, BER: 10^-6, Fs: 48kHz, Wet: 100%
   - Perfecto para: Memorias de audio inalámbrico

5. Efectos Experimentales Creativos
   - Modo: RF Systems, BER: 10^-5, Fs: 48kHz, Wet: 100%
   - Perfecto para: Sonidos experimentales únicos

Nota: Todas las recomendaciones usan 100% de Wet Mix para comportamiento realista de errores digitales. Los valores de mezcla húmeda más bajos pueden usarse para efectos creativos, pero no representan cómo ocurren realmente los errores digitales reales.

## Hum Generator

Un efecto que genera ruido de zumbido eléctrico auténtico y de alta precisión con su estructura armónica característica e inestabilidades sutiles. Perfecto para agregar zumbido de fondo realista de equipos vintage, fuentes de alimentación, o crear esa sensación auténtica de estar "conectado" que poseen muchas grabaciones clásicas.

### Guía de Carácter Sonoro
- Ambiente de Equipos Vintage:
  - Recrea el zumbido sutil de amplificadores y equipos clásicos
  - Agrega el carácter de estar "conectado" a alimentación AC
  - Crea atmósfera auténtica de estudio vintage
- Características de Fuente de Alimentación:
  - Simula diferentes tipos de ruido de fuente de alimentación
  - Recrea características regionales de red eléctrica (50Hz vs 60Hz)
  - Agrega carácter sutil de infraestructura eléctrica
- Textura de Fondo:
  - Crea presencia orgánica de bajo nivel en el fondo
  - Agrega profundidad y "vida" a grabaciones digitales estériles
  - Perfecto para producciones inspiradas en vintage

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
- **Tone** - Frecuencia de corte del filtro de modelado tonal final (1.0-20.0 kHz)
  - 1-5 kHz: Carácter cálido y apagado
  - 5-10 kHz: Tono natural tipo equipo
  - 10-20 kHz: Carácter brillante y presente
- **Instability** - Cantidad de variación sutil de frecuencia y amplitud (0-10%)
  - 0%: Zumbido perfectamente estable (precisión digital)
  - 1-3%: Inestabilidad sutil del mundo real
  - 3-7%: Carácter notable de equipo vintage
  - 7-10%: Efectos de modulación creativos
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

2. Estudio de Grabación Clásico
   - Frequency: 60 Hz, Type: Rich, Harmonics: 45%
   - Tone: 6.0 kHz, Instability: 2.0%, Level: -48 dB
   - Perfecto para: Atmósfera auténtica de estudio de la era analógica

3. Equipo Vintage de Tubos
   - Frequency: 50 Hz, Type: Dirty, Harmonics: 60%
   - Tone: 5.0 kHz, Instability: 3.5%, Level: -42 dB
   - Perfecto para: Carácter cálido de amplificador de tubos

4. Ambiente de Red Eléctrica
   - Frequency: 50/60 Hz, Type: Standard, Harmonics: 35%
   - Tone: 10.0 kHz, Instability: 1.0%, Level: -60 dB
   - Perfecto para: Fondo realista de fuente de alimentación

5. Efectos Creativos de Zumbido
   - Frequency: 40 Hz, Type: Dirty, Harmonics: 80%
   - Tone: 15.0 kHz, Instability: 6.0%, Level: -36 dB
   - Perfecto para: Aplicaciones artísticas y experimentales

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
   - Perfecto para: Agregar el más sutil toque de calidez analógica a grabaciones digitales

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
   - RMS Jitter: 10-100µs (10000-100000ps)
   - Perfecto para: Efectos experimentales y modulación de tono notable

## Vinyl Artifacts

Un efecto que recrea las características de ruido físico de los discos de vinilo analógicos. Este plugin simula los diversos artefactos que ocurren al reproducir discos de vinilo, desde el ruido de superficie hasta las características eléctricas de la cadena de reproducción.

### Guía de Carácter de Sonido
- Experiencia de Disco de Vinilo:
  - Recrea el sonido auténtico de reproducir discos de vinilo
  - Agrega el ruido de superficie característico y artefactos
  - Crea esa sensación analógica cálida y nostálgica
- Sistema de Reproducción Vintage:
  - Simula la cadena de reproducción analógica completa
  - Incluye características de ecualización RIAA
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
- **Crosstalk** - Controla la fuga de sonido entre canales izquierdo y derecho (0 a 100%)
  - 0%: Separación estéreo perfecta
  - 30-60%: Fuga de canal de vinilo realista
  - 100%: Máxima fuga entre canales
- **Noise Profile** - Ajusta la respuesta de frecuencia del ruido (0.0 a 10.0)
  - 0: Reproduce la curva RIAA (respuesta de frecuencia de vinilo auténtica)
  - 5: Respuesta parcialmente corregida
  - 10: Respuesta plana (bypass)
- **Wear** - Multiplicador maestro para la condición general del disco (0 a 200%)
  - 0-50%: Disco bien mantenido
  - 50-100%: Desgaste y edad normal
  - 100-200%: Disco muy desgastado
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
   - Perfecto para: Agregar calidez analógica suave

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

¡Recuerda: Estos efectos están diseñados para agregar carácter y nostalgia a tu música. ¡Comienza con ajustes sutiles y ajusta al gusto!
