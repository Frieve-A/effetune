---
title: "Plugins de EQ - EffeTune"
description: "Plugins de equalização, incluindo Parametric EQ, Graphic EQ, Dynamic EQ, filtros e Tone Control."
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
- [Hi Pass Filter](#hi-pass-filter) - Remove frequências baixas indesejadas com precisão
- [Lo Pass Filter](#lo-pass-filter) - Remove frequências altas indesejadas com precisão
- [Loudness Equalizer](#loudness-equalizer) - Correção do balanço de frequência para audição em volumes baixos
- [Narrow Range](#narrow-range) - Foca em partes específicas do som
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
