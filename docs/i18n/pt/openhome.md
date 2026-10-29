---
title: "Música em rede e controle remoto (aplicativo desktop) - EffeTune"
description: "Reproduza música da rede com o EffeTune, receba áudio OpenHome, UPnP AV / DLNA e AirPlay, compartilhe músicas e controle a reprodução na rede local."
lang: pt
---

# Música em rede e controle remoto (aplicativo desktop)

O aplicativo desktop pode receber música de outros dispositivos na rede local e aplicar seus efeitos do EffeTune. A recepção por OpenHome, UPnP AV / DLNA e AirPlay tem configurações independentes, todas desativadas inicialmente. Ative apenas os métodos que usa em **Configurações > Configuração... > Rede**.

## Receber música pelo OpenHome

Nas compilações desktop compatíveis (Windows x64, macOS Intel/Apple silicon e Linux x64), o EffeTune pode aparecer como um player OpenHome para aplicativos controladores na mesma rede local. Abra **Configurações > Configuração... > Rede**, ative **Permitir controladores OpenHome nesta rede** (desativado por padrão) e aguarde até o status indicar que o EffeTune está disponível.

**Nome do dispositivo**, em **Rede**, define o nome do reprodutor de rede, do receptor AirPlay e da biblioteca compartilhada. Por padrão, é usado o nome deste computador. Digite um nome personalizado, como `Living Room`, ou deixe o campo vazio para voltar a usar o nome do computador. UPnP AV / DLNA aparece como um destino separado com um sufixo curto; ambos os destinos usam o mesmo reprodutor do EffeTune.

O OpenHome não exige login. Enquanto estiver ativado, outros dispositivos na rede local poderão ver os metadados de reprodução, editar a fila do player e controlar a reprodução. Se o Firewall do Windows solicitar permissão, permita o EffeTune apenas em **Redes privadas**, não em **Redes públicas**. Desative a opção quando o controle remoto não for necessário.

Os controladores podem adicionar fluxos de áudio HTTP ou HTTPS, gerenciar a fila de reprodução remota e controlar reprodução, pausa, parada, avanço de faixa, busca, repetição e modo aleatório. O áudio remoto passa pelo pipeline de efeitos ativo do EffeTune normalmente. O controle básico de fila e reprodução por OpenHome foi verificado com o BubbleUPnP no Android; outros aplicativos OpenHome podem exibir os serviços de forma diferente. O destino OpenHome oferece uma fonte OpenHome Playlist e não expõe edição de efeitos, caminhos de arquivos locais, volume mestre, Radio, Songcast ou sincronização multiroom via OpenHome. Também é possível ajustar o volume do reprodutor e silenciá-lo. Esse volume é compartilhado pela reprodução local e UPnP AV; não altera o volume do computador nem os efeitos.

A reprodução sem intervalos não é garantida, e os metadados técnicos podem permanecer desconhecidos até que a fonte os forneça. Após suspensão, retomada, conexão de VPN ou mudanças de rede, o player pode desaparecer brevemente enquanto se reconecta.

## Receber música por UPnP AV / DLNA

Ative **Permitir reprodução UPnP AV / DLNA nesta rede** em **Configurações > Configuração... > Rede**. No aplicativo controlador, escolha o destino UPnP AV / DLNA do EffeTune e uma música de um servidor acessível pelo computador. A permissão OpenHome é independente e não precisa estar ativada.

Esse destino recebe MP3, FLAC, WAV em PCM e AAC (ADTS ou MP4/M4A) por HTTP ou HTTPS. Também são compatíveis Ogg (Vorbis/Opus/FLAC), WebM (Vorbis/Opus) e áudio Matroska (PCM/FLAC/MP3/Opus/Vorbis/AAC). Mesmo em um tipo de arquivo compatível, o codec interno também precisa ser compatível; ALAC não é compatível.

Os controladores podem reproduzir, pausar, parar, mudar de faixa, avançar na música quando a fonte permitir e ajustar o volume ou silenciar o reprodutor. Esse volume também afeta a música local e OpenHome, sem mudar o volume do computador nem os efeitos. Escolher uma nova faixa substitui a fila atual por essa única faixa. O controlador e o EffeTune mostram o mesmo estado de reprodução. Quando fornecidas pelo servidor de música, as tags e as informações do áudio de origem também ficam disponíveis no item **Informações da faixa** do Visualizer.

Use uma rede local confiável: os controladores habilitados podem alterar a reprodução sem fazer login. Permita o acesso a redes privadas se o firewall solicitar. O áudio não é convertido, e a compatibilidade depende do controlador e da fonte. Trata-se de um receptor de áudio, sem garantia de certificação DLNA, reprodução de vídeo ou suporte a todos os formatos DLNA.

