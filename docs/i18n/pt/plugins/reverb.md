---
title: "Plugins de Reverberação - Reverb de convolução, hall, placa e sala - EffeTune"
description: "Plugins de reverb Dattorro Plate Reverb, FDN Reverb, IR Reverb e RS Reverb."
lang: pt
---

# Plugins de Reverberação

Uma coleção de plugins que adicionam espaço e atmosfera à sua música. Esses efeitos podem fazer sua música soar como se estivesse sendo tocada em diferentes ambientes, desde salas íntimas até grandes salas de concerto, aprimorando sua experiência de audição com ambiência natural e profundidade.

## Lista de Plugins

- [Dattorro Plate Reverb](#dattorro-plate-reverb) - Reverb de placa clássico baseado no algoritmo Dattorro
- [FDN Reverb](#fdn-reverb) - Reverb de Rede de Atraso de Feedback com matriz de difusão avançada
- [IR Reverb](#ir-reverb) - Reverb por convolução com uma resposta ao impulso importada
- [RS Reverb](#rs-reverb) - Cria ambiência e espaço natural de sala

## Dattorro Plate Reverb

Um reverb de placa baseado no projeto de Jon Dattorro de 1997. Ele acrescenta um decaimento denso e suave, adequado quando você quer uma ambiência espaçosa sem a impressão de uma sala específica.

### Guia de experiência de audição
- Som de Placa Exuberante:
  - Caráter clássico de reverb de placa
  - Cauda de reverb suave e densa sem artefatos metálicos
  - Belo brilho e calor característicos dos reverbs de placa
- Ambiência Versátil:
  - De aprimoramento sutil de sala a salões expansivos
  - Funciona lindamente com qualquer gênero musical
  - Adiciona polimento suave e espaço à música
- Movimento Natural:
  - A modulação adiciona vida orgânica ao reverb
  - Previne caudas estáticas e artificiais
  - Cria um espaço vivo e respirante ao redor da sua música

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para aplicar uma configuração completa de reverberação de placa.

- **Studio Plate** - Uma reverberação de placa curta e brilhante para a audição cotidiana.
- **Vocal Plate** - Separa o ataque do som original da reverberação com um pré-atraso mais longo.
- **Dark Vintage Plate** - Uma reverberação de placa mais escura, com maior amortecimento dos agudos.
- **Long Wash** - Uma cauda de reverberação longa e envolvente, com modulação.

### Parâmetros
- **Pre Delay** - Silêncio inicial antes do início do reverb (controle de 0.0 a 100.0 ms; use valores abaixo de 100.0 ms para pre-delay efetivo)
  - 0-10ms: Reverb imediato, sensação íntima
  - 10-30ms: Sensação natural de espaço
  - 30-99.9ms: Cria impressão de espaços maiores
  - Evite exatamente 100.0ms quando quiser o pre-delay máximo, porque esse valor produz um pre-delay quase inaudível
- **Bandwidth** - Filtragem do sinal de entrada (0.0 a 1.0)
  - Valores mais baixos: Tom de entrada mais escuro e quente
  - Valores mais altos (perto de 1.0): Entrada mais brilhante, frequência completa
  - Padrão 0.9995: Ótimo conforme sugerido por Dattorro
- **Input Diff 1** - Primeira etapa de difusão de entrada (0.0 a 1.0)
  - Controla a dispersão inicial do sinal de entrada
  - Padrão 0.75: Valor recomendado do artigo de Dattorro
  - Valores mais altos: Reflexões iniciais mais difusas e suaves
- **Input Diff 2** - Segunda etapa de difusão de entrada (0.0 a 1.0)
  - Dispersa mais o sinal de entrada
  - Padrão 0.625: Valor recomendado do artigo de Dattorro
  - Trabalha com Input Diff 1 para criar difusão complexa
- **Decay** - Quanto tempo dura a cauda do reverb (0.0 a 1.0)
  - Baixo (0.1-0.3): Decaimento curto e controlado
  - Médio (0.4-0.6): Decaimento natural tipo sala
  - Alto (0.7-1.0): Caudas longas e expansivas
- **Decay Diff 1** - Difusão de decaimento no tanque (0.0 a 1.0)
  - Controla a densidade durante a fase de decaimento
  - Padrão 0.70: Valor recomendado do artigo de Dattorro
  - Afeta a suavidade da cauda do reverb
- **Damping** - Absorção de alta frequência ao longo do tempo (0.0 a 1.0)
  - 0.0: Sem amortecimento, reverb brilhante em toda parte
  - 0.0005 (padrão): Amortecimento muito sutil e natural
  - Valores mais altos: Decaimento mais escuro e quente
- **Mod Depth** - Quantidade de modulação de atraso (0.0 a 16.0 amostras)
  - 0.0: Sem modulação, reverb estático
  - 1.0-4.0: Movimento sutil, adiciona vida
  - 8.0-16.0: Efeito tipo chorus mais notável
- **Mod Rate** - Velocidade de modulação (0.0 a 10.0 Hz)
  - 0.5-1.5Hz: Movimento lento e suave
  - 2.0-4.0Hz: Modulação mais ativa
  - Valores mais altos: Efeito rápido e brilhante
- **Wet Mix** - Quantidade de reverb adicionada (0 a 100%)
  - 10-30%: Aprimoramento sutil
  - 30-50%: Presença notável
  - 50-100%: Efeito de reverb dominante
- **Dry Mix** - Quantidade de sinal original (0 a 100%)
  - Geralmente mantida em 100% para audição normal
  - Reduzir para efeitos especiais ou lavagens ambientes

### Configurações recomendadas para diferentes estilos musicais

1. Piano Clássico
   - Decay: 0.6-0.7
   - Damping: 0.001
   - Mod Depth: 1.0
   - Wet Mix: 25-35%
   - Útil para: Piano solo, música de câmara

2. Vocais e Acústico
   - Decay: 0.4-0.5
   - Damping: 0.002
   - Pre Delay: 15-25ms
   - Wet Mix: 20-30%
   - Útil para: Vocais, violão

3. Ambiente e Atmosférico
   - Decay: 0.8-0.95
   - Mod Depth: 4.0-8.0
   - Mod Rate: 0.5-1.0Hz
   - Wet Mix: 50-70%
   - Útil para: Ambient, eletrônica, paisagens sonoras

4. Aprimoramento Geral
   - Decay: 0.5
   - Damping: 0.0005
   - Mod Depth: 1.0
   - Wet Mix: 20-30%
   - Útil para: Audição geral e ambiência sutil

### Guia de início rápido

1. Definir o Caráter Básico
   - Comece com Decay para controlar o comprimento do reverb
   - Ajuste Pre Delay para a distância percebida
   - Configure Wet Mix para a presença de reverb desejada

2. Moldar o Timbre
   - Use Bandwidth para controlar o brilho de entrada
   - Ajuste Damping para o decaimento de alta frequência
   - Ajuste fino dos parâmetros de difusão para densidade

3. Adicionar Movimento
   - Configure Mod Depth para variação sutil (tente 1.0)
   - Ajuste Mod Rate para velocidade (tente 1.0Hz)
   - Estes parâmetros adicionam vida ao reverb

4. Equilíbrio Final
   - Ajuste a mistura Wet/Dry ao gosto
   - Confie em seus ouvidos para os ajustes finais
   - Os valores padrão são um ótimo ponto de partida

O Dattorro Plate Reverb traz uma ambiência clássica em estilo de placa para sua experiência de escuta. Seu caráter suave e exuberante é útil para adicionar um espaço bonito e natural a uma gravação.

### Roteamento multicanal

O Dattorro Plate Reverb é um modelo de placa estéreo. Quando roteado com mais de dois canais, todos os canais de entrada roteados alimentam uma placa mono para estéreo compartilhada, mas a mistura wet/dry é escrita apenas no primeiro par estéreo roteado. Canais adicionais contribuem para a entrada da placa e, fora isso, passam sem alteração, inclusive quando Dry Mix está em 0%; eles não recebem retorno wet e não são tanks de placa independentes.

## FDN Reverb

O FDN Reverb acrescenta um decaimento denso e natural. Use-o para dar a gravações secas ou próximas uma noção mais clara de tamanho e distância do ambiente.

### Guia de experiência de audição
- Sensação de Sala Natural:
  - Cria a sensação de ouvir em espaços acústicos reais
  - Adiciona profundidade e dimensão à sua música
  - Faz gravações estéreo parecerem mais espaçosas e vivas
- Aprimoramento Atmosférico:
  - Transforma gravações planas em experiências imersivas
  - Adiciona belos sustains e caudas às notas musicais
  - Cria uma sensação de estar no espaço de performance
- Ambiência Personalizável:
  - Ajustável desde salas íntimas até grandes salas de concerto
  - Controle fino sobre o caráter e cor do espaço
  - Modulação suave adiciona movimento natural e vida

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para aplicar um espaço completo, em vez de ajustar cada controle separadamente.

- **Tight Room** - Uma resposta de sala curta e contida.
- **Warm Hall** - Um salão mais longo e levemente escurecido para música acústica e orquestral.
- **Bright Plate** - Uma reverberação curta, mais brilhante e animada, com caráter de placa.
- **Vast Cavern** - O maior e mais longo dos espaços fornecidos.

### Parâmetros
- **Reverb Time** - Duração do efeito de reverb (0.20 a 10.00 s)
  - Curto (0.2-1.0s): Decaimento rápido e controlado para clareza
  - Médio (1.0-3.0s): Reverberação natural tipo sala
  - Longo (3.0-10.0s): Caudas expansivas e atmosféricas
- **Density** - Número de caminhos de eco para complexidade (4 a 8 linhas)
  - 4 linhas: Ecos individuais mais simples e definidos
  - 6 linhas: Bom equilíbrio de complexidade e clareza
  - 8 linhas: Máxima suavidade e densidade
- **Pre Delay** - Silêncio inicial antes do início do reverb (0.0 a 100.0 ms)
  - 0-20ms: Reverb imediato, sensação íntima
  - 20-50ms: Sensação natural de distância de sala
  - 50-100ms: Cria impressão de espaços maiores
- **Base Delay** - Timing fundamental para a rede de reverb (10.0 a 60.0 ms)
  - Valores menores: Caráter de reverb mais apertado e focado
  - Valores maiores: Qualidade sonora mais espaçosa e aberta
  - Afeta as relações de timing fundamentais
- **Delay Spread** - Adiciona variação progressiva de timing entre linhas de delay sobre pequenos offsets aleatórios por linha (0.0 a 25.0 ms)
  - 0.0ms: Usa o delay base mais pequenos offsets aleatórios por linha, então as reflexões ainda ficam levemente irregulares
  - Valores maiores: Adicionam mais espalhamento progressivo entre linhas para uma cauda maior e menos regular
  - Adiciona variação realista encontrada em espaços acústicos reais
- **HF Damp** - Como as altas frequências desvanecem ao longo do tempo (0.0 a 12.0 dB/s)
  - 0.0: Sem amortecimento, som brilhante durante todo o decaimento
  - 3.0-6.0: Simulação natural de absorção do ar
  - 12.0: Amortecimento pesado para caráter quente e suave
- **Low Cut** - Remove baixas frequências do reverb (20 a 500 Hz)
  - 20-50Hz: Resposta completa de graves no reverb
  - 100-200Hz: Graves controlados para evitar confusão
  - 300-500Hz: Graves apertados e claros
- **Mod Depth** - Quantidade de modulação de pitch para efeito chorus (0.0 a 10.0 cents)
  - 0.0: Sem modulação, reverb estático puro
  - 2.0-5.0: Movimento sutil que adiciona vida e realismo
  - 10.0: Efeito chorus-like notável
- **Mod Rate** - Velocidade da modulação (0.10 a 5.00 Hz)
  - 0.1-0.5Hz: Movimento muito lento e suave
  - 1.0-2.0Hz: Variação de som natural
  - 3.0-5.0Hz: Modulação rápida e mais óbvia
- **Diffusion** - Controla quanto do feedback misturado retorna à rede de delays (0 a 100%)
  - 0%: Desativa a difusão no feedback; o som fica muito mais esparso e a cauda de reverb é bastante reduzida
  - 50%: Difusão equilibrada para som natural
  - 100%: Difusão máxima de feedback para a densidade mais suave
- **Wet Mix** - Quantidade de reverb adicionada ao som (0 a 100%)
  - 10-30%: Aprimoramento espacial sutil
  - 30-60%: Presença notável de reverb
  - 60-100%: Efeito de reverb dominante
- **Dry Mix** - Quantidade de sinal original preservada (0 a 100%)
  - Geralmente mantida em 100% para audição normal
  - Pode ser reduzida para efeitos atmosféricos especiais
- **Stereo Width** - Mistura o reverb wet de mono para taps wet esquerdo/direito separados (0 a 200%)
  - 0%: Reverb wet aparece no centro (mono)
  - 100%: Largura estéreo wet moderada padrão
  - 200%: Separação completa dos taps wet esquerdo/direito, não amplificação extra dos lados

### Configurações recomendadas para diferentes experiências de audição

1. Aprimoramento de Música Clássica
   - Reverb Time: 2.5-3.5s
   - Density: 8 linhas
   - Pre Delay: 30-50ms
   - HF Damp: 4.0-6.0
   - Útil para: Gravações orquestrais, música de câmara

2. Atmosfera de Clube de Jazz
   - Reverb Time: 1.2-1.8s
   - Density: 6 linhas
   - Pre Delay: 15-25ms
   - HF Damp: 2.0-4.0
   - Útil para: Jazz acústico, performances íntimas

3. Aprimoramento Pop/Rock
   - Reverb Time: 1.0-2.0s
   - Density: 6-7 linhas
   - Pre Delay: 10-30ms
   - Wet Mix: 20-40%
   - Útil para: Gravações que precisam de um pouco mais de espaço

4. Paisagens Sonoras Ambientes
   - Reverb Time: 4.0-8.0s
   - Density: 8 linhas
   - Mod Depth: 3.0-6.0
   - Wet Mix: 60-80%
   - Útil para: Música atmosférica e decaimentos longos

### Guia de início rápido

1. Definir o Caráter do Espaço
   - Comece com Reverb Time para corresponder ao tamanho de espaço desejado
   - Configure Density para 6-8 para som suave e natural
   - Ajuste Pre Delay para controlar a percepção de distância

2. Moldar o Timbre
   - Use HF Damp para simular absorção natural do ar
   - Configure Low Cut para prevenir acúmulo de graves
   - Ajuste Diffusion para suavidade (tente 70-100%)

3. Adicionar Movimento Natural
   - Configure Mod Depth para 2-4 cents para vida sutil
   - Use Mod Rate em torno de 0.3-1.0 Hz para variação suave
   - Ajuste Stereo Width para impressão espacial

4. Equilibrar o Efeito
   - Comece com 30% Wet Mix
   - Mantenha Dry Mix em 100% para audição normal
   - Ajuste fino baseado em sua música e preferências

Comece com um valor baixo de Wet Mix e aumente-o até que o espaço acrescentado fique audível sem mascarar os detalhes da gravação.

### Roteamento multicanal

Todos os canais de entrada roteados são misturados em uma única reverberação compartilhada. O som reverberado é distribuído pelos canais de saída roteados, sem criar uma reverberação independente para cada entrada.

## IR Reverb

O IR Reverb faz a convolução do sinal com uma resposta ao impulso (IR) importada e reproduz o decaimento e o caráter espacial medidos de uma sala, auditório, placa ou outro sistema acústico. É útil quando você quer o caráter reproduzível de uma captura específica, em vez de um modelo de reverberação sintetizado.

### Guia de aprimoramento da audição

- **Ambiência discreta de sala:** importe uma IR curta de sala, mantenha **Dry** ativado com **Dry Level** em 0 dB, ajuste **Wet Level** entre -18 e -12 dB e use um **Pre Delay** curto. Isso acrescenta espaço sem encobrir a gravação.
- **Ampliação de sala de concerto:** use uma IR de auditório estéreo ou True Stereo, reduza primeiro **Wet Level** e depois encurte uma cauda longa demais com **Decay** e **Trim**.
- **Send/return de reverberação:** envie a fonte para outro bus com **Matrix**, coloque o IR Reverb nesse retorno com **Dry** desativado e **Wet Level** em 0 dB e controle a reverberação pelo nível de envio. Isso evita somar o sinal seco duas vezes e também funciona com retornos multicanal selecionados.
- **Comparação e reprodutibilidade:** guarde o arquivo IR original e o registro de sua fonte e licença. Os mesmos bytes de IR geram o mesmo ID na biblioteca, então outra instalação pode reconectá-la exatamente importando esse arquivo.

### Parâmetros

- **Channel Mode** - Seleciona como os canais da IR são roteados. **Auto** seleciona Mono para uma IR de um canal, True Stereo para uma IR de quatro canais com seleção estéreo, Independent quando as quantidades de canais da IR e da seleção coincidem e Diagonal Matrix nos demais casos; o modo resultante aparece à direita do menu. **Mono** aplica uma IR aos canais selecionados; **Independent** associa um canal da IR a cada canal selecionado; **True Stereo** usa os caminhos LL/LR/RL/RR; **Diagonal Matrix** associa canais de entrada e saída correspondentes sem crossfeed.
- **Latency** - Escolhe a latência do bloco de convolução (Zero, 128, 256, 512 ou 1024 amostras). Valores maiores geralmente aliviam o processamento, mas atrasam toda a saída do efeito; o sinal direto é atrasado na mesma medida para continuar alinhado com a reverberação, e a cadeia compensa esse atraso. **Zero** exige **Convolution Rate = Full**.
- **Convolution Rate** - Define a taxa usada pela convolução wet. **Auto** usa meia taxa quando a taxa do contexto é alta e mostra a taxa resultante à direita do menu, enquanto **Full**, **Half** e **Quarter** tornam a escolha explícita. Taxas reduzidas diminuem a carga de processamento, mas também a largura de banda do caminho wet; Quarter exige uma taxa de contexto de pelo menos 176.4 kHz.
- **Wet Level** - Define o nível da saída convoluída de -96 a +12 dB. O padrão é -15 dB para o uso comum como insert; em uma configuração de send/return, use 0 dB e controle a quantidade de reverberação pelo nível de envio.
- **Dry** - Ativa o sinal direto. Fica ativado por padrão; desative-o para remover totalmente o sinal seco, mantendo o valor de **Dry Level** para uso posterior.
- **Dry Level** - Define o nível do sinal direto de -96 a +12 dB enquanto **Dry** está ativado. O extremo de -96 dB também silencia o sinal seco.
- **Pre Delay** - Atrasa apenas o sinal wet de 0 a 500 ms, separando o transiente original da resposta da sala.
- **Direct Cut** - Remove da IR o impulso direto detectado, para que a captura contribua apenas com sua parte reverberante. A normalização continua usando a IR sem corte como referência, então ativar o Direct Cut não aumenta o nível da cauda reverberante restante.
- **Cut Offset** - Move o ponto de corte detectado de -20 a +50 ms quando **Direct Cut** está ativado.
- **Decay** - Remodela o decaimento da IR de 10% a 400%; 100% preserva o decaimento gravado, valores menores o encurtam e valores maiores o prolongam.
- **Trim** - Conserva de 1% a 100% da IR após o corte, com um fade. Valores menores reduzem o comprimento da cauda, o uso de CPU e a memória.

### Como ler o gráfico de decaimento

O tempo avança da esquerda para a direita e o nível vai de 0 a -90 dB. A curva contínua de decaimento de energia (EDC) mostra como a energia acústica armazenada diminui; uma descida mais íngreme significa uma cauda mais curta. O envelope tênue dá o contexto dos transientes. Os marcadores indicam o início detectado, o ponto de corte direto ativo, o pre-delay do sinal wet e o ponto de trim. **RT60** estima o tempo para um decaimento de 60 dB; “unavailable” significa que a IR não continha um trecho confiável para o ajuste. Quando **Decay** é diferente de 100%, compare a curva contínua remodelada com a curva original pontilhada. Passe o cursor sobre o gráfico, ou toque e arraste, para ler os valores nesse ponto.

### Roteamento, biblioteca e compartilhamento

Uma IR mono pode alimentar os canais selecionados, canais independentes da IR permanecem separados e uma IR True Stereo de quatro canais usa as rotas cruzadas LL/LR/RL/RR. Em Auto, toda IR de quatro canais com seleção estéreo é interpretada nessa ordem; para layouts Quad ou outros layouts de quatro canais, escolha explicitamente Independent ou Diagonal Matrix. Outros arquivos multicanal usam uma rota diagonal limitada; o IR Reverb não cria uma matriz completa de crossfeed surround. Para arquivos True Stereo em par, selecione juntos os arquivos com nomes correspondentes `L`/`R` ou `Left`/`Right`.

Os arquivos IR importados ficam na **Biblioteca de respostas ao impulso**, onde você pode pesquisá-los, carregá-los ou excluí-los pelo nome original. Para excluir vários de uma vez, marque as caixas de seleção ou use **Selecionar tudo** para selecionar todas as entradas exibidas no momento e escolha **Excluir selecionadas**. **Ctrl+A** (**Command+A** no macOS) também seleciona todas as entradas visíveis; **Desmarcar tudo** limpa a seleção. Áudio WAV com a extensão `.irs` pode ser importado sem renomear o arquivo. Na versão web, esses arquivos ficam armazenados no navegador e podem ser perdidos se você limpar os dados do site ou se o navegador liberar espaço. O app desktop os guarda junto com os dados do aplicativo. Mantenha uma cópia separada de cada IR de que precisar.

URLs compartilhadas e predefinições identificam a IR, mas não incluem seus dados de áudio. Se a IR não estiver disponível, nenhum som wet é produzido; importe ou selecione a IR novamente, ou escolha uma substituta. O sinal direto continua conforme **Dry** e **Dry Level**.

Para material disponível gratuitamente, comece pela [biblioteca OpenAIR](https://www.openair.hosted.york.ac.uk/) da Universidade de York, pelos [downloads do EchoThief](https://www.echothief.com/downloads/) ou por envios individuais de IR no [Freesound](https://freesound.org/). “Gratuito” não significa sem restrições: o OpenAIR informa a licença na página de cada conteúdo, e os arquivos do Freesound podem ser CC0, CC BY ou CC BY-NC. Verifique a página de download específica, guarde o autor, a fonte e a licença junto com o arquivo, faça a atribuição quando exigida e confirme se o uso comercial ou a redistribuição pretendidos são permitidos. O EffeTune não armazena nem verifica informações de licença.

## RS Reverb

O RS Reverb acrescenta reflexões e decaimento ajustáveis, fazendo uma gravação seca soar como se estivesse sendo tocada em uma sala ou auditório.

### Guia de experiência de audição
- Espaço Íntimo:
  - Comece com Room Size 8-12m, Reverb Time 1.0-1.5s e Mix 20-30%
  - Reduza Mix se as vozes ou os ataques dos instrumentos perderem clareza
- Espaço de Auditório:
  - Comece com Room Size 30-40m, Reverb Time 2.0-2.5s e Mix 30-40%
  - Encurte Reverb Time se notas sucessivas ficarem borradas
- Decaimento Longo e Atmosférico:
  - Comece com Room Size 25-40m, Reverb Time 3-6s e Mix 40-60%
  - Aumente Damping ou reduza High Damp se a cauda ficar brilhante demais

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para aplicar uma configuração completa de sala ou auditório.

- **Small Room** - Uma ambiência de sala curta e próxima, com 5 ms de pre-delay e decaimento de graves mais contido.
- **Jazz Club** - Uma sala moderada com 15 ms de pre-delay para material acústico intimista.
- **Concert Hall** - Um espaço maior e mais profundo, com 25 ms de pre-delay e decaimento de graves mais cheio.
- **Cathedral** - Um espaço longo e escuro, com 40 ms de pre-delay e o decaimento de graves mais cheio.

### Parâmetros
- **Pre-Delay** (0 a 50 ms) - Atrasa as reflexões do sinal reverberado antes de entrarem no modelo de sala. Valores mais altos mantêm o ataque do som original distinto por mais tempo, mas não eliminam o atraso do próprio modelo de sala.
- **Room Size** - Define quão grande o espaço parece (2.0 a 50.0 m)
  - Pequeno (2-5m): Sensação de sala aconchegante
  - Médio (5-15m): Atmosfera de sala ao vivo
  - Grande (15-50m): Grandiosidade de sala de concerto
- **Reverb Time** - Quanto tempo os ecos duram (0.1 a 10.0 s)
  - Curto (0.1-1.0s): Som claro e focado
  - Médio (1.0-3.0s): Som natural de sala
  - Longo (3.0-10.0s): Espacioso e atmosférico
- **Density** - Quão rico o espaço parece (4 a 8)
  - Valores mais baixos: Ecos mais definidos
  - Valores mais altos: Atmosfera mais suave
  - Comece com 6 para som natural
- **Diffusion** - Como o som se espalha (0.2 a 0.8)
  - Valores mais baixos: Ecos mais distintos
  - Valores mais altos: Mistura mais suave
  - Tente 0.5 para som equilibrado
- **Damping** - Como os ecos desaparecem (0 a 100%)
  - Valores mais baixos: Som mais brilhante e aberto
  - Valores mais altos: Mais quente e íntimo
  - Comece em torno de 40% para sensação natural
- **High Damp** - Controla o brilho do espaço (1000 a 20000 Hz)
  - Valores mais baixos: Espaço mais escuro e quente
  - Valores mais altos: Mais brilhante e aberto
  - Comece em torno de 8000Hz para som natural
- **Low Damp** - Controla a plenitude do espaço (20 a 500 Hz)
  - Valores mais baixos: Som mais cheio e rico
  - Valores mais altos: Mais claro e controlado
  - Comece em torno de 100Hz para graves equilibrados
- **Mix** - Equilibra o efeito com o som original (0 a 100%)
  - 10-30%: Aprimoramento sutil
  - 30-50%: Espaço notável
  - 50-100%: Efeito dramático

### Configurações recomendadas para diferentes estilos de música

1. Música Clássica em Sala de Concerto
   - Room Size: 30-40m
   - Reverb Time: 2.0-2.5s
   - Mix: 30-40%
   - Útil para: Obras orquestrais, concertos de piano

2. Clube de Jazz Íntimo
   - Room Size: 8-12m
   - Reverb Time: 1.0-1.5s
   - Mix: 20-30%
   - Útil para: Jazz, apresentações acústicas

3. Pop/Rock Moderno
   - Room Size: 15-20m
   - Reverb Time: 1.2-1.8s
   - Mix: 15-25%
   - Útil para: Música contemporânea

4. Ambiente/Eletrônica
   - Room Size: 25-40m
   - Reverb Time: 3.0-6.0s
   - Mix: 40-60%
   - Útil para: Música eletrônica atmosférica

### Guia de início rápido

1. Escolha Seu Espaço
   - Comece com Room Size para definir o espaço básico
   - Ajuste Reverb Time para a atmosfera desejada
   - Ajuste fino do Mix para equilíbrio adequado

2. Molde o Som
   - Use Damping para controlar o calor
   - Ajuste High/Low Damp para o tom
   - Configure Density e Diffusion para textura

3. Ajuste Fino do Efeito
   - Ajuste Mix para equilíbrio final
   - Confie em seus ouvidos e ajuste ao gosto

Comece com um valor baixo de Mix e aumente-o até que o espaço acrescentado fique nítido sem encobrir a gravação original.
