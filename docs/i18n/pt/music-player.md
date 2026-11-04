---
title: "Player de música - EffeTune"
description: "Reproduza arquivos de música e vídeo pela cadeia de efeitos do EffeTune, altere a velocidade de reprodução, use o minirreprodutor e configure a reprodução sem intervalos."
lang: pt
---

# Player de música

Abra um arquivo de música no EffeTune para ouvi-lo com a cadeia de efeitos atual. Use os controles do player para pausar, retomar ou ajustar a velocidade.

## Abrir arquivos de música

- Clique em **Abrir arquivos de música** (o botão de pasta no cabeçalho) ou arraste arquivos de música para a janela.
- **Aplicativo desktop:** escolha **Arquivo > Abrir arquivo de música...** ou abra um arquivo de música com o EffeTune pelo sistema operacional.
- **Layout móvel:** toque em **Abrir música**.

Para usar apenas o player, defina **Dispositivo de Entrada:** como **Nenhum (somente player de arquivos de música)** em **Configuração de Áudio**; assim o EffeTune não usa uma entrada de áudio ao vivo.

## Arquivos DSD {#dsd-files}

Abra arquivos `.dsf` (DSF) ou `.dff` (DSDIFF) como qualquer outro arquivo de música. Arquivos DFF sem compressão e comprimidos com DST são compatíveis. O EffeTune converte DSD64, DSD128 e DSD256 mono ou estéreo em PCM para reproduzi-los com os efeitos atuais. O dispositivo de áudio recebe PCM, não DSD nativo nem DoP.

Algumas variantes de codificação DST (quadros segmentados), arquivos com mais de dois canais, DSD512 e DSD baseado em 48 kHz não são compatíveis. Se um arquivo não tocar, use um DFF sem compressão ou uma cópia PCM compatível, como FLAC ou WAV. A reprodução de DSD está disponível no aplicativo desktop e no player web/PWA, mas não no aplicativo Android nativo.

Arquivos DSD de taxa elevada exigem mais processamento, sobretudo em velocidades de reprodução maiores. Se o áudio falhar ou parar, reduza a velocidade.

## Arquivos MIDI

A reprodução de MIDI e MusicXML e a inclusão desses arquivos na biblioteca estão disponíveis no aplicativo de desktop e no player web/PWA. Não são compatíveis com o aplicativo Android.

