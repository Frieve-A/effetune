---
title: "Plugins de Análise - EffeTune"
description: "Plugins de análise de áudio, incluindo Level Meter, Note Spectrogram, Oscilloscope, Spectrogram, Spectrum Analyzer e Stereo Meter."
lang: pt
---

# Plugins de Análise

Uma coleção de plugins que permitem visualizar sua música de maneiras fascinantes. Essas ferramentas visuais ajudam você a entender o que está ouvindo, mostrando diferentes aspectos do som e tornando sua experiência de audição mais envolvente e interativa.

## Lista de Plugins

- [Level Meter](#level-meter) - Mostra o nível do sinal digital e possível clipping
- [Note Spectrogram](#note-spectrogram) - Mostra as alturas estimadas ao longo do tempo em um piano roll
- [Oscilloscope](#oscilloscope) - Exibe visualização da forma de onda em tempo real
- [Spectrogram](#spectrogram) - Cria padrões visuais bonitos a partir da sua música
- [Spectrum Analyzer](#spectrum-analyzer) - Mostra as diferentes frequências na sua música
- [Stereo Meter](#stereo-meter) - Visualiza o balanço estéreo e o movimento do som

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
- **Volume** - Mostra o volume relativo pela espessura das barras e por medidores semicirculares. Fica ativado por padrão; ao desativá-lo, permanecem as linhas originais baseadas apenas na confiança.
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

### Parâmetros
- **Display Time** - Quanto tempo mostrar (1 a 100 ms)
  - Valores menores: Veja mais detalhes em eventos curtos
  - Valores maiores: Visualize padrões mais longos
- **Trigger Mode**
  - Auto: Atualizações contínuas mesmo sem trigger
  - Normal: Congela o display até o próximo trigger
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

### O Que Você Pode Ver
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
- **Frequency Scale** - **Log** reserva mais espaço de exibição para as frequências baixas; **Linear** distribui larguras de frequência iguais em intervalos iguais.
- O analisador usa a média dos canais esquerdo e direito. A entrada mono é analisada diretamente.

## Spectrum Analyzer

Cria uma exibição visual em tempo real das frequências da sua música, dos graves profundos aos agudos. É como ver os ingredientes individuais que compõem o som completo da sua música.

### Guia de Visualização
- Lado esquerdo mostra frequências graves (bateria, baixo)
- Meio mostra frequências principais (vocais, guitarras, piano)
- Lado direito mostra frequências altas (pratos, brilho, ar)
- Picos mais altos significam presença mais forte dessas frequências
- A linha verde mais escura mostra o som atual
- A linha verde mais clara acompanha os picos recentes e desce suavemente à medida que desaparecem
- Observe como diferentes instrumentos criam padrões diferentes

### O Que Você Pode Ver
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
- **Frequency Scale** - **Log** reserva mais espaço de exibição para as frequências baixas; **Linear** distribui larguras de frequência iguais em intervalos iguais.
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
