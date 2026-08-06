---
title: "Plugins de Saturação - EffeTune"
description: "Plugins de saturação e distorção, incluindo Saturation, Exciter, Hard Clipping e outros."
lang: pt
---

# Plugins de Saturação

Uma coleção de plugins que adicionam calor e caráter à sua música. Esses efeitos podem fazer a música digital soar mais analógica e adicionar uma riqueza agradável ao som, semelhante à forma como equipamentos de áudio vintage colorem o som.

## Lista de Plugins

- [Dynamic Saturation](#dynamic-saturation) - Simula o deslocamento não linear de cones de alto-falantes
- [Exciter](#exciter) - Adiciona conteúdo harmônico para melhorar a clareza e presença
- [Hard Clipping](#hard-clipping) - Adiciona intensidade e borda ao som
- [Harmonic Distortion](#harmonic-distortion) - Adiciona caráter com distorção não linear ajustável de 2ª a 5ª ordem
- [Multiband Saturation](#multiband-saturation) - Molda faixas de graves, médios e agudos independentemente
- [Saturation](#saturation) - Adiciona calor e riqueza como equipamentos vintage
- [Sub Synth](#sub-synth) - Adiciona um sinal filtrado de baixa frequência para reforçar os graves
- [Tube Simulator](#tube-simulator) - Modela estágios de linha valvulados e um amplificador de potência push-pull

## Dynamic Saturation

Um efeito baseado na física que simula o deslocamento não linear de cones de alto-falantes sob diferentes condições. Ao modelar o comportamento mecânico de um alto-falante e depois aplicar saturação a esse deslocamento, ele cria uma forma única de distorção que responde dinamicamente à sua música.

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

Tube Simulator modela uma cadeia elétrica completa com valores reais de componentes de circuitos valvulados. **Line** usa sozinho o amplificador de pequenos sinais de dois estágios. **Push-Pull Power** encaminha esse mesmo driver, através de um volume fixo, a um inversor de fase 12AX7 resolvido como um par diferencial de válvulas reais e, dali, a duas válvulas de saída EL84 ou EL34, um transformador de saída e uma carga de alto-falante dependente da frequência. Bias, B+, transformador e carga são calculados conforme o sinal muda; por isso, harmônicos, compressão, queda da alimentação e amortecimento elétrico respondem à música. A carga de alto-falante representa a carga elétrica vista pelo amplificador, não uma caixa acústica ou microfone.

### Guia de Ajuste do Som

- Para um conversor D/A de 2 Vrms, comece com **Line Default**. Os valores reais de fábrica são Input Reference 2.828 Vpk, Input Volume 0dB, 12AU7, Negative Feedback 30dB e Output Trim +9dB.
- Se Line Default saturar demais, reduza Input Volume para diminuir a tensão interna e use Output Trim apenas para recuperar o volume de audição. Output Trim não recupera headroom dentro do circuito.
- Use os presets **Listening (THD-matched)** quando quiser comparar válvulas e circuitos apenas pelo caráter sonoro. Eles já estão igualados em volume entre si, então nada precisa ser ajustado ao trocar de um para outro.
- Para uma resposta de potência contida, comece com **EL84 Distributed 10 W**. Compare com **EL84 Pentode 10 W** para ouvir o efeito da ligação da grade de tela e da carga do transformador com a mesma família de válvulas.
- Use **EL34 Distributed 20–37 W** para explorar o circuito EL34 de maior tensão. Iguale o volume com Output Trim antes de comparar com EL84.
- Reduzir Negative Feedback evidencia mais os harmônicos e variações de nível em malha aberta; aumentar deixa a resposta em malha fechada mais controlada. Se uma combinação extrema acionar o bypass de segurança, volte a um preset.
- Reduza Wet/Dry Mix para adicionar a resposta do circuito de modo sutil.

### Layout do Painel

Os 20 parâmetros estão distribuídos em cinco abas, abaixo da lista **Preset**.

- **Input** - Input Volume, Input Reference, Source Z
- **Driver** - Tube, Bias, Plate, Supply, Negative Feedback
- **Power** - Output Circuit, Power Tubes, Output B+, Cathode Resistor
- **Transformer** - Screen Tap, Transformer Primary, Assumed Speaker Load, Actual Speaker Load
- **Output** - Output Trim, Output Safety Trim, Auto Gain Reduction, Wet/Dry Mix

A lista Preset começa por **Custom**, seguida dos grupos **Listening (THD-matched)** e **Circuit**; Custom aparece sempre que os ajustes atuais não correspondem a nenhum preset; os ajustes de proteção de saída (Output Safety Trim e Auto Gain Reduction) não fazem parte dessa comparação. Enquanto Output Circuit estiver em Line, os sete controles do circuito de potência das abas Power e Transformer ficam esmaecidos. Eles continuam ajustáveis e mantêm seus valores.

### Presets de Circuito e Valores Padrão

O plugin inicia com **Line Default**. Um preset aplica todo o circuito da tabela; qualquer alteração posterior cria uma configuração personalizada.

| Circuit Preset | Output Circuit | Driver / válvulas de saída | Negative Feedback | Ajustes de potência | Entrada / saída |
| --- | --- | --- | ---: | --- | --- |
| Line Default | Line | 12AU7 / — | 30dB | Mantém os valores dos controles de potência, mas eles ficam esmaecidos | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim +9dB |
| EL84 Pentode 10 W | Push-Pull Power | 12AX7 / EL84 ×2 | 3dB | Output B+ 329.696 V, Cathode Resistor 270 Ω / valve, Screen Tap 0%, Transformer Primary 8.0 kΩ, Assumed Speaker Load 15 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim 0dB |
| EL84 Distributed 10 W | Push-Pull Power | 12AX7 / EL84 ×2 | 3dB | Output B+ 330.107 V, Cathode Resistor 270 Ω / valve, Screen Tap 20%, Transformer Primary 6.6 kΩ, Assumed Speaker Load 15 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim 0dB |
| EL34 Distributed 20–37 W | Push-Pull Power | 12AX7 / EL34 ×2 | 4dB | Output B+ 443.775 V, Cathode Resistor 470 Ω / valve, Screen Tap 43%, Transformer Primary 6.6 kΩ, Assumed Speaker Load 8 Ω | Input Volume 0dB, Input Reference 2.828 Vpk, Output Trim 0dB |

Os quatro presets usam Bias 0%, Plate 250 V, Source Z 10 kΩ, Supply 10 kΩ e Wet/Dry Mix 100%. Cada preset também ajusta Actual Speaker Load para o seu Assumed Speaker Load, de modo que parte do ponto de projeto do circuito.

### Presets de Audição

O grupo **Listening (THD-matched)** reúne sete ajustes calibrados. Cada um herda todos os valores de circuito do preset de Circuit em que se baseia, e apenas Input Volume, Input Reference e Output Trim são calibrados, de modo que o circuito em si permanece intacto. Os sete ficam dentro de ±0.0005dB do mesmo nível em 1 kHz, então alternar entre eles muda o caráter e não o volume.

| Listening Preset | Baseado em | Alteração de circuito | Input Volume | Input Reference | Output Trim |
| --- | --- | --- | ---: | ---: | ---: |
| Line 12AU7 @1% | Line Default | — | 0dB | 20 Vpk | -7.749dB |
| Line 12AT7 @1% | Line Default | Tube 12AT7 | -3.6973dB | 2.828 Vpk | -9.42dB |
| Line 12AX7 @1% | Line Default | Tube 12AX7 | -4.4805dB | 2.828 Vpk | -11.276dB |
| Line 12AU7 Open-Loop @3% | Line Default | Negative Feedback 0dB | -16.793dB | 2.828 Vpk | +26.427dB |
| EL84 Pentode @2% | EL84 Pentode 10 W | — | -55.9648dB | 2.828 Vpk | +4.626dB |
| EL84 Distributed @2% | EL84 Distributed 10 W | — | -52.9414dB | 2.828 Vpk | +4.908dB |
| EL34 Distributed @2% | EL34 Distributed 20–37 W | — | -43.6504dB | 2.828 Vpk | +5.212dB |

O circuito de linha com 12AU7 fica um pouco abaixo de 1% de distorção mesmo no limite de Input Reference, por isso Line 12AU7 @1% assume o valor máximo que esse circuito alcança.

### Parâmetros
- **Preset** - Carrega um preset de Circuit (Line Default ou um dos três circuitos completos de amplificador de potência) ou um dos ajustes de Listening (THD-matched)
- **Input Volume** (-96 a 0dB) - Atenuador passivo situado depois do terminal de entrada
  - 0dB corresponde à abertura total e nunca amplifica a tensão do terminal
  - Valores mais baixos reduzem a tensão que entra em Stage 1 e aumentam o headroom interno
- **Tube** (12AX7, 12AT7 ou 12AU7) - Seleciona as constantes da válvula usadas nos dois estágios
  - 12AX7 oferece o maior ganho de tensão e é excitada com mais facilidade
  - 12AT7 oferece ganho intermediário
  - 12AU7 oferece menor ganho e mais headroom
  - No modo Power, esse circuito de dois estágios continua sendo o driver e alimenta o inversor de fase 12AX7 fixo através de um volume fixo
- **Bias** (-50 a +50%) - Desloca o ponto de operação da polarização de cátodo
  - Aumentar reduz a resistência de cátodo modelada e desloca os estágios para uma corrente maior
  - Reduzir aumenta a resistência de cátodo e desloca os estágios para uma corrente menor
- **Plate** (150 a 300V) - Define a tensão modelada de alimentação de placa
  - Aumentar geralmente oferece mais headroom de tensão e uma resposta mais firme
  - Reduzir faz a compressão e o comportamento não linear aparecerem mais cedo
- **Source Z** (0.6 a 100kΩ) - Define a impedância da fonte que alimenta o primeiro estágio
  - Aumentar intensifica a interação com as capacitâncias de entrada modeladas, suavizando os agudos e os transientes
  - Reduzir excita a entrada com mais firmeza e preserva mais energia de alta frequência
- **Supply** (0.1 a 47kΩ) - Define a resistência da alimentação B+ modelada
  - Aumentar permite uma queda maior de B+ quando os estágios consomem corrente, tornando a queda da alimentação mais evidente
  - Reduzir deixa a alimentação mais rígida e diminui sua variação
- **Negative Feedback** (0 a 30dB) - Define a quantidade calibrada de realimentação negativa global
  - Line retorna a resposta de placa do segundo estágio; Push-Pull Power retorna um enrolamento fixo de realimentação no secundário do transformador
  - Aumentar geralmente reduz o ganho e a distorção em malha aberta e deixa a resposta mais controlada; 0dB abre a malha de realimentação
  - O amortecimento elétrico da carga de alto-falante surge dessa própria malha, então aumentá-la também firma o controle do amplificador sobre a carga
- **Output Trim** (-48 a +48dB) - Aplica uma calibração digital de nível depois do circuito modelado
  - Altera somente o nível do sinal processado e não aumenta o headroom interno dos estágios valvulados
- **Output Safety Trim** (-96 a 0dB) - Aplica um ajuste linear depois do circuito modelado, separado de Output Trim, para que a proteção de nível de saída tenha um controle próprio
  - Auto Gain Reduction baixa apenas este ajuste; nunca escreve em Output Trim
  - O deslizante e sua caixa de valor mostram o ajuste efetivo, ou seja, o valor que você definiu menos a redução automática aplicada no momento; a configuração armazenada é o último valor que você mesmo definiu, e é ela que fica salva
  - Ao pegar o deslizante, o valor efetivo exibido passa a ser a sua configuração, de modo que o nível não salta, e a redução acumulada é zerada nesse instante
- **Auto Gain Reduction** (ligado por padrão) - Permite que a proteção de nível de saída reduza Output Safety Trim por conta própria
  - Com ele desligado, nenhuma redução nova se acumula e a redução já aplicada permanece
- **Wet/Dry Mix** (0 a 100%) - Mistura os sinais original e processado alinhados no tempo
  - Valores baixos preservam mais do sinal original; valores altos destacam a resposta do modelo valvulado
  - Mesmo em 0%, o caminho original permanece atrasado em 64 samples para manter o alinhamento
- **Input Reference** (0.100 a 20.000 Vpk) - Define a tensão de pico no terminal de entrada representada por um pico digital de 0dBFS
  - 2.828 Vpk corresponde a uma senoide de 2 Vrms em escala completa; 5.657 Vpk corresponde a 4 Vrms
  - Stage 1 recebe Input Reference multiplicado por Input Volume antes da sobreamostragem
  - É uma calibração física de entrada, não um controle adicional de excitação
- **Output Circuit** (Line ou Push-Pull Power) - Seleciona a topologia modelada
  - Line termina depois do driver de dois estágios e não processa as válvulas de potência, o transformador nem a carga de alto-falante
  - Push-Pull Power acrescenta o inversor de fase e todo o circuito de saída de potência
- **Power Tubes** (EL84 ×2 ou EL34 ×2) - Seleciona o modelo de corrente das válvulas de saída e os componentes correspondentes; afeta apenas o modo Power
  - Os dois modelos seguem dados reais de válvulas de saída em placa, grade de tela e grade de controle, incluindo o corte total alcançado quando a grade é levada suficientemente ao negativo
- **Output B+** (300 a 470 V) - Define a tensão de alimentação do estágio de potência; valores maiores aumentam a excursão de tensão disponível e a dissipação das válvulas
- **Cathode Resistor** (270 a 500 Ω / valve) - Define o resistor de polarização de cátodo separado de cada válvula de saída
  - Uma resistência maior reduz a corrente de repouso; uma resistência menor a aumenta
- **Screen Tap** (0%, 20% ou 43%) - Seleciona a ligação da grade de tela
  - 0% usa a alimentação fixa da grade de tela; 20% e 43% ligam as grades às derivações correspondentes do primário do transformador para operação com carga distribuída (ultralinear)
  - A derivação é uma relação de espiras, portanto as grades de tela acompanham essa fração do acoplamento magnético do enrolamento primário
- **Transformer Primary** (6.0, 6.6 ou 8.0 kΩ) - Seleciona a impedância primária placa a placa do transformador de saída e, junto com Assumed Speaker Load, sua relação de espiras
- **Assumed Speaker Load** (4, 8, 15 ou 16 Ω) - Seleciona a derivação do secundário do transformador e a impedância nominal em torno da qual o circuito é projetado
  - Cada opção usa uma carga elétrica RLC dependente da frequência, em vez de um resistor simples, e afeta a carga do transformador e a realimentação
- **Actual Speaker Load** (2 a 32 Ω) - Define a impedância do alto-falante realmente ligado a essa derivação
  - A rede de carga é escalada pela razão em relação a Assumed Speaker Load, de modo que a frequência de ressonância e o Q são preservados e apenas o nível de impedância muda
  - A relação de espiras continua baseada em Assumed Speaker Load, então um descasamento reflete outra impedância para as válvulas de saída e altera o amortecimento, a potência disponível e a excitação; com os dois valores iguais, o circuito opera no seu ponto de projeto

### Proteção do Nível de Saída

Os presets de Circuit não são equalizados em volume entre si. Mudar Tube de 12AU7 para 12AX7 eleva o nível em cerca de 25dB, e mudar Output Circuit de Line para Push-Pull Power o eleva em cerca de 33dB, porque os dois circuitos são normalizados por referências de fundo de escala diferentes. Output Safety Trim e Auto Gain Reduction protegem desse salto o equipamento ligado à saída.

- Sempre que a magnitude de uma amostra de saída ultrapassa 0 dBFS de pico, o Output Safety Trim é reduzido de imediato exatamente no quanto essa amostra excede. Todas as amostras são examinadas, portanto não há janela de detecção nem média. O limiar é um valor de política fixo.
- A redução é aplicada por uma rampa unidirecional de 20 ms, de modo que o nível se desloca sem degrau.
- Ela apenas reduz e nunca restaura. Não há release nem recuperação, portanto não é um limitador nem um nivelador automático.
- O deslizante e sua caixa de valor mostram o ajuste efetivo, isto é, a sua configuração menos a redução aplicada no momento. A configuração armazenada continua sendo o último valor que você mesmo definiu, e é ela que fica salva.
- A redução acumulada é zerada quando você mesmo pega o Output Safety Trim. Nesse instante o valor efetivo exibido passa a ser a sua configuração, de modo que o nível não salta.
- Carregar um preset devolve o Output Safety Trim a 0dB. A redução acumulada é zerada quando o próprio valor do ajuste muda ou quando uma única gravação muda dois ou mais valores de uma vez, como normalmente faz o carregamento de um preset; selecionar de novo o preset em que o circuito já está, depois de mover um único controle, muda apenas esse valor e mantém a redução.
- Com Auto Gain Reduction desligado, nenhuma redução nova se acumula e a redução já aplicada permanece.
- A redução atual é indicada na linha de status abaixo do gráfico, inclusive quando é de 0.0 dB.
- O mecanismo fica fora do modelo do amplificador. A resolução do circuito, os harmônicos, a compressão e a queda da alimentação não mudam; muda apenas o nível de saída, nunca o caráter da sobrecarga. O que ele suprime é o extrapolamento digital de fundo de escala na saída, não a distorção que o modelo produz.

### Bypass de Segurança e Recuperação

- Se o modelo detectar oscilação de realimentação, ele faz uma transição do sinal processado para o caminho original alinhado em latência e trava o bypass seguro. Reduza Negative Feedback, selecione um preset padrão ou altere outro ajuste do circuito. A nova configuração é testada enquanto a saída permanece original; se estiver estável, o sinal processado retorna suavemente. Se a instabilidade continuar, o bypass permanece ativo.
- Se ocorrer outra falha de segurança no processamento, o plugin muda para a saída original segura. Restaure as configurações padrão do circuito e recarregue o efeito.
- Taxas de amostragem ou modos de canal incompatíveis, processamento WebAssembly indisponível e interrupção do mecanismo de processamento também acionam o bypass. O status abaixo do HUD informa o que fazer.

### Como Ler o HUD
- **Input Reference (0 dBFS)** mostra a tensão do terminal em Vpk, o valor Vrms de uma senoide e o valor correspondente de escala completa em dBu (**dBuFS**)
- **Stage 1 External Input (0 dBFS)** mostra a tensão de pico depois de Input Volume e antes da rede de entrada modelada
- **Stage 1 bias** e **Stage 2 bias** mostram a tensão atual de bias de cátodo nos canais esquerdo e direito
- **B+** mostra a tensão instantânea da alimentação após a queda modelada
- **Plate − B+ sag** mostra a tensão de placa de cada estágio em relação a B+; um valor mais negativo indica uma queda maior
- Em Line, os dois gráficos mostram as características de placa e os pontos de operação recentes de Stage 1 e Stage 2, desenhados como pontos isolados e não como uma linha contínua
  - O eixo horizontal é a tensão ânodo-cátodo, **Vak (V)**, e o vertical é a corrente de placa, **Ia (mA)**
  - As curvas cinza finas são as características de placa estáticas da válvula em vários valores de **Vgk**; a linha tracejada mais clara é a reta de carga do circuito
  - Ciano representa o canal esquerdo e laranja o direito; pontos espalhados por uma área maior indicam uma faixa de operação maior
- Em Push-Pull Power, os gráficos mudam para as retas de carga **Push** e **Pull** e desenham como pontos as correntes de placa recentes das duas válvulas de saída
- **Power LTP Balance** mostra a tensão diferencial do inversor de fase, e **Power B+** mostra a alimentação do estágio de potência após a queda
- **Speaker Output (100 ms)** e **Speaker Real Power (100 ms)** mostram medições elétricas em janelas não sobrepostas de 100 ms na carga selecionada. Real Power é calculada com a tensão e a corrente instantâneas da carga, não apenas com Vrms² dividido pela impedância nominal
- **Transformer Flux** mostra em webers o fluxo magnético modelado do transformador de saída. As leituras exclusivas do estágio de potência só são relevantes quando Push-Pull Power está selecionado
- O status abaixo do gráfico informa se o processamento está carregando, ativo ou em bypass seguro e mostra sempre a redução atual da proteção de saída em dB, inclusive quando é de 0.0 dB

### Requisitos de Processamento e Latência
- Tube Simulator processa áudio em 44.1, 48, 88.2, 96, 176.4 e 192 kHz usando WebAssembly
- A família de 44.1 kHz é processada internamente em 352.8 kHz, e a família de 48 kHz, em 384 kHz
- Em 44.1 ou 48 kHz, o aviso geral de baixa taxa de amostragem do aplicativo continua visível porque a fonte não contém as informações de alta frequência disponíveis em taxas maiores
- Os modos Stereo e par de canais são compatíveis; taxas de amostragem ou modos de canal incompatíveis usam o caminho de bypass
- Os filtros de sobreamostragem acrescentam latência fixa de 64 samples em todas as taxas compatíveis (cerca de 1.45ms em 44.1 kHz e 0.33ms em 192 kHz)
