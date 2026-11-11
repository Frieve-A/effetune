---
title: "Outros Plugins - Gerador de tons de teste e ruído, SoundFont Note Player, SoundFont Player - EffeTune"
description: "Oscillator gera tons e ruído branco ou rosa para testar alto-falantes e fones. SoundFont Note Player toca notas detectadas no áudio de entrada com um instrumento SF2/SF3/SFZ. SoundFont Player toca músicas MIDI com SoundFonts SF2/SF3 ou instrumentos SFZ."
lang: pt
---

# Outras Ferramentas de Áudio

Uma coleção de ferramentas de áudio especializadas e geradores que complementam as principais categorias de efeitos. Esses plugins são úteis para verificar alto-falantes, fones, equilíbrio entre canais e o comportamento da reprodução antes ou durante a escuta.

## Lista de Plugins

- [Oscillator](#oscillator) - Gerador de tons de teste e ruído para verificar alto-falantes/fones
- [SoundFont Note Player](#sfz-note-player) - Toca as notas detectadas com SoundFonts SF2/SF3 e instrumentos SFZ
- [SoundFont Player](#soundfont-player) - Reproduz MIDI com SoundFonts SF2/SF3 e instrumentos SFZ

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

## SoundFont Note Player

<a id="sfz-note-player"></a>

O SoundFont Note Player detecta notas no áudio de entrada e as toca com um instrumento SF2/SF3/SFZ importado. Use um piano SFZ para acompanhar as notas de uma música ou sobreponha outro instrumento à gravação original. A estimativa polifônica de notas é uma ferramenta para ouvir e sobrepor camadas, não uma transcrição exata; em mixagens densas, notas podem ser perdidas ou disparadas a mais.

### Guia de ajuste do som

- **Importar e carregar um instrumento**: Abra **SoundFont Library…**, use **Importar arquivos…** para importar um arquivo `.sf2` / `.sf3`, clique em **Carregar** e escolha um som em **Preset**. Para SFZ, use **Importar pasta…** para adicionar a definição junto com suas amostras (ou a pasta completa de um banco ARIA com `.bank.xml`, `Programs` e `Samples`). O app desktop lê os arquivos originais no próprio local; o app web salva os instrumentos importados no seu dispositivo. Ao usar **Importar arquivos…** para SFZ, inclua todas as amostras e os outros arquivos necessários. Instrumentos em uso não podem ser excluídos.
- **Ouvir e misturar**: Comece com **Dry: 0%** e **Wet: 100%** para ouvir o instrumento SFZ sozinho e depois aumente **Dry** para trazer de volta a faixa original. Ajuste **Timing** (−100 a +100 ms) para alinhar os ataques das notas do SFZ com a gravação original (em 0 ms, o sinal seco é atrasado para acompanhar a detecção de notas: ~90 ms em Classic, ~230 ms em Event).
- **Delimitar a faixa de notas e as vozes**: Aumente **Threshold** para disparar apenas notas de alta confiança, estreite **Lowest Note** e **Highest Note**, ou ative apenas **Lowest** (linha de baixo) ou **Highest** (melodia superior) para acompanhar uma única linha musical. Uma linha colorida no Note Spectrogram não garante a reprodução, porque **Threshold** e a faixa de notas continuam valendo.
- **Moldar o timbre e a oitava**: Use **Octave** (−2 a +2) para dobrar uma linha uma oitava abaixo ou acima e use **Sample Shift** (−6 a +6 semitons) para tocar os mapeamentos de amostras vizinhos, reafinados para a nota detectada, obtendo um timbre mais escuro ou mais brilhante.

### Parâmetros

- **SoundFont** - Abre **SoundFont Library…** para importar, pesquisar, ordenar, carregar ou excluir instrumentos (**Clear** descarrega o instrumento atual sem excluí-lo da biblioteca).
- **Preset** - Em uma coleção SF2/SF3, escolhe o som das notas detectadas. **Default** usa o primeiro preset que pode ser reproduzido. O controle fica oculto para instrumentos SFZ.
- **Detection**:
  - **Classic (Low Latency)** (padrão): Detector de menor latência (~90 ms de atraso de alinhamento) que usa **Threshold** e **Retrigger Drop**.
  - **Event (+140 ms)**: Usa o mesmo detector de inícios/eventos do Note Spectrogram (~230 ms de atraso de alinhamento e maior uso de CPU; **Threshold** e **Retrigger Drop** ficam desativados). Quando um Note Spectrogram ativado mais cedo na cadeia analisa a mesma entrada com a mesma faixa de notas e o áudio entre eles não é alterado, sua análise é compartilhada para reduzir a carga se **Onsets**, a cor **Instrument** ou **Highlight** estiver ativado no Note Spectrogram. Caso contrário, o SoundFont Note Player faz sua própria análise.
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

### Instrument Details

Abra **Instrument Details**, abaixo dos controles principais, para consultar os rótulos do instrumento SFZ: teclas, controladores MIDI (**CC**), saídas, grupos, camadas e teclas de troca de articulação. Esses rótulos descrevem os mapeamentos do instrumento; não são controles adicionais. Quando uma articulação identificada por um rótulo está ativa, **Keyswitch** mostra a seleção de cada canal. A imagem fornecida pelo instrumento também aparece; se houver várias declarações de imagem, a última será usada.

### Visualização da reprodução e observações

- **Teclado interativo e barras de velocidade**: O teclado vai de **Lowest Note** a **Highest Note** e ilumina as notas que estão soando, incluindo as caudas de liberação. As teclas iluminadas acompanham **Octave**; **Sample Shift** muda o timbre sem movê-las. Cada barra começa na velocidade com que a nota soa (1–127) e desce com o tempo, mesmo depois que a nota termina; **Color** muda as cores sem reiniciar a queda. **Voices / Max Voices** conta as vozes de amostras, incluindo as liberações.
- **Audição**: Clique ou arraste sobre o teclado ou a área de velocidade para tocar diretamente o instrumento SFZ carregado. O teclado toca com velocidade 100; na área de velocidade, a velocidade depende da altura em que você insere a nota. A audição toca a altura exibida, ignorando **Octave**, mas **Sample Shift** continua sendo aplicado.
- **Limite de memória**: O limite para instrumentos e cache de amostras é de **256 MiB**, ajustável até **1024 MiB** em **Limite de tamanho de SoundFont**, em **Configurações > Configuração... > Geral**. Arquivos lidos por partes podem ser maiores. Se o limite impedir o carregamento, aumente-o ou escolha um instrumento menor.
- **Recursos de SFZ compatíveis**: SoundFont Note Player usa os ataques das notas detectadas. Camadas dependentes de controladores e mudanças de articulação usam os ajustes iniciais do instrumento, sem seguir os eventos da música MIDI. Para músicas MIDI e controles que mudam durante a execução, use SoundFont Player. Não é possível carregar um instrumento que use ajustes não compatíveis ou esteja sem amostras necessárias. Verifique os arquivos ou escolha outro instrumento.
- **Compartilhamento e backups**: Predefinições, links compartilhados e backups dos dados do usuário armazenam a referência ao instrumento, e não suas amostras de áudio; guarde suas pastas SFZ originais para usá-las em outros dispositivos.

## SoundFont Player

Reproduza músicas MIDI com uma coleção SoundFont SF2/SF3 ou um instrumento SFZ e ajuste o som com os efeitos seguintes. O áudio de entrada passa sem alterações, e o instrumento é somado neste ponto da cadeia.

### Primeiros passos

Abra um arquivo `.mid`, adicione SoundFont Player e abra **SoundFont Library…**. Importe um arquivo `.sf2` / `.sf3` ou um instrumento `.sfz` com suas amostras e escolha **Carregar**. O aplicativo para desktop lê os arquivos originais; a versão web armazena os arquivos importados no dispositivo. Comece com **Instrument Level** em 0 dB e reduza se o resultado estiver alto demais.

O SF3 (.sf3) usa amostras comprimidas; a importação e a escolha dos sons são feitas da mesma forma que no SF2. A reprodução de SF3 exige um navegador com suporte à decodificação Vorbis. Se não houver suporte, escolha um SoundFont SF2 ou use um navegador compatível.

**SoundFont Library…** permite importar, buscar, carregar e excluir instrumentos. **Clear** descarrega o instrumento sem excluí-lo da biblioteca. Instrumentos em uso não podem ser excluídos. Se você trocar de instrumento durante uma música, o tempo MIDI continua avançando enquanto o novo instrumento é preparado. Quando estiver pronto, ele toca os próximos eventos MIDI com os ajustes atuais dos controladores; as notas anteriores não são tocadas novamente.

### MIDI Mixer

A aba **MIDI Mixer** tem uma linha para cada um dos 16 canais MIDI. Uma coleção SF2/SF3 pode fornecer um som diferente para cada canal; as mensagens Bank Select e Program Change escolhem os sons, e o canal 10 usa o banco de percussão por padrão. As mensagens de atribuição de percussão GS/XG podem atribuir outros canais à percussão ou devolvê-los aos sons melódicos. Program Change seleciona um kit disponível no SoundFont carregado. Um instrumento SFZ usa seu próprio mapeamento.

Antes de receber uma mensagem Program Change, os canais melódicos usam o programa 1 do banco 0 e o canal 10 usa o kit de bateria padrão, se esses sons estiverem disponíveis. Se o som solicitado não existir no SF2/SF3, os canais melódicos tentam o mesmo programa no banco 0 e, depois, o programa 1 desse banco; os canais de percussão tentam o kit padrão. **Patch** mostra o som realmente usado. Se nenhum desses sons existir, ou se **Automatic Fallback** estiver desativado, o canal ficará sem som.

- **Patch** seleciona pelo nome um som da coleção SF2/SF3 carregada para aquele canal. As novas notas usam o som escolhido; as que já estão soando mantêm o som original.
- **Notes** acende as teclas de cada canal de Note On até Note Off. As teclas se apagam com Note Off, mesmo que o pedal de sustain ou a cauda da nota prolongue o som. **Voices** mostra o número real de vozes de amostras ainda ativas, incluindo as caudas, em relação ao limite **Max Voices**. Uma nota pode usar várias vozes de amostras. Quando **Max Voices** é atingido e uma nova nota precisa interromper uma voz que está soando, o indicador **Voices** muda de cor por três segundos: laranja se a voz interrompida já estava na cauda de liberação, vermelho se ainda estava sendo tocada.
- Arraste o mouse, o dedo ou uma caneta pelas teclas de um canal para tocar o instrumento carregado na altura da tecla sob o ponteiro, usando o **Patch** e as configurações atuais do mixer desse canal. Passar para outra tecla ou soltar equivale a um Note Off de MIDI: a nota anterior se extingue com o release próprio do instrumento, por isso notas com release lento se sobrepõem. Funciona independentemente da música e da entrada MIDI, por isso soa por cima de uma música em reprodução. Um canal com **Mute** ativado permanece em silêncio, e só respondem as linhas com os controles do mixer ativos.
- **Vol.** (CC7, 0–127) ajusta o nível do canal. **EXP** (expressão, CC11, 0–127) é um controle de nível adicional. Valores maiores aumentam o volume; colocar qualquer um dos dois em 0 silencia o canal.
- **Pan** (CC10, 0–127) move o som da esquerda para a direita, com 64 no centro.
- **Rev.** (CC91) e **Cho.** (CC93) ajustam os envios aos efeitos de 0 a 127. Valores maiores enviam mais som ao efeito correspondente; o resultado audível depende dos efeitos aceitos pelo instrumento e de seus ajustes.
- **Level** mostra o nível de áudio medido de cada canal depois dos controles Vol., EXP, Pan e Mute/Solo. A barra colorida acompanha o sinal, e a linha fina mantém os picos recentes por um instante. O retorno compartilhado do reverb e do chorus não é incluído.
- **Mute** (**M**) silencia o canal. **Solo** (**S**) permite ouvir apenas os canais com Solo ativado. Use-os para comparar as partes de uma música.

Arraste os botões giratórios na vertical ou selecione-os e use as teclas de seta. As alterações no mixer são temporárias e não são salvas em presets, links compartilhados ou backups. As alterações de Patch e de controladores usam o estado do MIDI recebido; mensagens posteriores do mesmo tipo podem sobrescrevê-las. Todas as alterações do mixer, incluindo Mute e Solo, são reiniciadas na próxima música ou ao receber uma mensagem de reinicialização GM, GS ou XG.

Quando uma mensagem MIDI recebida altera o valor exibido de Patch ou de um botão giratório, o controle fica destacado por um instante.

### Settings

A aba **Settings** contém os ajustes de reprodução que são salvos:

- **MIDI Channel** reproduz todos os canais com **All** por padrão, ou apenas o canal escolhido de **1–16**.
- **Instrument Level** ajusta o som gerado de -60 a +12 dB (padrão: 0 dB), sem alterar o áudio de entrada.
- **Max Voices** limita as vozes de amostras simultâneas, incluindo as caudas, a 1–1024 (padrão: 256). Valores maiores preservam mais notas sobrepostas e exigem mais processamento.
- **Automatic Fallback** (ativado por padrão) substitui um som SF2/SF3 ausente por outro disponível semelhante, como descrito acima. Desative-o para que os canais que pedem um som inexistente fiquem em silêncio; assim fica fácil notar os sons que faltam no SoundFont.
- **Interpolation** escolhe como as amostras do instrumento são reamostradas. **FIR (64 taps)** usa o filtro habitual de SF2/SF3 ou respeita o ajuste de qualidade do instrumento SFZ. **FIR (32 taps)** (padrão) reduz o processamento com SF2/SF3: usa 32 coeficientes quando não é preciso reduzir a taxa de amostragem; os filtros FIR ficam mais longos quando a reprodução exige essa redução para limitar o aliasing. **Cubic (4 points)** usa uma interpolação leve, mas não tem filtro passa-baixas para evitar aliasing; subir muito o tom ou usar amostras com muitos harmônicos agudos pode gerar frequências indesejadas. FIR e Cubic substituem o ajuste de qualidade do instrumento SFZ.
- **SF2 Compatibility** escolhe como os sons SF2/SF3 são interpretados; instrumentos SFZ não são afetados. **Standard** (padrão) se comporta como os sintetizadores SoundFont comuns e como o hardware original para o qual a maioria dos SoundFonts é ajustada: a atenuação de cada som é aplicada com 40% da intensidade, e a regra padrão de velocidade para filtro da especificação é ignorada, então notas suaves não ficam automaticamente mais escuras. **SF2.04 Strict** segue literalmente a especificação SoundFont 2.04: a atenuação é aplicada por completo, de modo que sons com atenuação soam com volume menor do que os autores da maioria dos SoundFonts pretendiam, e notas suaves soam mais escuras. Use-o para verificar como um SoundFont soa quando interpretado conforme o texto da especificação.

O instrumento selecionado e esses ajustes são salvos normalmente. O volume e o silenciamento do reprodutor também controlam o instrumento MIDI. Presets, links compartilhados e backups guardam a referência ao instrumento, não suas amostras. Guarde os arquivos originais para usá-los em outro dispositivo.

**Color** muda apenas as cores do teclado. **Normal** usa a cor habitual dos gráficos, **Note Colors** usa as cores das notas do Note Spectrogram e **Channel Colors** atribui uma cor diferente a cada canal MIDI. A escolha de cores não é salva nos presets.

### Instrument Details

O resumo do instrumento carregado mostra, quando disponíveis, a quantidade de amostras e sons, o tamanho dos arquivos de origem e a memória de reprodução. Instrumentos grandes leem os dados das amostras conforme necessário para a reprodução, sem carregar toda a origem na memória. Por isso, o tamanho de origem pode ser muito maior que a memória de reprodução.

O status indica a leitura dos arquivos, a preparação do instrumento ou do cache de amostras, a disponibilidade para tocar ou um erro de carregamento. O progresso mostra o trabalho concluído em relação ao total quando este é conhecido; caso contrário, o indicador fica sem uma porcentagem definida. Se o carregamento falhar, verifique se os arquivos originais estão disponíveis ou escolha outro instrumento. Mesmo com pré-carregamento limitado, o instrumento continua disponível para tocar, mas algumas notas podem começar com atraso.

Em **Settings**, abra **Instrument Details** para consultar os rótulos do instrumento SFZ: teclas, controladores MIDI (**CC**), saídas, grupos, camadas e teclas de troca de articulação. Esses rótulos descrevem os mapeamentos do instrumento; não são controles adicionais. Quando uma articulação identificada por um rótulo está ativa, **Keyswitch** mostra a seleção de cada canal. A imagem fornecida pelo instrumento também aparece; se houver várias declarações de imagem, a última será usada.

### Entrada MIDI ao vivo

A execução MIDI ao vivo está disponível no aplicativo de desktop e no player web/PWA. Não é compatível com o aplicativo Android, onde o mapeamento de controladores continua disponível.

Para tocar com um teclado MIDI ou uma porta MIDI virtual, feche o Music Player. Em **Configuração de Áudio**, escolha **Atualizar dispositivos MIDI**, permita o acesso MIDI se solicitado e selecione o **Dispositivo de entrada MIDI**. Mantenha um instrumento carregado no SoundFont Player. O Music Player tem prioridade enquanto estiver aberto, mesmo em pausa; escolha **Nenhum** para interromper a entrada MIDI ao vivo. Sem um instrumento carregado, a entrada MIDI continua em silêncio. Ao carregar o instrumento, os eventos MIDI seguintes passam a soar; as notas anteriores não são repetidas. A entrada MIDI ao vivo não é repassada ao **Dispositivo de saída MIDI**, que envia a um dispositivo externo apenas a reprodução de arquivos MIDI do Music Player.

No aplicativo desktop, sites abertos no **Navegador** que usam Web MIDI também podem tocar o SoundFont Player por meio de uma saída MIDI chamada **EffeTune**. A partir da primeira mensagem MIDI, a página assume a entrada MIDI ao vivo até você clicar em **Fechar** na barra de ferramentas do navegador, sair da página ou recarregá-la; então a entrada volta ao **Dispositivo de entrada MIDI** selecionado.

### Instrumentos SFZ

Um instrumento SFZ pode variar o volume, a altura e o timbre de cada nota ao longo do tempo, combinar filtros e efeitos internos e definir loops de amostras e sons ao soltar as notas. A reprodução e os efeitos sincronizados com as batidas acompanham o andamento e a velocidade de reprodução da música MIDI. Esses ajustes pertencem ao arquivo do instrumento. Para modificar o som geral, adicione efeitos depois do SoundFont Player.

`amp_veltrack_random` permite que um instrumento SFZ varie aleatoriamente a relação entre a intensidade do toque e o volume a cada nova nota. O valor padrão 0 não acrescenta variação aleatória. O ajuste muda como a força da execução afeta o volume, não o próprio valor de intensidade MIDI (velocity).

Instrumentos grandes leem os dados das amostras conforme necessário, dentro do limite de memória configurado. Importe o arquivo de definição junto com todas as amostras necessárias; amostras incorporadas e arquivos usados apenas pelos efeitos do instrumento também são incluídos. Se uma amostra falhar na verificação de conteúdo, restaure o arquivo original ou importe o instrumento novamente. Instrumentos com saídas separadas precisam de uma configuração de saída com canais suficientes.

Um arquivo SFZ pode escolher o armazenamento das amostras com `load_mode`: 0 (padrão) usa ponto flutuante de 32 bits, e 1 usa PCM de 16 bits para reduzir a memória das amostras. Fontes de maior precisão perdem precisão no modo de 16 bits. No EffeTune, `load_start` e `load_end` indicam o primeiro e o último quadro da amostra original a manter na memória, incluindo o último. Ao especificar um intervalo, omitir o início equivale a 0 e omitir o fim equivale ao final da amostra. Os dados fora desse intervalo são lidos conforme necessário; isso não corta a reprodução nem desloca os pontos de loop. Sem nenhum dos dois limites, o streaming das amostras continua automático.

A compatibilidade varia conforme o instrumento, e alguns comportamentos específicos de fabricantes não estão disponíveis. Consulte a [referência de compatibilidade SFZ](../../../../specifications/sfz/README.md) para conhecer o perfil compatível e suas limitações. O SoundFont Note Player prepara os instrumentos da mesma forma, mas as notas detectadas não fornecem as mudanças de controladores nem o andamento de uma música MIDI.
