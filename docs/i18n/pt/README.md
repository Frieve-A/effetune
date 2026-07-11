# Frieve EffeTune <img src="../../../images/icon_64x64.png" alt="EffeTune Icon" width="30" height="30" align="bottom">

<div class="doc-primary-actions" aria-label="Ações principais">
  <a class="button button-primary" href="https://effetune.frieve.com/effetune.html">Abrir Web App</a>
  <install class="button button-secondary"><a href="https://effetune.frieve.com/effetune.html">Instalar versão PWA</a></install>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune/releases/">Baixar Desktop App</a>
</div>

Um processador de efeitos de áudio em tempo real, projetado para entusiastas do áudio aprimorarem sua experiência de escuta. EffeTune permite que você processe qualquer fonte de áudio através de vários efeitos de alta qualidade, possibilitando personalizar e aperfeiçoar sua experiência de escuta em tempo real.

[![Screenshot](../../../images/screenshot.png)](https://effetune.frieve.com/effetune.html)

## Vídeo de Introdução

[![YouTube Video](../../../images/video_thumbnail.jpg)](https://www.youtube.com/watch?v=--mtsy1t4HI)

## Conceito

EffeTune foi criado para entusiastas do áudio que desejam melhorar sua experiência musical. Quer você esteja transmitindo música ou reproduzindo mídias físicas, EffeTune permite adicionar efeitos de alta qualidade para personalizar o som conforme suas preferências exatas. Transforme seu computador em um poderoso processador de efeitos de áudio que se posiciona entre sua fonte de áudio e seus alto-falantes ou amplificador.

Sem mitos audiófilos, apenas pura ciência.

## Recursos

- Processamento de áudio em tempo real
- Interface de arrastar e soltar para construir cadeias de efeitos
- Sistema de efeitos expansível com efeitos categorizados
- Visualização de áudio ao vivo
- Pipeline de áudio que pode ser modificado em tempo real
- Processamento offline de arquivos de áudio com a cadeia de efeitos atual
- Biblioteca de música para navegar por subpastas locais, metadados e playlists
- Medição e correção de resposta em frequência para calibração do sistema
- Processamento e saída multicanal

## Guia de Configuração

Antes de usar o EffeTune, você precisará configurar o roteamento de áudio. Veja como configurar diferentes fontes de áudio:

### Configuração do Reprodutor de Arquivos de Música

- Abra o aplicativo web EffeTune em seu navegador, ou inicie o aplicativo desktop EffeTune
- Abra e reproduza um arquivo de música para garantir a reprodução adequada
   - Abra um arquivo de música e selecione EffeTune como o aplicativo (apenas aplicativo desktop)
   - Ou selecione Abrir arquivo de música... no menu Arquivo (apenas aplicativo desktop)
   - Ou arraste o arquivo de música para a janela
- Para usar apenas o player, selecione Nenhum (somente player de arquivos de música) como dispositivo de entrada em Configuração de Áudio para não usar uma entrada de áudio ao vivo

### Configuração para Serviços de Streaming

Para processar áudio de serviços de streaming (Spotify, YouTube Music, etc.):

1. Pré-requisitos:
   - Instale um dispositivo de áudio virtual (por exemplo, VB Cable, Voice Meeter ou ASIO Link Tool)
   - Configure seu serviço de streaming para enviar o áudio para o dispositivo de áudio virtual

2. Configuração:
   - Abra o aplicativo web EffeTune em seu navegador, ou inicie o aplicativo desktop EffeTune
   - Selecione o dispositivo de áudio virtual como fonte de entrada
     - No Chrome, na primeira vez que você abri-lo, uma caixa de diálogo aparecerá pedindo para selecionar e permitir a entrada de áudio
     - No aplicativo desktop, configure-o clicando no botão Config Audio no canto superior direito da tela
   - Comece a reproduzir música no seu serviço de streaming
   - Verifique se o áudio está passando pelo EffeTune
   - Para instruções de configuração mais detalhadas, consulte a [FAQ](faq.md)

### Configuração para Fontes de Áudio Físicas

Para usar o EffeTune com players de CD, players de rede ou outras fontes físicas:

- Conecte sua interface de áudio ao seu computador
- Abra o aplicativo web EffeTune em seu navegador, ou inicie o aplicativo desktop EffeTune
- Selecione sua interface de áudio como fonte de entrada e saída
   - No Chrome, na primeira vez que você abri-lo, uma caixa de diálogo aparecerá pedindo para selecionar e permitir a entrada de áudio
   - No aplicativo desktop, configure-o clicando no botão Config Audio no canto superior direito da tela
- Sua interface de áudio agora funciona como um processador de múltiplos efeitos:
   * Entrada: Seu CD player, player de rede ou outra fonte de áudio
   * Processamento: Efeitos em tempo real através do EffeTune
   * Saída: Áudio processado para seu amplificador ou alto-falantes

## Uso

### Configurações do Aplicativo

Abra **Configuração...** no menu **Configurações** para escolher o idioma, a opção **Visualização ao iniciar:** e o comportamento do pipeline de efeitos na inicialização. A opção **Visualização ao iniciar:** pode ser **Effect Pipeline (padrão)** ou **Biblioteca de música**. Ao escolher **Biblioteca de música**, use a lista ao lado para definir qual seção será exibida primeiro: **Faixas**, **Álbuns**, **Artistas**, **Gêneros** ou **Subpastas**.

### Procurando música na Biblioteca de música

1. No PC, abra pelo botão **Biblioteca de música** no cabeçalho; no móvel, pela aba **Biblioteca**; no aplicativo desktop, por **Visualizar > Biblioteca de música**.
2. Selecione **Adicionar pasta de música** para indexar uma pasta com arquivos de música.
3. Navegue por **Faixas**, **Álbuns**, **Artistas**, **Gêneros**, **Subpastas**, **Pastas**, **Adicionadas recentemente** ou **Playlists**, e use **Pesquisar na biblioteca** para pesquisar todo o catálogo. A seção **Subpastas** agrupa pelo caminho que contém as faixas dentro de cada raiz importada, enquanto **Pastas** gerencia essas raízes. Bibliotecas existentes recebem esse agrupamento sem nova varredura nem migração do armazenamento.
4. Reproduza os resultados pelo Effect Pipeline atual, ou use **Reproduzir a seguir**, **Adicionar à fila** e **Adicionar à playlist** para gerenciar a reprodução.
5. Use **Reescanear** depois de modificar arquivos e **Reconectar** se uma permissão do navegador ou da pasta expirar.
   - [Mais sobre a Biblioteca de música](music-library.md)

### Construindo Sua Cadeia de Efeitos

1. Os **Available Effects** estão listados no lado esquerdo da tela
   - Use o botão de busca ao lado de **Available Effects** para filtrar os efeitos
   - Digite qualquer texto para encontrar efeitos por nome ou categoria
   - Pressione ESC para limpar a busca
2. Arraste os efeitos da lista para a área **Effect Pipeline**
3. Os efeitos são processados na ordem de cima para baixo
4. Arraste o manipulador (⋮) ou clique nos botões ▲▼ para reordenar os efeitos
   - Para efeitos Section: Shift+clique nos botões ▲▼ para mover seções inteiras (de uma Section para a próxima Section, início do pipeline, ou fim do pipeline)
5. Clique no nome do efeito para expandir/ocultar suas configurações
   - Shift+clique em um efeito Section para expandir/ocultar todos os efeitos dentro dessa seção
   - Shift+clique em outros efeitos para expandir/ocultar todos os efeitos, exceto a categoria Analyzer
   - Ctrl+clique para expandir/ocultar todos os efeitos
6. Use o botão **ON** para desativar (bypass) efeitos individuais
7. Clique no botão **?** para abrir sua documentação detalhada em uma nova aba
8. Remova os efeitos utilizando o botão ×
   - Para efeitos Section: Shift+clique no botão × para remover seções inteiras
9. Clique no botão de roteamento para definir os canais a serem processados e os barramentos de entrada e saída  
   - [Mais sobre funções de bus](bus-function.md)

### Usando Presets

1. Salve sua cadeia de efeitos:
   - Configure sua cadeia de efeitos desejada e os parâmetros
   - Digite um nome para seu preset no campo de entrada
   - Clique no botão de salvar para armazenar seu preset

2. Carregar um Preset:
   - Digite ou selecione um nome de preset na lista suspensa
   - O preset será carregado automaticamente
   - Todos os efeitos e suas configurações serão restaurados

3. Excluir um Preset:
   - Selecione o preset que deseja remover
   - Clique no botão de excluir
   - Confirme a exclusão quando solicitado

4. Informações do Preset:
   - Cada preset armazena a configuração completa da sua cadeia de efeitos
   - Inclui a ordem dos efeitos, os parâmetros e os estados

### Usando a Funcionalidade Section

1. Uso do Efeito Section:
   - Adicione um efeito Section no início de um grupo de efeitos
   - Digite um nome descritivo no campo Comment
   - Alternar o Section ON/OFF coloca essa seção em bypass ou a restaura, preservando o estado ON/OFF próprio de cada efeito
   - Use múltiplos efeitos Section para organizar sua cadeia de efeitos em grupos lógicos
   - [Mais sobre efeitos de controle](plugins/control.md)

### Usando Recursos de Pipeline AB

1. Visão Geral do Pipeline AB:
   - O EffeTune pode manter dois pipelines de efeitos separados: Pipeline A e Pipeline B
   - Na inicialização, apenas o Pipeline A é carregado; o Pipeline B é criado quando necessário
   - Todas as operações de processamento, salvamento, carregamento e edição funcionam no pipeline atualmente selecionado

2. Botão de Alternância AB:
   - Localizado à direita do cabeçalho Effect Pipeline
   - Mostra "A" por padrão (Pipeline A ativo)
   - Clique para alternar entre Pipeline A e Pipeline B
   - Se o Pipeline B não existir ao alternar, as configurações do Pipeline A serão copiadas para o Pipeline B

3. Menu AB (Botão Dropdown):
   - Localizado à direita do botão de alternância AB
   - "A → B": Copia as configurações do Pipeline A para o Pipeline B e alterna para o Pipeline B
   - "B → A": Copia as configurações do Pipeline B para o Pipeline A e alterna para o Pipeline A

4. Double Blind Test:
   - Compare o Pipeline A e o Pipeline B sem saber qual deles está sendo reproduzido
   - Faça um teste ABX para verificar se você realmente consegue distinguir os dois pipelines, ou um teste de preferência A/B para descobrir qual prefere, com verificação de significância estatística
   - Abra pelo menu de pipeline ▼ à direita do botão de alternância AB (no aplicativo desktop, também está disponível no menu Arquivo)
   - [Mais sobre o Double Blind Test](double-blind-test.md)

### Seleção de Efeitos e Atalhos de Teclado

1. Métodos de Seleção de Efeitos:
   - Clique nos cabeçalhos dos efeitos para selecionar efeitos individuais
   - Mantenha Ctrl pressionado ao clicar para selecionar múltiplos efeitos
   - Clique em um espaço vazio na área **Effect Pipeline** para desmarcar todos os efeitos

2. Atalhos de Teclado:
   - Ctrl + Z: Desfazer
   - Ctrl + Y: Refazer
   - Ctrl + S: Salvar o pipeline atual
   - Ctrl + Shift + S: Salvar o pipeline atual como
   - Ctrl + X: Recortar os efeitos selecionados
   - Ctrl + C: Copiar os efeitos selecionados
   - Ctrl + V: Colar os efeitos da área de transferência
   - Ctrl + F: Procurar efeitos
   - Ctrl + A: Selecionar todos os efeitos no pipeline
   - Delete: Excluir os efeitos selecionados
   - ESC: Desmarcar todos os efeitos
   - T: Alternar entre Pipeline A e Pipeline B
   - A: Alternar para Pipeline A
   - B: Alternar para Pipeline B

3. Atalhos de teclado (ao usar o player):
   - Space: Reproduzir/Pausar
   - Ctrl + → ou N: Próxima faixa
   - Ctrl + ← ou P: Faixa anterior
   - Shift + → ou F ou .: Avançar 10 segundos
   - Shift + ← ou R ou ,: Retroceder 10 segundos
   - Ctrl + M: Alternar modo de repetição
   - Ctrl + H: Alternar modo aleatório
   - T: Alternar entre Pipeline A e Pipeline B
   - A: Alternar para Pipeline A
   - B: Alternar para Pipeline B

### Processamento de Arquivos de Áudio

1. Área de Soltar ou Especificar Arquivos:
   - Uma área dedicada para soltar arquivos está sempre visível abaixo da área **Effect Pipeline**
   - Suporta um ou múltiplos arquivos de áudio
   - Os arquivos são processados usando as configurações da cadeia atual
   - Todo o processamento é feito na taxa de amostragem da cadeia

2. Status do Processamento:
   - A barra de progresso mostra o status atual do processamento
   - O tempo de processamento depende do tamanho do arquivo e da complexidade da cadeia de efeitos

3. Opções de Download ou Salvamento:
   - O arquivo processado é gerado no formato WAV
   - Para vários arquivos, selecione uma pasta de saída antes do processamento; cada arquivo é salvo diretamente nessa pasta ao ser concluído
   - Em navegadores mais antigos sem suporte à seleção de pasta, vários arquivos são empacotados em um ZIP para download

### Compartilhando Cadeias de Efeitos

Você pode compartilhar a configuração da sua cadeia de efeitos com outros usuários:
1. Após configurar sua cadeia de efeitos desejada, clique no botão **Share** no canto superior direito da área **Effect Pipeline**
2. A URL do aplicativo web será copiada automaticamente para sua área de transferência
3. Compartilhe a URL copiada com outros – eles poderão recriar exatamente sua cadeia de efeitos ao abri-la
4. No aplicativo web, todas as configurações dos efeitos são armazenadas na URL, facilitando o salvamento e compartilhamento
5. Na versão do aplicativo desktop, exporte as configurações para um arquivo effetune_preset a partir do menu Arquivo
6. Compartilhe o arquivo effetune_preset exportado. O arquivo effetune_preset também pode ser carregado arrastando-o para a janela do aplicativo web

### Reset de Áudio

Se você estiver enfrentando problemas de áudio (interrupções, falhas):
1. Clique no botão **Reset Audio** no canto superior esquerdo no aplicativo web ou selecione Recarregar no menu Visualizar no aplicativo desktop
2. O pipeline de áudio será reconstruído automaticamente
3. A configuração da sua cadeia de efeitos será preservada

### Medição e Correção de Resposta em Frequência

Para medir a resposta em frequência do seu sistema de áudio e criar uma correção de EQ plana:
1. Na versão web, abra a [ferramenta de medição de resposta em frequência](https://effetune.frieve.com/features/measurement/measurement.html). Na versão do aplicativo, selecione Medição da resposta em frequência no menu Configurações.
2. Siga a configuração guiada para ajustar seu microfone de medição e dispositivo de saída
3. Meça a resposta em frequência do seu sistema em uma ou mais posições de escuta
4. Gere uma correção de EQ paramétrico que pode ser importada diretamente no EffeTune
5. Aplique a correção para obter uma reprodução sonora mais precisa e neutra

## Combinações Comuns de Efeitos

Aqui estão algumas combinações populares de efeitos para aprimorar sua experiência de escuta:

### Melhoria para Fones de Ouvido
1. Stereo Blend -> RS Reverb
   - **Stereo Blend**: Ajusta a largura estéreo para conforto (60-100%)
   - **RS Reverb**: Adiciona uma ambiência sutil de sala (mistura de 10-20%)
   - **Resultado**: Audição com fones de ouvido mais natural e menos fatigante

### Simulação de Vinil
1. Wow Flutter -> Noise Blender -> Saturation
   - **Wow Flutter**: Adiciona uma variação suave de pitch
   - **Noise Blender**: Cria uma atmosfera semelhante à do vinil
   - **Saturation**: Adiciona um calor analógico
   - **Resultado**: Experiência autêntica de disco de vinil

### Estilo Rádio FM
1. Multiband Compressor -> Stereo Blend
   - **Multiband Compressor**: Cria aquele som de "rádio"
   - **Stereo Blend**: Ajusta a largura estéreo para conforto (100-150%)
   - **Resultado**: Som polido no estilo de rádio FM

### Caráter Lo-Fi
1. Bit Crusher -> Simple Jitter -> RS Reverb
   - **Bit Crusher**: Reduz a profundidade de bits para uma sensação retrô
   - **Simple Jitter**: Adiciona imperfeições digitais
   - **RS Reverb**: Cria um espaço atmosférico
   - **Resultado**: Estética clássica lo-fi

## Solução de Problemas e FAQ

Em caso de dúvidas ou dificuldades, consulte a [FAQ](faq.md).
Se o problema continuar, reporte em [GitHub Issues](https://github.com/Frieve-A/effetune/issues).

## Efeitos Disponíveis

| Categoria | Efeito             | Descrição                                                               | Documentação                                         |
| --------- | ------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| Analyzer  | Level Meter        | Exibe o nível de áudio com retenção de pico                             | [Detalhes](plugins/analyzer.md#level-meter)          |
| Analyzer  | Oscilloscope       | Visualização de forma de onda em tempo real                             | [Detalhes](plugins/analyzer.md#oscilloscope)         |
| Analyzer  | Spectrogram        | Exibe variações do espectro de frequências ao longo do tempo            | [Detalhes](plugins/analyzer.md#spectrogram)          |
| Analyzer  | Spectrum Analyzer  | Mostra a força dos graves, médios e agudos em tempo real                | [Detalhes](plugins/analyzer.md#spectrum-analyzer)    |
| Analyzer  | Stereo Meter       | Visualiza o equilíbrio estéreo e a correlação entre canais              | [Detalhes](plugins/analyzer.md#stereo-meter)         |
| Basics    | Channel Divider    | Divide o sinal estéreo em bandas de frequência e roteia cada banda para pares de saída estéreo separados | [Detalhes](plugins/basics.md#channel-divider)       |
| Basics    | DC Offset          | Ajuste de deslocamento DC                                               | [Detalhes](plugins/basics.md#dc-offset)              |
| Basics    | Matrix             | Encaminha e mistura canais de áudio com controle flexível               | [Detalhes](plugins/basics.md#matrix)                 |
| Basics    | MultiChannel Panel | Painel de controle para múltiplos canais com volume, mudo, solo e atraso | [Detalhes](plugins/basics.md#multichannel-panel)     |
| Basics    | Mute               | Silencia completamente o sinal de áudio                                 | [Detalhes](plugins/basics.md#mute)                   |
| Basics    | Polarity Inversion | Inversão de polaridade do sinal                                         | [Detalhes](plugins/basics.md#polarity-inversion)     |
| Basics    | Stereo Balance     | Controle de equilíbrio dos canais estéreo                               | [Detalhes](plugins/basics.md#stereo-balance)         |
| Basics    | Volume             | Controle básico de volume                                               | [Detalhes](plugins/basics.md#volume)                 |
| Delay     | Delay | Efeito de atraso padrão | [Detalhes](plugins/delay.md#delay) |
| Delay     | Time Alignment | Ajusta finamente o tempo de reprodução para alinhar caixas e posição de escuta | [Detalhes](plugins/delay.md#time-alignment) |
| Dynamics  | Auto Leveler | Ajuste automático de volume baseado na medição LUFS para experiência de audição consistente | [Detalhes](plugins/dynamics.md#auto-leveler) |
| Dynamics  | Brickwall Limiter | Controle transparente de picos para audição segura e confortável | [Detalhes](plugins/dynamics.md#brickwall-limiter) |
| Dynamics  | Compressor | Suaviza trechos que ficam altos de repente para uma audição mais confortável | [Detalhes](plugins/dynamics.md#compressor) |
| Dynamics  | Expander | Restaura contraste dinâmico deixando sons abaixo do limiar ainda mais baixos | [Detalhes](plugins/dynamics.md#expander) |
| Dynamics  | Gate | Reduz sons de baixo nível em pausas ou trechos silenciosos | [Detalhes](plugins/dynamics.md#gate) |
| Dynamics  | Multiband Compressor | Balanceamento de volume em 5 bandas para um som estável, parecido com rádio | [Detalhes](plugins/dynamics.md#multiband-compressor) |
| Dynamics  | Multiband Expander | Expansor de 5 bandas para recuperar contraste natural em gravações muito achatadas | [Detalhes](plugins/dynamics.md#multiband-expander) |
| Dynamics  | Multiband Transient | Ajusta ataque e sustain separadamente nas faixas de graves, médios e agudos | [Detalhes](plugins/dynamics.md#multiband-transient) |
| Dynamics  | Power Amp Sag | Simula a queda de tensão do amplificador de potência sob condições de alta carga | [Detalhes](plugins/dynamics.md#power-amp-sag) |
| Dynamics  | Transient Shaper | Ajusta o impacto e o corpo da música moldando ataques e sustain | [Detalhes](plugins/dynamics.md#transient-shaper) |
| EQ        | 15Band GEQ | Equalizador gráfico de 15 bandas | [Detalhes](plugins/eq.md#15band-geq) |
| EQ        | 15Band PEQ | Equalizador paramétrico de 15 bandas para ajuste detalhado do tom na escuta | [Detalhes](plugins/eq.md#15band-peq) |
| EQ        | 5Band Dynamic EQ | Equalizador dinâmico de 5 bandas com ajuste de frequência baseado em limiar | [Detalhes](plugins/eq.md#5band-dynamic-eq) |
| EQ        | 5Band PEQ | Equalizador flexível de 5 bandas para moldar graves, médios e agudos | [Detalhes](plugins/eq.md#5band-peq) |
| EQ        | Band Pass Filter | Foque em frequências específicas | [Detalhes](plugins/eq.md#band-pass-filter) |
| EQ        | Comb Filter | Adiciona coloração faseada, oca ou metálica | [Detalhes](plugins/eq.md#comb-filter) |
| EQ        | Earphone Cable Sim | Ajuda a verificar como as mudanças de resposta em frequência causadas por cabos comuns de fones de ouvido costumam ser pequenas | [Detalhes](plugins/eq.md#earphone-cable-sim) |
| EQ        | Hi Pass Filter | Remove frequências baixas indesejadas com precisão | [Detalhes](plugins/eq.md#hi-pass-filter) |
| EQ        | Lo Pass Filter | Remove frequências altas indesejadas com precisão | [Detalhes](plugins/eq.md#lo-pass-filter) |
| EQ        | Loudness Equalizer | Correção de balanço de frequência para audição em baixo volume | [Detalhes](plugins/eq.md#loudness-equalizer) |
| EQ        | Narrow Range | Combinação de filtros passa-alta e passa-baixa | [Detalhes](plugins/eq.md#narrow-range) |
| EQ        | Tilt EQ | Equalizador tilt para modelagem rápida de tonalidade | [Detalhes](plugins/eq.md#tilt-eq) |
| EQ        | Tone Control | Controle de tonalidade de três bandas | [Detalhes](plugins/eq.md#tone-control) |
| Lo-Fi     | Bit Crusher | Redução de profundidade de bits e efeito de retenção de ordem zero | [Detalhes](plugins/lofi.md#bit-crusher) |
| Lo-Fi     | Digital Error Emulator | Simula vários erros de transmissão de áudio digital e características de equipamentos digitais vintage | [Detalhes](plugins/lofi.md#digital-error-emulator) |
| Lo-Fi     | DSD64 IMD Simulator | Simula a distorção de intermodulação audível causada pelo ruído ultrassônico do DSD64 | [Detalhes](plugins/lofi.md#dsd64-imd-simulator) |
| Lo-Fi     | Hum Generator | Adiciona ambiência controlável de hum elétrico de 50/60 Hz para escuta vintage/lo-fi | [Detalhes](plugins/lofi.md#hum-generator) |
| Lo-Fi     | Noise Blender | Adiciona textura ajustável de ruído de fundo para ambiência lo-fi | [Detalhes](plugins/lofi.md#noise-blender) |
| Lo-Fi     | Simple Jitter | Simulação de jitter digital | [Detalhes](plugins/lofi.md#simple-jitter) |
| Lo-Fi     | Vinyl Artifacts | Adiciona estalos, crackle, hiss, rumble e vazamento de ruído estéreo no estilo vinil | [Detalhes](plugins/lofi.md#vinyl-artifacts) |
| Modulation | Doppler Distortion | Simula mudanças naturais e dinâmicas no som causadas por sutis movimentos do cone do alto-falante | [Detalhes](plugins/modulation.md#doppler-distortion) |
| Modulation | Pitch Shifter | Sobe ou desce o pitch da música sem mudar o tempo | [Detalhes](plugins/modulation.md#pitch-shifter) |
| Modulation | Tremolo | Efeito de modulação baseado em volume | [Detalhes](plugins/modulation.md#tremolo) |
| Modulation | Wow Flutter | Adiciona uma oscilação sutil de pitch no estilo fita ou disco para caráter vintage | [Detalhes](plugins/modulation.md#wow-flutter) |
| Resonator | Horn Resonator | Simulação de ressonância de corno com dimensões personalizáveis | [Detalhes](plugins/resonator.md#horn-resonator) |
| Resonator | Horn Resonator Plus | Ressonância de alto-falante tipo corneta mais suave para coloração natural na escuta | [Detalhes](plugins/resonator.md#horn-resonator-plus) |
| Resonator | Modal Resonator | Efeito de ressonância de frequência com até 5 ressonadores | [Detalhes](plugins/resonator.md#modal-resonator) |
| Reverb    | Dattorro Plate Reverb | Reverb de placa clássico baseado no algoritmo Dattorro | [Detalhes](plugins/reverb.md#dattorro-plate-reverb) |
| Reverb    | FDN Reverb | Reverberação de rede de atraso com feedback que produz texturas de reverb ricas e densas | [Detalhes](plugins/reverb.md#fdn-reverb) |
| Reverb    | RS Reverb | Reverberação por espalhamento randômico com difusão natural | [Detalhes](plugins/reverb.md#rs-reverb) |
| Saturation| Dynamic Saturation | Simula o deslocamento não linear de cones de alto-falantes | [Detalhes](plugins/saturation.md#dynamic-saturation) |
| Saturation| Exciter | Adiciona conteúdo harmônico para melhorar clareza e presença | [Detalhes](plugins/saturation.md#exciter) |
| Saturation| Hard Clipping | Efeito de hard clipping digital | [Detalhes](plugins/saturation.md#hard-clipping) |
| Saturation | Harmonic Distortion | Adiciona caráter com distorção harmônica ajustável de 2ª a 5ª ordem | [Detalhes](plugins/saturation.md#harmonic-distortion) |
| Saturation| Multiband Saturation | Adiciona calor ou aspereza separadamente em graves, médios e agudos | [Detalhes](plugins/saturation.md#multiband-saturation) |
| Saturation| Saturation | Adiciona riqueza e caráter quentes no estilo analógico | [Detalhes](plugins/saturation.md#saturation) |
| Saturation| Sub Synth | Mistura um sinal filtrado de baixa frequência para reforçar os graves | [Detalhes](plugins/saturation.md#sub-synth) |
| Spatial   | Crossfeed Filter | Filtro de crossfeed para fones de ouvido para imagem estéreo natural | [Detalhes](plugins/spatial.md#crossfeed-filter) |
| Spatial   | MS Matrix | Converte entre estéreo e Mid/Side para ajustes de centro e ambiência | [Detalhes](plugins/spatial.md#ms-matrix) |
| Spatial   | Multiband Balance | Controle de balanço estéreo dependente de frequência de 5 bandas | [Detalhes](plugins/spatial.md#multiband-balance) |
| Spatial   | Stereo Blend | Controla a largura estéreo, de mono a estéreo ampliado | [Detalhes](plugins/spatial.md#stereo-blend) |
| Others    | Oscillator | Gerador de tons de teste e ruído para verificar alto-falantes/fones | [Detalhes](plugins/others.md#oscillator) |
| Control   | Section | Agrupa efeitos para que uma seção inteira possa ser colocada em bypass ou restaurada | [Detalhes](plugins/control.md) |

## Informações Técnicas

### Compatibilidade de Navegador

Frieve EffeTune foi testado e verificado para funcionar no Google Chrome. A aplicação requer um navegador moderno com suporte para:
- Web Audio API
- Audio Worklet
- getUserMedia API
- Drag and Drop API

### Detalhes de Suporte do Navegador
1. Chrome/Chromium
   - Totalmente suportado e recomendado
   - Atualize para a versão mais recente para melhor desempenho

2. Firefox/Safari
   - Suporte limitado
   - Algumas funcionalidades podem não funcionar como esperado
   - Considere usar o Chrome para a melhor experiência

### Taxa de Amostragem Recomendada

Para um desempenho ideal com efeitos não lineares, recomenda-se usar o EffeTune com uma taxa de amostragem de 96kHz ou superior. Essa taxa de amostragem mais alta ajuda a alcançar características ideais ao processar áudio através de efeitos não lineares, como saturação e compressão.

## Guia de Desenvolvimento

Quer criar seus próprios plugins de áudio? Confira nosso [guia de desenvolvimento de plugins](../../plugin-development.md).
Quer construir um aplicativo desktop? Confira nosso [Guia de Construção](../../../BUILD.md).

## Links

[Histórico de versões](../../version-history.md)

[Código-fonte](https://github.com/Frieve-A/effetune)

[YouTube](https://www.youtube.com/@frieveamusic)

[Discord](https://discord.gg/gf95v3Gza2)

[Apoie no Ko-fi](https://ko-fi.com/frievea)