Abra arquivos `.mid`, `.midi` ou `.kar` pelo seletor de música habitual ou arraste-os para a janela. MIDI contém notas e tempos, não áudio gravado. Adicione [**SoundFont Player**](plugins/others.md#soundfont-player) de **Others** ao Effect Pipeline e escolha um instrumento em **SoundFont Library…**. Abrir o arquivo não adiciona um instrumento automaticamente. Você também pode adicioná-lo à Music Library.
Para ver a letra em **Lyrics** no Visualizer, use a letra incorporada ao MIDI ou coloque um arquivo `.wrd` com o mesmo nome ao lado dele. Na web, selecione ou solte os dois arquivos juntos, a menos que a pasta esteja acessível pela Music Library. O `.wrd` acompanha a música e não vira outra faixa; se não puder ser lido, o MIDI continua tocando.

Para mostrar uma capa com MIDI ou MusicXML, coloque `cover.jpg` (prioritário) ou `folder.jpg` na mesma pasta. Na web, selecione ou arraste a imagem junto com o arquivo de música, a menos que a pasta esteja acessível pela Music Library.

Se o SoundFont Player estiver ausente, nenhum instrumento estiver carregado ou o carregamento ainda estiver em andamento, o player mostra orientações e continua enviando MIDI no tempo da música, em silêncio, sem pular para a próxima faixa. A música termina normalmente. Você pode adicionar o SoundFont Player ou carregar um instrumento durante a reprodução: quando estiver pronto, ele responderá aos eventos MIDI que chegarem a partir desse momento, com os sons e ajustes de controle atuais de cada canal. As notas anteriores não são tocadas novamente, mesmo que ainda estejam sustentadas na música.

Use os controles habituais de reprodução, pausa, busca, repetição, ordem aleatória, velocidade, volume e silenciamento. A velocidade altera o andamento do MIDI sem mudar a altura das notas. **Manter o tom** não pode ser alterado durante a reprodução MIDI. Com uma coleção SF2/SF3, um único SoundFont Player segue Bank Select e Program Change de forma independente nos 16 canais, usando o banco de percussão no canal 10 por padrão. Use **MIDI Mixer** para ajustar o **Patch**, o nível e os outros controles de execução de cada canal. Essas alterações são temporárias, seguem as mensagens MIDI posteriores e são reiniciadas na próxima música. Instrumentos SFZ preservam seu próprio mapeamento.

Para salvar áudio, prepare o instrumento no SoundFont Player e selecione o MIDI no processamento de arquivos offline. A música inteira é processada com o instrumento e os efeitos posteriores, em velocidade 1 e ganho unitário da música, e salva em WAV ou FLAC conforme as configurações de saída. Ao atingir o limite da cauda, o aplicativo avisa e corta o som restante.

São aceitos Standard MIDI File nos formatos 0 e 1. Converta arquivos de formato 2 ou RMID em um `.mid` padrão de formato 0 ou 1 antes de abri-los.

## Arquivos MusicXML {#musicxml-files}

Abra arquivos `.musicxml`, `.xml` ou `.mxl` compactados como arquivos MIDI. Para ouvi-los, adicione **SoundFont Player** e carregue um instrumento. Eles usam os controles MIDI descritos acima, mas a partitura não é exibida. Você também pode incluí-los na Music Library.
A letra do MusicXML pode aparecer em **Lyrics** no Visualizer durante a reprodução. Escolha **Parte** e **Verso** se houver mais de uma opção, ou mantenha **Automático**.

Notas, pausas, acordes, vozes, ligaduras de prolongamento, mudanças de andamento e repetições comuns com finais alternativos são reproduzidos. Alguns detalhes da notação, como ornamentos e notas de apojatura, não são reproduzidos. Se a partitura tiver repetições aninhadas, sinais de repetição de compassos ou notas microtonais, ou depender de D.C., D.S., Coda ou Fine, ou se o arquivo for uma coletânea opus com várias partituras, exporte-a como MIDI padrão em um aplicativo de partituras e abra o arquivo resultante.

## Controles de reprodução

- Pausar, retomar ou fechar o player com **×** aplica um fade curto para evitar estalos.
- Clique no botão de velocidade ao lado de **Aleatório** para escolher uma das nove predefinições ou definir qualquer velocidade de `0.25x` a `4x` em passos de `0.01x`. **Manter o tom** vem ativado por padrão, mantendo o tom constante quando a velocidade muda; desative-o para que o tom suba e desça com a velocidade, como em uma fita ou em um disco.
- No aplicativo desktop, escolha **Visualizar > Minirreprodutor** (`Ctrl/Cmd+Shift+M`) ou clique no botão de minirreprodutor do player para mudar para uma janela compacta. Clique no botão de fixar para mantê-la sempre no topo.

O Player de desktop também exibe [música em rede e AirPlay](openhome.md). Durante o AirPlay, as informações da faixa, a capa e o tempo aparecem quando enviados pelo dispositivo de origem; passe o ponteiro sobre o título para ver mais detalhes. Controle a reprodução e o volume no dispositivo de origem. Fechar o Player com **×**, ou usar **Parar**, encerra essa sessão, mas o receptor continua ativado e disponível para uma nova conexão.

Use o controle de volume e o botão de silenciar para ajustar o som do reprodutor antes de passar pelos efeitos. As alterações feitas remotamente também aparecem aqui, permitindo conferir o volume e desativar o silêncio no próprio dispositivo de reprodução.

## Reprodução sem intervalos

**Reprodução sem intervalos**, em **Configuração de Áudio**, vem ativada por padrão e reproduz faixas locais compatíveis sem intervalo; o suporte é limitado pelo formato do arquivo e pelo ambiente do navegador ou do aplicativo. Formatos não suportados e alguns ambientes móveis usam um modo alternativo seguro que economiza memória, por isso ainda pode haver um breve intervalo. Ao desativá-la, a prioridade passa a ser o menor uso de memória e a estabilidade, ao custo de um possível breve intervalo; a mudança não interrompe a faixa atual. A reprodução sem intervalos só funciona na velocidade 1x; mudar a velocidade durante a reprodução sem intervalos reinicia a faixa na mesma posição, com uma breve interrupção.

## Vídeo {#video}

O vídeo aparece na área da capa do player. No layout de desktop, iniciar um vídeo expande automaticamente o painel do player. Você pode recolhê-lo novamente durante a reprodução atual. Mova o ponteiro sobre o vídeo ou toque nele para mostrar o botão de expansão; ele desaparece após um breve período sem interação. Selecione **⛶** para ocupar toda a área de exibição do aplicativo; mova o ponteiro sobre o vídeo ou toque nele para mostrar os controles de reprodução na parte inferior. Você também pode adicionar um item **Video** no Visualizer. Para incluir arquivos de vídeo na Biblioteca de música, consulte o [guia da Biblioteca de música](music-library.md#availability).

No layout móvel, o vídeo expandido e seus controles giram juntos quando isso permite aproveitar melhor a tela. **Girar vídeo expandido no celular**, em **Configurações > Configuração... > Exibição**, fica ativado por padrão; desative para impedir a rotação. Ao voltar ao player pequeno, a exibição normal é restaurada. O layout de desktop e as configurações de orientação do dispositivo não mudam.

Fora do Mini Player, use estes gestos no vídeo ou nas bordas pretas ao redor dele:

- **Mouse:** Clique para reproduzir ou pausar. Clique duas vezes para expandir ou restaurar o vídeo sem alterar seu estado de reprodução ou pausa.
- **Toque:** Toque para mostrar os controles. Com o vídeo expandido, toque duas vezes na metade esquerda para voltar 10 segundos ou na metade direita para avançar 10 segundos. Tocar duas vezes na prévia pequena não muda a posição de reprodução.

Os botões e controles deslizantes continuam funcionando normalmente.

## Reprodução em outro dispositivo

Use o seletor no topo da janela para escolher **This device**, um reprodutor OpenHome ou um UPnP AV / DLNA. A biblioteca e o destino são independentes. Trocar de reprodutor não para o anterior nem move sua fila. São exibidos faixa, fila, posição e controles compatíveis, incluindo **Volume** e **Silenciar** quando disponíveis. Alterações de outros controladores também aparecem.

O áudio enviado é o original, sem os efeitos do computador de origem. Um destino EffeTune aplica seus próprios efeitos. O servidor e o reprodutor precisam se comunicar. A fila própria do OpenHome pode continuar após desconectar o controlador; uma sequência gerenciada pelo EffeTune ou uma conexão intermediada por um computador EffeTune exige que esse computador permaneça ligado.

[música em rede e controle remoto](openhome.md)

[← Voltar para o README](README.md)
