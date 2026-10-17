---
title: "Plugins de Áudio Espacial - Crossfeed, cancelamento de diafonia, largura estéreo e upmix - EffeTune"
description: "Plugins de áudio espacial, incluindo Crossfeed Filter, Crosstalk Cancellation, MS Matrix, Multiband Balance, Phase Select EQ, Spatial Mapper e Stereo Blend."
lang: pt
---

# Plugins de Áudio Espacial

Uma coleção de plugins que aprimoram como a música soa em seus fones de ouvido ou alto-falantes ajustando o balanço estéreo (esquerda e direita). Esses efeitos podem fazer sua música soar mais espaçosa e natural, especialmente ao ouvir com fones de ouvido.

## Lista de Plugins

- [Crossfeed Filter](#crossfeed-filter) - Filtro de crossfeed para fones de ouvido para imagem estéreo natural
- [Crosstalk Cancellation](#crosstalk-cancellation) - Reduz a diafonia entre alto-falantes estéreo com medições junto aos ouvidos
- [MS Matrix](#ms-matrix) - Converte estéreo para Mid/Side e de volta para cadeias avançadas de ajuste estéreo
- [Multiband Balance](#multiband-balance) - Controle de balanço estéreo dependente de frequência de 5 bandas
- [Phase Select EQ](#phase-select-eq) - Realça ou atenua componentes de frequência conforme a diferença de fase L/R e Balance
- [Spatial Mapper](#spatial-mapper) - Separa o som Direct, Diffuse e Residual e roteia cada componente entre os canais
- [Stereo Blend](#stereo-blend) - Controla a largura estéreo de estéreo com polaridade lateral invertida, passando por mono, até estéreo expandido

## Crossfeed Filter

Um filtro de crossfeed para fones de ouvido que simula a diafonia acústica natural que ocorre ao ouvir através de alto-falantes. Este efeito ajuda a reduzir a separação estéreo exagerada frequentemente experimentada com fones de ouvido, criando uma experiência de audição mais natural e confortável que imita a forma como o som chega aos nossos ouvidos em um ambiente acústico real.

### Recursos principais
- Simula a diafonia acústica natural para audição com fones de ouvido
- Nível de crossfeed e temporização ajustáveis
- Filtragem passa-baixa para imitar a diafonia dependente de frequência
- Processamento apenas estéreo (automaticamente contornado para sinais mono ou outros sinais não estéreo)

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para escolher uma quantidade completa de crossfeed para audição com fones de ouvido.

- **Subtle Blend** - Um crossfeed muito leve que preserva quase toda a largura original.
- **Vintage Receiver** - Um crossfeed moderado, parecido com o de um adaptador de fones de ouvido tradicional.
- **Living Room Speakers** - Uma mistura forte, semelhante à de alto-falantes, para gravações com separação estéreo muito ampla.

### Parâmetros
- **Level** (-60 dB a 0 dB): Controla a quantidade de sinal de crossfeed
  - Valores mais baixos (-20 dB a -6 dB): Crossfeed sutil e natural
  - Valores mais altos (-6 dB a 0 dB): Efeito mais pronunciado
- **Delay** (0 ms a 1 ms): Simula a diferença de tempo da diafonia acústica
  - Valores mais baixos (0.1-0.3 ms): Imagem mais apertada e focada
  - Valores mais altos (0.3-1.0 ms): Apresentação mais espaçosa, similar a alto-falantes
- **LPF Freq** (100 Hz a 20000 Hz): Controla a resposta de frequência do crossfeed
  - Valores mais baixos (500-1000 Hz): Diafonia mais natural dependente de frequência
  - Valores mais altos (1000-20000 Hz): Resposta de frequência mais ampla

### Pontos de partida

Use a predefinição do sistema **Subtle Blend**, **Vintage Receiver** ou **Living Room Speakers** como ponto de partida completo. Depois, ajuste primeiro o Level: valores mais baixos preservam mais a largura estéreo, e valores mais altos deixam a mistura semelhante à de alto-falantes mais evidente.

### Guia de aplicação

1. Otimização de Fones de Ouvido
   - Comece com configurações conservadoras (Level -15 dB, Delay 0.3 ms)
   - Ajuste o Level para conforto e naturalidade
   - Afine o Delay para a percepção espacial
   - Use LPF para controlar a resposta de frequência

2. Considerações de Estilo Musical
   - Clássica/Jazz: Níveis mais baixos (-15 a -10 dB) para apresentação natural
   - Rock/Pop: Níveis moderados (-12 a -8 dB) podem suavizar guitarras ou vozes muito coladas aos lados sem tirar a energia da música
   - Eletrônica ou faixas muito abertas: Use níveis baixos a moderados (-18 a -10 dB) para preservar a largura, ou níveis mais altos apenas quando quiser domar uma separação esquerda/direita excessiva

3. Ambiente de Audição
   - Ambientes silenciosos: Níveis mais baixos para efeito sutil
   - Ambientes barulhentos: Níveis mais altos para melhor foco
   - Sessões de audição longas: Configurações conservadoras para reduzir fadiga

### Guia de início rápido

1. Configuração inicial
   - Configure Level para -12 dB
   - Configure Delay para 0.3 ms
   - Configure LPF Freq para 700 Hz

2. Ajuste fino
   - Ajuste Level para a quantidade desejada de crossfeed
   - Modifique Delay para percepção espacial
   - Afine LPF Freq para resposta de frequência

3. Otimização
   - Ouça para apresentação natural e confortável
   - Evite configurações excessivas que soem artificiais
   - Teste com vários estilos musicais

Lembre-se: O Crossfeed Filter é projetado para tornar a audição com fones de ouvido mais natural e confortável. Comece com configurações conservadoras e ajuste gradualmente para encontrar o equilíbrio ideal para suas preferências de audição e material musical.

## Crosstalk Cancellation

O Crosstalk Cancellation usa medições feitas junto aos seus ouvidos para reduzir o som de cada alto-falante estéreo que chega ao ouvido oposto. Use-o com dois alto-falantes estéreo quando você ouve de uma posição medida e quer uma imagem estéreo mais definida, próxima da binaural. Ele não serve para fones de ouvido nem para reprodução mono.

Ao contrário do [Crossfeed Filter](#crossfeed-filter), que adiciona um pouco de diafonia semelhante à de alto-falantes na audição com fones, o Crosstalk Cancellation reduz a diafonia medida na audição com alto-falantes.

### Medir e atribuir

1. Coloque o microfone na posição do seu ouvido esquerdo e faça uma medição com as saídas dos alto-falantes esquerdo e direito selecionadas. Atribua o canal esquerdo dessa medição a **LL: L Speaker → Left Ear** e o canal direito a **RL: R Speaker → Left Ear**.
2. Leve o microfone para a posição do ouvido direito e repita a mesma medição com as duas saídas. Atribua o canal esquerdo a **LR: L Speaker → Right Ear** e o canal direito a **RR: R Speaker → Right Ear**.
3. Use medições de um único ponto feitas com a mesma instalação de alto-falantes e de audição. Atribua um canal de medição diferente a cada campo e aguarde até os filtros ficarem prontos.

Comece com os valores padrão: **Taps** 4096, **Regularization** 50%, **Max Gain** 12 dB, **Freq Low** 200 Hz, **Freq High** 6000 Hz, **Direct Window** 8 ms, **Strength** 70%, **Output Gain** 0 dB e **Latency** 128 samples. Compare com o bypass e faça pequenas mudanças sentado na posição medida.

### Parâmetros

- **Taps** (1024–16384): Define o comprimento do filtro. Mais taps podem melhorar o cancelamento, mas exigem mais processamento e acrescentam um atraso modelado maior. Se o estado avisar que a cauda do filtro pode estar truncada, aumente primeiro os Taps.
- **Regularization** (0–100%): Limita correções agressivas onde as medições são difíceis de cancelar. Aumente se o resultado soar instável ou colorido quando você se move um pouco; diminua apenas se a posição medida precisar de mais cancelamento.
- **Max Gain** (0–24 dB): Limita quanto os filtros de correção podem reforçar. Um valor menor é mais suave e preserva margem; um valor maior pode cancelar mais, mas deixa o resultado menos robusto.
- **Freq Low** (20–2000 Hz) e **Freq High** (1000–20000 Hz): Definem a banda principal de correção. As frequências abaixo e acima da banda selecionada passam sem correção. Comece com 200 Hz–6000 Hz; estreite a banda se o efeito for sensível demais aos movimentos da cabeça.
- **Direct Window** (2–50 ms): Define quanto de cada som direto medido é usado. Uma janela mais curta reduz as reflexões da sala, mas pode elevar o limite efetivo de graves; uma janela mais longa inclui mais informação de graves, mas pode incluir mais som da sala.
- **Strength** (0–100%): Mistura do sinal atrasado sem correção, em 0%, até a correção completa, em 100%. Comece em 70%; reduza se o som ficar artificial fora da posição medida.
- **Output Gain** (-24 a +24 dB): Ajusta o nível final após a correção. Mantenha-o primeiro em 0 dB e reduza se precisar deixar margem.
- **Latency** (0, 128, 256, 512 ou 1024 samples): Seleciona a latência do bloco de processamento. Valores maiores facilitam o processamento dos filtros; valores menores são preferíveis quando a latência de monitoramento importa.

### Estado e latência

O estado começa com **Assign all four measurements to begin.** Enquanto os filtros são gerados, ele indica que o projeto está em andamento; quando estão prontos, informa o ganho máximo do filtro. Um aviso de cauda significa que aumentar **Taps** ou **Regularization** pode ajudar. Um aviso de que **Direct Window** elevou a frequência baixa efetiva significa que a janela selecionada é curta demais para usar as frequências mais baixas solicitadas.

Se uma medição atribuída não for encontrada, selecione-a novamente. Se os filtros não puderem ser preparados, tente menos **Taps** ou uma **Latency** maior. Até que quatro medições adequadas estejam atribuídas e os filtros estejam prontos, o plugin deixa o áudio passar sem alteração e não informa latência de processamento adicional.

Quando estiver pronto, a latência total adicionada é a **Latency** selecionada mais o atraso modelado do filtro; o aplicativo aplica sua compensação normal de atraso da cadeia. Verifique o **Atraso total** se o monitoramento em tempo real ou a sincronização entre áudio e vídeo forem importantes. O Crosstalk Cancellation não tem gráfico nem outra visualização.

## MS Matrix

MS Matrix converte áudio estéreo normal para o formato Mid/Side, ou converte áudio Mid/Side de volta para estéreo normal. Use quando quiser ajustar separadamente a informação central e lateral dentro de uma cadeia de efeitos, por exemplo codificar para M/S, mudar o nível de Mid ou Side e depois decodificar de volta para estéreo. Para um ajuste simples de largura estéreo em música normal, [Stereo Blend](#stereo-blend) é a ferramenta mais direta.

### Recursos principais
- Ganho de Mid e Side separados (–18 dB a +18 dB)  
- Chave Mode: Encode (Stereo→M/S) ou Decode (M/S→Stereo)  
- Troca opcional dos canais esquerdo/direito antes da codificação ou após a decodificação  

### Parâmetros
- **Mode** (Encode/Decode): Encode transforma estéreo esquerdo/direito em Mid no canal esquerdo e Side no canal direito. Decode trata o canal esquerdo como Mid e o canal direito como Side, então reconstrói o estéreo normal.
- **Mid Gain** (–18 dB a +18 dB): Ajusta o nível de Mid durante a conversão selecionada.
- **Side Gain** (–18 dB a +18 dB): Ajusta o nível de Side durante a conversão selecionada.
- **Swap L/R** (Off/On): Inverte os canais esquerdo e direito antes de codificar ou após decodificar  

### Configurações recomendadas
1. **Ampliação sutil para estéreo normal**
   - Primeiro MS Matrix: Mode: Encode, Mid Gain: 0 dB, Side Gain: +3 dB, Swap: Off
   - Segundo MS Matrix depois dele: Mode: Decode, Mid Gain: 0 dB, Side Gain: 0 dB, Swap: Off
   - Efeito: Reforça levemente o componente Side e depois retorna o resultado para estéreo normal
2. **Foco central para estéreo normal**
   - Primeiro MS Matrix: Mode: Encode, Mid Gain: +3 dB, Side Gain: -3 dB, Swap: Off
   - Segundo MS Matrix depois dele: Mode: Decode, Mid Gain: 0 dB, Side Gain: 0 dB, Swap: Off
   - Efeito: Traz vozes e sons centralizados para frente enquanto reduz a ambiência lateral
3. **Decodificar áudio M/S existente**
   - Mode: Decode
   - Mid Gain: 0 dB
   - Side Gain: 0 dB
   - Swap: Off
   - Use apenas quando o sinal de entrada já estiver em formato Mid/Side
4. **Inversão criativa**
   - Mode: Encode  
   - Mid Gain: 0 dB  
   - Side Gain: 0 dB  
   - Swap: On  

### Guia de início rápido
1. Decida se você precisa de uma única conversão ou de uma cadeia completa Encode -> ajuste -> Decode.
2. Para escuta estéreo normal, coloque um MS Matrix em modo Encode e um segundo MS Matrix mais adiante em modo Decode.
3. Ajuste **Mid Gain** e **Side Gain** no estágio Encode.
4. Ative **Swap L/R** apenas para correção de canais ou inversão criativa.
5. Use bypass para comparar e garantir que a imagem estéreo ainda soe natural.

## Multiband Balance

Um processador de balanço dependente de frequência que divide o áudio em cinco bandas e permite deslocar cada banda levemente para a esquerda ou para a direita. Use quando graves, vozes, pratos ou outras faixas de frequência parecem puxados para um lado e você quer reequilibrar apenas essa parte do som sem mover a faixa inteira.

### Recursos principais
- Controle de balanço estéreo dependente de frequência de 5 bandas
- Filtros crossover Linkwitz-Riley de alta qualidade
- Controle de balanço linear para ajuste estéreo preciso
- Processamento independente dos canais esquerdo e direito
- Tratamento automático de fade quando os filtros crossover são redefinidos

### Parâmetros

#### Frequências de Crossover
- **Freq 1** (20-500 Hz): Separa bandas baixas e médio-baixas
- **Freq 2** (100-2000 Hz): Separa bandas médio-baixas e médias
- **Freq 3** (500-8000 Hz): Separa bandas médias e médio-altas
- **Freq 4** (1000-20000 Hz): Separa bandas médio-altas e altas

#### Controles de Banda
Cada banda tem controle de balanço independente:
- **Band 1 Bal.** (-100% a +100%): Controla balanço estéreo de frequências baixas
- **Band 2 Bal.** (-100% a +100%): Controla balanço estéreo de frequências médio-baixas
- **Band 3 Bal.** (-100% a +100%): Controla balanço estéreo de frequências médias
- **Band 4 Bal.** (-100% a +100%): Controla balanço estéreo de frequências médio-altas
- **Band 5 Bal.** (-100% a +100%): Controla balanço estéreo de frequências altas

### Configurações recomendadas

1. Corrigir agudos puxados para a direita
   - Banda Baixa (20-100 Hz): 0% (centralizado)
   - Médio-Baixa (100-500 Hz): 0%
   - Média (500-2000 Hz): 0%
   - Médio-Alta (2000-8000 Hz): -10% a -25%
   - Alta (8000+ Hz): -10% a -30%
   - Efeito: Move o conteúdo brilhante levemente para a esquerda, mantendo graves e vozes estáveis

2. Corrigir médios-graves puxados para a esquerda
   - Banda Baixa: 0%
   - Médio-Baixa: +10% a +25%
   - Média: +5% a +15%
   - Médio-Alta: 0%
   - Alta: 0%
   - Efeito: Move corpo e vozes mais graves levemente para a direita sem mudar a imagem estéreo inteira

3. Manter graves centralizados ao ajustar o ar
   - Banda Baixa: 0%
   - Médio-Baixa: 0%
   - Média: 0%
   - Médio-Alta: +5% a +15%
   - Alta: +10% a +20%
   - Efeito: Move suavemente a ambiência superior para a direita enquanto os graves ficam centralizados

### Guia de aplicação

1. Correção de balanço na escuta
   - Mantenha frequências baixas (abaixo de 100 Hz) centralizadas para graves estáveis
   - Desloque apenas a faixa de frequência que parece fora do centro
   - Comece com valores pequenos com sinal positivo ou negativo (cerca de 5-20%)
   - Verifique a reprodução em mono para perceber mudanças de tom ou nível

2. Solução de Problemas
   - Reequilibre faixas de frequência que parecem muito à esquerda ou à direita
   - Aperte graves desfocados centralizando frequências baixas
   - Reduza artefatos estéreo ásperos em altas frequências
   - Melhore gravações em que partes diferentes do som inclinam para lados diferentes

3. Efeitos criativos para escuta
   - Crie posicionamentos incomuns dependentes de frequência
   - Faça as altas frequências inclinarem para um lado enquanto os graves ficam centralizados
   - Construa uma ambiência que pareça mais ampla com pequenos deslocamentos nas bandas superiores

4. Ajuste do Campo Estéreo
   - Ajuste fino do balanço estéreo por banda de frequência
   - Correção de distribuição estéreo desigual
   - Evite tratar este efeito como controle de largura estéreo; use Stereo Blend quando quiser alargar ou estreitar a imagem inteira
   - Manutenção da compatibilidade mono

### Guia de início rápido

1. Configuração Inicial
   - Comece com todas as bandas centralizadas (0%)
   - Defina frequências de crossover em pontos padrão:
     * Freq 1: 100 Hz
     * Freq 2: 500 Hz
     * Freq 3: 2000 Hz
     * Freq 4: 8000 Hz

2. Aprimoramento Básico
   - Mantenha Band 1 (graves) centralizada
   - Faça pequenos ajustes nas bandas mais altas
   - Ouça mudanças na imagem espacial
   - Verifique compatibilidade mono

3. Ajuste Fino
   - Ajuste pontos de crossover para corresponder ao seu material
   - Faça mudanças graduais nas posições das bandas
   - Ouça artefatos indesejados
   - Compare com bypass para perspectiva

Lembre-se: O Multiband Balance é uma ferramenta poderosa que requer ajuste cuidadoso. Comece com configurações sutis e aumente a complexidade conforme necessário. Sempre verifique seus ajustes tanto em estéreo quanto em mono para garantir compatibilidade.

## Phase Select EQ

O Phase Select EQ realça ou atenua componentes de frequência estéreo selecionados ao mesmo tempo por **frequência**, **diferença de fase absoluta entre esquerda e direita** e **balanço de nível entre esquerda e direita**. Ele aplica o mesmo multiplicador de ganho positivo aos dois canais, portanto ajusta o nível dos componentes espaciais escolhidos sem girar nem alterar a fase. Use-o quando um EQ comum, que separa apenas por frequência, não consegue distinguir um vocal ou instrumento centralizado de sons mais abertos ou totalmente panoramizados na mesma faixa de frequência.

Há cinco Bands independentes, cada um com um **Core** interno (Gain integral) e uma **Transition** externa (retorno suave a 100%). Os ganhos de Bands sobrepostos são multiplicados, então vários realces podem levar o sinal acima de 0 dBFS; deixe margem suficiente e compare com o bypass. O Phase Select EQ adiciona a latência da análise FFT (5.120 amostras, cerca de 106,7 ms a 48 kHz; cerca de 116,1 ms a 44,1 kHz), que aparece em **Atraso total** e pode afetar o monitoramento em tempo real e a sincronização entre áudio e vídeo.

### Guia de aprimoramento da audição

1. **Suavizar o brilho áspero de agudos abertos**: ajuste um Band em torno de 4–12 kHz e Phase de 90–180°, com Gain de 70–90% e transições amplas, para suavizar a aspereza dos agudos superiores fora de fase sem mexer nos detalhes centralizados.
2. **Dar presença a vocais centralizados**: ajuste um Band em torno de 1–4 kHz e Phase de 0–30° (ou Balance de −17% a +17%), com Gain de 110–125%, para trazer à frente os médios próximos do centro sem realçar a ambiência aberta.
3. **Controlar a ambiência difusa nos médios-graves**: ajuste um Band em torno de 150–600 Hz e Phase de 60–150°, com Gain de 80–90%, para limpar o embolamento aberto nos médios-graves e preservar o grave centralizado e o corpo da caixa.
4. **Domar um instrumento totalmente panoramizado**: na visualização **Balance**, selecione −100% a −70% (esquerda) ou +70% a +100% (direita), com o Phase Core em 150–180° para incluir os pontos de canal único em -180° e +180° (ou 0–180° se apenas o Balance deve decidir), estreite a faixa de frequência em torno do instrumento e reduza o Gain para 70–90%.

Essas faixas de fase são tendências típicas, não posições fixas das fontes. Observe onde os pontos realmente aparecem, faça pequenas mudanças e confirme o resultado tanto em fones de ouvido quanto em alto-falantes.

### Parâmetros

- **Band 1–5 / caixa de seleção** (Off/On) - Seleciona um Band para edição e o liga ou desliga.
- **Gain** (0% a 200%) - Multiplicador de nível dentro do Core (100% = sem alteração, 0% = mudo, 200% = +6 dB).
- **Solo** (Off/On) - Permite ouvir apenas os componentes selecionados pelos Bands em Solo; enquanto o Solo estiver ligado, o Gain é ignorado e tudo o que fica fora desses Bands é silenciado.
- **Core Low Freq / Core High Freq** (20 Hz a 40 kHz, limitado pela taxa de amostragem) - Faixa de frequência processada por completo.
- **Low Freq Trans / High Freq Trans** - Larguras da transição de frequência abaixo e acima do Core.
- **Core Low Phase / Core High Phase** (0° a 180°) - Faixa de diferença de fase L/R absoluta processada por completo.
- **Low Phase Trans / High Phase Trans** - Larguras da transição de fase em direção a 0° e a 180°.
- **Outer Low Bal / Core Low Bal / Core High Bal / Outer High Bal** (-100% a +100%) - Limites do Core e da Transition externa para o balanço de amplitude entre esquerda e direita.
- **Alças do mapa**: arraste dentro do quadro de um Band para movê-lo, arraste as bordas ou os cantos do Core para redimensioná-lo, ou arraste as alças tracejadas externas para ajustar as transições.

### Como ler o mapa de seleção

- **Eixo vertical**: frequência em escala logarítmica (graves embaixo, agudos em cima).
- **Eixo horizontal**: alterne entre **Phase** e **Balance** acima do mapa; editar um controle de Phase ou Balance muda a visualização automaticamente.
  - **Phase**: 0° (em fase) no centro; -180° e +180° nas bordas são o mesmo ponto de fase oposta. A seleção usa a diferença de fase absoluta, então o quadro é espelhado em torno de 0°, se une no centro quando toca 0° e continua pelas duas bordas quando chega a 180°.
  - **Balance**: 50:50 no centro, apenas o canal esquerdo na borda esquerda e apenas o direito na borda direita. Balance é `(amplitude direita - amplitude esquerda) / (amplitude esquerda + amplitude direita) × 100%`.
- **Sons de um só lado**: um componente presente em apenas um canal tem Balance de -100% ou +100% e aparece em -180° (esquerda) ou +180° (direita) na visualização Phase, por isso sons totalmente panoramizados podem ser selecionados em qualquer uma das duas visualizações.
- **Pontos e quadros**: os pontos brancos mostram componentes recentes da entrada (mais brilhantes e maiores = mais fortes; os rejeitados pelo eixo oculto ficam esmaecidos). Os retângulos internos contínuos mostram o **Core** de cada Band ativo, e os retângulos externos tracejados, sua **Transition**; o Band em edição fica destacado, e o número no canto de cada Core identifica o Band.
- **Selos**: o selo ao lado do número de cada Band mostra a faixa do eixo oculto no formato limite externo inferior › Core inferior–superior › limite externo superior, por exemplo `P 20°›40°–80°›100°` ou `B 100:0›80:20–70:30›0:100` (proporções esquerda:direita). `P full` ou `B full` significa que esse eixo não está limitado.
- **Leitura**: passe o cursor sobre o mapa, ou toque e arraste nele, para ler a frequência e a diferença de fase ou o balanço nesse ponto.

A grade de Balance usa proporções de canais conhecidas; as diferenças aproximadas de nível L/R aparecem como referência:

| Balance | 0% | ±17% | ±33% | ±60% | ±82% | ±100% |
|---|---:|---:|---:|---:|---:|---:|
| Proporção entre os canais | 50:50 | 59:41 | 67:33 | 80:20 | 91:9 | 100:0 |
| Diferença de nível L/R | 0 dB | ±3 dB | ±6 dB | ±12 dB | ±20 dB | apenas um canal |

## Spatial Mapper

O Spatial Mapper analisa a relação entre os canais de entrada por faixas de frequência, separa gradualmente o som em componentes Direct, Diffuse e Residual e roteia cada componente no bus de canais atual. Use-o para manter sons bem definidos na frente, enviar ambiência aos canais surround ou de altura, extrair o centro ou a ambiência e alterar a largura estéreo. A predefinição padrão **Transparent** preserva a posição original dos canais.

**Direct** contém o som coerente dominante de cada faixa. **Diffuse** contém o som menos coerente e distribuído. **Residual** preserva o conteúdo que não foi totalmente atribuído aos outros dois. A separação é gradual, por isso os sons não mudam bruscamente de rota quando os controles são ajustados.

O Spatial Mapper adiciona latência devido à análise de frequência. O EffeTune inclui essa latência no **Atraso total**. Leve-a em conta no monitoramento em tempo real e na sincronização entre áudio e vídeo.

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para escolher uma configuração inicial completa.

- **Transparent** - Preserva a posição original dos canais e é a predefinição padrão.
- **Stereo Enhance** - Amplia uma entrada estéreo pela rota Residual, preservando a posição dos sons definidos e difusos.
- **Center Extract** - Envia Direct ao canal 3. Use um bus com pelo menos três canais.
- **5.1 Upmix** - Distribui o estéreo na ordem L, R, C, LFE, Ls, Rs. Mantém o LFE vazio e exige pelo menos seis canais.
- **7.1.4 Upmix** - Distribui o estéreo na ordem L, R, C, LFE, Ls, Rs, Lb, Rb, Ltf, Rtf, Ltb, Rtb. Mantém o LFE vazio e exige pelo menos doze canais.
- **Ambience Extract** - Mantém Diffuse e suprime Direct e Residual.

### Como ler e editar a grade de roteamento

Em **Component Routing**, escolha a aba **Direct**, **Diffuse** ou **Residual**. As colunas são os canais de entrada analisados e as linhas são os canais do bus de saída. Use o pequeno controle deslizante ou o campo numérico de cada célula para ajustar o ganho linear de -1,00 a +1,00 em passos de 0,01: 0 desconecta, +1,00 envia o componente com polaridade positiva completa e um valor negativo o envia com polaridade invertida. Valores negativos aparecem em vermelho. Valores intermediários definem um nível proporcionalmente menor.

Uma linha de saída roteada substitui o canal correspondente do bus pelo resultado mapeado. Um canal de saída dentro do intervalo de **Input Channels** fica em silêncio quando nenhum componente é roteado para sua linha. Os canais fora desse intervalo atravessam o efeito com a mesma latência quando nenhum componente escreve neles.

### Guia de aprimoramento da audição

1. **Ampliar o estéreo sem mover tanto os sons definidos**
   - Comece com **Stereo Enhance**.
   - Reduza **Directness** ou **Diffuse Extraction** apenas se mais material precisar permanecer em Residual para a rota de ampliação.
   - Compare com **Transparent** e reduza a mudança se as imagens centrais enfraquecerem ou se a reprodução em mono perder conteúdo demais.
2. **Criar um canal central a partir do estéreo**
   - Use um bus com pelo menos três canais e escolha **Center Extract**.
   - Aumente **Directness** e **Separation** para concentrar mais conteúdo coerente em Direct.
   - Verifique se os vocais e outros sons centralizados continuam estáveis enquanto a ambiência aberta fica principalmente na esquerda e na direita.
3. **Expandir o estéreo para os canais surround ou de altura**
   - Configure o bus na ordem de canais indicada acima e escolha **5.1 Upmix** ou **7.1.4 Upmix**.
   - Ajuste **Diffuse Extraction** para controlar quanto conteúdo distribuído chega às rotas surround e de altura.
   - A predefinição não gera sinal LFE; adicione gerenciamento de graves separadamente quando necessário.
4. **Isolar a ambiência**
   - Comece com **Ambience Extract**.
   - Aumente **Diffuse Extraction** para uma seleção difusa mais forte e use **Phase Sensitivity** para definir quanto a oposição de fase entre os canais reduz a classificação Direct.

### Parâmetros

- **Input Channels** (1 a 16): Define quantos canais, a partir do início do bus, são analisados. Se o bus tiver menos canais, são usados os disponíveis.
- **Analysis Bands** (8, 16, 24, 32 ou 48): Define a resolução de frequência da análise espacial. Mais faixas acompanham melhor as mudanças de posição conforme a frequência, mas exigem mais processamento. O padrão é 24.
- **Directness** (0% a 100%): Controla quanto conteúdo coerente dominante é atribuído a Direct. Valores maiores reforçam a extração Direct.
- **Separation** (0% a 100%): Controla a seletividade da atribuição a Direct e Diffuse. Valores maiores deixam mais conteúdo ambíguo em Residual e aumentam o contraste entre as rotas.
- **Diffuse Extraction** (0% a 100%): Controla quanto conteúdo de baixa coerência é atribuído a Diffuse. Valores maiores enviam mais ambiência distribuída a essa rota.
- **Phase Sensitivity** (0% a 100%): Controla quanto a oposição de fase entre canais reduz a classificação Direct. Valores baixos tratam o conteúdo coerente de polaridade oposta de modo semelhante aos demais; valores altos deixam mais conteúdo fora de Direct. Esse controle não envia automaticamente sons em oposição de fase aos canais traseiros.
- **Temporal Smoothing** (0% a 100%, Fast a Stable): Controla a velocidade com que a análise e as rotas acompanham as mudanças. Valores baixos reagem mais rápido; valores altos reduzem o movimento da imagem e o bombeamento, mas respondem mais devagar.
- **Energy Preservation** (Off/On): Normaliza separadamente as rotas Direct, Diffuse e Residual para evitar mudanças de nível indesejadas causadas pelas matrizes. Desative quando o próprio ganho da matriz precisar mudar o nível do componente.
- **Component Routing / Direct**: Seleciona a grade Direct e define seus ganhos de saída.
- **Component Routing / Diffuse**: Seleciona a grade Diffuse e define seus ganhos de saída.
- **Component Routing / Residual**: Seleciona a grade Residual e define seus ganhos de saída.

## Stereo Blend

Um efeito que ajuda a alcançar um campo sonoro mais natural ajustando a largura estéreo da sua música. É particularmente útil para audição com fones de ouvido, onde pode reduzir a separação estéreo exagerada que frequentemente ocorre com fones, tornando a experiência de audição mais natural e menos cansativa. Também pode aprimorar a imagem estéreo para audição em alto-falantes quando necessário.

### Guia de aprimoramento da audição
- Otimização para Fones:
  - Reduz a largura estéreo (60-90%) para apresentação mais natural, semelhante a alto-falantes
  - Minimiza a fadiga auditiva da separação estéreo excessiva
  - Cria um palco sonoro frontal mais realista
- Aprimoramento de Alto-falantes:
  - Mantém a imagem estéreo original (100%) para reprodução precisa
  - Aprimoramento sutil (110-130%) para palco sonoro mais amplo quando necessário
  - Ajuste cuidadoso para manter campo sonoro natural
- Controle do Campo Sonoro:
  - Foco em apresentação natural e realista
  - Evita largura excessiva que poderia soar artificial
  - Use largura negativa apenas para inversão corretiva ou criativa da polaridade lateral
  - Otimiza para seu ambiente específico de audição

### Parâmetros
- **Stereo** - Controla a largura estéreo (-200% a 200%)
  - Valores negativos: Invertem a polaridade do componente lateral estéreo (L-R) antes da reconstrução
  - -200%: Largura máxima com polaridade lateral invertida; use apenas para correção ou casos especiais
  - -100%: Largura estéreo original com a imagem esquerda/direita trocada
  - 0%: Mono total (canais esquerdo e direito somados)
  - 100%: Imagem estéreo original
  - 200%: Expansão máxima de largura; mantém o componente central enquanto reforça fortemente a diferença estéreo lateral

### Configurações recomendadas para diferentes cenários de audição

1. Audição com Fones (Natural)
   - Stereo: 60-90%
   - Efeito: Separação estéreo reduzida
   - Perfeito para: Sessões longas de audição, reduzindo fadiga

2. Audição com Alto-falantes (Referência)
   - Stereo: 100%
   - Efeito: Imagem estéreo original
   - Perfeito para: Reprodução precisa

3. Aprimoramento de Alto-falantes
   - Stereo: 110-130%
   - Efeito: Aprimoramento sutil da largura
   - Perfeito para: Ambientes com alto-falantes próximos

### Guia de otimização por estilo musical

- Música Clássica
  - Fones: 70-80%
  - Alto-falantes: 100%
  - Benefício: Perspectiva natural de sala de concerto

- Jazz & Acústica
  - Fones: 80-90%
  - Alto-falantes: 100-110%
  - Benefício: Som íntimo e realista de conjunto

- Rock & Pop
  - Fones: 85-95%
  - Alto-falantes: 100-120%
  - Benefício: Impacto equilibrado sem largura artificial

- Música Eletrônica
  - Fones: 90-100%
  - Alto-falantes: 100-130%
  - Benefício: Espacialidade controlada mantendo foco

### Guia de início rápido

1. Escolha Sua Configuração de Audição
   - Identifique se está usando fones ou alto-falantes
   - Isso determina seu ponto de partida para ajuste

2. Comece com Configurações Conservadoras
   - Fones: Comece em 80%
   - Alto-falantes: Comece em 100%
   - Ouça o posicionamento natural do som

3. Ajuste Fino para Sua Música
   - Faça ajustes pequenos (5-10% por vez)
   - Foque em alcançar campo sonoro natural
   - Preste atenção ao conforto auditivo

Lembre-se: O objetivo é alcançar uma experiência de audição natural e confortável que reduz a fadiga e mantém a apresentação musical pretendida. Evite configurações extremas que podem soar impressionantes no início mas se tornam cansativas com o tempo.