## Receber áudio por AirPlay

Ative **Permitir áudio AirPlay nesta rede** em **Configurações > Configuração... > Rede** e selecione o **Nome do dispositivo** na lista de saídas de áudio AirPlay do emissor. O status indica quando o receptor está disponível ou recebendo áudio. Mantenha o EffeTune aberto e os dois dispositivos na mesma rede local confiável. Qualquer dispositivo que consiga acessar o receptor ativado pode enviar áudio sem fazer login.

O AirPlay recebe áudio estéreo de um emissor por vez. Inicie ou pare a reprodução e ajuste o volume no emissor. Os ajustes locais e UPnP AV de volume e silêncio se aplicam apenas à reprodução de arquivos e URLs. Quando o áudio AirPlay estiver pronto, ele substitui a música em reprodução. Iniciar música local, OpenHome ou UPnP AV encerra a recepção AirPlay. Encerrar o AirPlay não retoma automaticamente a faixa anterior. Fechar o Player do EffeTune com **×**, ou usar **Parar**, encerra a sessão AirPlay atual; o receptor continua ativado e disponível para uma nova conexão.

Quando o dispositivo de origem fornece os dados, o Player mostra título, artista, capa e tempo de reprodução. Passe o ponteiro sobre o título para ver mais informações, como álbum, compositor, gênero, comentários, dispositivo de origem e formato de áudio. Os dados disponíveis dependem do aplicativo de origem e do conteúdo; o tempo é atualizado quando informado pelo dispositivo. Você também pode exibi-los no [Visualizer](visualizer.md).

**Áudio recebido** identifica o codec AirPlay, como ALAC ou AAC-ELD. **PCM do receptor** descreve o áudio recebido pelo EffeTune para processamento: estéreo de 44.1 kHz e 16 bits. Esses valores não descrevem a qualidade do arquivo de música original. Quando disponível, **Volume na origem** mostra a posição do controle de volume do dispositivo de origem como uma porcentagem somente para leitura; ajuste o volume nesse dispositivo.

O armazenamento em buffer da rede e os efeitos do EffeTune acrescentam atraso, portanto o som pode ficar atrás do vídeo. Recursos do AirPlay 2, sincronização multiroom, espelhamento de tela, vídeo e conteúdo protegido não são compatíveis. A compatibilidade pode variar conforme o dispositivo e o aplicativo emissor.

A descoberta AirPlay exige Bonjour no Windows e macOS, ou um serviço Avahi / DNS-SD ativo no Linux. O instalador padrão do Windows fornece o serviço de descoberta quando necessário; as versões portátil e Microsoft Store exigem que ele já esteja instalado. No Linux, instale o serviço Avahi / DNS-SD da distribuição e ative-o com as ferramentas normais de gerenciamento de serviços. Se o receptor estiver indisponível, confira esses requisitos e o acesso a redes privadas no firewall antes de tentar novamente. Wi-Fi de convidados, VPNs ou isolamento de rede podem impedir que os dispositivos se encontrem.

## Escolher uma biblioteca e um reprodutor

No aplicativo de desktop, use **Library** em Music Library para selecionar **This device** ou um servidor de música da rede local. As bibliotecas compartilhadas do EffeTune oferecem as categorias habituais, a busca e a ordenação descritas no [guia da Music Library](music-library.md). Outros servidores de música mostram as categorias e a estrutura de pastas que disponibilizam; a busca e a ordenação só ficam disponíveis quando o servidor oferece suporte.

Use o seletor no topo da janela para escolher **This device**, um reprodutor OpenHome ou um UPnP AV / DLNA. A biblioteca e o destino são independentes. Trocar de reprodutor não para o anterior nem move sua fila. São exibidos faixa, fila, posição e controles compatíveis, incluindo **Volume** e **Silenciar** quando disponíveis. Alterações de outros controladores também aparecem.

Reprodutores OpenHome mantêm sua própria fila. Em um reprodutor UPnP AV / DLNA sem fila OpenHome, o computador com EffeTune gerencia a sequência escolhida e envia a próxima faixa após o término normal da anterior. Mantenha esse computador e a fonte ligados. Trocar de destino não move essa sequência. Se outro controlador substituir a música, o avanço automático termina; após uma desconexão, selecione as músicas novamente. A reprodução sem intervalos não é garantida.

