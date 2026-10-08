---
title: "Outros Plugins - EffeTune"
description: "Plugins utilitários adicionais, incluindo Oscillator para gerar tons e ruído de teste."
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

**Retrigger Drop** determina quando uma nota pode tocar novamente enquanto continua sendo detectada. Depois que a detecção e o período de **Note Hold** terminam, a mesma nota será tocada como uma nova nota se voltar a ser detectada.

### Guia de ajuste do som

No Electron, clique em **Select SFZ Folder…** e escolha a pasta do instrumento que contém seus arquivos SFZ, amostras e arquivos incluídos. Se forem encontrados vários arquivos SFZ, escolha um instrumento e clique em **Select**. Os arquivos dessa pasta são lidos diretamente a cada carregamento. **Remove** retira a entrada da lista sem excluir os arquivos originais.

Na versão web, clique em **Import Folder…** e escolha uma pasta com o arquivo SFZ e suas amostras. Se houver vários SFZ, escolha um e clique em **Import**. **SFZ** seleciona um instrumento salvo; **Remove** exclui o banco selecionado do armazenamento local.

Comece com **Dry** em 0% e **Wet** em 100% para ouvir apenas o instrumento; depois aumente **Dry** para adicionar o som original. Ajuste **Octave** para -1 para adicionar uma camada mais grave, ou +1 para uma mais aguda. Aumente **Threshold** para seguir menos notas, com maior confiança. Restrinja a extensão com **Lowest Note** e **Highest Note**. Se o instrumento tocar sempre muito fraco ou forte, ajuste **Velocity 1 Level** e **Velocity 127 Level**, depois equilibre o volume final com **Output Gain**.

Ative apenas **Lowest** para acompanhar uma linha grave, ou apenas **Highest** para acompanhar uma linha aguda.

Se uma nota sustentada se repetir sem intenção, aumente **Retrigger Drop** acima do padrão de 40 dB. Em 96 dB, as repetições causadas por mudanças de nível são bastante reduzidas. Diminua o valor para acompanhar toques repetidos da mesma nota.

Aumente **Note Hold** para prolongar as notas e unir pequenas interrupções na detecção. Em 100 ms, a nota é mantida por mais 100 ms antes de enviar o comando de encerramento.

Uma nota visível no **Note Spectrogram** só será tocada se também cumprir os ajustes de **Threshold** e **Lowest Note / Highest Note**. Se notas muito graves ou muito agudas não soarem, confira a faixa de notas e tente reduzir **Threshold**. Verifique também se o instrumento SFZ inclui a nota resultante da aplicação de **Octave**.

### Parâmetros

