---
title: "Plugins Lo-Fi - EffeTune"
description: "Plugins de efeito lo-fi, incluindo AM Radio Simulator, Bit Crusher, Noise Blender, Vinyl Artifacts e outros."
lang: pt
---

# Plugins Lo-Fi

Uma coleção de plugins que adicionam caráter vintage e qualidades nostálgicas à sua música. Esses efeitos podem fazer a música digital moderna soar como se estivesse sendo reproduzida em equipamentos clássicos ou dar aquele popular som "lo-fi" que é relaxante e atmosférico.

## Lista de Plugins

- [AM Radio Simulator](#am-radio-simulator) - Passa a música por uma cadeia modelada de transmissão e recepção AM
- [Bit Crusher](#bit-crusher) - Cria sons de jogos retrô e digitais vintage
- [Digital Error Emulator](#digital-error-emulator) - Simula vários erros de transmissão de áudio digital
- [DSD64 IMD Simulator](#dsd64-imd-simulator) - Simula a distorção de intermodulação audível causada pelo ruído ultrassônico do DSD64
- [FM Radio Simulator](#fm-radio-simulator) - Passa a música por uma cadeia de transmissão e recepção FM simulada fisicamente
- [Hum Generator](#hum-generator) - Adiciona ambiência controlável de hum elétrico para escuta vintage/lo-fi
- [Noise Blender](#noise-blender) - Adiciona textura atmosférica de fundo
- [Simple Jitter](#simple-jitter) - Cria imperfeições digitais vintage sutis
- [Vinyl Artifacts](#vinyl-artifacts) - Adiciona estalos, crackle, hiss, rumble e vazamento de ruído estéreo no estilo vinil
- [Vinyl Simulator](#vinyl-simulator) - Grava a entrada em um sulco modelado e a reproduz com uma agulha física simulada

## AM Radio Simulator

O AM Radio Simulator transforma a música por meio de uma cadeia modelada de radiodifusão AM: processamento e modulação do transmissor, propagação por onda terrestre e ionosférica, estática e interferência de canal adjacente, sintonia, detecção e AGC do receptor, além de um alto-falante de rádio opcional. Use-o para comparar uma estação local forte com um sinal noturno distante e sujeito a desvanecimento, explorar uma faixa congestionada ou aplicar à música a limitação de banda, a distorção, o desvanecimento e a interferência próprios da recepção AM.

Este efeito requer um ambiente compatível com seu processamento em tempo real. Quando esse processamento não está disponível, o áudio permanece inalterado e o HUD informa que o efeito está indisponível.

### Diferenças em relação aos efeitos lo-fi aditivos

- O **AM Radio Simulator** altera o próprio sinal de entrada, modulando-o e submetendo-o à propagação, filtragem e detecção. A estática, a interferência e o hum entram em pontos modelados da cadeia de rádio e, por isso, interagem com a sintonia, o filtro IF e o AGC.
- O **Noise Blender** adiciona um ruído de fundo genérico, enquanto o **Hum Generator** acrescenta uma camada de hum ajustável. Escolha-os quando quiser apenas esses sons, sem transformar a música por meio de um receptor de rádio.
- O **Vinyl Artifacts** adiciona ruído de superfície de disco sem alterar o sinal musical original. O **Vinyl Simulator** também transforma o sinal usando um modelo físico, mas simula um sulco e uma agulha, não uma transmissão de rádio.

### Guia de aprimoramento sonoro

- **Transmissão local clara:** use Signal forte, pouco Skywave e Static, centralize Tuning e amplie IF Bandwidth. Selecione Table para uma resposta de rádio mais encorpada ou Off para saída de linha.
- **Estação noturna distante:** reduza Signal, aumente Skywave e use Fading Speed moderado. AGC Speed em Slow torna a recuperação do nível mais gradual, enquanto Static adiciona rajadas ocasionais semelhantes a raios distantes.
- **Faixa congestionada:** aumente Interference e ajuste Interf. Offset para 9 ou 10 kHz. Um IF Bandwidth estreito rejeita melhor a estação adjacente; pequenos ajustes em Tuning alteram quanto dela chega ao detector.
- **Sobrecarga de transmissão:** aumente Mod Depth acima de 100% ou prolongue Detector RC para ouvir a sobremodulação e a distorção por corte diagonal próprias do AM. Reduza um dos dois para uma recepção mais limpa.
- **Profundidade do desvanecimento:** novas instâncias usam Skywave em 1% para proporcionar variações de nível mais calmas em Mono e um desvanecimento noturno menos acentuado. Eleve Skywave para cerca de 8% quando quiser um desvanecimento claramente mais profundo; valores maiores intensificam ainda mais o efeito.
- Comece com Mix em 100% ao avaliar o modelo de rádio. Reduza-o apenas se quiser preservar deliberadamente parte da imagem estéreo original.

### Mistura C-QUAM e modelo de Static

Em C-QUAM, a mistura estéreo automática observa perdas de sinal qualificadas em dois eixos ortogonais do receptor: o sinal de soma decodificado e a região do piloto de 25 Hz do sinal de diferença em quadratura. O efeito do AGC é removido das duas observações, e a qualidade só diminui quando a perda coincide nos dois eixos. Essa regra de coincidência evita que mudanças normais do programa em apenas um eixo sejam confundidas com um desvanecimento de RF. A observação só funciona enquanto o PLL está em TRACK e o piloto é aceito; nos demais casos, ela é apagada.

O valor padrão de Skywave para novas instâncias é 1%, adotado depois que as verificações integradas do modelo foram aprovadas. Presets salvos mantêm o valor de Skywave armazenado explicitamente. Em comparação com 8%, o ajuste de 1% produz em Mono variações de nível mais calmas e desvanecimentos menos profundos; selecione cerca de 8% para simular um desvanecimento noturno mais severo.

A faixa validada e congelada da resposta de qualidade começa em Fading Speed 0.05 Hz. Uma atenuação que varie muito mais devagar que a constante de queda de 60 s da referência adaptativa é incorporada a essa referência e, intencionalmente, não é mantida como perda contínua de qualidade. A tolerância residual de programa de 0.75 dB, o deslocamento de razão de 0.04, a banda de observação do piloto Q=4, as constantes de tempo de qualidade de 0.05/0.2/0.5/60 s e a zona morta de 0.5 dB com intervalo de transição de 5.0 dB são calibrações empíricas do simulador, não especificações gerais dos receptores C-QUAM.

Essa observação fiel ao receptor compartilha com o hardware C-QUAM baseado em piloto uma ambiguidade dependente do programa. Se o programa contiver ao mesmo tempo energia de diferença perto de 25 Hz e uma soma/DC assimétrica, o término simultâneo dos dois componentes poderá reduzir brevemente a mistura estéreo, pois apresenta ao receptor os mesmos indícios de um desvanecimento de RF. Da mesma forma, um resíduo coerente em oposição de fase pode reduzir a observação de qualidade enquanto o PLL permanece em TRACK e o piloto continua aceito. Esses são comportamentos intencionais dentro dos limites aprovados do modelo, não defeitos.

Os eventos Static usam uma calibração de área vetorial relativa à portadora. Cada evento parte de uma área de 20.0 µs referida à portadora nominal da estação desejada, com distribuição uniforme empírica de 0.5 a 1.5 e fase aleatória. Os eventos são agendados por prazos absolutos em precisão dupla, não por uma contagem regressiva de amostras arredondada; assim, o tempo permanece contínuo entre blocos de renderização e vários eventos que vencem na mesma amostra são acumulados. A escala de 20.0 µs e sua distribuição são calibrações empíricas do simulador.

### Parâmetros

#### Station

- **Stereo Mode** (Mono ou C-QUAM) - Mono usa um receptor tradicional com detector de envoltória. C-QUAM oferece recepção estéreo, com relação sinal/ruído menor em estéreo do que em mono, e faz a transição automática para mono quando o sinal está fraco ou fora de sintonia. Como o receptor usa um método de detecção fisicamente diferente, a troca de modo também pode alterar o timbre; Detector RC e seu corte diagonal só se aplicam a Mono e não têm efeito em C-QUAM. O estéreo C-QUAM funciona com taxas de amostragem de até 192 kHz; acima disso, a recepção é mono. A simulação modela apenas o limite de fase de modulação C-QUAM c(5) da FCC, e não um teste completo de conformidade.
- **TX Bandwidth** (2.0 a 10.0 kHz) - Define a largura de banda de áudio do transmissor. Valores baixos produzem um som mais escuro e limitado; valores altos preservam mais detalhes.
- **Pre-emphasis** (0 a 100%) - Reforça as frequências altas antes da transmissão. Ajustes maiores acrescentam presença, mas também fazem os picos brilhantes acionarem mais a cadeia de transmissão.
- **Mod Depth** (10 a 125%) - Define a profundidade da modulação AM. Acima de 100%, surgem sobremodulação e corte dos picos negativos.
- **Compression** (0 a 20 dB) - Define a intensidade do limitador de transmissão. Ajustes maiores contêm os picos e deixam a modulação mais uniforme.

#### Path

- **Signal** (-50 a 0 dB) - Define a intensidade do sinal recebido. Sinais fracos expõem mais ruído do receptor e exigem mais ganho de AGC.
- **Skywave** (0 a 100%) - Mistura a onda terrestre estável com trajetos ionosféricos atrasados. Novas instâncias começam em 1% para um movimento suave; cerca de 8% produz um desvanecimento noturno mais severo, e valores maiores aprofundam o desvanecimento seletivo.
- **Fading Speed** (0.05 a 2.0 Hz) - Define a rapidez com que as condições da propagação ionosférica variam.
- **Static** (0 a 100/s) - Define a frequência de eventos de estática semelhantes a raios. Cada evento relativo à portadora segue um cronograma de tempo absoluto e ressoa pelo filtro IF, em vez de ser adicionado após a recepção.
- **Interference** (-80 a 0 dB) - Define a intensidade da estação adjacente. -80 dB a desativa; quanto mais próximo de 0 dB, mais forte ela fica.
- **Interf. Offset** (5 a 10 kHz) - Define o espaçamento da estação adjacente e a frequência de batimento das portadoras resultante. 9 e 10 kHz são espaçamentos de canal comuns.

#### Receiver

- **Tuning** (-30.0 a +30.0 kHz) - Desloca a sintonia em relação à estação desejada. Pequenos desvios reduzem a clareza e aumentam a distorção do filtro assimétrico; com desvios grandes, a estação fica encoberta pelo ruído do receptor.
- **IF Bandwidth** (2.0 a 20.0 kHz) - Define a largura total da banda passante IF do receptor. Uma banda estreita rejeita mais ruído e interferência, mas remove mais agudos; uma banda larga preserva mais detalhes.
- **AGC Speed** (Slow, Mid ou Fast) - Define a rapidez com que o controle automático de ganho acompanha as mudanças do sinal. Slow produz recuperação e bombeamento mais graduais; Fast controla melhor os desvanecimentos rápidos.
- **Detector RC** (20 a 500 µs) - Define o tempo de descarga do detector de envoltória. Valores longos suavizam mais a envoltória, mas aumentam a distorção por corte diagonal nos agudos quando a modulação é intensa.
- **Hum** (-80 a -20 dB) - Define o hum da fonte de alimentação. -80 dB o desativa. Diferentemente de uma camada de hum adicionada, a maior parte deste efeito modula o ganho do receptor antes da detecção.
- **Hum Freq** (50 ou 60 Hz) - Seleciona a frequência da rede elétrica simulada.

#### Output

- **Speaker** (Off, Small ou Table) - Seleciona saída de linha, a resposta limitada de um rádio de bolso ou a resposta mais encorpada de um rádio de mesa.
- **Output Gain** (-24 a +24 dB) - Ajusta o nível depois do processamento do receptor e do alto-falante.
- **Mix** (0 a 100%) - Mistura o sinal estéreo original com a recepção mono simulada. Em 0%, o estéreo permanece inalterado; em 100%, o mesmo sinal processado é enviado à esquerda e à direita. A saída só fica totalmente mono com Mix em 100%.
- Em C-QUAM, o sinal processado é estéreo quando a recepção permite; a descrição mono acima só se aplica ao modo Mono. O atraso do FIR permanece dentro do caminho processado do receptor. Mix não atrasa o sinal seco para alinhá-lo, portanto os ajustes intermediários combinam os dois com essa diferença de tempo.

### Leitura do HUD

- **S METER** mostra, em uma escala de S1 a S9, a intensidade de sinal que o receptor tem dentro da sua banda antes do AGC. Como o S-metro de um receptor real, ele lê tudo o que está dentro da faixa de passagem, portanto a estação adjacente, o ruído e a estática também elevam a leitura junto com a estação desejada.
- **AGC GAIN** mostra quanto ganho o receptor aplica no momento. Em geral, aumenta quando Signal diminui ou o desvanecimento se aprofunda. Ele é limitado a +42 dB, portanto desvanecimentos mais profundos e sinais mais fracos permanecem com volume menor em vez de serem totalmente compensados.
- **MODULATION** mostra a porcentagem efetiva de modulação após a filtragem do transmissor.
- **FADE / EVENTS** mostra em dB a variação atual do ganho de propagação e pisca de acordo com as taxas recentes de estática e corte. Se você quiser um resultado mais limpo e o corte for frequente, reduza Mod Depth ou Detector RC.
- **STEREO** acompanha a mistura estéreo decodificada. Ele fica mais brilhante quando a recepção estéreo se abre e escurece quando o receptor retorna automaticamente em direção ao mono.

### Ajustes recomendados

1. **Estação local forte**
   - TX Bandwidth: 6.0 kHz, Mod Depth: 90%, Signal: -10 dB, Skywave: 5%, Fading Speed: 0.1 Hz, Static: 0.5/s
   - Interference: -80 dB, Tuning: 0 kHz, IF Bandwidth: 12 kHz, AGC Speed: Fast, Speaker: Table, Mix: 100%

2. **Estação noturna distante**
   - TX Bandwidth: 4.5 kHz, Signal: -35 dB, Skywave: 75%, Fading Speed: 0.3 Hz, Static: 6/s
   - Interference: -55 dB, Interf. Offset: 9 kHz, IF Bandwidth: 6 kHz, AGC Speed: Slow, Detector RC: 150 µs, Speaker: Small, Mix: 100%

3. **Canal adjacente congestionado**
   - Signal: -25 dB, Skywave: 40%, Fading Speed: 0.5 Hz, Static: 3/s
   - Interference: -28 dB, Interf. Offset: 9 kHz, Tuning: +0.5 kHz, IF Bandwidth: 6 kHz, AGC Speed: Mid, Speaker: Small, Mix: 100%

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

## FM Radio Simulator

O FM Radio Simulator passa a música por uma cadeia modelada de transmissão e recepção FM: processamento de áudio de transmissão e pré-ênfase, composição do multiplex estéreo (MPX) com o piloto de 19 kHz, modulação FM de uma portadora, propagação por multipercurso e ruído de antena, sintonia do receptor, filtragem de FI, limitação rígida, discriminação FM, decodificação estéreo por PLL do piloto e de-ênfase. Como o sinal é realmente modulado e demodulado em FM, os comportamentos característicos da recepção FM emergem da física em vez de serem sintetizados: o chiado brilhante que cresce quando o sinal enfraquece, a penalidade de ruído do estéreo com a mistura automática para mono, os cliques e crepitações abaixo do limiar FM e a distorção por multipercurso.

Este efeito requer um ambiente compatível com seu processamento em tempo real. Quando esse processamento não está disponível, o áudio permanece inalterado e o HUD informa que o efeito está indisponível.

### Diferenças em relação aos efeitos lo-fi aditivos

- **FM Radio Simulator** não sintetiza um ruído "de rádio" para sobrepor. Ele modula a música em uma portadora, degrada essa portadora e a demodula. Chiado, cliques e distorção aparecem apenas onde a física do receptor os cria, e reagem a Signal, Tuning, ao filtro de FI e ao decodificador estéreo, mostrando as mesmas tendências físicas da recepção FM real.
- **Noise Blender** adiciona uma textura constante de ruído de fundo sem alterar a música; escolha-o quando quiser apenas ambiência. Ele também pode ser encadeado depois deste efeito para representar interferências impulsivas do tipo ignição de motor, que este modelo não inclui.
- **Digital Error Emulator** reproduz erros de transmissão digital, como quedas e artefatos de ocultação — uma família de degradação diferente da recepção FM analógica.
- **AM Radio Simulator** é o modelo físico equivalente para a radiodifusão AM; o FM Radio Simulator reproduz o som FM de banda larga com seu multiplex estéreo, o travamento do piloto e o comportamento de ruído próprio do FM.

### Guia de caráter sonoro

- **Transmissão limpa:** com sinal forte, a cadeia contribui principalmente com o próprio processamento de transmissão — o limite de banda de 15 kHz e a densidade do limitador da emissora definida por Processing.
- **Chiado de sinal fraco:** ao reduzir Signal, um chiado brilhante e arejado surge primeiro no estéreo. Mudar Stereo para Mono torna a mesma recepção nitidamente mais silenciosa, pela mesma razão pela qual o mono é mais silencioso em um sintonizador real.
- **Recepção no limite:** perto do limiar FM aparecem cliques e crepitações, o receptor mistura para mono e o programa finalmente afunda no ruído.
- **Cor do multipercurso:** as reflexões adicionam uma distorção áspera e oca cujo caráter acompanha Path Delay; aumentar Fading a transforma na vibração da recepção móvel.

### Parâmetros

- **Emphasis** (50 ou 75 µs) - Seleciona o par de constantes de tempo de pré-ênfase/de-ênfase (50 µs: Japão/Europa, 75 µs: Américas). Em um sinal limpo o par praticamente se cancela; a escolha altera sutilmente o timbre do chiado e da distorção.
- **Processing** (0 a +18 dB) - Drive do limitador de transmissão — o "volume" da emissora. 0 dB é quase transparente; valores altos soam mais densos e mais altos, como emissoras muito processadas.
- **Signal** (0 a 70 dBµV) - Nível da portadora na entrada da antena. O piso de ruído é fixado pela física (ruído térmico de 75 Ω mais a figura de ruído do receptor), então este controle define a relação portadora/ruído e é o principal eixo de degradação. Por volta de 50 dBµV ou mais a recepção é essencialmente limpa; perto de 30 o chiado estéreo é claramente audível; perto de 15 a mistura Auto já passou para mono; em 6 ou menos os cliques se multiplicam e o programa afunda no ruído.
- **Tuning** (-200 a +200 kHz) - Dessintoniza o receptor em relação à emissora. Pequenos desvios passam quase despercebidos; a partir de cerca de ±40 kHz o som fica cada vez mais distorcido, assimétrico e baixo, à medida que as bandas laterais saem da banda passante de FI. Em ±200 kHz, a emissora fica totalmente fora da banda passante e resta apenas o ruído do receptor.
- **IF Band** (80 a 240 kHz) - Largura do filtro de FI do receptor. Ajustes estreitos representam um receptor feito para faixas congestionadas: cortam as bandas laterais FM e aumentam a distorção, principalmente combinados com a dessintonia. Ajustes largos são mais limpos com uma emissora forte e centralizada.
- **Multipath** (0 a 100%) - Quantidade de efeito de duas reflexões atrasadas: a 100% a primeira reflexão atinge 30% da onda direta e a segunda 60% da primeira. Os nulos de interferência convertem o FM em erros de amplitude e fase que o limitador não consegue remover totalmente, produzindo a típica distorção áspera de multipercurso.
- **Path Delay** (0.5 a 50 µs) - Atraso da primeira reflexão (a segunda é fixa em 2.7 vezes). Atrasos curtos dão uma coloração ampla, com caráter de fase; atrasos longos produzem distorção mais nítida e localizada.
- **Fading** (0 a 20 Hz) - Taxa de rotação das fases das reflexões. 0 Hz congela o padrão de multipercurso; valores altos criam a vibração e o efeito "cerca" da recepção em um carro em movimento.
- **Stereo** (Auto / Stereo / Mono) - Auto mistura continuamente de estéreo para mono conforme o travamento do piloto e a qualidade do sinal se degradam, como um receptor real. Stereo força o decodificador e expõe toda a penalidade de ruído estéreo em sinais fracos. Mono descarta o subcanal L−R para uma recepção nitidamente mais silenciosa em sinal fraco.
- **Output** (-24 a +24 dB) - Ajuste de nível após a demodulação.
- **Mix** (0 a 100%) - Mistura o sinal demodulado com um sinal seco alinhado em latência. 100% é a recepção de rádio completa; valores menores reincorporam o original sem filtragem em pente.

### Leitura do HUD

- O gráfico mostra o **espectro MPX** observado na saída do demodulador em um eixo de frequência logarítmico, com marcadores em 15 kHz (fim da região L+R), no piloto de 19 kHz e no subcanal L−R em torno de 38 kHz (banda de 23 a 53 kHz). Ao reduzir Signal, o piso de ruído sobe mais nas frequências altas — o espectro de ruído triangular característico do FM — e engole primeiro a região L−R. Essa é a razão visível de o estéreo ficar ruidoso antes do mono.
- O **medidor de sinal e a leitura em dBµV** mostram o nível de portadora recebido, definido por Signal e flutuando com a interferência de multipercurso.
- **CNR** é a relação portadora/ruído estimada. Os cliques começam a aparecer quando ela se aproxima do limiar FM, por volta de 12 dB.
- O **indicador ST com sua porcentagem** mostra a mistura estéreo atual: 100% é estéreo completo e 0% é mono. Com Stereo em Auto, a porcentagem cai conforme o sinal se degrada.
- **MPath** mostra o nível da primeira reflexão em relação à onda direta em dB (−∞ quando Multipath está em 0%).
- **Clicks** conta os cliques recentes de limiar FM por segundo e é destacado quando eles se tornam frequentes.
- Se o motor **WASM** estiver indisponível, o HUD mostra um aviso e o áudio passa sem alteração.

### Ajustes recomendados

1. **Emissora local forte**
   - Emphasis: 50 µs, Processing: 6 dB, Signal: 50 dBµV, Tuning: 0 kHz, IF Band: 230 kHz
   - Multipath: 0%, Fading: 0 Hz, Stereo: Auto, Mix: 100%
   - Estéreo limpo apenas com o caráter do processamento de transmissão. Aumente Processing para comparar o som de diferentes emissoras.

2. **Recepção suburbana**
   - Signal: 30 dBµV, Tuning: 0 kHz, IF Band: 230 kHz, Multipath: 20%, Path Delay: 5 µs, Fading: 0.5 Hz
   - Stereo: Auto, Mix: 100%
   - Chiado estéreo claramente audível sobre a música. Compare com Stereo: Mono para ouvir a penalidade de ruído estéreo desaparecer.

3. **Recepção na borda da cobertura**
   - Signal: 15 dBµV, IF Band: 180 kHz, Multipath: 40%, Path Delay: 12 µs, Fading: 2 Hz
   - Stereo: Auto, Mix: 100%
   - A mistura Auto já passou para mono e a recepção vibra. Force Stereo para ouvir por que os receptores misturam para mono.

4. **Sinal quase inexistente**
   - Signal: 6 dBµV, Tuning: +30 kHz, Multipath: 60%, Path Delay: 12 µs, Fading: 5 Hz
   - Stereo: Auto, Mix: 100%
   - Abaixo do limiar FM: cliques crepitantes, ruído intenso e um programa que entra e sai da estática.

### Notas sobre o modelo

O efeito processa o primeiro par estéreo como uma única cadeia de transmissão; uma entrada mono é transmitida com o canal L−R vazio. RDS, emissoras adjacentes e fontes de interferência estão fora deste modelo. Para o som multibanda de uma "grande emissora", coloque um Multiband Compressor antes deste efeito; para interferências impulsivas, encadeie Noise Blender ou Digital Error Emulator depois.

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
