---
title: "Plugins de Saturação - EffeTune"
description: "Plugins de saturação e distorção, incluindo Saturation, Exciter, Hard Clipping e outros."
lang: pt
---

# Plugins de Saturação

Uma coleção de plugins que adicionam calor e caráter à sua música. Esses efeitos podem fazer a música digital soar mais analógica e adicionar uma riqueza agradável ao som, semelhante à forma como equipamentos de áudio vintage colorem o som.

<!-- spectrum-overlay -->
## Sobreposição de espectro

Pressione o ícone de espectro de um gráfico compatível para sobrepor uma linha de espectro discreta do som depois de passar por esse efeito. Use-o para ver como cada ajuste altera graves, médios e agudos enquanto escuta. Leia o nível do espectro na escala dBFS à direita do gráfico. Ela é separada da escala de ganho do gráfico; 0 dBFS é a referência digital de escala completa, e valores mais baixos são mais silenciosos. A análise e o desenho do espectro são feitos apenas enquanto a visualização está visível.

## Lista de Plugins

- [Bandwidth Extender](#bandwidth-extender) - Gera agudos acima de um corte detectado ou definido
- [Dynamic Saturation](#dynamic-saturation) - Simula o deslocamento não linear de cones de alto-falantes
- [Exciter](#exciter) - Adiciona conteúdo harmônico para melhorar a clareza e presença
- [Hard Clipping](#hard-clipping) - Adiciona intensidade e borda ao som
- [Harmonic Distortion](#harmonic-distortion) - Adiciona caráter com distorção não linear ajustável de 2ª a 5ª ordem
- [Multiband Saturation](#multiband-saturation) - Molda faixas de graves, médios e agudos independentemente
- [Saturation](#saturation) - Adiciona calor e riqueza como equipamentos vintage
- [Sub Synth](#sub-synth) - Adiciona um sinal filtrado de baixa frequência para reforçar os graves
- [Tube Simulator](#tube-simulator) - Modela estágios de linha valvulados e amplificadores de potência push-pull ou single-ended

## Bandwidth Extender

Bandwidth Extender destina-se a áudio com um corte claro nos agudos, como alguns MP3 de baixa taxa de bits. Ele analisa o par estéreo em conjunto e adiciona conteúdo novo apenas acima do limite detectado ou definido. Não recupera a forma de onda original; no modo Auto, fica inativo quando não encontra um corte estável.

A banda gerada tem dois componentes ajustáveis separadamente: continuação harmônica relacionada à entrada e ruído moldado determinístico. O sinal original permanece presente enquanto esses componentes são adicionados.

### Guia de aprimoramento sonoro

- Comece com **Auto** e ambos os controles Amount no valor padrão de 100%. Use **Manual** se souber a frequência de corte.
- Reduza **Noise Amount** em material tonal sustentado ou **Harmonic Amount** em percussão e sons de respiração. Mantenha ambos ativos em material misto.
- Compare com bypass no mesmo volume. Para apenas clarear áudio de banda completa, use o Exciter.

### Parâmetros

- **Harmonic Amount** (0-200%, padrão: 100%) controla apenas a continuação harmônica: 0% a remove, 100% é o nível de referência e 200% a duplica sem alterar o ruído nem o sinal seco.
- **Noise Amount** (0-200%, padrão: 100%) controla apenas o ruído moldado: 0% o remove, 100% é o nível de referência e 200% o duplica sem alterar os harmônicos nem o sinal seco.
- **Cutoff** seleciona **Auto**, que procura uma queda espectral acentuada e persistente comum aos dois canais, ou **Manual**. Em Manual, a banda gerada é limitada automaticamente à faixa disponível durante a reprodução.
- **Manual Cutoff** (6000-24000 Hz) define o início da geração no modo Manual.

Bandwidth Extender adiciona cerca de 26,7-29,0 ms de latência, incluindo um salto extra de processamento: 1.280 amostras a 48 kHz, 2.560 a 96 kHz ou 5.120 a 192 kHz. Se não puder funcionar com a taxa de amostragem, a configuração de canais ou o dispositivo atuais, o painel informa que o plugin está em bypass e o áudio não muda. Use uma configuração compatível ou desative o plugin.

## Dynamic Saturation

Um efeito baseado na física que simula o deslocamento não linear de cones de alto-falantes sob diferentes condições. Ao modelar o comportamento mecânico de um alto-falante e depois aplicar saturação a esse deslocamento, ele cria uma forma única de distorção que responde dinamicamente à sua música.

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para comparar configurações completas do movimento do cone.

- **Subtle Cone Color** - Um caráter de cone de alto-falante discreto e quase sem distorção.
- **Pushed Speaker** - Movimento do cone e saturação mais intensos, com compensação do nível de saída.
- **Ragged Cone** - O caráter de cone mais acentuado, com uma aspereza intencional.

### Guia de Aprimoramento da Audição
- **Aprimoramento Sutil:**
  - Adiciona calor suave e comportamento de picos levemente arredondados
  - Cria um som natural de "alto-falante empurrado" sem distorção óbvia
  - Adiciona movimento e profundidade sutis ao som
- **Efeito Moderado:**
  - Cria uma distorção mais dinâmica e responsiva
  - Adiciona movimento único e vivacidade a passagens sustentadas
  - Dá aos transientes um caráter móvel e responsivo
- **Efeito Criativo:**
  - Produz padrões de distorção complexos que evoluem com a entrada
  - Cria comportamentos ressonantes, semelhantes a alto-falantes
  - Cria caráter marcante e em evolução para escuta experimental

### Parâmetros
- **Speaker Drive** (0.0-10.0) - Controla quão fortemente o sinal de áudio move o cone
  - Valores baixos: Movimento sutil e efeito suave
  - Valores altos: Movimento dramático e caráter mais forte
- **Speaker Stiffness** (0.0-10.0) - Simula a rigidez da suspensão do cone
  - Valores baixos: Movimento livre e solto com decay mais longo
  - Valores altos: Movimento controlado e firme com resposta rápida
- **Speaker Damping** (0.1-10.0) - Controla quão rapidamente o movimento do cone se estabiliza
  - Valores baixos próximos de 0.1: Vibração e ressonância prolongadas
  - Valores altos: Amortecimento rápido para som controlado
- **Speaker Mass** (0.1-5.0) - Simula a inércia do cone
  - Valores baixos: Movimento rápido e responsivo
  - Valores altos: Movimento mais lento e mais pronunciado
- **Distortion Drive** (0.0-10.0) - Controla a intensidade da saturação de deslocamento
  - Valores baixos: Não-linearidade sutil
  - Valores altos: Caráter de saturação forte
- **Distortion Bias** (-1.0-1.0) - Ajusta a simetria da curva de saturação
  - Zero: Saturação simétrica
  - Positivo/Negativo: Adiciona caráter assimétrico mudando qual lado do deslocamento satura mais fortemente
- **Distortion Mix** (0-100%) - Mistura entre deslocamento linear e saturado
  - Valores baixos: Resposta mais linear
  - Valores altos: Caráter mais saturado
- **Cone Motion Mix** (0-100%) - Controla quanto o movimento do cone afeta o som original
  - Valores baixos: Aprimoramento sutil
  - Valores altos: Efeito dramático
- **Output Gain** (-18.0-18.0dB) - Ajusta o nível de saída final

### Exibição Visual
- Gráfico ao vivo de curva de transferência mostrando como o deslocamento está sendo saturado
- Feedback visual claro das características de distorção
- Representação visual de como o Distortion Drive e o Bias afetam o som

### Dicas de Aprimoramento Musical
- Para Calor Sutil:
  - Speaker Drive: 2.0-3.0
  - Speaker Stiffness: 1.5-2.5
  - Speaker Damping: 0.5-1.5
  - Distortion Drive: 1.0-2.0
  - Cone Motion Mix: 20-40%
  - Distortion Mix: 30-50%

- Para Caráter Dinâmico:
  - Speaker Drive: 3.0-5.0
  - Speaker Stiffness: 2.0-4.0
  - Speaker Mass: 0.5-1.5
  - Distortion Drive: 3.0-6.0
  - Distortion Bias: Tente ±0.2 para caráter assimétrico
  - Cone Motion Mix: 40-70%

- Para Efeito Experimental Forte:
  - Speaker Drive: 6.0-10.0
  - Speaker Stiffness: Tente valores extremos (muito baixos ou altos)
  - Speaker Mass: 2.0-5.0 para movimento exagerado
  - Distortion Drive: 5.0-10.0
  - Experimente com valores de Bias
  - Cone Motion Mix: 70-100%

### Guia de Início Rápido
1. Comece com Speaker Drive moderado (3.0) e Stiffness (2.0)
2. Ajuste Speaker Damping para controlar a ressonância (1.0 para resposta equilibrada)
3. Ajuste Distortion Drive a gosto (3.0 para efeito moderado)
4. Defina Distortion Bias em 0.0 primeiro para saturação simétrica
5. Ajuste Distortion Mix para 50% e Cone Motion Mix para 50%
6. Ajuste Speaker Mass para mudar o caráter do efeito
7. Faça ajustes finos com Output Gain para equilibrar os níveis

## Exciter

Um efeito que adiciona conteúdo harmônico para melhorar a clareza e presença. Ao filtrar o conteúdo de alta frequência e aplicar saturação, ele cria harmônicos adicionais que iluminam e aprimoram sua música.

### Guia de Aprimoramento da Audição
- **Aprimoramento Sutil:**
  - Adiciona clareza e ar a vozes e detalhes de alta frequência
  - Melhora a presença no sinal de reprodução inteiro
  - Cria um som mais aberto e detalhado
- **Efeito Moderado:**
  - Traz à tona detalhes ocultos na gravação
  - Adiciona brilho e brilhantismo
  - Faz a música soar mais "hi-fi"
- **Efeito Criativo:**
  - Cria tons brilhantes e cortantes
  - Adiciona presença agressiva
  - Útil quando você quer um som mais brilhante e mais à frente, mas deve ser usado com moderação

### Parâmetros
- **HPF Freq** (500-10000Hz) - Define a frequência de corte para filtragem passa-alta
  - Valores baixos (500-2000Hz): Afeta mais do sinal
  - Valores médios (2000-5000Hz): Visa frequências de presença
  - Valores altos (5000-10000Hz): Foca no ar e brilhantismo
- **HPF Slope** - Controla a inclinação do filtro
  - Off: Sem filtragem, processa espectro completo
  - 6dB/oct: Filtragem suave
  - 12dB/oct: Filtragem mais acentuada
- **Drive** (0.0-10.0) - Controla a intensidade da saturação
  - Leve (0.0-3.0): Aprimoramento harmônico sutil
  - Médio (3.0-6.0): Brilho notável
  - Alto (6.0-10.0): Excitação forte
- **Bias** (-0.3 a 0.3) - Ajusta a assimetria da saturação
  - Zero: Saturação simétrica
  - Positivo/Negativo: Adiciona caráter assimétrico mudando qual lado do realce gerado satura mais fortemente
- **Mix** (0-100%) - Controla quanto realce harmônico gerado é adicionado ao som original
  - Baixo (0-30%): Brilho sutil adicionado
  - Médio (30-60%): Presença e detalhe mais claros
  - Alto (60-100%): Harmônicos fortes adicionados; use com cuidado para evitar aspereza

### Exibição Visual
- Gráfico de resposta de frequência do filtro passa-alta
- Visualização da curva de transferência de saturação
- Feedback visual claro para filtro e saturação

### Dicas de Aprimoramento Musical
- Para Vozes Mais Claras em Músicas, Podcasts ou Vídeos:
  - HPF Freq: 3000-5000Hz
  - HPF Slope: 6dB/oct
  - Drive: 2.0-4.0
  - Bias: 0.05 a 0.1
  - Mix: 20-40%

- Para Detalhes Médios/Agudos Mais Claros em Gravações Cheias:
  - HPF Freq: 2000-4000Hz
  - HPF Slope: 12dB/oct
  - Drive: 3.0-5.0
  - Bias: 0.0
  - Mix: 30-50%

- Para Brilho Sutil na Faixa Completa:
  - HPF Freq: 5000-8000Hz
  - HPF Slope: 6dB/oct
  - Drive: 1.0-3.0
  - Bias: 0.0 a 0.1
  - Mix: 10-25%

### Guia de Início Rápido
1. Defina HPF Freq para visar a faixa de frequência desejada
2. Escolha HPF Slope (comece com 6dB/oct)
3. Comece com Drive moderado (3.0)
4. Defina Bias perto de 0.1 para um caráter levemente assimétrico
5. Defina Mix para 25% e ajuste a gosto
6. Faça ajustes finos em todos os parâmetros enquanto escuta

## Hard Clipping

Um efeito de clipping digital que limita picos acima de um threshold definido. Use quando quiser mais borda, densidade ou distorção criativa; mantenha o threshold alto para controle leve de picos e abaixe aos poucos para caráter mais forte.

### Guia de Aprimoramento da Audição
- Aprimoramento Sutil:
  - Adiciona um pouco de borda e densidade quando Threshold permanece alto
  - Pode aparar picos agudos quando usado de leve
  - Compare com bypass, porque clipping pode ficar áspero quando levado longe demais
- Efeito Moderado:
  - Cria um som mais energético
  - Adiciona empolgação aos elementos rítmicos
  - Faz a música parecer mais "impulsionada"
- Efeito Criativo:
  - Cria transformações dramáticas do som
  - Adiciona caráter agressivo à música
  - Perfeito para audição experimental

### Parâmetros
- **Threshold** - Controla quanto do som é afetado (-60dB a 0dB)
  - Valores mais altos (-6dB a 0dB): Controle leve de picos ou borda sutil
  - Valores médios (-24dB a -6dB): Caráter e densidade de clipping notáveis
  - Valores mais baixos (-60dB a -24dB): Distorção pesada e efeito dramático
- **Mode** - Escolhe quais partes do som afetar
  - Both Sides: Clipa picos positivos e negativos simetricamente; modo mais previsível
  - Positive Only: Clipa apenas picos positivos, criando clipping assimétrico e caráter tonal diferente
  - Negative Only: Clipa apenas picos negativos, criando clipping assimétrico com sensação diferente de Positive Only

### Exibição Visual
- Gráfico em tempo real mostrando como o som está sendo moldado
- Feedback visual claro ao ajustar configurações
- Linhas de referência para ajudar a guiar seus ajustes

### Dicas de Audição
- Para aprimoramento sutil:
  1. Comece com Threshold em 0dB
  2. Use o modo "Both Sides"
  3. Abaixe gradualmente em direção a -3dB a -6dB e pare quando o efeito ficar apenas audível
- Para efeitos criativos:
  1. Diminua o Threshold gradualmente
  2. Experimente diferentes Modes
  3. Combine com outros efeitos para sons únicos
   
## Harmonic Distortion

O plugin Harmonic Distortion molda a forma de onda com termos não lineares ajustáveis de 2ª a 5ª ordem. Ele permite ajustar o caráter de distorção par e ímpar, de calor sutil a coloração mais forte, ajudando músicas limpas, finas ou achatadas demais a soarem mais vivas.

### Guia de Aperfeiçoamento Auditivo
- **Efeito Sutil:**
  - Adiciona uma camada suave de calor harmônico
  - Realça o tom natural sem sobrecarregar o sinal original
  - Ideal para adicionar uma profundidade sutil, semelhante ao analógico
- **Efeito Moderado:**
  - Adiciona caráter harmônico mais pronunciado
  - Pode adicionar corpo, brilho ou borda à gravação inteira
  - Útil quando o som parece achatado ou contido demais
- **Efeito Agressivo:**
  - Intensifica vários termos não lineares para uma distorção rica e complexa
  - Cria texturas marcantes para escuta experimental
  - Pode soar áspero ou não convencional quando exagerado
- **Valores Positivos vs. Negativos:**
  - Valores positivos e negativos invertem a direção de cada termo não linear
  - Termos de ordem par mudam principalmente a assimetria e a cor tonal
  - Termos de ordem ímpar mudam principalmente o caráter da distorção simétrica
   
### Parâmetros
- **2nd Harm (%):** Define o termo de distorção de 2ª ordem (-30 a 30%, padrão: 2%)
- **3rd Harm (%):** Define o termo de distorção de 3ª ordem (-30 a 30%, padrão: 3%)
- **4th Harm (%):** Define o termo de distorção de 4ª ordem (-30 a 30%, padrão: 0.5%)
- **5th Harm (%):** Define o termo de distorção de 5ª ordem (-30 a 30%, padrão: 0.3%)
- **Sensitivity (x):** Ajusta a sensibilidade geral da entrada (0.1-2.0, padrão: 0.5)
  - Uma sensibilidade menor proporciona um efeito mais discreto
  - Uma sensibilidade maior aumenta a intensidade da distorção
  - Funciona como um controle global que afeta a intensidade da modelagem não linear
   
### Exibição Visual
- Curva de transferência mostrando como níveis de entrada são moldados em níveis de saída
- Controles deslizantes e campos de entrada intuitivos que fornecem feedback imediato
- O gráfico é atualizado conforme as configurações de harmônicos e Sensitivity mudam
   
### Guia de Início Rápido
1. **Inicialização:** Inicie com as configurações padrão (2nd: 2%, 3rd: 3%, 4th: 0.5%, 5th: 0.3%, Sensitivity: 0.5)
2. **Ajuste os Parâmetros:** Altere um ou dois controles harmônicos por vez enquanto escuta por aspereza ou perda de clareza
3. **Misture Seu Som:** Equilibre o efeito utilizando o Sensitivity para alcançar ou um calor sutil ou uma distorção acentuada

## Multiband Saturation

Um efeito versátil que permite adicionar calor e caráter a faixas de frequência específicas do sinal de reprodução inteiro. Ao dividir o som em bandas Low, Mid e High, você pode moldar cada faixa independentemente para um aprimoramento preciso do som.

### Guia de Aprimoramento da Audição
- Calor nas Baixas Frequências:
  - Adiciona calor e punch às frequências baixas
  - Adiciona plenitude e punch suave à faixa de baixas frequências do sinal inteiro
  - Cria graves mais cheios e ricos
- Clareza nos Médios:
  - Adiciona corpo e definição aos médios, onde muitas vozes e instrumentos estão presentes
  - Ajuda gravações cheias a soarem mais claras
  - Cria um som mais claro e definido
- Aprimoramento dos Agudos:
  - Adiciona brilho à faixa de altas frequências
  - Aprimora o ar e o brilho
  - Cria agudos nítidos e detalhados

Como este efeito processa bandas de frequência, ele afeta todos os sons na faixa selecionada, não instrumentos ou vocais isolados.

### Parâmetros
- **Crossover Frequencies**
  - Freq 1 (20Hz-2kHz): Define onde a banda baixa termina e a média começa
  - Freq 2 (200Hz-20kHz, sempre mantido em Freq 1 ou acima): Define onde a banda média termina e a alta começa
  - Se Freq 2 for ajustado abaixo de Freq 1, ele é elevado automaticamente para preservar a ordem low-mid-high das bandas
- **Band Controls** (para cada banda Low, Mid e High):
  - **Drive** (0.0-10.0): Controla a intensidade da saturação
    - Leve (0.0-3.0): Aprimoramento sutil
    - Médio (3.0-6.0): Calor notável
    - Alto (6.0-10.0): Caráter forte
  - **Bias** (-0.3 a 0.3): Ajusta a simetria da curva de saturação
    - Zero: Saturação simétrica
    - Positivo/Negativo: Adiciona caráter assimétrico mudando qual lado da forma de onda satura mais fortemente
  - **Mix** (0-100%): Mistura o efeito com o original
    - Baixo (0-30%): Aprimoramento sutil
    - Médio (30-70%): Efeito equilibrado
    - Alto (70-100%): Caráter forte
  - **Gain** (-18dB a +18dB): Ajusta o volume da banda
    - Usado para equilibrar as bandas entre si
    - Compensa mudanças de volume

### Exibição Visual
- Abas interativas de seleção de banda
- Gráfico de curva de transferência em tempo real para cada banda
- Feedback visual claro ao ajustar configurações

### Dicas de Aprimoramento Musical
- Para Aprimoramento Geral da Mixagem:
  1. Comece com Drive suave (2.0-3.0) em todas as bandas
  2. Defina Bias em 0.0 para saturação natural
  3. Ajuste Mix em torno de 40-50% para mistura natural
  4. Ajuste fino do Gain para cada banda

- Para Calor nas Baixas Frequências:
  1. Foque na banda baixa
  2. Use Drive moderado (3.0-5.0)
  3. Mantenha Bias neutro para resposta consistente
  4. Mantenha Mix em torno de 50-70%

- Para Presença nos Médios:
  1. Foque na banda média
  2. Use Drive leve (1.0-3.0)
  3. Defina Bias em 0.0 para som natural
  4. Ajuste Mix a gosto (30-50%)

- Para Adicionar Brilho:
  1. Foque na banda alta
  2. Use Drive suave (1.0-2.0)
  3. Mantenha Bias neutro para saturação limpa
  4. Mantenha Mix sutil (20-40%)

### Guia de Início Rápido
1. Ajuste as frequências de crossover para dividir seu som
2. Comece com valores baixos de Drive em todas as bandas
3. Defina Bias em 0.0 primeiro para saturação simétrica
4. Use Mix para misturar o efeito naturalmente
5. Ajuste fino com controles de Gain
6. Confie em seus ouvidos e ajuste a gosto!

## Saturation

Um efeito que simula o som quente e agradável de equipamentos valvulados vintage. Pode adicionar riqueza e caráter à sua música, fazendo-a soar mais "analógica" e menos "digital".

### Guia de Aprimoramento da Audição
- Adicionando Calor:
  - Faz a música digital soar mais natural
  - Adiciona riqueza agradável ao som
  - Perfeito para jazz e música acústica
- Caráter Rico:
  - Cria um som mais "vintage"
  - Adiciona profundidade e dimensão
  - Ótimo para rock e música eletrônica
- Efeito Forte:
  - Transforma o som dramaticamente
  - Cria tons ousados e cheios de caráter
  - Ideal para audição experimental

### Parâmetros
- **Drive** - Controla a quantidade de calor e caráter (0.0 a 10.0)
  - Leve (0.0-3.0): Calor analógico sutil
  - Médio (3.0-6.0): Caráter vintage rico
  - Forte (6.0-10.0): Efeito ousado e dramático
- **Bias** - Ajusta a assimetria da curva de saturação (-0.3 a 0.3)
  - 0.0: Saturação simétrica
  - Positivo: Deixa o lado negativo da forma de onda mais proeminente
  - Negativo: Deixa o lado positivo da forma de onda mais proeminente
- **Mix** - Equilibra o efeito com o som original (0% a 100%)
  - 0-30%: Aprimoramento sutil
  - 30-70%: Efeito equilibrado
  - 70-100%: Caráter forte
- **Gain** - Ajusta o volume geral (-18dB a +18dB)
  - Use valores negativos se o efeito estiver muito alto
  - Use valores positivos se o efeito estiver muito baixo

### Exibição Visual
- Gráfico claro mostrando como o som está sendo moldado
- Feedback visual em tempo real
- Controles fáceis de ler

### Dicas de Aprimoramento Musical
- Clássica & Jazz:
  - Drive leve (1.0-2.0) para calor natural
  - Defina Bias em 0.0 para saturação limpa
  - Mix baixo (20-40%) para sutileza
- Rock & Pop:
  - Drive médio (3.0-5.0) para caráter rico
  - Mantenha Bias neutro para resposta consistente
  - Mix médio (40-60%) para equilíbrio
- Eletrônica:
  - Drive mais alto (4.0-7.0) para efeito ousado
  - Experimente com diferentes valores de Bias
  - Mix mais alto (60-80%) para caráter

### Guia de Início Rápido
1. Comece com Drive baixo para calor suave
2. Defina Bias em 0.0 primeiro para saturação simétrica
3. Ajuste Mix para equilibrar o efeito
4. Ajuste Gain se necessário para volume adequado
5. Experimente e confie em seus ouvidos!

## Sub Synth

Um efeito especializado que reforça os graves misturando um sinal filtrado de baixa frequência derivado do áudio original. Útil quando músicas com pouco grave precisam de mais calor, plenitude ou impacto agradável em fones.

### Guia de Aprimoramento da Audição
- Aprimoramento dos Graves:
  - Adiciona profundidade e potência a gravações finas
  - Cria graves mais cheios e ricos
  - Perfeito para audição com fones de ouvido
- Controle de Frequência:
  - Controle de qual faixa adicional de baixa frequência é preservada
  - Filtragem independente para graves limpos
  - Mantém a clareza enquanto adiciona potência

### Parâmetros
- **Sub Level** - Controla o nível do sinal adicional de baixa frequência (0-200%)
  - Leve (0-50%): Aprimoramento sutil dos graves
  - Médio (50-100%): Reforço equilibrado dos graves
  - Alto (100-200%): Efeito dramático nos graves
- **Dry Level** - Ajusta o nível do sinal original (0-200%)
  - Usado para equilibrar com o sinal adicional de baixa frequência
  - Mantém a clareza do som original
- **Sub LPF** - Filtro passa-baixas para o sinal adicional de baixa frequência (5-400Hz)
  - Frequency: Controla o limite superior do sinal adicional de baixa frequência
  - Inclinação: Ajusta a inclinação do filtro (Off a -24dB/oct)
- **Sub HPF** - Filtro passa-altas para o sinal adicional de baixa frequência (5-400Hz)
  - Frequency: Remove rumble indesejado do sinal adicional de baixa frequência
  - Inclinação: Controla a inclinação do filtro (Off a -24dB/oct)
- **Dry HPF** - Filtro passa-altas para sinal original (5-400Hz)
  - Frequência: Previne acúmulo de graves
  - Inclinação: Ajusta a inclinação do filtro (Off a -24dB/oct)

### Exibição Visual
- Gráfico ao vivo de resposta em frequência
- Visualização clara das curvas de filtro
- Feedback visual em tempo real

### Dicas de Aprimoramento Musical
- Para Aprimoramento Geral dos Graves:
  1. Comece com Sub Level em 50%
  2. Ajuste Sub LPF em torno de 100Hz (-12dB/oct)
  3. Mantenha Sub HPF em 20Hz (-6dB/oct)
  4. Ajuste Dry Level a gosto

- Para Reforço Limpo dos Graves:
  1. Ajuste Sub Level para 70-100%
  2. Use Sub LPF em 80Hz (-18dB/oct)
  3. Ajuste Sub HPF para 30Hz (-12dB/oct)
  4. Ajuste Dry HPF para 40Hz (-6dB/oct)

- Para Máximo Impacto:
  1. Aumente Sub Level para 150%
  2. Ajuste Sub LPF para 120Hz (-24dB/oct)
  3. Mantenha Sub HPF em 15Hz (-6dB/oct)
  4. Equilibre com Dry Level

### Guia de Início Rápido
1. Comece com Sub Level moderado (50-70%)
2. Ajuste Sub LPF em torno de 100Hz
3. Ative Sub HPF em torno de 20Hz (-6dB/oct)
4. Ajuste Dry Level para equilíbrio
5. Ajuste fino dos filtros conforme necessário
6. Confie em seus ouvidos e ajuste gradualmente!

## Tube Simulator

O Tube Simulator acrescenta os harmônicos, a compressão e a resposta da fonte de alimentação que variam com o sinal em circuitos valvulados de linha e de potência. **Line** usa apenas o estágio driver, **Push-Pull Power** oferece circuitos balanceados com EL84, EL34, 6L6GC e KT88, e **SE Triode** oferece circuitos single-ended com 300B e 2A3. Os dois circuitos de potência também modelam o núcleo do transformador de saída, cuja saturação magnética e histerese acrescentam distorção nos graves em alto volume. Ele modela a carga elétrica do alto-falante vista pelo amplificador, mas não acrescenta o som de uma caixa acústica ou de um microfone.

### Guia de Ajuste para Audição

- Para uma coloração discreta, escolha no grupo **Pre** um preset com o sufixo **@0.01%** ou **@0.1%**. Use o sufixo **@1%** ou **@2%** quando quiser perceber os harmônicos e a compressão com mais facilidade.
- Escolha **Pre** para o som do estágio de linha, **Power** apenas para o estágio de saída ou **Pre+Power** para o caminho completo do amplificador.
- Comece com **EL84 Distributed 10 W @2%** para um som push-pull contido. Compare com **EL84 Pentode 10 W @2%** para uma apresentação mais firme e direta.
- Experimente **300B SE @2%** ou **2A3 SE @2%** para obter harmônicos pares mais fortes e uma resposta single-ended mais suave.
- Se o som ficar comprimido ou distorcido demais, reduza **Input Volume** e depois iguale o volume de audição com **Output Trim**.
- Reduza **Negative Feedback** para uma resposta mais solta e rica em harmônicos; aumente-o para maior controle. Em SE Triode, comece em 3dB e normalmente permaneça perto de 0–6dB.
- Reduza **Wet/Dry Mix** quando quiser apenas um toque do efeito.

### Organização do Painel

Os controles estão distribuídos em cinco abas.

- **Input** - Input Volume, Input Reference, Source Z
- **Driver** - Driver Type, Bias, Plate, Supply, Negative Feedback
- **Power** - Output Circuit; Power Tubes, Output B+ e Cathode Resistor para push-pull; SE Triode, SE B+ e SE Cathode Resistor para single-ended
- **Transformer** - Screen Tap, Push-Pull Primary, SE Primary, Assumed Speaker Load, Actual Speaker Load
- **Output** - Output Trim, Output Safety Trim, Auto Gain Reduction, Wet/Dry Mix

As abas Power e Transformer mostram apenas os controles usados pelo Output Circuit selecionado.

### Escolha de Preset

Clique no botão **Predefinições de efeito** do cabeçalho do efeito para abrir a caixa de diálogo de presets. Escolha uma configuração de Predefinições do sistema no grupo Pre, Power ou Pre+Power para aplicá-la imediatamente. O preset que corresponde às configurações atuais fica destacado; se nenhum corresponder, nenhum preset fica destacado. As configurações iniciais correspondem a **EL84 Pentode @2%**. **Output Safety Trim** e **Auto Gain Reduction** não são usados na correspondência, portanto alterá-los não remove o destaque.

O sufixo do preset é uma referência prática da intensidade do efeito: **@0.01%** é muito discreto, **@0.1%** acrescenta uma coloração leve e **@1%** ou **@2%** tornam os harmônicos e a compressão mais evidentes. Os presets também ajustam Output Trim para facilitar a comparação, mas o volume percebido pode variar com a música. Iguale os volumes com Output Trim antes de escolher o som preferido.

### Parâmetros

- **Input Volume** (-96 a 0dB) - Reduz o nível que alimenta o circuito escolhido. Valores menores diminuem a compressão e a distorção e aumentam a margem.
- **Driver Type** (12AX7, 12AT7, 12AU7 ou Bypass) - Seleciona as válvulas do driver de dois estágios ou o remove do caminho. A 12AX7 tem o maior ganho, a 12AT7 é intermediária e a 12AU7 tem o menor ganho e a maior margem.
- **Bias** (-50 a +50%) - Desloca o ponto de polarização do driver. Aumentar move os estágios para maior corrente; reduzir faz o contrário, mudando os harmônicos e a compressão.
- **Plate** (150 a 300 V) - Ajusta a tensão de placa do driver. Valores maiores geralmente oferecem mais margem; valores menores antecipam a compressão e a não linearidade.
- **Source Z** (0.6 a 100 kΩ) - Ajusta a impedância da fonte que alimenta o primeiro estágio. Valores maiores podem suavizar os agudos e os transientes.
- **Supply** (0.1 a 47 kΩ) - Ajusta a resistência da fonte do driver. Valores maiores produzem mais queda de alimentação; valores menores tornam a resposta mais firme.
- **Negative Feedback** (0 a 30dB) - Ajusta a realimentação negativa global. Aumentar geralmente reduz a distorção e reforça o controle da resposta e do alto-falante; 0dB abre o laço.
- **Output Trim** (-48 a +48dB) - Iguala o volume processado sem mudar a excitação dentro do circuito.
- **Output Safety Trim** (-96 a 0dB) - É um ajuste de nível separado para a proteção de saída. Auto Gain Reduction reduz somente este controle, não Output Trim.
- **Auto Gain Reduction** (ativado por padrão) - Reduz automaticamente Output Safety Trim quando a saída processada se aproxima do máximo digital. Ao desativá-lo, nenhuma nova redução é aplicada, mas a redução existente permanece.
- **Wet/Dry Mix** (0 a 100%) - Mistura o sinal processado com o original. Valores menores deixam o efeito mais discreto.
- **Input Reference** (0.100 a 300.000 Vpk) - Define a tensão de entrada representada por um pico digital de escala completa. Valores maiores excitam mais o circuito; use Input Volume para o ajuste principal de intensidade.
- **Output Circuit** (Line, Push-Pull Power ou SE Triode) - Seleciona a topologia. Line usa apenas o driver; os outros modos incluem o estágio de potência, o transformador e a carga do alto-falante.
- **Power Tubes** (EL84 ×2, EL34 ×2, 6L6GC ×2 ou KT88 ×2) - Seleciona as válvulas de saída push-pull e seu caráter.
- **Output B+** (300 a 470 V) - Ajusta a alimentação do estágio push-pull. Valores maiores aumentam a excursão disponível e a margem das válvulas.
- **Cathode Resistor** (270 a 500 Ω / valve) - Ajusta a resistência de polarização de cada válvula push-pull. Valores maiores reduzem a corrente de repouso; valores menores a aumentam.
- **SE Triode** (300B ou 2A3) - Seleciona a válvula de saída single-ended.
- **SE B+** (250 a 450 V) - Ajusta a alimentação do estágio single-ended.
- **SE Cathode Resistor** (700 a 1300 Ω) - Ajusta a resistência de polarização da válvula single-ended, alterando o ponto de operação e a compressão.
- **Screen Tap** (0%, 20% ou 43%) - Seleciona a ligação da grade de tela. 0% produz operação pentodo; 20% e 43% produzem carga distribuída.
- **Push-Pull Primary** (6.0, 6.6 ou 8.0 kΩ) - Define a impedância primária do transformador push-pull e altera a carga e a resposta das válvulas. A escolha também define o fluxo de saturação magnética do núcleo.
- **SE Primary** (2.5, 3.5 ou 5.0 kΩ) - Define a impedância primária do transformador single-ended. A escolha também define quanto fluxo um dado sinal envia para o núcleo com entreferro, de modo que impedâncias mais altas chegam à saturação mais cedo no mesmo nível. A corrente de repouso do funcionamento single-ended mantém um fluxo permanente no núcleo, de modo que o sinal o satura de forma assimétrica e acrescenta harmônicos de ordem par nos graves.
- **Assumed Speaker Load** (4, 8, 15 ou 16 Ω) - Seleciona a impedância nominal e a tomada do secundário para as quais o circuito foi projetado.
- **Actual Speaker Load** (2 a 32 Ω) - Define a impedância do alto-falante realmente conectado. Se ela for diferente de Assumed Speaker Load, mudam a carga refletida às válvulas, o amortecimento e a potência disponível; valores iguais correspondem ao ponto de projeto.

### Proteção do Nível de Saída

Alterar parâmetros do circuito pode causar um grande salto de nível. Com **Auto Gain Reduction** ativado, o Tube Simulator reduz **Output Safety Trim** quando a saída processada ultrapassaria a escala digital. A redução permanece em vez de voltar automaticamente e aparece no status abaixo do gráfico.

- Se a redução ficar grande, diminua Input Volume ou Output Trim e depois selecione novamente um preset ou ajuste Output Safety Trim.
- Desative Auto Gain Reduction somente quando já estiver acompanhando os picos de saída em outro lugar.
- A proteção reduz o nível de saída; ela não remove os harmônicos nem a compressão criados dentro do circuito.

### Bypass de Segurança e Recuperação

- Se um ajuste instável ativar o bypass, reduza Negative Feedback ou selecione um preset. O sinal processado volta automaticamente quando o ajuste fica estável.
- Se o status continuar indicando bypass, restaure um preset e recarregue o efeito. Quando o processamento não estiver disponível no dispositivo, o áudio passa sem alterações.

### Como Ler o HUD

- Os pontos mostram posições de operação recentes. Quanto mais espalhados, mais intensamente a música está excitando aquele estágio. Cada painel sobrepõe os dois canais: o azul é o esquerdo e o laranja, o direito.
- O nome da válvula representada no gráfico aparece no canto superior esquerdo.
- O **Graph**, acima do gráfico, escolhe quais válvulas observar. **Stage 1 / Stage 2** mostra os dois estágios do driver, **Push / Pull** as duas válvulas do par de saída push-pull e **SE Triode** a válvula de saída single-ended. Só é possível selecionar os estágios que o circuito atual realmente usa, então em um estágio de potência com driver você pode alternar entre os dois e compará-los.
- Quando nenhuma válvula está em operação — Line com **Driver Type** em Bypass, ou o efeito desligado — o gráfico fica vazio e o status mostra **No tube stage is active**.
- **Speaker Output** e **Speaker Real Power** indicam o quanto o estágio de potência e a carga do alto-falante estão sendo excitados.
- **Transformer Flux** mostra a magnitude do fluxo concatenado do transformador de saída em Wb. Quanto mais os graves empurram essa leitura para cima, mais distorção o próprio transformador acrescenta. Em SE Triode a leitura inclui o fluxo de polarização permanente do núcleo com entreferro e, por isso, permanece acima de zero mesmo sem sinal.
- O status abaixo do gráfico informa se o efeito está ativo ou em bypass e mostra qualquer redução automática de saída.

O Tube Simulator acrescenta um pequeno atraso de processamento de aproximadamente 0.3 a 1.5ms, conforme a taxa de amostragem.
