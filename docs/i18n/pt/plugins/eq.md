---
title: "Plugins de EQ - EffeTune"
description: "Plugins de equalização, incluindo Parametric EQ, Graphic EQ, Dynamic EQ, Room EQ, Earphone Cable Sim, filtros e Tone Control."
lang: pt
---

# Plugins de Equalizador

Uma coleção de plugins que permite ajustar diferentes aspectos do som da sua música, desde graves profundos até agudos nítidos. Essas ferramentas ajudam você a personalizar sua experiência de audição, realçando ou reduzindo elementos sonoros específicos.

## Lista de Plugins

- [15Band GEQ](#15band-geq) - Ajuste detalhado do som com 15 controles precisos
- [15Band PEQ](#15band-peq) - Modelagem tonal detalhada em 15 bandas para ajustar o som durante a escuta
- [5Band Dynamic EQ](#5band-dynamic-eq) - Equalizador baseado em dinâmica que reage à sua música
- [5Band PEQ](#5band-peq) - Equalizador flexível para moldar graves, médios e agudos
- [Band Pass Filter](#band-pass-filter) - Foco em frequências específicas
- [Comb Filter](#comb-filter) - Coloração sonora faseada, oca ou metálica
- [Earphone Cable Sim](#earphone-cable-sim) - Ajuda a verificar como as mudanças de resposta em frequência causadas por cabos comuns de fones de ouvido costumam ser pequenas
- [Hi Pass Filter](#hi-pass-filter) - Remove frequências baixas indesejadas com precisão
- [Lo Pass Filter](#lo-pass-filter) - Remove frequências altas indesejadas com precisão
- [Loudness Equalizer](#loudness-equalizer) - Correção do balanço de frequência para audição em volumes baixos
- [Narrow Range](#narrow-range) - Foca em partes específicas do som
- [Room EQ](#room-eq) - Correção FIR baseada em medições de sala salvas
- [Tilt EQ](#tilt-eq) - Equalizador de inclinação para ajuste tonal simples
- [Tone Control](#tone-control) - Ajuste simples de graves, médios e agudos

## 15Band GEQ

Uma ferramenta de ajuste de som detalhada com 15 controles separados, cada um afetando uma parte específica do espectro sonoro. Perfeita para afinar sua música exatamente do jeito que você gosta.

### Guia de Aperfeiçoamento da Audição
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

### Exibição Visual
- Gráfico em tempo real mostrando os ajustes do seu som
- Sliders fáceis de usar com controle preciso
- Reinicialização para as configurações padrão com um clique

## 15Band PEQ

Um equalizador paramétrico de 15 bandas para ajustar graves, vocais, presença e agudos durante a escuta. Use quando quiser controle mais detalhado que um EQ gráfico, desde pequenas mudanças de tom até localizar uma frequência específica que incomoda.

### Guia de Aperfeiçoamento do Som
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
- **Gerenciamento de Presets**
  - Importação: Carrega linhas de filtro TXT no estilo Equalizer APO
  - Até 15 filtros `ON` PK/LS/LSC/HS/HSC são importados; linhas `Preamp` e tipos de filtro não suportados são ignorados
    - Formato de exemplo:
      ```
      Filter 1: ON PK Fc 50 Hz Gain -3.0 dB Q 2.00
      Filter 2: ON HS Fc 12000 Hz Gain 4.0 dB Q 0.70
      ...
      ```

### Exibição Visual
- Visualização de resposta de frequência em alta resolução
- Pontos de controle interativos com exibição precisa de parâmetros
- Atualização da curva em tempo real conforme os ajustes mudam
- Grade de frequência e ganho
- Leituras numéricas precisas para todos os parâmetros

## 5Band Dynamic EQ

Um equalizador inteligente que ajusta automaticamente as bandas de frequência com base no conteúdo da sua música. Ele combina equalização precisa com processamento dinâmico que reage às mudanças na sua música em tempo real, criando uma experiência de audição aprimorada sem ajustes manuais constantes.

### Guia de Aprimoramento de Audição
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

### Exibição Visual
- Gráfico de resposta de frequência em tempo real
- Curva de resposta dinâmica mostrando os boosts e cortes atuais
- Controles interativos de frequência e ganho

## 5Band PEQ

Um equalizador flexível de 5 bandas para moldar o som da música. Use quando o grave soa embolado, os vocais estão ásperos ou os agudos precisam de um pouco mais de brilho sem abrir a versão mais detalhada de 15 bandas.

### Guia de Aperfeiçoamento do Som
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
  - Banda 1: 100Hz (Sub & Bass Control)
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

### Exibição Visual
- Visualização de resposta de frequência em alta resolução
- Pontos de controle interativos com exibição precisa de parâmetros
- Atualização da curva em tempo real conforme os ajustes mudam
- Grade de frequência e ganho
- Leituras numéricas precisas para todos os parâmetros

## Band Pass Filter

Um filtro passa-banda de precisão que combina filtros passa-alta e passa-baixa para permitir que apenas frequências em uma faixa específica passem. Baseado no design de filtro Linkwitz-Riley para resposta de fase ideal e qualidade de som transparente.

### Guia de Aperfeiçoamento da Audição
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

### Exibição Visual
- Gráfico de resposta de frequência em tempo real com escala logarítmica de frequência
- Visualização clara de ambas inclinações do filtro e pontos de corte
- Controles interativos para ajuste preciso
- Grade de frequência com marcadores em pontos de referência chave

## Comb Filter

Um filtro pente que adiciona caráter faseado, oco, metálico ou ressonante ao misturar o som com uma cópia atrasada muito curta. Use quando quiser uma faixa mais colorida, espacial ou experimental.

### Guia de Aperfeiçoamento da Audição
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

### Exibição Visual
- Gráfico de resposta de frequência em tempo real com escala logarítmica de frequência
- Visualização clara de picos e vales do filtro pente
- Marcador de frequência fundamental mostrando o tempo de atraso
- Controles interativos para ajuste preciso
- Cálculo da distância de atraso em milímetros

## Earphone Cable Sim

Reproduz as pequenas mudanças de resposta em frequência que aparecem quando um fone de ouvido é alimentado por um amplificador por meio da resistência e da indutância reais do cabo, além de uma impedância de saída diferente de zero. Como a impedância de um fone varia conforme a frequência (ressonâncias do driver e indutância da bobina de voz), a impedância da fonte e do cabo gera mudanças de nível específicas para cada fone. Isso é útil como verificação prática: com cabos de construção e qualidade normais, impedância de saída comum no amplificador e fones que não tenham impedância anormalmente baixa nem outro comportamento incomum, a mudança audível causada por diferenças comuns entre cabos de fones de ouvido costuma ser pequena o bastante para ser desprezível. O efeito é mais forte em fones de baixa impedância com grandes picos de impedância e, em geral, é sutil com amplificadores modernos de baixa impedância de saída.

### Guia de aprimoramento da escuta
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

### Exibição Visual
- Gráfico em tempo real da resposta do filtro implementado, em escala logarítmica de frequência
- Os rótulos da grade cobrem 20Hz a 20kHz; a curva exibida se estende por toda a faixa do gráfico, de 10Hz a 40kHz
- Curva de resposta verde sobre uma grade escura, com eixo em dB ajustado automaticamente em torno da referência normalizada de 0dB
- Desvios maiores na curva indicam onde o modelo altera mais o nível de reprodução

## Hi Pass Filter

Um filtro passa-alta de precisão que remove frequências baixas indesejadas, preservando a clareza das frequências mais altas. Baseado no design de filtro Linkwitz-Riley para resposta de fase ideal e qualidade de som transparente.

### Guia de Aperfeiçoamento da Audição
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

### Exibição Visual
- Gráfico de resposta de frequência em tempo real com escala logarítmica
- Visualização clara da inclinação do filtro e do ponto de corte
- Controles interativos para ajuste preciso
- Grade de frequência com marcadores em pontos de referência chave

## Lo Pass Filter

Um filtro passa-baixa de precisão que remove frequências altas indesejadas, preservando o calor e o corpo das frequências mais baixas. Baseado no design de filtro Linkwitz-Riley para resposta de fase ideal e qualidade de som transparente.

### Guia de Aperfeiçoamento da Audição
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

### Exibição Visual
- Gráfico de resposta de frequência em tempo real com escala logarítmica
- Visualização clara da inclinação do filtro e do ponto de corte
- Controles interativos para ajuste preciso
- Grade de frequência com marcadores em pontos de referência chave

## Loudness Equalizer

Um equalizador especializado que ajusta o equilíbrio de frequência com base no valor Average SPL que você define. Use para escutas mais silenciosas, nas quais graves e agudos podem parecer mais fracos, mantendo a música equilibrada e agradável.

### Guia de Aperfeiçoamento da Audição
- Audição em Baixo Volume:
  - Realça frequências de graves e agudos
  - Mantém o equilíbrio musical em níveis baixos
  - Compensa as características da audição humana
- Configuração Average SPL:
  - Mais realce com configurações Average SPL mais baixas
  - Redução gradual do processamento conforme a configuração aumenta
  - Som natural em níveis de audição mais altos
- Equilíbrio de Frequência:
  - Prateleira baixa para realce dos graves (100-300Hz)
  - Prateleira alta para realce dos agudos (3-6kHz)
  - Transição suave entre as faixas de frequência

### Parâmetros
- **Average SPL** - Nível médio estimado de escuta usado para correção (60dB a 85dB)
  - Valores mais baixos: Maior realce
  - Valores mais altos: Menor realce
  - Ajuste manualmente para corresponder ao seu volume típico de escuta
- **Controles de Baixa Frequência**
  - Frequency: Centro de realce dos graves (100Hz a 300Hz)
  - Gain: Aumento máximo dos graves (0dB a 15dB)
  - Q: Forma do realce dos graves (0.5 a 1.0)
- **Controles de Alta Frequência**
  - Frequency: Centro de realce dos agudos (3kHz a 6kHz)
  - Gain: Aumento máximo dos agudos (0dB a 15dB)
  - Q: Forma do realce dos agudos (0.5 a 1.0)

### Exibição Visual
- Gráfico de resposta de frequência em tempo real
- Controles interativos de parâmetros
- Visualização de curva dependente do volume
- Leituras numéricas precisas

## Narrow Range

Uma ferramenta que permite focar em partes específicas da música, filtrando frequências indesejadas. Útil para criar efeitos sonoros especiais ou remover sons indesejados.

### Guia de Aperfeiçoamento da Audição
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

### Exibição Visual
- Gráfico claro mostrando a resposta de frequência
- Controles de frequência fáceis de ajustar
- Menus suspensos simples para seleção de inclinação

## Room EQ

O Room EQ cria um único filtro de correção FIR a partir de uma medição de resposta em frequência salva pelo EffeTune e aplica o mesmo filtro a todos os canais direcionados ao plugin. O seletor de barramento padrão do plugin define quais canais são processados. Ele calcula a média de todos os pontos da medição escolhida, suaviza o resultado e reduz os desvios dentro da faixa de correção selecionada. Use-o quando a interação entre as caixas e a sala causar picos recorrentes ou um desequilíbrio tonal amplo na área de audição. Também é possível aplicar correção de magnitude com fase linear ou correção de fase mista, que combina correção de magnitude com fase mínima e correção do excesso de fase do som direto medido. Por padrão, a correção do excesso de fase preserva o componente comum aos pontos de medição e diminui onde as fases divergem. O Room EQ requer o mecanismo DSP WASM; sem ele, o sinal passa inalterado.

### Guia de aprimoramento do som

- Meça o grupo de caixas que deseja corrigir em várias posições próximas do microfone na área de audição e selecione essa medição no Room EQ. Vários pontos tornam a correção menos dependente de uma única posição exata.
- Comece com **Phase: Linear**, **Smoothing: 0.17 oct**, **Correction Low: 20 Hz**, **Correction High: 16000 Hz**, **Max Boost: 6 dB** e **Level Correction: 100%**. Compare usando o controle principal de ligar e desligar do plugin para confirmar um equilíbrio mais uniforme, sem deixar o som artificialmente magro ou brilhante.
- Se o filtro tentar preencher vales estreitos que mudam com a posição do microfone, aumente Smoothing ou reduza Max Boost. Com Max Boost em 0 dB, os reforços automáticos são impedidos, mas os cortes continuam reduzindo os picos.
- Se a correção total de nível parecer forte demais, reduza Level Correction. Como esse ajuste dimensiona proporcionalmente em dB cada valor da correção automática, em 50% uma correção de +6 dB passa a +3 dB e uma de -8 dB passa a -4 dB.
- Mantenha Correction Low e Correction High dentro da faixa reproduzida com confiança pelas caixas e pelo microfone. Corrigir fora de uma faixa de medição confiável pode piorar o resultado.
- Depois que a correção da sala estiver estável, use o EQ adicional para criar um alvo de audição suave, como um Low shelf amplo de +2 dB perto de 100 Hz ou um pequeno ajuste High shelf em torno de 10 kHz. Essas bandas mudam o alvo e são integradas ao filtro FIR.
- Use **Minimum** quando a baixa latência for importante. Use **Correction** quando quiser corrigir o excesso de fase além da resposta de frequência. Comece com Reference Point em **Consenso (todos os pontos)**, o valor padrão de Direct Window e **Phase Correction: 100%**. Selecione um ponto específico somente para otimizar o excesso de fase nessa posição do microfone. Reduza Phase Correction de forma independente se o resultado de fase parecer forte demais.
- O Room EQ não calcula o alinhamento pela distância das caixas. **Delay** adiciona o mesmo atraso manual a todos os canais processados. Se grupos diferentes precisarem de atrasos diferentes, use instâncias separadas do Room EQ.

A medição é uma referência local do dispositivo. Uma URL ou preset guarda seu nome e identificador, mas não os dados medidos. Para usá-la em outro dispositivo, ative **Incluir respostas ao impulso nas exportações JSON de medições** na tela de medição antes de exportá-la; depois, importe-a no outro dispositivo antes de selecioná-la. Essa opção fica desativada por padrão, e incluir respostas ao impulso pode aumentar o tamanho do arquivo em dezenas de megabytes. Quando falta a medição, aparece um aviso e o Room EQ usa bypass alinhado em vez de dados de correção antigos.

### Parâmetros

- **Measurement** - Seleciona uma medição salva para todos os canais processados. A lista mostra nome, número de pontos e `IR` quando há resposta ao impulso. Use **Refresh measurements** depois de adicionar ou alterar medições.
- **Delay** - Adiciona manualmente de 0 a 20 ms de atraso a todos os canais processados. Esse atraso não entra na latência de processamento informada pelo plugin.
- **Phase** - Seleciona como o filtro FIR trata a fase.
  - **Minimum** - Correção de magnitude de fase mínima com a menor latência adicional.
  - **Linear** - Correção de magnitude de fase linear. Preserva a fase relativa da entrada, mas adiciona atraso igual à metade do número de taps.
  - **Correction** - Soma à correção de magnitude de fase mínima a correção do excesso de fase da resposta ao impulso direta salva. Isso reduz a variação do atraso de grupo e mantém `Taps / 2` amostras de atraso para o filtro de fase mista. Durante o projeto, mantém a posição da energia do impulso principal alinhada à resposta Minimum com a mesma configuração de Level Correction. Um único filtro é projetado a partir da medição selecionada e aplicado sem alterações a todos os canais roteados. Portanto, alterar Level Correction ou Phase Correction não introduz diferenças de sincronização específicas entre canais. Requer Reference Point, Direct Window e dados de impulso.
- **Taps** - Comprimento FIR: 8192, 16384, 32768, 65536 ou 131072. Mais taps melhoram a resolução nos graves, mas aumentam atraso, uso de memória e tempo de projeto. Linear e Correction adicionam `Taps / 2` amostras de atraso.
- **Latency** - Latência inicial do mecanismo de convolução: 0, 128, 256, 512 ou 1024 amostras. Valores menores reduzem o atraso, mas exigem mais processamento; em Linear e Correction, normalmente predomina o atraso de metade do FIR.
- **Smoothing** - Suavização gaussiana de 0,02 a 1,00 oitava. Valores maiores produzem uma correção mais ampla e conservadora; valores menores seguem variações mais finas.
- **Correction Low / Correction High** - Definem os limites de transição inferior e superior da correção automática de magnitude. Antes da suavização gaussiana, a correção automática é tratada como 0 dB nesses limites e fora deles. Assim, Smoothing controla a suavidade com que a correção diminui e até onde se estende além de cada limite. O limite superior também é restringido internamente para deixar margem abaixo da frequência de Nyquist.
- **Direct Window** - Trecho de 1 a 50 ms após o início do som direto usado por Correction. Uma janela maior estende a correção de fase para frequências mais baixas, mas inclui mais reflexões da sala.
- **Max Boost** - Limita de 0 a 18 dB os reforços produzidos pela inversão automática da resposta. O limite é aplicado antes da suavização gaussiana, permitindo que as regiões limitadas se integrem suavemente à curva de correção ao redor. Não limita os cortes.
- **Level Correction** - Ajusta a correção automática de magnitude de 0% a 100% em passos de 1%, linearmente em dB. Em 0%, a correção automática de nível fica desativada; Phase Correction, Additional EQ, Delay e Gain continuam ativos.
- **Phase Correction** - Ajusta a correção do excesso de fase medido de 0% a 100% em passos de 1% e atua somente em Correction. Seus controles ficam desativados nos modos Minimum e Linear. Em 0%, a correção do excesso de fase fica desativada enquanto Level Correction continua ativa. A mudança de fase mínima inerente à resposta de magnitude de Level Correction permanece; portanto, Phase Correction controla apenas o componente adicional de excesso de fase obtido da medição.
- **Reference Point** - Seleciona a origem do excesso de fase do som direto em Correction. **Consenso (todos os pontos)** é o padrão e a opção de contingência: alinha os pontos no tempo, combina o excesso de fase, reduz o peso da fase pouco confiável perto de cancelamentos profundos e diminui a correção onde os pontos divergem. Selecionar um ponto pelo nome usa somente o excesso de fase desse ponto. A correção de magnitude sempre usa todos os pontos. Se o ponto selecionado for excluído, a configuração volta para Consenso.
- **EQ adicional (integrado ao FIR)** - Reutiliza a mesma interface de cinco bandas e o mesmo gráfico do 5Band PEQ. Cada banda pode ser ligada, definida como Peak, Low shelf ou High shelf e ajustada entre 20 Hz e 20 kHz, -20 e +20 dB e Q de 0,1 a 10. A resposta é incorporada ao FIR, sem uma etapa IIR separada. Sua fase é zero em Linear e de fase mínima em Minimum e Correction. Max Boost limita a inversão automática da sala, não os reforços intencionais deste EQ.
- **Gain** - Aplica de -12 a +12 dB a todos os canais depois de combinar os caminhos corrigido e em bypass.

### Exibição visual

- Use os botões de opção **Resposta em frequência** e **Resposta ao impulso** na parte superior do gráfico para alternar a visualização.
- **Resposta ao impulso** mostra o ponto selecionado ou, quando Reference Point está em Consenso, a forma de onda média alinhada no tempo. O intervalo vai de 5 ms antes do início medido até o maior valor entre 5 ms e Direct Window. A linha cinza representa o sinal antes da correção e a branca, o resultado calculado após a aplicação do FIR real. O início medido é a referência comum de 0 ms e apenas o atraso fixo conhecido do FIR é removido da forma de onda corrigida, de modo que a posição relativa do pico e o pré-ringing permaneçam visíveis. As duas linhas usam a mesma escala de amplitude normalizada. Se a medição não contiver dados de resposta ao impulso, será exibida uma mensagem informando que eles não estão disponíveis.
- O gráfico mostra a frequência em escala logarítmica no eixo horizontal e o nível em dB no vertical.
- As duas linhas verticais brancas pontilhadas marcam as frequências definidas por Correction Low e Correction High.
- Os marcadores permitem ajustar a frequência e o ganho de cada banda.
- A linha cinza-clara mostra a resposta em frequência medida e suavizada com o deslocamento de exibição comum do gráfico.
- A linha fina em verde-claro mostra a correção automática calculada com base na medição selecionada e nos ajustes atuais do Room EQ, antes do EQ adicional.
- A linha verde brilhante mostra essa correção com o EQ adicional aplicado. Essa resposta de magnitude combinada é integrada ao FIR.
- A linha branca mostra a resposta corrigida estimada obtida ao somar a correção combinada em verde brilhante à resposta medida em cinza-claro. As linhas cinza e branca compartilham um deslocamento que coloca em 0 dB o nível de destino da correção automática de 100%; os limites de Max Boost podem deixar desvios residuais, enquanto o Additional EQ remodela intencionalmente a resposta ao redor dessa referência. É uma visualização calculada, não uma nova medição acústica.
- O status abaixo dos controles mostra a latência total, a resolução FIR e se o filtro está em bypass, staged, preparing, active ou error.

## Tone Control

Um ajustador de som simples de três bandas para personalização rápida e fácil do som. Perfeito para modelar o som de forma básica sem complicações técnicas.

### Guia de Aperfeiçoamento Musical
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
- **Graves** - Controla os sons graves (-24dB a +24dB)
  - Aumente para graves mais potentes
  - Diminua para um som mais leve e limpo
  - Afeta o "peso" da música
- **Médios** - Controla o corpo principal do som (-24dB a +24dB)
  - Aumente para vocais/instrumentos mais proeminentes
  - Diminua para um som mais espaçoso
  - Afeta a "plenitude" da música
- **Agudos** - Controla os sons agudos (-24dB a +24dB)
  - Aumente para mais brilho e detalhes
  - Diminua para um som mais suave e macio
  - Afeta o "brilho" da música

### Exibição Visual
- Gráfico de fácil leitura mostrando seus ajustes
- Sliders simples para cada controle
- Botão de reinicialização rápida
## Tilt EQ

Um equalizador simples mas eficaz que inclina suavemente o equilíbrio de frequências da sua música. Projetado para ajustes sutis que podem aquecer ou clarear o som sem controles complexos. Ideal para adaptar rapidamente o tom geral às suas preferências.

### Guia de Melhoria Musical
- Esquentar a música:
  - Use valores de slope negativos para reduzir altas frequências e reforçar baixas
  - Ideal para gravações brilhantes ou fones de ouvido agudos
  - Cria uma experiência de audição aconchegante
- Clarear a música:
  - Use valores de slope positivos para destacar altas frequências e reduzir baixas
  - Perfeito para gravações abafadas ou caixas de som surdas
  - Adiciona clareza e brilho
- Ajustes sutis:
  - Use pequenos valores de slope para ajustes suaves no tom geral
  - Adapte o equilíbrio ao seu ambiente de audição

### Parâmetros
- **Pivot Frequency** - Controla a frequência central da inclinação (20Hz a ~20kHz)
  - Define o ponto onde ocorre o efeito tilt
- **Slope** - Controla a inclinação em torno da frequência pivô (-12 dB/oct a +12 dB/oct)
  - Valores positivos deixam o som mais brilhante; valores negativos deixam o som mais quente
  - Valores menores fazem mudanças mais suaves

### Visualização
- Slider simples para ajuste de Slope
- Curva de resposta em frequência em tempo real
- Exibição clara do valor atual de Slope
