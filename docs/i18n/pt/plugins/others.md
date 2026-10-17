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

O SFZ Note Player detecta notas no áudio de entrada e as toca com um instrumento SFZ importado. Use um piano SFZ para acompanhar as notas de uma música ou sobreponha outro instrumento à gravação original. A estimativa polifônica de notas é uma ferramenta para ouvir e sobrepor camadas, não uma transcrição exata; em mixagens densas, notas podem ser perdidas ou disparadas a mais.

### Guia de ajuste do som

- **Importar e carregar um instrumento**: Clique em **SFZ Library…**, use **Importar pasta…** para adicionar uma pasta com definições `.sfz` e arquivos de amostras (ou a pasta completa de um banco ARIA com `.bank.xml`, `Programs` e `Samples`) e clique em **Carregar** ao lado do instrumento. No app desktop, o EffeTune lê os arquivos originais no próprio local; no app web, os instrumentos ficam armazenados no seu dispositivo, e **Importar arquivos…** precisa incluir as amostras e os outros arquivos de que o instrumento necessita. Instrumentos em uso não podem ser excluídos.
- **Ouvir e misturar**: Comece com **Dry: 0%** e **Wet: 100%** para ouvir o instrumento SFZ sozinho e depois aumente **Dry** para trazer de volta a faixa original. Ajuste **Timing** (−100 a +100 ms) para alinhar os ataques das notas do SFZ com a gravação original (em 0 ms, o sinal seco é atrasado para acompanhar a detecção de notas: ~90 ms em Classic, ~230 ms em Event).
- **Delimitar a faixa de notas e as vozes**: Aumente **Threshold** para disparar apenas notas de alta confiança, estreite **Lowest Note** e **Highest Note**, ou ative apenas **Lowest** (linha de baixo) ou **Highest** (melodia superior) para acompanhar uma única linha musical. Uma linha colorida no Note Spectrogram não garante a reprodução, porque **Threshold** e a faixa de notas continuam valendo.
- **Moldar o timbre e a oitava**: Use **Octave** (−2 a +2) para dobrar uma linha uma oitava abaixo ou acima e use **Sample Shift** (−6 a +6 semitons) para tocar os mapeamentos de amostras vizinhos, reafinados para a nota detectada, obtendo um timbre mais escuro ou mais brilhante.

### Parâmetros

- **SFZ** - Abre **SFZ Library…** para importar, pesquisar, ordenar, carregar ou excluir instrumentos (**Clear** descarrega o instrumento atual sem excluí-lo da biblioteca).
- **Detection**:
  - **Classic (Low Latency)** (padrão): Detector de menor latência (~90 ms de atraso de alinhamento) que usa **Threshold** e **Retrigger Drop**.
  - **Event (+140 ms)**: Usa o mesmo detector de inícios/eventos do Note Spectrogram (~230 ms de atraso de alinhamento e maior uso de CPU; **Threshold** e **Retrigger Drop** ficam desativados). Quando um Note Spectrogram ativado mais cedo na cadeia analisa a mesma entrada com a mesma faixa de notas e o áudio entre eles não é alterado, sua análise é compartilhada para reduzir a carga se **Onsets**, a cor **Instrument** ou **Highlight** estiver ativado no Note Spectrogram. Caso contrário, o SFZ Note Player faz sua própria análise.
