---
title: "Plugins Lo-Fi - EffeTune"
description: "Plugins de efeito lo-fi, incluindo Bit Crusher, Noise Blender, Vinyl Artifacts e outros."
lang: pt
---

# Plugins Lo-Fi

Uma coleção de plugins que adicionam caráter vintage e qualidades nostálgicas à sua música. Esses efeitos podem fazer a música digital moderna soar como se estivesse sendo reproduzida em equipamentos clássicos ou dar aquele popular som "lo-fi" que é relaxante e atmosférico.

## Lista de Plugins

- [Bit Crusher](#bit-crusher) - Cria sons de jogos retrô e digitais vintage
- [Digital Error Emulator](#digital-error-emulator) - Simula vários erros de transmissão de áudio digital
- [DSD64 IMD Simulator](#dsd64-imd-simulator) - Simula a distorção de intermodulação audível causada pelo ruído ultrassônico do DSD64
- [Hum Generator](#hum-generator) - Adiciona ambiência controlável de hum elétrico para escuta vintage/lo-fi
- [Noise Blender](#noise-blender) - Adiciona textura atmosférica de fundo
- [Simple Jitter](#simple-jitter) - Cria imperfeições digitais vintage sutis
- [Vinyl Artifacts](#vinyl-artifacts) - Adiciona estalos, crackle, hiss, rumble e vazamento de ruído estéreo no estilo vinil
- [Vinyl Simulator](#vinyl-simulator) - Grava a entrada em um sulco modelado e a reproduz com uma agulha física simulada

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
  - 0%: Sem diferença de peso de bits do DAC; Random Seed não tem efeito audível
  - 0.1-1%: Coloração digital sutil de DAC
  - 1-3%: Imperfeições clássicas de hardware
  - 3-10%: Caráter lo-fi criativo
- **Random Seed** - Controla a unicidade das imperfeições (0 a 1000)
  - Muda o padrão fixo de imperfeição usado por Bit Error
  - Só é audível quando Bit Error está acima de 0%
  - O mesmo valor sempre recria o mesmo padrão de imperfeição

## Digital Error Emulator

Um efeito que simula o som de erros de transmissão de áudio digital, de cliques discretos de interface a imperfeições de tocadores de CD vintage e quedas em áudio sem fio. Use quando quiser caráter digital nostálgico ou uma textura de glitch evidente na escuta.

### Guia de Caráter Sonoro
- Caráter Sutil de Reprodução Digital:
  - Simula artefatos de transmissão S/PDIF, AES3 e MADI
  - Adiciona imperfeições digitais ocasionais e discretas
  - Útil quando a reprodução limpa parece perfeita demais
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
  - AES3/S-PDIF: Erros de bit de interface digital com retenção de amostra
  - ADAT/TDIF/MADI: Erros de rajada multicanal (retenção ou silêncio)
  - HDMI/DP: Corrupção de linha de áudio de display ou silenciamento
  - USB/FireWire/Thunderbolt: Dropouts de microframe com interpolação
  - Dante/AES67/AVB: Perda de pacotes de áudio de rede (64/128/256 amostras)
  - Bluetooth A2DP/LE: Erros de transmissão sem fio com ocultação
  - WiSA: Erros de blocos FEC de alto-falantes sem fio
  - RF Systems: Silenciamento de radiofrequência e interferência
  - CD Audio: Simulação de correção de erro CIRC
  - Padrão: CD Audio — CIRC Error Correction (Interpolated)
- **Reference Fs (kHz)** - Define a taxa de amostragem de referência usada apenas pelos modos Dante / AES67 / AVB de perda de pacotes para escalar o comprimento de pacote de 64/128/256 amostras
  - Taxas disponíveis: 44.1, 48, 88.2, 96, 176.4, 192 kHz
  - Outros modos usam timing próprio, fixo ou baseado na taxa de amostragem atual
  - Padrão: 48 kHz
- **Wet Mix** - Controla a mistura entre áudio original e processado (0-100%)
  - Nota: Para simulação realista de erro digital, manter em 100%
  - Valores mais baixos criam erros "parciais" irreais que não ocorrem em sistemas digitais reais
  - Padrão: 100% (comportamento autêntico de erro digital)

### Detalhes dos Modos

**Interfaces Digitais:**
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

1. Caráter Sutil de Reprodução Digital
   - Mode: AES3 / S-PDIF (I²S) — Bit Error (Hold), BER: 10^-8, Fs: 48kHz, Wet: 100%
   - Perfeito para: Adicionar imperfeições digitais ocasionais e discretas

2. Experiência Clássica de Tocador de CD
   - Mode: CD Audio — CIRC Error Correction (Interpolated), BER: 10^-7, Fs: 44.1kHz, Wet: 100%
   - Perfeito para: Nostalgia de música digital dos anos 90

3. Glitches de Streaming Moderno
   - Mode: Dante / AES67 / AVB — UDP Drop (128 samp), BER: 10^-6, Fs: 48kHz, Wet: 100%
   - Perfeito para: Imperfeições da vida digital contemporânea

4. Experiência de Audição Bluetooth
   - Mode: Bluetooth A2DP — Digital Transmission, BER: 10^-6, Fs: 48kHz, Wet: 100%
   - Perfeito para: Memórias de áudio sem fio

5. Textura de Queda Sem Fio
   - Mode: WMAS / DECT / Axient — RF Squelch, BER: 10^-5, Fs: 48kHz, Wet: 100%
   - Perfeito para: Interrupções evidentes no estilo rádio e textura de glitch

Nota: Todas as recomendações usam 100% de Wet Mix para comportamento realista de erro digital. Valores de mix úmido mais baixos podem ser usados para efeitos criativos, mas não representam como erros digitais reais realmente ocorrem.

## DSD64 IMD Simulator

Um efeito que recria um efeito colateral sutil e frequentemente debatido da reprodução em DSD64: o ruído ultrassônico que o DSD carrega acima da faixa audível pode, por meio das pequenas imperfeições de DACs, amplificadores e alto-falantes reais, gerar distorção de intermodulação (IMD) — aspereza e tons extras que retornam para a faixa que você consegue ouvir. Este efeito reproduz esse resultado audível para que você possa ouvi-lo e ajustá-lo. Trata-se de uma simulação e não gera um fluxo DSD real.

**Este efeito requer uma taxa de amostragem de 88.2 kHz ou superior** (88.2 / 96 / 176.4 / 192 kHz). A 44.1 / 48 kHz ele não funciona e é desativado (o sinal seco passa inalterado), com a exibição de um aviso. Defina a taxa de amostragem para 88.2 kHz ou superior nas configurações de áudio do aplicativo para usar este efeito.

### Guia de Caráter Sonoro
- "Aspereza digital" muito sutil: um leve e constante piso de ruído arenoso somado a uma dureza fina que acompanha a música.
- Ferramenta de demonstração: torna audível e ajustável a IMD ultrassônica do DSD64, normalmente inaudível.
- Textura criativa: com valores mais altos de Amount e Analog Nonlinearity, torna-se um evidente efeito lo-fi de aspereza/borda.

### Parâmetros

Parâmetros principais
- **Amount** (-40.0 a +50.0 dB) - Nível geral da distorção gerada.
- **Dry-Wet** (100:0 a 0:100) - Equilíbrio entre o sinal seco e a distorção gerada, exibido como uma proporção dry:wet. 100:0 = apenas seco; 100:100 (central) = sinal seco completo somado à distorção completa; 0:100 = apenas distorção.
- **Ultrasonic Level** (-48.0 a -18.0 dBFS RMS) - Nível do ruído ultrassônico DSD simulado. Mais ruído produz mais distorção.
- **Noise Color** (-100 a +100%) - Desloca o ruído ultrassônico para frequências mais baixas ou mais altas e inclina seu equilíbrio.
- **Analog Nonlinearity** (0.00 a 10.00%) - Quão imperfeito (não linear) é o equipamento analógico simulado. Valores mais altos produzem mais distorção.
- **Even Bias** (0 a 100%) - Equilibra a composição da distorção. Valores baixos favorecem a distorção que acompanha a música (Attached); valores altos favorecem a distorção constante, semelhante a ruído (Additive), além do componente Cross.
- **Signal Coupling** (0 a 200%) - Intensidade da distorção dependente da música (Attached e Cross). Em 0, resta apenas o ruído Additive constante.
- **IMD Path HPF** (0.0 a 8.0 kHz) - Limita a geração de distorção às frequências acima deste ponto. 0.0 = Off (faixa completa, como um amplificador); em torno de 2.5 kHz emula um sistema em que apenas o tweeter produz a distorção. O sinal seco nunca é afetado.
- **Scratch Tone** (3.0 a 14.0 kHz) - Frequência central do caráter audível de "aspereza".

Parâmetros avançados / utilitários
- **Noise Texture** (0 a 100%) - Adiciona uma ondulação ressonante ao ruído ultrassônico para uma textura ligeiramente diferente.
- **Cross Sideband** (0 a 100%) - Quantidade de distorção criada pela mistura da música com o ruído ultrassônico.
- **Output Trim** (-24.0 a +12.0 dB) - Ajuste final do nível de saída.

### Visualizações
- **Medidores Term Contribution** - Níveis em tempo real de cada parte do efeito:
  - **Additive** - a distorção constante apenas de ruído, presente mesmo sem entrada.
  - **Attached** - distorção que se prende e acompanha a música.
  - **Cross** - distorção da mistura da música com o ruído ultrassônico.
  - **Total IMD** - a distorção combinada que é gerada.
  - **Output** - o nível final de saída (seco mais distorção, após Dry-Wet e Output Trim).
- **Analog Transfer Curve** - Mostra a curva de distorção criada por Analog Nonlinearity e Even Bias, no mesmo estilo de entrada/saída dos plugins de Saturation.
- **Visualização Difference-Frequency** - Um gráfico estático que mostra quais frequências audíveis o ruído ultrassônico produz, com base nas configurações de ruído atuais.

### Configurações Recomendadas
- Sutil (padrão): Amount +24 dB, Ultrasonic Level -30 dBFS, Analog Nonlinearity 1.40%, Even Bias 20%, Signal Coupling 150%, Cross Sideband 75%, Scratch Tone 10.5 kHz.
- IMD apenas no tweeter: IMD Path HPF 2.5 kHz, Signal Coupling 80–150%, Cross Sideband 50–100%, Scratch Tone 9–14 kHz.
- Efeito evidente: aumente Amount, Ultrasonic Level e Analog Nonlinearity.

## Hum Generator

Adiciona uma camada controlável de hum elétrico de 50/60 Hz para uma escuta vintage ou lo-fi. Use níveis baixos quando a reprodução limpa parecer estéril demais, ou aumente Level para um hum evidente, quase de efeito sonoro.

### Guia de Caráter Sonoro
- Ambiente de Equipamento Vintage:
  - Recria o zumbido sutil de amplificadores e equipamentos clássicos
  - Adiciona o caráter de estar "conectado" à energia AC
  - Cria uma atmosfera de reprodução vintage
- Características de Fonte de Alimentação:
  - Simula diferentes tipos de ruído de fonte de alimentação
  - Recria características regionais da rede elétrica (50Hz vs 60Hz)
  - Adiciona caráter sutil de infraestrutura elétrica
- Textura de Fundo:
  - Cria presença de fundo orgânica e de baixo nível
  - Adiciona profundidade e "vida" a uma reprodução muito limpa
  - Útil para uma escuta com clima vintage ou lo-fi

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
  - No modo Dirty, valores mais altos de Harmonics também aumentam a distorção e a aspereza
- **Tone** - Frequência de corte do filtro de modelagem tonal final (1.0-20.0 kHz)
  - 1-5 kHz: Caráter quente e abafado
  - 5-10 kHz: Tom natural tipo equipamento
  - 10-20 kHz: Caráter brilhante e presente
- **Instability** - Quantidade de variação sutil de frequência e amplitude (0-10%)
  - 0%: Zumbido perfeitamente estável (precisão digital)
  - 1-3%: Leve deriva natural
  - 3-10%: Oscilação mais perceptível, mas ainda suave
- **Level** - Nível de saída do sinal de zumbido (-80.0 a 0.0 dB)
  - -80 a -60 dB: Presença de fundo quase inaudível
  - -60 a -40 dB: Zumbido sutil mas perceptível
  - -40 a -20 dB: Caráter vintage proeminente
  - -20 a 0 dB: Níveis criativos ou de efeito especial

### Configurações Recomendadas para Diferentes Estilos

1. Amplificador Vintage Sutil
   - Frequency: 50/60 Hz, Type: Standard, Harmonics: 25%
   - Tone: 8.0 kHz, Instability: 1.5%, Level: -54 dB
   - Perfeito para: Adicionar caráter suave de reprodução vintage

2. Reprodução Vintage Clássica
   - Frequency: 60 Hz, Type: Rich, Harmonics: 45%
   - Tone: 6.0 kHz, Instability: 2.0%, Level: -48 dB
   - Perfeito para: Ambiência elétrica de fundo de equipamentos de reprodução antigos

3. Equipamento Vintage com Válvulas
   - Frequency: 50 Hz, Type: Dirty, Harmonics: 60%
   - Tone: 5.0 kHz, Instability: 3.5%, Level: -42 dB
   - Perfeito para: Caráter quente de amplificador valvulado

4. Ambiente da Rede Elétrica
   - Frequency: 50/60 Hz, Type: Standard, Harmonics: 35%
   - Tone: 10.0 kHz, Instability: 1.0%, Level: -60 dB
   - Perfeito para: Fundo realista de fonte de alimentação

5. Textura de Hum Mais Forte
   - Frequency: 40 Hz, Type: Dirty, Harmonics: 80%
   - Tone: 15.0 kHz, Instability: 6.0%, Level: -36 dB
   - Perfeito para: Uma textura de hum mais forte e audível

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
  - Brown: Textura mais profunda e suave, com mais peso nos graves
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
   - Perfeito para: Fazer a reprodução parecer um pouco menos perfeitamente digital

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
   - RMS Jitter: 10-100µs (0.01-0.1ms)
   - Perfeito para: Efeitos experimentais e modulação de pitch perceptível

## Vinyl Artifacts

Um efeito que adiciona artefatos de reprodução no estilo vinil, como pops, crackle, hiss, rumble e ruído de superfície reativo. Ele adiciona ruído de disco gerado à música; não altera o tom do sinal musical original como um modelo completo de toca-discos, cápsula ou pré de phono.

### Guia de Caráter Sonoro
- Experiência de Disco de Vinil:
  - Recria o som autêntico de reproduzir discos de vinil
  - Adiciona o ruído de superfície característico e artefatos
  - Cria aquela sensação analógica aconchegante e nostálgica
- Sistema de Reprodução Vintage:
  - Adiciona artefatos de reprodução gerados ao redor da música
  - Modela o tom do ruído de vinil gerado
  - Adiciona ruído reativo que pode responder à música
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
- **Crosstalk** - Mistura o ruído de artefatos gerado entre os canais esquerdo e direito; o sinal musical original mantém sua separação estéreo (0 a 100%)
  - 0%: O ruído gerado mantém sua separação original entre canais
  - 30-60%: Vazamento de ruído realista no estilo vinil
  - 100%: O ruído gerado fica quase igual entre esquerda e direita
- **Noise Profile** - Ajusta a resposta de frequência do ruído gerado (0.0 a 10.0)
  - 0: Tom de ruído mais escuro e quente
  - 5: Tom de ruído parcialmente modelado
  - 10: Tom de ruído plano / modelagem tonal em bypass
- **Wear** - Escala artefatos de desgaste de superfície, como pops, crackles e hiss (0 a 200%)
  - 0-50%: Ruído de superfície mais limpo
  - 50-100%: Desgaste normal da superfície
  - 100-200%: Ruído de superfície muito desgastada
  - Rumble, Crosstalk e Noise Profile são controlados separadamente
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
   - Perfeito para: Adicionar textura suave de superfície de vinil

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

## Vinyl Simulator

O Vinyl Simulator transforma a própria música por meio de um modelo físico de corte e reprodução. Ele aplica filtros de corte e a curva RIAA de gravação, escreve o sinal em um sulco com rugosidade e detritos, segue esse sulco com uma simulação mecânica de agulha e braço e aplica a equalização RIAA de reprodução. Use-o quando quiser que geometria do sulco, rastreamento e superfície interajam com a música.

### Diferença para o Vinyl Artifacts

- **Vinyl Simulator** altera o sinal ao passá-lo pelo sulco e pela agulha modelados. Roughness, Dust, Static, Tracking Force, formato da agulha, Speed e Radius participam do resultado.
- **Vinyl Artifacts** mantém a música intacta e adiciona pops, crackle, hiss, rumble e vazamento de ruído. É a opção mais leve e previsível, ou a alternativa sem WASM.
- Os dois podem ser combinados, mas ajustes fortes de superfície em ambos acumulam cliques e ruído rapidamente.

### Guia de aprimoramento sonoro

- **Reprodução suave:** Cut Level perto de 0 dB, Shape em Elliptical, Roughness moderado, pouco Dust e Static e Mix menor para preservar mais do original.
- **Caráter de sulco interno:** aproxime Radius de 60 mm. A menor velocidade linear exige mais do rastreamento e dos agudos.
- **Reprodução limpa e estável:** reduza Roughness, Dust, Static e Scratch, mantenha Tracking Force perto de 2 g e use Standard ou High.
- **Superfície envelhecida:** aumente primeiro Roughness e depois Dust, Static e um pouco de Scratch; cada controle representa um fenômeno físico diferente.
- **Coloração mais evidente:** aumente Cut Level com cuidado, reduza HF Cutoff ou Radius. Observe a queda de Tracking S/E e o aumento de mistrack/skip.
- O efeito não inclui wow/flutter, excentricidade, empenamento nem rumble do toca-discos. Adicione **Wow Flutter** à cadeia se necessário.

### Parâmetros

#### Cutting

- **Cut Level** (-20 a +20 dB) — Intensidade com que a entrada aciona o cortador. Mais nível acentua deslocamento e não linearidade; menos deixa maior margem mecânica.
- **HF Cutoff** (6000 a 24000 Hz) — Limite de agudos antes do corte. Mais baixo escurece e facilita o rastreamento; mais alto preserva detalhes e exige mais da agulha.
- **Bass Mono Below** (50 a 1000 Hz) — Faixa em que o componente Side é reduzido. Valores maiores centralizam mais os graves.
- **Side Mix** (0 a 100%) — Side mantido abaixo de Bass Mono Below. 0% torna essa faixa mono; 100% preserva o Side original.

#### Record

- **Speed** (33⅓, 45 ou 78 rpm) — Velocidade de rotação. No mesmo Radius, maior velocidade aumenta a velocidade linear e facilita detalhes finos.
- **Radius** (60 a 146 mm) — Posição da agulha. Valores pequenos representam o sulco interno, mais lento e difícil nos agudos.
- **Roughness** (0,1 a 100 nm) — Rugosidade microscópica; aumentá-la reforça a textura contínua de superfície.
- **Dust** (0 a 10000/s) — Frequência de partículas de poeira e perturbações breves.
- **Static** (0 a 10000/s) — Frequência de descargas elétricas, adicionadas como pops na saída da cápsula.
- **Scratch** (0 a 1000/s) — Frequência de defeitos maiores no sulco.

#### Stylus

- **Shape** (Spherical ou Elliptical) — Geometria de contato. Em Spherical, Scan Radius acompanha Side Radius. A mudança reconstrói a simulação.
- **Side Radius** (5 a 25 µm) — Raio transversal à parede; altera a área e a pressão de contato.
- **Scan Radius** (2 a 25 µm) — Raio no sentido do sulco. Pequeno segue detalhes finos; grande faz média em um contato mais amplo.
- **Tracking Force** (0,5 a 5,0 g) — Força de apoio. Mais pode estabilizar o contato, mas aumenta força e pressão; pouca favorece mistrack e skip.
- **Tip Mass** (0,1 a 1,5 mg) — Massa móvel da ponta. Mais massa adiciona inércia e dificulta movimentos rápidos.
- **Compliance** (5 a 35 cu) — Flexibilidade da suspensão. Valores altos permitem mais movimento e mudam a resposta mecânica.
- **Damping** (0,05 a 1,0 ζ) — Amortecimento de ressonâncias. Valores altos reduzem mais o ringing.

#### Output

- **Quality** (Eco, Standard, High ou Ultra) — Define o número base de subpassos físicos e pontos de contato. Para estabilizar a ressonância de contato, o mecanismo pode aumentar automaticamente os subpassos efetivos conforme a taxa de amostragem, Tracking Force, Tip Mass, Compliance, Shape, Side Radius e Scan Radius. Standard é o padrão em tempo real; a mudança reconstrói a simulação.
- **Output Gain** (-24 a +24 dB) — Nível após equalização RIAA e normalização.
- **Mix** (0 a 100%) — Mistura a reprodução simulada com o sinal seco alinhado em latência. 0% = seco; 100% = simulado.

### Como ler o HUD

- **Force L/R (mN):** força em cada parede; valores altos ou desiguais indicam um trecho exigente.
- **Pressure (GPa):** maior pressão de contato atual; leia junto com Force ao ajustar a agulha.
- **Tip (cm/s, dB):** velocidade da ponta e nível de reprodução resultante.
- **Tracking S/E L/R (dB):** relação entre sinal rastreado e erro. Mais alto é mais limpo; queda persistente indica dificuldade.
- **Jitter (ns):** variação de tempo no ponto de leitura, visível em Stylus.
- **Mistrack, Skip, Static Pop e Dust Hit (/s):** taxas recentes, com flash em cada evento. Se repetirem, reduza Cut Level, aumente Tracking Force moderadamente, Radius ou Quality.

O HUD é ativado pela telemetria DSP nativa. Com a reprodução parada ou a telemetria suspensa para economizar energia, ele pode mostrar estado ocioso.

### Configurações recomendadas

1. **Reprodução suave:** Cut Level 0 dB, HF Cutoff 16 kHz, 33⅓ rpm, Radius 120 mm, Roughness 5 nm, Dust 0,5/s, Static 0,02/s, Scratch 0/s, Elliptical, Tracking Force 2,0 g, Standard, Mix 75%.
2. **Sulco externo clássico:** Cut Level 0 dB, 33⅓ rpm, Radius 135 mm, Roughness 13,17 nm, Dust 2/s, Static 0,08/s, Elliptical, Tracking Force 2,0 g, Standard, Mix 100%.
3. **Demonstração interna:** Cut Level +3 dB, HF Cutoff 14 kHz, Radius 60 mm, Elliptical, Scan Radius 8 µm, Tracking Force 2,0 g, High, Mix 100%; compare Tracking S/E com Radius maior.
4. **Superfície gasta:** Radius 100 mm, Roughness 35 nm, Dust 25/s, Static 1/s, Scratch 0,5/s, Tracking Force 2,2 g, Standard, Output Gain -3 dB, Mix 100%.

### Quality e carga de CPU

Cada preset Quality define subpassos base e pontos de contato. Para manter a estabilidade, o mecanismo também calcula `Nmin = ceil(8 × f_c / sampleRate)`, em que a frequência de ressonância de contato `f_c` depende de Tracking Force, Tip Mass, Compliance, Shape, Side Radius e Scan Radius, e usa `effectiveSubsteps = max(base, Nmin)`. Com os ajustes padrão, Standard a 96 kHz permanece na base de 4 subpassos; portanto, a meta de desempenho existente não muda.

A carga principal é proporcional a taxa de amostragem × subpassos efetivos × pontos de contato. As avaliações e cargas relativas da tabela são estimativas base para quando o piso de estabilidade não aumenta os subpassos, e não percentuais de CPU medidos; processador, navegador e WASM SIMD também afetam o resultado.

| Quality | Detalhe base | Avaliações base a 96 kHz | Carga relativa base | Uso |
|---|---:|---:|---:|---|
| Eco | 2 × 7 | 2,7 milhões/s | 0,39× | Celular, baixo consumo, várias instâncias |
| Standard | 4 × 9 | 6,9 milhões/s | 1,00× | Audição normal em tempo real |
| High | 8 × 13 | 20 milhões/s | 2,89× | Sistemas rápidos, comparação detalhada |
| Ultra | 20 × 25 | 96 milhões/s | 13,89× | Renderização offline e verificação |

Quando o piso de estabilidade está inativo, aplique à carga relativa base estes multiplicadores: 44,1 kHz = 0,46×; 48 = 0,50×; 88,2 = 0,92×; 96 = 1,00×; 176,4 = 1,84×; 192 = 2,00×. A taxa de amostragem e os ajustes Tracking Force, Tip Mass, Compliance, Shape, Side Radius e Scan Radius podem ativar o piso e elevar a carga real acima desta estimativa base. Se houver falhas, reduza primeiro Quality.

### Requisito de WASM e limites

O Vinyl Simulator exige o núcleo DSP WebAssembly nativo em tempo real. Se WASM estiver desativado com `?dsp=off`, não for compatível ou falhar ao iniciar, a entrada passa sem alteração e a interface informa que WASM é necessário. A simulação JavaScript de referência, muito mais lenta, não é usada como fallback.

O modelo processa o primeiro par estéreo. A deformação da poeira dura apenas enquanto cada partícula está ativa, e a agulha sempre avança por sulco recém-gerado; o desgaste não se acumula entre voltas nem é salvo em presets. Desgaste de longo prazo, visualização 3D, medidores SNR/THD em tempo real, wow/flutter, excentricidade, empenamento, rumble do toca-discos e carga elétrica da cápsula ficam fora do modelo.

Lembre-se: Esses efeitos são feitos para adicionar caráter e nostalgia à sua música. Comece com configurações sutis e ajuste ao gosto!
