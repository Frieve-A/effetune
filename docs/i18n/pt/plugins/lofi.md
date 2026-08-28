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
- [Cassette Artifacts](#cassette-artifacts) - Grava a música em uma cassete compacta modelada e a reproduz em um deck Type I/II/IV com Dolby B/C
- [Digital Error Emulator](#digital-error-emulator) - Simula vários erros de transmissão de áudio digital
- [DSD64 IMD Simulator](#dsd64-imd-simulator) - Simula a distorção de intermodulação audível causada pelo ruído ultrassônico do DSD64
- [FM Radio Simulator](#fm-radio-simulator) - Passa a música por uma cadeia de transmissão e recepção FM simulada fisicamente
- [G.726 Simulator](#g726-simulator) - Simula uma conversão de codificação e descodificação de voz ITU-T G.726 com uma ligação rádio ruidosa opcional
- [GSM-FR Simulator](#gsm-fr-simulator) - Simula uma conversão de codificação e descodificação de voz GSM-FR a 13 kbit/s por ligação rádio com ocultação de perdas de trama
- [Hum Generator](#hum-generator) - Adiciona ambiência controlável de hum elétrico para escuta vintage/lo-fi
- [MD Simulator](#md-simulator) - Simula uma conversão de codificação e descodificação ATRAC da era MiniDisc
- [MP3 Codec Simulator](#mp3-codec-simulator) - Simula uma conversão limpa de MPEG Layer III em baixo bitrate
- [Noise Blender](#noise-blender) - Adiciona textura atmosférica de fundo
- [SBC Codec Simulator](#sbc-codec-simulator) - Reproduz uma conversão Bluetooth A2DP SBC com perda de pacotes da ligação e ocultação opcionais
- [Simple Jitter](#simple-jitter) - Compara pequenas flutuações de clock ou acrescenta movimento criativo com valores altos
- [SW Radio Simulator](#sw-radio-simulator) - Passa a música por uma cadeia modelada de transmissão em onda curta, propagação ionosférica e recepção
- [Tape Artifacts](#tape-artifacts) - Grava a música em uma fita de rolo modelada e a reproduz
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


### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para experimentar diretamente estas configurações completas.

- **Local Daytime Station** - Uma transmissão local clara e de faixa larga, com pouca estática.
- **Pocket Transistor** - Som de rádio de pequeno alto-falante, com mais compressão, zumbido e largura de banda limitada.
- **Night Skywave** - Um sinal noturno fraco, com desvanecimento ionosférico acentuado.
- **Summer Thunderstorm** - Uma estação em desvanecimento, interrompida por estática atmosférica frequente.
- **Stereo AM Broadcast** - Uma transmissão estéreo C-QUAM mais clara, sem simulação de alto-falante.

### Parâmetros

#### Station

- **Radio** (ligado ou desligado) - Liga e desliga a transmissão da estação. Com ela desligada, a portadora desaparece por completo e no receptor restam apenas a estática atmosférica, a estação adjacente e o seu próprio ruído, com o AGC aberto ao máximo e esse fundo soando alto. Use-o para ouvir o instante em que uma estação entra ou sai do ar. Não é a mesma coisa que desligar o próprio efeito, que deixa a música passar sem alteração.
- **Stereo Mode** (Mono ou C-QUAM) - Mono usa um receptor tradicional com detetor de envolvente. C-QUAM oferece receção estéreo e transita automaticamente para mono quando o sinal está fraco ou fora de sintonia. A troca de modo também pode alterar o timbre; Detector RC só se aplica a Mono. O estéreo C-QUAM funciona até 192 kHz; acima disso, a receção é mono.
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

- **Tuning** (-30.0 a +30.0 kHz) - Desloca a sintonia em relação à estação desejada; valores positivos sintonizam acima da estação e valores negativos abaixo dela. Pequenos desvios reduzem a clareza e aumentam a distorção do filtro assimétrico; com desvios grandes, a estação fica encoberta pelo ruído do receptor. A direção também determina se o receptor se aproxima ou se afasta da estação adjacente superior definida por Interf. Offset.
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
## Cassette Artifacts

Cassette Artifacts combina a resposta de frequência de uma cassete, compressão da fita, chiado, wow e flutter, quedas de sinal e alterações no alinhamento da cabeça. Use-o para obter o caráter completo de um deck cassete, e não apenas uma camada de ruído sobre uma música inalterada.

### Diferenças em relação a outros efeitos lo-fi

- **Tape Artifacts** oferece o som mais limpo e de banda mais larga de um gravador de rolo, com velocidade selecionável. Cassette Artifacts é mais escuro e oferece Deck Grade, Tape Type, redução de ruído, quedas de sinal e alinhamento da cabeça, próprios de cassetes.
- **Wow Flutter** (Modulation) reproduz apenas a variação de velocidade do transporte. Escolha-o quando quiser a instabilidade sem a saturação da fita, o comportamento de Tape Type e Bias, a redução de ruído ou o chiado.
- **Saturation** e **Hard Clipping** acrescentam apenas não linearidade, sem o comportamento dependente da frequência nem o transporte de um gravador de fita.
- **Vinyl Artifacts**, **Noise Blender** e **Hum Generator** acrescentam ruído sem alterar a resposta de frequência nem a dinâmica da música.

### Guia de caráter sonoro

- **Deck Grade** vai do som amplo e estável de Reference ao som mais escuro e instável de Portable.
- Aumente **Record Level** para obter mais compressão e saturação; diminua-o para preservar mais a dinâmica. Depois, use Output para igualar o volume.
- **Tape Type** altera o ruído e a margem antes da saturação. Type I é a mais ruidosa, Type II é equilibrada e Type IV mantém os picos agudos mais limpos.
- **Noise Reduction** reduz o chiado. Dolby C atua mais que Dolby B, enquanto Off mantém o fundo cru da cassete.
- Aumente **Wow/Flutter**, **Hiss** ou **Dropouts** para um som mais gasto. **Azimuth** suaviza os agudos e altera sua posição temporal entre os canais.

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para experimentar diretamente estas configurações completas.

- **Flagship Deck Metal** - Um deck de referência silencioso e estável, com fita metal e Dolby C.
- **Hi-Fi Chrome** - Uma fita cassete Type II limpa, com pouco chiado e pouca variação de altura.
- **Pocket Cassette Player** - Som de reprodutor portátil com ruído, oscilação e desalinhamento do cabeçote.
- **Worn Mixtape** - Uma fita muito usada, com falhas, oscilação e saturação mais áspera.
- **Hot Deck Saturation** - Som de cassete gravado intencionalmente em nível alto, com compressão de fita mais forte.

### Parâmetros

A velocidade da cassete compacta é fixa, por isso não há controle Speed.

- **Deck Grade** (Reference, Hi-Fi, Consumer ou Portable) - Seleciona o caráter do deck. Reference é o mais amplo e estável; Portable, o mais escuro e instável. Comece com Consumer para um som familiar de deck doméstico.
- **Tape Type** (Type I, Type II ou Type IV) - Altera o ruído e a margem antes da saturação. Type I é a mais ruidosa, Type II é equilibrada e Type IV mantém os picos agudos mais limpos.
- **Noise Reduction** (Off, Dolby B ou Dolby C) - Reduz o chiado. Dolby B é moderado, Dolby C é mais forte e Off mantém o fundo cru da cassete. Use Dolby Level Error para obter o som mais brilhante ou mais escuro de decks incompatíveis.
- **Bias** (-6.0 a +6.0 dB) - Altera os agudos e a distorção. Comece em 0 dB. Pequenos valores positivos soam mais limpos e escuros; pequenos valores negativos, mais brilhantes e ásperos. Valores negativos extremos acrescentam distorção sem continuar clareando o som.
- **Record Level** (-12.0 a +18.0 dB) - Controla a intensidade com que a fita é gravada. Comece em +9 dB. Aumente-o para obter compressão e saturação mais densas; diminua-o para preservar a dinâmica. Depois, iguale o volume com Output.
- **Wow/Flutter** (0 a 1%) - Controla a instabilidade de afinação. 0% é estável, o padrão de 0.200% cria um movimento audível de cassete em notas sustentadas e valores maiores produzem a oscilação de um deck gasto.
- **Hiss** (-92.0 a -42.0 dB re 250 nWb/m) - Controla o chiado da fita e o ruído de modulação relacionado ao sinal. Aumente-o para uma fita mais ruidosa ou use o mínimo para desligar a camada de ruído. A linha de estado mostra o nível de fundo resultante com os ajustes atuais.
- **Dropouts** (0 a 20 eventos/min) - Define a frequência de breves quedas de sinal. 0 as desativa, 2 eventos/min acrescenta desgaste ocasional e valores maiores soam cada vez mais danificados.
- **Azimuth** (-6.0 a +6.0 arcmin) - Simula o desalinhamento da cabeça. Afaste-o de 0 para suavizar os agudos e alterar o tempo entre os canais; o sinal escolhe qual canal se adianta.
- **Dolby Level Error** (-3.0 a +3.0 dB) - Simula uma incompatibilidade entre os decks de gravação e reprodução quando Noise Reduction está ligado. Valores positivos soam mais brilhantes e com mais chiado; valores negativos, mais escuros. Comece em 0 dB.
- **Output** (-24.0 a +24.0 dB) - Ajusta o nível depois de toda a cadeia. Use-o para igualar o volume ao comparar com o bypass ou para recuperar o volume perdido com Record Level alto.
- **Mix** (0 a 100%) - Mistura o som de cassete com o original. Comece em 100% para avaliar o efeito completo; diminua-o para um resultado mais sutil. Valores intermediários podem suavizar os agudos mais altos porque os dois caminhos se cancelam parcialmente nessa região.

### Leitura da linha de estado

A linha abaixo dos controles mostra o wow/flutter efetivo e o nível de ruído de fundo com os ajustes atuais. Use-a para comparar alterações em Tape Type, Noise Reduction, Record Level e Hiss. `off` significa que a camada de ruído da fita está desligada.

### Ajustes recomendados

1. **Deck cassete comum (padrão)**
   - Deck Grade: Consumer, Tape Type: Type I, Noise Reduction: Dolby B, Bias: 0.0 dB, Record Level: +9.0 dB
   - Wow/Flutter: 0.200%, Hiss: -60.5 dB re 250 nWb/m, Dropouts: 2.0 eventos/min, Azimuth: +2.0 arcmin, Dolby Level Error: 0.0 dB, Output: 0.0 dB, Mix: 100%
   - Um som familiar de cassete doméstica, com agudos suavizados, compressão audível, leve movimento de afinação e quedas ocasionais.

2. **Deck de referência, fita metal com Dolby C**
   - Deck Grade: Reference, Tape Type: Type IV, Noise Reduction: Dolby C, Bias: 0.0 dB, Record Level: +9.0 dB
   - Wow/Flutter: 0.040%, Hiss: -60.5 dB re 250 nWb/m, Dropouts: 0.0 eventos/min, Azimuth: 0.0 arcmin, Dolby Level Error: 0.0 dB, Output: 0.0 dB, Mix: 100%
   - O ajuste mais limpo de cassete: amplo, estável e silencioso, com boa margem nos agudos e sem desgaste acrescentado.

3. **Fita férrica, sem redução de ruído**
   - Deck Grade: Consumer, Tape Type: Type I, Noise Reduction: Off, Bias: 0.0 dB, Record Level: +9.0 dB
   - Wow/Flutter: 0.200%, Hiss: -60.5 dB re 250 nWb/m, Dropouts: 2.0 eventos/min, Azimuth: +2.0 arcmin, Dolby Level Error: 0.0 dB, Output: 0.0 dB, Mix: 100%
   - Reprodução crua de cassete férrica, com chiado bem audível nas passagens silenciosas e sem coloração da redução de ruído.

4. **Deck doméstico, ligeiramente sobrepolarizado**
   - Deck Grade: Consumer, Tape Type: Type I, Noise Reduction: Dolby B, Bias: +2.0 dB, Record Level: +12.0 dB
   - Wow/Flutter: 0.300%, Hiss: -58.0 dB re 250 nWb/m, Dropouts: 4.0 eventos/min, Azimuth: +3.0 arcmin, Dolby Level Error: -1.0 dB, Output: +0.5 dB, Mix: 100%
   - Um som mais escuro e comprimido de deck doméstico, com mais oscilação, chiado, desalinhamento e quedas ocasionais.

5. **Portátil, fita gasta**
   - Deck Grade: Portable, Tape Type: Type I, Noise Reduction: Off, Bias: -2.0 dB, Record Level: +12.0 dB
   - Wow/Flutter: 0.480%, Hiss: -54.0 dB re 250 nWb/m, Dropouts: 8.0 eventos/min, Azimuth: +4.0 arcmin, Dolby Level Error: 0.0 dB, Output: +1.0 dB, Mix: 100%
   - Um som de reprodutor portátil intencionalmente degradado, com banda estreita, forte oscilação, ruído, distorção e quedas frequentes.

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

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para experimentar diretamente estas configurações completas.

- **Powerhouse Broadcast** - Uma estação forte com processamento de transmissão mais intenso.
- **Distant Station** - Recepção no limite da área de cobertura, com chiado e degradação estéreo inicial.
- **City Drive Multipath** - Reflexões que mudam rapidamente e distorção por múltiplos trajetos para a escuta em movimento.

### Parâmetros

- **Radio** (ligado ou desligado) - Liga e desliga a transmissão da estação. Com ela desligada, a portadora desaparece por completo e o receptor não tem mais nada para limitar além do seu próprio piso de ruído, produzindo o chiado em escala plena de um canal vazio. Use-o para ouvir o instante em que uma estação entra ou sai do ar. Não é a mesma coisa que desligar o próprio efeito, que deixa a música passar sem alteração.
- **Emphasis** (50 ou 75 µs) - Seleciona o par de constantes de tempo de pré-ênfase/de-ênfase (50 µs: Japão/Europa, 75 µs: Américas). Em um sinal limpo o par praticamente se cancela; a escolha altera sutilmente o timbre do chiado e da distorção.
- **Processing** (0 a +18 dB) - Drive do limitador de transmissão — o "volume" da emissora. 0 dB é quase transparente; valores altos soam mais densos e mais altos, como emissoras muito processadas.
- **Signal** (0 a 70 dBµV) - Nível da portadora na entrada da antena. O piso de ruído é fixado pela física (ruído térmico de 75 Ω mais a figura de ruído do receptor), então este controle define a relação portadora/ruído e é o principal eixo de degradação. Por volta de 50 dBµV ou mais a recepção é essencialmente limpa; perto de 30 o chiado estéreo é claramente audível; perto de 15 a mistura Auto já passou para mono; em 6 ou menos os cliques se multiplicam e o programa afunda no ruído.
- **Tuning** (-200 a +200 kHz) - Dessintoniza o receptor em relação à emissora. Pequenos desvios passam quase despercebidos; a partir de cerca de ±40 kHz o som fica cada vez mais distorcido, assimétrico e baixo, à medida que as bandas laterais saem da banda passante de FI. Em ±200 kHz, a emissora fica totalmente fora da banda passante e resta apenas o ruído do receptor.
- **IF Band** (80 a 240 kHz) - Largura do filtro de FI do receptor. Ajustes estreitos representam um receptor feito para faixas congestionadas: cortam as bandas laterais FM e aumentam a distorção, principalmente combinados com a dessintonia. Ajustes largos são mais limpos com uma emissora forte e centralizada.
- **Multipath** (0 a 100%) - Quantidade de efeito de duas reflexões atrasadas: a 100% a primeira reflexão atinge a mesma amplitude da onda direta e a segunda 60% da primeira. À medida que as reflexões crescem, os nulos de interferência se aprofundam e convertem o FM em erros de amplitude e fase que o limitador não consegue remover totalmente — de uma coloração sutil em ajustes baixos até a distorção áspera e crepitante do multipercurso severo perto de 100%.
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

## G.726 Simulator

O G.726 Simulator processa o canal mono ou o par estéreo selecionado por uma conversão real de codificação e descodificação ITU-T G.726 a 8 kHz. O par estéreo é combinado em mono antes da codificação, e o sinal descodificado é enviado aos dois canais selecionados. Assim, pode ouvir a largura de banda, a quantização diferencial adaptativa e os erros de predição da telefonia digital. Com Bit Error Rate no valor predefinido, o percurso mantém-se totalmente limpo; ao aumentá-lo, junta os erros de bit de uma ligação sem fios como o DECT.

Os modos de 16, 24, 32 e 40 kbit/s são as quatro taxas normalizadas do G.726. O valor predefinido de 32 kbit/s corresponde ao modo de voz full-slot historicamente usado pelo DECT. Taxas inferiores usam menos bits por amostra a 8 kHz e tornam mais evidentes a quantização granular, os tons sustentados ásperos e a sobrecarga de inclinação. Como o codec foi criado para voz, a música de banda larga evidencia fortemente os seus limites.

Se o plugin indicar que o efeito não está disponível, experimente outra frequência de amostragem ou outro modo de canais. Até lá, a entrada permanece inalterada.

### Guia de melhoria do som

- **Voz telefónica representativa:** comece com 32 kbit/s, Output a 0 dB e Mix a 100%. A fala revela a banda estreita de 8 kHz e a textura ADPCM adaptativa num ponto de funcionamento historicamente comum.
- **Comparar artefactos por taxa:** alterne entre 40, 32, 24 e 16 kbit/s no mesmo trecho de voz. Nas taxas baixas, ouça o grão das vogais, a aspereza dos tons sustentados e a recuperação após mudanças bruscas de nível.
- **Expor o codec com música:** use percussão, notas agudas sustentadas ou misturas densas a 16 ou 24 kbit/s para tornar mais claras a limitação de banda e os erros de predição.
- **Adicionar erros de rádio:** aumente Bit Error Rate para -4.5 a -2 para ouvir as palavras de código a partirem-se em crepitações e zonas ásperas. Deixe em -6 para uma comparação limpa de codificação e descodificação.
- **Misturar o efeito:** reduza Mix para manter parte do sinal original. O percurso seco está alinhado em latência com o descodificado.
- **Igualar níveis:** use Output apenas para compensar diferenças de volume; não altera a atribuição de bits do G.726.

### Parâmetros

- **Bitrate** — Seleciona 16, 24, 32 ou 40 kbit/s. Cada amostra a 8 kHz usa, respetivamente, 2, 3, 4 ou 5 bits ADPCM. Taxas inferiores aumentam os artefactos de quantização e predição.
- **Output** — Ajusta o nível descodificado de -24,0 a +12,0 dB sem alterar o estado nem a taxa do codec.
- **Mix** — Mistura de 0% a 100% o original alinhado em latência com o resultado descodificado.
- **Bit Error Rate** — Define a taxa de erros de bit da ligação sem fios como potência de dez, de -6 a -2 (predefinição -6). Em -6 o percurso fica isento de erros. Valores mais altos invertem mais bits nas palavras de código ADPCM e produzem o crepitar de uma ligação DECT com má receção.

## GSM-FR Simulator

Quando a saída de áudio tem um canal, o GSM-FR Simulator processa esse canal diretamente. Com dois ou mais canais de saída, combina em mono o par estéreo selecionado. Em seguida, reamostra o sinal mono para 8 kHz e processa-o com o codificador e descodificador RPE-LTP normalizado do GSM-FR a 13 kbit/s. O resultado descodificado regressa ao único canal de saída ou aos dois canais do par selecionado. Use-o para examinar como a codificação de voz dos primeiros telemóveis digitais altera vozes, percussão, sons sustentados e música densa. Com C/I no valor predefinido, o percurso mantém-se totalmente limpo; ao reduzi-lo, reproduz uma receção GSM fraca.

Cada trama de 20 ms é representada por parâmetros quantizados de predição linear, predição a longo prazo e excitação por impulsos regulares. Transcodes repete a etapa completa de codificação e descodificação com estados independentes, reproduzindo a codificação em tandem em vez de funcionar como um controlo genérico de «qualidade». Os canais adicionais depois do par estéreo selecionado permanecem inalterados.

Se o plugin indicar que o efeito não está disponível, experimente outra frequência de amostragem ou outro modo de canais. Até lá, a entrada permanece inalterada.

### Guia de melhoria sonora

- **Voz típica dos primeiros telemóveis:** Defina Transcodes como 1, Output como 0 dB e Mix como 100%, e compare vozes, pratos e percussão com o bypass.
- **Ouvir a codificação em tandem:** Mantenha a mesma passagem e altere Transcodes de 1 para 2 e depois 3. O chilrear, a instabilidade e a perda de clareza aumentam porque o sinal é realmente recodificado e descodificado; os erros de receção de rádio são independentes: com C/I a 30 dB não existem e reduzir o valor reproduz-os.
- **Evidenciar o modelo de voz com música:** Use Transcodes 3 em música brilhante ou densa para identificar melhor a largura de banda vocal de 8 kHz, o zumbido RPE-LTP e a alteração dos formantes.
- **Misturar o resultado:** Reduza Mix para recuperar parte do sinal estéreo original. O percurso seco está alinhado com a latência do codec.
- **Igualar níveis antes de comparar:** Use apenas Output para compensar diferenças de volume percebidas ou medidas. Não altera o algoritmo do codec.

### Parâmetros

- **Transcodes** — Seleciona 1, 2 ou 3 ciclos completos de codificação e descodificação GSM-FR. Cada ciclo mantém um estado independente e usa o mesmo codec de 13 kbit/s. Valores superiores intensificam os artefactos da codificação em tandem.
- **Output** — Ajusta o nível da saída descodificada entre -24,0 e +12,0 dB. Serve para igualar níveis; não altera o estado nem o bitrate do codec.
- **Mix** — Mistura entre 0% e 100% o sinal original, alinhado em latência, com o resultado descodificado. A 100%, os dois canais do par estéreo selecionado contêm o mesmo sinal mono descodificado; valores inferiores recuperam a diferença estéreo original.
- **C/I** — Define a relação portadora/interferência da ligação rádio entre 4 e 30 dB (predefinição 30). A 30 dB a receção é praticamente perfeita. Valores mais baixos acrescentam perdas de trama com ocultação ao estilo GSM 06.11 (repetição atenuada da trama anterior e silenciamento após perdas consecutivas) e distorção por erros de bits de Classe 2, dando os cortes ásperos de um telemóvel no limite da cobertura. Com Transcodes acima de 1, a degradação aplica-se apenas ao último salto.

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

## MD Simulator

O MD Simulator processa os canais selecionados através de uma análise ATRAC simplificada em tempo real, quantização espectral de bits finitos e um percurso de síntese modelado na família de codecs ATRAC do formato MiniDisc. Use-o para ouvir como uma conversão ATRAC limpa altera transientes, detalhe de altas frequências e texturas tonais nos três modos de gravação que um leitor MD realmente oferecia.

Mode seleciona um dos três pontos de funcionamento reais do MD: SP (292 kbps) usa o ATRAC1, o codec do MiniDisc standard-play original. LP2 (132 kbps) e LP4 (66 kbps) usam o ATRAC3, os modos de gravação de duração dupla e quádrupla do MDLP; o LP4 também aplica codificação estéreo conjunta (joint stereo). Taxas inferiores deixam menos bits disponíveis para o banco de filtros de análise e tornam mais evidentes o esbatimento de transientes, os "birdies"/assobios em alta frequência e o ruído de baixa atribuição de bits.

Se o plugin indicar que o efeito não está disponível, experimente outra frequência de amostragem ou outro modo de canais. Até lá, a entrada permanece inalterada.

### Guia de melhoria do som

- **Audição representativa de MD:** comece com SP, Output a 0 dB e Mix a 100%. É o codec efetivamente usado na maioria das gravações MD e oferece o ponto de comparação mais limpo.
- **Ouvir a compressão do modo longo:** alterne a mesma passagem entre LP2 e depois LP4. Pratos, percussão densa e misturas estéreo amplas revelam um detalhe de agudos progressivamente mais grosseiro e, no LP4, um topo mais fino e instável devido à redução para metade do orçamento de bits e à codificação estéreo conjunta.
- **Expor o comportamento transiente:** use fontes com transientes marcados (castanholas, cordas dedilhadas, ataques de piano) para ouvir o esbatimento de pré-eco típico da deteção de transientes do ATRAC.
- **Misturar o efeito:** reduza Mix quando quiser algum carácter MD sem substituir todo o sinal. O percurso seco está alinhado em latência com o percurso descodificado.
- **Igualar níveis antes de comparar:** ajuste Output apenas para compensar diferenças de volume percebidas ou medidas; não altera a atribuição de bits do codec.

### Parâmetros

- **Mode** — Seleciona `SP (292 kbps)`, `LP2 (132 kbps)` ou `LP4 (66 kbps)`. O SP usa ATRAC1; o LP2 e o LP4 usam ATRAC3, com o LP4 a acrescentar codificação estéreo conjunta. Taxas inferiores deixam menos bits para a quantização espectral e tornam os artefactos do codec mais evidentes.
- **Output** — Ajusta o nível de saída descodificado de -24,0 a +12,0 dB. Use-o para igualar níveis; não altera o estado do codec nem a atribuição de bits.
- **Mix** — Mistura de 0% a 100% o original alinhado em latência com o resultado descodificado.

## MP3 Codec Simulator

O MP3 Codec Simulator processa os canais selecionados por uma análise MPEG Layer III simplificada em tempo real, quantização espectral com orçamento limitado de bits e síntese. Use-o para ouvir como um MP3 de baixo bitrate altera transientes, detalhes de altas frequências, tons sustentados e a imagem estéreo. Ele modela somente uma conversão limpa do codec; não adiciona cliques de arquivos danificados, interrupções, perda de pacotes nem erros de transmissão.

O perfil MPEG-1 de 44.1 kHz oferece de 32 a 320 kbit/s. O perfil MPEG-2 de 22.05 kHz oferece de 32 a 160 kbit/s e limita mais a banda codificada. Se o plugin indicar que o efeito não está disponível, tente outra frequência de amostragem ou outro modo de canais. A entrada permanece inalterada até que o efeito fique disponível.

### Guia de aprimoramento sonoro

- Para ouvir claramente o caráter do MP3, comece com 44.1 kHz, 48 ou 64 kbit/s, Joint Stereo, Bit Reservoir On e Mix em 100%. Percussão, pratos, tons sustentados e gravações estéreo amplas evidenciam melhor as diferenças.
- Compare 64 kbit/s com 128 ou 192 kbit/s para perceber quanto detalhe o orçamento maior preserva. Experimente 22.05 kHz em 32 ou 48 kbit/s para uma limitação de banda mais forte.
- Desative Bit Reservoir em uma faixa com trechos calmos e densos. Cada quadro terá de caber sozinho no orçamento, e transientes complexos podem ficar mais ásperos.

### Parâmetros

- **Codec Rate** — Seleciona `44.1 kHz (MPEG-1)` ou `22.05 kHz (MPEG-2)` e altera perfil, estrutura dos quadros e banda codificada.
- **Bitrate** — Define o bitrate constante total do fluxo mono ou estéreo. MPEG-1 chega a 320 kbit/s e MPEG-2 a 160 kbit/s; valores baixos aumentam lacunas espectrais, aspereza tonal e borramento de transientes.
- **Stereo Mode** — `Joint Stereo` pode codificar o primeiro par estéreo como Mid/Side quando isso é mais eficiente; `Stereo` mantém os espectros esquerdo e direito separados.
- **Bit Reservoir** — Permite que quadros simples guardem capacidade não utilizada para quadros complexos posteriores.
- **Output** — Ajusta o nível decodificado de -24.0 a +12.0 dB.
- **Mix** — Mistura de 0% a 100% o original alinhado em latência com o resultado decodificado.

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

## SBC Codec Simulator

SBC Codec Simulator processa os canais selecionados com análise SBC em tempo real, alocação de bits, quantização e síntese. Use-o para ouvir como o codec básico obrigatório do Bluetooth A2DP altera detalhes de alta frequência, texturas tonais, transientes e a imagem estéreo. Com Packet Loss no valor predefinido, a conversão é totalmente limpa; ao aumentá-lo, reproduz as falhas de uma ligação Bluetooth real.

O codec opera internamente a 44,1 kHz para a família de taxas de 44,1 kHz e a 48 kHz para a família de 48 kHz. O valor Bitrate, somente leitura, é calculado pela extensão exata do quadro SBC para Bitpool, Channel Mode, Blocks e taxa do codec atuais.

Se o plugin indicar que o efeito não está disponível, tente outra frequência de amostragem ou outro modo de canais. A entrada permanece inalterada até que o efeito fique disponível.

### Guia de aprimoramento do som

- **Comparação SBC comum:** Comece com Bitpool 35, Joint Stereo, 16 Blocks e Mix em 100%. Compare com bypass usando pratos, sons sustentados, percussão e gravações estéreo amplas.
- **Tornar os artefatos mais audíveis:** Reduza Bitpool para 12–20. Haverá menos bits de quantização para as oito sub-bandas, destacando alterações nos agudos e resíduos tonais.
- **Comparar a alocação estéreo:** Alterne entre Joint Stereo e Stereo enquanto observa Bitrate. Joint Stereo pode codificar conteúdo estéreo correlacionado com mais eficiência; Stereo mantém separadas as sub-bandas esquerda e direita.
- **Reproduzir o SBC XQ:** Escolha Dual Channel e defina Bitpool em 38 para a configuração conhecida como «SBC XQ», ou 47 para «SBC XQ+». Com material a 44,1 kHz, Bitrate mostra 452.0 e 551.3 kbit/s, coincidindo com os números divulgados. Com Bitpool 53 chega a 617.4 kbit/s, a taxa máxima que este simulador consegue gerar. Todos estes ajustes ficam fora da recomendação do A2DP, mas são o que os transmissores SBC de alta taxa realmente enviam, e é onde o codec fica mais difícil de distinguir do bypass.
- **Comparar a adaptação dos quadros:** Mude Blocks de 16 para 4. Quadros curtos atualizam os fatores de escala com mais frequência, mas usam uma parcela maior de sobrecarga fixa e mudam o bitrate exibido.
- **Adicionar falhas sem fio:** Aumente Packet Loss para 5–20% para ouvir quadros desaparecerem em rajadas e a ocultação entrar em ação. Deixe em 0% para uma comparação limpa.
- **Misturar o efeito:** Reduza Mix para adicionar o caráter SBC com mais sutileza. O caminho original tem a latência alinhada à do caminho codificado.

### Parâmetros

- **Bitpool** — Define de 2 a 53 o orçamento de bits de quantização de cada quadro SBC. `Joint Stereo` e `Stereo` partilham-no entre o par estéreo, enquanto `Dual Channel` o aplica integralmente a cada canal. Valores baixos deixam mais sub-bandas com poucos ou nenhum bit e intensificam os artefatos. Bitpool não representa diretamente kbit/s.
- **Channel Mode** — `Joint Stereo` pode codificar sub-bandas correlacionadas como soma/diferença quando isso reduz os fatores de escala necessários. `Stereo` mantém separadas as sub-bandas esquerda e direita. Estes dois modos compartilham um Bitpool no primeiro par estéreo; Joint Stereo não transforma o sinal simplesmente em mono. `Dual Channel` dá a cada canal a sua própria alocação independente com o Bitpool completo, pelo que o quadro e a taxa de bits praticamente duplicam: é a configuração por trás do «SBC XQ» e, como a esquerda e a direita são quantizadas de forma independente, a imagem estéreo oscila de maneira diferente do Joint Stereo.
- **Blocks** — Seleciona 4, 8, 12 ou 16 blocos de amostras de sub-banda por quadro SBC. Menos blocos encurtam o quadro e aumentam a sobrecarga fixa relativa; mais blocos atualizam os fatores de escala com menor frequência.
- **Bitrate** — Bitrate atual somente leitura em kbit/s, calculado com os bytes exatos do quadro e a taxa do codec. Ele é atualizado quando Bitpool, Channel Mode, Blocks, a família de taxa de amostragem do host ou o roteamento da saída do host entre mono e estéreo muda.
- **Packet Loss** — Define a taxa de perda de pacotes da ligação Bluetooth de 0% a 20% (predefinição 0%). Em 0% nenhum quadro é perdido. Valores mais altos descartam quadros SBC inteiros em rajadas (modelo de Gilbert-Elliott) e a ocultação integrada repete o quadro anterior atenuando-o antes de desvanecer para o silêncio, como numa ligação sem fios real.
- **Output** — Ajusta o nível decodificado de -24,0 a +12,0 dB. Reduza-o se a sobressinalização dos filtros do codec elevar demais os picos.
- **Mix** — Mistura de 0 a 100% o sinal original alinhado em latência com o resultado decodificado.

## Simple Jitter

O Simple Jitter introduz variações aleatórias no momento de leitura das amostras. A faixa de picossegundos serve para comparar pequenas flutuações realistas do clock; na reprodução normal de música, esses ajustes costumam ser quase impossíveis de distinguir. Para obter uma oscilação ou mudança de textura claramente audível, use microssegundos ou mais. Nesses valores, trate o Simple Jitter como um efeito criativo, não como uma recriação de CD players, aparelhos DAT ou outros equipamentos digitais comuns.

### Guia de caráter sonoro

- **Comparação de pequenas flutuações do clock:** Valores em picossegundos mantêm o efeito extremamente discreto. Não espere que 1–500 ps deem um caráter vintage ou de equipamentos digitais antigos que seja reconhecível.
- **Textura criativa audível:** Valores em microssegundos acrescentam cada vez mais aspereza e instabilidade temporal. Aumente o RMS Jitter aos poucos, pois os ajustes altos ficam extremos rapidamente.

### Parâmetros

- **RMS Jitter** (1 ps a 10 ms) - Define a intensidade das variações aleatórias de tempo. Mover o controle para a direita aumenta o efeito em escala logarítmica.

### Como ler o indicador

- O valor ao lado do controle é a variação temporal RMS. A unidade muda automaticamente entre ps, ns, µs e ms.

### Pontos de partida

1. **Pequena flutuação do clock**
   - RMS Jitter: 100 ps
   - Use para comparar uma variação temporal realista e muito pequena; normalmente o som ficará quase inalterado.

2. **Textura audível**
   - RMS Jitter: 10 µs
   - Use como ponto de partida para um efeito criativo claro e depois ajuste de ouvido.

3. **Efeito experimental intenso**
   - RMS Jitter: 100 µs
   - Use para obter aspereza e instabilidade acentuadas; reduza o valor se o som perder definição demais.

## SW Radio Simulator

SW Radio Simulator passa a música por uma cadeia modelada de onda curta: processamento do transmissor e modulação AM ou em banda lateral única, propagação ionosférica com desvanecimento seletivo profundo, estática atmosférica e uma estação que divide o mesmo canal, um receptor de comunicações de banda estreita com detecção de envoltória, síncrona ou por BFO e AGC, e um alto-falante de rádio opcional. Use-o para ouvir a música como uma transmissão internacional distante chega a um receptor de onda curta: estreita e oca, subindo e descendo com a ionosfera, assobiando onde outro transmissor está próximo em frequência. Coloque Mode em USB ou LSB e a mesma cadeia vira um receptor de comunicações, no qual um dial que não está exatamente na frequência desloca todo o som e o deixa anasalado e inarmônico.

Este efeito exige um ambiente compatível com seu processamento em tempo real. Quando esse processamento não está disponível, o áudio permanece inalterado e o HUD informa que o efeito está indisponível.

### Diferenças em relação a AM, FM e aos efeitos lo-fi aditivos

- **AM Radio Simulator** modela a recepção em onda média, na qual uma onda terrestre estável costuma dominar e o desvanecimento é um efeito secundário. Sua banda passante é mais larga e há estéreo C-QUAM.
- **SW Radio Simulator** modela a onda curta, em que o sinal chega por reflexão ionosférica. O desvanecimento seletivo profundo é o protagonista, a banda de áudio é mais estreita e o assobio de heteródino de uma estação no mesmo canal faz parte do som. Ele também oferece recepção USB e LSB, o que nenhum outro efeito daqui traz. A transmissão em onda curta é mono, portanto o sinal processado é sempre mono.
- **FM Radio Simulator** reproduz o FM de banda larga com seu multiplex estéreo, o chiado crescente e os cliques de limiar — outra família de degradação.
- **Noise Blender** e **Hum Generator** somam ruído ou zumbido sobre uma música inalterada. Este efeito, em vez disso, modula, propaga e detecta a música, de modo que seu ruído, interferência e distorção reagem a Tuning, ao filtro FI e ao AGC como na recepção real.

### Guia de caráter sonoro

- **Estreito e oco:** a largura de banda do transmissor e a FI estreita do receptor removem a maior parte dos agudos, dando o timbre limitado e encaixotado de um receptor de onda curta.
- **Desvanecimento lento e profundo (QSB):** o nível recebido sobe e desce continuamente. É o comportamento que define a onda curta e já está ativo nos valores padrão.
- **Distorsão aquosa do desvanecimento:** em um desvanecimento profundo, a portadora e as bandas laterais caem de formas diferentes, e o detector de envoltória deixa de reconstruir o áudio corretamente. No fundo de cada desvanecimento o som fica oco, instável e "submerso", em vez de apenas mais baixo. Delay Spread controla sua intensidade, e a detecção síncrona o elimina em grande parte.
- **Flutter:** com Fading Speed alta, as ondulações viram um cintilar rápido, como a recepção por um trajeto perturbado ou polar.
- **Assobio de heteródino (QRM):** o transmissor que divide o canal bate com a sua portadora e produz um tom contínuo cuja altura é igual a Interf. Offset.
- **Estática atmosférica (QRN):** raios distantes chegam como estalos que ressoam no filtro FI.
- **Bombeamento:** à passagem dos desvanecimentos, o AGC persegue o nível e o ruído de fundo respira entre as passagens.
- **Estreiteza da banda lateral única (USB, LSB):** o áudio recuperado chega só até a metade de IF Bandwidth em todos os modos — cerca de 3 kHz no padrão de 6 kHz — e, com a portadora suprimida e apenas uma banda lateral transmitida, a outra metade da banda passante não leva sinal algum e deixa passar apenas ruído e interferência, que é o som seco e limitado de um canal de comunicações.
- **Dessintonia "voz de pato" (USB, LSB):** o BFO desloca todos os componentes o mesmo número de hertz em vez de multiplicá-los, então os harmônicos deixam de ser múltiplos inteiros da fundamental. Vozes e instrumentos ficam anasalados e inarmônicos, e USB e LSB deslocam em sentidos opostos.
- **AGC silábico (USB, LSB):** nada é transmitido entre as frases, então o AGC acompanha o próprio programa. O fundo sobe nas pausas e cada frase nova começa com um ataque audível.
- **Instante alto depois do silêncio:** quando a música começa — no início da reprodução ou depois de uma pausa — o ganho ainda está totalmente aberto do silêncio, então o primeiro instante sai alto antes de o AGC se acomodar, o que é mais evidente em USB e LSB. É o que faz um receptor ligado sobre um canal calmo, e foi mantido de propósito.
- **Desvanecimentos magros e com falhas (USB, LSB):** um desvanecimento profundo atenua de forma desigual partes da única banda lateral, em vez de produzir a distorção aquosa do detector de envoltória do AM, então o som afina e pedaços dele somem.

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para experimentar diretamente estas configurações completas.

- **Major Broadcaster** - Uma transmissão internacional estável e relativamente ampla em um rádio de mesa.
- **Transoceanic Night** - Desvanecimento noturno profundo e detecção síncrona de um sinal distante.
- **Stormy 49 m Band** - Desvanecimento rápido, estática e uma estação próxima causando interferência.

### Parâmetros

#### Station

- **Radio** (ligado ou desligado) - Liga e desliga a transmissão da estação. Com ela desligada, a portadora desaparece por completo e no receptor restam apenas a estática atmosférica, a estação que divide o canal e o seu próprio ruído, com o AGC aberto ao máximo e esse fundo soando alto. Use-o para ouvir o instante em que uma estação entra ou sai do ar. Não é a mesma coisa que desligar o próprio efeito, que deixa a música passar sem alteração.
- **TX Bandwidth** (2.0 a 10.0 kHz) - Define a largura de banda de áudio do transmissor. Os canais de radiodifusão em onda curta são espaçados de 5 kHz, então o padrão estreito já soa mais escuro que uma estação de onda média; aumente-o para um transmissor mais aberto.
- **Pre-emphasis** (0 a 100%) - Reforça as frequências altas antes da transmissão. Ajustes maiores acrescentam presença dentro da banda estreita, mas fazem os picos brilhantes acionarem mais o limitador de transmissão.
- **Mod Depth** (10 a 125%) - Define a profundidade da modulação AM. Acima de 100%, surgem sobremodulação e corte dos picos negativos.
- **Compression** (0 a 20 dB) - Define a intensidade do limitador de transmissão. Ajustes maiores contêm os picos e mantêm a modulação mais uniforme, que é como as emissoras internacionais continuam inteligíveis ao longo dos desvanecimentos.

#### Propagation

- **Signal** (-50 a 0 dB) - Define a intensidade do sinal recebido. Valores mais fracos expõem mais ruído do receptor e exigem mais ganho de AGC.
- **Fading** (0 a 100%) - Distribui a potência recebida entre um trajeto direto estável e dois trajetos ionosféricos atrasados. Em 0% a recepção de curta distância é estável; o padrão dá o desvanecimento contínuo de um sinal distante; em 100% os desvanecimentos são mais profundos e a distorção seletiva é mais forte.
- **Fading Speed** (0.1 a 10.0 Hz) - Define a rapidez com que os trajetos ionosféricos variam. Valores baixos produzem ondulações lentas; a partir de alguns hertz o movimento vira um flutter rápido.
- **Delay Spread** (0.2 a 8.0 ms) - Define a diferença de atraso entre os dois trajetos ionosféricos. Determina o espaçamento dos vales de desvanecimento dentro da banda de áudio (cerca de 1 kHz de espaçamento em 1 ms, ficando mais estreito conforme o valor sobe), que é o que faz um desvanecimento profundo soar aquoso em vez de apenas mais baixo. Valores curtos desvanecem toda a banda junta; valores longos fazem cada região do espectro desvanecer em momentos diferentes.
- **Static** (0 a 100/s) - Define a taxa de eventos de estática semelhantes a raios. Cada evento é injetado antes do filtro FI e ressoa nele. Em 0 eles ficam desligados.
- **Interference** (-80 a 0 dB) - Define a intensidade de uma estação que divide o canal. Em -80 dB ela fica praticamente desligada; quanto mais perto de 0 dB, mais forte.
- **Interf. Offset** (0.1 a 10 kHz) - Define a que distância a portadora interferente está da sua. As duas portadoras batem nessa diferença e produzem o assobio de heteródino, de modo que este controle define sua altura: abaixo de cerca de 3 kHz é um tom claro e, ao subir, ele fica mais agudo até o filtro FI começar a atenuá-lo. O programa da estação interferente é modelado como ruído conformado, então acrescenta uma textura áspera e chiada em vez de fala inteligível.

#### Tuning

- **Mode** (AM, USB ou LSB) - Seleciona o som de radiodifusão em AM ou o som mais estreito de banda lateral única dos recetores de comunicações. BFO Offset só funciona em USB e LSB; Detector e Detector RC só funcionam em AM. Os controlos desativados mantêm os seus valores.
- **Tuning** (-5.0 a +5.0 kHz) - Desloca o receptor em relação à estação: valores positivos sintonizam acima dela e valores negativos, abaixo. Desvios pequenos abafam o som, acrescentam distorção de filtragem assimétrica e mudam o volume do assobio de heteródino; desvios maiores empurram a estação para fora da estreita banda passante de FI. Ao sintonizar para cima, o áudio recuperado desce em USB e sobe em LSB; ao sintonizar para baixo, essas direções se invertem.
- **BFO Offset** (-1000 a +1000 Hz) - Ajusta finamente o oscilador de batimento em USB e LSB; não tem efeito em AM. Junto com Tuning, define o deslocamento de frequência aplicado a tudo o que o receptor recupera. O deslocamento total do receptor em hertz é Tuning × 1000 + BFO Offset: em USB ele é subtraído de cada componente e em LSB é somado a cada um. Zero é exatamente na frequência, algumas dezenas de hertz já deixam o som anasalado, e valores maiores o tornam ininteligível como faz um receptor dessintonizado.
- **IF Bandwidth** (2.0 a 10.0 kHz) - Define a banda passante de FI do receptor. Ajustes estreitos correspondem à resposta de um receptor de comunicações, que rejeita mais ruído e mais da estação interferente, mas remove mais agudos; ajustes largos preservam mais detalhes e mais interferência. O áudio recuperado chega à metade deste ajuste em todos os modos — cerca de 3 kHz no padrão de 6 kHz; em USB e LSB existe apenas uma banda lateral, então a outra metade da banda passante deixa passar apenas ruído e interferência. Mode não muda este controle por você; reduza-o você mesmo para um som de comunicações mais estreito.

#### Receiver

- **Detector** (Envelope ou Synchronous) - Envelope é o detector a diodo comum, e é ele que transforma um desvanecimento seletivo profundo em distorção aquosa. Synchronous recupera a portadora com um PLL e demodula em relação a ela, o que reduz muito essa distorção enquanto o desvanecimento é profundo. Ele engata em cerca de ±1 kHz de Tuning e perde o engate além disso, então use Envelope enquanto move o dial. Trocar de detector reinicia a aquisição da portadora. Aplica-se somente em AM, porque USB e LSB usam sempre o detector de produto com BFO.
- **AGC Speed** (Slow, Mid ou Fast) - Define a rapidez com que o controle automático de ganho acompanha os desvanecimentos. Slow mantém as variações de nível audíveis e bombeia quando o sinal se recupera; Fast segura o nível com mais firmeza. Em AM ele define tanto a rapidez com que o ganho desce em uma subida quanto a rapidez com que volta a subir. Em USB e LSB define apenas a recuperação: o ganho sempre desce em poucos milissegundos, como em um receptor de banda lateral única real, de modo que cada frase nova é contida em vez de estourar.
- **Detector RC** (20 a 500 µs) - Define o tempo de descarga do detector de envoltória. Valores longos suavizam mais a envoltória, mas aumentam a distorção de corte diagonal nos agudos com modulação forte. Não tem efeito quando Detector está em Synchronous, nem em USB e LSB.
- **Hum** (-80 a -20 dB) - Define o zumbido da fonte de alimentação. Em -80 dB ele fica praticamente desligado. Ao contrário de uma camada de zumbido somada, a maior parte deste controle modula o ganho do receptor antes da detecção.
- **Hum Freq** (50 ou 60 Hz) - Seleciona a frequência de rede simulada.

#### Output

- **Speaker** (Off, Small ou Table) - Seleciona saída de linha, o alto-falante limitado de um receptor portátil de onda curta ou a resposta mais cheia de um receptor de comunicações de mesa.
- **Output Gain** (-24 a +24 dB) - Ajusta o nível após o processamento do receptor e do alto-falante.
- **Mix** (0 a 100%) - Mistura o sinal estéreo original com a recepção mono simulada. 100% é a recepção de onda curta completa, enviada igual para a esquerda e a direita. Mix não atrasa o sinal seco para alinhá-lo, portanto os ajustes intermediários combinam os dois com a diferença de tempo do receptor e da propagação.

### Leitura do HUD

- **S METER** mostra, em uma escala de S1 a S9, a intensidade total de sinal que o receptor tem dentro da sua banda antes do AGC, em todos os modos. Como o S-metro de um receptor real, ele lê tudo o que está dentro da faixa de passagem, portanto a estação do mesmo canal, o ruído e a estática também elevam a leitura junto com a estação desejada. Em AM esse total é dominado pela portadora e por isso fica estável; em USB e LSB a portadora é suprimida, então a leitura acompanha o programa e cai em direção ao ruído entre as frases.
- **FADE** mostra em dB a variação atual do ganho de propagação e oscila tanto abaixo quanto acima de 0 dB conforme o trajeto direto e os dois trajetos ionosféricos se cancelam ou se reforçam. Em onda curta este é o indicador a observar: ele se move continuamente nos valores padrão, e os pontos mais fundos são onde o som fica aquoso e distorcido. É sempre o ganho do trajeto na frequência da portadora, então em USB e LSB ele informa esse ganho para a portadora suprimida — não a atenuação da banda lateral como um todo, nem o nível do programa.
- **AGC GAIN** mostra quanto ganho o receptor está aplicando. Aumenta quando Signal diminui ou o desvanecimento se aprofunda. Ele é limitado a +42 dB, portanto os desvanecimentos mais profundos permanecem com volume menor em vez de serem totalmente compensados.
- **MOD / EVENTS**, rotulado **TX / EVENTS** em USB e LSB, mostra a porcentagem efetiva de modulação — o nível de excitação da banda lateral em USB e LSB — e, em seguida, as taxas recentes por segundo de estática (⚡) e de corte (▲), piscando quando esses eventos ocorrem. Se você quiser um resultado mais limpo e o corte for frequente, reduza Mod Depth ou Detector RC. A contagem de corte registra a sobremodulação de AM e o corte do detector de envoltória, então fica parada em USB e LSB.
- Se o motor **WASM** não estiver disponível, o HUD exibe um aviso e o plugin deixa o áudio passar inalterado.

### Ajustes recomendados

1. **Transmissão internacional distante**
   - TX Bandwidth: 4.5 kHz, Mod Depth: 90%, Signal: -15 dB, Fading: 55%, Fading Speed: 0.5 Hz, Delay Spread: 1.4 ms, Static: 2/s
   - Interference: -47 dB, Interf. Offset: 1.0 kHz, Tuning: 0 kHz, IF Bandwidth: 6.0 kHz, Detector: Envelope, AGC Speed: Fast, Hum: -80 dB, Speaker: Small, Mix: 100%
   - O som cotidiano da onda curta: estreito, em desvanecimento contínuo, com um estalo ocasional e um assobio tênue.

2. **Desvanecimento profundo noturno**
   - Signal: -30 dB, Fading: 100%, Fading Speed: 0.3 Hz, Delay Spread: 5.0 ms, Static: 10/s
   - IF Bandwidth: 4.0 kHz, Detector: Envelope, AGC Speed: Slow, Detector RC: 150 µs, Speaker: Small, Mix: 100%
   - Ondulações longas e profundas, com distorção aquosa no fundo de cada desvanecimento e bombeamento de AGC claramente audível na recuperação.

3. **Banda congestionada**
   - Signal: -20 dB, Fading: 60%, Fading Speed: 0.5 Hz, Static: 8/s, Interference: -18 dB, Interf. Offset: 0.8 kHz
   - Tuning: +0.3 kHz, IF Bandwidth: 4.0 kHz, AGC Speed: Mid, Speaker: Small, Mix: 100%
   - Um assobio de heteródino constante sobre o programa. Mude Interf. Offset para mover sua altura e Tuning para mudar seu volume.

4. **Detecção síncrona**
   - Parta de Desvanecimento profundo noturno e defina Detector: Synchronous
   - Os desvanecimentos profundos continuam, mas a distorção no fundo de cada um fica bem mais fraca e o programa segue inteligível. Mantenha Tuning dentro de cerca de ±1 kHz para o detector permanecer engatado e compare com Envelope para ouvir o que ele faz.

5. **Flutter polar**
   - Signal: -25 dB, Fading: 90%, Fading Speed: 6 Hz, Delay Spread: 3.0 ms, Static: 5/s
   - IF Bandwidth: 5.0 kHz, Detector: Envelope, AGC Speed: Fast, Speaker: Small, Mix: 100%
   - O cintilar rápido de um trajeto perturbado ou polar, em vez de uma ondulação lenta.

6. **Estação em banda lateral única**
   - Mode: USB, Tuning: 0 kHz, BFO Offset: 0 Hz, TX Bandwidth: 3.0 kHz, IF Bandwidth: 6.0 kHz
   - Signal: -20 dB, Fading: 55%, Fading Speed: 0.5 Hz, Static: 2/s, AGC Speed: Fast, Speaker: Small, Output Gain: 0 dB, Mix: 100%
   - Áudio de comunicações estreito e seco, na frequência certa, com o AGC respirando entre as frases. O nível já fica próximo do de uma estação AM, portanto nenhum ajuste adicional é necessário.

7. **Voz de pato fora de frequência**
   - Parta de Estação em banda lateral única e defina BFO Offset: -150 Hz
   - Todos os componentes sobem 150 Hz, então os harmônicos deixam de se alinhar e vozes e instrumentos ficam anasalados e inarmônicos. Mude Mode para LSB com o mesmo ajuste para que tudo desça 150 Hz em vez disso, e use Tuning para desvios maiores.
## Tape Artifacts

Tape Artifacts grava a música em um gravador de rolo analógico modelado e a reproduz. O sinal passa pelo amplificador de gravação e pelo realce de agudos aplicado à fita, pela saturação magnética, pela perda de agudos causada pelo Bias, pelas perdas da cabeça reprodutora, pelo wow e flutter do transporte, pela elevação de graves da cabeça e pela curva de reprodução, antes de receber chiado e ruído de modulação. Use-o quando quiser que a própria música soe como se tivesse passado por um gravador, e não apenas com ruído ou oscilação acrescentados por cima.

### Diferenças em relação a outros efeitos lo-fi

- **Tape Artifacts** altera a própria música. A compressão suave, o calor, os agudos suavizados e a oscilação de afinação vêm da mesma cadeia de gravação e reprodução, portanto respondem em conjunto a Speed, Tape, Bias e Record Level.
- **Wow Flutter** (Modulation) reproduz apenas a variação de velocidade do transporte. Escolha-o quando quiser a oscilação sem saturação, equalização ou chiado da fita.
- **Saturation** e **Hard Clipping** acrescentam apenas não linearidade, sem o comportamento dependente da frequência nem o transporte de um gravador de fita.
- **Noise Blender** e **Hum Generator** acrescentam ruído ou hum sobre uma música inalterada. Aqui, o chiado e o ruído de modulação surgem no ponto correspondente da máquina e acompanham Speed e Tape como o ruído de fita real.

### Guia de caráter sonoro

- **Speed define o timbre básico:** 30 ips é o mais aberto, 15 ips oferece o conhecido som de estúdio e 7.5 ips é mais escuro, com uma elevação de graves mais forte.
- **Compressão suave:** aumente Record Level para que a fita arredonde os picos e torne passagens fortes mais densas e quentes. Diminua-o para um resultado mais limpo e dinâmico, depois iguale o volume com Output.
- **Calor:** a saturação produz harmônicos pares e ímpares, e o calor aumenta gradualmente conforme Record Level sobe.
- **O transporte aparece em notas sustentadas:** Wow/Flutter acrescenta deriva e tremulação de afinação ao piano, órgão, cordas e outros sons longos.
- **Um fundo vivo:** Hiss acrescenta tanto um ruído contínuo quanto ruído que acompanha a música. Use o mínimo para não acrescentar ruído de fita.

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para experimentar diretamente estas configurações completas.

- **Pristine 30 ips Reel** - Uma transferência rápida de fita master, com muito pouco chiado ou variação de altura.
- **Hobbyist Reel-to-Reel** - Um gravador doméstico mais lento, com mais chiado e instabilidade do transporte.
- **Tired Old Reel** - Uma fita lenta e gasta, com forte oscilação, chiado e agudos mais ásperos.

### Parâmetros

- **Speed** (7.5, 15 ou 30 ips) - Seleciona a velocidade da fita. Comece em 15 ips; escolha 30 ips para o som mais limpo e aberto ou 7.5 ips para um timbre mais escuro, maior elevação de graves e mais movimento.
- **Tape** (Standard ou Master) - Seleciona a formulação da fita. Master tem mais margem e permanece mais limpa com Record Level alto; Standard satura antes. Iguale o volume com Output ao compará-las.
- **Bias** (-6.0 a +6.0 dB) - Altera os agudos e a distorção. Comece em 0 dB. Valores positivos soam mais limpos e escuros; valores moderadamente negativos, mais brilhantes e ásperos. Valores negativos extremos acrescentam distorção sem continuar clareando o som.
- **Record Level** (-12.0 a +18.0 dB) - Controla a intensidade com que a fita é gravada. Comece em +6 dB, aumente-o para obter mais compressão e calor ou diminua-o para preservar a dinâmica. Use Output para igualar o volume.
- **Wow/Flutter** (0 a 1%) - Controla o movimento de afinação causado pelo transporte. 0% é estável; aumente-o até que as notas sustentadas tenham a quantidade de deriva e tremulação desejada.
- **Hiss** (-89.0 a -39.0 dB re 320 nWb/m) - Controla o chiado da fita e o ruído de modulação relacionado ao sinal. Aumente-o para um fundo de fita mais evidente ou use o mínimo para desligar a camada de ruído.
- **Output** (-24.0 a +24.0 dB) - Ajusta o nível depois de toda a cadeia. Use-o para igualar o volume ao comparar com o bypass ou para recuperar o volume perdido com Record Level alto.
- **Mix** (0 a 100%) - Mistura o som de fita com o original. Comece em 100% para o efeito completo e diminua-o para uma coloração sutil. Valores intermediários podem suavizar os agudos mais altos por cancelamento parcial.

### Ajustes recomendados

1. **Fita master de estúdio (padrão)**
   - Speed: 15 ips, Tape: Standard, Bias: 0.0 dB, Record Level: +6.0 dB
   - Wow/Flutter: 0.160%, Hiss: -62.5 dB re 320 nWb/m, Output: 0.0 dB, Mix: 100%
   - Um som equilibrado de gravador de rolo, com agudos suavizados, calor leve, pouco chiado e movimento audível em notas sustentadas.

2. **Cópia limpa em alta velocidade**
   - Speed: 30 ips, Tape: Master, Bias: 0.0 dB, Record Level: 0.0 dB
   - Wow/Flutter: 0.070%, Hiss: -68.5 dB re 320 nWb/m, Output: 0.0 dB, Mix: 100%
   - O ajuste mais limpo, útil como referência ao comparar colorações de fita mais fortes.

3. **Quente e comprimido**
   - Speed: 15 ips, Tape: Standard, Bias: 0.0 dB, Record Level: +18.0 dB
   - Wow/Flutter: 0.200%, Hiss: -62.5 dB re 320 nWb/m, Output: +1.5 dB, Mix: 100%
   - Compressão de fita densa e quente, com picos achatados. Depois de ajustar a intensidade, refine Output de ouvido.

4. **Deck doméstico a 7.5 ips**
   - Speed: 7.5 ips, Tape: Standard, Bias: +2.0 dB, Record Level: +12.0 dB
   - Wow/Flutter: 0.300%, Hiss: -59.5 dB re 320 nWb/m, Output: +0.5 dB, Mix: 100%
   - Um som mais escuro, ruidoso e instável de máquina doméstica, com saturação moderada.

5. **Transporte gasto**
   - Speed: 7.5 ips, Tape: Standard, Bias: -2.0 dB, Record Level: +15.0 dB
   - Wow/Flutter: 0.480%, Hiss: -56.5 dB re 320 nWb/m, Output: +1.0 dB, Mix: 100%
   - Um som intencionalmente degradado, com forte movimento de afinação, aspereza, compressão e chiado.

Tape Artifacts acrescenta cerca de 5 ms de atraso quando Mix está acima de 0%. Ele se concentra no timbre, na saturação, no chiado e no movimento do transporte da fita; não acrescenta quedas de sinal, ruído de emendas nem erros de alinhamento da cabeça.

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

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para experimentar diretamente estas configurações completas.

- **Gentle Patina** - Ruído de disco em baixo nível para uma superfície envelhecida discreta.
- **Thrift Store Copy** - Estalos, crepitação e desgaste frequentes para um disco claramente danificado.
- **Rumbly Old Player** - O caráter normal de superfície com rumble adicional de baixa frequência, como o de uma vitrola.

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
- **Noise Tone** - Ajusta a resposta de frequência do ruído gerado (0.0 a 10.0)
  - 0: Tom de ruído plano
  - 5: Tom de ruído parcialmente escurecido
  - 10: Tom de ruído escuro
- **Wear** - Escala artefatos de desgaste de superfície, como pops, crackles e hiss (0 a 200%)
  - 0-50%: Ruído de superfície mais limpo
  - 50-100%: Desgaste normal da superfície
  - 100-200%: Ruído de superfície muito desgastada
  - Rumble, Crosstalk e Noise Tone são controlados separadamente
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
   - Hiss: -48dB, Rumble: -60dB, Crosstalk: 30%, Noise Tone: 5.0
   - Wear: 25%, React: 20%, React Mode: Velocity, Mix: 100%
   - Perfeito para: Adicionar textura suave de superfície de vinil

2. Experiência de Vinil Clássica
   - Pops/min: 40, Pop Level: -36dB, Crackles/min: 400, Crackle Level: -36dB
   - Hiss: -36dB, Rumble: -50dB, Crosstalk: 50%, Noise Tone: 6.0
   - Wear: 60%, React: 30%, React Mode: Velocity, Mix: 100%
   - Perfeito para: Experiência autêntica de audição de vinil

3. Disco Muito Desgastado
   - Pops/min: 80, Pop Level: -24dB, Crackles/min: 800, Crackle Level: -24dB
   - Hiss: -30dB, Rumble: -40dB, Crosstalk: 70%, Noise Tone: 7.0
   - Wear: 120%, React: 50%, React Mode: Velocity, Mix: 100%
   - Perfeito para: Caráter de disco muito envelhecido

4. Lo-Fi Ambiental
   - Pops/min: 15, Pop Level: -54dB, Crackles/min: 150, Crackle Level: -54dB
   - Hiss: -42dB, Rumble: -66dB, Crosstalk: 25%, Noise Tone: 4.0
   - Wear: 40%, React: 15%, React Mode: Amplitude, Mix: 100%
   - Perfeito para: Textura ambiental de fundo

5. Vinil Dinâmico
   - Pops/min: 60, Pop Level: -30dB, Crackles/min: 600, Crackle Level: -30dB
   - Hiss: -39dB, Rumble: -45dB, Crosstalk: 60%, Noise Tone: 5.0
   - Wear: 80%, React: 75%, React Mode: Velocity, Mix: 100%
   - Perfeito para: Ruído que responde dramaticamente à música

## Vinyl Simulator

O Vinyl Simulator transforma a própria música por meio de um modelo físico de corte e reprodução. Ele aplica filtros de corte e a curva RIAA de gravação, escreve o sinal em um sulco com rugosidade e detritos, segue esse sulco com uma simulação mecânica de agulha e braço e aplica a equalização RIAA de reprodução. Use-o quando quiser que geometria do sulco, rastreamento e superfície interajam com a música.

### Diferença para o Vinyl Artifacts

- **Vinyl Simulator** altera o sinal ao passá-lo pelo sulco e pela agulha modelados. Roughness, Dust, Static, Tracking Force, formato da agulha, Speed e Radius participam do resultado.
- **Vinyl Artifacts** mantém a música intacta e adiciona pops, crackle, hiss, rumble e fuga de ruído estéreo. Escolha-o para uma camada de ruído mais leve e previsível.
- Os dois podem ser combinados, mas ajustes fortes de superfície em ambos acumulam cliques e ruído rapidamente.

### Guia de aprimoramento sonoro

- **Reprodução suave:** Cut Level perto de 0 dB, Shape em Elliptical, Roughness moderado, pouco Dust e Static e Mix menor para preservar mais do original.
- **Caráter de sulco interno:** aproxime Radius de 60 mm. A menor velocidade linear exige mais do rastreamento e dos agudos.
- **Reprodução limpa e estável:** reduza Roughness, Dust, Static e Scratch, mantenha Tracking Force perto de 2 g e use Standard ou High.
- **Superfície envelhecida:** aumente primeiro Roughness e depois Dust, Static e um pouco de Scratch; cada controle representa um fenômeno físico diferente.
- **Coloração mais evidente:** aumente Cut Level com cuidado, reduza HF Cutoff ou Radius. Observe a queda de Tracking S/E e o aumento de mistrack/skip.
- O efeito não inclui wow/flutter, excentricidade, empenamento nem rumble do toca-discos. Adicione **Wow Flutter** à cadeia se necessário.

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para experimentar diretamente estas configurações completas.

- **Audiophile Pressing** - Uma superfície de disco silenciosa e cuidadosamente mantida.
- **Well-Worn Favorite** - Mais aspereza, poeira e estática de um disco tocado muitas vezes.
- **Flea Market 45** - Um compacto de 45 rpm gasto, com agulha esférica e ruído de superfície marcante.
- **78 rpm Shellac** - O caráter áspero e de faixa estreita de um antigo disco de goma-laca.
- **End of Side** - Uma posição de sulco interno com o comportamento de leitura do fim de uma face do disco.

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

- **Shape** (Spherical ou Elliptical) — Seleciona a forma de contacto da agulha. Elliptical segue melhor os detalhes finos do sulco; Spherical oferece um contacto mais arredondado e tolerante.
- **Side Radius** (5 a 25 µm) — Raio transversal à parede; altera a área e a pressão de contato.
- **Scan Radius** (2 a 25 µm) — Raio no sentido do sulco. Pequeno segue detalhes finos; grande faz média em um contato mais amplo.
- **Tracking Force** (0,5 a 5,0 g) — Força de apoio. Mais pode estabilizar o contato, mas aumenta força e pressão; pouca favorece mistrack e skip.
- **Tip Mass** (0,1 a 1,5 mg) — Massa móvel da ponta. Mais massa adiciona inércia e dificulta movimentos rápidos.
- **Compliance** (5 a 35 cu) — Flexibilidade da suspensão. Valores altos permitem mais movimento e mudam a resposta mecânica.
- **Damping** (0,05 a 1,0 ζ) — Amortecimento de ressonâncias. Valores altos reduzem mais o ringing.

#### Output

- **Quality** (Eco, Standard, High ou Ultra) — Equilibra o detalhe do seguimento do sulco e o uso de CPU. Standard é o ponto de partida recomendado para audição em tempo real.
- **Output Gain** (-24 a +24 dB) — Nível após equalização RIAA e normalização.
- **Mix** (0 a 100%) — Mistura a reprodução simulada com o sinal seco alinhado em latência. 0% = seco; 100% = simulado.

### Como ler o HUD

- **Force L/R (mN):** força em cada parede; valores altos ou desiguais indicam um trecho exigente.
- **Pressure (GPa):** maior pressão de contato atual; leia junto com Force ao ajustar a agulha.
- **Tip (cm/s, dB):** velocidade da ponta e nível de reprodução resultante.
- **Tracking S/E L/R (dB):** relação entre sinal rastreado e erro. Mais alto é mais limpo; queda persistente indica dificuldade.
- **Jitter (ns):** variação de tempo no ponto de leitura, visível em Stylus.
- **Mistrack, Skip, Static Pop e Dust Hit (/s):** taxas recentes, com flash em cada evento. Se repetirem, reduza Cut Level, aumente Tracking Force moderadamente, Radius ou Quality.

O HUD atualiza os valores durante a reprodução e pode mostrar um estado inativo quando esta está parada.

### Configurações recomendadas

1. **Reprodução suave:** Cut Level 0 dB, HF Cutoff 16 kHz, 33⅓ rpm, Radius 120 mm, Roughness 5 nm, Dust 0,5/s, Static 0,02/s, Scratch 0/s, Elliptical, Tracking Force 2,0 g, Standard, Mix 75%.
2. **Sulco externo clássico:** Cut Level 0 dB, 33⅓ rpm, Radius 135 mm, Roughness 13,17 nm, Dust 2/s, Static 0,08/s, Elliptical, Tracking Force 2,0 g, Standard, Mix 100%.
3. **Demonstração interna:** Cut Level +3 dB, HF Cutoff 14 kHz, Radius 60 mm, Elliptical, Scan Radius 8 µm, Tracking Force 2,0 g, High, Mix 100%; compare Tracking S/E com Radius maior.
4. **Superfície gasta:** Radius 100 mm, Roughness 35 nm, Dust 25/s, Static 1/s, Scratch 0,5/s, Tracking Force 2,2 g, Standard, Output Gain -3 dB, Mix 100%.

### Quality e carga de CPU

- **Eco** usa menos CPU e é a primeira opção para dispositivos menos potentes.
- **Standard** é o ponto de partida recomendado para audição normal.
- **High** melhora o rastreamento do sulco com custo considerável de CPU.
- **Ultra** é extremamente exigente e raramente útil para audição em tempo real.
- Taxas de amostragem maiores e ajustes exigentes da agulha também aumentam o uso de CPU. Se a reprodução falhar, reduza primeiro Quality.

Se o Vinyl Simulator não estiver disponível no dispositivo, o áudio passa sem alteração e o painel mostra um aviso. O efeito não adiciona wow, excentricidade, empenamento nem rumble; use Wow Flutter ou outro efeito de ruído quando quiser esses sons.
