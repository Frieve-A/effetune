---
title: "Plugins de Análise - EffeTune"
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
- [Stereo Meter](#stereo-meter) - Visualiza o balanço estéreo e o movimento do som

## Analog Meter

Mostra o nível de cada canal em um medidor de agulha clássico, sem alterar o som. Use-o para acompanhar como a intensidade da sua música varia a cada momento, ou para ver como sua reprodução se comporta nas escalas usadas em transmissão e streaming: VU, PPM, pico e loudness (LUFS).

### Guia de uso

- **Acompanhe o nível médio com o VU**: observe a agulha ao longo de uma música. Versos calmos e refrões intensos mostram uma diferença clara, enquanto batidas curtas de bateria quase não movem a agulha.
- **Verifique o clipping com o True Peak**: coloque o Analog Meter depois dos seus efeitos de EQ e ganho e reproduza a parte mais alta de uma faixa. Se a leitura passar de 0 dBFS ou a lâmpada de overload acender, a cadeia pode estar entrando em clipping; reduza o ganho até que os picos fiquem abaixo de 0 dBFS, com uma pequena margem, como -1 dBFS.
- **Compare músicas com o Loudness**: defina o **Target** para uma referência de streaming, como -14 LUFS, pressione **Reset** no início de uma música ou álbum e reproduza-o até o fim. O valor Integrated mostra a loudness geral e o True Peak máximo mostra o pico mais alto, o que serve como referência para equalizar o volume entre músicas de um álbum ou playlist. O LRA permite comparar o quanto a loudness de cada música varia.

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para ajustar o medidor a um padrão conhecido em um só passo. Uma predefinição que altera o **Mode** reinicia a medição; alternar entre as predefinições de Loudness mantém a medição em andamento.

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

### Parâmetros

Somente os controles que se aplicam ao **Mode** selecionado são exibidos.

- **Mode** - Seleciona o tipo de medidor: **VU** (padrão), **PPM**, **RMS**, **Sample Peak**, **True Peak** ou **Loudness**. Cada modo move a agulha de forma diferente e usa sua própria escala (veja o Guia de Visualização). Alterar o modo reinicia a medição.
- **Integration** (RMS; 0,05 a 3 s; padrão 0,3 s) - Define o tempo de média. Valores maiores tornam a agulha mais estável e lenta; valores menores fazem-na acompanhar as mudanças mais rapidamente.
- **Attack** (PPM; 1 a 20 ms; padrão 5 ms) - Define a rapidez com que a agulha do PPM sobe, como a duração de uma explosão de tom que é lida 2 dB abaixo de um tom constante. Valores menores mostram picos breves mais próximos do seu nível real; valores maiores fazem picos breves serem lidos mais baixo. 5 ms corresponde ao medidor DIN.
- **Release** (PPM, Sample Peak, True Peak; 0,1 a 5 s; padrão 1,5 s) - Define o tempo que a agulha leva para cair 20 dB após um pico. Valores maiores facilitam a leitura dos picos; valores menores acompanham a música mais de perto. 1,5 s corresponde ao medidor DIN e ao medidor de pico digital padrão.
- **Reference** (VU, PPM, RMS; -30 a 0 dBFS; padrão -14 dBFS) - Define o nível digital que corresponde à marca de referência do medidor. O padrão é adequado para a maioria das gravações comerciais finalizadas; com os alinhamentos de estúdio de -18 ou -20 dBFS (veja Predefinições do sistema), CDs comuns costumam deixar a agulha perto do topo da escala. Aumente-o quando gravações altas empurrarem a agulha até o topo da escala; diminua-o quando gravações silenciosas quase não moverem a agulha.
- **Range** (PPM com a escala DIN ou dB, RMS, Sample Peak, True Peak; 20 a 60 dB; padrão 40 dB) - Define até onde a escala se estende para baixo. Amplie-a para ver passagens silenciosas; reduza-a para espalhar melhor a parte superior da escala.
- **PPM Scale** (PPM; padrão DIN) - Seleciona a escala do PPM: **DIN**, **BBC** ou **dB** (veja o Guia de Visualização).
- **Peak Hold** (PPM, RMS, Sample Peak, True Peak; 0 a 10 s; padrão 1 s) - Define por quanto tempo a marca de pico permanece na leitura mais alta recente e por quanto tempo a lâmpada de overload fica acesa. 0 desativa a marca; a lâmpada de overload então fica acesa por 1 s.
- **Needle** (Loudness; padrão Momentary) - Seleciona o que a agulha mostra. **Momentary** acompanha a loudness dos últimos 0,4 s; **Short-term** mostra os últimos 3 s e se move de forma mais estável.
- **Target** (Loudness; -36 a -10 LUFS; padrão -23 LUFS) - Define a loudness marcada na escala e posiciona a escala tomando esse valor como referência. -23 LUFS é o nível de transmissão da EBU R128; muitos serviços de streaming usam valores em torno de -14 LUFS.
- **Scale** (Loudness; padrão EBU +9) - Seleciona a largura da escala de loudness. **EBU +9** cobre de 18 LU abaixo a 9 LU acima do **Target**; **EBU +18** cobre de 36 LU abaixo a 18 LU acima, o que é adequado para músicas com dinâmica ampla ou material muito alto.

### Guia de Visualização

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

- A marca de pico mostra a leitura mais alta recente durante o tempo de **Peak Hold**. A lâmpada de overload acende quando o nível excede 0 dBFS e fica acesa durante o tempo de **Peak Hold**, ou por 1 s quando **Peak Hold** é 0.
- No modo Loudness, o primeiro medidor mostra o programa inteiro. Sua agulha segue o **Needle**, e ele lista Momentary (M), Short-term (S), Integrated (I), Loudness Range (LRA), o True Peak máximo e o tempo de medição decorrido, com um botão **Reset**. Integrated e LRA aparecem depois que áudio suficiente for medido.
  - Para mono, estéreo e 5.1 (ordem de canais L, R, C, LFE, Ls, Rs), esses valores seguem a ponderação de canais padrão. Para outras contagens de canais, todos os canais são somados com peso igual, então os valores servem apenas como referência.
  - Os medidores após o primeiro mostram cada canal individualmente. São valores de referência, medidos sem ponderação de canais ou gating.
- Integrated, LRA e o True Peak máximo continuam se acumulando até você pressionar **Reset**, alterar o **Mode**, a taxa de amostragem ou a contagem de canais mudar, ou o processamento de áudio ser reiniciado.
- O tempo em que o processamento está pausado não é medido: durante pausas de economia de energia em silêncio, enquanto o Master Bypass está ativado ou o Analog Meter está desligado, ou enquanto o Effect Pipeline não está visível (por exemplo, na Biblioteca de música, com a janela minimizada ou no Minirreprodutor) com **Ignorar DSP de exibição quando oculto** ativado em Configuração (ativado por padrão). As leituras continuam de onde pararam.

## Chroma Spiral

Mostra onde os componentes de frequência da música se situam entre as 12 notas e as oitavas, sem alterar o som. Use-o para observar harmônicos sobrepostos, comparar a faixa de uma voz e de um baixo ou examinar a extensão de um instrumento.

### Guia de uso

- Sustente uma nota e observe sua posição e as posições iluminadas pelos harmônicos. Uma nota só pode iluminar vários nomes; isso não significa que todas foram tocadas separadamente.
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

### Exibição Visual
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

## Level Meter

Um display visual que mostra em tempo real o nível digital do sinal da música. Ele ajuda a conferir os níveis depois de aplicar efeitos e a identificar possível clipping antes que vire distorção audível.

### Guia de Visualização
- A barra horizontal se estende mais para a direita conforme o nível do sinal fica mais alto
- O marcador branco mantém um novo pico por um segundo e depois desce suavemente
- OVERLOAD significa que o sinal passou da faixa digital segura e pode distorcer
- Para uma reprodução limpa, evite níveis vermelhos frequentes ou avisos de OVERLOAD; ajuste o volume real de audição no seu dispositivo

## Note Spectrogram

Mostra as frequências fundamentais (F0) estimadas de A0 a C8 em um piano roll que se desloca, sem alterar o áudio. Use-o para acompanhar notas de acordes, linhas vocais e melódicas em movimento, linhas de baixo e notas sobrepostas em oitavas diferentes.

### Guia de Visualização

- **Vertical** mostra o tempo da esquerda para a direita, com o teclado e o som atual na borda direita. As notas mais agudas aparecem no topo.
- **Horizontal** coloca o teclado embaixo, com as notas graves à esquerda e as agudas à direita. O som novo aparece logo acima do teclado e o histórico se move para cima.
- As linhas em cada C marcam os limites das oitavas.
- As linhas correspondentes às teclas pretas usam um fundo cinza quase preto para continuarem visíveis quando nenhuma nota é detectada.
- **Normal** usa a cor do traçado do gráfico do tema; **Note Colors** atribui uma cor a cada nota, repetida em todas as oitavas. Ambos mostram linhas-guia entre E e F mais escuras que os limites das oitavas.
- **1/12 Octave** mostra uma linha por semitom. **High (1/60 Octave)** divide cada semitom em cinco linhas para facilitar o acompanhamento de pequenas variações de altura; as cores são interpoladas entre notas vizinhas.
- A cor acompanha a confiança do modelo de 0 (cor de fundo) a 1 (cor completa), incluindo candidatos fracos, sem um limiar de exibição. A confiança indica quanto o modelo sustenta a presença de uma nota; não é uma probabilidade calibrada.
- Com **Volume** ativado, cada altura detectada vira uma barra cuja espessura do núcleo opaco mostra o volume relativo corrigido pela frequência, de 1/60 de oitava na parte inferior da escala a 1/12 de oitava na parte superior. Um fade de 1/120 de oitava se estende de cada lado do núcleo, ampliando a largura total desenhada em 1/60 de oitava além do núcleo. **Pitch Resolution** muda a posição central da barra, não a espessura do núcleo.
- Na borda do teclado, um semicírculo de bordas suaves se estende para dentro do gráfico e mostra o volume atual. Ele responde imediatamente aos aumentos e cai a 20 dB por segundo; não há retenção de pico visível separada.
- A escala de volume abrange 24 dB. Seu limite superior acompanha o maior valor entre uma referência recente que estabiliza a escala do histórico (por cerca de um segundo) e -36 dB, para que trechos mais silenciosos continuem legíveis sem que passagens mais fortes preencham a tela continuamente. Essa referência é separada do semicírculo do volume atual.
- As linhas-guia das oitavas e de E–F são desenhadas atrás das barras de volume, mantendo a grade de alturas como referência visual.
- As teclas passam gradualmente da cor normal para a cor de exibição conforme aumenta a confiança do quadro mais recente, chegando a essa cor em 1.
- Alterar **Color** muda as cores do histórico existente.

### Exibição Visual
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

### O que você pode ver

- Os acordes aparecem como várias linhas brilhantes ao mesmo tempo
- Melodias e linhas de baixo formam trajetórias que passam pelas linhas das notas
- A tela não cria MIDI nem partitura, não identifica instrumentos e não consegue separar completamente todos os sons simultâneos. Sobreposições complexas podem deixar partes de uma melodia ou harmonia sem detecção, enquanto percussão, ruído e padrões repetidos pouco claros podem produzir ocasionalmente uma altura incorreta.

### Parâmetros

- **Color** - Seleciona as cores de exibição sem alterar as estimativas de notas.
  - **Normal** (padrão): a cor do traçado do gráfico do tema.
  - **Note Colors**: uma cor diferente para cada nota, repetida em todas as oitavas.
- **Pitch Resolution** - Seleciona o detalhe vertical da altura sem apagar o histórico existente.
  - **1/12 Octave** (padrão): uma linha por semitom, usando a estimativa mais forte dessa nota.
  - **High (1/60 Octave)**: cinco linhas por semitom para mostrar variações de altura mais detalhadas.
- **Layout** - Seleciona **Horizontal** (padrão) ou **Vertical**. O histórico é preservado ao mudar a disposição.
- **Volume** - Mostra o volume relativo pela espessura das barras e por medidores semicirculares. Fica ativado por padrão; ao desativá-lo, a intensidade das linhas indica a confiança.
- **Time Span** (de 1 a 10 s) - Define quanto tempo o piano roll mostra
  - Valores menores facilitam a observação de mudanças de tempo
  - Valores maiores mostram um trecho musical mais longo de uma só vez
  - Padrão: 2 s
- **Regular Note Limit** (1 a 16 notas) - Define quantas notas simultâneas fora da faixa grave dedicada podem chegar à etapa final de detecção. O padrão é 8. Aumente para acordes excepcionalmente densos; valores menores reduzem o trabalho da análise e a competição entre candidatos.
- **Lowest Note** - Define a nota mais grave da faixa exibida e analisada. Padrão: E1.
- **Highest Note** - Define a nota mais aguda da faixa exibida e analisada. Padrão: G6.
- Quando a entrada é baixa demais para análise, o piano roll permanece escuro em vez de mostrar uma entrada extremamente pequena como alturas. Essa supressão não determina se um som seria audível ou perceptivamente mascarado.

## Oscilloscope

Mostra a forma da onda sonora em tempo real, para você ver batidas, ataques rápidos e mudanças de volume enquanto escuta. As configurações de trigger podem estabilizar a visualização quando a forma de onda se repete.

### Guia de Visualização
- Eixo horizontal mostra o tempo (milissegundos)
- Eixo vertical mostra a amplitude normalizada; a faixa visível muda com Display Level e Vertical Offset
- Linha verde traça a forma de onda real
- Linhas de grade ajudam a medir valores de tempo e amplitude
- As configurações de trigger determinam onde a captura da forma de onda começa; não há um marcador separado

### Exibição Visual
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

### Parâmetros
- **Display Time** - Quanto tempo mostrar (1 a 100 ms)
  - Valores menores: Veja mais detalhes em eventos curtos
  - Valores maiores: Visualize padrões mais longos
- **Trigger Mode**
  - Auto: Atualizações contínuas mesmo sem trigger
  - Normal: Congela o display até o próximo trigger
  - Off: Sem trigger; mostra continuamente a forma de onda mais recente. Trigger Level, Trigger Edge e Holdoff não têm efeito
- A detecção de trigger usa a média dos canais esquerdo e direito. A entrada mono é usada diretamente.
- **Trigger Level** - Nível de amplitude que inicia a captura
  - Faixa: -1 a 1 (amplitude normalizada)
- **Trigger Edge**
  - Rising: Dispara quando o sinal sobe
  - Falling: Dispara quando o sinal desce
- **Holdoff** - Tempo mínimo entre triggers (0.1 a 10 ms)
- **Display Level** - Escala vertical em dB (-96 a 0 dB)
- **Vertical Offset** - Desloca a forma de onda para cima/baixo (-1 a 1)

### Nota sobre a Exibição da Forma de Onda
A forma de onda conecta os pontos capturados em ordem temporal. Com tempos de exibição longos, cada intervalo preserva suas amostras inicial e final, além das amostras mínima e máxima em suas posições originais. Assim, a continuidade e os picos breves são mantidos dentro da resolução da tela. Use-a como guia visual, não como ferramenta de medição exata.

## Pitch Meter

Acompanha uma frequência fundamental (F0) por vez em um piano roll móvel de dois segundos, sem alterar o áudio. Use-o para verificar a afinação e o movimento de altura de uma voz ou instrumento solo.

### Guia de visualização

- **Horizontal** (padrão) coloca as notas graves à esquerda e as agudas à direita. A estimativa mais recente aparece acima do teclado, e o histórico se move para cima.
- **Vertical** coloca as notas graves embaixo e as agudas em cima. A estimativa mais recente aparece ao lado do teclado à direita, e o histórico se move para a esquerda.
- A posição da linha mostra a altura entre os semitons. Uma estimativa mais confiável aparece com maior intensidade; a linha é interrompida quando a entrada está muito baixa ou nenhuma altura única e estável é encontrada.
- O rótulo atual mostra a nota mais próxima e a diferença em cents. Um valor positivo indica uma altura acima da nota, e um valor negativo indica uma altura abaixo. O rótulo desaparece quando não há uma estimativa confiável.
- O nome da nota usa as mesmas cores do Note Spectrogram. O tamanho do nome e da diferença em cents se ajusta à largura disponível, e o ponto decimal dos cents permanece na mesma posição.

### Exibição Visual
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

### Guia de uso

- Comece com uma única nota sustentada e observe se a linha permanece centralizada na nota ou se desloca para cima ou para baixo.
- Vibrato e pitch bends aparecem como movimentos suaves entre as linhas das notas.
- Este analisador acompanha uma altura dominante. Acordes, mixagens densas, percussão, ruído ou sons periódicos pouco claros podem interromper a linha ou produzir uma oitava incorreta.

### Parâmetros

- **Layout** - Seleciona **Horizontal** (padrão) ou **Vertical**.
- **Color** - Muda a cor da linha sem alterar a detecção de altura. **Normal** (padrão) usa a cor do gráfico do tema; **Heatmap** mostra o volume na mesma escala de 24 dB do Note Spectrogram; **Note Colors** acompanha a altura entre as cores das notas.
- **Reference A4** (400 a 480 Hz) - Define a referência de afinação usada nos nomes das notas e nos cents. Padrão: 440 Hz.
- **Lowest Note** - Define o limite inferior da faixa exibida e analisada. Padrão: C2. O menor ajuste disponível é A0.
- **Highest Note** - Define o limite superior da faixa exibida e analisada. Padrão: C7. O maior ajuste disponível é C8.
- A entrada estéreo é analisada pela média dos dois primeiros canais; a entrada mono é usada diretamente. Conteúdo com polaridades muito opostas pode se cancelar na média e não deixar traço de altura.

## Rhythm Analyzer

Calcula o andamento da sua música e mostra, tempo a tempo, onde caem os toques de bateria e instrumentos e o quanto cada parte está adiantada ou atrasada. Use-o para descobrir o BPM de uma música, verificar quanto swing um groove tem, ver se a caixa fica atrasada em relação ao tempo, ou localizar onde entra um fill ou muda um padrão. O som só muda se o **Metronome Click** estiver ativado.

### Guia de uso

- **Verifique o andamento**: toque uma música com um pulso claro e estável. Em poucos segundos, o cabeçalho mostra o BPM com **LOCKED**, e o tempograma marca esse mesmo andamento como **adopted**. O analisador às vezes segue um nível de tempo diferente daquele que você marca com o pé, então observe também **×½**, **×2** e **strongest** no cabeçalho: se algum deles combinar com o ritmo do seu pé, esse é o andamento que você sente.
- **Ouça onde cai o tempo**: ative o **Metronome Click** para ouvir um clique em cada tempo detectado. Se os cliques caem no pulso que você marca com o pé, o analisador encontrou o tempo. Se caem entre as batidas do seu pé, ou no dobro ou na metade da sua velocidade, o analisador está seguindo outra posição ou nível de tempo; veja **Corrija um travamento no dobro ou na metade do andamento** abaixo e **Limitações**.
- **Coloque-o por último ao usar o clique**: o clique é misturado ao áudio que sai do analisador, então qualquer efeito depois dele também processa o clique. Coloque o Rhythm Analyzer no fim da cadeia de efeitos enquanto ouve com o clique.
- **Desligue o clique antes de processar arquivos**: com o **Metronome Click** ativado, os cliques são gravados em qualquer arquivo que você processar. Desligue-o antes.
- **Corrija um travamento no dobro ou na metade do andamento**: se uma balada lenta trava no dobro do seu andamento, diminua o **Max BPM** abaixo desse valor (por exemplo, para 100 em uma balada de 60 BPM). Se uma música rápida trava na metade da velocidade, aumente o **Min BPM** acima desse valor. A análise recomeça com os novos limites.
- **Leia um groove estável**: com música programada ou tocada com clique, os pontos ficam perto do centro de suas faixas, e **jitter** fica perto de 0 ms. Quando uma parte toca sistematicamente atrasada ou adiantada em relação às demais, seus pontos ficam acima ou abaixo do centro da faixa, nas mesmas posições todas as vezes. Uma caixa que chega 15 ms atrás do bumbo e do chimbal, por exemplo, aparece como pontos Mid acima do centro da faixa nos tempos 2 e 4, e como uma marca Mid rotulada +15 na coluna **1** da lente de batida.
- **Leia o swing**: **swing** mostra o quanto o contratempo está atrasado: 1.00:1 é reto, 2.00:1 é um shuffle de tercinas completo, e valores intermediários são um swing mais leve. Em música claramente com swing, a lente de batida coloca os toques do contratempo na coluna **⅔** em vez de **&**.
- **Encontre fills e mudanças de seção**: um anel marca um toque que a mesma banda não tocou na mesma posição nem um nem dois intervalos antes. Enquanto um padrão se repete, poucos anéis aparecem; um fill ou os primeiros compassos de uma nova seção mostram muitos. As linhas de eco abaixo das faixas principais permitem comparar o novo padrão com os anteriores.
- **Quando aparece searching**: enquanto o pulso não está claro, o cabeçalho mostra **searching** com o último andamento travado entre parênteses, as faixas continuam rolando nesse andamento dentro de uma área sombreada, e os toques são desenhados como círculos vazados, sem medição de adiantamento ou atraso. O analisador trava depois de ficar seguro do pulso por um tempo inteiro. Com um pulso claro e estável, isso leva alguns segundos; música clássica e execuções com rubato podem levar mais tempo. Quando a música para, o analisador deixa de mostrar o pulso em menos de meio segundo e trava de novo quando a música volta.

### Parâmetros

- **Min BPM** (40 a 192; padrão 40) - Define o andamento mais baixo em que o analisador pode travar. Aumente quando o analisador travar na metade do andamento que você sente.
- **Max BPM** (50 a 240; padrão 240) - Define o andamento mais alto em que o analisador pode travar. Diminua quando o analisador travar no dobro do andamento que você sente. O analisador só trava em andamentos entre o **Min BPM** e o **Max BPM**, mas o andamento mostrado pode passar um pouco dos limites quando a música acelera ou desacelera. O **Max BPM** é sempre mantido em pelo menos 1,25 vez o **Min BPM**; quando uma alteração romperia essa relação, o outro limite se move automaticamente. Mudar qualquer um dos dois reinicia a análise. O tempograma sempre cobre de 30 a 480 BPM, e as linhas **×½** e **×2** podem cair fora dos limites escolhidos.
- **Metronome Click** (ligado ou desligado; padrão desligado) - Adiciona um clique curto e agudo em cada tempo detectado ao áudio que passa pelo plugin. Os cliques só tocam enquanto o analisador está travado e param quando ele volta a **searching**. O clique tem um nível fixo de cerca de −10 dBFS e é somado aos canais 1 e 2 (canal 1 para entrada mono); os demais canais não são alterados. Quando desligado, o áudio passa sem alteração. Ligar ou desligar não reinicia a análise.
- **Span (beats)** (4, 6, 8, 12 ou 16; padrão 8) - Define quantos tempos as faixas principais e cada linha de eco mostram, e a que distância no passado os anéis fazem a comparação. Isso muda apenas a exibição, não a análise. Um valor que cobre compassos inteiros alinha um padrão que se repete entre as linhas de eco, por exemplo 8 para dois compassos em 4/4 ou 6 para dois compassos em 3/4.
- **Tempogram**, **Timing lanes**, **Echo rows**, **Beat lens** (ligado ou desligado; padrão ligado) - Mostram ou ocultam o tempograma, as faixas principais, as linhas de eco e a lente de batida. Os painéis restantes crescem para ocupar o espaço, e o cabeçalho permanece sempre visível. Ocultar um painel muda apenas a exibição: a análise continua, e o painel volta a mostrar todo o seu histórico quando você o reativa.

### Guia de visualização

A exibição tem cinco partes: o cabeçalho, o tempograma, as faixas principais, as linhas de eco e a lente de batida. Em uma exibição larga, a lente de batida fica à direita das faixas; em uma exibição alta, todas as partes ficam empilhadas de cima para baixo. Ao ocultar painéis com suas caixas de seleção, os painéis restantes ocupam o espaço; o cabeçalho permanece sempre visível. Os toques são organizados em três bandas: **Low** (bumbo e baixo), **Mid** (caixa, vozes e a maioria dos instrumentos) e **High** (chimbal e pratos). Todas as bandas usam a mesma cor; nas faixas, nas linhas de eco e na lente de batida, cada banda tem sua própria fileira, com **High** no topo e **Low** embaixo. Os nomes dos eixos, os valores das marcações e os rótulos de fileira **High**, **Mid** e **Low** são desenhados sobre os gráficos. A exibição conta apenas tempos; não detecta compassos nem o primeiro tempo.

- **Cabeçalho**:
  - A lâmpada de batida à esquerda do BPM acende a cada tempo previsto pelo analisador e depois esmaece rapidamente, mostrando o tempo que ele está seguindo; o **Metronome Click** toca nos mesmos tempos. Todo tempo acende da mesma forma, porque o analisador não sabe onde começa um compasso. Enquanto o analisador está em busca (**searching**), a lâmpada é um anel vazado.
  - Enquanto o analisador segue os tempos, mostra o BPM e **LOCKED**. Enquanto não os encontrou, mostra **searching**, com o último andamento travado como **(N BPM held)**.
  - **×½** e **×2** - A metade e o dobro do andamento mostrado.
  - **strongest** - O andamento que no momento se repete com mais força na música. Costuma coincidir com o andamento travado; quando difere, é uma alternativa provável.
  - **swing** - A proporção entre a primeira e a segunda metade de um tempo, a partir da posição típica do contratempo nos últimos 32 tempos. 1.00:1 é reto e 2.00:1 é um shuffle de tercinas.
  - **jitter** - A dispersão aleatória típica dos toques em torno de sua posição média na lente de batida, em ms. Partes precisas e programadas ficam perto de 0; uma execução mais solta resulta em valores mais altos.
  - Uma legenda dos símbolos: **○ no beat lock**, **◎ new vs N / 2N beats ago**, e **beat re-aligned** para a linha tracejada.
  - Um valor ainda não disponível é mostrado como —.
- **Tempograma**: mostra os últimos 20 segundos, com **Time** correndo da esquerda para a direita e **Tempo (BPM)** em uma escala logarítmica de 30 a 480, com seus valores na borda esquerda. O brilho mostra com que clareza a música se repete em cada andamento: só uma repetição clara e forte aparece brilhante, uma repetição fraca ou pouco clara fica apagada, e o silêncio permanece escuro. Andamentos relacionados, como a metade e o dobro do andamento, costumam aparecer como linhas mais fracas. Enquanto o analisador está travado, uma linha sólida mostra o andamento travado, e linhas tracejadas mostram a metade e o dobro dele; seus rótulos **adopted**, **×2** e **×½** ficam na borda direita, logo acima de cada linha. Essas linhas ficam mais fracas quando o analisador está menos seguro do pulso.
- **Faixas principais**: os tempos mais recentes, tantos quanto **Span (beats)** define, com o mais recente na borda direita; o título diz **Last N beats**. Linhas sólidas as dividem em três gráficos de desvio, uma faixa por banda com o nome na borda esquerda, com **Beats** no eixo horizontal e **Timing (ms)** no vertical. Linhas verticais marcam os tempos, e linhas mais fracas as colcheias; elas só são desenhadas onde o analisador estava travado. Cada ponto é um toque detectado, ligado ao centro da faixa por uma haste; quanto maior o ponto, mais seguro o analisador está desse toque.
  - A altura de um ponto em sua faixa mostra se ele chegou adiantado ou atrasado: acima do centro da faixa (0 ms) é atrasado, abaixo é adiantado. Linhas pontilhadas marcadas **+20** e **−20** indicam ±20 ms, e toques além de ±30 ms ficam na borda da faixa. O desvio é medido a partir da posição de semicolcheia ou de tercina mais próxima, conforme a grade que a música segue, e é mostrado em relação ao desvio habitual dos 16 tempos anteriores. Por isso, um atraso constante compartilhado por todas as partes não aparece; as faixas mostram o quanto cada toque difere da média recente.
  - Um círculo vazado é um toque ocorrido sem travamento. Ele fica no centro da faixa porque não tem desvio medido.
  - Um anel ao redor de um ponto marca um toque que a mesma banda não tocou na mesma posição nem um nem dois intervalos antes. Os anéis começam a aparecer um intervalo depois de um travamento ou realinhamento.
  - Uma área sombreada rotulada **searching** marca o período sem travamento.
  - Uma linha tracejada marca onde a grade de tempos foi realinhada sem perder o travamento, quando o analisador mudou para um novo andamento ou deslocou a posição dos tempos. A lente de batida, o swing e o jitter recomeçam a partir daí.
- **Linhas de eco**: ciclos de tantos tempos quanto **Span (beats)** define, empilhados com o mais recente em cima e separados por traços. O eixo horizontal é **Beats**, e o vertical, **Cycles ago**, numera cada linha. Enquanto as faixas principais estão visíveis, as linhas começam um ciclo atrás, em 1, e o título diz **Previous N-beat cycles**. Com as faixas principais ocultas, a linha de cima é o ciclo atual, em 0, o título diz **Recent N-beat cycles** e, quando há espaço, essa linha traz os nomes das bandas. Como os tempos se alinham verticalmente, um padrão que se repete a cada ciclo forma colunas verticais, e uma mudança as rompe. As linhas de eco mostram a banda de cada toque, com **High** no alto de cada linha e **Low** embaixo, mas não o seu desvio. Círculos vazados, anéis, sombreamento e linhas tracejadas têm o mesmo significado que nas faixas principais.
- **Lente de batida**: resume os desvios dos últimos 32 tempos desde o travamento ou realinhamento atual. As colunas são posições dentro de um tempo, ao longo do eixo **Position in beat**: **1** (no tempo), **e**, **&** e **a** para semicolcheias, e **⅓** e **⅔** para tercinas. Cada banda tem sua própria fileira, com o nome na borda esquerda.
  - A marca vertical mostra o quanto aquela banda toca, em média, adiantada (esquerda) ou atrasada (direita) naquela posição. A escala no topo cobre ±30 ms, com marcas em ±20 ms. A barra sombreada ao redor da marca mostra a dispersão (± um desvio padrão). Uma marca mais opaca significa que a posição é tocada com mais frequência; uma posição precisa de pelo menos quatro toques para aparecer.
  - Quando os valores são atualizados, a posição das marcas e a largura das barras mudam suavemente em direção aos novos valores, cada vez mais devagar à medida que se aproximam deles.
  - Os desvios são medidos em relação ao conjunto como um todo: se tudo tocar junto, cada marca fica no centro. A lente mostra como as partes diferem entre si.
  - Desvios de 3 ms ou mais são rotulados em ms. Desvios menores são desenhados sem rótulo, porque diferenças entre bandas abaixo de cerca de 3 ms não podem ser medidas com confiabilidade.
  - Enquanto o analisador não está travado, a lente mostra **waiting for a steady beat**.
- **LOCKED** e a opacidade das linhas de andamento mostram o quão seguro o analisador está do pulso. Elas não mostram o quão precisa é a execução; a imprecisão rítmica é mostrada apenas pela altura dos pontos, pelo **jitter** e pelas barras da lente.
- O botão **Reset** limpa a exibição e reinicia a análise, por exemplo ao trocar de música.
- A entrada estéreo é analisada pela média dos dois primeiros canais; a entrada mono é usada diretamente.

### Exibição Visual
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto. Nas faixas e linhas de eco, a leitura mostra há quantos tempos o ponto ocorreu, e a banda e o desvio do toque mais próximo (— para um círculo vazado). No tempograma, mostra o andamento e o instante sob o cursor, **Salience** (a força com que a música se repete nesse andamento; 100% significa uma repetição clara e forte) e o andamento adotado, **Adopted**; na lente de batida, o desvio e a dispersão de cada banda naquela posição.

### Limitações

- A precisão pode diminuir em músicas com grandes variações de andamento, sem seção rítmica ou executadas com instrumentos acústicos. Música tranquila tocada em andamento livre sem percussão, música ambiente e sons sustentados permanecem em **searching**. Algumas gravações expressivas, como piano solo ou interpretações de música clássica, nunca chegam a travar.
- O analisador pode se estabelecer em um nível de pulso diferente do que um ouvinte escolheria, e então a lâmpada e o clique podem seguir o dobro, a metade, dois terços ou uma vez e meia o andamento que você sente. Em música clássica, em execuções com rubato e em algumas outras, ele também demora mais para travar e salta brevemente para outro nível com mais frequência do que em música de pulso estável. **×½**, **×2** e **strongest** mostram os andamentos alternativos prováveis. Se o andamento detectado ou a posição do pulso não corresponder ao que você ouve, tente restringir a faixa com **Min BPM** e **Max BPM** em torno do andamento esperado e ouça novamente.
- Com padrões rítmicos esparsos, do tipo clave, o pulso pode travar no contratempo.
- Quando o andamento muda continuamente, como em uma aceleração gradual ou um rubato livre, o pulso acompanha a mudança com um pequeno atraso, então o clique pode soar um pouco adiantado ou atrasado até o andamento se estabilizar.
- Em algumas músicas de andamento estável, a posição dos tempos é ocasionalmente realinhada, indicada pela linha tracejada, mesmo que a música não tenha mudado.
- Em mixagens densas e gravações ruidosas, as faixas **Mid** e **High** mostram mais pontos onde nenhum instrumento realmente tocou. A faixa **Low** deixa passar algumas notas graves do piano.
- Não há detecção de compasso ou métrica: a exibição é organizada apenas por tempos e não mostra onde começa um compasso.
- A análise completa funciona a 8; 11,025; 16; 22,05; 24; 32; 44,1; 48; 88,2; 96; 176,4; 192; 352,8 e 384 kHz. Em qualquer outra taxa de amostragem, como 64 kHz, o analisador usa um método mais simples: o pulso e os toques ficam menos precisos, e depois que a música para, o pulso continua sendo mostrado por vários segundos.

## Spectrogram

Cria padrões coloridos que mostram como sua música muda ao longo do tempo. As cores indicam a intensidade de cada som, enquanto a posição vertical indica a frequência.

O gráfico se desloca da direita para a esquerda a uma velocidade constante, com marcações a cada segundo.

### Guia de Visualização
- As cores mostram a intensidade de diferentes frequências:
  - Cores escuras: Sons baixos
  - Cores brilhantes: Sons altos
  - Observe os padrões mudarem com a música
- A posição vertical mostra a frequência:
  - Parte inferior: Sons graves
  - Meio: Instrumentos principais
  - Parte superior: Frequências altas

### Exibição Visual
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

### O Que Você Pode Ver
- Melodias: Linhas fluidas de cor
- Batidas: Listras verticais
- Graves: Cores brilhantes na parte inferior
- Harmonias: Múltiplas linhas paralelas
- Diferentes instrumentos criam padrões únicos

### Parâmetros
- **Color** - **Normal** usa a cor do gráfico do tema e fica mais claro nas frequências fortes. **Heatmap** (padrão) mantém a escala multicolorida original. A troca recolore o histórico existente.
- **DB Range** - Quão vibrantes são as cores (-144dB a -48dB)
  - Números menores: Veja mais detalhes sutis
  - Números maiores: Foque nos sons principais
- **Points** - Tamanho de FFT usado na visualização (256 a 16384)
  - Números maiores: Mais detalhe de frequência, mas atualização temporal mais lenta
  - Números menores: Movimento mais rápido, mas menos detalhe de frequência
  - Com **Log (HQ)**, Points define a janela curta de análise; uma janela quatro vezes mais longa melhora a separação das frequências baixas.
- **Frequency Scale** - **Log** reserva mais espaço de exibição para as frequências baixas. **Log (HQ)** acrescenta uma medição mais longa para separar com mais clareza graves próximos, mantendo a medição curta para os agudos. Usa mais processamento, e mudanças nos graves podem demorar mais para aparecer ou desaparecer, mas não altera o áudio. **Linear** distribui larguras de frequência iguais em intervalos iguais.
- **Keyboard** - Mostra à direita do gráfico um guia estático de teclado que relaciona as notas musicais às frequências. Não altera a análise nem o áudio. A disposição das teclas acompanha **Log**, **Log (HQ)** ou **Linear**; **Log (HQ)** usa o mesmo espaçamento logarítmico de **Log**, e em **Linear** as teclas graves parecem mais estreitas.
- O analisador usa a média dos canais esquerdo e direito. A entrada mono é analisada diretamente.

## Spectrum Analyzer

Cria uma exibição visual em tempo real das frequências da sua música, dos graves profundos aos agudos. É como ver os ingredientes individuais que compõem o som completo da sua música.

### Guia de Visualização
- Lado esquerdo mostra frequências graves (bateria, baixo)
- Meio mostra frequências principais (vocais, guitarras, piano)
- Lado direito mostra frequências altas (pratos, brilho, ar)
- Picos mais altos significam presença mais forte dessas frequências
- A linha mais grossa mostra o som atual
- A linha mais fina acompanha os picos recentes e desce suavemente enquanto desaparecem
- Na visualização **Bar**, cada barra mostra o nível mais alto em uma parte de largura igual da tela. **Log** e **Log (HQ)** usam larguras de oitava iguais; **Linear** usa larguras de frequência iguais.
- A marca fina acima de uma barra mostra seu pico recente e desce suavemente.
- Observe como diferentes instrumentos criam padrões diferentes

### Exibição Visual
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

### O Que Você Pode Ver
- Drops de Grave: Grandes movimentos à esquerda
- Melodias Vocais: Atividade no meio
- Agudos Nítidos: Brilhos à direita
- Mix Completo: Como todas as frequências trabalham juntas

### Parâmetros
- **Color** - **Normal** (padrão) mantém as cores do gráfico do tema. **Heatmap** ilumina os níveis mais altos e **Note Colors** acompanha as cores das notas no eixo de frequências. A escolha vale para **Line** e **Bar**. Com **Bar** e **Note Colors**, cada barra e sua marca de pico usam uma única cor conforme a frequência central da faixa.
- **DB Range** - Quão sensível é o display (-144dB a -48dB)
  - Números menores: Veja mais detalhes sutis
  - Números maiores: Foque nos sons principais
- **Points** - O quanto a visualização separa frequências próximas (256 a 16384)
  - Números maiores: Mais detalhe de frequência, com atualizações mais lentas
  - Números menores: Atualizações mais rápidas, com menos detalhe de frequência
  - Com **Log (HQ)**, Points define a janela curta de análise; uma janela quatro vezes mais longa melhora a separação das frequências baixas.
- **Frequency Scale** - **Log** reserva mais espaço de exibição para as frequências baixas. **Log (HQ)** acrescenta uma medição mais longa para separar com mais clareza graves próximos, mantendo a medição curta para os agudos. Usa mais processamento, e mudanças nos graves podem demorar mais para aparecer ou desaparecer, mas não altera o áudio. **Linear** distribui larguras de frequência iguais em intervalos iguais.
- **Display** - Altera apenas a aparência do espectro; não altera a análise nem o áudio.
  - **Line** (padrão): Mostra o espectro como linhas contínuas.
  - **Bar**: Mostra como barra o nível mais alto de cada faixa exibida.
- **Keyboard** - Mostra abaixo do gráfico um guia estático de teclado que relaciona as notas musicais às frequências. Não altera a análise nem o áudio. A disposição das teclas acompanha **Log**, **Log (HQ)** ou **Linear**; **Log (HQ)** usa o mesmo espaçamento logarítmico de **Log**, e em **Linear** as teclas graves parecem mais estreitas.
- O analisador usa a média dos canais esquerdo e direito. A entrada mono é analisada diretamente.

### Formas Divertidas de Usar Essas Ferramentas

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

## Stereo Meter

Uma ferramenta fascinante de visualização que permite ver como sua música cria uma sensação de espaço através do som estéreo. Observe como diferentes instrumentos e sons se movem entre seus alto-falantes ou fones de ouvido, adicionando uma dimensão visual empolgante à sua experiência auditiva.

### Guia de Visualização
- **Display em Diamante** - A janela principal onde a música ganha vida:
  - Centro: Momentos muito silenciosos ou em que o sinal combinado fica perto de zero
  - Cima/Baixo: Som compartilhado pelos canais esquerdo e direito, como conteúdo centralizado ou próximo de mono
  - Esquerda/Direita: Diferença ou conteúdo fora de fase entre os canais
  - Sons muito mais fortes de um lado podem aparecer perto dos cantos rotulados
  - Pontos verdes dançam com a música atual
  - Linha branca traça os picos musicais
  - A linha branca de picos decai a cada amostra de áudio, mantendo o mesmo movimento independentemente do tamanho do bloco de processamento
- **Correlation Bar** (lado esquerdo)
  - Mostra a correlação entre os canais esquerdo e direito
  - Topo (+1.0): Esquerda e direita são quase iguais, normalmente soando centralizadas
  - Meio (0.0): Relação fraca entre canais, comum em ambiências amplas ou conteúdo esquerdo/direito pouco relacionado
  - Base (-1.0): Esquerda e direita têm polaridade quase oposta, o que pode soar fraco em alto-falantes
- **Barra de Balanço** (Base)
  - Mostra se um alto-falante está mais alto que o outro
  - Centro: Música igualmente alta em ambos os alto-falantes
  - Esquerda/Direita: Música mais forte em um alto-falante
  - Os números mostram a diferença em decibéis (dB)

### O Que Você Pode Ver
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
- **Gain** (0 a 24 dB; padrão: 0 dB) - Amplia apenas os pontos e a linha de picos no gráfico em forma de losango. Aumente o valor para ver melhor os padrões dos trechos mais baixos. Não altera o áudio nem as leituras de correlação e equilíbrio.

### Aproveite Sua Música
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

Lembre-se: Essas ferramentas são feitas para melhorar seu prazer ao ouvir música, adicionando uma dimensão visual à sua experiência auditiva. Divirta-se explorando e descobrindo novas maneiras de ver sua música favorita!
