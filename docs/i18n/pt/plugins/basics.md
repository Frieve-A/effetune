---
title: "Plugins Básicos - EffeTune"
description: "Plugins essenciais de áudio, incluindo Volume, Mute, Stereo Balance, FIR Crossover, roteamento Matrix e outros."
lang: pt
---

# Plugins Básicos de Áudio

Uma coleção de ferramentas essenciais para ajustar os aspectos fundamentais da reprodução da sua música. Esses plugins ajudam você a controlar o volume, o equilíbrio e outros aspectos básicos da sua experiência auditiva.

<!-- spectrum-overlay -->
## Sobreposição de espectro

Pressione o ícone de espectro de um gráfico compatível para alternar entre After, Before + After e Off. After mostra apenas o espectro processado como uma linha azul. Before + After preenche a mudança entre o espectro antes e depois do processamento: a cor quente marca as frequências cujo nível aumentou após o processamento, o azul marca aquelas cujo nível diminuiu e uma linha cinza indica o espectro After. As duas visualizações aplicam suavização de 1/12 de oitava para facilitar a leitura das tendências nas altas frequências. Use a comparação para ver como cada ajuste altera graves, médios e agudos enquanto escuta. Leia os níveis do espectro na escala dBFS à direita do gráfico. Ela é separada da escala de ganho do gráfico; 0 dBFS é a referência digital de escala completa, e valores mais baixos são mais silenciosos. Em After, apenas o espectro processado é coletado; em Off, a coleta e o desenho são interrompidos.

## Lista de Plugins

