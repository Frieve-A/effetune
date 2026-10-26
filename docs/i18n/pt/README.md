# Frieve EffeTune <img src="../../../images/icon_64x64.png" alt="EffeTune Icon" width="30" height="30" align="bottom">

<div class="doc-primary-actions" aria-label="Ações principais">
  <a class="button button-primary" href="https://effetune.frieve.com/effetune.html">Abrir Web App</a>
  <install class="button button-secondary"><a href="https://effetune.frieve.com/effetune.html">Instalar versão PWA</a></install>
  <a class="button button-secondary" href="/dsp/">DSP Library</a>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune/releases/">Baixar Desktop App</a>
  <a class="button button-secondary" href="https://github.com/Frieve-A/effetune-mixwright/releases">Baixar versão VST</a>
  <a class="button button-secondary" href="https://chromewebstore.google.com/detail/effetune/fhjhnpepnhkcdggogicifibfegpbhibp">Instalar extensão para Chrome</a>
  <a class="button button-secondary" href="https://microsoftedge.microsoft.com/addons/detail/effetune/kjpcfdidpphaclfkfdahchhibgjcngdk">Instalar extensão para Edge</a>
</div>

Um processador de efeitos de áudio em tempo real, projetado para entusiastas do áudio aprimorarem sua experiência de escuta. EffeTune permite que você processe qualquer fonte de áudio através de vários efeitos de alta qualidade, possibilitando personalizar e aperfeiçoar sua experiência de escuta em tempo real.

