---
title: "Outros Plugins - Gerador de tons de teste e ruído, SFZ Note Player - EffeTune"
description: "Oscillator gera tons e ruído branco ou rosa para testar alto-falantes e fones. SFZ Note Player toca notas detectadas no áudio de entrada com um instrumento SFZ."
lang: pt
---

# Outras Ferramentas de Áudio

Uma coleção de ferramentas de áudio especializadas e geradores que complementam as principais categorias de efeitos. Esses plugins são úteis para verificar alto-falantes, fones, equilíbrio entre canais e o comportamento da reprodução antes ou durante a escuta.

## Lista de Plugins

- [Oscillator](#oscillator) - Gerador de tons de teste e ruído para verificar alto-falantes/fones
- [SFZ Note Player](#sfz-note-player) - Toca um instrumento SFZ importado a partir das notas detectadas

## Oscillator

Um gerador de tons de teste e ruído para verificar seu sistema de escuta. Use em níveis baixos para confirmar a saída de alto-falantes/fones, posicionamento esquerdo/direito, equilíbrio de nível, vibrações, zumbidos ou problemas simples de resposta em frequência.

O tom ou ruído gerado é misturado ao caminho de áudio atual em vez de substituir a entrada. Abaixe Volume antes de ativá-lo, especialmente enquanto música já estiver tocando.

### Características
- Múltiplos tipos de forma de onda:
  - Onda senoidal pura para verificações simples de tom
  - Onda quadrada para conteúdo harmônico rico
  - Onda triangular para harmônicos mais suaves
  - Onda dente de serra para timbres brilhantes
  - Impulsos periódicos de uma amostra para verificar resposta ao impulso e temporização
  - Ruído branco para verificações de banda larga em alto-falantes/fones
  - Ruído rosa para um equilíbrio de ruído mais suave e natural
- Modo de operação pulsado para tons ou rajadas de ruído intermitentes

### Parâmetros
- **Frequency (Hz)** - Controla a altura do tom gerado (20 Hz a 96 kHz)
  - Frequências baixas: Tons graves profundos
  - Frequências médias: Faixa musical
  - Frequências altas: Use com cuidado e apenas em níveis de escuta seguros
  - Aplica-se apenas a Sine, Square, Triangle e Sawtooth; fica desativado para Impulse, White Noise e Pink Noise
  - A saída em frequências altas depende da taxa de amostragem atual; tons acima da frequência de Nyquist utilizável são silenciados
- **Volume (dB)** - Ajusta o nível de saída (-96 dB a 0 dB)
  - Comece baixo e aumente devagar
  - Valores mais altos podem soar altos ou cansativos
- **Panning (L/R)** - Controla o posicionamento estéreo
  - Centro: Igual em ambos os canais
  - Esquerda/Direita: Verifique o roteamento e o balanço dos canais
- **Waveform Type** - Seleciona o tipo de sinal
  - Sine: Tom de referência limpo
  - Square: Rico em harmônicos ímpares
  - Triangle: Conteúdo harmônico mais suave
  - Sawtooth: Série harmônica completa
  - Impulse: Uma amostra em amplitude máxima a cada Interval, conforme a taxa de amostragem atual; Frequency não o afeta
  - White Noise: Energia igual por Hz; Frequency não o afeta
  - Pink Noise: Energia igual por oitava; Frequency não o afeta
- **Mode** - Controla o padrão de geração de sinal
  - Continuous: Geração de sinal contínuo padrão
  - Pulsed: Sinal intermitente com temporização controlável
  - Impulse sempre usa Pulsed; Continuous fica desativado
- **Interval (ms)** - Tempo entre rajadas de pulsos no modo pulsado (100-2000 ms, passo 10 ms)
  - Intervalos curtos: Sequências de pulsos rápidas
  - Intervalos longos: Pulsos amplamente espaçados
  - Ativo quando Mode está definido como Pulsed, incluindo Impulse
- **Width (ms)** - Tempo de rampa do pulso no modo pulsado (2-100 ms, limitado à metade de Interval, passo 1 ms)
  - Controla o tempo de entrada/saída gradual de cada pulso
  - O pulso gerado dura cerca de duas vezes Width, sem trecho estável no meio
  - Larguras curtas: Bordas de pulso nítidas
  - Larguras longas: Transições de pulso mais suaves
  - Ativo apenas quando Mode está definido como Pulsed; fica desativado para Impulse porque cada impulso tem exatamente uma amostra

### Exemplos de Uso

1. Verificação de Alto-falantes ou Fones
   - Verificar a reprodução básica de frequência
     * Use varredura de onda senoidal de baixa a alta frequência
     * Note onde o som se torna inaudível ou distorcido
   - Ouvir vibrações, zumbidos ou ressonâncias ásperas
     * Use Volume baixo primeiro
     * Teste uma faixa de frequência por vez
   - Comparar a saída esquerda e direita
     * Faça pan totalmente para a esquerda e para a direita
     * Confirme se cada lado toca no alto-falante ou driver esperado

2. Equilíbrio de Canais e Nível
   - Verificar posicionamento estéreo
     * Use uma onda senoidal centralizada ou pink noise
     * Confirme se o som parece centralizado
   - Comparar volume esquerdo e direito
     * Faça pan para cada lado usando o mesmo Volume
     * Ajuste seu sistema de reprodução se um lado parecer mais alto
   - Verificar cadeias de plugins
     * Coloque o Oscillator antes ou depois de outros efeitos para ouvir como a cadeia trata um sinal simples

3. Checagens de Ressonância da Sala ou Mesa
   - Encontrar acúmulos de grave ou vibrações óbvias
     * Use tons senoidais graves em níveis seguros
     * Mova-se pela posição de escuta e observe picos ou quedas fortes
   - Checar objetos que vibram facilmente
     * Varra lentamente graves e médios-graves
     * Reduza Volume imediatamente se algo vibrar forte

4. Verificações com Ruído
   - Use pink noise como referência ampla e estável
     * Ouça desequilíbrios óbvios entre esquerda/direita ou no tom
     * Mantenha o nível confortável e evite ruído alto por muito tempo
   - Use white noise apenas quando precisar de um sinal de banda larga mais brilhante

5. Verificações com Sinal Pulsado
   - Use o modo pulsado para identificar rajadas curtas com mais facilidade
     * Intervalos mais longos deixam cada rajada mais fácil de ouvir separadamente
     * Valores menores de Width criam inícios e paradas mais bruscos
     * Compare o comportamento em diferentes níveis de volume

6. Verificações de Resposta ao Impulso e Temporização
   - Selecione Impulse para gerar transientes de uma amostra no Interval configurado
     * Use um Interval maior para separar reflexões ou caudas de efeitos
     * Grave a saída para analisar a resposta ao impulso de um sistema ou cadeia de plugins
     * Comece com Volume baixo, pois o impulso tem um pico abrupto e conteúdo de banda larga

Lembre-se: o Oscillator é um gerador de sinal de teste. Comece com Volume baixo, aumente gradualmente e evite tons altos ou de alta frequência que possam causar danos ao equipamento ou fadiga auditiva.

## SFZ Note Player

SFZ Note Player detecta notas no áudio de entrada e as toca com um instrumento SFZ escolhido. Use um piano SFZ para acompanhar as notas de uma música ou sobreponha outro timbre à gravação. A estimativa polifônica pode perder notas ou detectar outras por engano, principalmente em músicas densas.

A reprodução reduz automaticamente o ruído de aliasing ao alterar a altura das notas ou converter a taxa de amostragem.

Em B5 e notas mais baixas, um novo ataque claro inicia uma nova nota, inclusive ao tocar repetidamente a mesma altura. Acima de B5, **Retrigger Drop** determina quando uma nota pode tocar novamente enquanto continua sendo detectada. **Note Hold** une pequenas interrupções na detecção, mas um novo ataque claro em B5 ou abaixo inicia uma nova nota mesmo durante a sustentação.

### Guia de ajuste do som

Clique em **SFZ Library…** para abrir a lista de instrumentos. Use **Importar pasta…** para adicionar uma pasta com os arquivos SFZ, as amostras e os arquivos incluídos; depois clique em **Carregar** ao lado do instrumento desejado. **Importar arquivos…** adiciona os arquivos selecionados; na versão web, selecione também as amostras e os outros arquivos necessários. O Electron mantém referências aos arquivos originais e os lê sempre que o instrumento é carregado. A versão web salva os instrumentos neste dispositivo.

Cada entrada mostra o tamanho, a quantidade de arquivos e a quantidade de regiões. O tamanho inclui as amostras: o Electron soma os arquivos referenciados, enquanto a versão web mostra o tamanho do instrumento salvo. As regiões associam sons a faixas de notas e intensidades. Pesquise pelo nome do arquivo e ordene por **Nome do arquivo** ou **Importadas recentemente**. **Selecionar tudo** seleciona todas as entradas exibidas no momento; **Desmarcar tudo** limpa a seleção. Marque várias entradas e use **Excluir selecionadas** para excluí-las juntas, ou **Excluir** para excluir uma só. Instrumentos em uso em uma cadeia de efeitos não podem ser excluídos. O Electron mantém os arquivos originais; a versão web remove o instrumento salvo. **Clear**, nos controles do efeito, desmarca o instrumento sem removê-lo da biblioteca.

O progresso aparece na biblioteca enquanto os arquivos são adicionados. Para bancos ARIA como Plogue Free Sounds, escolha a pasta completa que contém `.bank.xml`, `Programs` e `Samples`.

As formas de onda básicas, como as usadas nos programas Virtual Analog deste banco, são reproduzidas por amostras geradas em loop. Configurações de som não compatíveis são ignoradas. Tempos inválidos de aumento ou redução do som são ajustados para valores reproduzíveis; os problemas só são informados quando você seleciona ou importa um instrumento explicitamente.

Comece com **Dry** em 0% e **Wet** em 100% para ouvir apenas o instrumento; depois aumente **Dry** para adicionar o som original. Ajuste **Octave** para -1 para adicionar uma camada mais grave, ou +1 para uma mais aguda. Aumente **Threshold** para seguir menos notas, com maior confiança. Restrinja a extensão com **Lowest Note** e **Highest Note**. Se o instrumento tocar sempre muito fraco ou forte, ajuste **Velocity 1 Level** e **Velocity 127 Level**, depois equilibre o volume final com **Output Gain**.

Use **Sample Shift** para mudar o timbre mantendo a mesma altura. Experimente +1: ao detectar C4, o efeito escolhe a amostra atribuída a C#4 e a reproduz mais devagar para soar na altura de C4.

Ative apenas **Lowest** para acompanhar uma linha grave, ou apenas **Highest** para acompanhar uma linha aguda.

Para notas acima de B5, se uma nota sustentada se repetir sem intenção, aumente **Retrigger Drop** acima do padrão de 40 dB. Em 96 dB, as repetições causadas por mudanças de nível são bastante reduzidas. Diminua o valor para acompanhar toques repetidos da mesma nota. Em B5 e notas mais baixas, as repetições seguem os ataques detectados.

Aumente **Note Hold** para prolongar as notas e unir pequenas interrupções na detecção. Em 100 ms, a nota é mantida por mais 100 ms antes de enviar o comando de encerramento. Em B5 e notas mais baixas, um novo ataque claro inicia uma nova nota mesmo durante essa sustentação.

Uma nota visível no **Note Spectrogram** não necessariamente será tocada: os ajustes de **Threshold** e **Lowest Note / Highest Note** também influenciam a reprodução. Se notas muito graves ou muito agudas não soarem, confira a faixa de notas e tente reduzir **Threshold**. Verifique também se o instrumento SFZ inclui a nota resultante da aplicação de **Octave** e **Sample Shift**.

### Visualização das notas

O teclado mostra o intervalo de **Lowest Note** até **Highest Note**. O teclado destaca as notas que o instrumento SFZ está a tocar, incluindo as que ainda se desvanecem após serem soltas. O destaque acompanha o desvio de **Octave**; **Sample Shift** muda o timbre sem deslocar a tecla apresentada. A barra acima de cada tecla começa com uma altura proporcional à velocidade de execução da nota (1–127) e diminui gradualmente com o tempo até desaparecer, mesmo depois de a nota terminar. **Voices** apresenta o número atual de vozes de amostras / **Max Voices**, incluindo as que se desvanecem. Um instrumento com várias camadas pode usar várias vozes para uma única nota. **Color** muda as cores das teclas que estão a tocar e das barras de velocidade sem reiniciar a sua descida.

Toque ou arraste no teclado ou no gráfico de velocidade para ouvir o instrumento SFZ selecionado. O teclado toca com velocidade 100; o gráfico usa a altura a que entra na área de cada nota (1–127). Ao mover-se dentro da mesma nota, ela continua a tocar com a velocidade inicial. Ao passar para outra nota, a anterior para e a nova começa; levantar o dedo ou soltar o botão do rato termina a pré-escuta. A altura apresentada é tocada diretamente, independentemente de **Octave** ou das definições de deteção, enquanto **Sample Shift** continua a alterar o timbre.

### Parâmetros

- **SFZ**: Abra **SFZ Library…** para escolher e gerenciar instrumentos. **Clear** desmarca o instrumento sem excluí-lo. Os problemas são explicados em uma caixa de diálogo apenas no primeiro carregamento explícito; recarregamentos automáticos não mostram avisos.
- **Color**: **Normal** (padrão) usa a cor do gráfico definida pelo tema. **Note Colors** usa as mesmas cores do Note Spectrogram: cada nome de nota tem uma cor própria, que se repete em todas as oitavas.
- **Threshold**: Limiar de confiança da detecção (0,01–1, padrão 0,75). Valores maiores reduzem notas indesejadas, mas podem perder sons fracos ou pouco definidos. Em B5 e notas mais baixas, um ataque claro também pode iniciar uma nota com confiança um pouco abaixo desse valor.
- **Retrigger Drop (dB)**: Para notas acima de B5, queda necessária em relação ao nível máximo da nota de entrada para que ela possa tocar novamente (1–96 dB, padrão 40 dB). Depois, o nível precisa subir pelo menos 6 dB. Valores maiores reduzem repetições de notas sustentadas; valores menores facilitam acompanhar toques repetidos da mesma nota. Em B5 e notas mais baixas, esse ajuste não afeta a detecção de notas repetidas: as novas notas seguem os ataques detectados.
- **Note Hold (ms)**: Tempo adicional de manutenção da nota após o fim da detecção, antes do comando de encerramento (0–100 ms, padrão 50 ms). Se a mesma nota voltar nesse período, ela continua sem reiniciar, a menos que seja detectado um novo ataque claro em B5 ou abaixo. A envoltória do instrumento e a duração da amostra continuam valendo.
- **Velocity 1 Level / Velocity 127 Level (dB)**: Níveis das notas de entrada associados às velocidades de execução mais fraca e mais forte (valores padrão -60 dB / -10 dB). Reduzir os valores produz velocidades maiores para a mesma entrada. A distância entre eles determina a distribuição dos níveis pela faixa de velocidades.
- **Lowest Note / Highest Note**: Notas mínima e máxima da entrada a detectar (A0–C8, MIDI 21–108; padrões E1 e G6), exibidas pelo nome. Notas fora da faixa são ignoradas.
- **Highest / Middle / Lowest**: Seleciona a linha grave, as notas internas e a linha aguda antes de aplicar Octave (todas ativadas por padrão). Middle seleciona as notas estritamente entre a mais grave e a mais aguda detectadas no momento. As linhas externas acompanham a evolução das alturas para reduzir mudanças bruscas; uma única nota detectada pertence às duas. As notas que deixam de estar selecionadas diminuem naturalmente. Desative as três opções para interromper novas notas.
- **Octave**: Desloca as novas notas do SFZ de -2 a +2 oitavas, em passos de uma oitava (padrão 0). Valores negativos produzem notas mais graves; positivos, mais agudas. A faixa de detecção da entrada e as notas que já estão tocando permanecem iguais.
- **Sample Shift**: Seleciona amostras atribuídas a notas de -6 a +6 semitons de distância, em passos de um semitom (padrão 0), mantendo a altura definida por Octave. Valores positivos escolhem amostras de notas mais agudas e as reproduzem mais devagar; valores negativos escolhem amostras de notas mais graves e as reproduzem mais rápido. As mudanças se aplicam às novas notas; as que já estão soando mantêm sua amostra e sua velocidade de reprodução.
- **Max Voices**: Limita as vozes de amostras simultâneas. Valores maiores preservam mais notas sobrepostas e caudas, mas exigem mais processamento. Valores menores substituem as vozes antigas mais cedo.
- **Dry (%)**: Nível do áudio original (0–100%, padrão 20%). 0% o silencia e 100% mantém seu nível original.
- **Wet (%)**: Nível do instrumento SFZ (0–100%, padrão 100%). 0% o silencia e 100% mantém seu nível integral. Dry e Wet são ajustados de forma independente.
- **Timing (ms)**: Ajusta o tempo entre o áudio original e o instrumento SFZ (de -100 a +100 ms, padrão 0). Valores negativos atrasam mais o áudio original; valores positivos atrasam o instrumento. Ajuste enquanto escuta para aproximar o início das notas.
- **Output Gain (dB)**: Nível final da mistura.

Com **Timing** em 0 ms, o áudio original recebe um atraso de cerca de **90 ms** para acompanhar o processamento e a correção da detecção de notas. O ciclo de análise e o ataque do instrumento ainda podem causar pequenas diferenças de tempo. Um **Note Spectrogram** ativo antes do efeito pode compartilhar a análise e reduzir a carga quando a faixa de notas, o barramento de entrada e os canais coincidem e o áudio não é alterado entre eles.

O carregamento aceita ajustes comuns de seleção, afinação, volume, panorama, loops e envelope de amplitude do SFZ. O som diminui gradualmente na fase de liberação por pelo menos **0,2 segundo**, preservando durações maiores definidas no SFZ; ele pode parar antes se a amostra chegar ao fim. As condições de faixa dos controladores usam os valores iniciais, com prioridade para os ajustes `set_ccN` do SFZ. Por exemplo, um piano cujo pedal está solto no estado inicial usa as amostras dessa posição sem adicionar a camada com o pedal pressionado. A articulação padrão acionada por uma tecla é usada quando o instrumento a especifica. Camadas que exigem soltar a nota, eventos de controlador, mudanças de articulação durante a execução ou outras condições não aceitas são omitidas. Regiões inválidas são ignoradas e o carregamento das válidas continua. Outros ajustes de som não aceitos são ignorados.

O limite padrão é **256 MiB**. Você pode aumentá-lo até **1024 MiB (1 GiB)** com **Limite de tamanho de SFZ** em **Configuração → Geral**. O limite vale para os arquivos do instrumento e para as amostras descomprimidas para reprodução, a partir da próxima seleção, importação ou carregamento. Limites maiores usam mais memória. Se o instrumento completo ultrapassar o limite, o carregamento tenta amostras representativas que cubram sua faixa de notas tocáveis. A velocidade continua alterando o volume, mas as variações entre camadas de velocidade e amostras alternadas são simplificadas. Se essas amostras também não couberem, escolha um instrumento menor ou aumente o limite. Na versão web, importe novamente a pasta original após aumentar o limite para recuperar as amostras omitidas. Outros efeitos baseados em amostras também compartilham a memória de processamento.

Os presets e as cadeias compartilhadas contêm apenas uma referência ao instrumento, sem seus arquivos de áudio. Em outro dispositivo, selecione a pasta local do instrumento no Electron ou importe sua pasta na versão web. Os arquivos de áudio SFZ não são incluídos no backup dos dados do usuário; guarde suas pastas SFZ originais.