- **SFZ**: Escolhe um instrumento pelo nome. Uma caixa de diálogo informa os problemas na primeira tentativa de carregamento após uma seleção ou importação manual; recarregamentos automáticos não exibem a caixa de diálogo.
- **Threshold**: Confiança mínima da detecção (0,01–1, padrão 0,75). Valores maiores reduzem notas indesejadas, mas podem perder sons fracos ou pouco definidos.
- **Retrigger Drop (dB)**: Queda necessária em relação ao nível máximo da nota de entrada para que ela possa tocar novamente (1–96 dB, padrão 40 dB). Depois, o nível precisa subir pelo menos 6 dB. Valores maiores reduzem repetições de notas sustentadas; valores menores facilitam acompanhar toques repetidos da mesma nota.
- **Note Hold (ms)**: Tempo adicional de manutenção da nota após o fim da detecção, antes do comando de encerramento (0–100 ms, padrão 50 ms). Se a mesma nota voltar nesse período, ela continua sem reiniciar. A envoltória do instrumento e a duração da amostra continuam valendo.
- **Velocity 1 Level / Velocity 127 Level (dB)**: Níveis das notas de entrada associados às velocidades de execução mais fraca e mais forte (valores padrão -60 dB / -10 dB). Reduzir os valores produz velocidades maiores para a mesma entrada. A distância entre eles determina a distribuição dos níveis pela faixa de velocidades.
- **Lowest Note / Highest Note**: Notas mínima e máxima da entrada a detectar (A0–C8, MIDI 21–108; padrões E1 e G6), exibidas pelo nome. Notas fora da faixa são ignoradas.
- **Highest / Middle / Lowest**: Seleciona a linha grave, as notas internas e a linha aguda antes de aplicar Octave (todas ativadas por padrão). Middle seleciona as notas estritamente entre a mais grave e a mais aguda detectadas no momento. As linhas externas acompanham a evolução das alturas para reduzir mudanças bruscas; uma única nota detectada pertence às duas. As notas que deixam de estar selecionadas diminuem naturalmente. Desative as três opções para interromper novas notas.
- **Octave**: Desloca as novas notas do SFZ de -2 a +2 oitavas, em passos de uma oitava (padrão 0). Valores negativos produzem notas mais graves; positivos, mais agudas. A faixa de detecção da entrada e as notas que já estão tocando permanecem iguais.
- **Max Voices**: Limita as vozes de amostras simultâneas. Valores maiores preservam mais notas sobrepostas e caudas, mas exigem mais processamento. Valores menores substituem as vozes antigas mais cedo.
- **Dry (%)**: Nível do áudio original (0–100%, padrão 20%). 0% o silencia e 100% mantém seu nível original.
- **Wet (%)**: Nível do instrumento SFZ (0–100%, padrão 100%). 0% o silencia e 100% mantém seu nível integral. Dry e Wet são ajustados de forma independente.
- **Timing (ms)**: Ajusta o tempo entre o áudio original e o instrumento SFZ (de -100 a +100 ms, padrão 0). Valores negativos atrasam mais o áudio original; valores positivos atrasam o instrumento. Ajuste enquanto escuta para aproximar o início das notas.
- **Output Gain (dB)**: Nível final da mistura.

Com **Timing** em 0 ms, o áudio original recebe um atraso de cerca de **80 ms** para acompanhar o processamento e a correção da detecção de notas. O ciclo de análise e o ataque do instrumento ainda podem causar pequenas diferenças de tempo. Um **Note Spectrogram** ativo antes do efeito pode compartilhar a análise e reduzir a carga quando a faixa de notas, o barramento de entrada e os canais coincidem e o áudio não é alterado entre eles.

O carregamento aceita ajustes comuns de seleção, afinação, volume, panorama, loops e envelope de amplitude do SFZ. O som diminui gradualmente na fase de liberação por pelo menos **0,2 segundo**, preservando durações maiores definidas no SFZ; ele pode parar antes se a amostra chegar ao fim. As condições de faixa dos controladores usam os valores iniciais, com prioridade para os ajustes `set_ccN` do SFZ. Por exemplo, um piano cujo pedal está solto no estado inicial usa as amostras dessa posição sem adicionar a camada com o pedal pressionado. A articulação padrão acionada por uma tecla é usada quando o instrumento a especifica. Camadas que exigem soltar a nota, eventos de controlador, mudanças de articulação durante a execução ou outras condições não aceitas são omitidas. Regiões inválidas são ignoradas e o carregamento das válidas continua. Outros ajustes de som não aceitos são ignorados.

O limite padrão é **256 MiB**. Você pode aumentá-lo até **1024 MiB (1 GiB)** com **Limite de tamanho de SFZ** em **Configuração → Geral**. O limite vale para os arquivos do instrumento e para as amostras descomprimidas para reprodução, a partir da próxima seleção, importação ou carregamento. Limites maiores usam mais memória. Se o instrumento completo ultrapassar o limite, o carregamento tenta amostras representativas que cubram sua faixa de notas tocáveis. A velocidade continua alterando o volume, mas as variações entre camadas de velocidade e amostras alternadas são simplificadas. Se essas amostras também não couberem, escolha um instrumento menor ou aumente o limite. Na versão web, importe novamente a pasta original após aumentar o limite para recuperar as amostras omitidas. Outros efeitos baseados em amostras também compartilham a memória de processamento.

Os presets e as cadeias compartilhadas contêm apenas uma referência ao instrumento, sem seus arquivos de áudio. Em outro dispositivo, selecione a pasta local do instrumento no Electron ou importe sua pasta na versão web. Os arquivos de áudio SFZ não são incluídos no backup dos dados do usuário; guarde suas pastas SFZ originais.