* [Channel Divider](#channel-divider) - Divide áudio estéreo em bandas de frequência por pares de saída estéreo
* [DC Offset](#dc-offset) - Adiciona ou corrige um offset DC constante
* [FIR Crossover](#fir-crossover) - Divide o sinal estéreo em bandas de inclinação acentuada com filtros FIR
* [Matrix](#matrix) - Roteia e mistura canais de áudio com controle flexível
* [MultiChannel Panel](#multichannel-panel) - Controla múltiplos canais de áudio com configurações individuais
* [Mute](#mute) - Silencia a saída de áudio
* [Polarity Inversion](#polarity-inversion) - Inverte a polaridade do sinal para correção ou casos especiais de roteamento
* [Stereo Balance](#stereo-balance) - Ajusta o equilíbrio esquerdo-direito da sua música
* [Volume](#volume) - Controla o quão alto a música é reproduzida

## Channel Divider

Uma ferramenta especializada que divide seu sinal estéreo em bandas de frequência separadas e direciona cada banda para um par de saída estéreo diferente. É útil em sistemas com vários amplificadores, vários alto-falantes ou crossovers personalizados para reprodução.

Para usar este efeito, use o aplicativo desktop, defina uma quantidade par de canais de saída entre 4 e 16 e defina o canal no roteamento de bus do efeito como "All". Band Count determina os pares de saída usados.

### Quando Usar

* Ao usar saídas de áudio multicanal com uma quantidade par de 4 a 16 canais
* Para criar roteamento de canais personalizado baseado em frequência
* Para configurações com vários amplificadores ou vários alto-falantes

### Parâmetros

* **Band Count** - Número de bandas de frequência a serem criadas (2-4 bandas)

  * 2 bandas: divisão Graves/Agudos, exigindo 4 canais de saída
  * 3 bandas: divisão Graves/Médias/Agudos, exigindo 6 canais de saída
  * 4 bandas: divisão Graves/Graves-Médias/Médias-Agudos/Agudos, exigindo 8 canais de saída
  * Band Count continua limitado a quatro bandas; aumentar a quantidade de canais de saída não adiciona mais bandas

* **Crossover Frequencies** - Define onde o áudio é dividido entre as bandas

  * F1: Primeiro ponto de crossover
  * F2: Segundo ponto de crossover (para 3 ou mais bandas)
  * F3: Terceiro ponto de crossover (para 4 bandas)
  * Cada crossover pode ser ajustado de 10 Hz a 40000 Hz
  * O plugin mantém F1, F2 e F3 em ordem crescente, com pelo menos 1 Hz de separação

* **Slopes** - Controlam o quão abruptamente as bandas são separadas

  * Opções: -12dB a -96dB por oitava
  * Inclinações mais acentuadas oferecem separação mais limpa
  * Inclinações menores oferecem transições mais naturais

### Notas Técnicas

* Processa apenas os dois primeiros canais de entrada
* A quantidade de canais de saída deve ser par, entre 4 e 16
* Cada banda preserva o par estéreo original: no modo de 2 bandas, Low sai nos canais 1-2 e High nos canais 3-4; no modo de 3 bandas, são usados os canais 1-2, 3-4 e 5-6; no modo de 4 bandas, são usados os canais 1-2, 3-4, 5-6 e 7-8
* Utiliza filtros de crossover Linkwitz-Riley de alta qualidade
* Gráfico de resposta em frequência visual para configuração fácil

## DC Offset

Uma ferramenta para corrigir um sinal cuja forma de onda está deslocada em relação à linha zero. A maioria dos ouvintes deve deixar em 0.0, mas ela pode ajudar com arquivos ou cadeias de processamento incomuns que contenham offset DC.

### Quando Usar

* Quando o áudio tem um viés DC constante ou causa cliques/problemas de headroom depois de outros processamentos
* Quando uma ferramenta de diagnóstico ou medidor mostra que a forma de onda está deslocada em relação a zero
* Deixe em 0.0 para audição normal

### Parâmetros

* **Offset** - Adiciona um valor constante a cada amostra (-1.0 a +1.0)

  * 0.0: Sem offset
  * Valores positivos deslocam o sinal para cima
  * Valores negativos deslocam o sinal para baixo
  * Use ajustes bem pequenos quando uma correção for necessária

## FIR Crossover

O FIR Crossover divide uma entrada estéreo em duas, três ou quatro bandas e envia cada uma a um par de saídas separado. Ele se destina a sistemas desktop com uma quantidade par de 4 a 16 canais de saída e funciona somente com WASM DSP. Band Count continua limitado a quatro bandas, portanto usa no máximo os canais 1-8.

O projeto FIR permite inclinações muito acentuadas sem a ressonância dos filtros convencionais. Minimum Phase usa uma construção causal que preserva a recombinação das bandas; Linear Phase oferece resposta de fase simétrica em troca de uma latência fixa.

### Guia de uso

- Comece com os valores padrão e ajuste Crossover Frequencies às faixas dos seus alto-falantes.
- As saídas seguem da banda mais baixa para a mais alta; cada banda ocupa um par estéreo.
- Para ajustes comuns, experimente de 48 a 96 dB/oct. Inclinações maiores geralmente exigem mais Taps.
- Escolha Minimum Phase para reduzir a latência ou Linear Phase quando o alinhamento de fase for prioritário.
- Teste o roteamento multicanal em volume baixo para proteger os alto-falantes.

### Parâmetros

- **Phase**: seleciona **Minimum Phase** ou **Linear Phase**.
- **Taps**: define o comprimento do filtro FIR. Valores maiores melhoram a resolução nos graves e aumentam a carga.
- **Latency**: adiciona 0, 128, 256, 512 ou 1024 amostras de latência declarada.
- **Band Count**: seleciona duas, três ou quatro bandas, que exigem respectivamente 4, 6 ou 8 canais de saída.
- **Crossover Frequencies**: define em ordem crescente os limites entre as bandas.
- **Slope**: seleciona de 24 a 384 dB/oct para cada crossover.

### Como ler a tela

- O gráfico mostra a resposta-alvo de cada banda ao longo da frequência.
- Cada cor corresponde ao par de saídas da respectiva banda.
- A linha de status mostra a latência e a resolução do filtro, ou alerta se o número de canais não for compatível.

## Matrix

Uma ferramenta de roteamento de canais para corrigir layouts incomuns de alto-falantes ou fones, trocar canais, combinar canais ou enviar um canal para mais de uma saída disponível.

### Quando Usar

* Para criar roteamentos personalizados entre canais
* Quando precisar mixar ou dividir sinais de maneiras específicas
* Quando a reprodução esquerda/direita ou multicanal está saindo dos alto-falantes errados
* Para combinar estéreo em mono ou duplicar um canal para outra saída disponível

### Recursos

* Matriz de roteamento flexível para até 16 canais
* Controle de conexão individual entre qualquer par entrada/saída
* Opções de inversão de fase para cada conexão
* Interface de matriz visual para configuração intuitiva

### Como Funciona

* Cada ponto de conexão representa o roteamento de uma linha de entrada para uma coluna de saída
* Conexões ativas permitem que o sinal flua entre canais
* A opção de inversão de fase reverte a polaridade do sinal
* Múltiplas conexões de entrada para uma saída são mixadas juntas
* Quando várias entradas são enviadas para a mesma saída, seus níveis são somados, então talvez seja necessário reduzir o volume
* Matrix não cria canais de saída extras por conta própria; ele roteia áudio dentro dos canais que já estão disponíveis

### Aplicações Práticas

* Downmixing, troca de canais ou roteamento personalizado dentro dos canais disponíveis
* Combinar esquerda e direita em mono
* Duplicar um canal para outra saída disponível
* Corrigir layouts multicanal incomuns na reprodução

## MultiChannel Panel

Um painel de controle abrangente para gerenciar múltiplos canais de áudio individualmente. Este plugin fornece controle completo sobre volume, silenciamento, solo e atraso para até 16 canais, com um medidor de nível visual para cada canal.

Role dentro do painel para acessar os canais que estão abaixo da área visível.

### Quando Usar

* Ao trabalhar com áudio multicanal (até 16 canais)
* Para criar um equilíbrio de volume personalizado entre diferentes canais
* Quando precisar aplicar atraso individual em canais específicos
* Para monitorar níveis em vários canais simultaneamente

### Recursos

* Controles individuais para até 16 canais de áudio
* Medidores de nível em tempo real com retenção de pico para monitoramento visual
* Capacidade de agrupamento de canais para alterações de parâmetros em grupo

### Parâmetros

#### Controles por Canal

* **Mute (M)** - Silencia canais individuais
  * Ativação/desativação para cada canal
  * Funciona em conjunto com o recurso solo

* **Solo (S)** - Isola canais individuais
  * Quando qualquer canal está em solo, apenas os canais em solo são reproduzidos
  * Múltiplos canais podem ser colocados em solo simultaneamente

* **Volume** - Ajusta o volume de canais individuais (-20dB a +10dB)
  * Controle preciso com slider ou entrada direta de valor
  * Canais vinculados mantêm o mesmo volume

* **Delay** - Adiciona atraso temporal a canais individuais (0-30ms)
  * Controle preciso de atraso em milissegundos
  * Útil para alinhamento temporal entre canais
  * Permite ajuste de fase entre canais

#### Vinculação de Canais

* **Link** - Conecta canais adjacentes para controle sincronizado
  * Alterações em um canal vinculado afetam todos os canais conectados
  * Mantém configurações consistentes entre grupos de canais vinculados
  * Útil para pares estéreo ou grupos multicanal

### Monitoramento Visual

* Medidores de nível em tempo real mostram a intensidade atual do sinal
* Indicadores de retenção de pico mostram níveis máximos
* Leitura numérica clara dos níveis de pico em dB
* Medidores com código de cores para fácil reconhecimento de níveis:
  * Verde: níveis seguros
  * Amarelo: aproximando-se do máximo
  * Vermelho: próximo ou no nível máximo

### Aplicações Práticas

* Balanceamento de reprodução surround ou com vários alto-falantes
* Igualar o tempo de chegada dos alto-falantes quando eles estão a distâncias diferentes
* Silenciar ou colocar alto-falantes individuais em solo temporariamente durante a configuração
* Vincular pares estéreo ou grupos de alto-falantes para ajustes mais fáceis

## Mute

Uma ferramenta simples que silencia toda saída de áudio preenchendo o buffer com zeros. Útil para silenciar instantaneamente sinais de áudio.

### Quando Usar

* Para silenciar o áudio instantaneamente sem fade
* Durante seções silenciosas ou pausas
* Para evitar saída de ruído indesejado

## Polarity Inversion

Uma ferramenta que inverte a polaridade do sinal de áudio. Inverter todos os canais geralmente não muda o que você ouve por si só, mas pode ajudar quando um alto-falante, cabo ou canal parece estar conectado com polaridade oposta.

Para corrigir uma suspeita de polaridade invertida entre esquerda/direita ou em um sistema multicanal, limite os canais processados nas configurações comuns de roteamento do efeito e inverta apenas o canal afetado.

### Quando Usar

* Quando a imagem central soa fraca, oca ou espalhada porque um canal pode estar com polaridade oposta
* Ao verificar ou corrigir a polaridade de alto-falantes, cabos ou canais em um sistema de reprodução
* Ao combinar com roteamento ou efeitos estéreo que precisam da polaridade de um canal invertida

## Stereo Balance

Permite ajustar como a música é distribuída entre seus alto-falantes ou fones esquerdo e direito. Perfeito para corrigir estéreo desigual ou criar sua posição sonora preferida.

### Guia de Aperfeiçoamento de Audição

* Equilíbrio Perfeito:

  * Posição central para estéreo natural
  * Volume igual em ambas as orelhas
  * Melhor para a maioria das músicas
* Equilíbrio Ajustado:

  * Compensar a acústica do ambiente
  * Ajustar para diferenças auditivas
  * Criar cenário sonoro preferido

### Parâmetros

* **Balance** - Controla a distribuição esquerda-direita (-100% a +100%)

  * Center (0%): Igual em ambos os lados
  * Left (-100%): Mais som à esquerda
  * Right (+100%): Mais som à direita

### Exibição Visual

* Controle deslizante fácil de usar
* Exibição clara de números
* Indicador visual da posição estéreo

### Usos Recomendados

1. Audição Geral

   * Mantenha o equilíbrio centralizado (0%)
   * Ajuste se o estéreo parecer desequilibrado
   * Use ajustes sutis

2. Audição em Fones

   * Ajuste fino para conforto
   * Compensar diferenças auditivas
   * Criar imagem estéreo preferida

3. Audição em Alto-falantes

   * Ajuste para a configuração do ambiente
   * Equilibrar para a posição de audição
   * Compensar a acústica do ambiente

## Volume

Um controle simples, mas essencial, que permite ajustar o volume de reprodução da sua música. Perfeito para encontrar o nível de audição ideal para diferentes situações.

### Guia de Aperfeiçoamento de Audição

* Ajuste para diferentes cenários de audição:

  * Música de fundo enquanto trabalha
  * Sessões de audição ativa
  * Audição silenciosa à noite
* Mantenha o volume em níveis confortáveis para evitar:

  * Fadiga auditiva
  * Distorção de som
  * Potencial dano auditivo

### Parâmetros

* **Volume** - Controla a sonoridade geral (-60dB a +24dB)

  * Valores menores: reprodução mais silenciosa
  * Valores maiores: reprodução mais alta
  * 0dB: nível de volume original

Lembre-se: esses controles básicos são a base de um bom som. Comece com esses ajustes antes de usar efeitos mais complexos!
