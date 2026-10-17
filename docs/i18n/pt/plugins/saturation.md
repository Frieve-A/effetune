---
title: "Plugins de Saturação - Simulador de amplificador valvulado, exciter e extensão de graves - EffeTune"
description: "Simulação de amplificador valvulado, Saturation, Exciter e Harmonic Distortion; Bandwidth Extender e Bass Extender geram novos agudos e graves."
lang: pt
---

# Plugins de Saturação

Uma coleção de plugins para modelar harmônicos e restaurar largura de banda. Eles podem acrescentar calor ou distorção, ou gerar conteúdo contido nos agudos quando uma gravação tem um limite de banda evidente.

## Lista de Plugins

- [Bandwidth Extender](#bandwidth-extender) - Gera agudos acima de um corte detectado ou definido
- [Bass Extender](#bass-extender) - Gera graves uma oitava abaixo de conteúdo adequado
- [Dynamic Saturation](#dynamic-saturation) - Simula o deslocamento não linear de cones de alto-falantes
- [Exciter](#exciter) - Adiciona conteúdo harmônico para melhorar a clareza e presença
- [Hard Clipping](#hard-clipping) - Adiciona intensidade e borda ao som
- [Harmonic Distortion](#harmonic-distortion) - Adiciona caráter com distorção não linear ajustável de 2ª a 5ª ordem
- [Multiband Saturation](#multiband-saturation) - Molda faixas de graves, médios e agudos independentemente
- [Saturation](#saturation) - Adiciona calor e riqueza como equipamentos vintage
- [Sub Synth](#sub-synth) - Adiciona um sinal filtrado de baixa frequência para reforçar os graves
- [Tube Simulator](#tube-simulator) - Modela estágios de linha valvulados e amplificadores de potência push-pull ou single-ended

<!-- spectrum-overlay -->
## Sobreposição de espectro

Pressione o ícone de espectro de um gráfico compatível para alternar entre After, Before + After e Off. After mostra apenas o espectro processado como uma linha azul. Before + After preenche a mudança entre o espectro antes e depois do processamento: a cor quente marca as frequências cujo nível aumentou após o processamento, o azul marca aquelas cujo nível diminuiu e uma linha cinza indica o espectro After. Os espectros de entrada e saída são alinhados ao mesmo instante da reprodução, para que a comparação use o mesmo áudio. O modo **Normal** aplica suavização de 1/12 de oitava; o modo **Alta qualidade** analisa as frequências baixas com mais detalhe. Use a comparação para ver como cada ajuste altera graves, médios e agudos enquanto escuta. Leia os níveis do espectro na escala dBFS à direita do gráfico. Ela é separada da escala de ganho do gráfico; 0 dBFS é a referência digital de escala completa, e valores mais baixos são mais silenciosos. Em Configuração, escolha **Normal** ou **Alta qualidade** para a qualidade do espectro sobreposto e **Valor instantâneo** ou **Retenção de pico** para a exibição. A retenção de pico mantém os máximos recentes visíveis e os reduz gradualmente. Em After, apenas o espectro processado é coletado; em Off, a coleta e o desenho são interrompidos.

## Bandwidth Extender

Bandwidth Extender destina-se a áudio com um corte claro nos agudos, como alguns arquivos MP3 de baixa taxa de bits. Ele analisa o par estéreo em conjunto e adiciona apenas conteúdo recém-gerado acima do limite detectado ou definido. Não recupera a forma de onda original que está faltando e, normalmente, fica inativo quando o modo Auto não encontra um corte estável.

A banda gerada tem duas partes ajustáveis de forma independente: continuação harmônica relacionada à entrada e ruído moldado determinístico. A continuação harmônica mantém o material tonal ligado ao espectro restante, enquanto o ruído moldado dá à percussão e a outros sons semelhantes a ruído uma textura menos artificial. O som original permanece presente enquanto esses novos componentes são adicionados.

### Guia de aprimoramento da audição

- Para músicas limitadas pelo codec, comece com **Auto** e os dois controles de quantidade no padrão de 100%.
- Se o Auto não entrar em ação apesar de haver um corte conhecido, selecione **Manual** e defina o limite na frequência de corte medida da fonte.
- Reduza **Noise Amount** em material tonal sustentado, ou **Harmonic Amount** em percussão e sons semelhantes a respiração. Mantenha ambos ativos quando a fonte tiver uma mistura dos dois.
- Compare com o bypass no mesmo nível. Aumentar qualquer uma das quantidades eleva apenas o componente gerado correspondente e não reconstrói detalhes ausentes na fonte.
- Não o use como realçador geral de brilho em áudio que já tem banda completa; o Exciter foi feito para esse outro propósito.

### Parâmetros

- **Harmonic Amount** (0-200%, padrão 100%) - Controla a continuação harmônica de forma independente. 0% remove esse componente, 100% é seu nível de referência e 200% o duplica sem alterar o ruído moldado nem o sinal seco.
- **Noise Amount** (0-200%, padrão 100%) - Controla o ruído moldado determinístico de forma independente. 0% remove esse componente, 100% é seu nível de referência e 200% o duplica sem alterar a continuação harmônica nem o sinal seco.
- **Cutoff** - Seleciona como o limite da banda ausente é escolhido.
  - **Auto** procura uma queda espectral acentuada e persistente comum ao par estéreo e reduz o efeito quando a confiança é baixa.
  - **Manual** usa o valor de Manual Cutoff. A banda gerada é mantida automaticamente dentro da faixa de frequências disponível para a reprodução.
- **Manual Cutoff** (6000-24000 Hz) - Define o início da geração no modo Manual. Ajuste-o ao limite medido da fonte, em vez de baixá-lo apenas para tornar o efeito mais evidente.

Bandwidth Extender adiciona cerca de 26,7–29,0 ms de atraso, incluindo um salto extra de processamento: 1.280 amostras a 48 kHz, 2.560 amostras a 96 kHz ou 5.120 amostras a 192 kHz. Se não puder funcionar com a taxa de amostragem, a configuração de canais ou o dispositivo atuais, o plugin informa que está em bypass e o áudio permanece inalterado. Use uma configuração compatível ou desative o plugin.

## Bass Extender

Bass Extender reforça gravações com poucos graves gerando conteúdo aproximadamente uma oitava abaixo dos graves já presentes. Ele analisa a entrada de cerca de 60–200 Hz e adiciona graves na faixa de 30–100 Hz, mantendo o sinal original. Não recupera a fundamental, o nível nem a fase originais que estão ausentes.

### Guia de aprimoramento da audição

- Comece com **Amount** no valor padrão de 25% e aumente aos poucos.
- Compare com bypass em volume semelhante. Reduza **Output** se os graves adicionados deixarem o som processado mais alto.
- Reduza **Amount** se as notas de baixo, o bumbo ou a sobreposição dos dois ficarem embolados ou irregulares.
- Use Spectrum Analyzer e Level Meter para comparar a faixa de graves adicionada e o nível de saída.
- O efeito será pequeno se seus fones ou alto-falantes não reproduzirem a faixa gerada de 30–100 Hz.

### Parâmetros

- **Amount** (0–100%, padrão: 25%) controla o nível dos graves gerados. 0% remove essa contribuição; valores maiores a tornam mais presente sem alterar diretamente o sinal original.
- **Output** (-24 a 0 dB, padrão: 0 dB) ajusta o nível final depois da adição dos graves. Reduza-o para igualar o volume ao bypass ou criar mais margem na saída.

## Dynamic Saturation

Um efeito baseado na física que simula o deslocamento não linear de cones de alto-falantes sob diferentes condições. Ao modelar o comportamento mecânico de um alto-falante e depois aplicar saturação a esse deslocamento, ele cria uma forma única de distorção que responde dinamicamente à sua música.

### Guia de aprimoramento da audição
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

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para comparar configurações completas do movimento do cone.

- **Subtle Cone Color** - Um caráter de cone de alto-falante discreto e quase sem distorção.
- **Pushed Speaker** - Movimento do cone e saturação mais intensos, com compensação do nível de saída.
- **Ragged Cone** - O caráter de cone mais acentuado, com uma aspereza intencional.

### Parâmetros

- **Oversampling** (1x, 2x, 4x, 8x; padrão 1x) - Valores maiores reduzem os sons indesejados causados pelo retorno de harmônicos de alta frequência à faixa audível, mas exigem mais CPU. Comece com 2x ou 4x; use 8x para maior redução a 48 kHz. 1x mantém o processamento original. Valores acima de 1x acrescentam um atraso de 64 amostras (cerca de 1,33 ms a 48 kHz).
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

### Exibição visual
- Gráfico ao vivo de curva de transferência mostrando como o deslocamento está sendo saturado
- Feedback visual claro das características de distorção
- Representação visual de como o Distortion Drive e o Bias afetam o som
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

### Dicas de aprimoramento musical
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

### Guia de início rápido
1. Comece com Speaker Drive moderado (3.0) e Stiffness (2.0)
2. Ajuste Speaker Damping para controlar a ressonância (1.0 para resposta equilibrada)
3. Ajuste Distortion Drive a gosto (3.0 para efeito moderado)
4. Defina Distortion Bias em 0.0 primeiro para saturação simétrica
5. Ajuste Distortion Mix para 50% e Cone Motion Mix para 50%
6. Ajuste Speaker Mass para mudar o caráter do efeito
7. Faça ajustes finos com Output Gain para equilibrar os níveis

## Exciter

Um efeito que adiciona conteúdo harmônico para melhorar a clareza e presença. Ao filtrar o conteúdo de alta frequência e aplicar saturação, ele cria harmônicos adicionais que iluminam e aprimoram sua música.

### Guia de aprimoramento da audição
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

- **Oversampling** (1x, 2x, 4x, 8x; padrão 1x) - Valores maiores reduzem os sons indesejados causados pelo retorno de harmônicos de alta frequência à faixa audível, mas exigem mais CPU. Comece com 2x ou 4x; use 8x para maior redução a 48 kHz. 1x mantém o processamento original. Valores acima de 1x acrescentam um atraso de 64 amostras (cerca de 1,33 ms a 48 kHz).
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

### Exibição visual
- Gráfico de resposta de frequência do filtro passa-alta
- Visualização da curva de transferência de saturação
- Feedback visual claro para filtro e saturação
- Passe o cursor sobre qualquer um dos gráficos, ou toque e arraste, para ler os valores nesse ponto.

### Dicas de aprimoramento musical
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

### Guia de início rápido
1. Defina HPF Freq para visar a faixa de frequência desejada
2. Escolha HPF Slope (comece com 6dB/oct)
3. Comece com Drive moderado (3.0)
4. Defina Bias perto de 0.1 para um caráter levemente assimétrico
5. Defina Mix para 25% e ajuste a gosto
6. Faça ajustes finos em todos os parâmetros enquanto escuta

## Hard Clipping

Um efeito de clipping digital que limita picos acima de um threshold definido. Use quando quiser mais borda, densidade ou distorção criativa; mantenha o threshold alto para controle leve de picos e abaixe aos poucos para caráter mais forte.

### Guia de aprimoramento da audição
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

- **Oversampling** (1x, 2x, 4x, 8x, 16x; padrão 1x) - Valores maiores reduzem os sons indesejados causados pelo retorno de harmônicos de alta frequência à faixa audível, mas exigem mais CPU. Comece com 2x ou 4x; use 16x para maior redução a 48 kHz. 1x mantém o processamento original. Valores acima de 1x acrescentam um atraso de 64 amostras (cerca de 1,33 ms a 48 kHz).
- **Threshold** - Controla quanto do som é afetado (-60dB a 0dB)
  - Valores mais altos (-6dB a 0dB): Controle leve de picos ou borda sutil
  - Valores médios (-24dB a -6dB): Caráter e densidade de clipping notáveis
  - Valores mais baixos (-60dB a -24dB): Distorção pesada e efeito dramático
- **Mode** - Escolhe quais partes do som afetar
  - Both Sides: Clipa picos positivos e negativos simetricamente; modo mais previsível
  - Positive Only: Clipa apenas picos positivos, criando clipping assimétrico e caráter tonal diferente
  - Negative Only: Clipa apenas picos negativos, criando clipping assimétrico com sensação diferente de Positive Only

### Exibição visual
- Gráfico em tempo real mostrando como o som está sendo moldado
- Feedback visual claro ao ajustar configurações
- Linhas de referência para ajudar a guiar seus ajustes
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

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

### Guia de aprimoramento da audição
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

- **Oversampling:** Escolhe o multiplicador da taxa de processamento (1x, 2x, 4x, 8x, padrão: 1x). Valores maiores reduzem os sons indesejados causados pelo retorno de harmônicos de alta frequência à faixa audível, mas exigem mais CPU. Comece com 2x ou 4x; use 8x para maior redução a 48 kHz. 1x mantém o processamento original. Valores acima de 1x acrescentam um atraso de 64 amostras (cerca de 1,33 ms a 48 kHz).
- **2nd Harm (%):** Define o termo de distorção de 2ª ordem (-30 a 30%, padrão: 2%)
- **3rd Harm (%):** Define o termo de distorção de 3ª ordem (-30 a 30%, padrão: 3%)
- **4th Harm (%):** Define o termo de distorção de 4ª ordem (-30 a 30%, padrão: 0.5%)
- **5th Harm (%):** Define o termo de distorção de 5ª ordem (-30 a 30%, padrão: 0.3%)
- **Sensitivity (x):** Ajusta a sensibilidade geral da entrada (0.1-2.0, padrão: 0.5)
  - Uma sensibilidade menor proporciona um efeito mais discreto
  - Uma sensibilidade maior aumenta a intensidade da distorção
  - Funciona como um controle global que afeta a intensidade da modelagem não linear
   
### Exibição visual
- Curva de transferência mostrando como níveis de entrada são moldados em níveis de saída
- Controles deslizantes e campos de entrada intuitivos que fornecem feedback imediato
- O gráfico é atualizado conforme as configurações de harmônicos e Sensitivity mudam
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.
   
### Guia de início rápido
1. **Inicialização:** Inicie com as configurações padrão (2nd: 2%, 3rd: 3%, 4th: 0.5%, 5th: 0.3%, Sensitivity: 0.5)
2. **Ajuste os Parâmetros:** Altere um ou dois controles harmônicos por vez enquanto escuta por aspereza ou perda de clareza
3. **Misture Seu Som:** Equilibre o efeito utilizando o Sensitivity para alcançar ou um calor sutil ou uma distorção acentuada

## Multiband Saturation

Um efeito versátil que permite adicionar calor e caráter a faixas de frequência específicas do sinal de reprodução inteiro. Ao dividir o som em bandas Low, Mid e High, você pode moldar cada faixa independentemente para um aprimoramento preciso do som.

### Guia de aprimoramento da audição
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

- **Oversampling** (1x, 2x, 4x, 8x; padrão 1x) - Valores maiores reduzem os sons indesejados causados pelo retorno de harmônicos de alta frequência à faixa audível, mas exigem mais CPU. Comece com 2x ou 4x; use 8x para maior redução a 48 kHz. 1x mantém o processamento original. Valores acima de 1x acrescentam um atraso de 64 amostras (cerca de 1,33 ms a 48 kHz).
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

### Exibição visual
- Abas interativas de seleção de banda
- Gráfico de curva de transferência em tempo real para cada banda
- Feedback visual claro ao ajustar configurações
- Passe o cursor sobre o gráfico de uma banda, ou toque e arraste, para ler os valores nesse ponto.

### Dicas de aprimoramento musical
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

### Guia de início rápido
1. Ajuste as frequências de crossover para dividir seu som
2. Comece com valores baixos de Drive em todas as bandas
3. Defina Bias em 0.0 primeiro para saturação simétrica
4. Use Mix para misturar o efeito naturalmente
5. Ajuste fino com controles de Gain
6. Confie em seus ouvidos e ajuste a gosto!

## Saturation

Um efeito que simula o som quente e agradável de equipamentos valvulados vintage. Pode adicionar riqueza e caráter à sua música, fazendo-a soar mais "analógica" e menos "digital".

### Guia de aprimoramento da audição
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

- **Oversampling** (1x, 2x, 4x, 8x; padrão 1x) - Valores maiores reduzem os sons indesejados causados pelo retorno de harmônicos de alta frequência à faixa audível, mas exigem mais CPU. Comece com 2x ou 4x; use 8x para maior redução a 48 kHz. 1x mantém o processamento original. Valores acima de 1x acrescentam um atraso de 64 amostras (cerca de 1,33 ms a 48 kHz).
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

### Exibição visual
- Gráfico claro mostrando como o som está sendo moldado
- Feedback visual em tempo real
- Controles fáceis de ler
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

### Dicas de aprimoramento musical
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

### Guia de início rápido
1. Comece com Drive baixo para calor suave
2. Defina Bias em 0.0 primeiro para saturação simétrica
3. Ajuste Mix para equilibrar o efeito
4. Ajuste Gain se necessário para volume adequado
5. Experimente e confie em seus ouvidos!

## Sub Synth

Um efeito especializado que reforça os graves misturando um sinal filtrado de baixa frequência derivado do áudio original. Útil quando músicas com pouco grave precisam de mais calor, plenitude ou impacto agradável em fones.

### Guia de aprimoramento da audição
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
  - Frequência: Controla o limite superior do sinal adicional de baixa frequência
  - Inclinação: Ajusta a inclinação do filtro (Off a -24dB/oct)
- **Sub HPF** - Filtro passa-altas para o sinal adicional de baixa frequência (5-400Hz)
  - Frequência: Remove rumble indesejado do sinal adicional de baixa frequência
  - Inclinação: Controla a inclinação do filtro (Off a -24dB/oct)
- **Dry HPF** - Filtro passa-altas para sinal original (5-400Hz)
  - Frequência: Previne acúmulo de graves
  - Inclinação: Ajusta a inclinação do filtro (Off a -24dB/oct)

### Exibição visual
- Gráfico ao vivo de resposta em frequência
- Visualização clara das curvas de filtro
- Feedback visual em tempo real
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

### Dicas de aprimoramento musical
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

### Guia de início rápido
1. Comece com Sub Level moderado (50-70%)
2. Ajuste Sub LPF em torno de 100Hz
3. Ative Sub HPF em torno de 20Hz (-6dB/oct)
4. Ajuste Dry Level para equilíbrio
5. Ajuste fino dos filtros conforme necessário
6. Confie em seus ouvidos e ajuste gradualmente!

## Tube Simulator

O Tube Simulator acrescenta os harmônicos, a compressão e a resposta da fonte de alimentação que variam com o sinal em circuitos valvulados de linha e de potência. **Line** usa apenas o estágio driver, **Push-Pull Power** oferece circuitos balanceados com EL84, EL34, 6L6GC e KT88, e **SE Triode** oferece circuitos single-ended com 300B e 2A3. Os dois circuitos de potência também modelam o núcleo do transformador de saída, cuja saturação magnética e histerese acrescentam distorção nos graves em alto volume. Ele modela a carga elétrica do alto-falante vista pelo amplificador, mas não acrescenta o som de uma caixa acústica ou de um microfone.

### Guia de aprimoramento da audição

- Para uma coloração discreta, escolha no grupo **Pre** uma predefinição com o sufixo **@0.01%** ou **@0.1%**. Use o sufixo **@1%** ou **@2%** quando quiser perceber os harmônicos e a compressão com mais facilidade.
- Escolha **Pre** para o som do estágio de linha, **Power** apenas para o estágio de saída ou **Pre+Power** para o caminho completo do amplificador.
- Comece com **EL84 Distributed 10 W @2%** para um som push-pull contido. Compare com **EL84 Pentode 10 W @2%** para uma apresentação mais firme e direta.
- Experimente **300B SE @2%** ou **2A3 SE @2%** para obter harmônicos pares mais fortes e uma resposta single-ended mais suave.
- Se o som ficar comprimido ou distorcido demais, reduza **Input Volume** e depois iguale o volume de audição com **Output Trim**.
- Reduza **Negative Feedback** para uma resposta mais solta e rica em harmônicos; aumente-o para maior controle. Em SE Triode, comece em 3dB e normalmente permaneça perto de 0–6dB.
- Reduza **Wet/Dry Mix** quando quiser apenas um toque do efeito.

### Organização do painel

Os controles estão distribuídos em cinco abas.

- **Input** - Input Volume, Input Reference, Source Z
- **Driver** - Driver Type, Bias, Plate, Supply, Negative Feedback
- **Power** - Output Circuit; Power Tubes, Output B+ e Cathode Resistor; SE Triode, SE B+ e SE Cathode Resistor
- **Transformer** - Screen Tap, Push-Pull Primary, SE Primary, Assumed Speaker Load, Actual Speaker Load
- **Output** - Output Trim, Output Safety Trim, Auto Gain Reduction, Wet/Dry Mix

As abas Power e Transformer mostram apenas os controles usados pelo Output Circuit selecionado.

### Escolha de predefinição

Clique no botão **Predefinições de efeito** do cabeçalho do efeito para abrir a caixa de diálogo de predefinições. Escolha uma configuração de Predefinições do sistema no grupo Pre, Power ou Pre+Power para aplicá-la imediatamente. A predefinição que corresponde às configurações atuais fica destacada; se nenhuma corresponder, nenhuma fica destacada. As configurações iniciais correspondem a **EL84 Pentode @2%**. **Output Safety Trim** e **Auto Gain Reduction** não são usados na correspondência, portanto alterá-los não remove o destaque.

O sufixo da predefinição é uma referência prática da intensidade do efeito: **@0.01%** é muito discreto, **@0.1%** acrescenta uma coloração leve e **@1%** ou **@2%** tornam os harmônicos e a compressão mais evidentes. As predefinições também ajustam Output Trim para facilitar a comparação, mas o volume percebido pode variar com a música. Iguale os volumes com Output Trim antes de escolher o som preferido.

### Parâmetros

- **Input Volume** (-96 a 0dB) - Reduz o nível que alimenta o caminho de sinal selecionado
  - 0dB é totalmente aberto; valores menores reduzem a excitação interna e aumentam a margem
- **Driver Type** (12AX7, 12AT7, 12AU7 ou Bypass) - Seleciona as válvulas do driver de dois estágios ou remove esse driver do caminho de sinal
  - A 12AX7 tem o maior ganho de tensão, a 12AT7 é intermediária e a 12AU7 tem o menor ganho e a maior margem
  - Em Push-Pull Power, ele alimenta o inversor de fase 12AX7 fixo; em SE Triode, excita diretamente o triodo de saída selecionado
  - Bypass destina-se às predefinições Power. Push-Pull Power continua incluindo seu inversor de fase; SE Triode alimenta o triodo de saída sem o driver comum. Line com Bypass é uma passagem direta alinhada, e Negative Feedback não tem efeito nesse caso
- **Bias** (-50 a +50%) - Desloca o ponto de polarização de catodo dos dois estágios do driver
  - Aumentá-lo reduz a resistência de catodo modelada e leva os estágios a uma corrente maior; reduzi-lo faz o contrário
- **Plate** (150 a 300 V) - Define a alimentação de placa dos estágios do driver
  - Valores maiores geralmente oferecem mais margem de tensão; valores menores antecipam a compressão e a não linearidade
- **Source Z** (0.6 a 100 kΩ) - Define a impedância da fonte que alimenta o Stage 1
  - Valores maiores interagem mais com as capacitâncias de entrada e podem suavizar a excitação nos agudos ou nos transientes
- **Supply** (0.1 a 47 kΩ) - Define a resistência da fonte B+ dos estágios do driver
  - Valores maiores produzem mais queda na alimentação quando a corrente sobe; valores menores tornam a fonte mais firme
- **Negative Feedback** (0 a 30dB) - Define a quantidade de realimentação negativa global
  - Line realimenta a resposta de placa do segundo estágio; as duas topologias de potência realimentam a partir de um enrolamento de realimentação fixo no secundário do transformador
  - Aumentá-la geralmente reduz o ganho em malha aberta e a distorção e deixa a resposta mais firme; 0dB abre o laço de realimentação
  - SE Triode foi pensado para pouca realimentação: comece em 3dB e normalmente permaneça entre 0–6dB
  - O amortecimento elétrico da carga do alto-falante resulta desse próprio laço, então aumentá-la também reforça o controle do amplificador sobre a carga
- **Output Trim** (-48 a +48dB) - Ajusta o nível digital do sinal processado depois do circuito modelado, sem alterar sua excitação interna
- **Output Safety Trim** (-96 a 0dB) - Aplica um ajuste linear separado depois do circuito modelado, mantido à parte de Output Trim para que a proteção do nível de saída tenha um controle próprio
  - Auto Gain Reduction reduz apenas este ajuste; nunca altera Output Trim
  - O deslizador e sua caixa de valor mostram o ajuste efetivo, que é o valor definido por você menos a redução automática aplicada no momento; o valor armazenado é o último que você mesmo definiu, e é ele que é salvo
  - Ao pegar o deslizador, o valor efetivo exibido passa a ser o seu ajuste, de modo que o nível não salta, e a redução acumulada é zerada nesse momento
- **Auto Gain Reduction** (ativado por padrão) - Permite que a proteção do nível de saída reduza Output Safety Trim por conta própria
  - Desativado, nenhuma nova redução se acumula e a redução já aplicada permanece
- **Wet/Dry Mix** (0 a 100%) - Mistura o sinal processado com o original alinhado em latência
  - Em 0%, o caminho seco ainda carrega o atraso fixo de 64 amostras necessário para o alinhamento
- **Input Reference** (0.100 a 300.000 Vpk) - Tensão de pico nos terminais representada por um pico digital de 0dBFS
  - 2.828 Vpk corresponde a uma senoide de escala completa de 2 Vrms; 5.657 Vpk corresponde a 4 Vrms
  - Valores maiores excitam mais o circuito modelado; use Input Volume para o ajuste principal de audição
- **Output Circuit** (Line, Push-Pull Power ou SE Triode) - Seleciona a topologia modelada
  - Line termina após o driver de dois estágios e não executa o modelo da válvula de potência, do transformador nem da carga do alto-falante
  - Push-Pull Power acrescenta o inversor de fase e o circuito de saída de potência completo
  - SE Triode acrescenta uma 300B ou 2A3 excitada diretamente e um transformador de saída single-ended com entreferro
- **Power Tubes** (EL84 ×2, EL34 ×2, 6L6GC ×2 ou KT88 ×2) - Seleciona o modelo de corrente da válvula de saída e os componentes de circuito associados; afeta apenas o modo Power
  - Os quatro modelos seguem dados reais de válvulas de saída em função das tensões de placa, de tela e de grade, incluindo o corte completo atingido quando a grade é levada suficientemente ao negativo
- **Output B+** (300 a 470 V) - Define a tensão de alimentação do estágio de potência; valores maiores aumentam a excursão de tensão disponível e a dissipação das válvulas
- **Cathode Resistor** (270 a 500 Ω / valve) - Define o resistor de polarização de catodo separado de cada válvula de saída
  - Uma resistência maior reduz a corrente de repouso; uma menor a aumenta
- **SE Triode** (300B ou 2A3) - Seleciona o modelo do triodo de saída single-ended de aquecimento direto; afeta apenas o modo SE Triode
- **SE B+** (250 a 450 V) - Define a tensão de alimentação do estágio de saída single-ended
- **SE Cathode Resistor** (700 a 1300 Ω) - Define o resistor de polarização de catodo do triodo de saída único
- **Screen Tap** (0%, 20% ou 43%) - Seleciona a ligação da grade de tela das válvulas de saída
  - 0% usa a alimentação fixa de tela; 20% e 43% ligam as telas às tomadas correspondentes do primário do transformador para carga distribuída (ultralinear)
  - A tomada é uma relação de espiras, então as telas acompanham essa parcela do acoplamento magnético no enrolamento primário
- **Push-Pull Primary** (6.0, 6.6 ou 8.0 kΩ) - Seleciona a impedância primária placa a placa do transformador de saída push-pull e, junto com Assumed Speaker Load, sua relação de espiras
  - A escolha também define o fluxo de saturação magnética do núcleo
- **SE Primary** (2.5, 3.5 ou 5.0 kΩ) - Seleciona a impedância primária do transformador single-ended com entreferro e, junto com Assumed Speaker Load, sua relação de espiras
  - A escolha também define quanto fluxo um dado sinal envia para o núcleo com entreferro, de modo que impedâncias mais altas chegam à saturação mais cedo no mesmo nível. A corrente de repouso do funcionamento single-ended mantém um fluxo permanente no núcleo, então o sinal o satura de forma assimétrica e acrescenta harmônicos de ordem par nos graves
- **Assumed Speaker Load** (4, 8, 15 ou 16 Ω) - Seleciona a tomada do secundário do transformador e a impedância nominal do alto-falante para a qual o circuito foi projetado
  - Cada opção usa uma carga elétrica RLC dependente da frequência, e não um simples resistor, e afeta a carga do transformador e a realimentação
- **Actual Speaker Load** (2 a 32 Ω) - Define a impedância do alto-falante realmente conectado a essa tomada
  - A rede de carga é escalonada pela razão em relação a Assumed Speaker Load, de modo que a frequência de ressonância e o Q são mantidos e apenas o nível de impedância muda
  - A relação de espiras continua baseada em Assumed Speaker Load, então uma diferença reflete outra impedância para as válvulas de saída e altera o amortecimento, a potência disponível e a excitação; com os dois valores iguais, o circuito opera no seu ponto de projeto

### Proteção do nível de saída

Alterar parâmetros do circuito pode causar um grande salto de nível. Com **Auto Gain Reduction** ativado, o Tube Simulator reduz **Output Safety Trim** quando a saída processada ultrapassaria a escala digital. A redução permanece em vez de voltar automaticamente e aparece no status abaixo do gráfico.

- Se a redução ficar grande, diminua Input Volume ou Output Trim e depois selecione novamente uma predefinição ou ajuste Output Safety Trim.
- Desative Auto Gain Reduction somente quando já estiver acompanhando os picos de saída em outro lugar.
- A proteção reduz o nível de saída; ela não remove a distorção harmônica nem a compressão criadas dentro do circuito selecionado.

### Bypass de segurança e recuperação

- Se um ajuste instável ativar o bypass, reduza Negative Feedback ou selecione uma predefinição. O processamento volta automaticamente quando o ajuste fica estável.
- Se o status continuar indicando bypass, restaure uma predefinição e recarregue o efeito. Quando o processamento não estiver disponível no dispositivo, o áudio passa sem alterações.

### Como ler o HUD

- Os pontos mostram posições de operação recentes. Quanto mais espalhados, mais intensamente a música está excitando aquele estágio. Cada painel sobrepõe os dois canais: o azul é o esquerdo e o laranja, o direito.
- O nome da válvula representada no gráfico aparece no canto superior esquerdo.
- O **Graph**, acima do gráfico, escolhe quais válvulas observar. **Stage 1 / Stage 2** mostra os dois estágios do driver, **Push / Pull** as duas válvulas do par de saída push-pull e **SE Triode** a válvula de saída single-ended. Só é possível selecionar os estágios que o circuito atual realmente usa, então em um estágio de potência com driver você pode alternar entre os dois e compará-los.
- Quando nenhuma válvula está em operação — Line com **Driver Type** em Bypass, ou o efeito desligado — o gráfico fica vazio e o status mostra **No tube stage is active**.
- **Speaker Output** e **Speaker Real Power** indicam o quanto o estágio de potência e a carga do alto-falante estão sendo excitados.
- **Transformer Flux** mostra a magnitude do fluxo concatenado do transformador de saída em Wb. Quanto mais os graves empurram essa leitura para cima, mais distorção o próprio transformador acrescenta. Em SE Triode a leitura inclui o fluxo de polarização permanente do núcleo com entreferro e, por isso, permanece acima de zero mesmo sem sinal.
- O status abaixo do gráfico informa se o efeito está ativo ou em bypass e mostra qualquer redução automática de saída.

O Tube Simulator acrescenta um pequeno atraso de processamento de aproximadamente 0,3 a 1,5 ms, conforme a taxa de amostragem.

### Exibição visual
- Passe o cursor sobre o gráfico, ou toque e arraste, para ler a tensão e a corrente de placa nesse ponto e, quando curvas de placa estiverem desenhadas, a tensão de grade da curva mais próxima.