- **Color** - **Normal** (cor do gráfico definida pelo tema) ou **Note Colors** (cores por classe de altura, iguais às do Note Spectrogram).
- **Threshold** (0.01 a 1; padrão 0.75) - Limiar de confiança da detecção no modo Classic.
- **Retrigger Drop (dB)** (1 a 96 dB; padrão 40 dB) - Queda de nível necessária antes de redisparar notas sustentadas acima de B5 no modo Classic; depois, o nível precisa subir de novo pelo menos 6 dB. Valores maiores reduzem repetições indesejadas durante notas sustentadas; valores menores acompanham com mais facilidade toques repetidos da mesma nota. Em B5 e abaixo, os ataques detectados disparam novas notas diretamente.
- **Note Hold (ms)** (0 a 100 ms; padrão 50 ms) - Une breves interrupções na detecção antes de liberar uma nota.
- **Velocity 1 Level / Velocity 127 Level (dB)** (-96 a 0 dB / -60 a +24 dB; padrões -60 dB / -10 dB) - Faixa de níveis de entrada associada às velocidades MIDI 1–127. Reduzi-los produz velocidades maiores a partir da mesma entrada.
- **Lowest Note / Highest Note** (A0 a C8; padrões E1 a G6) - Faixa de detecção de alturas.
- **Highest / Middle / Lowest** - Filtra quais notas detectadas simultaneamente são tocadas (linha superior, vozes internas ou linha de baixo; todas ativadas por padrão).
- **Octave** (-2 a +2; padrão 0) - Transpõe em oitavas inteiras as notas SFZ disparadas a partir de então.
- **Sample Shift** (-6 a +6 semitons; padrão 0) - Desloca a região de amostra selecionada e compensa sua afinação para preservar a altura da nota alvo. Valores positivos tocam amostras de notas mais agudas mais devagar (em +1, um C4 detectado usa a amostra de C#4 na altura de C4); valores negativos tocam amostras de notas mais graves mais rápido.
- **Max Voices** (1 a 128; padrão 32) - Número máximo de vozes de amostras simultâneas (incluindo as caudas de liberação). Valores maiores mantêm mais notas sobrepostas, mas exigem mais processamento.
- **Dry (%)** / **Wet (%)** (0 a 100%; padrões 20% / 100%) - Níveis independentes do áudio original alinhado em latência e do instrumento SFZ.
- **Timing (ms)** (-100 a +100 ms; padrão 0 ms) - Ajuste fino do alinhamento temporal entre o áudio original e o instrumento SFZ. Valores negativos atrasam ainda mais o áudio original; valores positivos atrasam o instrumento.
- **Output Gain (dB)** (-60 a +12 dB; padrão 0 dB) - Ajuste do nível final de saída.

### Visualização da reprodução e observações

- **Teclado interativo e barras de velocidade**: O teclado vai de **Lowest Note** a **Highest Note** e ilumina as notas que estão soando, incluindo as caudas de liberação. As teclas iluminadas acompanham **Octave**; **Sample Shift** muda o timbre sem movê-las. Cada barra começa na velocidade com que a nota soa (1–127) e desce com o tempo, mesmo depois que a nota termina; **Color** muda as cores sem reiniciar a queda. **Voices / Max Voices** conta as vozes de amostras, incluindo as liberações.
- **Audição**: Clique ou arraste sobre o teclado ou a área de velocidade para tocar diretamente o instrumento SFZ carregado. O teclado toca com velocidade 100; na área de velocidade, a velocidade depende da altura em que você insere a nota. A audição toca a altura exibida, ignorando **Octave**, mas **Sample Shift** continua sendo aplicado.
- **Limite de memória**: Por padrão, os instrumentos têm um limite de **256 MiB** (configurável até **1024 MiB** em **Limite de tamanho de SFZ**, em **Configurações > Configuração... > Geral**). Se um instrumento ultrapassar o limite, amostras representativas de todo o teclado são carregadas automaticamente. No app web, importe a pasta novamente depois de aumentar o limite.
- **Recursos de SFZ compatíveis**: Camadas que exigem a liberação da nota, eventos de controlador ou troca dinâmica de articulação por tecla são omitidas, e outros ajustes não compatíveis são ignorados.
- **Compartilhamento e backups**: Predefinições, links compartilhados e backups dos dados do usuário armazenam a referência ao instrumento, e não suas amostras de áudio; guarde suas pastas SFZ originais para usá-las em outros dispositivos.
