---
title: "Plugins de EQ - Equalizador paramétrico, gráfico e de fase linear, correção de sala - EffeTune"
description: "EQ paramétrico com importação do AutoEQ, EQ gráfico, dinâmico e de fase linear, Room EQ com suas próprias medições, Tonal Balance EQ, Loudness Equalizer e filtros."
lang: pt
---

# Plugins de Equalizador

Uma coleção de plugins que permite ajustar diferentes aspectos do som da sua música, desde graves profundos até agudos nítidos. Essas ferramentas ajudam você a personalizar sua experiência de audição, realçando ou reduzindo elementos sonoros específicos.

## Controles do gráfico

Nos gráficos de pontos arrastáveis do 5Band PEQ, 15Band PEQ, 5Band FIR PEQ, Group Delay PEQ e Additional EQ do Room EQ, arraste um ponto normalmente para alterar os dois eixos. Mantenha Shift pressionado enquanto arrasta para limitar o movimento a um eixo: comece a mover principalmente na horizontal para alterar apenas Frequency, ou principalmente na vertical para alterar apenas Level (Delay no Group Delay PEQ). Solte Shift para voltar ao movimento livre. Posicione o ponteiro sobre um ponto e role a roda para cima para aumentar Q ou para baixo para reduzi-lo.

## Seleção de bandas no celular

No celular, 5Band PEQ, 5Band FIR PEQ, Group Delay PEQ, Additional EQ do Room EQ e Target Adjust do Tonal Balance EQ mostram os ajustes de uma banda por vez. Toque em um botão numerado para trocar de banda. Os ajustes de todas as bandas são mantidos.

## Lista de Plugins

