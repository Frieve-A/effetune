---
title: "Basic Plugins - EffeTune"
description: "Essential audio plugins including Volume, Mute, Stereo Balance, Matrix routing, and more."
lang: en
---

# Basic Audio Plugins

Uma coleção de ferramentas essenciais para ajustar os aspectos fundamentais da reprodução da sua música. Esses plugins ajudam você a controlar o volume, o equilíbrio e outros aspectos básicos da sua experiência auditiva.

## Lista de Plugins

* [Channel Divider](#channel-divider) - Divide o áudio em bandas de frequência por múltiplos canais
* [DC Offset](#dc-offset) - Ajuda a corrigir áudio que soa desequilibrado
* [Matrix](#matrix) - Roteia e mistura canais de áudio com controle flexível
* [MultiChannel Panel](#multichannel-panel) - Controla múltiplos canais de áudio com configurações individuais
* [Mute](#mute) - Silencia a saída de áudio
* [Polarity Inversion](#polarity-inversion) - Pode melhorar como a música estéreo soa
* [Stereo Balance](#stereo-balance) - Ajusta o equilíbrio esquerdo-direito da sua música
* [Volume](#volume) - Controla o quão alto a música é reproduzida

## Channel Divider

Uma ferramenta especializada que divide seu sinal estéreo em bandas de frequência separadas e direciona cada banda para diferentes canais de saída. Perfeita para sistemas multicanal ou configurações de crossover personalizadas.

Para usar este efeito, você precisa usar o aplicativo para desktop, definir o número de canais de saída nas configurações de áudio para 4 ou mais e definir o canal no roteamento de efeitos para "Tudo".

### Quando Usar

* Ao usar saídas de áudio multicanal (4, 6 ou 8 canais)
* Para criar roteamento de canais personalizado baseado em frequência
* Para configurações com vários amplificadores ou vários alto-falantes

### Parâmetros

* **Band Count** - Número de bandas de frequência a serem criadas (2-4 bandas)

  * 2 bandas: divisão Graves/Agudos
  * 3 bandas: divisão Graves/Médias/Agudos
  * 4 bandas: divisão Graves/Graves-Médias/Médias-Agudos/Agudos

* **Crossover Frequencies** - Define onde o áudio é dividido entre as bandas

  * F1: Primeiro ponto de crossover
  * F2: Segundo ponto de crossover (para 3 ou mais bandas)
  * F3: Terceiro ponto de crossover (para 4 bandas)

* **Slopes** - Controlam o quão abruptamente as bandas são separadas

  * Opções: -12dB a -96dB por oitava
  * Inclinações mais acentuadas oferecem separação mais limpa
  * Inclinações menores oferecem transições mais naturais

### Notas Técnicas

* Processa apenas os dois primeiros canais de entrada
* Os canais de saída devem ser múltiplos de 2 (4, 6 ou 8)
* Utiliza filtros de crossover Linkwitz-Riley de alta qualidade
* Gráfico de resposta em frequência visual para configuração fácil

## DC Offset

Uma ferramenta que pode ajudar a corrigir áudio que soa desequilibrado ou estranho. A maioria dos ouvintes não precisará usar isso com frequência, mas é útil quando você encontrar áudio que não soe corretamente.

### Quando Usar

* Se a música soar incomumente desequilibrada
* Quando um canal parecer mais alto do que deveria
* Se outros efeitos não estiverem funcionando como esperado

### Parâmetros

* **Offset** - Ajusta o equilíbrio de áudio (-1.0 a +1.0)

  * 0.0: Configuração padrão
  * Ajuste se algo soar estranho
  * Pequenos ajustes geralmente funcionam melhor

## Matrix

Uma poderosa ferramenta de roteamento de canais que permite criar caminhos de sinal personalizados entre canais de entrada e saída. Oferece flexibilidade total em como os sinais de áudio são conectados e mixados.

### Quando Usar

* Para criar roteamentos personalizados entre canais
* Quando precisar mixar ou dividir sinais de maneiras específicas
* Para design de som criativo usando interações de canais

### Recursos

* Matriz de roteamento flexível para até 8 canais
* Controle de conexão individual entre qualquer par entrada/saída
* Opções de inversão de fase para cada conexão
* Interface de matriz visual para configuração intuitiva

### Como Funciona

* Cada ponto de conexão representa o roteamento de uma linha de entrada para uma coluna de saída
* Conexões ativas permitem que o sinal flua entre canais
* A opção de inversão de fase reverte a polaridade do sinal
* Múltiplas conexões de entrada para uma saída são mixadas juntas

### Aplicações Práticas

* Configurações personalizadas de downmixing ou upmixing
* Isolamento ou combinação de canais específicos
* Criando relações de fase entre canais
* Resolvendo requisitos complexos de roteamento

## MultiChannel Panel

Um painel de controle abrangente para gerenciar múltiplos canais de áudio individualmente. Este plugin fornece controle completo sobre volume, silenciamento, solo e atraso para até 8 canais, com um medidor de nível visual para cada canal.

### Quando Usar

* Ao trabalhar com áudio multicanal (até 8 canais)
* Para criar um equilíbrio de volume personalizado entre diferentes canais
* Quando precisar aplicar atraso individual em canais específicos
* Para monitorar níveis em vários canais simultaneamente

### Recursos

* Controles individuais para até 8 canais de áudio
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

* Balanceamento de sistemas de som surround
* Criação de mixagens personalizadas para fones de ouvido
* Alinhamento temporal de configurações multi-microfone
* Monitoramento e ajuste de fontes de áudio multicanal

## Mute

Uma ferramenta simples que silencia toda saída de áudio preenchendo o buffer com zeros. Útil para silenciar instantaneamente sinais de áudio.

### Quando Usar

* Para silenciar o áudio instantaneamente sem fade
* Durante seções silenciosas ou pausas
* Para evitar saída de ruído indesejado

## Polarity Inversion

Uma ferramenta que pode melhorar como a música estéreo soa em certas situações. É como "inverter" a onda de áudio para potencialmente torná-la melhor.

Você também pode inverter a polaridade de apenas canais específicos, limitando os canais a serem processados nas configurações comuns do efeito.

### Quando Usar

* Quando a música estéreo soar "vazia" ou "estranha"
* Se combinado com outros efeitos estéreo
* Ao tentar melhorar a espacialização estéreo

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
