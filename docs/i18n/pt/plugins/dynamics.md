---
title: "Plugins de Dinâmica - EffeTune"
description: "Plugins de dinâmica, incluindo Compressor, Limiter, Gate, Multiband Compressor e Transient Shaper."
lang: pt
---

# Plugins de Dinâmica

Uma coleção de plugins que ajudam a equilibrar as partes altas e baixas da sua música, tornando sua experiência de audição mais agradável e confortável.

## Lista de Plugins

- [Auto Leveler](#auto-leveler) - Ajuste automático de volume para uma experiência de audição consistente
- [Brickwall Limiter](#brickwall-limiter) - Controle transparente de picos para uma audição segura e confortável
- [Compressor](#compressor) - Equilibra automaticamente os níveis de volume para uma audição mais confortável (inclui expansão para cima)
- [Expander](#expander) - Expansão de faixa dinâmica abaixo do limite com controle de ratio e knee (inclui compressão para cima)
- [Gate](#gate) - Reduz pausas ou trechos de baixo nível abaixo de um limiar
- [Multiband Compressor](#multiband-compressor) - Balanceamento de volume em 5 bandas para um som estável, parecido com rádio
- [Multiband Expander](#multiband-expander) - Controle de contraste dinâmico em 5 bandas para gravações que parecem achatadas demais
- [Multiband Transient](#multiband-transient) - Ajusta punch e sustain separadamente em graves, médios e agudos
- [Power Amp Sag](#power-amp-sag) - Adiciona compressão semelhante à de amplificador, suavizando levemente trechos altos
- [Transient Shaper](#transient-shaper) - Controla as porções de transiente e sustentação do sinal

## Auto Leveler

Um controle inteligente de volume que ajusta automaticamente sua música para manter um nível de audição consistente. Ele usa uma estimativa de nível no estilo LUFS para manter a reprodução mais próxima do alvo escolhido, seja ouvindo peças clássicas suaves ou canções pop dinâmicas.

### Guia de Aprimoramento da Audição
- Música Clássica:
  - Desfrute tanto das passagens suaves quanto dos crescendos intensos sem precisar ajustar o volume
  - Ouça todos os detalhes sutis em peças para piano
  - Perfeito para álbuns com níveis de gravação variáveis
- Música Pop/Rock:
  - Mantenha um volume consistente entre diferentes faixas
  - Sem surpresas com faixas excessivamente altas ou baixas
  - Audição confortável em sessões prolongadas
- Música de Fundo:
  - Mantenha o volume estável enquanto trabalha ou estuda
  - Nunca muito alto ou muito baixo
  - Perfeito para playlists com conteúdo variado

### Parâmetros

- **Target** (-36.0dB a 0.0dB LUFS)
  - Define o nível de audição desejado
  - O padrão -18.0dB LUFS é confortável para a maioria das músicas
  - Valores mais baixos para uma escuta de fundo mais silenciosa
  - Valores mais altos para um som mais impactante

- **Time Window** (1000ms a 10000ms)
  - Determina a rapidez com que o nível é medido
  - Tempos mais curtos: Resposta mais rápida às mudanças
  - Tempos mais longos: Som mais estável e natural
  - O padrão de 3000ms funciona bem para a maioria das músicas

- **Max Gain** (0.0dB a 12.0dB)
  - Limita o quanto os sons suaves são amplificados
  - Valores mais altos: Volume mais consistente
  - Valores mais baixos: Dinâmica mais natural
  - Comece com 6.0dB para um controle suave

- **Min Gain** (-36.0dB a 0.0dB)
  - Limita o quanto os sons altos são reduzidos
  - Valores mais altos: Som mais natural
  - Valores mais baixos: Volume mais consistente
  - Experimente -12.0dB como ponto de partida

- **Attack Time** (1ms a 1000ms)
  - Define a rapidez com que o volume é reduzido
  - Tempos mais rápidos: Melhor controle de sons altos repentinos
  - Tempos mais lentos: Transições mais naturais
  - O padrão de 50ms equilibra controle e naturalidade

- **Release Time** (10ms a 10000ms)
  - Define a rapidez com que o volume retorna ao normal
  - Tempos mais rápidos: Resposta mais ágil
  - Tempos mais lentos: Transições mais suaves
  - O padrão de 5000ms proporciona mudanças de nível suaves e naturais

- **Noise Gate** (-96dB a -24dB)
  - Impede que trechos muito silenciosos ou ruído de fundo sejam amplificados demais
  - Valores mais altos: Menos amplificação de ruído de fundo silencioso
  - Valores mais baixos: Permite que o nivelador reaja a trechos mais silenciosos
  - Comece em -60dB e ajuste conforme necessário

### Feedback Visual
- Exibição em tempo real do nível LUFS
- Nível de entrada (linha verde)
- Nível de saída (linha branca)
- Feedback visual claro dos ajustes de volume
- Gráfico baseado no tempo de fácil leitura

### Configurações Recomendadas

#### Audição Geral
- Target: -18.0dB LUFS
- Time Window: 3000ms
- Max Gain: 6.0dB
- Min Gain: -12.0dB
- Attack Time: 50ms
- Release Time: 1000ms
- Noise Gate: -60dB

#### Música de Fundo
- Target: -23.0dB LUFS
- Time Window: 5000ms
- Max Gain: 9.0dB
- Min Gain: -18.0dB
- Attack Time: 100ms
- Release Time: 2000ms
- Noise Gate: -54dB

#### Música Dinâmica
- Target: -16.0dB LUFS
- Time Window: 2000ms
- Max Gain: 3.0dB
- Min Gain: -6.0dB
- Attack Time: 30ms
- Release Time: 500ms
- Noise Gate: -72dB

## Brickwall Limiter

Um limitador de pico de alta qualidade que garante que sua música nunca exceda um nível específico, prevenindo clipagem digital enquanto mantém a qualidade natural do som. Perfeito para proteger seu sistema de áudio e garantir níveis de audição confortáveis sem comprometer a dinâmica da música.

### Guia de Aprimoramento da Audição
- Música Clássica:
  - Aproveite com segurança os crescendos orquestrais completos
  - Mantenha a dinâmica natural das peças de piano
  - Proteja contra picos inesperados em gravações ao vivo
- Música Pop/Rock:
  - Mantenha volume consistente durante passagens intensas
  - Aproveite música dinâmica em qualquer nível de audição
  - Previna distorção em seções com muito grave
- Música Eletrônica:
  - Controle picos de sintetizador de forma transparente
  - Mantenha o impacto enquanto previne sobrecarga
  - Mantenha os drops de grave potentes mas controlados

### Parâmetros
- **Input Gain** (-18dB a +18dB)
  - Ajusta o nível que entra no limitador
  - Aumente para fazer os picos atingirem o limitador com mais frequência
  - Diminua se ouvir limitação em excesso
  - Valor padrão 0dB

- **Threshold** (-24dB a 0dB)
  - Define o nível de pico em que a limitação começa antes de Margin ser aplicado
  - O teto efetivo é Threshold + Margin
  - Valores mais baixos fornecem mais margem de segurança
  - Valores mais altos preservam mais dinâmica
  - Comece em -3dB para proteção suave

- **Release Time** (10ms a 500ms)
  - Rapidez com que a limitação é liberada
  - Tempos mais rápidos mantêm mais dinâmica
  - Tempos mais lentos para som mais suave
  - Tente 100ms como ponto de partida

- **Lookahead** (0ms a 10ms)
  - Permite ao limitador antecipar picos
  - Valores mais altos para limitação mais transparente
  - Valores mais baixos para menos latência
  - 3ms é um bom equilíbrio

- **Margin** (-1.000dB a 0.000dB)
  - Adiciona um deslocamento fino de segurança ao Threshold
  - O teto real é Threshold + Margin
  - Por exemplo, Threshold em -3dB com Margin em -1.000dB limita por volta de -4dB
  - Valor padrão -1.000dB funciona bem para a maioria dos materiais
  - Ajuste para controle preciso de picos

- **Oversampling** (1x, 2x, 4x, 8x)
  - Valores mais altos para limitação mais limpa
  - Valores mais baixos para menos uso de CPU
  - 4x é um bom equilíbrio entre qualidade e desempenho

### Controles e Medição
- Controles diretos para Input Gain, Threshold, Margin, Release, Lookahead e Oversampling
- Informações de redução de ganho do limitador são reportadas internamente para medição do host ou status
- O painel do plugin não mostra um gráfico separado de nível de pico

### Configurações Recomendadas

#### Proteção Transparente
- Input Gain: 0dB
- Threshold: -3dB
- Release: 100ms
- Lookahead: 3ms
- Margin: -1.000dB
- Oversampling: 4x
- Teto efetivo: cerca de -4dB

#### Máxima Segurança
- Input Gain: -6dB
- Threshold: -6dB
- Release: 50ms
- Lookahead: 5ms
- Margin: -1.000dB
- Oversampling: 8x
- Teto efetivo: cerca de -7dB

#### Dinâmica Natural
- Input Gain: 0dB
- Threshold: -1.5dB
- Release: 200ms
- Lookahead: 2ms
- Margin: -0.500dB
- Oversampling: 4x
- Teto efetivo: cerca de -2dB

## Compressor

Um efeito que suaviza diferenças de volume reduzindo gentilmente os picos altos. Use quando trechos que ficam altos de repente soarem incômodos, ou quando você quiser um nível de escuta mais uniforme e confortável. Depois da compressão, aumente Gain se quiser que o som geral, incluindo detalhes mais quietos, pareça mais alto.

### Guia de Aprimoramento da Audição
- Música Clássica:
  - Torna os crescendos orquestrais dramáticos mais confortáveis de ouvir
  - Equilibra a diferença entre passagens suaves e fortes do piano
  - Ajuda a ouvir detalhes silenciosos mesmo em seções poderosas
- Música Pop/Rock:
  - Cria uma experiência de audição mais confortável durante seções intensas
  - Torna os vocais mais claros e fáceis de entender
  - Reduz a fadiga auditiva durante sessões longas
- Música Jazz:
  - Equilibra o volume entre diferentes instrumentos
  - Faz as seções solo se misturarem mais naturalmente com o conjunto
  - Mantém a clareza durante passagens tanto quietas quanto altas

### Parâmetros

- **Threshold** - Define o nível de volume onde o efeito começa a funcionar (-60dB a 0dB)
  - Configurações mais altas: Afeta apenas as partes mais altas da música
  - Configurações mais baixas: Cria mais equilíbrio geral
  - Comece em -24dB para um equilíbrio suave
- **Ratio** - Controla quão fortemente o efeito equilibra o volume (1:0.5 a 1:20)
  - 1:0.5: Expansão para cima (potencia sons altos)
  - 1:1: Sem efeito (som original)
  - 1:2: Compressão suave
  - 1:4: Compressão moderada
  - 1:8+: Controle de volume forte
- **Attack Time** - Quão rapidamente o efeito responde a sons altos (0.1ms a 100ms)
  - Tempos mais rápidos: Controle de volume mais imediato
  - Tempos mais lentos: Som mais natural
  - Tente 20ms como ponto de partida
- **Release Time** - Quão rapidamente o volume retorna ao normal (10ms a 1000ms)
  - Tempos mais rápidos: Som mais dinâmico
  - Tempos mais lentos: Transições mais suaves e naturais
  - Comece com 200ms para audição geral
- **Knee** - Quão suavemente o efeito faz a transição (0dB a 12dB)
  - Valores mais baixos: Controle mais preciso
  - Valores mais altos: Som mais suave e natural
  - 6dB é um bom ponto de partida
- **Gain** - Ajusta o volume geral após o processamento (-12dB a +12dB)
  - Use para equiparar o volume com o som original
  - Aumente se a música parecer muito baixa
  - Diminua se estiver muito alta

### Exibição Visual

- Gráfico interativo mostrando como o efeito está funcionando
- Indicadores de nível de volume fáceis de ler
- Feedback visual para todos os ajustes de parâmetros
- Linhas de referência para ajudar a guiar suas configurações

### Configurações Recomendadas para Diferentes Cenários de Audição
- Audição Casual em Segundo Plano:
  - Threshold: -24dB
  - Ratio: 1:2
  - Attack: 20ms
  - Release: 200ms
  - Knee: 6dB
  - Gain: +2dB
- Sessões de Audição Crítica:
  - Threshold: -18dB
  - Ratio: 1:1.5
  - Attack: 30ms
  - Release: 300ms
  - Knee: 3dB
  - Gain: +1dB
- Audição Noturna:
  - Threshold: -30dB
  - Ratio: 1:4
  - Attack: 10ms
  - Release: 150ms
  - Knee: 9dB
  - Gain: +3dB
- Melhoria de Sons Altos:
  - Threshold: -12dB
  - Ratio: 1:0.5
  - Attack: 50ms
  - Release: 400ms
  - Knee: 6dB
  - Gain: 0dB

## Expander

Um processador de faixa dinâmica que expande a faixa dinâmica de sinais abaixo de um limite, tornando sons suaves ainda mais suaves enquanto deixa sons altos inalterados. Isso cria dinâmicas mais dramáticas e pode ajudar a restaurar dinâmicas naturais a material sobre-comprimido.

### Guia de Aprimoramento da Audição
- Música Clássica:
  - Restaura dinâmicas naturais a gravações sobre-comprimidas
  - Melhora o contraste entre passagens suaves e crescendos altos
  - Traz de volta o fluxo natural das performances orquestrais
- Música Pop/Rock:
  - Adiciona mais punch e impacto a seções dinâmicas
  - Cria contraste mais dramático entre versos e refrões
  - Restaura dinâmicas naturais a faixas fortemente comprimidas
- Música Jazz:
  - Melhora as dinâmicas naturais entre instrumentos
  - Torna solos suaves mais íntimos e seções altas mais poderosas
  - Restaura a respiração natural das performances de jazz

### Parâmetros

- **Threshold** - Define o nível de volume onde a expansão começa (-60dB a 0dB)
  - Configurações mais altas: Afeta apenas as partes mais suaves da música
  - Configurações mais baixas: Cria mais expansão dinâmica geral
  - Comece em -24dB para expansão suave
- **Ratio** - Controla quão fortemente o efeito expande a faixa dinâmica (1:0.05 a 1:20)
  - 1:0.5: Compressão para cima (potencia sons suaves)
  - 1:1: Sem efeito (som original)
  - 1:2: Expansão suave
  - 1:4: Expansão moderada
  - 1:8+: Expansão dinâmica forte
- **Attack Time** - Quão rapidamente o efeito responde a sons suaves (0.1ms a 100ms)
  - Tempos mais rápidos: Controle dinâmico mais imediato
  - Tempos mais lentos: Som mais natural
  - Tente 10ms como ponto de partida
- **Release Time** - Quão rapidamente as dinâmicas retornam ao normal (10ms a 1000ms)
  - Tempos mais rápidos: Som mais dinâmico
  - Tempos mais lentos: Transições mais suaves e naturais
  - Comece com 100ms para audição geral
- **Knee** - Quão suavemente o efeito faz a transição (0dB a 12dB)
  - Valores mais baixos: Controle mais preciso
  - Valores mais altos: Som mais suave e natural
  - 3dB é um bom ponto de partida
- **Gain** - Ajusta o volume geral após o processamento (-12dB a +12dB)
  - Use para equiparar o volume com o som original
  - Aumente se a música parecer muito baixa
  - Diminua se estiver muito alta

### Exibição Visual

- Gráfico interativo mostrando como a expansão está funcionando
- Indicadores de nível de volume fáceis de ler
- Feedback visual para todos os ajustes de parâmetros
- Linhas de referência para ajudar a guiar suas configurações

### Configurações Recomendadas para Diferentes Cenários de Audição
- Restauração de Dinâmicas Naturais:
  - Threshold: -18dB
  - Ratio: 1:2
  - Attack: 10ms
  - Release: 100ms
  - Knee: 3dB
- Aprimoramento Dinâmico Dramático:
  - Threshold: -12dB
  - Ratio: 1:4
  - Attack: 5ms
  - Release: 50ms
  - Knee: 1dB
- Aprimoramento de Sons Suaves:
  - Threshold: -30dB
  - Ratio: 1:0.5
  - Attack: 20ms
  - Release: 200ms
  - Knee: 6dB
- Aprimoramento Dinâmico Sutil:
  - Threshold: -24dB
  - Ratio: 1:1.5
  - Attack: 15ms
  - Release: 150ms
  - Knee: 6dB

## Gate

Um noise gate de banda inteira que reduz o sinal todo quando o nível cai abaixo de um limiar definido. Ele é útil para diminuir ruídos de baixo nível em pausas, fades ou entre frases faladas. Ele não separa nem remove ruído de ventilador, hum ou ruído da sala enquanto música ou fala está tocando por cima.

### Características Principais
- Controle preciso de threshold para detecção acurada de ruído
- Ratio ajustável para redução de ruído natural ou agressiva
- Tempos de attack e release variáveis para controle de timing ideal
- Opção de soft knee para transições suaves
- Medição de redução de ganho em tempo real
- Display interativo de função de transferência

### Parâmetros

- **Threshold** (-96dB a 0dB)
  - Define o nível onde a redução de ruído começa
  - Sinais abaixo deste nível serão atenuados
  - Valores mais altos: Redução de ruído mais agressiva
  - Valores mais baixos: Efeito mais sutil
  - Comece em -40dB e ajuste com base no seu nível de ruído

- **Ratio** (1:1 a 100:1)
  - Controla quão fortemente os sinais abaixo do threshold são atenuados
  - 1:1: Sem efeito
  - 10:1: Forte redução de ruído
  - 100:1: Silêncio quase completo abaixo do threshold
  - Comece em 10:1 para redução de ruído típica

- **Attack Time** (0.01ms a 50ms)
  - Quão rapidamente o gate responde quando o sinal sobe acima do threshold
  - Tempos mais rápidos: Mais preciso mas pode soar abrupto
  - Tempos mais lentos: Transições mais naturais
  - Tente 1ms como ponto de partida

- **Release Time** (10ms a 2000ms)
  - Quão rapidamente o gate fecha quando o sinal cai abaixo do threshold
  - Tempos mais rápidos: Controle de ruído mais apertado
  - Tempos mais lentos: Decaimento mais natural
  - Comece com 200ms para som natural

- **Knee** (0dB a 6dB)
  - Controla quão gradualmente o gate faz a transição ao redor do threshold
  - 0dB: Hard knee para gating preciso
  - 6dB: Soft knee para transições mais suaves
  - Use 1dB para redução de ruído de uso geral

- **Gain** (-12dB a +12dB)
  - Ajusta o nível de saída após o gating
  - Use para compensar qualquer perda percebida de volume
  - Tipicamente deixado em 0dB a menos que necessário

### Feedback Visual
- Gráfico de função de transferência interativo mostrando:
  - Relação entrada/saída
  - Ponto de threshold
  - Curva de knee
  - Inclinação do ratio
- Medidor de redução de ganho em tempo real exibindo:
  - Quantidade atual de redução de ruído
  - Feedback visual da atividade do gate

### Configurações Recomendadas

#### Redução Leve de Ruído
- Threshold: -50dB
- Ratio: 2:1
- Attack: 5ms
- Release: 300ms
- Knee: 3dB
- Gain: 0dB

#### Ruído de Fundo Moderado
- Threshold: -40dB
- Ratio: 10:1
- Attack: 1ms
- Release: 200ms
- Knee: 1dB
- Gain: 0dB

#### Gate Muito Agressivo
- Use apenas quando quiser quase silêncio nas pausas, como em gravações faladas ou intervalos muito ruidosos
- Threshold: -30dB
- Ratio: 50:1
- Attack: 0.1ms
- Release: 100ms
- Knee: 0dB
- Gain: 0dB

### Dicas de Aplicação
- Ajuste o threshold logo acima do nível de ruído para resultados ideais
- Use tempos de release mais longos para som mais natural
- Adicione algum knee ao processar material complexo
- Monitore o medidor de redução de ganho para garantir gating adequado
- Para música, evite thresholds ou ratios muito altos, a menos que queira cortar caudas silenciosas de propósito
- Combine com outros processadores de dinâmica para controle abrangente


## Multiband Compressor

Um processador de escuta em cinco bandas que equilibra a sonoridade separadamente em diferentes faixas de frequência. Use quando o grave salta demais, os vocais ficam muito à frente ou os agudos ficam ásperos. As configurações padrão criam um som estável, parecido com rádio, para audição casual.

### Características Principais
- Processamento de 5 bandas com frequências de crossover ajustáveis
- Controles de compressão independentes para cada banda
- Configurações padrão otimizadas para som estilo rádio FM
- Visualização em tempo real da redução de ganho por banda
- Filtros de crossover Linkwitz-Riley de alta qualidade

### Bandas de Frequência Padrão
As frequências de crossover são ajustáveis; estas são as faixas padrão.

- Banda 1 (Grave): Abaixo de 100 Hz
  - Controla as frequências graves profundas e sub-graves
  - Ratio mais alto e release mais longo para graves controlados e firmes
- Banda 2 (Médio-Grave): 100-500 Hz
  - Lida com os graves superiores e médios inferiores
  - Compressão moderada para manter o calor
- Banda 3 (Médio): 500-2000 Hz
  - Faixa crítica de presença vocal e instrumental
  - Compressão suave para preservar naturalidade
- Banda 4 (Médio-Agudo): 2000-8000 Hz
  - Controla presença e ar
  - Compressão leve com resposta mais rápida
- Banda 5 (Agudo): Acima de 8000 Hz
  - Gerencia brilho e cintilância
  - Tempos de resposta rápidos com ratio mais alto

### Parâmetros

#### Frequências de Crossover
- **Freq 1** (20Hz a 500Hz, padrão 100Hz)
  - Define o ponto de crossover Low/Low-Mid
- **Freq 2** (100Hz a 2000Hz, padrão 500Hz)
  - Define o ponto de crossover Low-Mid/Mid
- **Freq 3** (500Hz a 8000Hz, padrão 2000Hz)
  - Define o ponto de crossover Mid/High-Mid
- **Freq 4** (1000Hz a 20000Hz, padrão 8000Hz)
  - Define o ponto de crossover High-Mid/High
- As frequências são mantidas automaticamente em ordem crescente, então mover um controle pode elevar o próximo crossover se necessário

#### Controles por Banda
- **Threshold** (-60dB a 0dB)
  - Define o nível onde a compressão começa
  - Configurações mais baixas criam níveis mais consistentes
- **Ratio** (0.5:1 a 20:1)
  - 1:1: Sem mudança
  - Acima de 1:1: Comprime partes altas naquela banda
  - Abaixo de 1:1: Amplifica sons acima do threshold para um som de banda mais enfatizado
  - Para controle normal de escuta, comece por volta de 2:1 a 5:1
- **Attack** (0.1ms a 100ms)
  - Quão rapidamente a compressão responde
  - Tempos mais rápidos para controle de transientes
- **Release** (10ms a 1000ms)
  - Quão rapidamente o ganho retorna ao normal
  - Tempos mais longos para som mais suave
- **Knee** (0dB a 12dB)
  - Suavidade do início da compressão
  - Valores mais altos para transição mais natural
- **Gain** (-12dB a +12dB)
  - Ajuste de nível de saída por banda
  - Ajuste fino do balanço de frequência

### Processamento Estilo Rádio FM
O Multiband Compressor vem com configurações padrão otimizadas para um som de escuta estável no estilo de rádio FM:

- Banda Grave (< 100 Hz)
  - Ratio mais alto (4:1) para controle firme dos graves
  - Attack/release mais lentos para manter o punch
  - Leve redução para evitar embolamento

- Banda Médio-Grave (100-500 Hz)
  - Compressão moderada (3:1)
  - Timing balanceado para resposta natural
  - Ganho neutro para manter natural o equilíbrio de médios-graves

- Banda Média (500-2000 Hz)
  - Compressão suave (2.5:1)
  - Tempos de resposta rápidos
  - Leve boost para presença vocal

- Banda Médio-Aguda (2000-8000 Hz)
  - Compressão leve (2:1)
  - Attack/release rápidos
  - Boost de presença realçado

- Banda Aguda (> 8000 Hz)
  - Ratio mais alto (5:1) para brilho consistente
  - Tempos de resposta muito rápidos
  - Redução controlada para polimento

Esta configuração cria o som característico "pronto para rádio":
- Graves consistentes e impactantes
- Vocais claros e presentes
- Dinâmica controlada em todas as frequências
- Apresentação geral mais suave e polida
- Presença e clareza realçadas
- Fadiga auditiva reduzida

### Feedback Visual
- Gráficos de função de transferência interativos para cada banda
- Medidores de redução de ganho em tempo real
- Visualização de atividade da banda de frequência
- Indicadores claros de pontos de crossover

### Dicas de Uso
- Comece com as configurações padrão em estilo de rádio FM
- Ajuste as frequências de crossover para combinar com seu material
- Ajuste fino do threshold de cada banda para a quantidade desejada de controle
- Use os controles de ganho para moldar o balanço final de frequência
- Monitore os medidores de redução de ganho para garantir processamento apropriado

## Multiband Expander

Um processador de escuta em cinco bandas que pode restaurar parte do contraste natural de gravações muito achatadas ou fortemente comprimidas. Ele atua separadamente em cada faixa de frequência, normalmente deixando sons abaixo do threshold mais baixos, enquanto valores de ratio abaixo de 1:1 podem levantar sons mais quietos.

### Características Principais
- Processamento de 5 bandas com frequências de crossover ajustáveis
- Controles de expansão independentes para cada banda
- Configurações padrão otimizadas para restauração suave de contraste dinâmico
- Visualização em tempo real da atividade de expansão por banda
- Filtros de crossover Linkwitz-Riley de alta qualidade

### Guia de Aprimoramento da Audição
- **Música Pop/Rock:**
  - Reduzir o efeito de "parede de som" de gravações sobre-comprimidas
  - Restaurar o contraste dinâmico entre versos e refrões
  - Melhorar a impressão plana das fontes de áudio de streaming
- **Música Clássica:**
  - Restaurar o fluxo e refluxo dinâmico natural das gravações
  - Melhorar o contraste entre passagens suaves e crescendos fortes
  - Recuperar a expressão vívida das performances orquestrais
- **Música Jazz:**
  - Melhorar a dinâmica natural entre instrumentos
  - Tornar os solos suaves mais íntimos e as seções fortes mais poderosas
  - Restaurar a respiração natural das performances de jazz

### Bandas de Frequência Padrão
As frequências de crossover são ajustáveis; estas são as faixas padrão.

- Banda 1 (Grave): Abaixo de 100 Hz
  - Controla os graves profundos e sub frequências
  - Expansão suave com attack/release mais longo para dinâmica natural de graves
- Banda 2 (Grave-Médio): 100-500 Hz
  - Lida com os graves superiores e médios inferiores
  - Expansão moderada para restaurar calor e corpo
- Banda 3 (Médio): 500-2000 Hz
  - Faixa crítica de presença vocal e instrumental
  - Expansão equilibrada para preservar a naturalidade
- Banda 4 (Médio-Agudo): 2000-8000 Hz
  - Controla presença e ar
  - Expansão leve com resposta mais rápida
- Banda 5 (Agudo): Acima de 8000 Hz
  - Gerencia brilho e cintilação
  - Tempos de resposta rápidos com expansão mais suave

### Parâmetros

#### Frequências de Crossover
- **Freq 1** (20Hz a 500Hz, padrão 100Hz)
  - Define o ponto de crossover Low/Low-Mid
- **Freq 2** (100Hz a 2000Hz, padrão 500Hz)
  - Define o ponto de crossover Low-Mid/Mid
- **Freq 3** (500Hz a 8000Hz, padrão 2000Hz)
  - Define o ponto de crossover Mid/High-Mid
- **Freq 4** (1000Hz a 20000Hz, padrão 8000Hz)
  - Define o ponto de crossover High-Mid/High
- As frequências são mantidas automaticamente em ordem crescente, então mover um controle pode elevar o próximo crossover se necessário

#### Controles por Banda
- **Threshold** (-60dB a 0dB)
  - Define o nível onde a expansão começa
  - Sinais abaixo deste nível são processados pela configuração Ratio
- **Ratio** (1:0.05 a 1:20)
  - 1:1: Sem mudança
  - Acima de 1:1: Deixa sons abaixo do threshold mais baixos
  - Abaixo de 1:1: Eleva sons mais quietos em vez de reduzi-los
  - Para restauração dinâmica natural, comece por volta de 1.1:1 a 1.2:1
- **Attack** (0.1ms a 100ms)
  - Velocidade de resposta da expansão
  - Tempos mais rápidos para controle preciso de transientes
- **Release** (10ms a 1000ms)
  - Velocidade de retorno do ganho ao normal
  - Tempos mais longos para som mais suave e natural
- **Knee** (0dB a 12dB)
  - Suavidade do início da expansão
  - Valores mais altos para transição mais natural
- **Gain** (-12dB a +12dB)
  - Ajuste de nível de saída por banda
  - Ajuste fino do balanço de frequência

### Restauração de Faixa Dinâmica
O Multiband Expander vem com configurações padrão otimizadas para restaurar suavemente o contraste em material sobre-comprimido:

- Banda Grave (< 100 Hz)
  - Expansão suave (1.2:1) para dinâmica de graves controlada
  - Attack/release mais longo para manter o punch
  - Threshold definido para acomodar a energia típica de graves

- Banda Grave-Médio (100-500 Hz)
  - Expansão moderada (1.2:1)
  - Timing equilibrado para resposta natural
  - Threshold ajustado para energia típica de médios-graves

- Banda Médio (500-2000 Hz)
  - Expansão equilibrada (1.2:1)
  - Tempos de resposta médios
  - Otimizada para dinâmica vocal e instrumental

- Banda Médio-Agudo (2000-8000 Hz)
  - Expansão leve (1.1:1)
  - Attack/release mais rápido
  - Restauração natural de presença

- Banda Agudo (> 8000 Hz)
  - Expansão mais suave (1.1:1)
  - Tempos de resposta muito rápidos
  - Melhoria sutil de ar e brilho

Esta configuração cria restauração dinâmica de som natural:
- Dinâmica natural restaurada em todas as frequências
- Contraste melhorado entre passagens suaves e fortes
- Controle específico por frequência para resultados ótimos
- Expansão natural e musical sem artefatos
- Clareza e separação melhoradas
- Planitude reduzida em gravações sobre-comprimidas

### Feedback Visual
- Gráficos de função de transferência interativos para cada banda
- Medidores de atividade de expansão em tempo real mostrando quanto cada banda está sendo reduzida ou elevada
- Visualização de atividade da banda de frequência
- Indicadores claros de pontos de crossover

### Dicas de Uso
- Comece com as configurações padrão para restauração dinâmica geral
- Ajuste as frequências de crossover para combinar com seu material
- Ajuste fino do threshold de cada banda baseado no conteúdo de frequência
- Use os controles de ganho para compensar mudanças de volume percebidas
- Monitore os medidores de atividade de expansão para garantir processamento apropriado

## Multiband Transient

Um transient shaper de três bandas para música já finalizada. Ele divide o som em faixas Low, Mid e High, e permite ajustar ataque e sustain em cada uma para que a música soe mais impactante, firme, suave ou relaxada sem alterar todas as frequências do mesmo jeito.

### Guia de Aprimoramento da Audição
- **Música Clássica:**
  - Deixar ataques de cordas um pouco mais claros enquanto controla a ressonância de baixa frequência da sala
  - Moldar os transientes do piano de forma diferente através do espectro de frequências para um som mais equilibrado
  - Suavizar ataques agudos fortes mantendo o peso orquestral intacto

- **Música Rock/Pop:**
  - Fazer as batidas em faixas finalizadas parecerem mais imediatas sem aumentar a faixa inteira
  - Enxugar sustain grave embolado mantendo a presença dos médios clara
  - Suavizar ataques agudos quando uma gravação soa áspera

- **Música Eletrônica:**
  - Fazer batidas graves parecerem mais firmes enquanto o restante da faixa fica controlado
  - Reduzir sustain grave longo quando o baixo parece borrado
  - Adicionar ou reduzir mordida nas faixas de synths e percussão brilhantes

### Bandas de Frequência

O processador Multiband Transient divide seu áudio em três bandas de frequência cuidadosamente projetadas. Como ele trabalha por banda de frequência, e não por separação de fontes, cada ajuste afeta todos os sons daquela banda.

- **Low Band** (Abaixo de Freq 1)
  - Controla as frequências graves e sub-graves
  - Útil para moldar impacto de graves, pancadas de baixa frequência e ressonância
  - Frequência de crossover padrão: 200 Hz

- **Mid Band** (Entre Freq 1 e Freq 2)
  - Gerencia as frequências médias críticas
  - Contém a maior parte da presença vocal e instrumental
  - Frequência de crossover padrão: 200 Hz a 4000 Hz

- **High Band** (Acima de Freq 2)
  - Gerencia as frequências agudas e de ar
  - Controla pratos, ataques de guitarra e brilho
  - Frequência de crossover padrão: Acima de 4000 Hz

### Parâmetros

#### Frequências de Crossover
- **Freq 1** (20Hz a 2000Hz)
  - Define o ponto de crossover Grave/Médio
  - Valores mais baixos: Mais conteúdo nas bandas média e aguda
  - Valores mais altos: Mais conteúdo na banda grave
  - Padrão: 200Hz

- **Freq 2** (max(Freq 1, 200Hz) a 20000Hz)
  - Define o ponto de crossover Médio/Agudo
  - Valores mais baixos: Mais conteúdo na banda aguda
  - Valores mais altos: Mais conteúdo na banda média
  - Se ajustado abaixo de Freq 1, ele é automaticamente elevado para Freq 1
  - Padrão: 4000Hz

#### Controles por Banda (Low, Mid, High)
Cada banda de frequência tem controles independentes de moldagem de transientes:

- **Fast Attack** (0.1ms a 10.0ms)
  - Quão rapidamente o envelope rápido responde aos transientes
  - Valores mais baixos: Detecção mais precisa de transientes
  - Valores mais altos: Resposta de transiente mais suave
  - Faixa típica: 0.5ms a 5.0ms

- **Fast Release** (1ms a 200ms)
  - Quão rapidamente o envelope rápido se redefine
  - Valores mais baixos: Controle mais rigoroso de transientes
  - Valores mais altos: Decaimento mais natural de transientes
  - Faixa típica: 20ms a 50ms

- **Slow Attack** (1ms a 100ms)
  - Controla o tempo de resposta do envelope lento
  - Valores mais baixos: O envelope lento acompanha ataques mais cedo, gerando ênfase de transiente mais suave ou curta
  - Valores mais altos: Maior separação entre ataque e sustain, tornando a moldagem de transientes mais forte e longa
  - Faixa típica: 10ms a 50ms

- **Slow Release** (50ms a 1000ms)
  - Duração do rastreamento da porção de sustentação
  - Valores mais baixos: Detecção mais curta de sustentação
  - Valores mais altos: Rastreamento mais longo da cauda de sustentação
  - Faixa típica: 150ms a 500ms

- **Transient Gain** (-24dB a +24dB)
  - Melhora ou reduz a porção de ataque
  - Valores positivos: Mais punch e definição
  - Valores negativos: Ataques mais suaves, menos agressivos
  - Faixa típica: 0dB a +12dB

- **Sustain Gain** (-24dB a +24dB)
  - Melhora ou reduz a porção de sustentação
  - Valores positivos: Mais corpo e ressonância
  - Valores negativos: Som mais apertado, mais controlado
  - Faixa típica: -6dB a +6dB

- **Smoothing** (0.1ms a 20.0ms)
  - Controla quão suavemente as mudanças de ganho são aplicadas
  - Valores mais baixos: Moldagem mais precisa
  - Valores mais altos: Processamento mais natural, transparente
  - Faixa típica: 3ms a 8ms

### Feedback Visual
- Três gráficos independentes de visualização de ganho (um por banda)
- Exibição em tempo real do histórico de ganho para cada banda de frequência
- Marcadores de tempo de referência
- Seleção interativa de bandas
- Feedback visual claro da atividade de moldagem de transientes

### Configurações Recomendadas

#### Escuta Pop/Rock com Mais Punch
- **Low Band (Punch dos Graves):**
  - Fast Attack: 2.0ms, Fast Release: 50ms
  - Slow Attack: 25ms, Slow Release: 250ms
  - Transient Gain: +6dB, Sustain Gain: -3dB
  - Smoothing: 5.0ms

- **Mid Band (Ataque e Presença):**
  - Fast Attack: 1.0ms, Fast Release: 30ms
  - Slow Attack: 15ms, Slow Release: 150ms
  - Transient Gain: +9dB, Sustain Gain: 0dB
  - Smoothing: 3.0ms

- **High Band (Estalo dos Agudos):**
  - Fast Attack: 0.5ms, Fast Release: 20ms
  - Slow Attack: 10ms, Slow Release: 100ms
  - Transient Gain: +3dB, Sustain Gain: -6dB
  - Smoothing: 2.0ms

#### Faixa Completa Equilibrada
- **Todas as Bandas:**
  - Fast Attack: 2.0ms, Fast Release: 30ms
  - Slow Attack: 20ms, Slow Release: 200ms
  - Transient Gain: +3dB, Sustain Gain: 0dB
  - Smoothing: 5.0ms

#### Realce Acústico Natural
- **Low Band:**
  - Fast Attack: 5.0ms, Fast Release: 50ms
  - Slow Attack: 30ms, Slow Release: 400ms
  - Transient Gain: +2dB, Sustain Gain: +1dB
  - Smoothing: 8.0ms

- **Mid Band:**
  - Fast Attack: 3.0ms, Fast Release: 35ms
  - Slow Attack: 25ms, Slow Release: 300ms
  - Transient Gain: +4dB, Sustain Gain: +1dB
  - Smoothing: 6.0ms

- **High Band:**
  - Fast Attack: 1.5ms, Fast Release: 25ms
  - Slow Attack: 15ms, Slow Release: 200ms
  - Transient Gain: +3dB, Sustain Gain: -2dB
  - Smoothing: 4.0ms

### Dicas de Aplicação
- Comece com configurações moderadas e ajuste cada banda independentemente
- Use o feedback visual para monitorar a quantidade de moldagem de transientes aplicada
- Considere o conteúdo musical ao definir as frequências de crossover
- Bandas de alta frequência geralmente se beneficiam de tempos de ataque mais rápidos
- Bandas de baixa frequência frequentemente precisam de tempos de release mais longos para som natural
- Combine com outros processadores de dinâmica para controle abrangente

## Power Amp Sag

Simula o comportamento de queda de tensão de amplificadores de potência sob condições de alta carga. Este efeito cria uma compressão dinâmica semelhante à de amplificador, reduzindo suavemente o nível em passagens musicais exigentes e se recuperando quando a passagem relaxa.

### Guia de Aprimoramento da Audição
- Sistemas de Áudio Vintage:
  - Recria o caráter clássico do amplificador com compressão natural
  - Adiciona compressão suave semelhante à de amplificador em passagens altas
  - Útil quando você quer uma resposta mais macia e menos rígida nos picos
- Música Rock/Pop:
  - Realça punch e presença durante passagens poderosas
  - Adiciona compressão natural sem aspereza
  - Cria uma leve queda de nível e recuperação em seções fortes
- Música Clássica:
  - Suaviza levemente crescendos orquestrais sem limitação dura
  - Suaviza picos fortes de cordas e metais
  - Realça o realismo de performances amplificadas
- Música Jazz:
  - Recria comportamento clássico de compressão do amplificador
  - Adiciona movimento sutil de compressão a gravações focadas em solos
  - Mantém fluxo dinâmico natural

### Parâmetros

- **Sensitivity** (-18.0dB a +18.0dB)
  - Controla quão sensível o efeito de sag é aos níveis de entrada
  - Valores mais altos: Mais sag em volumes baixos
  - Valores mais baixos: Afeta apenas sinais altos
  - Comece com 0dB para resposta natural

- **Stability** (0% a 100%)
  - Simula o tamanho da capacitância da fonte de alimentação
  - Valores mais baixos: Capacitores menores (sag mais dramático)
  - Valores mais altos: Capacitores maiores (tensão mais estável)
  - Representa fisicamente a capacidade de armazenamento de energia da fonte
  - 50% fornece caráter equilibrado

- **Recovery Speed** (0% a 100%)
  - Controla a capacidade de recarga da fonte de alimentação
  - Valores mais baixos: Taxa de recarga mais lenta (compressão sustentada)
  - Valores mais altos: Taxa de recarga mais rápida (recuperação mais rápida)
  - Representa fisicamente a capacidade de entrega de corrente do circuito de carga
  - 40% fornece comportamento natural

- **Monoblock** (Caixa de seleção)
  - Habilita processamento independente por canal
  - Desmarcado: Fonte de alimentação compartilhada (amplificador estéreo)
  - Marcado: Fontes independentes (configuração monoblock)
  - Use para melhor separação de canais e imagem

### Exibição Visual

- Gráficos duplos em tempo real mostrando envelope de entrada e redução de ganho
- Envelope de entrada (verde): Energia do sinal dirigindo o efeito
- Redução de ganho (branco): Quantidade de queda de tensão aplicada
- Exibição baseada em tempo com marcadores de referência de 1 segundo
- Valores atuais exibidos em tempo real

### Configurações Recomendadas

#### Caráter Vintage
- Sensitivity: +3.0dB
- Stability: 30% (capacitores menores)
- Recovery Speed: 25% (recarga mais lenta)
- Monoblock: Desmarcado

#### Aprimoramento Hi-Fi Moderno
- Sensitivity: 0.0dB
- Stability: 70% (capacitores maiores)
- Recovery Speed: 60% (recarga mais rápida)
- Monoblock: Marcado

#### Rock/Pop Dinâmico
- Sensitivity: +6.0dB
- Stability: 40% (capacitores moderados)
- Recovery Speed: 50% (recarga moderada)
- Monoblock: Desmarcado

## Transient Shaper

Um processador de dinâmica especializado que permite realçar ou reduzir independentemente as partes de ataque e sustain do áudio. Use para mudar o punch e o corpo da música, mas lembre que valores positivos de Transient Gain ou Sustain Gain podem elevar picos e a sensação de volume.

### Guia de Aprimoramento da Audição
- Percussão:
  - Adicione punch e definição às baterias ao aprimorar os transientes
  - Reduza a ressonância da sala controlando a porção de sustentação
  - Crie uma sensação de impacto mais forte enfatizando ataques de bateria; use um limitador depois se os picos ficarem altos demais
- Violão/Guitarra Acústica:
  - Realce os ataques de palhetada para maior clareza e presença
  - Controle o sustain para que o instrumento pareça mais firme ou mais cheio
  - Molde padrões de dedilhado para uma sensação de escuta mais clara ou mais relaxada
- Música Eletrônica:
  - Acentue os ataques de sintetizadores para uma sensação mais percussiva
  - Controle o sustain de sons graves para uma impressão mais firme
  - Adicione punch a baterias eletrônicas observando o nível de pico

### Parâmetros

- **Fast Attack** (0.1ms a 10.0ms)
  - Controla quão rapidamente o seguidor de envelope rápido responde
  - Valores mais baixos: Mais responsivo a transientes agudos
  - Valores mais altos: Detecção de transientes mais suave
  - Comece com 1.0ms para a maioria dos materiais

- **Fast Release** (1ms a 200ms)
  - Quão rapidamente o seguidor de envelope rápido é redefinido
  - Valores mais baixos: Rastreamento de transientes mais preciso
  - Valores mais altos: Modelagem de transientes mais natural
  - 20ms funciona bem como ponto de partida

- **Slow Attack** (1ms a 100ms)
  - Controla quão rapidamente o seguidor de envelope lento responde
  - Valores mais baixos: O envelope lento acompanha ataques mais cedo, gerando ênfase de transiente mais suave ou curta
  - Valores mais altos: Maior separação entre ataque e sustain, tornando a moldagem de transientes mais forte e longa
  - 20ms é uma boa configuração padrão

- **Slow Release** (50ms a 1000ms)
  - Quão rapidamente o envelope lento retorna ao estado de repouso
  - Valores mais baixos: Porção de sustentação mais curta
  - Valores mais altos: Detecção de caudas de sustentação mais longas
  - Tente 300ms como ponto de partida

- **Transient Gain** (-24dB a +24dB)
  - Aumenta ou suprime a parte de ataque do som
  - Valores positivos: Enfatiza punch e clareza
  - Valores negativos: Cria som mais suave e menos agressivo
  - Valores positivos podem elevar o nível de pico
  - Comece com +6dB para enfatizar transientes

- **Sustain Gain** (-24dB a +24dB)
  - Aumenta ou suprime a parte de sustentação do som
  - Valores positivos: Adiciona mais riqueza e corpo
  - Valores negativos: Cria som mais firme e controlado
  - Valores positivos podem aumentar a sensação de volume
  - Comece com 0dB e ajuste ao gosto

- **Smoothing** (0.1ms a 20.0ms)
  - Controla a suavidade das mudanças de ganho
  - Valores mais baixos: Modelagem mais precisa, mas potencialmente mais agressiva
  - Valores mais altos: Processamento mais natural e transparente
  - 5.0ms proporciona um bom equilíbrio para a maioria dos materiais

### Feedback Visual
- Visualização de ganho em tempo real
- Exibição clara do histórico de ganho
- Marcadores de tempo para referência
- Interface intuitiva para todos os parâmetros

### Configurações Recomendadas

#### Percussão Realçada
- Fast Attack: 0.5ms
- Fast Release: 10ms
- Slow Attack: 15ms
- Slow Release: 200ms
- Transient Gain: +9dB
- Sustain Gain: -3dB
- Smoothing: 3.0ms

#### Instrumentos Acústicos Naturais
- Fast Attack: 2.0ms
- Fast Release: 30ms
- Slow Attack: 25ms
- Slow Release: 400ms
- Transient Gain: +3dB
- Sustain Gain: 0dB
- Smoothing: 8.0ms

#### Som Eletrônico Firme
- Fast Attack: 1.0ms
- Fast Release: 15ms
- Slow Attack: 10ms
- Slow Release: 250ms
- Transient Gain: +6dB
- Sustain Gain: -6dB
- Smoothing: 4.0ms