[![Screenshot](../../../images/screenshot.png)](https://effetune.frieve.com/effetune.html)

## Vídeo de Introdução

[![YouTube Video](../../../images/video_thumbnail.jpg)](https://www.youtube.com/watch?v=Qb5Airg0kI8)

## Conceito

EffeTune foi criado para entusiastas do áudio que desejam melhorar sua experiência musical. Quer você esteja transmitindo música ou reproduzindo mídias físicas, EffeTune permite adicionar efeitos de alta qualidade para personalizar o som conforme suas preferências exatas. Transforme seu computador em um poderoso processador de efeitos de áudio que se posiciona entre sua fonte de áudio e seus alto-falantes ou amplificador.

Sem mitos audiófilos, apenas pura ciência.

## Recursos

- Processamento de áudio em tempo real
- Interface de arrastar e soltar para construir cadeias de efeitos
- Sistema de efeitos expansível com efeitos categorizados
- Visualização de áudio ao vivo
- Layouts do Visualizer com gráficos animados, capa e informações da faixa
- Pipeline de áudio que pode ser modificado em tempo real
- Processamento offline de arquivos de áudio com a cadeia de efeitos atual
- Biblioteca de música para navegar por subpastas locais, metadados e playlists
- Minirreprodutor compacto e sempre no topo para o aplicativo desktop
- Medição e correção de resposta em frequência para calibração do sistema
- Processamento e saída multicanal
- Layout web otimizado para celulares e tablets

## Guia de Configuração

Escolha abaixo o método de configuração adequado à fonte de áudio que você quer ouvir.

### Configuração do Reprodutor de Arquivos de Música

- Abra o aplicativo web EffeTune em seu navegador, ou inicie o aplicativo desktop EffeTune
- Abra e reproduza um arquivo de música para garantir a reprodução adequada
   - Clique no botão **Abrir arquivos de música** e selecione um arquivo de música
   - Ou abra um arquivo de música e selecione EffeTune como o aplicativo (apenas aplicativo desktop)
   - Ou selecione Abrir arquivo de música... no menu Arquivo (apenas aplicativo desktop)
   - Ou arraste o arquivo de música para a janela
- Para usar apenas o player, selecione Nenhum (somente player de arquivos de música) como dispositivo de entrada em Configuração de Áudio para não usar uma entrada de áudio ao vivo. Esse é o padrão do aplicativo desktop; se você já salvou um dispositivo de entrada, sua escolha será mantida.

[Player de música](music-player.md)

### Navegador integrado do aplicativo desktop

No aplicativo desktop, **Navegador** reproduz o áudio de sites com os efeitos atuais, sem precisar de um dispositivo de áudio virtual.

1. Clique em **Navegador** no cabeçalho. O processamento do áudio do navegador é iniciado.
2. Digite um endereço HTTP ou HTTPS, entre na sua conta e reproduza a música pelos controles do site. Se você omitir o protocolo, será usado HTTPS.
3. Mude para **Effect Pipeline** para ajustar o som. A troca de visualização mantém o áudio do navegador tocando.

Use Voltar, Avançar, Recarregar e Parar carregamento para navegar. Abra **Favoritos** para adicionar a página atual, abrir uma página salva, renomear um favorito ou excluí-lo. O menu do navegador contém **Mostrar página inicial**, **Abrir no navegador padrão**, **Definir como página inicial** e **Limpar dados dos sites**. Os favoritos e a página inicial escolhida são salvos. As sessões dos sites são mantidas separadamente e continuam disponíveis após reiniciar o aplicativo. As páginas do navegador seguem o nível de zoom do aplicativo.

Com o foco na barra do navegador, use **F5** para recarregar, **F6** para selecionar o endereço, **Alt+Esquerda/Direita** para voltar ou avançar e **Alt+Home** para abrir a página inicial. Esses atalhos também funcionam dentro da página. Com o foco na página, **Ctrl/Cmd+L** seleciona o endereço, **Ctrl/Cmd+R** recarrega e **Ctrl/Cmd+D** abre os favoritos. No macOS, **Cmd+[/]** também permite voltar ou avançar. **Escape** interrompe o carregamento. Clique com o botão direito na página para navegar, em um link para abri-lo aqui ou no navegador padrão ou copiar seu endereço, e em texto selecionado ou em um campo de texto para acessar os comandos de edição disponíveis. Fora da página, os atalhos do aplicativo mantêm suas funções habituais.

Abrir **Navegador** ou voltar a ele seleciona automaticamente o áudio do navegador. O áudio do navegador é misturado com o dispositivo de entrada selecionado. Escolha **Nenhum** como dispositivo de entrada para ouvir apenas o navegador. A opção de entrada do Player não afeta a reprodução no navegador. A música local pode continuar tocando junto com o áudio do navegador. Se a captura parar, clique em **Navegador** de novo para tentar novamente. **Limpar dados dos sites** encerra as sessões nos sites e apaga os dados armazenados, mantendo os favoritos.

Use **Fechar** na barra de ferramentas do navegador para interromper o processamento do áudio do navegador e voltar a **Effect Pipeline**. A página e o histórico de navegação são mantidos. Abra **Navegador** novamente para retomar o processamento de áudio na mesma página.

Em **Configurações > Configuração... > Navegador**:

- **Página inicial** define o endereço HTTP ou HTTPS exibido quando o navegador é aberto pela primeira vez. O campo fica vazio por padrão; quando está vazio, abre o [guia de streaming do EffeTune](https://effetune.frieve.com/streaming/). **Redefinir** limpa o campo sem mudar a página atual.
- **Abrir novas abas no navegador padrão** vem ativado por padrão. Desative para abrir esses links no navegador do EffeTune. Janelas separadas, como as de login, continuam dentro do EffeTune em ambos os casos.
- **User-Agent** é a identificação do navegador enviada aos sites. O valor padrão identifica o navegador como compatível com o Chrome e inclui o nome EffeTune. Deixe o campo vazio ou clique em **Redefinir** para restaurar o valor padrão. Após a alteração, recarregue a página no navegador.

Para trocar os efeitos automaticamente conforme o site, primeiro salve suas cadeias como predefinições. Em **Regras de URL**, clique em **Adicionar regra**, informe um site e um caminho, como `example.com/music/*`, e selecione uma predefinição de cadeia. Omita `http://` ou `https://`, parâmetros de consulta e fragmentos `#`; `*` corresponde a qualquer texto. Ajuste a prioridade com os botões de subir e descer e clique em **Salvar regras**. É usada a primeira regra ativada que corresponda e tenha uma predefinição disponível.

As regras funcionam enquanto o áudio do navegador estiver selecionado, mesmo quando você mudar de tela. Salvar as regras, abrir o navegador ou navegar até uma página correspondente pode carregar a predefinição. A navegação entre páginas que usam a mesma predefinição preserva seus ajustes manuais. Se nenhuma regra corresponder, a cadeia atual permanece como está.

Alguns sites não permitem navegadores integrados, login, reprodução protegida ou captura de áudio. A disponibilidade depende do site e do sistema operacional; a reprodução com DRM não é garantida. Se o login for recusado, tente outro método oferecido pelo site ou use seu navegador habitual. Entrar na conta por ele não inicia uma sessão dentro do EffeTune. O navegador está disponível apenas no aplicativo desktop.

### Configuração da extensão do navegador

Processe até quatro abas do Chrome ou Edge com cadeias independentes, predefinições por URL e taxa de amostragem ajustável, sem dispositivo de áudio virtual. Consulte o [guia da extensão do navegador](browser-extension.md).

1. Instale a extensão EffeTune pela loja do [Chrome](https://chromewebstore.google.com/detail/effetune/fhjhnpepnhkcdggogicifibfegpbhibp) ou do [Edge](https://microsoftedge.microsoft.com/addons/detail/effetune/kjpcfdidpphaclfkfdahchhibgjcngdk).
2. Reproduza o áudio na aba que deseja processar, abra o EffeTune pela barra de ferramentas do navegador e selecione **Start on this tab**.
3. Selecione **Edit pipeline** para adicionar efeitos e ajustar o som.

### Configuração para Serviços de Streaming

Para processar áudio de serviços de streaming (Spotify, YouTube Music, etc.):

No aplicativo desktop, experimente primeiro o [navegador integrado](#navegador-integrado-do-aplicativo-desktop). Para usar um aplicativo de streaming separado ou uma fonte que o navegador integrado não reproduz, siga a configuração de áudio abaixo.

1. Pré-requisitos:
   - Instale um dispositivo de áudio virtual (por exemplo, VB Cable, Voice Meeter ou ASIO Link Tool)
   - Configure seu serviço de streaming para enviar o áudio para o dispositivo de áudio virtual

2. Configuração:
   - Abra o aplicativo web EffeTune em seu navegador, ou inicie o aplicativo desktop EffeTune
   - Selecione o dispositivo de áudio virtual como fonte de entrada
     - No Chrome, na primeira vez que você abri-lo, uma caixa de diálogo aparecerá pedindo para selecionar e permitir a entrada de áudio
     - Abra Configuração de Áudio no menu Configurações para escolher os dispositivos de entrada e saída e o formato de áudio
   - Comece a reproduzir música no seu serviço de streaming
   - Verifique se o áudio está passando pelo EffeTune
   - Para instruções de configuração mais detalhadas, consulte a [FAQ](faq.md)

### Configuração para Fontes de Áudio Físicas

Para usar o EffeTune com players de CD, players de rede ou outras fontes físicas:

- Conecte sua interface de áudio ao seu computador
- Abra o aplicativo web EffeTune em seu navegador, ou inicie o aplicativo desktop EffeTune
- Selecione sua interface de áudio como fonte de entrada e saída
   - No Chrome, na primeira vez que você abri-lo, uma caixa de diálogo aparecerá pedindo para selecionar e permitir a entrada de áudio
   - Abra Configuração de Áudio no menu Configurações para escolher os dispositivos de entrada e saída e o formato de áudio
- Sua interface de áudio agora funciona como um processador de múltiplos efeitos:
   * Entrada: Seu CD player, player de rede ou outra fonte de áudio
   * Processamento: Efeitos em tempo real através do EffeTune
   * Saída: Áudio processado para seu amplificador ou alto-falantes

## Uso

O aplicativo desktop abre com a janela maximizada na primeira execução. Nas próximas vezes, restaura o tamanho, a posição e o estado de maximização anteriores da janela.

Ao abrir o aplicativo pela primeira vez, um breve tour mostra onde reproduzir música, adicionar efeitos e ajustar o som. Você pode revê-lo a qualquer momento com **Conhecer o aplicativo** no menu de configurações, no menu **Ajuda** do aplicativo desktop ou pelo botão de menu no celular.

### Construindo Sua Cadeia de Efeitos

1. Os **Available Effects** estão listados no lado esquerdo da tela
   - Use o botão de busca ao lado de **Available Effects** para filtrar os efeitos
   - Digite qualquer texto para encontrar efeitos por nome ou categoria
   - Pressione ESC para limpar a busca
2. Arraste os efeitos da lista para a área **Effect Pipeline**
   - No celular, abra a aba **Efeitos** e toque no botão **+** para adicionar efeitos pela lista em tela cheia
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
10. Clique no botão Predefinições de efeito de cada efeito para salvar ou aplicar configurações apenas desse efeito

Clique no cadeado ao lado de × para bloquear ou desbloquear as configurações do efeito. Enquanto estiver bloqueado, não será possível alterar seus parâmetros, restaurar os valores padrão, aplicar predefinições ou modificar o roteamento. O processamento de áudio, ON/OFF, a reordenação, o recolhimento e a remoção continuam disponíveis. Os estados recolhido e bloqueado são salvos e restaurados com a cadeia de efeitos, incluindo suas predefinições e a última sessão. O cadeado fica amarelo quando as configurações estão bloqueadas e pisca ao tentar alterá-las. Você pode continuar consultando os valores dos gráficos e alternando entre as abas.

### Procurando música na Biblioteca de música

Você pode organizar os arquivos de música armazenados no seu dispositivo em uma biblioteca.

1. No PC, abra pelo botão **Biblioteca de música** no cabeçalho; no celular, pela aba **Biblioteca**; no aplicativo desktop, por **Visualizar > Biblioteca de música**.
2. Selecione **Adicionar pasta de música** para indexar uma pasta com arquivos de música. Folhas CUE externas podem dividir arquivos de álbum WAV ou FLAC da mesma pasta em faixas individuais.
3. Navegue por **Faixas**, **Álbuns**, **Artistas**, **Gêneros**, **Subpastas**, **Pastas**, **Adicionadas recentemente** ou **Playlists**, e use **Pesquisar na biblioteca** para filtrar sua coleção.
4. Use **Reproduzir** para ouvir pela cadeia de efeitos atual, ou use **Reproduzir a seguir**, **Adicionar à fila** e **Adicionar à playlist** para gerenciar a reprodução.
5. Use **Reescanear** depois de modificar arquivos e **Reconectar** se uma permissão do navegador ou da pasta for perdida.
   - [Mais sobre a Biblioteca de música](music-library.md)

### Visualizer

Você pode apreciar visualizações baseadas na música que está tocando.

Abra **Visualizer** pelo cabeçalho no PC, pela aba **Player** no celular ou pelo menu **Visualizar** do aplicativo desktop. Escolha um layout incluído ou selecione **Edit** para organizar gráficos de áudio, capa e informações da faixa. As mudanças valem na hora e voltam na próxima abertura; use o diálogo de predefinições para salvar uma cópia com nome. Passe o ponteiro sobre a exibição ou toque nela e selecione **⛶** para ocupar toda a janela do aplicativo. Consulte o [guia do Visualizer](visualizer.md) para edição, efeitos e opções de exibição.

### Usando predefinições

Você pode salvar e carregar as cadeias de efeitos que criar.

Clique no botão **Predefinições de cadeia de efeitos** no cabeçalho do Effect Pipeline para abrir a caixa de diálogo de predefinições.

1. Carregue uma predefinição selecionando-a na lista de predefinições salvas. Isso restaura a cadeia de efeitos completa, incluindo a ordem dos efeitos, as configurações e os estados ON/OFF.
2. Salve a cadeia de efeitos atual digitando um nome e selecionando **Salvar**.
3. Renomeie uma predefinição salva com o botão de renomear dela.
4. Selecione uma ou mais predefinições salvas, escolha **Excluir selecionados** e confirme para removê-las.
5. Pressione Ctrl+S (ou Cmd+S no macOS) para abrir a caixa de diálogo com o nome da predefinição atual pronto para edição.

Cada efeito também tem seu próprio botão **Predefinições de efeito**. Ele abre as predefinições do sistema quando o efeito as oferece e permite salvar, renomear, carregar ou remover suas próprias configurações desse efeito. As predefinições de efeito alteram apenas os parâmetros desse efeito; não alteram seu estado ON/OFF nem o roteamento.

Os recursos existentes de importação, exportação e compartilhamento de arquivos `.effetune_preset` continuam usando predefinições da cadeia de efeitos completa.

### Controles comuns dos efeitos

- Para ajustar um controle deslizante com precisão, mantenha a tecla Shift pressionada enquanto o arrasta; o valor muda uma unidade mínima de cada vez
   - Nos controles deslizantes que aceitam valores negativos e positivos, o preenchimento vai de 0 até o valor atual. Os controles Ratio usam 1.0 como ponto de partida.
- Nos gráficos de frequência e de notas compatíveis, arraste ao longo do eixo do gráfico para ouvir a frequência selecionada através da cadeia de efeitos. Em **Configuração > Geral > Som de prévia da frequência**, escolha **Onda senoidal** (padrão, -12 dB) ou **Ruído de banda limitada**, que reproduz um ruído centrado nessa frequência. Note Spectrogram, Pitch Meter, Chroma Spiral e os teclados de piano sempre usam uma onda senoidal. Os teclados de piano se ajustam ao semitom mais próximo; ao arrastar sobre uma tecla, você ouve a nota dessa tecla

[Controlar parâmetros de efeitos por MIDI, gamepads ou teclado](controller-mapping.md)

### Usando a Funcionalidade Section

Você pode agrupar vários efeitos e controlá-los em conjunto.

1. Uso do Efeito Section:
   - Adicione um efeito Section no início de um grupo de efeitos
   - Digite um nome descritivo no campo Comment
   - Alternar o Section ON/OFF coloca essa seção em bypass ou a restaura, preservando o estado ON/OFF próprio de cada efeito
   - Use múltiplos efeitos Section para organizar sua cadeia de efeitos em grupos lógicos
   - [Mais sobre efeitos de controle](plugins/control.md)

### Usando Recursos de Pipeline AB

Você pode alternar entre duas cadeias de efeitos para comparar como elas soam.

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

4. Teste duplo-cego:
   - Compare o Pipeline A e o Pipeline B sem saber qual deles está sendo reproduzido
   - Faça um teste ABX para verificar se você realmente consegue distinguir os dois pipelines, ou um teste de preferência A/B para descobrir qual prefere, com verificação de significância estatística
   - Abra pelo menu de pipeline ▼ à direita do botão de alternância AB (no aplicativo desktop, também está disponível no menu Arquivo)
   - [Mais sobre o Teste duplo-cego](double-blind-test.md)

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

Você pode aplicar a cadeia de efeitos a arquivos de música e salvar o áudio processado em novos arquivos.

1. Área de Soltar ou Especificar Arquivos:
   - Uma área dedicada para soltar arquivos está sempre visível abaixo da área **Effect Pipeline**
   - Suporta um ou múltiplos arquivos de áudio
   - Os arquivos são processados usando as configurações da cadeia atual
   - Os efeitos são processados na taxa de amostragem da cadeia; a conversão da saída é feita depois

2. Status do Processamento:
   - A barra de progresso mostra o status atual do processamento
   - O tempo de processamento depende do tamanho do arquivo e da complexidade da cadeia de efeitos

3. Opções de Download ou Salvamento:
   - Em **Configurações > Configuração > Saída de arquivo offline**, escolha WAV ou FLAC, além da taxa de amostragem e da qualidade. No FLAC, escolha codificação sem perdas de 16 ou 24 bits. O valor inicial é WAV a 96 kHz com PCM de 24 bits
   - Cada formato tem um limite de canais diferente. Se o arquivo ultrapassar o limite escolhido, o EffeTune para e mostra como resolver, sem mixar os canais automaticamente
   - Para vários arquivos, selecione uma pasta de saída antes do processamento; cada arquivo é salvo diretamente nessa pasta ao ser concluído
   - Em navegadores mais antigos sem suporte à seleção de pasta, vários arquivos são empacotados em um ZIP para download

### Compartilhando Cadeias de Efeitos

Você pode compartilhar a configuração da sua cadeia de efeitos com outros usuários.
1. Após configurar sua cadeia de efeitos desejada, clique no botão "Compartilhar" no canto superior direito da área **Effect Pipeline**
2. A URL do aplicativo web será copiada automaticamente para sua área de transferência
3. Compartilhe a URL copiada com outros – eles poderão recriar exatamente sua cadeia de efeitos ao abri-la
4. As URLs compartilhadas armazenam as configurações de efeitos necessárias para a reprodução; o aplicativo web também restaura seu estado normal de trabalho a partir do armazenamento do navegador
5. Na versão do aplicativo desktop, exporte as configurações para um arquivo `.effetune_preset` a partir do menu Arquivo
6. Compartilhe o arquivo `.effetune_preset` exportado. O arquivo `.effetune_preset` também pode ser carregado arrastando-o para a janela do aplicativo web

### Backup e restauração dos dados salvos

Abra **Configurações > Backup / Restaurar** para transferir predefinições de pipeline, predefinições de efeitos, respostas ao impulso e medições salvas entre o aplicativo web, o aplicativo desktop e a extensão do navegador. Nos aplicativos web e desktop, as predefinições do Visualizer com nome também podem ser incluídas. Ao selecionar uma predefinição, os dados de medição ou de resposta ao impulso que ela usa são selecionados automaticamente.

**Incluir dados de medição** e **Incluir dados de resposta ao impulso** ficam ativados por padrão para que os backups sejam autossuficientes. Desative uma dessas opções somente quando o destino já tiver os arquivos de medição ou de resposta ao impulso correspondentes. As respostas ao impulso restauradas são adicionadas à **Biblioteca de respostas ao impulso** do EffeTune. Restaurar um backup não altera o pipeline atual, o volume, a predefinição selecionada, as configurações de dispositivos, a Biblioteca de música nem as regras de URL da extensão. Cada arquivo `.effetune_backup` suporta até 256 MB; se necessário, divida backups maiores em arquivos separados. Se a restauração for interrompida, os itens concluídos são mantidos e você pode restaurar o mesmo arquivo novamente com segurança.

Antes de compartilhar um backup, revise a seleção: ele pode conter nomes e comentários de predefinições, arquivos originais de resposta ao impulso e detalhes das medições. Arquivos de música, dados da Biblioteca de música, preferências do aplicativo, escolhas de dispositivos, regras de URL, credenciais e um pipeline atual não salvo não são incluídos.

### Configurações do Aplicativo

Abra **Configurações > Configuração...** para escolher o **Idioma**, definir **Visualização ao iniciar:** (`Effect Pipeline (padrão)`, `Biblioteca de música` ou `Visualizer`), configurar **Pipeline de efeitos na inicialização:** e selecionar um **Tema** (`Graphite`, `Paper`, `Midnight`, `Ember` ou `Mint`). Quando **Visualização ao iniciar:** está definida como **Biblioteca de música**, você também pode escolher qual categoria da biblioteca abre primeiro. No aplicativo desktop, você também pode selecionar **Browser** como visualização ao iniciar.

Em **Colunas da cadeia de efeitos**, escolha **Manual** para ajustar o número de colunas com os botões +/−, ou **Automático** (padrão) para que as colunas e a lista de efeitos caibam na largura da janela. O modo automático ajusta o número de colunas quando você redimensiona a janela.

A edição da Microsoft Store recebe atualizações pela Microsoft Store. Em **Configurações > Configuração...**, use **Abrir as atualizações da Microsoft Store** para verificar atualizações e **Abrir as configurações de inicialização do Windows** para escolher se o EffeTune inicia automaticamente. Esta edição salva suas configurações e os logins do Browser separadamente das outras edições desktop.

### Medição acústica

Meça seu sistema de áudio com um microfone para verificar a resposta em frequência, a resposta ao impulso, a distorção e o decaimento, e crie um EQ de correção que pode ser importado no EffeTune; consulte [Medição acústica](measurement.md) e o [guia do Pipeline Analyzer](pipeline-analyzer.md).

### Reset de Áudio

Se você estiver enfrentando problemas de áudio (interrupções, falhas):
1. Escolha **Redefinir Áudio** no menu **Configurações** ou no menu adicional no celular. No aplicativo desktop, você também pode selecionar **Recarregar** no menu **Visualizar**
2. O pipeline de áudio será reconstruído automaticamente
3. A configuração da sua cadeia de efeitos será preservada

### Música em rede e controle remoto

**Aplicativo de desktop:** Explore servidores de música da rede local, compartilhe pastas selecionadas e reproduza neste dispositivo ou em um reprodutor OpenHome. Após o pareamento, os efeitos de um reprodutor EffeTune podem ser editados na mesma janela. O compartilhamento e o acesso por controle remoto começam desativados. Consulte [música em rede e controle remoto](openhome.md). Você também pode ativar a recepção UPnP AV / DLNA e AirPlay para ouvir músicas enviadas por outros dispositivos com os efeitos deste computador.

A PWA também pode reproduzir músicas compartilhadas de um computador EffeTune cadastrado com os efeitos deste dispositivo ou controlar outro computador cadastrado. Consulte [configuração e reprodução pela PWA](openhome.md#pwa) para conhecer os requisitos de navegador e conexão.

### Controlar o EffeTune com um assistente de IA (MCP)

Você pode pedir ao Codex ou ao Claude Code para configurar o MCP e, depois, adicionar efeitos, ajustar seus parâmetros e carregar ou salvar presets no EffeTune para desktop. Use um agente que possa executar comandos no seu computador.

1. No EffeTune para desktop, abra **Configurações > Controle remoto...**, ative **Permitir controle remoto** e clique em **Copiar link**.
2. Envie o texto abaixo ao agente de IA, substituindo o campo indicado pelo link copiado:

```text
Configure o EffeTune MCP seguindo o guia oficial:
https://github.com/Frieve-A/effetune/blob/main/mcp/README.md
Link de conexão: <cole aqui o link copiado>
```

Após a configuração, reinicie o cliente se for orientado a fazê-lo e experimente pedir: "Mostre meus efeitos atuais". Mantenha o link de conexão privado; se clicar em **Novo token** ou mudar a porta, refaça a configuração com o novo link.

Adicione músicas à Music Library do EffeTune conectado e peça: "Toque [música]". O assistente procura primeiro na biblioteca desse EffeTune e reproduz no player dele por padrão; não é preciso compartilhar a pasta de músicas para isso. Para usar outra biblioteca ou outro reprodutor, especifique: "Encontre [música] em [biblioteca] e reproduza no [reprodutor]". Se a música estiver em outro computador com EffeTune, compartilhe a pasta nele primeiro.

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

Se tiver algum problema, consulte [Solução de Problemas e FAQ](faq.md).
Se o problema continuar, reporte em [GitHub Issues](https://github.com/Frieve-A/effetune/issues).

## Efeitos Disponíveis

| Categoria | Efeito             | Descrição                                                               | Documentação                                         |
| --------- | ------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| Analyzer  | Analog Meter       | Mostra o nível dos canais em um medidor de agulha com escalas de VU, PPM, pico e loudness | [Detalhes](plugins/analyzer.md#analog-meter)         |
| Analyzer  | Chroma Spiral      | Mostra os componentes de frequência por nota e oitava em uma espiral    | [Detalhes](plugins/analyzer.md#chroma-spiral)        |
| Analyzer  | Level Meter        | Exibe o nível de áudio com retenção de pico                             | [Detalhes](plugins/analyzer.md#level-meter)          |
| Analyzer  | Note Spectrogram | Mostra as alturas estimadas ao longo do tempo em um piano roll         | [Detalhes](plugins/analyzer.md#note-spectrogram) |
| Analyzer  | Oscilloscope       | Visualização de forma de onda em tempo real                             | [Detalhes](plugins/analyzer.md#oscilloscope)         |
| Analyzer  | Pitch Meter | Acompanha uma frequência fundamental e sua afinação ao longo do tempo | [Detalhes](plugins/analyzer.md#pitch-meter) |
| Analyzer  | Rhythm Analyzer | Mostra o andamento, os toques tempo a tempo, e o quanto cada parte se adianta ou se atrasa | [Detalhes](plugins/analyzer.md#rhythm-analyzer) |
| Analyzer  | Spectrogram        | Exibe variações do espectro de frequências ao longo do tempo            | [Detalhes](plugins/analyzer.md#spectrogram)          |
| Analyzer  | Spectrum Analyzer  | Mostra a força dos graves, médios e agudos em tempo real                | [Detalhes](plugins/analyzer.md#spectrum-analyzer)    |
| Analyzer  | Stereo Meter       | Visualiza o equilíbrio estéreo e a correlação entre canais              | [Detalhes](plugins/analyzer.md#stereo-meter)         |
| Basics    | Bass Management    | Redireciona as baixas frequências para um ou mais subwoofers e soma o LFE aos graves dos canais principais | [Detalhes](plugins/basics.md#bass-management) |
| Basics    | Channel Divider    | Divide o sinal estéreo em bandas de frequência e roteia cada banda para pares de saída estéreo separados | [Detalhes](plugins/basics.md#channel-divider)       |
| Basics    | DC Offset          | Ajuste de deslocamento DC                                               | [Detalhes](plugins/basics.md#dc-offset)              |
| Basics    | FIR Crossover      | Crossover FIR que encaminha bandas de separação acentuada para pares de saídas estéreo | [Detalhes](plugins/basics.md#fir-crossover) |
| Basics    | Matrix             | Encaminha e mistura canais de áudio com controle flexível               | [Detalhes](plugins/basics.md#matrix)                 |
| Basics    | MultiChannel Panel | Painel de controle para múltiplos canais com volume, mudo, solo e atraso | [Detalhes](plugins/basics.md#multichannel-panel)     |
| Basics    | Mute               | Silencia completamente o sinal de áudio                                 | [Detalhes](plugins/basics.md#mute)                   |
| Basics    | Polarity Inversion | Inversão de polaridade do sinal                                         | [Detalhes](plugins/basics.md#polarity-inversion)     |
| Basics    | Stereo Balance     | Controle de equilíbrio dos canais estéreo                               | [Detalhes](plugins/basics.md#stereo-balance)         |
| Basics    | Volume             | Controle básico de volume                                               | [Detalhes](plugins/basics.md#volume)                 |
| Delay     | Delay | Efeito de atraso padrão | [Detalhes](plugins/delay.md#delay) |
| Delay     | Time Alignment | Ajusta finamente o tempo de reprodução para alinhar caixas e posição de escuta | [Detalhes](plugins/delay.md#time-alignment) |
| Dynamics  | Attack Tonal Balance | Equilibra ataques curtos e estrutura tonal sustentada | [Detalhes](plugins/dynamics.md#attack-tonal-balance) |
| Dynamics  | Auto Leveler | Ajuste automático de volume baseado na medição LUFS para experiência de audição consistente | [Detalhes](plugins/dynamics.md#auto-leveler) |
| Dynamics  | Brickwall Limiter | Controle de picos digitais preservando a dinâmica | [Detalhes](plugins/dynamics.md#brickwall-limiter) |
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
| EQ        | 5Band FIR PEQ | Equalizador paramétrico de 5 bandas com filtragem FIR Minimum Phase ou Linear Phase | [Detalhes](plugins/eq.md#5band-fir-peq) |
| EQ        | 5Band PEQ | Equalizador flexível de 5 bandas para moldar graves, médios e agudos | [Detalhes](plugins/eq.md#5band-peq) |
| EQ        | Band Pass Filter | Foque em frequências específicas | [Detalhes](plugins/eq.md#band-pass-filter) |
| EQ        | Comb Filter | Adiciona coloração faseada, oca ou metálica | [Detalhes](plugins/eq.md#comb-filter) |
| EQ        | Earphone Cable Sim | Ajuda a verificar como as mudanças de resposta em frequência causadas por cabos comuns de fones de ouvido costumam ser pequenas | [Detalhes](plugins/eq.md#earphone-cable-sim) |
| EQ        | Group Delay EQ | Ajusta o atraso de cada banda de frequência sem alterar o timbre | [Detalhes](plugins/eq.md#group-delay-eq) |
| EQ        | Group Delay PEQ | Controle paramétrico de cinco bandas do atraso por frequência sem alterar o timbre | [Detalhes](plugins/eq.md#group-delay-peq) |
| EQ        | Hi Pass Filter | Remove frequências baixas indesejadas com precisão | [Detalhes](plugins/eq.md#hi-pass-filter) |
| EQ        | Lo Pass Filter | Remove frequências altas indesejadas com precisão | [Detalhes](plugins/eq.md#lo-pass-filter) |
| EQ        | Loudness Equalizer | Correção de balanço de frequência para audição em baixo volume | [Detalhes](plugins/eq.md#loudness-equalizer) |
| EQ        | Narrow Range | Combinação de filtros passa-alta e passa-baixa | [Detalhes](plugins/eq.md#narrow-range) |
| EQ        | Room EQ | Correção FIR baseada em medições de sala salvas | [Detalhes](plugins/eq.md#room-eq) |
| EQ        | Tilt EQ | Equalizador tilt para modelagem rápida de tonalidade | [Detalhes](plugins/eq.md#tilt-eq) |
| EQ        | Tonal Balance EQ | Corrige automaticamente o equilíbrio tonal de longo prazo rumo a um alvo por estilo musical | [Detalhes](plugins/eq.md#tonal-balance-eq) |
| EQ        | Tone Control | Controle de tonalidade de três bandas | [Detalhes](plugins/eq.md#tone-control) |
| Lo-Fi     | AM Radio Simulator | Passa a música por uma cadeia modelada de transmissão e recepção AM | [Detalhes](plugins/lofi.md#am-radio-simulator) |
| Lo-Fi     | Bit Crusher | Redução de profundidade de bits e efeito de retenção de ordem zero | [Detalhes](plugins/lofi.md#bit-crusher) |
| Lo-Fi     | Cassette Artifacts | Grava a música em uma cassete compacta modelada e a reproduz em um deck Type I/II/IV com Dolby B/C | [Detalhes](plugins/lofi.md#cassette-artifacts) |
| Lo-Fi     | Digital Error Emulator | Simula vários erros de transmissão de áudio digital e características de equipamentos digitais vintage | [Detalhes](plugins/lofi.md#digital-error-emulator) |
| Lo-Fi     | DSD64 IMD Simulator | Simula a distorção de intermodulação audível causada pelo ruído ultrassônico do DSD64 | [Detalhes](plugins/lofi.md#dsd64-imd-simulator) |
| Lo-Fi     | FM Radio Simulator | Passa a música por uma cadeia de transmissão e recepção FM simulada fisicamente | [Detalhes](plugins/lofi.md#fm-radio-simulator) |
| Lo-Fi     | G.726 Simulator | Simula uma conversão de codificação e decodificação de voz ITU-T G.726 com um link de rádio ruidoso opcional | [Detalhes](plugins/lofi.md#g726-simulator) |
| Lo-Fi     | GSM-FR Simulator | Simula uma conversão de codificação e decodificação de voz GSM-FR a 13 kbit/s por link de rádio com ocultação de perdas de quadro | [Detalhes](plugins/lofi.md#gsm-fr-simulator) |
| Lo-Fi     | Hum Generator | Adiciona ambiência controlável de hum elétrico de 50/60 Hz para escuta vintage/lo-fi | [Detalhes](plugins/lofi.md#hum-generator) |
| Lo-Fi     | MD Simulator | Simula uma conversão de codificação e decodificação ATRAC da era MiniDisc | [Detalhes](plugins/lofi.md#md-simulator) |
| Lo-Fi     | MP3 Codec Simulator | Simula uma conversão limpa de codificação e decodificação MPEG Layer III em baixo bitrate | [Detalhes](plugins/lofi.md#mp3-codec-simulator) |
| Lo-Fi     | Noise Blender | Adiciona textura ajustável de ruído de fundo para ambiência lo-fi | [Detalhes](plugins/lofi.md#noise-blender) |
| Lo-Fi     | SBC Codec Simulator | Reproduz uma conversão de codificação e decodificação Bluetooth A2DP SBC com perda de pacotes do link e ocultação opcionais | [Detalhes](plugins/lofi.md#sbc-codec-simulator) |
| Lo-Fi     | Simple Jitter | Simulação de jitter digital | [Detalhes](plugins/lofi.md#simple-jitter) |
| Lo-Fi     | SW Radio Simulator | Passa a música por uma cadeia modelada de transmissão em onda curta, propagação ionosférica e recepção | [Detalhes](plugins/lofi.md#sw-radio-simulator) |
| Lo-Fi     | Tape Artifacts | Grava a música em uma fita de rolo modelada e a reproduz | [Detalhes](plugins/lofi.md#tape-artifacts) |
| Lo-Fi     | TV Audio Simulator | Passa a música por caminhos de áudio modelados de TV analógica e NICAM | [Detalhes](plugins/lofi.md#tv-audio-simulator) |
| Lo-Fi     | Vinyl Artifacts | Adiciona estalos, crackle, hiss, rumble e vazamento de ruído estéreo no estilo vinil | [Detalhes](plugins/lofi.md#vinyl-artifacts) |
| Lo-Fi     | Vinyl Simulator | Grava a entrada em um sulco modelado e a reproduz com uma agulha física simulada | [Detalhes](plugins/lofi.md#vinyl-simulator) |
| Modulation | Auto Filter | Varre um filtro ressonante com LFO ou com o envelope de amplitude | [Detalhes](plugins/modulation.md#auto-filter) |
| Modulation | Auto Pan | Move suavemente o nível de cada par estéreo pelo campo sonoro | [Detalhes](plugins/modulation.md#auto-pan) |
| Modulation | Chorus | Adiciona chorus, ensemble, flanger ou vibrato com atrasos móveis | [Detalhes](plugins/modulation.md#chorus) |
| Modulation | Doppler Distortion | Simula mudanças naturais e dinâmicas no som causadas por sutis movimentos do cone do alto-falante | [Detalhes](plugins/modulation.md#doppler-distortion) |
| Modulation | Frequency Shifter | Desloca frequências, aplica modulação em anel ou efeito barber-pole | [Detalhes](plugins/modulation.md#frequency-shifter) |
| Modulation | Phaser | Cria picos e vales móveis com varredura clássica ou barber-pole | [Detalhes](plugins/modulation.md#phaser) |
| Modulation | Pitch Shifter | Sobe ou desce o pitch da música sem mudar o tempo | [Detalhes](plugins/modulation.md#pitch-shifter) |
| Modulation | Pitch Shifter HQ | Sobe ou desce o pitch com menos artefatos de fase para uma audição atenta | [Detalhes](plugins/modulation.md#pitch-shifter-hq) |
| Modulation | Rotary Speaker | Combina movimentos independentes de corneta e tambor | [Detalhes](plugins/modulation.md#rotary-speaker) |
| Modulation | Tremolo | Efeito de modulação baseado em volume | [Detalhes](plugins/modulation.md#tremolo) |
| Modulation | Wow Flutter | Adiciona uma oscilação sutil de pitch no estilo fita ou disco para caráter vintage | [Detalhes](plugins/modulation.md#wow-flutter) |
| Resonator | Adaptive Prediction | Aprende a prever o áudio para extrair o resíduo ou criar ressonâncias que evoluem | [Detalhes](plugins/resonator.md#adaptive-prediction) |
| Resonator | Horn Resonator | Simulação de ressonância de corno com dimensões personalizáveis | [Detalhes](plugins/resonator.md#horn-resonator) |
| Resonator | Horn Resonator Plus | Ressonância de alto-falante tipo corneta mais suave para coloração natural na escuta | [Detalhes](plugins/resonator.md#horn-resonator-plus) |
| Resonator | Modal Resonator | Efeito de ressonância de frequência com até 5 ressonadores | [Detalhes](plugins/resonator.md#modal-resonator) |
| Restoration | Click Remover | Repara cliques, estalos, pops e pequenas falhas | [Detalhes](plugins/restoration.md#click-remover) |
| Restoration | Clip Restorer | Restaura picos achatados por clipping intenso | [Detalhes](plugins/restoration.md#clip-restorer) |
| Restoration | Hum Remover | Remove zumbido elétrico constante e seus harmônicos | [Detalhes](plugins/restoration.md#hum-remover) |
| Restoration | Noise Reduction | Reduz ruído de fundo constante sem prejudicar a música | [Detalhes](plugins/restoration.md#noise-reduction) |
| Reverb    | Dattorro Plate Reverb | Reverb de placa clássico baseado no algoritmo Dattorro | [Detalhes](plugins/reverb.md#dattorro-plate-reverb) |
| Reverb    | FDN Reverb | Reverberação de rede de atraso com feedback que produz texturas de reverb ricas e densas | [Detalhes](plugins/reverb.md#fdn-reverb) |
| Reverb    | IR Reverb | Reverb por convolução com respostas ao impulso importadas de salas e equipamentos | [Detalhes](plugins/reverb.md#ir-reverb) |
| Reverb    | RS Reverb | Reverberação por espalhamento randômico com difusão natural | [Detalhes](plugins/reverb.md#rs-reverb) |
| Saturation| Bandwidth Extender | Gera conteúdo de alta frequência acima de um corte detectado ou especificado | [Detalhes](plugins/saturation.md#bandwidth-extender) |
| Saturation| Bass Extender | Gera graves uma oitava abaixo de conteúdo adequado | [Detalhes](plugins/saturation.md#bass-extender) |
| Saturation| Dynamic Saturation | Simula o deslocamento não linear de cones de alto-falantes | [Detalhes](plugins/saturation.md#dynamic-saturation) |
| Saturation| Exciter | Adiciona conteúdo harmônico para melhorar clareza e presença | [Detalhes](plugins/saturation.md#exciter) |
| Saturation| Hard Clipping | Efeito de hard clipping digital | [Detalhes](plugins/saturation.md#hard-clipping) |
| Saturation | Harmonic Distortion | Adiciona caráter com distorção harmônica ajustável de 2ª a 5ª ordem | [Detalhes](plugins/saturation.md#harmonic-distortion) |
| Saturation| Multiband Saturation | Adiciona calor ou aspereza separadamente em graves, médios e agudos | [Detalhes](plugins/saturation.md#multiband-saturation) |
| Saturation| Saturation | Adiciona riqueza e caráter quentes no estilo analógico | [Detalhes](plugins/saturation.md#saturation) |
| Saturation| Sub Synth | Mistura um sinal filtrado de baixa frequência para reforçar os graves | [Detalhes](plugins/saturation.md#sub-synth) |
| Saturation| Tube Simulator | Modela estágios de linha valvulados e amplificadores de potência push-pull ou tríodo single-ended 300B/2A3 | [Detalhes](plugins/saturation.md#tube-simulator) |
| Spatial   | Crossfeed Filter | Filtro de crossfeed para fones de ouvido para imagem estéreo natural | [Detalhes](plugins/spatial.md#crossfeed-filter) |
| Spatial   | Crosstalk Cancellation | Usa medições junto aos ouvidos para reduzir a diafonia entre alto-falantes estéreo | [Detalhes](plugins/spatial.md#crosstalk-cancellation) |
| Spatial   | MS Matrix | Converte entre estéreo e Mid/Side para ajustes de centro e ambiência | [Detalhes](plugins/spatial.md#ms-matrix) |
| Spatial   | Multiband Balance | Controle de balanço estéreo dependente de frequência de 5 bandas | [Detalhes](plugins/spatial.md#multiband-balance) |
| Spatial   | Phase Select EQ | Realça ou atenua componentes de frequência conforme a diferença de fase L/R e Balance | [Detalhes](plugins/spatial.md#phase-select-eq) |
| Spatial   | Spatial Mapper | Separa o som Direct, Diffuse e Residual para roteamento multicanal flexível | [Detalhes](plugins/spatial.md#spatial-mapper) |
| Spatial   | Stereo Blend | Controla a largura estéreo, do estéreo com polaridade invertida, passando pelo mono, até o estéreo ampliado | [Detalhes](plugins/spatial.md#stereo-blend) |
| Others    | Oscillator | Gerador de tons de teste e ruído para verificar alto-falantes/fones | [Detalhes](plugins/others.md#oscillator) |
| Others    | SFZ Note Player | Toca um instrumento SFZ importado a partir das notas detectadas | [Detalhes](plugins/others.md#sfz-note-player) |
| Control   | Section | Agrupa efeitos para que uma seção inteira possa ser colocada em bypass ou restaurada | [Detalhes](plugins/control.md) |

## Informações Técnicas

### Compatibilidade de Navegador

Frieve EffeTune foi testado e verificado para funcionar no Google Chrome. O aplicativo requer um navegador moderno com suporte para:
- Web Audio API
- Audio Worklet
- getUserMedia API
- Drag and Drop API
- Service Worker, para suporte a aplicativo web instalável e uso offline

### Detalhes de Suporte do Navegador
1. Chrome/Chromium
   - Totalmente suportado e recomendado
   - Atualize para a versão mais recente para melhor desempenho

2. Firefox/Safari
   - Suporte limitado
   - Alguns recursos, como seleção do dispositivo de saída, Wake Lock, comportamento de instalação ou formatos de áudio compatíveis, podem variar conforme o navegador
   - Considere usar o Chrome para a melhor experiência

### Taxa de Amostragem Recomendada

Defina a **Taxa de Amostragem** do EffeTune como 96 kHz. Isso reduz o aliasing audível gerado por efeitos não lineares, como a saturação. Essa configuração controla a taxa de processamento interna do EffeTune e funciona de forma independente da taxa de amostragem do sistema operacional, da interface de áudio ou do dispositivo de áudio virtual. Confira a taxa de amostragem efetiva exibida no aplicativo: até você salvar uma configuração, ela pode seguir o padrão do sistema operacional ou do navegador, e o aplicativo web pode usar outra taxa se 96 kHz não estiver disponível. Se houver cortes na reprodução, primeiro desative os efeitos mais exigentes ou encurte a cadeia; reduza a taxa de amostragem somente se necessário.

## Guia de Desenvolvimento

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Frieve-A/effetune)

Quer criar seus próprios plugins de áudio? Confira nosso [guia de desenvolvimento de plugins](../../plugin-development.md).

## Biblioteca DSP

O mecanismo DSP do EffeTune também é uma biblioteca independente, determinística e com licença MIT para Python, JavaScript e AudioWorklets do navegador. Seu esquema Chain público e o catálogo de efeitos gerado automaticamente podem ser usados sem o aplicativo EffeTune. Consulte a [documentação da EffeTune DSP Library](https://effetune.frieve.com/dsp/).

Use os guias de início rápido de cada pacote para ver a instalação e exemplos completos prontos para executar:

- [Pacote Python](https://effetune.frieve.com/dsp/getting-started/python/)
- [Pacote JavaScript e AudioWorklet](https://effetune.frieve.com/dsp/getting-started/javascript/)

O [guia da DSP Library](https://effetune.frieve.com/dsp/) aborda os efeitos, os esquemas, o comportamento do processamento e os recursos necessários.

## Links

[Histórico de versões](../../version-history.md)

[Código-fonte](https://github.com/Frieve-A/effetune)

[YouTube](https://www.youtube.com/@frieveamusic)

[Discord](https://discord.gg/gf95v3Gza2)

[Apoie no Ko-fi](https://ko-fi.com/frievea)
