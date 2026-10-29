---
title: "Plugins de Análise - Analisador de espectro, espectrograma, medidores VU e LUFS - EffeTune"
description: "Plugins de análise de áudio, incluindo Analog Meter, Chroma Spiral, Level Meter, Note Spectrogram, Oscilloscope, Pitch Meter, Rhythm Analyzer, Spectrogram, Spectrum Analyzer e Stereo Meter."
lang: pt
---

# Plugins de Análise

Uma coleção de plugins que permitem visualizar sua música de maneiras fascinantes. Essas ferramentas visuais ajudam você a entender o que está ouvindo, mostrando diferentes aspectos do som e tornando sua experiência de audição mais envolvente e interativa.

## Lista de Plugins

- [Analog Meter](#analog-meter) - Mostra o nível dos canais em um medidor de agulha com escalas de VU, PPM, pico e loudness
- [Chroma Spiral](#chroma-spiral) - Distribui os componentes de frequência numa espiral de notas e oitavas
- [Level Meter](#level-meter) - Mostra o nível do sinal digital e possível clipping
- [Note Spectrogram](#note-spectrogram) - Mostra as alturas estimadas ao longo do tempo em um piano roll
- [Oscilloscope](#oscilloscope) - Exibe visualização da forma de onda em tempo real
- [Pitch Meter](#pitch-meter) - Acompanha uma frequência fundamental e sua afinação ao longo do tempo
- [Rhythm Analyzer](#rhythm-analyzer) - Mostra o andamento, os toques tempo a tempo, e o quanto cada parte se adianta ou se atrasa
- [Spectrogram](#spectrogram) - Cria padrões visuais bonitos a partir da sua música
- [Spectrum Analyzer](#spectrum-analyzer) - Mostra as diferentes frequências na sua música
- [Stereo Meter](#stereo-meter) - Visualiza o balanço estéreo e as relações de fase

## Analog Meter

Mostra o nível de cada canal em um medidor de agulha clássico, sem alterar o som. Use-o para acompanhar como a intensidade da sua música varia a cada momento, ou para ver como sua reprodução se comporta nas escalas usadas em transmissão e streaming: VU, PPM, pico e loudness (LUFS). **Custom** permite combinar um detector, o movimento da agulha e uma escala para criar seu próprio medidor.

### Guia de audição

- **Acompanhe o nível médio com o VU**: observe a agulha ao longo de uma música. Versos calmos e refrões intensos mostram uma diferença clara, enquanto batidas curtas de bateria quase não movem a agulha.
- **Verifique o clipping com o True Peak**: coloque o Analog Meter depois dos seus efeitos de EQ e ganho e reproduza a parte mais alta de uma faixa. Se a leitura passar de 0 dBFS ou a lâmpada de overload acender, a cadeia pode estar entrando em clipping; reduza o ganho até que os picos fiquem abaixo de 0 dBFS, com uma pequena margem, como -1 dBFS.
- **Compare músicas com o Loudness**: defina o **Target** para uma referência de streaming, como -14 LUFS, pressione **Reset** no início de uma música ou álbum e reproduza-o até o fim. O valor Integrated mostra a loudness geral e o True Peak máximo mostra o pico mais alto, o que serve como referência para equalizar o volume entre músicas de um álbum ou playlist. O LRA permite comparar o quanto a loudness de cada música varia.
- **Crie seu medidor com Custom**: comece com **Bouncy VU** para uma agulha mais animada, **Slow RMS** para observar o nível médio com calma ou **Fast Peak** para acompanhar picos breves. Ajuste a velocidade com **Needle Response** e o balanço com **Overshoot**. Custom pode dar uma subida e uma descida parecidas com PPM, mas seus detectores de pico sobem instantaneamente; use **PPM** para a resposta PPM padrão.

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para escolher um medidor padrão ou personalizado em um só passo. Uma predefinição que altera o **Mode** reinicia a medição; alternar entre as predefinições de Loudness mantém a medição em andamento.

- **Studio VU (-18 dBFS)** - VU com 0 VU em -18 dBFS, o alinhamento comum em estúdios (EBU R68). Adequado para gravações com bastante headroom.
- **SMPTE VU (-20 dBFS)** - VU com 0 VU em -20 dBFS (SMPTE RP 155), a prática em estúdios e emissoras da América do Norte.
- **Hot VU (-14 dBFS)** - As configurações padrão: VU com 0 VU em -14 dBFS, adequado para a maioria das gravações comerciais finalizadas.
- **Loud Master VU (-8 dBFS)** - VU com 0 VU em -8 dBFS, para CDs modernos e masters de pop com a loudness levada ao máximo, que de outra forma deixariam a agulha presa no topo.
- **DIN PPM** - O medidor DIN (**Attack** de 5 ms, queda de 20 dB em 1,5 s, escala DIN) com a marca -9 em -18 dBFS, de modo que o 0 fica em -9 dBFS. A escala vai até -50.
- **BBC PPM** - O medidor BBC (**Attack** de 10 ms, queda de 24 dB em 2,8 s, escala BBC) com a marca 4 em -18 dBFS, de modo que a marca 6 fica em -10 dBFS.
- **Nagra Modulometer** - O modulômetro dos gravadores de fita Nagra (**Attack** de 7,5 ms, escala em dB de -30 a +5 dB) com 0 dB em -18 dBFS. O **Release** usa o valor DIN de 1,5 s.
- **K-20** - O K-System de Bob Katz em um medidor RMS, com 0 em -20 dBFS e a escala descendo até -60 dBFS. Para gravações com dinâmica ampla.
- **K-14** - O mesmo, com 0 em -14 dBFS e a escala até -60 dBFS. Para a música pop típica.
- **K-12** - O mesmo, com 0 em -12 dBFS e a escala até -60 dBFS. Para material bem comprimido, feito para transmissão.
- **Digital Peak** - Um medidor de pico digital padrão (IEC 60268-18) de -60 a 0 dBFS, com retenção de pico de 2 s.
- **True Peak Clip Watch** - True Peak ampliado nos 20 dB superiores, com a retenção de pico mais longa (10 s), para flagrar picos acima de 0 dBFS depois de mudanças de EQ ou ganho.
- **EBU R128 (-23 LUFS)** - Loudness com o alvo de transmissão europeu e a escala EBU +9.
- **EBU R128 +18 Scale** - O mesmo alvo com a escala EBU +18, mais ampla, para música clássica e outros materiais com dinâmica ampla.
- **TV (-24 LKFS)** - Loudness com o alvo de -24 LKFS usado na TV dos EUA (ATSC A/85) e do Japão (ARIB TR-B32).
- **Streaming (-14 LUFS)** - Loudness com alvo de -14 LUFS, próximo da normalização de volume de muitos serviços de streaming de música, e a agulha Short-term, mais calma.
- **Streaming (-16 LUFS)** - Loudness com o alvo de -16 LUFS recomendado para streaming e podcasts (AES TD1008) e a agulha Short-term.
- **Bouncy VU** - Custom com o detector e a escala de VU e sobressinal de 15% para acentuar o balanço da agulha.
- **Slow RMS** - Custom com média RMS de 3 s, resposta da agulha de 1000 ms e sem sobressinal. A escala dB coloca o 0 em -18 dBFS e chega até -60 dBFS.
- **Fast Peak** - Custom com detecção True Peak, liberação do detector de 0,5 s, resposta da agulha de 10 ms e sem sobressinal. A escala dBFS cobre os 40 dB superiores e mostra a leitura em dBTP.

### Parâmetros

Somente os controles que se aplicam ao **Mode** selecionado são exibidos. Em **Custom**, todos os controles desse modo continuam visíveis; os que não se aplicam ficam desativados, mantendo a mesma altura do painel de ajustes.

- **Mode** - Seleciona o tipo de medidor: **VU** (padrão), **PPM**, **RMS**, **Sample Peak**, **True Peak**, **Loudness** ou **Custom**. Cada modo move a agulha de forma diferente e usa sua própria escala (veja o Guia de Visualização). Alterar o modo reinicia a medição.
- **Detector** (Custom; padrão Average Rectified) - Escolhe o nível que a agulha acompanha. **Average Rectified** usa a amplitude absoluta do sinal, cuja média é feita pela própria agulha, sem uma janela de média separada, como em VU. **RMS** mede a potência média durante **Integration**. **Sample Peak** detecta o maior valor de amostra; **True Peak** também estima picos entre as amostras. Ambos os detectores de pico sobem instantaneamente e descem conforme **Release**. Alterar o detector reinicia a medição.
- **Integration** (RMS, Custom com detector RMS; 0,05 a 3 s; padrão 0,3 s) - Define o tempo de média. Valores maiores tornam a agulha mais estável e lenta; valores menores fazem-na acompanhar as mudanças mais rapidamente. Em Custom, a agulha acrescenta sua própria resposta depois dessa média.
- **Attack** (PPM; 1 a 20 ms; padrão 5 ms) - Define a rapidez com que a agulha do PPM sobe, como a duração de uma explosão de tom que é lida 2 dB abaixo de um tom constante. Valores menores mostram picos breves mais próximos do seu nível real; valores maiores fazem picos breves serem lidos mais baixo. 5 ms corresponde ao medidor DIN.
- **Release** (PPM, Sample Peak, True Peak, Custom com detector Sample Peak ou True Peak; 0,1 a 5 s; padrão 1,5 s) - Define o tempo de queda de 20 dB após um pico. Valores maiores facilitam a leitura dos picos; valores menores acompanham a música mais de perto. Em Custom, controla a queda do detector, seguida pela resposta da agulha. 1,5 s corresponde ao medidor DIN e ao medidor de pico digital padrão.
- **Needle Response** (Custom; 1 a 3000 ms; padrão 300 ms) - Define quanto tempo a agulha leva para atingir pela primeira vez 99% de um novo nível constante do detector. Valores menores aceleram a agulha; valores maiores a tornam mais lenta. A média RMS e a liberação dos picos também afetam o movimento total.
- **Overshoot** (Custom; 0 a 25%; padrão 1,25%) - Define quanto a agulha ultrapassa um novo nível constante do detector, como porcentagem da mudança de nível. Valores maiores aumentam o balanço; 0 faz a agulha se aproximar sem ultrapassar o nível.
- **Dial** (Custom; padrão VU) - Escolhe **VU**, **DIN**, **BBC**, **dB** ou **dBFS** independentemente do detector e do movimento da agulha. VU, DIN e BBC usam as escalas descritas abaixo. Em dB, a marca 0 é **Reference** e o topo é 0 dBFS. Em dBFS, o topo é 0 dBFS e as leituras são em dBTP quando **Detector** é True Peak.
- **Reference** (VU, PPM, RMS, Custom exceto com escala dBFS; -30 a 0 dBFS; padrão -14 dBFS) - Define o nível digital que corresponde à marca de referência do medidor. O padrão é adequado para a maioria das gravações comerciais finalizadas; com os alinhamentos de estúdio de -18 ou -20 dBFS (veja Predefinições do sistema), CDs comuns costumam deixar a agulha perto do topo da escala. Aumente-o quando gravações altas empurrarem a agulha até o topo da escala; diminua-o quando gravações silenciosas quase não moverem a agulha.
- **Range** (PPM com a escala DIN ou dB, RMS, Sample Peak, True Peak, Custom com escala DIN, dB ou dBFS; 20 a 60 dB; padrão 40 dB) - Define até onde a escala se estende para baixo. Amplie-a para ver passagens silenciosas; reduza-a para espalhar melhor a parte superior da escala.
- **PPM Scale** (PPM; padrão DIN) - Seleciona a escala do PPM: **DIN**, **BBC** ou **dB** (veja o Guia de Visualização).
- **Peak Hold** (PPM, RMS, Sample Peak, True Peak, Custom; 0 a 10 s; padrão 1 s) - Define por quanto tempo a marca de pico permanece na leitura mais alta recente e por quanto tempo a lâmpada de overload fica acesa. 0 desativa a marca; a lâmpada de overload então fica acesa por 1 s.
- **Needle** (Loudness; padrão Momentary) - Seleciona o que a agulha mostra. **Momentary** acompanha a loudness dos últimos 0,4 s; **Short-term** mostra os últimos 3 s e se move de forma mais estável.
- **Target** (Loudness; -36 a -10 LUFS; padrão -23 LUFS) - Define a loudness marcada na escala e posiciona a escala tomando esse valor como referência. -23 LUFS é o nível de transmissão da EBU R128; muitos serviços de streaming usam valores em torno de -14 LUFS.
- **Scale** (Loudness; padrão EBU +9) - Seleciona a largura da escala de loudness. **EBU +9** cobre de 18 LU abaixo a 9 LU acima do **Target**; **EBU +18** cobre de 36 LU abaixo a 18 LU acima, o que é adequado para músicas com dinâmica ampla ou material muito alto.

### Guia de visualização

- Cada canal tem seu próprio medidor, com até quatro por linha e até 16 canais.
- Os níveis seguem a convenção digital comum de que uma onda senoidal em escala máxima é lida como 0 dBFS, então uma onda senoidal constante dá a mesma leitura em todos os modos, exceto Loudness.
- Os modos diferem na rapidez com que a agulha se move:

| Modo | Movimento da agulha | Escala |
|---|---|---|
| VU | Lento. Atinge um novo nível em cerca de 0,3 s e mostra o nível médio (IEC 60268-17). | -20 a +3 VU. 0 VU = **Reference**. |
| PPM | Uma aproximação baseada na IEC 60268-10. Sobe rapidamente na velocidade definida por **Attack**; com o padrão de 5 ms, uma explosão de 10 ms é lida cerca de 1 dB abaixo de um tom constante, como em um medidor DIN. Cai 20 dB no tempo de **Release**. | Selecionada por **PPM Scale**. **DIN**: a marca -9 = **Reference**, então 0 fica 9 dB acima dela. **BBC**: marcas de 1 a 7, com 4 dB entre as marcas de 2 a 7 e 6 dB entre 1 e 2; marca 4 = **Reference**. **dB**: a marca 0 = **Reference**, de **Range** abaixo dela até +5 dB. |
| RMS | Mostra a potência média durante o tempo de **Integration**, sem suavização extra. | A marca 0 = **Reference**. |
| Sample Peak | Salta imediatamente para o valor de amostra mais alto. | Topo da escala = 0 dBFS. |
| True Peak | Como o Sample Peak, mas também estima picos entre as amostras. Pode ler acima de 0 dBFS; esses picos podem causar clipping em um DAC ou durante a conversão. | Topo da escala = 0 dBFS. |
| Loudness | Mostra a loudness em LUFS, conforme definido pela ITU-R BS.1770 e pela EBU R128. | Definida por **Target** e **Scale**; as leituras são mostradas em LUFS. |
| Custom | Acompanha **Detector**, com velocidade definida por **Needle Response** e balanço por **Overshoot**. Os valores padrão dão o mesmo movimento que VU. | Escolhida com **Dial**, independentemente do movimento da agulha. |

- A marca de pico mostra a leitura mais alta recente durante o tempo de **Peak Hold**. A lâmpada de overload acende quando o nível excede 0 dBFS e fica acesa durante o tempo de **Peak Hold**, ou por 1 s quando **Peak Hold** é 0.
- No modo Loudness, o primeiro medidor mostra o programa inteiro. Sua agulha segue o **Needle**, e ele lista Momentary (M), Short-term (S), Integrated (I), Loudness Range (LRA), o True Peak máximo e o tempo de medição decorrido, com um botão **Reset**. Integrated e LRA aparecem depois que áudio suficiente for medido.
  - Para mono, estéreo e 5.1 (ordem de canais L, R, C, LFE, Ls, Rs), esses valores seguem a ponderação de canais padrão. Para outras contagens de canais, todos os canais são somados com peso igual, então os valores servem apenas como referência.
  - Os medidores após o primeiro mostram cada canal individualmente. São valores de referência, medidos sem ponderação de canais ou gating.
- Integrated, LRA e o True Peak máximo continuam se acumulando até você pressionar **Reset**, alterar o **Mode**, a taxa de amostragem ou a contagem de canais mudar, ou o processamento de áudio ser reiniciado.
- O tempo em que o processamento está pausado não é medido: durante pausas de economia de energia em silêncio, enquanto o Master Bypass está ativado ou o Analog Meter está desligado, ou enquanto o Effect Pipeline não está visível (por exemplo, na Biblioteca de música, com a janela minimizada ou no Minirreprodutor) com **Ignorar DSP de exibição quando oculto** ativado em Configuração (ativado por padrão). As leituras continuam de onde pararam.

## Chroma Spiral

Mostra onde os componentes de frequência da música se situam entre as 12 notas e as oitavas, sem alterar o som. Use-o para observar harmônicos sobrepostos, comparar a faixa de uma voz e de um baixo ou examinar a extensão de um instrumento.

### Guia de audição

- Sustente uma nota e observe sua posição e as posições iluminadas pelos harmônicos. Uma única nota pode iluminar vários nomes de nota; isso não significa que todas foram tocadas separadamente.
- Acompanhe um acorde ou uma melodia para ver a mudança das posições ativas. O gráfico pode sugerir padrões tonais, mas não identifica acordes nem tonalidades.
- Para observar a afinação, veja se um ponto brilhante ou a borda de uma área colorida aparece entre as marcas das notas. Para ler em cents o desvio de uma frequência fundamental, use Pitch Meter.
- Pressione o gráfico com o mouse, o dedo ou uma caneta para ouvir uma onda senoidal na posição escolhida da espiral. Arraste para mudar o tom; solte ou cancele o gesto para parar o som. Essa prévia funciona com todas as opções de **Color**.

### Parâmetros

- **Color** - Escolhe como o espectro é desenhado. A mesma espiral de referência permanece visível ao fundo com todas as opções, mesmo durante o silêncio.
  - **Normal** (padrão): mostra cada célula de frequência como um ponto na cor do traçado do gráfico do tema. Seu brilho acompanha o nível da célula e sua área cresce proporcionalmente a esse nível, facilitando a visualização das frequências mais fracas. No nível máximo, o raio do ponto alcança metade da distância até a volta seguinte.
  - **Normal 2**: colore da posição de cada frequência na espiral até seu nível na cor do traçado do gráfico, sem traçar o contorno dos dados.
  - **Note Colors**: mostra os mesmos pontos de Normal, mas com uma cor diferente para cada nota, repetida em todas as oitavas.
- **Lowest Octave** (1 a 8; padrão: 1) - Define a oitava mais interna. Aumente para se concentrar nos sons agudos.
- **Highest Octave** (1 a 9; padrão: 7) - Define a oitava mais externa. Reduza para focar graves e médios. Os dois limites permanecem na ordem correta.
- **Frequency Tilt** (de -6 a +6 dB/oct em passos de 0,5; padrão: +3) - Ajusta o nível exibido das frequências acima de 100 Hz sem mudar o som. Valores positivos destacam as frequências mais altas; valores negativos as tornam menos evidentes no gráfico. Em 0, não há correção por frequência.
- **Level Range** (de 6 a 96 dB em passos de 1 dB; padrão: 24) - Define a largura da faixa móvel de exibição. Reduza-a para destacar diferenças de nível ou amplie-a para ver componentes mais fracos junto dos mais fortes.
- **Display Floor** (de -120 a -24 dB em passos de 1 dB; padrão: -60) - Define até onde a faixa móvel pode descer em trechos silenciosos. Reduza-o para permitir que componentes mais fracos apareçam dentro do **Level Range** escolhido. A faixa também acompanha os picos recentes, então esse ajuste não garante que todos os componentes fracos sejam visíveis.

### Como ler o gráfico

- Cada volta representa uma oitava. C fica no topo e as notas seguem no sentido horário; voltas internas são mais graves. As marcas C indicam o número da oitava.
- Em **Normal** e **Note Colors**, pontos mais claros e maiores indicam componentes mais fortes em suas posições, inclusive entre notas. Em **Normal 2**, a região colorida se estende mais para fora onde os componentes são mais fortes; sua borda externa mostra a variação do espectro sem um traço separado.
- O brilho e a área dos pontos, assim como a extensão da área colorida, mostram intensidade relativa, não nível absoluto: a escala acompanha os picos recentes.
- Nas oitavas graves, notas próximas ficam menos distintas e a resposta é mais lenta; elas podem parecer sobrepostas.

### Exibição visual
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

## Level Meter

Um display visual que mostra em tempo real o nível digital do sinal da música. Ele ajuda a conferir os níveis depois de aplicar efeitos e a identificar possível clipping antes que vire distorção audível.

### Guia de visualização
- A barra horizontal se estende mais para a direita conforme o nível do sinal fica mais alto
- O marcador branco mantém um novo pico por um segundo e depois desce suavemente
- OVERLOAD significa que o sinal passou da faixa digital segura e pode distorcer
- Para uma reprodução limpa, evite níveis vermelhos frequentes ou avisos de OVERLOAD; ajuste o volume real de audição no seu dispositivo

## Note Spectrogram

Mostra as frequências fundamentais (F0) estimadas de A0 a C8 em um piano roll que rola continuamente, sem alterar o áudio. Use-o para acompanhar notas de acordes, linhas vocais e melódicas, linhas de baixo e notas sobrepostas em várias oitavas, com cores por instrumento e destaque opcionais. Também estima os nomes dos acordes e as tonalidades para ajudar a acompanhar as mudanças harmônicas.

### Guia de audição

- **Acordes e melodias**: Os acordes aparecem como linhas brilhantes simultâneas; melodias e linhas de baixo traçam caminhos pelas linhas das notas.
- **Acompanhe a voz ou o baixo**: Escolha **Instrument (3)**, ou mantenha **Note Colors** e selecione **Vocal** ou **Bass** em **Highlight**. Use **Instrument (9)** para uma separação mais fina dos instrumentos.
- **Precisão das estimativas**: As estimativas de altura e de instrumento são um apoio visual para a audição, não uma transcrição exata. Sons sobrepostos, percussão ou ruído podem gerar estimativas ambíguas, e a bateria não é classificada. As estimativas de instrumento usam as notas anteriores como pistas, por isso são menos confiáveis logo depois de ativá-las ou de mudar a posição de reprodução; uma estimativa, depois de pronta, não é revista.

### Grupos de instrumentos

**Instrument (3)** agrupa as alturas em **Vocal**, **Bass** e **Other** (todos os grupos abaixo, exceto Vocal e Bass).

**Instrument (9)** separa as alturas em nove grupos:
- **Vocal**: Canto humano gravado, incluindo vozes solo e coros.
- **Bass**: Baixo acústico, elétrico e de sintetizador.
- **Guitar**: Violões e guitarras limpas e distorcidas.
- **Piano**: Pianos acústicos e elétricos, cravo e clavinete.
- **Strings**: Cordas solo e em conjunto, pizzicato, harpa e cordas de sintetizador.
- **Wind**: Metais e madeiras, incluindo saxofones e flautas.
- **Synth**: Leads e pads de sintetizador.
- **Organ**: Órgãos, acordeão e gaita.
- **Other**: Percussão afinada (celesta, vibrafone), patches de coro/voz sintetizados, efeitos de sintetizador, orchestral hits, instrumentos étnicos e efeitos sonoros.

### Parâmetros

- **Color** - Seleciona as cores de exibição sem alterar a detecção de altura (ao trocar, o histórico existente é recolorido):
  - **Normal** (padrão): A cor do traçado do gráfico do tema.
  - **Note Colors**: Uma cor diferente para cada classe de altura, repetida em todas as oitavas.
  - **Instrument (3)**: Cores para Vocal, Bass e Other.
  - **Instrument (9)**: Cores para os nove grupos de instrumentos acima.
- **Highlight** - Destaca um grupo específico (**Vocal**, **Bass**, **Other (3)**, **Guitar**, **Piano**, **Strings**, **Wind**, **Synth**, **Organ** ou **Other (9)**) deslocando as notas para um cinza neutro quanto menor a probabilidade de pertencerem a esse grupo, preservando a espessura que representa o volume. **None** (padrão) desativa o destaque.
  - A análise de ataques e de instrumentos usa CPU adicional. Para reduzir ao mínimo o uso da CPU, desative **Onsets** e **Chords & Key**, escolha **Normal** ou **Note Colors** e defina **Highlight** como **None**.
- **Pitch Resolution** - Seleciona o detalhe vertical da altura sem apagar o histórico:
  - **1/12 Octave** (padrão): Uma linha por semitom.
  - **High**: Posiciona as alturas nos valores estimados em cents, mostrando vibrato e pitch bends.
- **Layout** - **Horizontal** (padrão, teclado embaixo, o histórico rola para cima) ou **Vertical** (teclado à direita, o histórico rola para a esquerda).
- **Volume** - Representa o volume relativo pela espessura das barras e por medidores semicirculares na borda do teclado (ativado por padrão). Desativado, a espessura das barras fica fixa.
- **Onsets** - Marca os ataques de nota estimados com triângulos (▼ em Horizontal, ▶ em Vertical; desativado por padrão). O centro da base de cada triângulo indica o instante e a altura do ataque, então ataques repetidos de uma mesma altura sustentada recebem marcas separadas. Desativá-lo não interrompe a análise de instrumentos enquanto um **Color** de instrumento ou **Highlight** precisar dela.
- **Chords & Key** (desativado por padrão) - Mostra a faixa de acordes e as estimativas de tonalidade quando ativado. Deixe desativado para reduzir o uso da CPU.
- **Time Span** (1 a 10 s; padrão 2 s) - Duração do histórico visível no piano roll.
- **Lowest Note** / **Highest Note** - Define a faixa de alturas analisada e exibida (padrões: E1 a G6).

### Guia de visualização

- **Atualização das alturas**: Um som novo aparece imediatamente e é refinado cerca de 40, 80 e 160 ms depois com base no áudio que vem em seguida, sem acrescentar atraso à exibição nem afetar **Sincronizar elementos visuais com o áudio**.
- **Grade e teclado**: As linhas em cada C marcam os limites das oitavas, as guias entre E e F continuam visíveis em todos os modos e as linhas das teclas pretas usam um fundo mais escuro. As teclas do piano se acendem de acordo com a confiança atual na altura.
- **Intensidade da cor**: A intensidade da cor sempre mostra a confiança na altura. Quando a entrada é baixa demais para a análise, o piano roll permanece escuro.
- **Cores por instrumento e destaque**: As cores por instrumento misturam as cores dos grupos na proporção de suas probabilidades estimadas. As cores aparecem nas posições correspondentes do histórico quando a estimativa do instrumento está pronta; as notas que aguardam classificação aparecem em cinza neutro. A legenda lista os grupos exibidos e, enquanto o destaque está ativo, acrescenta **Highlight:** seguido do grupo selecionado. Passe o cursor sobre qualquer grupo na legenda para destacá-lo temporariamente.
- **Barras de volume**: Com **Volume** ativado, a espessura das barras cobre uma faixa relativa de 24 dB, e um semicírculo suave na borda do teclado sobe imediatamente com o volume atual e desce a 20 dB/s.
- **Faixa de acordes**: A faixa estreita à direita em **Horizontal**, ou no topo em **Vertical**, acompanha a mesma linha do tempo das notas. Os nomes dos acordes aparecem cerca de 0,22 s após o som, quando a estimativa é confirmada. Nomes como **C**, **Cm7** e **C/E** indicam o acorde; a nota após a barra é o baixo de uma inversão. Intervalos sem acorde ficam vazios; intervalos curtos podem ser estreitos demais para mostrar um nome. Os nomes dos acordes aparecem em letras grandes; com **Note Colors**, os nomes e as barras de duração usam a cor da nota fundamental do acorde, inclusive nas inversões.
- **Key**: Mostra a tonalidade estimada do trecho atual em letras grandes no canto inferior esquerdo e com fundo transparente. A leitura desaparece quando não é possível identificar a tonalidade. Com **Note Colors**, usa a cor da tônica da tonalidade exibida.

### Exibição visual
- Passe o cursor sobre o histórico, ou toque e arraste sobre ele, para ler a nota, o tempo, **Salience** (confiança na altura), **Level** (dB) e, quando a análise de instrumentos está ativa, as probabilidades estimadas dos grupos: **Vocal**, **Bass** e **Other** em **Instrument (3)**, os nove grupos nos demais casos, mais o grupo de **Highlight** quando ele não estiver entre eles (**Not classified** para notas sem estimativa).
- Com **Chords & Key** ativado, a leitura também mostra o acorde naquele ponto, ou **No chord** quando a estimativa confirmada indica ausência de acorde; a leitura do acorde só aparece quando há uma estimativa disponível.

### Limitações

- A detecção cobre 11 tipos de acordes e suas inversões: maior, menor, diminuto, aumentado, sétima maior, sétima menor, sétima de dominante, sétima diminuta, sétima meio-diminuta, sus2 e sus4. Os nomes de notas e acordes usam # ou ♭ conforme a tonalidade estimada a partir das observações acumuladas; até essa estimativa estar disponível, são usados sustenidos.
- A validação com interpretações reais de pop e rock é limitada; use as estimativas como auxílio durante a audição.

## Oscilloscope

Mostra a forma da onda sonora em tempo real, para que você veja batidas, ataques marcados e variações de volume enquanto ouve. Os ajustes de disparo estabilizam a imagem quando a onda se repete.

### Guia de uso
- Defina **Display Time** entre 1 e 20 ms e **Trigger Mode** como **Auto** para observar um ciclo de onda que se repete.
- Defina **Display Time** entre 1.000 e 10.000 ms e **Trigger Mode** como **Off** para acompanhar batidas e envoltórias de volume rolando suavemente da direita para a esquerda.
- Nos modos **Auto** e **Normal**, o traçado é atualizado quando todo o intervalo de **Display Time** tiver sido coletado.

### Parâmetros
- **Display Time** (1 a 10.000 ms) - Intervalo de tempo visível. Valores curtos mostram ciclos individuais da onda; valores longos mostram o padrão geral da envoltória.
- **Trigger Mode**:
  - **Auto**: Atualiza continuamente mesmo sem um evento de disparo.
  - **Normal**: Atualiza somente quando ocorre um disparo e mantém a última captura até o próximo disparo.
  - **Off**: Rola continuamente da direita para a esquerda; os ajustes de disparo não têm efeito.
- **Trigger Level** (-1 a 1) - Limiar de amplitude normalizada que inicia a captura (detectado no sinal mono ou na média de L/R).
- **Trigger Edge** - **Rising** (dispara ao cruzar para cima) ou **Falling** (dispara ao cruzar para baixo).
- **Holdoff** (0,1 a 10 ms) - Tempo mínimo de espera entre disparos.
- **Display Level** (-96 a 0 dB; padrão 0 dB) - Define o nível mostrado nas bordas superior e inferior da exibição. 0 dB mostra toda a faixa de ±1; valores menores ampliam sinais mais baixos.
- **Vertical Offset** (-1 a 1) - Desloca a onda verticalmente; valores positivos a movem para cima.

### Guia de visualização
- **Eixo horizontal**: Tempo em milissegundos ou segundos.
- **Eixo vertical**: Amplitude normalizada, escalada por **Display Level** e deslocada por **Vertical Offset**.
- **Linha ou faixa de envoltória**: Com tempos de exibição curtos, desenha-se uma linha contínua da onda; com tempos longos, uma faixa preenchida de mínimos e máximos, para que picos breves continuem visíveis mesmo quando muitas amostras ocupam a mesma coluna de pixels.

### Exibição visual
- Passe o cursor sobre o gráfico, ou toque e arraste sobre ele, para ler o tempo e a amplitude (ou Minimum/Maximum com tempos de exibição longos).

## Pitch Meter

Acompanha uma frequência fundamental (F0) por vez em um piano roll de dois segundos que rola continuamente, sem alterar o áudio. Use-o para verificar a afinação e o movimento de altura de uma voz ou instrumento solo.

### Guia de audição

- Toque ou cante uma única nota sustentada e observe se o traçado permanece centralizado na linha da nota ou se desvia para cima (sustenido) ou para baixo (bemol).
- Vibrato, glissandos e pitch bends aparecem como curvas suaves entre as linhas das notas.
- Como o Pitch Meter acompanha uma única altura dominante, acordes, mixagens densas ou percussão podem interromper o traçado ou fazê-lo saltar de oitava; use o [Note Spectrogram](#note-spectrogram) para material polifônico.
- A entrada estéreo é analisada pela média dos dois primeiros canais (a entrada mono é usada diretamente), então um som com polaridade oposta nos dois canais pode se cancelar e não deixar traçado.

### Parâmetros

- **Color** - Muda a cor do traçado sem afetar a detecção: **Normal** (cor de traçado padrão do tema), **Heatmap** (volume relativo em uma faixa de 24 dB) ou **Note Colors** (cores por classe de altura).
- **Layout** - **Horizontal** (padrão, teclado embaixo, o histórico rola para cima) ou **Vertical** (teclado à direita, o histórico rola para a esquerda).
- **Reference A4** (400 a 480 Hz; padrão 440 Hz) - Referência de afinação usada nos nomes das notas e nos desvios em cents.
- **Lowest Note** / **Highest Note** - Define a faixa de alturas analisada e exibida (padrões: C2 a C7; faixa completa: A0 a C8).

### Guia de visualização

- A posição do traçado mostra a altura de forma contínua entre os semitons; uma confiança maior desenha uma linha mais brilhante, e silêncio ou som sem altura definida interrompem a linha.
- A leitura mostra o nome da nota mais próxima (colorido pela classe de altura) e o desvio de afinação em cents (`+` acima, `-` abaixo; por exemplo, `+3.5 cent`).

### Exibição visual
- Passe o cursor sobre a exibição, ou toque e arraste sobre ela, para ler os valores nesse ponto.

## Rhythm Analyzer

Descobre o andamento da sua música e mostra, tempo a tempo, onde caem os toques de bateria e dos instrumentos e o quanto cada parte toca adiantada ou atrasada, sem alterar o som a menos que o **Metronome Click** esteja ativado. Use-o para descobrir o BPM de uma música, medir o swing, ver se a caixa fica atrás do tempo ou localizar fills de bateria e mudanças de seção.

Selecione **Drums** em **Display** para acompanhar o padrão de bumbo e caixa ou ver onde entram o chimbal e os pratos. **Timing lanes**, **Echo rows** e **Beat lens** usam as mesmas quatro classes. **Frequency bands** agrupa os ataques de todos os instrumentos em High/Mid/Low. Os tons não são exibidos porque são frequentemente confundidos com outros sons.

Os golpes de bateria aparecem antes mesmo de encontrar uma pulsação estável. Quanto maior o ponto, mais forte a evidência daquela classe; os pontos não ficam mais fracos quando cai a confiança na pulsação. A análise pode ajustar sua posição na grade sem alterar a classe reconhecida nem o instante no áudio. As indicações de adiantamento ou atraso e Beat lens precisam de uma estimativa da pulsação. Golpes suaves ou sobrepostos podem passar despercebidos, e outros instrumentos podem ser confundidos com bateria. Use a visualização como auxílio à escuta, não como transcrição exata.

### Guia de audição

- **Verifique o andamento**: Toque uma música com pulso estável. O BPM confirmado e a linha **adopted** aparecem cerca de 1–2 segundos depois do som, enquanto **LOCKED** indica que os pulsos da lâmpada e do clique estão ativos. Se o analisador travar no dobro ou na metade do andamento que você sente, compare **×½**, **×2** e **strongest**.
- **Ouça onde cai o tempo**: Ative o **Metronome Click** para ouvir um clique em cada tempo detectado. Coloque o Rhythm Analyzer no fim da cadeia de efeitos enquanto ouve com o clique, e desative o **Metronome Click** antes de exportar arquivos de áudio processados.
- **Corrija travamentos no dobro ou na metade do andamento**: Se uma balada lenta travar no dobro do andamento, diminua o **Max BPM** para abaixo desse valor; se uma música rápida travar na metade, aumente o **Min BPM** para acima dele.
- **Frequency bands**: **Leia o groove e o microtiming**: Batidas programadas ficam perto do centro da faixa, com **jitter** perto de 0 ms. Uma caixa que chega sempre 15 ms depois do bumbo aparece como pontos **Mid** acima do centro da faixa nos tempos 2 e 4, e como uma marca **+15** em Beat lens.
- **Leia o swing**: **swing** mostra a proporção de atraso do contratempo (1.00:1 é reto, 2.00:1 é um shuffle de tercinas). Em grooves com swing, os toques do contratempo se concentram na coluna **⅔** de Beat lens, e não em **&**.
- **Encontre fills e mudanças**: Anéis (**◎**) destacam toques que não foram tocados na mesma posição do tempo um ou dois ciclos antes, fazendo fills de bateria e transições de seção se destacarem nas **Echo rows**.
- **Quando aparece searching**: Novos pulsos e cliques param, mas a análise continua; o andamento, Timing lanes e Beat lens continuam visíveis e ficam mais fracos conforme a confiança cai. O silêncio limpa as leituras do tempo atual e a coluna de Tempogram; a análise recomeça quando o som volta.

### Parâmetros

- **Display** — Escolha **Frequency bands** (padrão) para agrupar os ataques em High/Mid/Low, ou **Drums** para Kick, Snare, Hi-hat e Cymbals. A troca de modo não reinicia a análise do andamento.
- **Min BPM** (40 a 192; padrão 40) / **Max BPM** (50 a 240; padrão 240) - Faixa de busca de andamento (Max BPM permanece pelo menos 1,25 vez Min BPM; mudar qualquer um dos dois reinicia a análise).
- **Metronome Click** (padrão desativado) - Mistura um clique curto de −10 dBFS nos canais 1 e 2 (no canal 1, se for mono) a cada pulso detectado; os demais canais não mudam.
- **Span (beats)** (4, 6, 8, 12 ou 16; padrão 8) - Número de tempos mostrados na largura de Timing lanes e de cada linha de Echo rows (por exemplo, 8 para dois compassos em 4/4, 6 para dois compassos em 3/4).
- **Tempogram**, **Timing lanes**, **Echo rows**, **Beat lens** - Mostram ou ocultam cada painel da exibição (Timing lanes e Beat lens começam ativados; ocultar um painel não interrompe a análise).

### Guia de visualização

Em uma tela larga, **Beat lens** fica à direita de Timing lanes; em uma tela alta, todos os painéis se empilham. **Frequency bands** separa os toques nas linhas **High** (chimbal, pratos), **Mid** (caixa, vozes, instrumentos) e **Low** (bumbo, baixo); **Drums** usa as linhas **Kick**, **Snare**, **Hi-hat** e **Cymbals**.
- **Cabeçalho**: Mostra a lâmpada que pisca a cada tempo (mais fraca quanto menor a confiança e vazada durante **searching**), o BPM confirmado (**LOCKED** ou **searching**), **×½**, **×2**, o candidato **strongest** de Tempogram, a proporção de **swing** (calculada com os últimos 32 tempos), o **jitter** (dispersão típica dos toques em torno de sua posição média, em ms) e a legenda dos símbolos. Valores ainda indisponíveis aparecem como —.
- **Tempogram**: Histórico de 20 segundos do apoio a cada andamento, com **Time** avançando da esquerda para a direita e **Tempo (BPM)** de 30 a 480 em escala logarítmica, sobreposto pela linha contínua do andamento **adopted** e pelas linhas tracejadas **×2** / **×½**. O brilho mostra o apoio relativo a cada andamento, não a probabilidade de ele ser o correto.
- **Timing lanes**: Mostram os toques dos últimos *N* tempos (**Span (beats)**; legenda **Last N beats**); um ponto maior indica um toque mais certo, e as posições mais recentes são estimativas que se firmam cerca de 1–2 segundos depois. A altura da haste vertical mostra o microtiming em relação à grade de semicolcheias ou de tercinas mais próxima, comparado com o timing típico dos 16 tempos anteriores (guias pontilhadas **+20** / **−20** ms; acima do centro = atrasado, abaixo = adiantado; toques além de ±30 ms ficam na borda da faixa). Círculos vazados (**○**) são toques sem timing disponível (desenhados no centro da faixa), áreas sombreadas marcam períodos sem análise de timing, anéis (**◎**) marcam toques novos em relação a 1–2 ciclos antes, e linhas verticais tracejadas marcam realinhamentos da grade de tempos.
- **Echo rows**: Empilham verticalmente os ciclos anteriores de *N* tempos, com o mais recente no topo, de modo que padrões de compasso repetidos se alinham em colunas e fills ou variações se destacam. **Cycles ago** numera as linhas a partir de 1; com **Timing lanes** oculto, a linha superior é o ciclo atual (0). Cada toque mostra sua faixa de frequência ou peça da bateria, mas não o quanto está adiantado ou atrasado.
- **Beat lens**: Resume, para cada faixa de frequência ou peça da bateria, o quanto ela toca adiantada (marca à esquerda) ou atrasada (marca à direita) em média (escala de ±30 ms) e a dispersão (barra sombreada, ± um desvio-padrão) nas subdivisões do tempo (**1**, **e**, **&**, **a**, **⅓**, **⅔**) ao longo dos últimos 32 tempos confirmados. Os deslocamentos são relativos ao conjunto como um todo, uma marca mais opaca indica que a posição é tocada com mais frequência, uma posição precisa de pelo menos quatro toques para aparecer, e deslocamentos de 3 ms ou mais recebem rótulo. Até a análise de tempo ficar disponível, o painel mostra **waiting for a steady beat**.
- **Confiança**: Leituras mais fracas indicam menor confiança na análise, não uma execução mais solta.
- **Reset**: O botão **Reset** abaixo da exibição a limpa e reinicia a análise, por exemplo quando outro aplicativo troca de música. Quando o player do EffeTune começa uma nova música, a análise recomeça automaticamente.

### Exibição visual
- Passe o cursor sobre a exibição, ou toque e arraste sobre ela, para ler os valores: em Timing lanes e Echo rows, há quantos tempos ocorreu, a faixa de frequência ou a peça da bateria e o timing do toque mais próximo (— quando indisponível); em Tempogram, o andamento, **Tempo support** e o andamento **Adopted**; e, em Beat lens, o deslocamento e a dispersão de cada faixa de frequência ou peça da bateria.

### Limitações

- O acompanhamento do andamento e dos tempos é menos certo em rubato, música clássica, piano solo ou trechos ambientes/sem pulso, e o tempo pode travar no dobro, na metade, em dois terços ou em uma vez e meia o andamento que você sente, ou no contratempo (use **Min BPM** / **Max BPM** para restringir a faixa). **LOCKED** não garante um tempo correto.
- Quando o andamento muda continuamente, o tempo acompanha com um pequeno atraso, então o clique pode soar um pouco adiantado ou atrasado.
- Em mixagens densas e gravações ruidosas, as faixas **Mid** e **High** podem mostrar pontos a mais, e a faixa **Low** deixa passar algumas notas graves do piano.
- O analisador acompanha tempos, não barras de compasso nem fórmulas de compasso (ele não identifica o tempo 1).
- Taxas de amostragem compatíveis: 8; 11,025; 16; 22,05; 24; 32; 44,1; 48; 88,2; 96; 176,4; 192; 352,8 e 384 kHz. Em outras taxas, o áudio passa sem alterações, mas a análise e os cliques ficam indisponíveis.
## Spectrogram

Mostra como sua música muda ao longo do tempo. A intensidade da cor indica a força de cada frequência, enquanto a posição vertical indica a frequência.

O gráfico se desloca da direita para a esquerda a uma velocidade constante, com marcações a cada segundo.

### Guia de visualização
- As cores mostram a intensidade de diferentes frequências:
  - Cores escuras: Sons baixos
  - Cores brilhantes: Sons altos
  - Observe os padrões mudarem com a música
- A posição vertical mostra a frequência:
  - Parte inferior: Sons graves
  - Meio: Instrumentos principais
  - Parte superior: Frequências altas
- Com **Log (HQ)**, tons graves próximos aparecem como faixas mais claramente separadas. A medição mais longa das frequências baixas pode demorar um pouco mais para se estabilizar ou desaparecer.

### Exibição visual
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

### O que você pode ver
- Melodias: Linhas fluidas de cor
- Batidas: Listras verticais
- Graves: Cores brilhantes na parte inferior
- Harmonias: Múltiplas linhas paralelas
- Diferentes instrumentos criam padrões únicos

### Parâmetros
- **DB Range** - Quão vibrantes são as cores (-144dB a -48dB)
  - Números menores: Veja mais detalhes sutis
  - Números maiores: Foque nos sons principais
- **Points** - Tamanho de FFT usado na visualização (256 a 16384)
  - Números maiores: Mais detalhe de frequência, mas atualização temporal mais lenta
  - Números menores: Movimento mais rápido, mas menos detalhe de frequência
  - Com **Log (HQ)**, Points define a janela curta de análise; uma janela quatro vezes mais longa melhora a separação das frequências baixas.
- **Color** - **Normal** usa a cor do gráfico do tema, mostrando as frequências mais fortes com mais brilho. **Heatmap** (padrão) usa a escala multicolorida original, do escuro ao brilhante. Trocar a cor recolore o histórico existente.
- **Frequency Scale** - **Log** reserva mais espaço de exibição para as frequências baixas. **Log (HQ)** acrescenta uma medição mais longa para separar com mais clareza graves próximos, mantendo a medição curta para os agudos. Usa mais processamento, e mudanças nos graves podem demorar mais para aparecer ou desaparecer, mas não altera o áudio. **Linear** distribui larguras de frequência iguais em intervalos iguais.
- **Keyboard** - Mostra à direita do gráfico um guia estático de teclado que relaciona as notas musicais às frequências. Não altera a análise nem o áudio. A disposição das teclas acompanha **Log**, **Log (HQ)** ou **Linear**; **Log (HQ)** usa o mesmo espaçamento logarítmico de **Log**, e em **Linear** as teclas graves parecem mais estreitas.
- O analisador usa a média dos canais esquerdo e direito. A entrada mono é analisada diretamente.

## Spectrum Analyzer

Cria uma exibição visual em tempo real das frequências da sua música, dos graves profundos aos agudos. É como ver os ingredientes individuais que compõem o som completo da sua música.

### Guia de visualização
- Lado esquerdo mostra frequências graves (bateria, baixo)
- Meio mostra frequências principais (vocais, guitarras, piano)
- Lado direito mostra frequências altas (pratos, brilho, ar)
- Picos mais altos significam presença mais forte dessas frequências
- A linha mais grossa mostra o som atual
- A linha mais fina acompanha os picos recentes e desce suavemente enquanto desaparecem
- Na visualização **Bar**, cada barra mostra o nível mais alto em uma parte de largura igual da tela. **Log** e **Log (HQ)** usam larguras de oitava iguais; **Linear** usa larguras de frequência iguais.
- A marca fina acima de uma barra mostra seu pico recente e desce suavemente.
- Com **Log (HQ)**, tons graves próximos podem aparecer como picos separados. A medição mais longa das frequências baixas pode demorar um pouco mais para se estabilizar ou desaparecer.
- Observe como diferentes instrumentos criam padrões diferentes

### Exibição visual
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

### O que você pode ver
- Drops de Grave: Grandes movimentos à esquerda
- Melodias Vocais: Atividade no meio
- Agudos Nítidos: Brilhos à direita
- Mix Completo: Como todas as frequências trabalham juntas

### Parâmetros
- **DB Range** - Quão sensível é o display (-144dB a -48dB)
  - Números menores: Veja mais detalhes sutis
  - Números maiores: Foque nos sons principais
- **Points** - O quanto a visualização separa frequências próximas (256 a 16384)
  - Números maiores: Mais detalhe de frequência, com atualizações mais lentas
  - Números menores: Atualizações mais rápidas, com menos detalhe de frequência
  - Com **Log (HQ)**, Points define a janela curta de análise; uma janela quatro vezes mais longa melhora a separação das frequências baixas.
- **Color** - **Normal** (padrão) mantém as cores do gráfico do tema. **Heatmap** colore os níveis mais altos com mais brilho e **Note Colors** acompanha as cores das notas ao longo do eixo de frequências. A escolha vale para as exibições Line e Bar. Com **Bar** e **Note Colors**, cada barra e seu pico usam uma única cor baseada na frequência central da faixa.
- **Frequency Scale** - **Log** reserva mais espaço de exibição para as frequências baixas. **Log (HQ)** acrescenta uma medição mais longa para separar com mais clareza graves próximos, mantendo a medição curta para os agudos. Usa mais processamento, e mudanças nos graves podem demorar mais para aparecer ou desaparecer, mas não altera o áudio. **Linear** distribui larguras de frequência iguais em intervalos iguais.
- **Display** - Altera apenas a aparência do espectro; não altera a análise nem o áudio.
  - **Line** (padrão): Mostra o espectro como linhas contínuas.
  - **Bar**: Mostra como barra o nível mais alto de cada faixa exibida.
- **Keyboard** - Mostra abaixo do gráfico um guia estático de teclado que relaciona as notas musicais às frequências. Não altera a análise nem o áudio. A disposição das teclas acompanha **Log**, **Log (HQ)** ou **Linear**; **Log (HQ)** usa o mesmo espaçamento logarítmico de **Log**, e em **Linear** as teclas graves parecem mais estreitas.
- O analisador usa a média dos canais esquerdo e direito. A entrada mono é analisada diretamente.

## Stereo Meter

Uma ferramenta fascinante de visualização que permite ver como sua música cria uma sensação de espaço através do som estéreo. Observe como diferentes instrumentos e sons se movem entre seus alto-falantes ou fones de ouvido, adicionando uma dimensão visual empolgante à sua experiência auditiva.

### Guia de visualização
- **Exibição em Losango** - A janela principal onde a música ganha vida:
  - Centro: Momentos muito silenciosos ou em que o sinal combinado fica perto de zero
  - Cima/Baixo: Som compartilhado pelos canais esquerdo e direito, como conteúdo centralizado ou próximo de mono
  - Esquerda/Direita: Diferença ou conteúdo fora de fase entre os canais
  - Sons muito mais fortes de um lado podem aparecer perto dos cantos rotulados
  - Pontos verdes dançam com a música atual
  - Linha branca traça os picos musicais
  - A linha branca de picos decai a cada amostra de áudio, mantendo o mesmo movimento independentemente do tamanho do bloco de processamento
- **Barra de Correlação** (lado esquerdo)
  - Mostra a correlação entre os canais esquerdo e direito
  - Topo (+1.0): Esquerda e direita são quase iguais, normalmente soando centralizadas
  - Meio (0.0): Relação fraca entre canais, comum em ambiências amplas ou conteúdo esquerdo/direito pouco relacionado
  - Base (-1.0): Esquerda e direita têm polaridade quase oposta, o que pode soar fraco em alto-falantes
- **Barra de Balanço** (Base)
  - Mostra se um alto-falante está mais alto que o outro
  - Centro: Música igualmente alta em ambos os alto-falantes
  - Esquerda/Direita: Música mais forte em um alto-falante
  - Os números mostram a diferença em decibéis (dB)

### O que você pode ver
- **Som Centralizado**: Movimento vertical forte no meio
- **Som Espacial**: Atividade espalhada por todo o display
- **Efeitos Especiais**: Padrões interessantes nos cantos
- **Balanço dos Alto-falantes**: Para onde a barra inferior aponta
- **Correlação dos Canais**: O que a barra de correlação à esquerda mostra

### Parâmetros
- **Window** (10-1000 ms) - Quanto áudio recente aparece na visualização
  - Valores menores: Veja mudanças musicais rápidas
  - Valores maiores: Veja padrões sonoros gerais
  - Padrão: 100 ms funciona bem para a maioria das músicas
- **Gain** (0 a 24 dB; padrão: 0 dB) - Amplia apenas os pontos e a linha de picos no gráfico em forma de losango. Aumente o valor para ver melhor os padrões dos trechos mais baixos. Não altera o áudio nem as leituras de correlação e balanço.

### Aproveite sua música
1. **Observe Diferentes Estilos**
   - Música clássica geralmente mostra padrões suaves e equilibrados
   - Música eletrônica pode criar designs selvagens e expansivos
   - Gravações ao vivo podem mostrar movimento natural da sala

2. **Descubra Qualidades Sonoras**
   - Veja como diferentes álbuns usam efeitos estéreo
   - Note como algumas músicas parecem mais amplas que outras
   - Observe como os instrumentos se movem entre alto-falantes

3. **Melhore Sua Experiência**
   - Experimente diferentes fones de ouvido para ver como mostram o estéreo
   - Compare gravações antigas e novas de suas músicas favoritas
   - Observe como diferentes posições de escuta mudam o display

## Formas Divertidas de Usar Essas Ferramentas

1. Explorando Sua Música
   - Observe como diferentes gêneros criam padrões diferentes
   - Veja a diferença entre música acústica e eletrônica
   - Observe como os instrumentos ocupam diferentes faixas de frequência

2. Aprendendo Sobre Som
   - Veja o grave na música eletrônica
   - Observe melodias vocais se movendo pelo display
   - Observe como a bateria cria padrões nítidos

3. Melhorando Sua Experiência
   - Use o Level Meter para conferir os picos do sinal depois de adicionar efeitos
   - Observe o Spectrum Analyzer dançar com a música
   - Crie um show de luzes visual com o Spectrogram

Lembre-se: Essas ferramentas são feitas para melhorar seu prazer ao ouvir música, adicionando uma dimensão visual à sua experiência auditiva. Divirta-se explorando e descobrindo novas maneiras de ver sua música favorita!
