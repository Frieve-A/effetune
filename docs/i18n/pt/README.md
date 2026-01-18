---
title: "Frieve EffeTune - Processador de Efeitos de Áudio em Tempo Real"
description: "Processador de efeitos de áudio em tempo real para entusiastas de áudio. Mais de 50 efeitos incluindo EQ, compressor e reverb. Grátis para Windows, macOS, Linux e navegadores web."
lang: pt
image: /images/screenshot.png
---

# Frieve EffeTune <img src="../../../images/icon_64x64.png" alt="EffeTune Icon" width="30" height="30" align="bottom">

[Open Web App](https://effetune.frieve.com/effetune.html)  [Download Desktop App](https://github.com/Frieve-A/effetune/releases/)

Um processador de efeitos de áudio em tempo real, projetado para entusiastas do áudio aprimorarem sua experiência de escuta. EffeTune permite que você processe qualquer fonte de áudio através de vários efeitos de alta qualidade, possibilitando personalizar e aperfeiçoar sua experiência de escuta em tempo real.

[![Screenshot](../../../images/screenshot.png)](https://effetune.frieve.com/effetune.html)

## Conceito

EffeTune foi criado para entusiastas do áudio que desejam melhorar sua experiência musical. Quer você esteja transmitindo música ou reproduzindo mídias físicas, EffeTune permite adicionar efeitos de nível profissional para personalizar o som conforme suas preferências exatas. Transforme seu computador em um poderoso processador de efeitos de áudio que se posiciona entre sua fonte de áudio e seus alto-falantes ou amplificador.

Sem mitos audiófilos, apenas pura ciência.

## Recursos

- Processamento de áudio em tempo real
- Interface de arrastar e soltar para construir cadeias de efeitos
- Sistema de efeitos expansível com efeitos categorizados
- Visualização de áudio ao vivo
- Pipeline de áudio que pode ser modificado em tempo real
- Processamento offline de arquivos de áudio com a cadeia de efeitos atual
- Recurso de seção para agrupar e controlar múltiplos efeitos
- Recurso de medição de resposta de frequência para equipamentos de áudio
- Processamento e saída multicanal

## Guia de Configuração

Antes de usar o EffeTune, você precisará configurar o roteamento de áudio. Veja como configurar diferentes fontes de áudio:

### Configuração do Reprodutor de Arquivos de Música

- Abra o aplicativo web EffeTune em seu navegador, ou inicie o aplicativo desktop EffeTune
- Abra e reproduza um arquivo de música para garantir a reprodução adequada
   - Abra um arquivo de música e selecione EffeTune como o aplicativo (apenas aplicativo desktop)
   - Ou selecione Abrir arquivo de música... no menu Arquivo (apenas aplicativo desktop)
   - Ou arraste o arquivo de música para a janela

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

### Usando a Funcionalidade de Seção

1. Uso do Efeito de Seção:
   - Adicione um efeito de Seção no início de um grupo de efeitos
   - Digite um nome descritivo no campo Comentário
   - Alternar a Seção ON/OFF habilitará/desabilitará todos os efeitos dentro dessa seção
   - Use múltiplos efeitos de Seção para organizar sua cadeia de efeitos em grupos lógicos
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
   - Múltiplos arquivos são automaticamente empacotados em um arquivo ZIP

### Medição de Resposta de Frequência

1. Para a versão web, abra a [ferramenta de Medição da Resposta em Frequência](https://effetune.frieve.com/features/measurement/measurement.html). Para a versão do aplicativo, selecione "Medição da Resposta em Frequência" no menu Configurações
2. Conecte seu equipamento de áudio à entrada e saída do seu computador
3. Configure os parâmetros de medição (duração da varredura, faixa de frequência)
4. Execute a medição para gerar um gráfico de resposta de frequência
5. Analise os resultados ou exporte os dados de medição para análise adicional

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
1. Clique no botão **Reset Audio** no canto superior esquerdo no aplicativo web ou selecione Reload no menu View no aplicativo desktop
2. O pipeline de áudio será reconstruído automaticamente
3. A configuração da sua cadeia de efeitos será preservada

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
   - **Resultado**: Som com qualidade de transmissão profissional

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

| Categoria | Effect             | Descrição                                                               | Documentação                                         |
| --------- | ------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| Analyzer  | Level Meter        | Exibe o nível de áudio com retenção de pico                             | [Detalhes](plugins/analyzer.md#level-meter)          |
| Analyzer  | Oscilloscope       | Visualização de forma de onda em tempo real                             | [Detalhes](plugins/analyzer.md#oscilloscope)         |
| Analyzer  | Spectrogram        | Exibe variações do espectro de frequências ao longo do tempo            | [Detalhes](plugins/analyzer.md#spectrogram)          |
| Analyzer  | Spectrum Analyzer  | Análise de espectro em tempo real                                       | [Detalhes](plugins/analyzer.md#spectrum-analyzer)    |
| Analyzer  | Stereo Meter       | Visualiza o equilíbrio estéreo e o movimento do som                     | [Detalhes](plugins/analyzer.md#stereo-meter)         |
| Basics    | Channel Divider    | Divide o sinal estéreo em bandas de frequência e direciona para canais separados | [Detalhes](plugins/basics.md#channel-divider)       |
| Basics    | DC Offset          | Ajuste de deslocamento DC                                               | [Detalhes](plugins/basics.md#dc-offset)              |
| Basics    | Matrix             | Encaminha e mistura canais de áudio com controle flexível               | [Detalhes](plugins/basics.md#matrix)                 |
| Basics    | MultiChannel Panel | Painel de controle para múltiplos canais com volume, mudo, solo e atraso | [Detalhes](plugins/basics.md#multichannel-panel)     |
| Basics    | Mute               | Silencia completamente o sinal de áudio                                 | [Detalhes](plugins/basics.md#mute)                   |
| Basics    | Polarity Inversion | Inversão de polaridade do sinal                                         | [Detalhes](plugins/basics.md#polarity-inversion)     |
| Basics    | Stereo Balance     | Controle de equilíbrio dos canais estéreo                               | [Detalhes](plugins/basics.md#stereo-balance)         |
| Basics    | Volume             | Controle básico de volume                                               | [Detalhes](plugins/basics.md#volume)                 |
| Delay     | Delay | Efeito de atraso padrão | [Detalhes](plugins/delay.md#delay) |
| Delay     | Time Alignment | Ajustes finos de sincronização para canais de áudio | [Detalhes](plugins/delay.md#time-alignment) |
| Dynamics  | Auto Leveler | Ajuste automático de volume baseado na medição LUFS para experiência de audição consistente | [Detalhes](plugins/dynamics.md#auto-leveler) |
| Dynamics  | Brickwall Limiter | Controle transparente de picos para audição segura e confortável | [Detalhes](plugins/dynamics.md#brickwall-limiter) |
| Dynamics  | Compressor | Compressão de faixa dinâmica com controle de limiar, razão e knee | [Detalhes](plugins/dynamics.md#compressor) |
| Dynamics  | Gate | Portão de ruído com controle de limiar, razão e knee para redução de ruído | [Detalhes](plugins/dynamics.md#gate) |
| Dynamics  | Multiband Compressor | Processador de dinâmica profissional de 5 bandas com modelagem sonora estilo rádio FM | [Detalhes](plugins/dynamics.md#multiband-compressor) |
| Dynamics  | Multiband Expander | Expansor profissional de 5 bandas para expansão de faixa dinâmica específica por frequência | [Detalhes](plugins/dynamics.md#multiband-expander) |
| Dynamics  | Multiband Transient | Modelador de transientes avançado de 3 bandas para controle específico de ataque e sustain por frequência | [Detalhes](plugins/dynamics.md#multiband-transient) |
| Dynamics  | Power Amp Sag | Simula a queda de tensão do amplificador de potência sob condições de alta carga | [Detalhes](plugins/dynamics.md#power-amp-sag) |
| Dynamics  | Transient Shaper | Controla as partes transitórias e de sustain do sinal | [Detalhes](plugins/dynamics.md#transient-shaper) |
| EQ        | 15Band GEQ | Equalizador gráfico de 15 bandas | [Detalhes](plugins/eq.md#15band-geq) |
| EQ        | 15Band PEQ | Equalizador paramétrico profissional com 15 bandas totalmente configuráveis | [Detalhes](plugins/eq.md#15band-peq) |
| EQ        | 5Band Dynamic EQ | Equalizador dinâmico de 5 bandas com ajuste de frequência baseado em limiar | [Detalhes](plugins/eq.md#5band-dynamic-eq) |
| EQ        | 5Band PEQ | Equalizador paramétrico profissional com 5 bandas totalmente configuráveis | [Detalhes](plugins/eq.md#5band-peq) |
| EQ        | Band Pass Filter | Foque em frequências específicas | [Detalhes](plugins/eq.md#band-pass-filter) |
| EQ        | Comb Filter | Filtro pente digital para coloração harmônica e simulação de ressonância | [Detalhes](plugins/eq.md#comb-filter) |
| EQ        | Hi Pass Filter | Remove frequências baixas indesejadas com precisão | [Detalhes](plugins/eq.md#hi-pass-filter) |
| EQ        | Lo Pass Filter | Remove frequências altas indesejadas com precisão | [Detalhes](plugins/eq.md#lo-pass-filter) |
| EQ        | Loudness Equalizer | Correção de balanço de frequência para audição em baixo volume | [Detalhes](plugins/eq.md#loudness-equalizer) |
| EQ        | Narrow Range | Combinação de filtros passa-alta e passa-baixa | [Detalhes](plugins/eq.md#narrow-range) |
| EQ        | Tilt EQ | Equalizador tilt para modelagem rápida de tonalidade | [Detalhes](plugins/eq.md#tilt-eq) |
| EQ        | Tone Control | Controle de tonalidade de três bandas | [Detalhes](plugins/eq.md#tone-control) |
| Lo-Fi     | Bit Crusher | Redução de profundidade de bits e efeito de retenção de ordem zero | [Detalhes](plugins/lofi.md#bit-crusher) |
| Lo-Fi     | Digital Error Emulator | Simula vários erros de transmissão de áudio digital e características de equipamentos digitais vintage | [Detalhes](plugins/lofi.md#digital-error-emulator) |
| Lo-Fi     | Hum Generator | Gerador de ruído de zumbido de alta precisão | [Detalhes](plugins/lofi.md#hum-generator) |
| Lo-Fi     | Noise Blender | Geração e mistura de ruído | [Detalhes](plugins/lofi.md#noise-blender) |
| Lo-Fi     | Simple Jitter | Simulação de jitter digital | [Detalhes](plugins/lofi.md#simple-jitter) |
| Lo-Fi     | Vinyl Artifacts | Simulação física de ruído de discos analógicos | [Detalhes](plugins/lofi.md#vinyl-artifacts) |
| Modulation | Doppler Distortion | Simula mudanças naturais e dinâmicas no som causadas por sutis movimentos do cone do alto-falante | [Detalhes](plugins/modulation.md#doppler-distortion) |
| Modulation | Pitch Shifter | Efeito de alteração de pitch leve | [Detalhes](plugins/modulation.md#pitch-shifter) |
| Modulation | Tremolo | Efeito de modulação baseado em volume | [Detalhes](plugins/modulation.md#tremolo) |
| Modulation | Wow Flutter | Efeito de modulação baseado em tempo | [Detalhes](plugins/modulation.md#wow-flutter) |
| Resonator | Horn Resonator | Simulação de ressonância de corno com dimensões personalizáveis | [Detalhes](plugins/resonator.md#horn-resonator) |
| Resonator | Horn Resonator Plus | Modelo de corno aprimorado com reflexões avançadas | [Detalhes](plugins/resonator.md#horn-resonator-plus) |
| Resonator | Modal Resonator | Efeito de ressonância de frequência com até 5 ressonadores | [Detalhes](plugins/resonator.md#modal-resonator) |
| Reverb    | Dattorro Plate Reverb | Reverb de placa clássico baseado no algoritmo Dattorro | [Detalhes](plugins/reverb.md#dattorro-plate-reverb) |
| Reverb    | FDN Reverb | Reverberação de rede de atraso com feedback que produz texturas de reverb ricas e densas | [Detalhes](plugins/reverb.md#fdn-reverb) |
| Reverb    | RS Reverb | Reverberação por espalhamento randômico com difusão natural | [Detalhes](plugins/reverb.md#rs-reverb) |
| Saturation| Dynamic Saturation | Simula o deslocamento não linear de cones de alto-falantes | [Detalhes](plugins/saturation.md#dynamic-saturation) |
| Saturation| Exciter | Adiciona conteúdo harmônico para melhorar clareza e presença | [Detalhes](plugins/saturation.md#exciter) |
| Saturation| Hard Clipping | Efeito de hard clipping digital | [Detalhes](plugins/saturation.md#hard-clipping) |
| Saturation | Harmonic Distortion | Adiciona caráter único através de distorção harmônica com controle independente de cada harmônico | [Detalhes](plugins/saturation.md#harmonic-distortion) |
| Saturation| Multiband Saturation | Efeito de saturação de 3 bandas para aquecimento preciso baseado em frequência | [Detalhes](plugins/saturation.md#multiband-saturation) |
| Saturation| Saturation | Efeito de saturação | [Detalhes](plugins/saturation.md#saturation) |
| Saturation| Sub Synth | Mistura sinais sub-harmônicos para realce de graves | [Detalhes](plugins/saturation.md#sub-synth) |
| Spatial   | Crossfeed Filter | Filtro de crossfeed para fones de ouvido para imagem estéreo natural | [Detalhes](plugins/spatial.md#crossfeed-filter) |
| Spatial   | MS Matrix | Codificação e decodificação mid-side para manipulação estéreo | [Detalhes](plugins/spatial.md#ms-matrix) |
| Spatial   | Multiband Balance | Controle de balanço estéreo dependente de frequência de 5 bandas | [Detalhes](plugins/spatial.md#multiband-balance) |
| Spatial   | Stereo Blend | Efeito de controle de largura estéreo | [Detalhes](plugins/spatial.md#stereo-blend) |
| Others    | Oscillator | Gerador de sinal de áudio multi-forma de onda | [Detalhes](plugins/others.md#oscillator) |
| Control   | Section | Agrupa múltiplos efeitos para controle unificado | [Detalhes](plugins/control.md) |

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

Quer criar seus próprios plugins de áudio? Confira nosso [Plugin Development Guide](../../plugin-development.md).
Quer construir um aplicativo desktop? Confira nosso [Guia de Construção](../../build.md).

## Links

[Version History](../../version-history.md)

[Source Code](https://github.com/Frieve-A/effetune)

[YouTube](https://www.youtube.com/@frieveamusic)

[Discord](https://discord.gg/gf95v3Gza2)