Você também pode adicionar um [servidor Subsonic / OpenSubsonic](music-library.md#subsonic).

## Compartilhar pastas de música

Abra **Configurações > Configuração... > Rede**. Em **Compartilhamento da biblioteca**, selecione as pastas, ative **Compartilhar as pastas selecionadas nesta rede** e clique em **Salvar**. Se nenhuma pasta aparecer, adicione-as primeiro à Music Library. O compartilhamento começa desativado e publica somente as pastas cadastradas que você selecionar. Dispositivos da mesma rede podem explorar e reproduzir as músicas sem fazer login. Desative o compartilhamento ou desmarque uma pasta e clique em **Salvar** para revogar o acesso. Mantenha o EffeTune aberto no computador que contém os arquivos.

Para reproduzir arquivos locais individuais sem ativar o compartilhamento da biblioteca, escolha outro reprodutor e use **Open music files**. O EffeTune disponibiliza apenas os arquivos selecionados para esse reprodutor; mantenha o aplicativo aberto no computador de origem.

O áudio enviado é o original, sem os efeitos do computador de origem. Um destino EffeTune aplica seus próprios efeitos. O servidor e o reprodutor precisam se comunicar. A fila própria do OpenHome pode continuar após desconectar o controlador; uma sequência gerenciada pelo EffeTune ou uma conexão intermediada por um computador EffeTune exige que esse computador permaneça ligado.

## Editar os efeitos do reprodutor selecionado (aplicativo de desktop)

Selecione um reprodutor EffeTune e abra **Effect Pipeline**. Antes da primeira conexão, ative **Permitir controle remoto** nesse reprodutor em **Configurações > Configuração... > Rede** ou **Configurações > Controle remoto...**. Escolha **Connect effects** aqui e depois **Permitir** na solicitação exibida no computador do reprodutor. Não é preciso inserir um link de pareamento. A conexão autorizada fica salva e, ao selecionar esse reprodutor novamente, os efeitos se conectam automaticamente. Descobrir um dispositivo ou compartilhar sua biblioteca não autoriza a edição de efeitos.

O cabeçalho mostra o reprodutor que está sendo editado. Sua cadeia, bypass, A/B, desfazer/refazer e presets de cadeia salvos ficam disponíveis conforme os recursos oferecidos. O seletor de IR usa a biblioteca IR desse reprodutor. Salvar e excluir presets de cadeia altera esse destino. Cada efeito oferece seus presets integrados; os presets de usuário de efeitos individuais não ficam disponíveis remotamente. Operações sem suporte ficam indisponíveis. Reprodutores de outros fabricantes podem tocar música, mas não usar o editor de efeitos do EffeTune.

Na biblioteca do IR Reverb, **Enviar arquivo…** importa um arquivo IR de até 64 MiB para o reprodutor selecionado, e **Baixar** salva um IR de arquivo único no dispositivo que você está usando. Pares True Stereo podem ser selecionados, mas não transferidos. Para excluir IRs, abra a biblioteca no próprio reprodutor. As transferências só ocorrem quando você as solicita; as bibliotecas não são copiadas automaticamente entre dispositivos.

Se a conexão cair, o reprodutor continua selecionado e a edição fica desativada até reconectar. A reconexão lê as configurações atuais, sem reenviar alterações não confirmadas. Para reconectar, escolha **Change connection** e depois **Connect effects**. O botão de controle remoto continua gerenciando o acesso a este computador; os links de pareamento, o editor no navegador e as janelas remotas separadas continuam disponíveis.

<a id="pwa"></a>

## Ouvir e controlar pela PWA

A [PWA do EffeTune](https://effetune.frieve.com/effetune.html) reproduz músicas compartilhadas com os efeitos do telefone ou controla reprodução e efeitos de computadores EffeTune cadastrados. Um computador cadastrado também pode dar acesso a outros servidores e reprodutores que ele alcança. **Library** e o destino começam em **This device**. A PWA usa as conexões adicionadas; não descobre dispositivos diretamente.

1. No computador, abra **Configurações > Controle remoto...**, ative **Permitir controle remoto** e escolha **Copiar link**. Para explorar suas músicas, compartilhe também pastas pelo **Compartilhamento da biblioteca**, como explicado acima. Não é necessário permitir controladores OpenHome.
2. No seletor de dispositivos de reprodução da PWA, escolha **Add device…**. Cole o link em **Pairing link** e escolha **Connect**. Permita o acesso à rede local quando solicitado. Você pode usar **Scan QR code** quando aparecer; caso contrário, cole o link. Abrir o código QR com a câmera normal do celular abre o editor remoto separado.

Escolha o computador em **Library** para usar as mesmas nove visualizações. Mantenha **This device** como dispositivo de reprodução para ouvir com os efeitos da PWA ou escolha um computador cadastrado e abra **Effect Pipeline** para editar os efeitos dele. Para reproduzir a música do computador A no B, adicione ambos e escolha A como biblioteca e B como reprodutor. Mudar a seleção não para o reprodutor anterior nem move sua fila.

Para usar outros servidores ou reprodutores por um computador cadastrado, abra **Configurações > Configuração... > Rede > Dispositivos de rede na PWA**, ative **Permitir acessar outros servidores de música** ou **Permitir controlar outros reprodutores** e clique em **Salvar**. Depois use **Atualizar** na PWA e escolha biblioteca e reprodutor separadamente. Cadastre apenas os computadores necessários a essas conexões. Não é preciso compartilhar uma pasta local, e essas permissões não permitem editar efeitos de outros reprodutores. Desative a permissão e salve para revogá-la.

Abra **Add device…** novamente para gerenciar **Saved devices**. Se o endereço ou o código de conexão mudar, use **Update connection** com um novo link; use **Remove** para apagar o cadastro. **Refresh** atualiza a disponibilidade e as configurações de compartilhamento. Apagar os dados do navegador remove os dispositivos salvos; se o armazenamento estiver indisponível, o cadastro dura apenas a sessão atual. Computadores antigos podem oferecer **Open remote editor** em vez de reprodução pela PWA.

Use um navegador Chromium recente e permita o acesso à rede local. A compatibilidade varia; consulte as [permissões de rede local do Chrome](https://developer.chrome.com/blog/local-network-access) e o [suporte a WebSocket](https://developer.chrome.com/release-notes/147). Links HTTP não são criptografados: use-os apenas em uma rede confiável. Safari/iOS e navegadores sem suporte a HTTP local precisam de uma [configuração HTTPS confiável](../../remote-v1.md#encrypted-connections), com certificado correspondente ao endereço de conexão e reconhecido pelo navegador. As políticas do navegador ou do sistema ainda podem bloquear o acesso; ler um código QR não torna o certificado confiável.

A PWA não envia seus arquivos locais a outro reprodutor: escolha uma biblioteca de rede. Mantenha a fonte, o reprodutor e os computadores intermediários acordados e conectados. Fechar a PWA não interrompe outro computador enquanto essas conexões estiverem disponíveis. No telefone, os formatos dependem do aparelho e a reprodução pode pausar em segundo plano. Para conectar diretamente ao Subsonic, use **Library > Adicionar servidor de música…**; consulte o [guia da Music Library](music-library.md#subsonic).

## HTTPS e dispositivos não encontrados automaticamente

No desktop, abra **Configurações > Configuração... > Rede > Conexão HTTPS**. Use **Escolher certificado…** e **Escolher chave privada…**, preencha o **Endereço HTTPS**, por exemplo `https://music.example.com:47300`, e clique em **Salvar**. Sem uma porta explícita, usa-se a 443. O endereço deve alcançar diretamente este computador e corresponder ao certificado; uma VPN já configurada também pode fornecer essa conexão. Use o novo link de pareamento para adicionar ou atualizar a conexão da PWA. **Testar conexão** verifica a conexão salva sem reproduzir música. Quando variáveis de ambiente controlam a conexão, os ajustes ficam somente para leitura; veja a [configuração TLS avançada](../../remote-v1.md#encrypted-connections).

Cada navegador ou sistema precisa confiar no certificado. O EffeTune não instala autoridades certificadoras, configura rotas VPN ou encaminhamento do roteador, nem contorna restrições do navegador. Se não conectar, confira endereço, confiança no certificado e permissão de rede local. O navegador pode não informar a causa exata.

Se um dispositivo UPnP acessível não aparecer, use **Adicionar um dispositivo de rede manualmente** nos mesmos ajustes. Informe a **URL da descrição do dispositivo** e escolha **Adicionar**. Isso não torna acessíveis dispositivos isolados ou fora de alcance. Use **Remover** para remover um cadastro manual.

## Limites da reprodução em rede

A descoberta automática e o compartilhamento de pastas exigem o aplicativo de desktop. Os formatos e a busca dentro da faixa dependem do reprodutor e da fonte. O EffeTune não converte áudio de rede; um servidor Subsonic pode fornecer um fluxo convertido. Subfaixas CUE não podem ser enviadas separadamente. Reprodução sem intervalos e sincronização entre ambientes não são garantidas. Se um dispositivo desaparecer, verifique se está acordado, acessível e autorizado pelo firewall da rede privada, e atualize a lista. O compartilhamento para ao fechar o aplicativo de origem ou suspender seu computador.

[← Voltar para o README](README.md)