- [15Band GEQ](#15band-geq) - Ajuste detalhado do som com 15 controles precisos
- [15Band PEQ](#15band-peq) - Modelagem tonal detalhada em 15 bandas para ajustar o som durante a escuta
- [5Band Dynamic EQ](#5band-dynamic-eq) - Equalizador baseado em dinâmica que reage à sua música
- [5Band FIR PEQ](#5band-fir-peq) - Modelagem tonal em cinco bandas com filtragem FIR de fase mínima ou linear
- [5Band PEQ](#5band-peq) - Equalizador flexível para moldar graves, médios e agudos
- [Band Pass Filter](#band-pass-filter) - Foco em frequências específicas
- [Comb Filter](#comb-filter) - Coloração sonora faseada, oca ou metálica
- [Earphone Cable Sim](#earphone-cable-sim) - Ajuda a verificar como as mudanças de resposta em frequência causadas por cabos comuns de fones de ouvido costumam ser pequenas
- [Group Delay EQ](#group-delay-eq) - Ajusta o atraso de cada banda de frequência sem alterar o timbre
- [Group Delay PEQ](#group-delay-peq) - Controle paramétrico de cinco bandas do atraso por frequência sem alterar o timbre
- [Hi Pass Filter](#hi-pass-filter) - Remove frequências baixas indesejadas com precisão
- [Lo Pass Filter](#lo-pass-filter) - Remove frequências altas indesejadas com precisão
- [Loudness Equalizer](#loudness-equalizer) - Correção do balanço de frequência para audição em volumes baixos
- [Narrow Range](#narrow-range) - Foca em partes específicas do som
- [Room EQ](#room-eq) - Correção FIR baseada em medições de sala salvas
- [Tilt EQ](#tilt-eq) - Equalizador de inclinação para ajuste tonal simples
- [Tonal Balance EQ](#tonal-balance-eq) - Corrige automaticamente o equilíbrio tonal de longo prazo rumo a um alvo por estilo musical
- [Tone Control](#tone-control) - Ajuste simples de graves, médios e agudos

<!-- spectrum-overlay -->
## Sobreposição de espectro

Pressione o ícone de espectro de um gráfico compatível para alternar entre After, Before + After e Off. After mostra apenas o espectro processado como uma linha azul. Before + After preenche a mudança entre o espectro antes e depois do processamento: a cor quente marca as frequências cujo nível aumentou após o processamento, o azul marca aquelas cujo nível diminuiu e uma linha cinza indica o espectro After. Os espectros de entrada e saída são alinhados ao mesmo instante da reprodução, para que a comparação use o mesmo áudio. O modo **Normal** aplica suavização de 1/12 de oitava; o modo **Alta qualidade** analisa as frequências baixas com mais detalhe. Use a comparação para ver como cada ajuste altera graves, médios e agudos enquanto escuta. Leia os níveis do espectro na escala dBFS à direita do gráfico. Ela é separada da escala de ganho do gráfico; 0 dBFS é a referência digital de escala completa, e valores mais baixos são mais silenciosos. Em Configuração, escolha **Normal** ou **Alta qualidade** para a qualidade do espectro sobreposto e **Valor instantâneo** ou **Retenção de pico** para a exibição. A retenção de pico mantém os máximos recentes visíveis e os reduz gradualmente. Em After, apenas o espectro processado é coletado; em Off, a coleta e o desenho são interrompidos.

## 15Band GEQ

Uma ferramenta de ajuste de som detalhada com 15 controles separados, cada um afetando uma parte específica do espectro sonoro. Perfeita para afinar sua música exatamente do jeito que você gosta.

### Guia de aprimoramento da audição
- Região dos Graves (25Hz-160Hz):
  - Realce a potência dos bumbos e dos graves profundos
  - Ajuste a plenitude dos instrumentos de baixo
  - Controle o sub-grave que faz tremer o ambiente
- Médios Baixos (250Hz-630Hz):
  - Ajuste o calor da música
  - Controle a plenitude do som geral
  - Reduza ou realce a "espessura" do som
- Médios Superiores (1kHz-2.5kHz):
  - Torne os vocais mais claros e presentes
  - Ajuste a proeminência dos instrumentos principais
  - Controle a sensação de que o som está "à frente"
- Altas Frequências (4kHz-16kHz):
  - Realce a nitidez e os detalhes
  - Controle o "brilho" e o "ar" na música
  - Ajuste o brilho geral

### Parâmetros
- **Ganho das Bandas** - Controles individuais para cada faixa de frequência (-12dB a +12dB)
  - Graves Profundos
    - 25Hz: Sensação de grave mais baixa
    - 40Hz: Impacto de grave profundo
    - 63Hz: Potência dos graves
    - 100Hz: Plenitude dos graves
    - 160Hz: Graves superiores
  - Som Inferior
    - 250Hz: Calor do som
    - 400Hz: Plenitude do som
    - 630Hz: Corpo do som
  - Som Médio
    - 1kHz: Presença principal do som
    - 1.6kHz: Clareza do som
    - 2.5kHz: Detalhe do som
  - Som Alto
    - 4kHz: Nitidez do som
    - 6.3kHz: Brilho do som
    - 10kHz: Ar do som
    - 16kHz: Cintilação do som

### Exibição visual
- Gráfico em tempo real mostrando os ajustes do seu som
- Sliders fáceis de usar com controle preciso
- Reinicialização para as configurações padrão com um clique
- Dê um duplo clique em um deslizador para devolver aquela banda a 0dB
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

## 15Band PEQ

Um equalizador paramétrico de 15 bandas para ajustar graves, vocais, presença e agudos durante a escuta. Use quando quiser controle mais detalhado que um EQ gráfico, desde pequenas mudanças de tom até localizar uma frequência específica que incomoda.

### Guia de aprimoramento do som
- Clareza de Vocais e Instrumentos:
  - Ajuste uma banda em torno de 3.2kHz com Q moderado (1.0-2.0) para presença natural
  - Aplique cortes com Q estreito (4.0-8.0) apenas quando uma ressonância específica estiver incomodando
  - Adicione um toque suave de "air" com prateleira alta de 10kHz (+2 a +4dB)
- Controle de Qualidade dos Graves:
  - Molde a plenitude dos graves com um filtro peaking em 100Hz
  - Use um corte estreito se uma nota grave ou ressonância da sala se destacar demais
  - Crie uma extensão suave dos graves com prateleira baixa
- Ajustes Finos de Escuta:
  - Use boosts ou cortes pequenos e largos para resultados naturais
  - Use ajustes estreitos para problemas pontuais, não para o tom geral
  - Compare com bypass com frequência para garantir que a música continue equilibrada

### Parâmetros
- **Bandas configuráveis**
  - 15 bandas de frequência totalmente configuráveis
  - Configuração inicial de frequência:
    - 25Hz, 40Hz, 63Hz, 100Hz, 160Hz (Graves Profundos)
    - 250Hz, 400Hz, 630Hz (Som Inferior)
    - 1kHz, 1.6kHz, 2.5kHz (Som Médio)
    - 4kHz, 6.3kHz, 10kHz, 16kHz (Som Alto)
- **Controles por banda**
  - Center Frequency: Ajustável de 20Hz a 20kHz
  - Gain Range: ±20dB para filtros Peaking e Low/High Shelf
  - Q Factor: 0.1-10.0 para a maioria dos tipos de filtro; Low/High Shelf é limitado a 0.1-2.0
  - Q mais alto afeta uma faixa mais estreita; Q mais baixo soa mais suave e amplo
  - Para Low/High Pass, Band Pass, Notch e AllPass, Frequency e Q moldam o filtro; Gain não é usado
  - Múltiplos Tipos de Filtro:
    - Peaking: Ajuste simétrico de frequência
    - Low/High Pass: Inclinação de 12dB/octave
    - Low/High Shelf: Moldagem espectral suave
    - Band Pass: Isolamento focado de frequência
    - Notch: Remoção precisa de frequência
    - AllPass: Alinhamento de frequência com foco em fase
- **Gerenciamento de predefinições**
  - Importação: Carrega linhas de filtro TXT no estilo Equalizer APO
  - Até 15 filtros `ON` PK/LS/LSC/HS/HSC são importados; linhas `Preamp` e tipos de filtro não suportados são ignorados
    - Formato de exemplo:
      ```
      Filter 1: ON PK Fc 50 Hz Gain -3.0 dB Q 2.00
      Filter 2: ON HS Fc 12000 Hz Gain 4.0 dB Q 0.70
      ...
      ```

### Exibição visual
- Visualização de resposta de frequência em alta resolução
- Pontos de controle interativos com exibição precisa de parâmetros
- Atualização da curva em tempo real conforme os ajustes mudam
- Grade de frequência e ganho
- Leituras numéricas precisas para todos os parâmetros
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

## 5Band Dynamic EQ

Um equalizador inteligente que ajusta automaticamente as bandas de frequência com base no conteúdo da sua música. Ele combina equalização precisa com processamento dinâmico que reage às mudanças na sua música em tempo real, criando uma experiência de audição aprimorada sem ajustes manuais constantes.

### Guia de aprimoramento da audição
- Domar Vocais Agressivos:
  - Use o filtro Peak em 3000Hz com razão maior (4.0-10.0)
  - Defina um Threshold moderado (-24dB) e um Attack rápido (10ms)
  - Reduz automaticamente a aspereza apenas quando os vocais ficarem muito agressivos
- Realçar Clareza e Brilho:
  - Use Band 5 com Filter Type: Highshelf, Frequency: cerca de 10000Hz, SC Freq: cerca de 1200Hz, Ratio: 0.5, Attack: 1ms
  - Mids disparam altas frequências para uma clareza natural
  - Adiciona brilho à música sem luminosidade permanente
- Controlar Graves Excessivos:
  - Use o filtro Lowshelf em 100Hz com razão moderada (2.0-4.0)
  - Mantém o impacto dos graves enquanto previne distorções nos alto-falantes
  - Perfeito para músicas com graves intensos em alto-falantes menores
- Personalização Adaptativa do Som:
  - Permite que a dinâmica da música controle o equilíbrio sonoro
  - Ajusta automaticamente a diferentes músicas e gravações
  - Mantém qualidade de som consistente em toda sua playlist

### Parâmetros
- **Controles de cinco bandas** - Cada uma com configurações independentes
  - Band 1: 100Hz (Região de Graves)
  - Band 2: 300Hz (Médio Baixo)
  - Band 3: 1000Hz (Médio)
  - Band 4: 3000Hz (Médio Alto)
  - Band 5: 10000Hz (Frequências Agudas)
- **Configurações da banda**
  - Filter Type: Escolha entre Peak, Lowshelf ou Highshelf
  - Frequency: Ajuste fino da frequência central/de canto (20Hz-20kHz)
  - Q: Controla largura de banda/nitidez (0.1-10.0)
  - Max Gain: Defina o ajuste máximo de ganho (0-24dB)
  - Threshold: Defina o nível em que o processamento começa (-60dB a 0dB)
  - Ratio: Controle a intensidade do processamento (0.1-100.0)
    - Below 1.0: Expander (potencializa quando o sinal excede o Threshold)
    - Above 1.0: Compressor (reduz quando o sinal excede o Threshold)
  - Knee Width: Transição suave em torno do Threshold (0-10dB)
  - Attack: Velocidade de início do processamento (0.1-100ms)
  - Release: Velocidade de término do processamento (1-1000ms)
  - Sidechain Frequency: Frequência de detecção (20Hz-20kHz)
  - Sidechain Q: Largura de banda de detecção (0.1-10.0)

### Exibição visual
- Gráfico de resposta de frequência em tempo real
- Curva de resposta dinâmica mostrando os boosts e cortes atuais
- Controles interativos de frequência e ganho
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

## 5Band FIR PEQ

O 5Band FIR PEQ mantém os controles familiares de cinco bandas do 5Band PEQ, mas constrói a resposta combinada como um único filtro FIR. Use-o para corrigir com precisão o som durante a reprodução, aplicar cortes muito estreitos ou criar transições de shelf acentuadas sem os limites de estabilidade dos filtros recursivos. Minimum Phase mantém baixa a latência de processamento, enquanto Linear Phase atrasa todas as frequências pelo mesmo tempo fixo. O plugin requer o motor WASM DSP; sem ele, o sinal passa sem alterações.

### Guia de aprimoramento do som

- Comece com **Minimum Phase**, 32768 Taps e Latency de 128 samples. Para ajustes comuns de graves, médios e agudos, use valores amplos de Q, em torno de 0,7 a 2.
- Para um pico estreito medido, selecione Peaking, ajuste a frequência central ao pico e aumente Q aos poucos. Valores acima de 10 são destinados a correções precisas; verifique o status, pois uma resposta extremamente estreita pode exigir mais Taps.
- Use Low Shelf para equilibrar os graves e High Shelf para equilibrar os agudos. Alterações pequenas, de 1 a 3 dB, costumam bastar para a escuta cotidiana.
- Use LowPass ou HighPass para remover extremos de frequência indesejados. Comece com Slope de 12 ou 24 dB/oct e aumente somente se precisar de um corte mais acentuado.
- Escolha **Linear Phase** quando for importante manter um atraso de fase constante em todo o espectro e a latência adicional for aceitável. Pode surgir energia antes de um transiente, sobretudo com ajustes acentuados; compare com Minimum Phase em músicas com ataques marcantes.
- A construção FIR evita a instabilidade causada por polos de realimentação, mas um ganho alto ou Q muito elevado ainda produz uma resposta ao impulso longa e seletiva. Para ressonâncias isoladas, prefira cortes a ganhos e preserve margem de nível suficiente na reprodução.

### Parâmetros

- **Phase**
  - **Minimum Phase** - Cria uma resposta causal de fase mínima e não acrescenta o atraso correspondente à metade do comprimento do FIR. A Latency selecionada ainda é aplicada.
  - **Linear Phase** - Cria uma resposta simétrica de fase linear e acrescenta `Taps / 2` samples de atraso FIR além da Latency selecionada.
- **Taps** - Comprimento do FIR: 8192, 16384, 32768, 65536 ou 131072. Mais taps melhoram a precisão nos graves e com valores muito altos de Q, mas aumentam o uso de memória, o tempo de projeto e o atraso de Linear Phase.
- **Latency** - Latência inicial do motor de convolução: 0, 128, 256, 512 ou 1024 samples. Valores menores reduzem o atraso, mas exigem mais processamento.
- **Cinco bandas ajustáveis** - As frequências centrais iniciais são 100 Hz, 316 Hz, 1 kHz, 3,16 kHz e 10 kHz. Cada banda pode ser ativada separadamente com Enable.
- **Type** - Seleciona Peaking, LowPass, HighPass, Low Shelf, High Shelf, BandPass ou Notch. Todas as bandas ativas são combinadas antes do projeto do filtro FIR.
- **Freq** - Define a frequência da banda entre 20 Hz e 20 kHz.
- **Gain** - Define o ganho ou corte de -20 a +20 dB para Peaking, Low Shelf e High Shelf. LowPass, HighPass, BandPass e Notch não usam Gain.
- **Q** - Define a largura da resposta entre 0,1 e 100. Valores maiores produzem uma alteração mais estreita e valores menores, uma alteração mais ampla. O controle deslizante usa escala logarítmica.
- **Slope** - Define a inclinação de corte de LowPass ou HighPass entre 0,1 e 384 dB/oct. O controle deslizante usa escala logarítmica e só fica disponível para esses dois valores de Type.

### Exibição visual

- A curva cinza mostra a resposta-alvo combinada solicitada pelos ajustes atuais das bandas.
- A curva verde mostra a resposta de magnitude realizada pelo FIR projetado. Uma separação visível indica que o valor de Taps escolhido não consegue reproduzir exatamente o alvo.
- Os marcadores numerados correspondem às cinco bandas. Arraste na horizontal para alterar Freq e na vertical para alterar Gain; as bandas desativadas aparecem esmaecidas.
- A linha de status indica se o FIR está sendo projetado, preparado ou usado e mostra a latência total de processamento em samples e milissegundos.
- Se os Taps escolhidos não conseguirem reproduzir com precisão uma resposta extrema, o status recomenda aumentar Taps ou reduzir Q ou Slope.
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

## 5Band PEQ

Um equalizador flexível de 5 bandas para moldar o som da música. Use quando o grave soa embolado, os vocais estão ásperos ou os agudos precisam de um pouco mais de brilho sem abrir a versão mais detalhada de 15 bandas.

### Guia de aprimoramento do som
- Clareza de Vocais e Instrumentos:
  - Use a banda de 3.16kHz com Q moderado (1.0-2.0) para presença natural
  - Aplique cortes com Q estreito (4.0-8.0) apenas quando uma ressonância específica estiver incomodando
  - Adicione um toque suave de "air" com o High Shelf de 10kHz (+2 a +4dB)
- Controle de Qualidade dos Graves:
  - Molde a plenitude dos graves com o filtro peaking em 100Hz
  - Use um corte estreito se uma nota grave ou ressonância da sala se destacar demais
  - Crie uma extensão suave dos graves com prateleira baixa
- Ajuste Sonoro do Dia a Dia:
  - Use ajustes pequenos e largos para mudanças tonais naturais
  - Reduza aspereza, embolamento ou falta de brilho de ouvido
  - Compare com bypass com frequência para garantir que a música continue equilibrada

### Parâmetros
- **Cinco bandas ajustáveis**
  - Banda 1: 100Hz (Controle de Subgraves e Graves)
  - Banda 2: 316Hz (Definição dos Médios Baixos)
  - Banda 3: 1.0kHz (Presença dos Médios)
  - Banda 4: 3.2kHz (Detalhe dos Médios Superiores)
  - Banda 5: 10kHz (Extensão de Alta Frequência)
- **Controles por banda**
  - Center Frequency: Ajustável de 20Hz a 20kHz
  - Gain Range: ±20dB para filtros Peaking e Low/High Shelf
  - Q Factor: 0.1-10.0 para a maioria dos tipos de filtro; Low/High Shelf é limitado a 0.1-2.0
  - Q mais alto afeta uma faixa mais estreita; Q mais baixo soa mais suave e amplo
  - Para Low/High Pass, Band Pass, Notch e AllPass, Frequency e Q moldam o filtro; Gain não é usado
  - Múltiplos Tipos de Filtro:
    - Peaking: Ajuste simétrico de frequência
    - Low/High Pass: Inclinação de 12dB/octave
    - Low/High Shelf: Modelagem espectral suave
    - Band Pass: Isolamento focado de frequência
    - Notch: Remoção precisa de frequência
    - AllPass: Alinhamento de frequência com foco em fase

### Exibição visual
- Visualização de resposta de frequência em alta resolução
- Pontos de controle interativos com exibição precisa de parâmetros
- Atualização da curva em tempo real conforme os ajustes mudam
- Grade de frequência e ganho
- Leituras numéricas precisas para todos os parâmetros
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

## Band Pass Filter

Um filtro passa-banda de precisão que combina filtros passa-alta e passa-baixa para permitir que apenas frequências em uma faixa específica passem. Baseado no design de filtro Linkwitz-Riley para resposta de fase ideal e qualidade de som transparente.

### Guia de aprimoramento da audição
- Foco na Faixa Vocal:
  - Configure o HPF entre 100-300Hz e o LPF entre 4-8kHz para enfatizar a clareza vocal
  - Use inclinações moderadas (-24dB/oct) para um som natural
  - Ajuda a faixa vocal a ficar mais fácil de acompanhar em gravações cheias
- Crie Efeitos Especiais:
  - Configure faixas de frequência estreitas para efeitos de telefone, rádio ou megafone
  - Use inclinações mais íngremes (-36dB/oct ou superior) para filtragem mais dramática
  - Experimente diferentes faixas de frequência para sons criativos
- Limpe Faixas de Frequência Específicas:
  - Direcione frequências problemáticas com controle preciso
  - Use diferentes inclinações para seções passa-alta e passa-baixa conforme necessário
  - Perfeito para remover simultaneamente o ruído de baixa frequência e o ruído de alta frequência

### Parâmetros
- **HPF Frequency (Hz)** - Controla onde as frequências baixas são filtradas (10Hz a 40000Hz; o limite superior efetivo também depende da taxa de amostragem do áudio)
  - Valores mais baixos: Apenas as frequências mais baixas são removidas
  - Valores mais altos: Mais frequências baixas são removidas
  - Ajuste com base no conteúdo específico de baixa frequência que deseja eliminar
- **HPF Slope** - Controla quão agressivamente as frequências abaixo do corte são reduzidas
  - Off: Nenhuma filtragem aplicada
  - -12dB/oct: Filtragem suave (LR2 - Linkwitz-Riley de 2ª ordem)
  - -24dB/oct: Filtragem padrão (LR4 - Linkwitz-Riley de 4ª ordem)
  - -36dB/oct: Filtragem mais forte (LR6 - Linkwitz-Riley de 6ª ordem)
  - -48dB/oct: Filtragem muito forte (LR8 - Linkwitz-Riley de 8ª ordem)
- **LPF Frequency (Hz)** - Controla onde as frequências altas são filtradas (10Hz a 40000Hz; o limite superior efetivo também depende da taxa de amostragem do áudio)
  - Valores mais baixos: Mais frequências altas são removidas
  - Valores mais altos: Apenas as frequências mais altas são removidas
  - Ajuste com base no conteúdo específico de alta frequência que deseja eliminar
- **LPF Slope** - Controla quão agressivamente as frequências acima do corte são reduzidas
  - Off: Nenhuma filtragem aplicada
  - -12dB/oct: Filtragem suave (LR2 - Linkwitz-Riley de 2ª ordem)
  - -24dB/oct: Filtragem padrão (LR4 - Linkwitz-Riley de 4ª ordem)
  - -36dB/oct: Filtragem mais forte (LR6 - Linkwitz-Riley de 6ª ordem)
  - -48dB/oct: Filtragem muito forte (LR8 - Linkwitz-Riley de 8ª ordem)

### Exibição visual
- Gráfico de resposta de frequência em tempo real com escala logarítmica de frequência
- Visualização clara de ambas inclinações do filtro e pontos de corte
- Controles interativos para ajuste preciso
- Grade de frequência com marcadores em pontos de referência chave
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

## Comb Filter

Um filtro pente que adiciona caráter faseado, oco, metálico ou ressonante ao misturar o som com uma cópia atrasada muito curta. Use quando quiser uma faixa mais colorida, espacial ou experimental.

### Guia de aprimoramento da audição
- Adicione Coloração Sutil:
  - Comece com Feedforward, Feedback Gain por volta de 0.2-0.4 e Dry-Wet Mix por volta de 20-40%
  - Ajuste Fundamental Frequency até o tom oco ou faseado combinar com a música
  - Mantenha Feedback Gain baixo para um efeito mais suave, que se mistura ao som original
- Crie Ressonância e Efeitos de Eco:
  - Use Feedback ou Feedback Gain mais alto para ringing ou efeitos parecidos com eco
  - Experimente diferentes frequências fundamentais para um caráter tonal único
  - Use valores menores de Dry-Wet Mix se o efeito ficar evidente demais
- Cor Metálica Brilhante:
  - Experimente valores mais altos de Fundamental Frequency para picos e vales de comb mais brilhantes e mais espaçados
  - Use Feedback Gain positivo ou negativo para mudar o padrão de picos e vales
  - Combine com outros efeitos para escutas mais experimentais

### Parâmetros
- **Fundamental Frequency (Hz)** - Controla o tempo de delay e o espaçamento harmônico (20Hz a 20000Hz)
  - Valores mais baixos: Delays mais longos, picos e vales do comb mais próximos
  - Valores mais altos: Delays mais curtos, picos e vales do comb mais espaçados
- **Feedback Gain** - Controla a intensidade do efeito do filtro pente (-1.0 a 1.0)
  - Valores negativos: Cria padrões harmônicos inversos
  - Valores positivos: Cria padrões harmônicos de reforço
  - Zero: Sem efeito (apenas sinal seco)
  - Valores absolutos mais altos: Efeito mais pronunciado
- **Comb Type** - Controla a estrutura do filtro
  - Feedforward: Cria realce harmônico sem feedback
  - Feedback: Cria efeitos de ressonância e eco
- **Dry-Wet Mix** - Controla o equilíbrio entre o sinal processado e o original (0% a 100%)
  - 0%: Apenas sinal original
  - 50%: Mistura igual de sinal original e processado
  - 100%: Apenas sinal processado

### Detalhes Técnicos
- **Cálculo do Atraso**: Tempo de atraso = 1 / Frequência Fundamental
- **Resposta Harmônica**: Cria picos e vales regularmente espaçados com base na frequência fundamental
- **Coloração Espacial**: Pode lembrar reflexões curtas, coloração oca ou ressonância metálica
- **Visualização em Tempo Real**: Mostra a resposta de frequência com marcador de frequência fundamental

### Exibição visual
- Gráfico de resposta de frequência em tempo real com escala logarítmica de frequência
- Visualização clara de picos e vales do filtro pente
- Marcador de frequência fundamental mostrando o tempo de atraso
- Controles interativos para ajuste preciso
- Cálculo da distância de atraso em milímetros
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

## Earphone Cable Sim

Reproduz as pequenas mudanças de resposta em frequência que aparecem quando um fone de ouvido é alimentado por um amplificador por meio da resistência e da indutância reais do cabo, além de uma impedância de saída diferente de zero. Como a impedância de um fone varia conforme a frequência (ressonâncias do driver e indutância da bobina de voz), a impedância da fonte e do cabo gera mudanças de nível específicas para cada fone. Isso é útil como verificação prática: com cabos de construção e qualidade normais, impedância de saída comum no amplificador e fones que não tenham impedância anormalmente baixa nem outro comportamento incomum, a mudança audível causada por diferenças comuns entre cabos de fones de ouvido costuma ser pequena o bastante para ser desprezível. O efeito é mais forte em fones de baixa impedância com grandes picos de impedância e, em geral, é sutil com amplificadores modernos de baixa impedância de saída.

### Guia de aprimoramento da audição
- Avalie a interação com a impedância da fonte:
  - Aumente Output Z para simular amplificadores valvulados ou saídas de fone de alta impedância
  - Compare com bypass para ouvir como os graves e as regiões dos picos de impedância mudam
- Explore o comportamento de fones com múltiplos drivers:
  - Ative Resonances adicionais para modelar fones de armadura balanceada ou híbridos com vários picos de impedância
  - Picos de impedância maiores combinados com maior impedância da fonte criam coloração mais forte
- Simule resistência e indutância do cabo:
  - Aumente Cable R para simular cabos mais longos ou mais finos, com maior resistência DC
  - Aumente Cable L para simular cabos de maior indutância; o efeito aparece principalmente no extremo agudo
  - Cable R se soma à resistência total em série, portanto pode intensificar a interação em toda a faixa
- Verifique a audibilidade de cabos normais:
  - Use valores realistas de Cable R e Cable L e compare com bypass para estimar quão pequenas são as diferenças comuns entre cabos
  - Se a mudança só fica evidente com valores extremos de Output Z ou Cable R, ou com Base Z muito baixa, a comparação sugere que cabos normais dificilmente terão relevância audível com esse fone e esse amplificador

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para comparar configurações completas de fonte e cabo.

- **High Impedance Source** - Uma fonte com alta impedância de saída alimentando um fone de ouvido de baixa impedância.
- **Long Thin Cable** - Maior resistência e indutância do cabo.
- **Vintage Portable Out** - Uma saída portátil de maior impedância e um fone de ouvido de 32 Ω.

### Parâmetros
- **Output Z (Ω)** - Impedância de saída do amplificador (0 a 20). Valores abaixo de 1Ω são típicos de amplificadores modernos; valores mais altos tornam a coloração relacionada à impedância mais forte.
- **Cable R (Ω)** - Resistência DC do cabo (0 a 2). Valores mais altos representam cabos mais longos ou mais finos e se somam à resistência total em série.
- **Cable L (µH)** - Indutância do cabo (0 a 5). Afeta principalmente a resposta no extremo agudo, especialmente com fones de baixa impedância.
- **Voice Coil L (mH)** - Indutância da bobina de voz do fone (0,01 a 2). Eleva a impedância da carga em direção às altas frequências e altera a interação nessa região.
- **Base Z (Ω)** - Impedância nominal do fone nas baixas frequências (4 a 64). Valores mais baixos tornam a impedância da fonte e do cabo mais influente.
- **Resonances (até 5)** - Cada uma modela um pico de impedância do driver. A primeira fica ativada por padrão; as demais vêm pré-ajustadas para ressonâncias típicas de driver e podem ser ligadas ou desligadas.
  - **Enable** - Liga ou desliga cada ressonância
  - **Freq (Hz)** - Frequência de ressonância (20 a 20000)
  - **Q** - Quão estreito e acentuado é o pico de impedância (0,5 a 10)
  - **Peak Z (Ω)** - Impedância no pico de ressonância (16 a 116)

### Detalhes Técnicos
- **Modelo Físico**: Calcula `H(f) = Zload / (Zsource + Zload)`, em que `Zsource` é a impedância de saída somada à resistência/indutância do cabo, e `Zload` é a impedância do fone (impedância base, indutância da bobina de voz e picos de ressonância).
- **Implementação**: A função de transferência é fatorada e convertida em uma cascata matched-Z de filtros biquad, oferecendo latência zero e comportamento de fase mínima comparável ao dos outros plugins de EQ.
- **Normalização**: A resposta é normalizada para média de potência de 0 dB (20Hz a 20kHz), para que ligar ou desligar o efeito não mude o volume geral.

### Exibição visual
- Gráfico em tempo real da resposta do filtro implementado, em escala logarítmica de frequência
- Os rótulos da grade cobrem 20Hz a 20kHz; a curva exibida se estende por toda a faixa do gráfico, de 10Hz a 40kHz
- Curva de resposta verde sobre uma grade escura, com eixo em dB ajustado automaticamente em torno da referência normalizada de 0dB
- Desvios maiores na curva indicam onde o modelo altera mais o nível de reprodução
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

## Group Delay EQ

O Group Delay EQ é a contraparte de um equalizador comum: em vez de mudar o volume de cada banda, ele muda **quando** cada banda chega. Quinze deslizadores definem o atraso de cada faixa de frequências e o plugin constrói um único filtro FIR projetado para realizar esses atrasos com uma resposta de magnitude plana. Uma resposta plana é o objetivo do projeto, não uma garantia: um número finito de Taps aproxima o alvo ideal, e ajustes de atraso grandes ou que mudam rapidamente entre as bandas podem gerar uma ondulação de magnitude mensurável. Use-o para compensar erros de tempo de uma caixa acústica ou de um divisor de frequências, ou para conferir você mesmo quanto de distorção de fase o seu sistema e os seus ouvidos realmente revelam. O plugin requer o motor WASM DSP; sem ele, o sinal passa sem alterações.

Para o som, só importam as diferenças entre bandas. Um filtro que atrasa todas as bandas igualmente é apenas um delay, então o plugin mantém um atraso interno fixo e deixa você adiantar ou atrasar cada banda em torno dele. Enquanto todos os deslizadores estiverem em 0 ms, o plugin é totalmente transparente e não acrescenta latência.

### Guia de aprimoramento do som

- **Tempo entre caixas e subwoofer**: Se o grave chega atrasado em relação ao restante da música, atrase as bandas acima do corte na mesma medida até o gráfico ficar plano nessa região. As correções típicas ficam entre 2 e 10 ms e são mais fáceis de julgar com bumbo e baixo.
- **Caixas bass-reflex e modos da sala**: Uma caixa com duto acrescenta atraso de grupo perto da frequência de sintonia. Abaixe a banda grave afetada, ou levante todas as outras, para deixar a curva mais plana. Pequenas diferenças residuais abaixo de 50 Hz são normais.
- **Teste de audição da distorção de fase**: Coloque uma banda em +10 ms, compare com o efeito desligado e depois reduza o valor até não ouvir mais diferença. Só interprete o resultado como uma comparação de fase quando o Ripple na linha de status estiver suficientemente baixo e a curva verde Realized coincidir de perto com a curva cinza Target. Caso contrário, mudanças de magnitude ou um atraso realizado com pouca precisão também podem afetar o que você ouve.
- **Trabalhe banda por banda**: Mova um deslizador de cada vez e ouça. Mudanças apenas de fase são sutis na maior parte do material e aparecem principalmente em transientes como bateria, cordas dedilhadas e ataques de piano.
- **Observe as duas curvas**: Se a curva verde deixa de acompanhar a cinza, o ajuste atual de Taps não consegue realizar aquela forma. Aumente Taps ou reduza a diferença entre bandas vizinhas.

### Parâmetros

- **Taps** - Comprimento do FIR: 4096, 8192, 16384 ou 32768. As frequências baixas exigem um filtro longo: a 96 kHz, 16384 taps acompanham grandes diferenças de atraso até cerca de 60 Hz, enquanto ajustes menores perdem precisão primeiro no grave. Taps também define quanto atraso o filtro consegue conter e, portanto, o alcance dos deslizadores. Mais taps significam mais latência e mais processamento.
- **Latency** - Latência inicial do motor de convolução: 0, 128, 256, 512 ou 1024 samples. Valores menores reduzem o atraso, mas exigem mais processamento.
- **Deslizadores de banda (25 Hz a 16 kHz)** - Quinze deslizadores definem o atraso de grupo de cada banda. Valores positivos fazem a faixa chegar mais tarde; negativos, mais cedo. A faixa de ajuste cobre todo o atraso que o filtro consegue conter: a 96 kHz são ±18,6 ms com 4096 taps e ±149,3 ms com 32768 taps. A banda mais alta realiza esses valores por completo, enquanto as bandas graves precisam de mais taps para acompanhar um ajuste grande; o gráfico mostra até onde cada uma chega. Os valores são interpolados suavemente ao longo da frequência, de modo que bandas vizinhas sempre se combinam.
- **Ângulo de fase** - Abaixo de cada valor em milissegundos, o deslizador mostra o mesmo atraso como rotação de fase na frequência central da banda. Acima de uma volta completa a leitura é dividida em ciclos inteiros e no ângulo restante, portanto `+2c180°` significa dois ciclos completos mais meia volta.
- **Reset** - Dê um duplo clique em um deslizador para devolver aquela banda a 0 ms. O botão Reset do gráfico redefine todas as bandas de uma vez.

A latência total é o valor de Latency mais metade dos Taps. Ela não muda enquanto você move os deslizadores, portanto apenas alterar Taps ou Latency muda o atraso de toda a cadeia.

### Exibição visual

- A curva cinza é o alvo: o atraso solicitado, interpolado em um eixo logarítmico de 20 Hz a 20 kHz. O eixo de atraso se redimensiona conforme os ajustes atuais, a partir de ±5 ms.
- A curva verde é o que o filtro projetado realmente faz. Onde as duas coincidem, o ajuste é realizado por completo; onde se separam, o filtro não consegue seguir o pedido com os Taps atuais.
- A linha de status mostra a latência total em samples e milissegundos e a ondulação de magnitude do filtro. A ondulação mede quanto a resposta de magnitude realizada se afasta do objetivo de projeto plano: valores menores ficam mais perto do objetivo, e 0,3 dB é o limite do aviso de precisão.
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

## Group Delay PEQ

O Group Delay PEQ é a versão paramétrica do Group Delay EQ. Em vez de quinze deslizadores fixos, ele oferece cinco bandas de posicionamento livre, cada uma com sua própria forma, frequência, atraso e Q. As bandas ativas são somadas em uma única curva de atraso alvo, e o plugin constrói um único filtro FIR projetado para realizar essa curva com uma resposta de magnitude plana. Uma resposta plana é o objetivo do projeto, não uma garantia: um número finito de Taps aproxima o alvo ideal, e atrasos grandes ou formas muito estreitas podem gerar uma ondulação de magnitude mensurável. Use-o quando o erro de tempo que você quer corrigir tiver uma forma conhecida — um divisor de frequências, uma caixa bass-reflex, um passa-altas acentuado ou uma ressonância —, porque uma ou duas bandas conseguem reproduzir essa forma diretamente. O plugin requer o motor WASM DSP; sem ele, o sinal passa sem alterações.

Para o som, só importam as diferenças entre frequências. Um filtro que atrasa tudo igualmente é apenas um delay, então o plugin mantém um atraso interno fixo e deixa você adiantar ou atrasar cada região em torno dele. Enquanto todas as bandas ativas estiverem em 0 ms, o plugin é totalmente transparente e não acrescenta latência. Como a resposta de magnitude permanece plana, o efeito é sutil: ele muda o tempo, não o timbre, e aparece principalmente em transientes como bateria, cordas dedilhadas e ataques de piano.

### Guia de aprimoramento do som

- **Copie um filtro conhecido com Filter GD**: Uma seção analógica de segunda ordem tem uma elevação de atraso de grupo cuja forma é definida pela frequência de corte e pelo Q. Coloque esses dois valores em Freq e Q e ajuste Delay para a altura medida da elevação com sinal negativo: a banda a cancela. Um subwoofer de caixa selada ou uma soma LR2 precisam de uma banda; um alinhamento bass-reflex de quarta ordem ou uma soma LR4 são cobertos por uma ou duas.
- **Alinhe uma região inteira com os shelves**: Quando uma parte do espectro chega atrasada como um todo, e não em torno de uma única frequência, use Low Shelf ou High Shelf com Q de 2 a 4. Isso produz um degrau de aproximadamente uma oitava de largura, de modo que tudo de um lado da frequência de corte é deslocado na mesma medida.
- **Ajuste o restante com Peak**: Peak é um sino suave cuja largura a meia altura acompanha o Q exatamente como em um equalizador paramétrico. Use-o para as sobras que nenhuma forma de filtro específica explica.
- **Seja realista com os cortes de agudos**: Um divisor LR4 em 3 kHz tem um pico de atraso de grupo de apenas cerca de 0,2 ms. Corrigi-lo fica abaixo do limiar de audibilidade, então o ganho ali é pequeno; os erros de tempo no grave valem muito mais.
- **Graves e Q alto exigem filtros longos**: Corrigir uma ressonância grave com Q alto, em torno de Q 8, exige 32768 taps a 96 kHz. Observe as duas curvas: se a verde não conseguir acompanhar a cinza, aumente Taps ou reduza Q.
- **Trabalhe banda por banda**: Altere uma banda de cada vez e ouça. Mudanças apenas de fase são sutis na maior parte do material, e comparar com o efeito desligado diz mais do que olhar o gráfico.

### Parâmetros

- **Type** - Seleciona a forma de atraso da banda. Os quatro tipos são descritos pelos mesmos três valores, Freq, Delay e Q, e Delay é sempre o valor extremo da curva da própria banda.
  - **Peak** - Um sino centrado em Freq cuja largura a meia altura corresponde à largura de banda definida pelo Q. Ele nunca ultrapassa o alvo, o que o torna a escolha natural para correções de forma livre e para ajustar resíduos.
  - **Low Shelf** - Um degrau suave que mantém Delay abaixo de Freq, passa pela metade de Delay em Freq e cai a zero acima dela. Q define a inclinação da transição: com Q 1 ela coincide com a transição de atraso de grupo de um allpass de primeira ordem, enquanto Q de 2 a 4 dá o degrau prático de cerca de uma oitava usado no alinhamento limitado em banda.
  - **High Shelf** - A imagem espelhada de Low Shelf e seu complemento: com a mesma Freq e o mesmo Q, as duas formas somam um Delay constante.
  - **Filter GD** - Soma ou subtrai, sem alterações, a forma do atraso de grupo de um estágio de filtro analógico (passa-altas, divisor de frequências ou ressonância). Coloque em Freq e Q a frequência de corte e o Q do filtro que você está corrigindo, e em Delay a altura da elevação na curva de atraso de grupo medida, com valor negativo para cancelá-la.
- **Freq** - Define a frequência da banda entre 20 Hz e 20 kHz. Perto de 18 a 20 kHz o alvo é atenuado suavemente até zero, então uma banda posicionada perto do topo da faixa tem efeito reduzido.
- **Delay** - Define em milissegundos o valor extremo da curva da própria banda. Valores positivos fazem aquela região chegar mais tarde; negativos, mais cedo. A faixa cobre todo o atraso que o filtro consegue conter: a 96 kHz são ±18,6 ms com 4096 taps e ±149,3 ms com 32768 taps. Alterar Taps ou a taxa de amostragem limita os valores salvos ao novo máximo.
- **Q** - Define a largura ou a inclinação da forma entre 0,1 e 100 em um controle deslizante logarítmico e é usado por todos os Type. As faixas úteis diferem: de 0,25 a 16 para Low Shelf e High Shelf e de 0,1 a 10 para Filter GD. Na prática, os shelves são usados com Q de 2 a 4 e o Filter GD com Q de 0,5 a 8 — 0,5 corresponde a um allpass de primeira ordem ou a uma soma LR2, 0,7071 a um alinhamento Butterworth ou a uma soma LR4, e 8 a uma ressonância estreita. Ajustes fora dessas faixas também são aceitos; a linha de status avisa quando os Taps atuais não conseguem realizá-los.
- **Enabled** - Liga ou desliga cada uma das cinco bandas. Bandas desativadas não contribuem para a curva alvo e aparecem esmaecidas no gráfico.
- **Taps** - Comprimento do FIR: 4096, 8192, 16384 ou 32768. As frequências baixas exigem um filtro longo, e as formas de Q alto também. Taps define ainda quanto atraso o filtro consegue conter e, portanto, o alcance de Delay. Mais taps significam mais latência e mais processamento.
- **Latency** - Latência inicial do motor de convolução: 0, 128, 256, 512 ou 1024 samples. Valores menores reduzem o atraso, mas exigem mais processamento.

A latência total é o valor de Latency mais metade dos Taps. Ela não muda enquanto você ajusta as bandas, portanto apenas alterar Taps ou Latency muda o atraso de toda a cadeia.

### Exibição visual

- A curva cinza é o alvo: a soma das formas das bandas ativas, desenhada em um eixo logarítmico de frequência. O eixo de atraso se redimensiona conforme os ajustes atuais, a partir de ±5 ms.
- A curva verde é o que o filtro projetado realmente faz. Onde as duas coincidem, o ajuste é realizado por completo; onde se separam, o filtro não consegue seguir o pedido com os Taps atuais.
- Os marcadores numerados correspondem às cinco bandas. Arraste na horizontal para alterar Freq e na vertical para alterar Delay. O marcador fica sobre a curva apenas com Peak: um shelf passa pela metade de Delay em Freq, e o Filter GD atinge seu valor extremo abaixo de Freq: logo abaixo com Q alto e cada vez mais abaixo conforme Q diminui, até que com Q de cerca de 0,577 ou menos o valor extremo fica na extremidade grave do gráfico.
- A linha de status mostra a latência total em samples e milissegundos e a ondulação de magnitude do filtro. A ondulação mede quanto a resposta de magnitude realizada se afasta do objetivo de projeto plano: valores menores ficam mais perto do objetivo, e 0,3 dB é o limite do aviso de precisão.
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

## Hi Pass Filter

Um filtro passa-alta de precisão que remove frequências baixas indesejadas, preservando a clareza das frequências mais altas. Baseado no design de filtro Linkwitz-Riley para resposta de fase ideal e qualidade de som transparente.

### Guia de aprimoramento da audição
- Remova o ruído indesejado:
  - Defina a frequência entre 20-40Hz para eliminar ruídos sub-sônicos
  - Use inclinações mais acentuadas (-24dB/oct ou mais) para graves mais limpos
  - Ideal para gravações em vinil ou performances ao vivo com vibrações de palco
- Limpe músicas com excesso de graves:
  - Defina a frequência entre 60-100Hz para uma resposta de graves mais ajustada
  - Use inclinações moderadas (-12dB/oct a -24dB/oct) para uma transição natural
  - Ajuda a prevenir sobrecarga dos alto-falantes e melhora a clareza
- Crie efeitos especiais:
  - Defina a frequência entre 200-500Hz para um efeito de voz mais fino, com menos graves
  - Use inclinações acentuadas (-48dB/oct ou mais) para uma filtragem dramática
  - Para um efeito de voz semelhante a telefone, combine com Lo Pass Filter em torno de 3-4kHz

### Parâmetros
- **Frequency (Hz)** - Controla onde as frequências baixas são filtradas (10Hz a 40000Hz; o limite superior efetivo também depende da taxa de amostragem do áudio)
  - Valores mais baixos: Apenas as frequências mais baixas são removidas
  - Valores mais altos: Removidas mais frequências baixas
  - Ajuste com base no conteúdo específico de baixa frequência que deseja eliminar
- **Slope** - Controla quão agressivamente as frequências abaixo do corte são reduzidas
  - Off: Nenhum filtro aplicado
  - -12dB/oct: Filtragem suave (LR2 - Linkwitz-Riley de 2ª ordem)
  - -24dB/oct: Filtragem padrão (LR4 - Linkwitz-Riley de 4ª ordem)
  - -36dB/oct: Filtragem mais forte (LR6 - Linkwitz-Riley de 6ª ordem)
  - -48dB/oct: Filtragem muito forte (LR8 - Linkwitz-Riley de 8ª ordem)
  - -60dB/oct a -96dB/oct: Filtragem extremamente acentuada para aplicações especiais

### Exibição visual
- Gráfico de resposta de frequência em tempo real com escala logarítmica
- Visualização clara da inclinação do filtro e do ponto de corte
- Controles interativos para ajuste preciso
- Grade de frequência com marcadores em pontos de referência chave
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

## Lo Pass Filter

Um filtro passa-baixa de precisão que remove frequências altas indesejadas, preservando o calor e o corpo das frequências mais baixas. Baseado no design de filtro Linkwitz-Riley para resposta de fase ideal e qualidade de som transparente.

### Guia de aprimoramento da audição
- Reduza a aspereza e a sibilância:
  - Defina a frequência entre 8-12kHz para domar gravações ásperas
  - Use inclinações moderadas (-12dB/oct a -24dB/oct) para um som natural
  - Ajuda a reduzir a fadiga auditiva em gravações brilhantes
- Aqueça gravações digitais:
  - Defina a frequência entre 12-16kHz para reduzir o "edge" digital
  - Use inclinações suaves (-12dB/oct) para um efeito sutil de aquecimento
  - Cria um caráter sonoro mais parecido com o analógico
- Crie efeitos especiais:
  - Defina a frequência entre 1-3kHz com uma inclinação acentuada para um caráter abafado e estreito
  - Use inclinações acentuadas (-48dB/oct ou mais) para uma filtragem dramática
  - Para um efeito de rádio vintage, combine com Hi Pass Filter para remover frequências baixas também
- Controle ruídos e chiados:
  - Defina a frequência logo acima do conteúdo musical (tipicamente 14-18kHz)
  - Use inclinações mais acentuadas (-36dB/oct ou mais) para um controle eficaz do ruído
  - Reduz o chiado de fitas ou ruídos de fundo, preservando a maior parte do conteúdo musical

### Parâmetros
- **Frequency (Hz)** - Controla onde as frequências altas são filtradas (10Hz a 40000Hz; o limite superior efetivo também depende da taxa de amostragem do áudio)
  - Valores mais baixos: Remove mais frequências altas
  - Valores mais altos: Apenas as frequências mais altas são removidas
  - Ajuste com base no conteúdo específico de alta frequência que deseja eliminar
- **Slope** - Controla quão agressivamente as frequências acima do corte são reduzidas
  - Off: Nenhum filtro aplicado
  - -12dB/oct: Filtragem suave (LR2 - Linkwitz-Riley de 2ª ordem)
  - -24dB/oct: Filtragem padrão (LR4 - Linkwitz-Riley de 4ª ordem)
  - -36dB/oct: Filtragem mais forte (LR6 - Linkwitz-Riley de 6ª ordem)
  - -48dB/oct: Filtragem muito forte (LR8 - Linkwitz-Riley de 8ª ordem)
  - -60dB/oct a -96dB/oct: Filtragem extremamente acentuada para aplicações especiais

### Exibição visual
- Gráfico de resposta de frequência em tempo real com escala logarítmica
- Visualização clara da inclinação do filtro e do ponto de corte
- Controles interativos para ajuste preciso
- Grade de frequência com marcadores em pontos de referência chave
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

## Loudness Equalizer

Um equalizador especializado que vincula o ajuste de volume à correção do equilíbrio de frequências. Defina Average SPL como o nível médio estimado de pressão sonora quando Relative Volume estiver em 0dB e use Relative Volume para as alterações normais de volume. A correção aumenta automaticamente quando o volume é reduzido e diminui quando ele é elevado.

### Guia de aprimoramento da audição
- Audição em Baixo Volume:
  - Realça frequências de graves e agudos
  - Mantém o equilíbrio musical em níveis baixos
  - Compensa as características da audição humana
- Configuração Average SPL:
  - Defina como o nível médio estimado de pressão sonora com Relative Volume em 0dB
  - É um valor de referência manual; o plugin não mede o SPL
- Ajuste de Relative Volume:
  - Valores negativos reduzem o nível de saída e aumentam a correção
  - Valores positivos elevam o nível de saída e reduzem a correção
  - A correção do EQ é calculada com `Average SPL + Relative Volume` e fica limitada à faixa de correção de 60dB a 85dB
- Equilíbrio de Frequência:
  - Prateleira baixa para realce dos graves (100-300Hz)
  - Prateleira alta para realce dos agudos (3-6kHz)
  - Transição suave entre as faixas de frequência

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para começar com uma curva completa de compensação de loudness.

- **Late Night Listening** - Uma compensação mais forte para níveis de audição baixos.
- **Quiet Background** - Uma curva de compensação moderada para o uso cotidiano.
- **Near Reference Level** - Uma compensação mínima perto de um nível de referência mais alto.

### Parâmetros
- **Average SPL** - Nível médio estimado de pressão sonora com Relative Volume em 0dB (60dB a 96dB)
  - Ajuste manualmente de acordo com o nível médio na posição de audição
  - Valores acima de 85dB permitem definir uma referência mais alta; a correção do EQ permanece desativada até `Average SPL + Relative Volume` ficar abaixo de 85dB
- **Relative Volume** - Ajuste de volume relativo a Average SPL (-30dB a +12dB)
  - 0dB: Nível de saída correspondente a Average SPL
  - Valores negativos: Menor volume e maior correção de loudness
  - Valores positivos: Maior volume e menor correção de loudness
  - Valores positivos podem causar clipping se a entrada ou o ganho do EQ já estiverem altos
- **Controles de Baixa Frequência**
  - Frequency: Centro de realce dos graves (100Hz a 300Hz)
  - Gain: Aumento máximo dos graves (0dB a 15dB)
  - Q: Forma do realce dos graves (0.5 a 1.0)
- **Controles de Alta Frequência**
  - Frequency: Centro de realce dos agudos (3kHz a 6kHz)
  - Gain: Aumento máximo dos agudos (0dB a 15dB)
  - Q: Forma do realce dos agudos (0.5 a 1.0)

### Exibição visual
- Gráfico de resposta do EQ em tempo real
- Controles interativos de parâmetros
- Curva de correção dependente do volume; a alteração uniforme de nível causada por Relative Volume não aparece no gráfico
- Leituras numéricas precisas
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

## Narrow Range

Uma ferramenta que permite focar em partes específicas da música, filtrando frequências indesejadas. Útil para criar efeitos sonoros especiais ou remover sons indesejados.

### Guia de aprimoramento da audição
- Crie efeitos sonoros únicos:
  - Efeito de "voz de telefone"
  - Som de "rádio antigo"
  - Efeito "subaquático"
- Foque em uma faixa de frequência:
  - Deixe partes com muito grave mais fáceis de ouvir
  - Foque na faixa vocal
  - Estreite o som para a faixa onde vocais ou instrumentos são mais perceptíveis
- Remova sons indesejados:
  - Reduza o ruído de baixa frequência
  - Corte o chiado excessivo de alta frequência
  - Foque na faixa que você quer ouvir com mais clareza

### Parâmetros
- **HPF Frequency** - Controla onde os sons baixos começam a ser reduzidos (20Hz a 4000Hz)
  - Valores mais altos: Remove mais graves
  - Valores mais baixos: Preserva mais graves
  - Comece com valores baixos e ajuste conforme o gosto
- **HPF Slope** - Quão rapidamente os sons baixos são reduzidos (0 a -48 dB/octave)
  - 0dB: Sem redução (off)
  - -6dB a -48dB: Redução progressivamente mais forte em incrementos de 6dB
- **LPF Frequency** - Controla onde os sons altos começam a ser reduzidos (200Hz a 40000Hz)
  - Valores mais baixos: Remove mais agudos
  - Valores mais altos: Preserva mais agudos
  - Comece com valores altos e ajuste para baixo conforme necessário
- **LPF Slope** - Quão rapidamente os sons altos são reduzidos (0 a -48 dB/octave)
  - 0dB: Sem redução (off)
  - -6dB a -48dB: Redução progressivamente mais forte em incrementos de 6dB

### Exibição visual
- Gráfico claro mostrando a resposta de frequência
- Controles de frequência fáceis de ajustar
- Menus suspensos simples para seleção de inclinação
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

## Room EQ

O Room EQ cria filtros de correção FIR a partir de medições de resposta em frequência salvas pelo EffeTune. Por padrão, ele projeta um único filtro compartilhado e o aplica a todos os canais direcionados ao plugin; também é possível atribuir uma medição salva diferente a canais individuais, mantendo os demais ajustes de correção compartilhados em toda a instância. O filtro calcula a média de todos os pontos da medição selecionada, suaviza a curva e reduz picos e vales dentro da faixa de frequências escolhida. Use-o quando a interação entre as caixas acústicas e a sala causar picos repetíveis ou um desequilíbrio tonal amplo na sua posição de audição. Além da correção de magnitude com fase mínima ou fase linear, o modo **Correction** pode corrigir o excesso de fase medido no som direto (**Phase Correction**) e na reverberação da sala (**Reverb Correction**). O Room EQ requer o mecanismo DSP WASM; sem ele, o sinal passa inalterado.

### Guia de aprimoramento do som

- **Medição em vários pontos**: Meça a caixa acústica ou o grupo de canais em várias posições de microfone próximas ao seu lugar de audição e selecione essa medição salva, para que a correção não fique ajustada demais a uma única posição do microfone.
- **Ajustes iniciais**: Comece com **Phase: Minimum**, **Smoothing: 0.17 oct**, **Correction Low: 80 Hz**, **Correction High: 16000 Hz**, **Max Boost: 6 dB** e **Level Correction: 100%**. Ligue e desligue o efeito para confirmar que o equilíbrio tonal fica mais uniforme sem soar magro ou áspero.
- **Não exagere no reforço dos vales**: Se o filtro tentar preencher cancelamentos acústicos estreitos, aumente **Smoothing** ou reduza **Max Boost** (0 dB desativa os reforços automáticos e mantém os cortes de picos).
- **Dose a intensidade da correção**: Reduza **Level Correction** se 100% parecer forte demais (com 50%, um reforço de +6 dB passa a +3 dB e um corte de −8 dB passa a −4 dB).
- **Só a faixa confiável**: Mantenha **Correction Low** e **Correction High** dentro da faixa que suas caixas e o microfone de medição reproduzem com confiabilidade; corrigir fora dela torna o resultado menos preciso.
- **Moldagem do alvo**: Depois de controlar os picos da sala, use o **Additional EQ** (incorporado diretamente ao filtro FIR) para preferências tonais suaves, como um low shelf amplo de +2 dB em torno de 100 Hz.
- **Correção de excesso de fase e de reverberação**: Escolha **Phase: Minimum** para a menor latência ou **Phase: Correction** para alinhar também o excesso de fase. Comece com **Reference Point: Consensus (all points)**, o **Direct Window** padrão e **Phase Correction: 100%**. Ative **Low-frequency Phase Extension** somente se quiser corrigir o excesso de fase abaixo de **Phase Low**, e desative-o se o tempo dos graves ficar menos consistente entre as posições de audição. Aumente **Reverb Correction** aos poucos com **Reverb Max Freq: 250 Hz** para neutralizar a reverberação de baixa frequência em toda a área de audição; aumentar **Reverb Max Freq** torna o resultado uma otimização apenas para a posição medida.
- **Atraso manual**: O Room EQ não calcula o alinhamento pela distância das caixas. O **Delay** se aplica a todos os canais da instância; use instâncias separadas do Room EQ se grupos de canais diferentes precisarem de atrasos manuais diferentes.

> **Compartilhar medições entre dispositivos**: Predefinições e URLs guardam o nome e o ID da medição, não os dados acústicos. Para levar uma medição a outro dispositivo, ative **Incluir respostas ao impulso nas exportações JSON de medições** na ferramenta de medição antes de exportar (o padrão; pode deixar o arquivo dezenas de megabytes maior) e importe o arquivo JSON no dispositivo de destino. Se a medição selecionada não for encontrada, o Room EQ mostra um aviso e deixa o sinal passar sem correção.

### Parâmetros

- **Measurement** - Seleciona a medição salva compartilhada (mostra o nome, o número de pontos e `IR` quando há dados de resposta ao impulso). Clique em **Refresh measurements** depois de adicionar ou editar medições.
- **Measurement ChN** - Substituição opcional da medição para cada canal de barramento direcionado. Deixe em **(Shared)** para usar a **Measurement** compartilhada.
- **Delay** (0 a 20 ms) - Atraso manual aplicado a todos os canais direcionados; não entra na latência de processamento informada.
- **Phase** - Seleciona o comportamento de fase do FIR:
  - **Minimum**: Correção de magnitude com fase mínima e a menor latência.
  - **Linear**: Correção de magnitude com fase linear (acrescenta `Taps / 2` samples de atraso).
  - **Correction**: Correção de magnitude com fase mínima mais correção do excesso de fase do som direto (**Phase Correction** dentro do **Direct Window**) e, opcionalmente, do decaimento da sala (**Reverb Correction** dentro do **Reverb Window**). Acrescenta `Taps / 2` samples de atraso e requer dados de resposta ao impulso (`IR`). **Phase Smoothing**, **Phase Low**, **Low-frequency Phase Extension**, **Phase Correction**, os quatro ajustes de Reverb e **Reference Point** só funcionam neste modo; em Minimum e Linear ficam desativados e conservam seus valores.
- **Taps** (8192, 16384, 32768, 65536 ou 131072) - Comprimento do filtro FIR. Valores maiores melhoram a resolução nos graves, ao custo de memória, tempo de projeto e atraso nos modos Linear/Correction.
- **Latency** (0, 128, 256, 512 ou 1024 samples) - Latência inicial da convolução. Valores menores reduzem o atraso, mas aumentam a carga de processamento.
- **Smoothing** (0.02 a 1.00 oct) - Suavização gaussiana em frequência para a correção de magnitude. Valores maiores produzem uma correção mais ampla e conservadora; valores menores acompanham variações mais finas da resposta.
- **Phase Smoothing** (0.02 a 1.00 oct, ou **Auto**) - Suavização gaussiana da correção do excesso de fase do som direto no modo Correction (acompanha **Smoothing** quando **Auto** está marcado).
- **Correction Low / Correction High** - Limites inferior e superior de frequência da correção automática.
- **Direct Window** (1 a 50 ms) - Janela de tempo após o início do som analisada para a correção de fase do som direto. Uma janela mais longa reduz o **Phase Low** automático, mas inclui mais reflexões da sala.
- **Phase Low** (20 a 20000 Hz, ou **Auto**) - Limite inferior de frequência da correção de fase do som direto com janela fixa (por padrão, o maior entre **Correction Low** e a frequência em que três ciclos cabem dentro do **Direct Window**; por exemplo, 500 Hz com 6 ms). Com **Low-frequency Phase Extension** ativado, ele passa a marcar onde a janela fixa dá lugar às janelas mais longas de baixa frequência.
- **Low-frequency Phase Extension** (desativado por padrão) - Estende a correção do excesso de fase para baixo de **Phase Low**, em direção a **Correction Low**, usando janelas dependentes da frequência cada vez mais longas.
- **Max Boost** (0 a 18 dB) - Limita os reforços da correção automática antes da suavização, sem limitar os cortes nem os reforços intencionais do **Additional EQ**.
- **Level Correction** (0% a 100%) - Dimensiona linearmente, em dB, a correção automática de magnitude. Em 0%, só a correção automática para; **Phase Correction**, **Additional EQ**, **Delay** e **Gain** continuam ativos.
- **Phase Correction** (0% a 100%) - Dimensiona a correção do excesso de fase do som direto no modo Correction, independentemente do **Reverb Correction**.
- **Reverb Correction** (0% a 100%; padrão 0%) - Dimensiona a correção do excesso de fase da reverberação posterior da sala, analisada dentro do **Reverb Window** até **Reverb Max Freq**. Não altera a correção de magnitude.
- **Reverb Window** (20 a 1000 ms) - Janela de tempo após o início do som analisada pelo **Reverb Correction**. Se não for mais longa que o **Direct Window** (ou se a medição for curta demais), a correção de reverberação é ignorada com um aviso, e o restante do filtro continua ativo.
- **Reverb Max Freq** (20 a 20000 Hz; padrão 250 Hz) - Limite superior de frequência do **Reverb Correction**, limitado por **Correction High** (mantê-lo em torno de 250 Hz concentra a correção no decaimento de baixa frequência da sala, que se comporta de forma consistente entre lugares próximos).
- **Reverb Smoothing** (0.02 a 1.00 oct) - Suavização gaussiana aplicada ao atraso do excesso de fase da reverberação.
- **Reference Point** - Seleciona **Consensus (all points)** (média dos pontos de medição ponderada pela confiabilidade) ou um único ponto de medição para a análise do excesso de fase. Se o ponto selecionado for removido, volta para Consensus.
- **Additional EQ (folded into FIR)** - Cinco bandas paramétricas para moldar o alvo (Peak, Low shelf, High shelf; 20 Hz–20 kHz, ±20 dB, Q 0.1–10, até 2 nos shelves), incorporadas diretamente ao filtro FIR. Sua fase é zero no modo Linear e mínima nos modos Minimum e Correction.
- **Gain** (-12 a +12 dB) - Ajuste do nível de saída.

### Exibição visual

- **Graph**: Alterna entre **Frequency** (medição suavizada em cinza-claro, correção automática em verde-claro, correção combinada com o Additional EQ em verde vivo e resposta corrigida estimada em branco, que é uma prévia calculada e não uma nova medição), **Phase** (−180° a +180° antes e depois do FIR), **Min Group Delay**, **Excess Group Delay** e **Impulse** (forma de onda normalizada antes e depois do FIR, de 2 ms antes do início medido até o maior valor entre 5 ms, o **Direct Window** e, quando o **Reverb Correction** está acima de 0%, o **Reverb Window**, com limite de 50 ms). Nas visualizações Phase, de atraso de grupo e Impulse, a linha cinza **Before** é a resposta antes da correção, e a linha verde **After**, o resultado calculado depois do FIR. Duas linhas verticais brancas pontilhadas marcam **Correction Low** e **Correction High**.
- Na visualização Frequency, as curvas cinza e branca são deslocadas para que o nível-alvo da correção automática completa (100%) fique em 0 dB; os desvios que restam na curva branca vêm de limites como **Max Boost** ou um **Level Correction** abaixo de 100%, ou da moldagem intencional do **Additional EQ**.
- As visualizações Phase, de atraso de grupo e Impulse removem o início medido do som, e o atraso fixo do FIR é descontado do resultado corrigido. O atraso de grupo não é referenciado novamente em 1 kHz, então não é necessariamente 0 ms ali. **Min Group Delay** ajusta sua faixa automaticamente; **Excess Group Delay** fica fixo entre −100 e +100 ms, mas a leitura mostra valores fora dessa faixa. Sem dados de resposta ao impulso, essas visualizações mostram uma mensagem de indisponibilidade.
- **Graph Preview Ch**: Aparece quando há filtros projetados para mais de um canal; seleciona de qual canal as curvas são exibidas e não afeta o áudio.
- **Controles interativos**: Arraste os marcadores numerados na horizontal para mudar a frequência de uma banda do **Additional EQ** e na vertical para mudar seu ganho (bandas desativadas aparecem esmaecidas), e passe o cursor ou arraste sobre o gráfico para ler os valores em qualquer ponto.
- A linha de status abaixo dos controles mostra a latência total de processamento, a resolução do FIR e se o filtro está em bypass, preparado (staged), em preparação, ativo ou com erro.

## Tilt EQ

Inclina o equilíbrio geral de frequências em torno de uma frequência pivô com um par combinado de filtros shelving: um lado do espectro sobe e o outro desce. Use-o para deixar o som mais quente ou mais brilhante de forma ampla com um único controle, por exemplo, quando uma gravação ou um par de fones de ouvido soa sempre brilhante ou abafado demais.

### Guia de aprimoramento do som
- **Mais quente**: Use um **Slope** levemente negativo (por exemplo, -1 dB/oct) para reduzir os agudos e elevar os graves, como em gravações ou fones de ouvido brilhantes.
- **Mais brilhante**: Use um **Slope** levemente positivo (por exemplo, +1 dB/oct) para elevar os agudos e reduzir os graves, como em gravações ou caixas acústicas abafadas.
- **Onde a mudança começa**: Reduza **Pivot Freq (Hz)** para estender a mudança do lado dos agudos até os médios; aumente-o para limitá-la às oitavas mais altas.

### Parâmetros
- **Pivot Freq (Hz)** (20 Hz a ~20 kHz; padrão em torno de 1 kHz) - A frequência em torno da qual o equilíbrio se inclina.
- **Slope** (-12 a +12 dB/oct; padrão 0) - A quantidade e o sentido da inclinação. Valores positivos deixam o som mais brilhante, valores negativos mais quente, e 0 o deixa inalterado.

### Exibição visual
- O gráfico mostra a resposta em frequência resultante.
- **Reset** devolve os dois parâmetros aos valores padrão.
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

## Tonal Balance EQ

Mede o equilíbrio tonal de longo prazo do que está tocando e o aproxima suavemente do equilíbrio espectral típico das músicas lançadas no estilo escolhido. Use-o quando as faixas de uma playlist, álbum ou stream soarem sempre escuras, brilhantes, com graves inchados ou magras demais, e você quiser uniformizá-las automaticamente sem ajustar um EQ à mão para cada faixa. (Ele corrige o equilíbrio da gravação, não as suas caixas ou a sua sala; para correção acústica, use o [Room EQ](#room-eq).)

O plugin compara o espectro medido com o alvo depois de igualar o volume geral, atenua as regiões fortes demais e aplica um único ganho de make-up para que as regiões mais fracas ganhem presença sem alterar o volume percebido. Ele exclui da medição o silêncio e as pausas e deixa de elevar o chiado e as bandas estáveis e parecidas com ruído (incluindo um pad de sintetizador sustentado), para que extremos de frequência vazios não sejam reforçados artificialmente. Todos os canais recebem a mesma correção sem latência, preservando a imagem estéreo.

### Guia de aprimoramento do som
- **Playlists variadas e streaming**: Comece com os valores padrão (**Target: All**, **Amount: 100%**, **Averaging Time: 30 s**). A correção vai se formando ao longo de dezenas de segundos, à medida que a medição se torna confiável, então deixe a música tocar por cerca de 30 segundos antes de comparar com o bypass.
- **Uma correção estável para o álbum**: Clique em **Reset** no início do álbum e ajuste **Averaging Time** para **∞**, para que a correção faça a média de toda a sessão de reprodução e se acomode em uma curva fixa.
- **Alvos por gênero**: Escolha **Classical**, **Electronic**, **Pop** ou **Rock** para acompanhar um estilo específico, ou **All** para audição variada.
- **Moldagem mais suave**: Reduza **Amount** (por exemplo, 50%), diminua **Range** (por exemplo, 3 dB) ou aumente **Smoothing** (por exemplo, 1 oct) para inclinações amplas e sutis.
- **Curva de preferência própria**: Use as cinco bandas de **Target Adjust** abaixo do gráfico para inclinar ou moldar o alvo ao seu gosto (por exemplo, um High shelf de +1,5 dB em 8 kHz). Cada gravação é então corrigida em direção ao seu alvo personalizado apenas o quanto for necessário.
- **Referência de inclinação fixa**: Selecione **Target: Tilt** para uma resposta plana abaixo de **Corner** seguida de uma queda constante dada por **Slope** (−5 dB/oct se aproxima das masterizações comerciais típicas; −3 dB/oct corresponde ao ruído rosa).

O ganho de make-up preserva o volume, não o nível de pico, então os picos podem subir; se ocorrer clipping em um estágio posterior, reduza o nível depois deste plugin ou acrescente um limitador.

### Parâmetros
- **Target** - Equilíbrio tonal desejado: **All** (padrão; mistura dos quatro estilos com pesos iguais), **Classical**, **Electronic**, **Pop**, **Rock** ou **Tilt** (referência de inclinação fixa).
- **Slope** (-18 a 0 dB/oct; padrão -6 dB/oct; apenas no modo Tilt) - Taxa de queda acima de **Corner** (-3 dB/oct = ruído rosa, ~-5 dB/oct = lançamentos comerciais típicos). Valores menos inclinados pedem mais agudos; o padrão pede um equilíbrio um pouco mais escuro que o da música típica.
- **Corner** (20 a 1000 Hz; padrão 250 Hz; apenas no modo Tilt) - Frequência abaixo da qual o alvo **Tilt** permanece plano. Valores menores pedem mais graves profundos; valores maiores, menos graves.
- **Amount** (0% a 100%; padrão 100%) - Intensidade geral da correção. Em 0%, o som não muda, mas a medição e o gráfico continuam funcionando, e **Range**, **Smoothing**, **Low** e **High** ficam desativados.
- **Range** (0 a 12 dB; padrão 6 dB) - Ajuste máximo de ganho permitido em qualquer banda, para cima ou para baixo. Valores menores mantêm as mudanças sutis (0 dB desliga a correção); valores maiores deixam gravações muito distantes do alvo chegarem mais perto dele.
- **Smoothing** (0.1667 a 2 oct; padrão 0.5 oct) - Largura das variações da curva de correção (valores maiores produzem inclinações mais amplas).
- **Averaging Time** (0.1 s a ∞; padrão 30 s) - Janela de integração da medição. Valores curtos (por exemplo, 0.5 a 1 s) acompanham mudanças dentro de uma música, como uma estrofe escura e um refrão brilhante; valores longos dão uma correção estável (**∞** faz a média contínua desde o último **Reset**).
- **Low** (20 a 200 Hz; padrão 20 Hz) / **High** (2000 a 20000 Hz; padrão 16000 Hz) - Limites inferior e superior da faixa remodelada (fora desses limites, a correção fica constante). Aumente **Low** para não mexer nos graves mais profundos, ou reduza **High** para não mexer na oitava mais alta.
- **Average SPL** (60 a 96 dB; padrão 83 dB) - Nível de audição estimado, usado para decidir quais bandas silenciosas são audíveis o bastante para serem elevadas; não altera o nível de saída. Valores menores tratam mais bandas fracas como inaudíveis, e elas não são elevadas; valores maiores contam mais delas como audíveis.
- **Target Adjust** - Cinco bandas paramétricas (Peak, Low shelf, High shelf; 20 Hz–20 kHz, ±20 dB, Q 0.1–10, até 2 nos shelves; Q padrão 0.7) que remodelam a curva-alvo. Ganho positivo pede mais daquela região; ganho negativo, menos.

O **Target Adjust** altera apenas o alvo; cada gravação continua sendo corrigida em direção a ele dentro de **Amount** e **Range**, então um ajuste maior pode exigir um **Range** maior. Elevar o alvo inteiro pela mesma quantidade não muda nada, porque os níveis gerais são igualados antes da comparação. Picos e vales estreitos são suavizados; para correções estreitas, use o 5Band PEQ.

### Exibição visual
- O eixo horizontal é a frequência, de cerca de 26 Hz a 18.6 kHz, e o vertical é o nível em dB, mostrado por hertz, então o ruído rosa aparece como uma linha que cai a -3 dB/oct. A faixa vertical se amplia para acomodar as curvas e volta a ±12 dB com **Reset** ou ao mudar o **Target**. As regiões abaixo de **Low** e acima de **High** aparecem esmaecidas.
- **Target** é o equilíbrio-alvo, incluindo o **Target Adjust**. Para um estilo, a faixa sombreada mostra a variação típica entre faixas, aprendida a partir dos espectros de longo prazo de uma coleção de músicas; **Tilt** não tem essa faixa.
- **Measured** é a linha com pontos: o espectro de longo prazo medido, alinhado ao alvo. Onde fica abaixo da faixa do alvo, a gravação é mais fraca que o típico ali; acima dela, mais forte. A medição pausa enquanto você pré-escuta uma frequência.
- **EQ response** é a linha grossa: o ganho aplicado, incluindo o ganho de make-up (0 dB = sem alteração).
- **Withheld lift** é a área sombreada que mostra aproximadamente quanto a mais uma banda seria elevada se não fosse contida por ser parecida com ruído ou não musical.
- **Target adjust** é a curva fina em torno de 0 dB com alças numeradas que mostram as bandas como você as ajustou; as alças não ficam sobre a linha **Target**. Arraste uma alça para mudar a frequência e o ganho, gire a roda do mouse sobre ela para mudar o Q e clique com o botão direito para ligar ou desligar a banda. Durante a reprodução, a linha **Target** acompanha as alças em instantes; com a reprodução parada, mantém sua última forma.
- Passe o cursor ou arraste sobre o gráfico para ver os valores das bandas, **Presence** (% do tempo reconhecido como conteúdo musical), **Make-up gain** e o **Loudness** integrado (LKFS). Antes de qualquer áudio ser medido, o gráfico mostra "Play audio to start measuring".
- **Reset** apaga a medição acumulada; o **Target Adjust** não é alterado. A medição também recomeça quando o processamento é retomado após uma pausa de economia de energia.
- **Copy as PEQ** copia o EQ response como ajustes do 5Band PEQ. Pressione **Ctrl+V** no Effect Pipeline para inseri-lo antes do efeito selecionado (ou no final) e depois desligue o Tonal Balance EQ para manter a correção fixa. A cópia acompanha a forma da curva entre **Low** e **High**, mas não seu nível geral, então o volume pode diferir um pouco. Fica disponível quando o gráfico mostra um EQ response e **Amount** está acima de 0%.

## Tone Control

Um ajustador de som simples de três bandas para personalização rápida e fácil do som. Perfeito para modelar o som de forma básica sem complicações técnicas.

### Guia de aprimoramento musical
- Música Clássica:
  - Aumento leve dos agudos para mais detalhes nas cordas
  - Realce suave dos graves para um som orquestral mais completo
  - Médios neutros para um som natural
- Música Rock/Pop:
  - Realce moderado dos graves para mais impacto
  - Redução leve dos médios para um som mais claro
  - Aumento dos agudos para pratos nítidos e detalhes
- Música Jazz:
  - Graves quentes para um som mais encorpado
  - Médios claros para detalhes dos instrumentos
  - Agudos suaves para brilho dos pratos
- Música Eletrônica:
  - Graves fortes para um impacto profundo
  - Médios reduzidos para um som mais limpo
  - Agudos realçados para detalhes nítidos

### Parâmetros
- **Bass** - Controla os sons graves (-24dB a +24dB)
  - Aumente para graves mais potentes
  - Diminua para um som mais leve e limpo
  - Afeta o "peso" da música
- **Mid** - Controla o corpo principal do som (-24dB a +24dB)
  - Aumente para vocais/instrumentos mais proeminentes
  - Diminua para um som mais espaçoso
  - Afeta a "plenitude" da música
- **Treble** - Controla os sons agudos (-24dB a +24dB)
  - Aumente para mais brilho e detalhes
  - Diminua para um som mais suave e macio
  - Afeta o "brilho" da música

### Exibição visual
- Gráfico de fácil leitura mostrando seus ajustes
- Sliders simples para cada controle
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.
