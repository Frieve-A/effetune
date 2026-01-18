---
title: "Lo-Fi Plugins - EffeTune"
description: "Lo-Fi effect plugins including Bit Crusher, Noise Blender, Vinyl Artifacts, and more."
lang: en
---

# Plugins Lo-Fi

Uma coleção de plugins que adicionam caráter vintage e qualidades nostálgicas à sua música. Esses efeitos podem fazer a música digital moderna soar como se estivesse sendo reproduzida em equipamentos clássicos ou dar aquele popular som "lo-fi" que é relaxante e atmosférico.

## Lista de Plugins

- [Bit Crusher](#bit-crusher) - Cria sons de jogos retrô e digitais vintage
- [Digital Error Emulator](#digital-error-emulator) - Simula vários erros de transmissão de áudio digital
- [Hum Generator](#hum-generator) - Gerador de ruído de zumbido de alta precisão
- [Noise Blender](#noise-blender) - Adiciona textura atmosférica de fundo
- [Simple Jitter](#simple-jitter) - Cria imperfeições digitais vintage sutis
- [Vinyl Artifacts](#vinyl-artifacts) - Simulação física de ruído de discos analógicos

## Bit Crusher

Um efeito que recria o som de dispositivos digitais vintage como consoles de jogos antigos e primeiros sampleadores. Perfeito para adicionar caráter retrô ou criar uma atmosfera lo-fi.

### Guia de Caráter Sonoro
- Estilo Jogos Retrô:
  - Cria sons clássicos de console 8-bit
  - Perfeito para nostalgia de música de videogame
  - Adiciona textura pixelada ao som
- Estilo Lo-Fi Hip Hop:
  - Cria aquele som relaxante de study-beats
  - Degradação digital quente e suave
  - Perfeito para audição em segundo plano
- Efeitos Criativos:
  - Crie sons únicos estilo glitch
  - Transforme música moderna em versões retrô
  - Adicione caráter digital a qualquer música

### Parâmetros
- **Bit Depth** - Controla quão "digital" o som se torna (4 a 24 bits)
  - 4-6 bits: Som extremo de jogos retrô
  - 8 bits: Digital vintage clássico
  - 12-16 bits: Caráter lo-fi sutil
  - Valores mais altos: Efeito muito suave
- **TPDF Dither** - Torna o efeito mais suave
  - On: Som mais suave e musical
  - Off: Efeito mais cru e agressivo
- **ZOH Frequency** - Afeta a clareza geral (4000Hz a 96000Hz)
  - Valores mais baixos: Mais retrô, menos claro
  - Valores mais altos: Efeito mais claro e sutil
- **Bit Error** - Adiciona caráter de hardware vintage (0.00% a 10.00%)
  - 0-1%: Calor vintage sutil
  - 1-3%: Imperfeições clássicas de hardware
  - 3-10%: Caráter lo-fi criativo
- **Random Seed** - Controla a unicidade das imperfeições (0 a 1000)
  - Valores diferentes criam diferentes "personalidades" vintage
  - O mesmo valor sempre reproduz o mesmo caráter
  - Perfeito para encontrar e salvar seu som vintage favorito

## Digital Error Emulator

Um efeito que simula o som de vários erros de transmissão de áudio digital, desde glitches sutis de interface profissional até imperfeições de tocadores de CD vintage. Perfeito para adicionar caráter digital vintage ou criar experiências de audição únicas que lembram equipamentos de áudio digital clássicos.

### Guia de Caráter Sonoro
- Glitches de Interface Digital Profissional:
  - Simula artefatos de transmissão S/PDIF, AES3 e MADI
  - Adiciona o caráter de equipamentos profissionais envelhecidos
  - Perfeito para som de estúdio vintage
- Dropouts Digitais de Consumo:
  - Recria o comportamento de correção de erro de tocadores de CD clássicos
  - Simula glitches de interface de áudio USB
  - Ideal para nostalgia de música digital dos anos 90/2000
- Artefatos de Streaming e Áudio Sem Fio:
  - Simula erros de transmissão Bluetooth
  - Dropouts e artefatos de streaming de rede
  - Imperfeições da vida digital moderna
- Texturas Digitais Criativas:
  - Interferência RF e erros de transmissão sem fio
  - Efeitos de corrupção de áudio HDMI/DisplayPort
  - Possibilidades sonoras experimentais únicas

### Parâmetros
- **Bit Error Rate** - Controla a frequência de ocorrência de erros (10^-12 a 10^-2)
  - Muito Raro (10^-10 a 10^-8): Artefatos sutis ocasionais
  - Ocasional (10^-8 a 10^-6): Comportamento clássico de equipamentos de consumo
  - Frequente (10^-6 a 10^-4): Caráter vintage perceptível
  - Extremo (10^-4 a 10^-2): Efeitos experimentais criativos
  - Padrão: 10^-6 (equipamento de consumo típico)
- **Mode** - Seleciona o tipo de transmissão digital a simular
  - AES3/S-PDIF: Erros de bit de interface profissional com retenção de amostra
  - ADAT/TDIF/MADI: Erros de rajada multicanal (retenção ou silêncio)
  - HDMI/DP: Corrupção de linha de áudio de display ou silenciamento
  - USB/FireWire/Thunderbolt: Dropouts de microframe com interpolação
  - Dante/AES67/AVB: Perda de pacotes de áudio de rede (64/128/256 amostras)
  - Bluetooth A2DP/LE: Erros de transmissão sem fio com ocultação
  - WiSA: Erros de blocos FEC de alto-falantes sem fio
  - RF Systems: Silenciamento de radiofrequência e interferência
  - CD Audio: Simulação de correção de erro CIRC
  - Padrão: CD Audio (mais familiar aos ouvintes de música)
- **Reference Fs (kHz)** - Define a taxa de amostragem de referência para cálculos de timing
  - Taxas disponíveis: 44.1, 48, 88.2, 96, 176.4, 192 kHz
  - Afeta a precisão do timing para modos de áudio de rede
  - Padrão: 48 kHz
- **Wet Mix** - Controla a mistura entre áudio original e processado (0-100%)
  - Nota: Para simulação realista de erro digital, manter em 100%
  - Valores mais baixos criam erros "parciais" irreais que não ocorrem em sistemas digitais reais
  - Padrão: 100% (comportamento autêntico de erro digital)

### Detalhes dos Modos

**Interfaces Profissionais:**
- AES3/S-PDIF: Erros de amostra única com retenção da amostra anterior
- ADAT/TDIF/MADI: Erros de rajada de 32 amostras - reter últimas amostras boas ou silenciar
- HDMI/DisplayPort: Corrupção de linha de 192 amostras com erros em nível de bit ou silenciamento completo

**Áudio de Computador:**
- USB/FireWire/Thunderbolt: Dropouts de microframe com ocultação por interpolação
- Áudio de Rede (Dante/AES67/AVB): Perda de pacotes com diferentes opções de tamanho e ocultação

**Sem Fio de Consumo:**
- Bluetooth A2DP: Erros de transmissão pós-codec com artefatos de vibração e decaimento
- Bluetooth LE: Ocultação aprimorada com filtragem de alta frequência e ruído
- WiSA: Silenciamento de blocos FEC de alto-falantes sem fio

**Sistemas Especializados:**
- RF Systems: Eventos de silenciamento de comprimento variável simulando interferência de rádio
- CD Audio: Simulação de correção de erro CIRC com comportamento estilo Reed-Solomon

### Configurações Recomendadas para Diferentes Estilos

1. Caráter Sutil de Equipamento Profissional
   - Modo: AES3/S-PDIF, BER: 10^-8, Fs: 48kHz, Wet: 100%
   - Perfeito para: Adicionar envelhecimento sutil de equipamento profissional

2. Experiência Clássica de Tocador de CD
   - Modo: CD Audio, BER: 10^-7, Fs: 44.1kHz, Wet: 100%
   - Perfeito para: Nostalgia de música digital dos anos 90

3. Glitches de Streaming Moderno
   - Modo: Dante/AES67 (128 samp), BER: 10^-6, Fs: 48kHz, Wet: 100%
   - Perfeito para: Imperfeições da vida digital contemporânea

4. Experiência de Audição Bluetooth
   - Modo: Bluetooth A2DP, BER: 10^-6, Fs: 48kHz, Wet: 100%
   - Perfeito para: Memórias de áudio sem fio

5. Efeitos Experimentais Criativos
   - Modo: RF Systems, BER: 10^-5, Fs: 48kHz, Wet: 100%
   - Perfeito para: Sons experimentais únicos

Nota: Todas as recomendações usam 100% de Wet Mix para comportamento realista de erro digital. Valores de mix úmido mais baixos podem ser usados para efeitos criativos, mas não representam como erros digitais reais realmente ocorrem.

## Hum Generator

Um efeito que gera ruído de zumbido de energia elétrica de alta precisão e autenticidade com sua estrutura harmônica característica e instabilidades sutis. Perfeito para adicionar zumbido de fundo realista de equipamentos vintage, fontes de alimentação, ou criar aquela sensação autêntica de estar "conectado à rede" que muitas gravações clássicas possuem.

### Guia de Caráter Sonoro
- Ambiente de Equipamento Vintage:
  - Recria o zumbido sutil de amplificadores e equipamentos clássicos
  - Adiciona o caráter de estar "conectado" à energia AC
  - Cria autêntica atmosfera de estúdio vintage
- Características de Fonte de Alimentação:
  - Simula diferentes tipos de ruído de fonte de alimentação
  - Recria características regionais da rede elétrica (50Hz vs 60Hz)
  - Adiciona caráter sutil de infraestrutura elétrica
- Textura de Fundo:
  - Cria presença de fundo orgânica e de baixo nível
  - Adiciona profundidade e "vida" a gravações digitais estéreis
  - Perfeito para produções inspiradas em vintage

### Parâmetros
- **Frequency** - Define a frequência fundamental do zumbido (10-120 Hz)
  - 50 Hz: Padrão da rede elétrica europeia/asiática
  - 60 Hz: Padrão da rede elétrica norte-americana
  - Outros valores: Frequências personalizadas para efeitos criativos
- **Type** - Controla a estrutura harmônica do zumbido
  - Standard: Contém apenas harmônicos ímpares (mais puro, tipo transformador)
  - Rich: Contém todos os harmônicos (complexo, tipo equipamento)
  - Dirty: Harmônicos ricos com distorção sutil (caráter de equipamento vintage)
- **Harmonics** - Controla o brilho e conteúdo harmônico (0-100%)
  - 0-30%: Zumbido quente e suave com harmônicos superiores mínimos
  - 30-70%: Conteúdo harmônico equilibrado típico de equipamentos reais
  - 70-100%: Zumbido brilhante e complexo com harmônicos superiores fortes
- **Tone** - Frequência de corte do filtro de modelagem tonal final (1.0-20.0 kHz)
  - 1-5 kHz: Caráter quente e abafado
  - 5-10 kHz: Tom natural tipo equipamento
  - 10-20 kHz: Caráter brilhante e presente
- **Instability** - Quantidade de variação sutil de frequência e amplitude (0-10%)
  - 0%: Zumbido perfeitamente estável (precisão digital)
  - 1-3%: Instabilidade sutil do mundo real
  - 3-7%: Caráter notável de equipamento vintage
  - 7-10%: Efeitos de modulação criativa
- **Level** - Nível de saída do sinal de zumbido (-80.0 a 0.0 dB)
  - -80 a -60 dB: Presença de fundo quase inaudível
  - -60 a -40 dB: Zumbido sutil mas perceptível
  - -40 a -20 dB: Caráter vintage proeminente
  - -20 a 0 dB: Níveis criativos ou de efeito especial

### Configurações Recomendadas para Diferentes Estilos

1. Amplificador Vintage Sutil
   - Frequency: 50/60 Hz, Type: Standard, Harmonics: 25%
   - Tone: 8.0 kHz, Instability: 1.5%, Level: -54 dB
   - Perfeito para: Adicionar caráter suave de amplificador vintage

2. Estúdio de Gravação Clássico
   - Frequency: 60 Hz, Type: Rich, Harmonics: 45%
   - Tone: 6.0 kHz, Instability: 2.0%, Level: -48 dB
   - Perfeito para: Atmosfera autêntica de estúdio da era analógica

3. Equipamento Vintage com Válvulas
   - Frequency: 50 Hz, Type: Dirty, Harmonics: 60%
   - Tone: 5.0 kHz, Instability: 3.5%, Level: -42 dB
   - Perfeito para: Caráter quente de amplificador valvulado

4. Ambiente da Rede Elétrica
   - Frequency: 50/60 Hz, Type: Standard, Harmonics: 35%
   - Tone: 10.0 kHz, Instability: 1.0%, Level: -60 dB
   - Perfeito para: Fundo realista de fonte de alimentação

5. Efeitos Criativos de Zumbido
   - Frequency: 40 Hz, Type: Dirty, Harmonics: 80%
   - Tone: 15.0 kHz, Instability: 6.0%, Level: -36 dB
   - Perfeito para: Aplicações artísticas e experimentais

## Noise Blender

Um efeito que adiciona textura atmosférica de fundo à sua música, semelhante ao som de discos de vinil ou equipamentos vintage. Perfeito para criar atmosferas aconchegantes e nostálgicas.

### Guia de Caráter Sonoro
- Som de Equipamento Vintage:
  - Recria o calor de equipamentos de áudio antigos
  - Adiciona "vida" sutil a gravações digitais
  - Cria uma sensação vintage autêntica
- Experiência de Disco de Vinil:
  - Adiciona aquela atmosfera clássica de toca-discos
  - Cria uma sensação aconchegante e familiar
  - Perfeito para audição noturna
- Textura Ambiente:
  - Adiciona fundo atmosférico
  - Cria profundidade e espaço
  - Torna a música digital mais orgânica

### Parâmetros
- **Noise Type** - Escolhe o caráter da textura de fundo
  - White: Textura mais brilhante e presente
  - Pink: Som mais quente e natural
- **Level** - Controla quão perceptível é o efeito (-96dB a 0dB)
  - Muito Sutil (-96dB a -72dB): Apenas uma sugestão
  - Suave (-72dB a -48dB): Textura perceptível
  - Forte (-48dB a -24dB): Caráter vintage dominante
- **Per Channel** - Cria um efeito mais espacial
  - On: Som mais amplo e imersivo
  - Off: Textura mais focada e centralizada

## Simple Jitter

Um efeito que adiciona variações sutis de tempo para criar aquele som digital vintage imperfeito. Pode fazer a música soar como se estivesse tocando em tocadores de CD antigos ou equipamentos digitais vintage.

### Guia de Caráter Sonoro
- Sensação Vintage Sutil:
  - Adiciona instabilidade suave como equipamentos antigos
  - Cria um som mais orgânico e menos perfeito
  - Perfeito para adicionar caráter sutilmente
- Som Clássico de CD Player:
  - Recria o som dos primeiros tocadores digitais
  - Adiciona caráter digital nostálgico
  - Ótimo para apreciação de música dos anos 90
- Efeitos Criativos:
  - Crie efeitos únicos de oscilação
  - Transforme sons modernos em vintage
  - Adicione caráter experimental

### Parâmetros
- **RMS Jitter** - Controla a quantidade de variação de tempo (1ps a 10ms)
  - Sutil (1-10ps): Caráter vintage suave
  - Médio (10-100ps): Sensação clássica de CD player
  - Forte (100ps-1ms): Efeitos criativos de oscilação

### Configurações Recomendadas para Diferentes Estilos

1. Quase Imperceptível
   - RMS Jitter: 1-5ps
   - Perfeito para: Adicionar o mais sutil toque de calor analógico às gravações digitais

2. Caráter Clássico de CD Player
   - RMS Jitter: 50-100ps
   - Perfeito para: Recriar o som dos primeiros equipamentos de reprodução digital

3. Máquina DAT Vintage
   - RMS Jitter: 200-500ps
   - Perfeito para: Caráter de equipamentos de gravação digital dos anos 90

4. Equipamento Digital Desgastado
   - RMS Jitter: 1-2ns (1000-2000ps)
   - Perfeito para: Criar o som de equipamentos digitais envelhecidos ou mal conservados

5. Efeito Criativo de Oscilação
   - RMS Jitter: 10-100µs (10000-100000ps)
   - Perfeito para: Efeitos experimentais e modulação de pitch perceptível

## Vinyl Artifacts

Um efeito que recria as características de ruído físico dos discos de vinil analógicos. Este plugin simula os vários artefatos que ocorrem ao reproduzir discos de vinil, desde o ruído de superfície até as características elétricas da cadeia de reprodução.

### Guia de Caráter Sonoro
- Experiência de Disco de Vinil:
  - Recria o som autêntico de reproduzir discos de vinil
  - Adiciona o ruído de superfície característico e artefatos
  - Cria aquela sensação analógica aconchegante e nostálgica
- Sistema de Reprodução Vintage:
  - Simula a cadeia de reprodução analógica completa
  - Inclui características de equalização RIAA
  - Adiciona ruído reativo que responde à música
- Textura Atmosférica:
  - Cria textura de fundo rica e orgânica
  - Adiciona profundidade e caráter às gravações digitais
  - Perfeito para criar experiências de audição aconchegantes e íntimas

### Parâmetros
- **Pops/min** - Controla a frequência de ruídos de clique grandes por minuto (0 a 120)
  - 0-20: Pops suaves ocasionais
  - 20-60: Caráter vintage moderado
  - 60-120: Som de desgaste pesado
- **Pop Level** - Controla o volume dos ruídos de pop (-80.0 a 0.0 dB)
  - -80 a -48 dB: Cliques sutis
  - -48 a -24 dB: Pops moderados
  - -24 a 0 dB: Pops altos (configurações extremas)
- **Crackles/min** - Controla a densidade do ruído de crackling por minuto (0 a 2000)
  - 0-200: Textura de superfície sutil
  - 200-1000: Caráter de vinil clássico
  - 1000-2000: Ruído de superfície pesado
- **Crackle Level** - Controla o volume do ruído de crackling (-80.0 a 0.0 dB)
  - -80 a -48 dB: Crackling sutil
  - -48 a -24 dB: Crackling moderado
  - -24 a 0 dB: Crackling alto (configurações extremas)
- **Hiss** - Controla o nível de ruído de superfície constante (-80.0 a 0.0 dB)
  - -80 a -48 dB: Textura de fundo sutil
  - -48 a -30 dB: Ruído de superfície notável
  - -30 a 0 dB: Chiado proeminente (configurações extremas)
- **Rumble** - Controla o ronco de baixa frequência do toca-discos (-80.0 a 0.0 dB)
  - -80 a -60 dB: Calor sutil nos graves
  - -60 a -40 dB: Ronco notável
  - -40 a 0 dB: Ronco pesado (configurações extremas)
- **Crosstalk** - Controla o vazamento entre canais estéreo esquerdo e direito (0 a 100%)
  - 0%: Separação estéreo perfeita
  - 30-60%: Crosstalk realista de vinil
  - 100%: Vazamento máximo entre canais
- **Noise Profile** - Ajusta a resposta de frequência do ruído (0.0 a 10.0)
  - 0: Reprodução da curva RIAA (resposta de frequência autêntica do vinil)
  - 5: Resposta parcialmente corrigida
  - 10: Resposta plana (bypassed)
- **Wear** - Multiplicador mestre para a condição geral do disco (0 a 200%)
  - 0-50%: Disco bem conservado
  - 50-100%: Desgaste e idade normais
  - 100-200%: Disco muito desgastado
- **React** - Quão responsivo o ruído é ao sinal de entrada (0 a 100%)
  - 0%: Níveis de ruído estáticos
  - 25-50%: Resposta moderada à música
  - 75-100%: Altamente reativo à entrada
- **React Mode** - Seleciona qual aspecto do sinal controla a reação
  - Velocity: Responde ao conteúdo de alta frequência (velocidade da agulha)
  - Amplitude: Responde ao nível geral do sinal
- **Mix** - Controla quanto ruído é adicionado ao sinal seco (0 a 100%)
  - 0%: Nenhum ruído adicionado (apenas sinal seco)
  - 50%: Adição moderada de ruído
  - 100%: Adição máxima de ruído
  - Nota: O nível do sinal seco permanece inalterado; este parâmetro controla apenas a quantidade de ruído


### Configurações Recomendadas para Diferentes Estilos

1. Caráter de Vinil Sutil
   - Pops/min: 20, Pop Level: -48dB, Crackles/min: 200, Crackle Level: -48dB
   - Hiss: -48dB, Rumble: -60dB, Crosstalk: 30%, Noise Profile: 5.0
   - Wear: 25%, React: 20%, React Mode: Velocity, Mix: 100%
   - Perfeito para: Adicionar aquecimento analógico suave

2. Experiência de Vinil Clássica
   - Pops/min: 40, Pop Level: -36dB, Crackles/min: 400, Crackle Level: -36dB
   - Hiss: -36dB, Rumble: -50dB, Crosstalk: 50%, Noise Profile: 4.0
   - Wear: 60%, React: 30%, React Mode: Velocity, Mix: 100%
   - Perfeito para: Experiência autêntica de audição de vinil

3. Disco Muito Desgastado
   - Pops/min: 80, Pop Level: -24dB, Crackles/min: 800, Crackle Level: -24dB
   - Hiss: -30dB, Rumble: -40dB, Crosstalk: 70%, Noise Profile: 3.0
   - Wear: 120%, React: 50%, React Mode: Velocity, Mix: 100%
   - Perfeito para: Caráter de disco muito envelhecido

4. Lo-Fi Ambiental
   - Pops/min: 15, Pop Level: -54dB, Crackles/min: 150, Crackle Level: -54dB
   - Hiss: -42dB, Rumble: -66dB, Crosstalk: 25%, Noise Profile: 6.0
   - Wear: 40%, React: 15%, React Mode: Amplitude, Mix: 100%
   - Perfeito para: Textura ambiental de fundo

5. Vinil Dinâmico
   - Pops/min: 60, Pop Level: -30dB, Crackles/min: 600, Crackle Level: -30dB
   - Hiss: -39dB, Rumble: -45dB, Crosstalk: 60%, Noise Profile: 5.0
   - Wear: 80%, React: 75%, React Mode: Velocity, Mix: 100%
   - Perfeito para: Ruído que responde dramaticamente à música

Lembre-se: Esses efeitos são feitos para adicionar caráter e nostalgia à sua música. Comece com configurações sutis e ajuste ao gosto!
