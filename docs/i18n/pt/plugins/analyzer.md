---
title: "Analyzer Plugins - EffeTune"
description: "Audio analysis plugins including Level Meter, Oscilloscope, Spectrogram, Spectrum Analyzer, and Stereo Meter."
lang: en
---

# Plugins de Análise

Uma coleção de plugins que permitem visualizar sua música de maneiras fascinantes. Essas ferramentas visuais ajudam você a entender o que está ouvindo, mostrando diferentes aspectos do som e tornando sua experiência de audição mais envolvente e interativa.

## Lista de Plugins

- [Level Meter](#level-meter) - Mostra o volume da música
- [Oscilloscope](#oscilloscope) - Exibe visualização da forma de onda em tempo real
- [Spectrogram](#spectrogram) - Cria padrões visuais bonitos a partir da sua música
- [Spectrum Analyzer](#spectrum-analyzer) - Mostra as diferentes frequências na sua música
- [Stereo Meter](#stereo-meter) - Visualiza o balanço estéreo e o movimento do som

## Level Meter

Um display visual que mostra em tempo real o volume da sua música. Ajuda você a garantir que está ouvindo em níveis confortáveis e evitar qualquer distorção causada por volume muito alto.

### Guia de Visualização
- O medidor se move para cima e para baixo com o volume da música
- Quanto mais alto no medidor, mais alto o som
- O marcador vermelho mostra o nível mais alto recente
- Aviso vermelho no topo indica que o volume pode estar muito alto
- Para uma audição confortável, mantenha os níveis na faixa média

## Oscilloscope

Um osciloscópio profissional que exibe formas de onda de áudio em tempo real, ajudando você a visualizar a forma real das suas ondas sonoras. Possui funcionalidade de trigger para exibição estável da forma de onda, facilitando a análise de sinais periódicos e transientes.

### Guia de Visualização
- Eixo horizontal mostra o tempo (milissegundos)
- Eixo vertical mostra a amplitude (-1 a 1)
- Linha verde traça a forma de onda real
- Linhas de grade ajudam a medir valores de tempo e amplitude
- Ponto de trigger marca onde a captura da forma de onda começa

### Parâmetros
- **Display Time** - Quanto tempo mostrar (1 a 100 ms)
  - Valores menores: Veja mais detalhes em eventos curtos
  - Valores maiores: Visualize padrões mais longos
- **Trigger Mode**
  - Auto: Atualizações contínuas mesmo sem trigger
  - Normal: Congela o display até o próximo trigger
- **Trigger Source** - Qual canal usar para trigger
  - Seleção de canal Esquerdo/Direito
- **Trigger Level** - Nível de amplitude que inicia a captura
  - Faixa: -1 a 1 (amplitude normalizada)
- **Trigger Edge**
  - Rising: Dispara quando o sinal sobe
  - Falling: Dispara quando o sinal desce
- **Holdoff** - Tempo mínimo entre triggers (0.1 a 10 ms)
- **Display Level** - Escala vertical em dB (-96 a 0 dB)
- **Vertical Offset** - Desloca a forma de onda para cima/baixo (-1 a 1)

### Nota sobre a Exibição da Forma de Onda
A forma de onda exibida usa interpolação linear entre pontos de amostra para visualização suave. Isso significa que o sinal de áudio real entre as amostras pode diferir do que é mostrado. Para uma representação mais precisa, especialmente ao analisar conteúdo de alta frequência, considere usar taxas de amostragem mais altas (96kHz ou superior).

## Spectrogram

Cria padrões coloridos e bonitos que mostram como sua música muda ao longo do tempo. É como ver uma pintura da sua música, onde diferentes cores representam diferentes sons e frequências.

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
- **Points** - Quão detalhados são os padrões (256 a 16384)
  - Números maiores: Padrões mais precisos
  - Números menores: Visuais mais suaves
- **Channel** - Qual parte do campo estéreo mostrar
  - All: Tudo combinado
  - Left/Right: Lados individuais

## Spectrum Analyzer

Cria uma exibição visual em tempo real das frequências da sua música, dos graves profundos aos agudos. É como ver os ingredientes individuais que compõem o som completo da sua música.

### Guia de Visualização
- Lado esquerdo mostra frequências graves (bateria, baixo)
- Meio mostra frequências principais (vocais, guitarras, piano)
- Lado direito mostra frequências altas (pratos, brilho, ar)
- Picos mais altos significam presença mais forte dessas frequências
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
- **Points** - Quão detalhado é o display (256 a 16384)
  - Números maiores: Mais detalhes precisos
  - Números menores: Movimento mais suave
- **Channel** - Qual parte do campo estéreo mostrar
  - All: Tudo combinado
  - Left/Right: Lados individuais

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
   - Use o Level Meter para encontrar volumes confortáveis de audição
   - Observe o Spectrum Analyzer dançar com a música
   - Crie um show de luzes visual com o Spectrogram

## Stereo Meter

Uma ferramenta fascinante de visualização que permite ver como sua música cria uma sensação de espaço através do som estéreo. Observe como diferentes instrumentos e sons se movem entre seus alto-falantes ou fones de ouvido, adicionando uma dimensão visual empolgante à sua experiência auditiva.

### Guia de Visualização
- **Display em Diamante** - A janela principal onde a música ganha vida:
  - Centro: Quando o som está perfeitamente balanceado
  - Cima/Baixo: Quando a música preenche uniformemente ambos os alto-falantes
  - Esquerda/Direita: Quando o som vem mais de um alto-falante
  - Pontos verdes dançam com a música atual
  - Linha branca traça os picos musicais
- **Barra de Movimento** (Lado esquerdo)
  - Mostra como seus alto-falantes trabalham juntos
  - Topo (+1.0): Ambos os alto-falantes tocando o mesmo som
  - Meio (0.0): Alto-falantes criando um bom efeito estéreo
  - Base (-1.0): Alto-falantes criando efeitos especiais
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
- **Movimento do Som**: Altura da barra esquerda

### Parâmetros
- **Window Time** (10-1000 ms)
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