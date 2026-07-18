---
title: "Guia da Biblioteca de música - EffeTune"
description: "Aprenda a criar uma Biblioteca de música no EffeTune, navegar por subpastas e metadados, reproduzir faixas pelo Effect Pipeline e gerenciar playlists."
lang: pt
---

# Como Usar a Biblioteca de música

A versão 2.1.0 apresenta a Biblioteca de música compatível com CUE, que usa o esquema de catálogo v3. As pastas e playlists da Biblioteca anterior não são transferidas para esse catálogo; adicione novamente as pastas de música e recrie ou importe de novo as playlists. O catálogo anterior e os arquivos de áudio não são alterados.

A Biblioteca de música indexa as pastas de música selecionadas para que você possa explorar sua coleção local por faixa, álbum, artista, gênero, subpasta, pasta, faixas adicionadas recentemente ou playlist. A reprodução passa pelo Effect Pipeline atual do EffeTune, assim como na reprodução normal de arquivos de música.

A Biblioteca de música armazena o catálogo, o cache de capas e as playlists dentro do aplicativo. Ela não edita, renomeia, move nem exclui os arquivos de música.

## Ambientes disponíveis

- **Aplicativo desktop:** usa o scanner de pastas completo e consegue manter as pastas selecionadas disponíveis entre inicializações. Na versão desktop, também é possível mostrar uma faixa na pasta onde o arquivo está.
- **Navegadores Chromium em PC com File System Access:** salvam de forma persistente o identificador da pasta selecionada. Ele pode ser reutilizado após recarregar quando o acesso for concedido, embora o navegador possa pedir permissão novamente.
- **Navegadores móveis, Safari, Firefox e outros sem File System Access:** mantêm os objetos `File` selecionados apenas durante a sessão atual da página. O catálogo permanece salvo, mas os arquivos não podem ser reabertos após recarregar. Selecione novamente a pasta ou os arquivos depois de cada recarregamento; o EffeTune os reconecta às entradas existentes pelo caminho relativo normalizado.

A Biblioteca de música indexa extensões comuns de arquivos de mídia, como MP3, WAV, OGG, FLAC, Opus, M4A, AAC, WebM e MP4. Ela também pode usar uma folha CUE externa para dividir em faixas um arquivo de álbum WAV ou FLAC que esteja na mesma pasta. Nos arquivos MP4, o EffeTune reproduz apenas a faixa de áudio e não exibe o vídeo. A possibilidade real de reprodução, inclusive do codec de áudio contido no MP4, também depende dos recursos de decodificação do navegador ou do sistema operacional.

## Abrir a Biblioteca de música

- **Layout para PC:** clique no botão **Biblioteca de música** no cabeçalho.
- **Layout móvel:** abra a aba **Biblioteca** na navegação inferior.
- **Aplicativo desktop:** também é possível abrir por **Visualizar > Biblioteca de música** ou **Ctrl+L** (**Command+L** no macOS).

Para voltar à edição de efeitos, clique no botão **Effect Pipeline** no layout para PC e, no layout móvel, volte para a aba **Efeitos**. No aplicativo desktop, também é possível usar **Visualizar > Effect Pipeline** ou **Ctrl+E** (**Command+E** no macOS).

Se quiser que a Biblioteca de música seja a primeira tela exibida ao iniciar, abra **Configurações > Configuração...** e defina **Visualização ao iniciar:** como **Biblioteca de música**. Na lista ao lado de **Biblioteca de música**, escolha qual seção será exibida primeiro: **Faixas**, **Álbuns**, **Artistas**, **Gêneros** ou **Subpastas**.

## Adicionar pastas de música

1. Abra a Biblioteca de música.
2. Selecione **Adicionar pasta de música**.
3. Escolha a pasta que contém os arquivos de música. Em navegadores móveis ou em navegadores que usam o modo de fallback, o seletor pode pedir que você escolha os arquivos da pasta em vez de conceder acesso persistente à pasta.
4. Aguarde o fim da varredura. A linha de status mostra o número de faixas e álbuns e, durante a indexação, também mostra o andamento.

Se você tentar adicionar uma pasta que já está dentro de uma pasta registrada, o EffeTune avisa sem indexar o mesmo conteúdo em duplicidade. Ao adicionar uma pasta pai que contém pastas já registradas, é possível mesclar as pastas existentes na nova pasta.

## Navegação e pesquisa

Use as abas de navegação para alternar o catálogo.

- **Faixas** - Exibe todas as faixas indexadas. No layout para PC, elas aparecem em uma tabela ordenável; no layout móvel, em uma lista compacta.
- **Álbuns** - Agrupa por álbum a partir dos metadados.
- **Artistas** - Agrupa por artista e artista do álbum nos metadados.
- **Gêneros** - Agrupa por gênero nos metadados.
- **Subpastas** - Agrupa as faixas pelo caminho relativo da subpasta que contém diretamente cada arquivo em cada pasta de música indexada.
- **Pastas** - Mostra as raízes de música registradas e o estado da varredura.
- **Adicionadas recentemente** - Mostra as faixas indexadas recentemente.
- **Playlists** - Mostra as playlists criadas ou importadas dentro da Biblioteca de música.

Um valor de artista do álbum separado por ponto e vírgula, como `Artist A; Artist B`, é indexado para cada artista, mantendo o crédito completo na exibição. `&`, `/` e `feat.` não são tratados como separadores.

Por exemplo, `Artist/Album/01 Song.flac` aparece no grupo de subpasta `Artist/Album`. Caminhos relativos idênticos em raízes indexadas diferentes permanecem separados. Arquivos armazenados diretamente na raiz não criam um grupo de subpasta; eles continuam disponíveis em **Faixas** e nessa raiz em **Pastas**.

Com **Pesquisar na biblioteca**, você pode pesquisar faixas, álbuns, artistas e playlists ao mesmo tempo. No layout para PC, é possível ordenar a lista de faixas pelo cabeçalho usando **Título**, **Artista**, **Álbum**, **Gênero** e **Tempo**. As visualizações de álbuns, artistas, gêneros, subpastas e playlists oferecem uma lista **Ordenar** baseada no catálogo. Dependendo da visualização, é possível ordenar por nome, artista, caminho, número de faixas, duração total, data de atualização ou data de criação, em ambos os sentidos. Cada visualização mantém sua própria seleção.

Na pesquisa de faixas, termos com três ou mais caracteres correspondem a qualquer parte do título, artista, álbum, gênero, nome do arquivo ou caminho. Termos com um ou dois caracteres correspondem apenas ao início de uma palavra. Digite pelo menos três caracteres para pesquisar no meio de uma palavra.

Nos layouts para PC e dispositivos móveis, quando uma pesquisa de faixas ou os detalhes de um álbum, artista, gênero, subpasta ou playlist retornam 300 faixas ou menos, todas são selecionadas por padrão. Com 301 faixas ou mais, não há seleção automática. Use as caixas das linhas, **Selecionar tudo** ou **Desmarcar tudo** para alterar a seleção.

No celular, a lista normal de títulos aparece primeiro, sem colunas de artista ou duração. Somente manter uma faixa pressionada abre o modo de seleção; as caixas, **Selecionar tudo** e **Desmarcar tudo** aparecem, enquanto as ações normais das linhas continuam disponíveis. A seleção automática e as alterações posteriores — incluindo **Selecionar tudo**, **Desmarcar tudo** e as caixas individuais — mudam apenas o estado da seleção; elas não abrem nem encerram o modo de seleção.

Quando os metadados estão ausentes ou não podem ser lidos, o EffeTune usa o nome do arquivo e as informações da pasta para a exibição. Nas propriedades da faixa, você pode conferir o caminho do arquivo, formato, taxa de amostragem, profundidade de bits, taxa de bits e os principais itens de metadados. Para uma faixa CUE, elas também mostram o tipo, o caminho do arquivo CUE, o caminho do áudio de origem e o trecho ocupado nesse arquivo.

## Arquivos de álbum com CUE

Coloque o arquivo `.cue` externo junto aos arquivos WAV ou FLAC citados nele e adicione ou examine novamente essa pasta. Cada entrada `TRACK ... AUDIO` válida aparece como uma faixa separada na Biblioteca de música. Quando disponíveis, são usados o título, intérprete, data, gênero e número de faixa do CUE; as informações técnicas vêm do WAV ou FLAC de origem.

Para as faixas adicionadas à Biblioteca de música, o EffeTune usa primeiro a capa incorporada ao áudio de origem. Se não houver nenhuma, ele procura, ao lado do arquivo CUE e nesta ordem, `cover.jpg`, `cover.png`, `front.jpg`, `front.png` e depois um JPEG ou PNG com o nome do arquivo de áudio, com ou sem a extensão de áudio. A reprodução direta no aplicativo para desktop usa automaticamente essas mesmas imagens vizinhas; esse modo de reprodução não extrai a capa incorporada ao áudio de origem. A reprodução direta no navegador usa a imagem correspondente incluída na seleção de arquivos.

Você também pode reproduzir um álbum CUE sem adicioná-lo à Biblioteca de música. Use **Open music files** ou, no celular, **Open Music**. No aplicativo para desktop, **File > Open music file...** também está disponível. No aplicativo para desktop, selecione apenas o arquivo `.cue`; no navegador, selecione um arquivo `.cue` junto com todos e somente os arquivos WAV ou FLAC citados nele, além da capa correspondente se quiser usá-la. Uma seleção válida substitui a fila de reprodução atual, mas não é adicionada ao catálogo. Se a validação falhar, a fila atual permanece inalterada.

Se a folha CUE for inválida ou não puder identificar com segurança os arquivos de origem, o EffeTune explica o problema e importa os arquivos WAV ou FLAC como faixas comuns que abrangem o arquivo inteiro. Corrija a folha CUE ou os nomes dos arquivos e examine a pasta novamente.

## Reproduzir a partir da biblioteca

Selecione faixas, álbuns, artistas, gêneros, subpastas, pastas, resultados de pesquisa ou playlists e use as ações abaixo.

- **Reproduzir** - Substitui a fila atual do player e inicia a reprodução.
- **Aleatório** - Reproduz o conjunto de faixas selecionado em ordem aleatória.
- **Reproduzir a seguir** - Insere as faixas selecionadas logo depois da faixa atual.
- **Adicionar à fila** - Adiciona as faixas selecionadas ao fim da fila.
- **Adicionar à playlist** - Salva as faixas selecionadas em uma playlist da Biblioteca de música.

No PC, você pode clicar duas vezes em uma linha de faixa para reproduzir a partir dessa posição, ou abrir as ações pelo botão direito do mouse ou pelo menu **Mais**. No celular, toque em uma faixa da lista normal para reproduzi-la; manter pressionado entra no modo de seleção descrito acima.

Os controles normais do player e as configurações de repetição/aleatório continuam disponíveis. Em dispositivos com teclado, os atalhos de teclado normais do player também podem ser usados. Se uma pasta ficar offline e uma faixa da biblioteca não puder ser aberta, reconecte ou importe novamente essa pasta.

## Atualizar e reconectar pastas

Depois de adicionar, excluir, renomear ou editar tags de arquivos dentro de uma pasta de música, use **Reescanear**. A nova varredura atualiza as faixas alteradas, remove do catálogo os arquivos que não forem mais encontrados e também tenta resolver novamente itens de playlist que antes estavam indisponíveis.

Na tela **Pastas**, os estados mostram se a pasta está disponível.

- **OK** - A pasta está disponível.
- **Não escaneado** - A pasta ainda não foi indexada.
- **Não encontrado** - A pasta ou o caminho salvo não está disponível.
- **Reconectar** - O EffeTune precisa de permissão de acesso novamente.

Se uma pasta mostrar **Reconectar**, selecione **Reconectar** e conceda novamente acesso à mesma pasta. Remover uma pasta apenas a retira do catálogo da Biblioteca de música; os arquivos no disco não são excluídos.

## Playlists

As playlists da Biblioteca de música são salvas dentro do EffeTune e podem incluir faixas de pastas já indexadas.

Você pode:

- criar uma playlist a partir de faixas selecionadas na biblioteca;
- salvar a fila atual do player como uma playlist;
- renomear, duplicar, excluir e reordenar playlists;
- arrastar faixas dentro de uma playlist para mudar a ordem; em ambientes onde arrastar é difícil, usar **Mover para cima** e **Mover para baixo**;
- importar playlists nos formatos M3U, M3U8, PLS e XSPF com **Importar playlist**;
- abrir uma playlist específica e exportá-la em formato M3U8 ou XSPF com **Exportar M3U8** ou **Exportar XSPF**.

### Reproduzidas recentemente e Favoritos

O EffeTune mostra duas playlists especiais ao lado das playlists comuns, na mesma grade de cartões. Elas são criadas apenas quando necessárias: **Reproduzidas recentemente** quando uma faixa indexada começa a tocar e **Favoritos** quando você marca uma faixa com a estrela pela primeira vez.

- **Reproduzidas recentemente** mantém as 100 faixas distintas mais recentes, com a mais nova no topo. Ao reproduzir uma faixa novamente, ela volta para o topo.
- **Favoritos** contém as faixas marcadas com ☆. No PC, use a estrela ao lado da faixa; no celular, abra o menu **Mais** da faixa. O mesmo menu também pode ser aberto clicando com o botão direito em uma faixa no PC.

Os nomes dessas playlists são fixos e aparecem no idioma atual da interface, portanto não podem ser alterados. Ainda é possível duplicar, exportar ou excluir essas playlists como as demais. Se uma delas for excluída, será recriada vazia na próxima vez que a reprodução ou uma ação de favoritos precisar dela. Os cartões exibem um relógio ou uma estrela na área da capa; o botão de reprodução no canto inferior direito de **Favoritos** inicia a playlist imediatamente. As playlists especiais não aparecem nos resultados da pesquisa de playlists comuns.

Ao escanear uma pasta, o EffeTune importa automaticamente os arquivos de playlist compatíveis depois de indexar as faixas e ignora os arquivos cujo conteúdo não mudou. Se o conteúdo de um arquivo na mesma pasta e no mesmo caminho relativo mudar, o EffeTune substitui atomicamente os itens da playlist importada automaticamente; isso também substitui as edições feitas nesses itens dentro do EffeTune. Uma importação que falhou ou foi cancelada é tentada novamente na próxima varredura. Excluir ou renomear o arquivo de origem não remove a playlist existente, e um arquivo renomeado é importado como uma nova playlist.

Durante a importação, é exibida uma prévia de quantos itens coincidem com faixas da biblioteca atual. Os itens sem correspondência também são mantidos, sempre que possível, como itens não resolvidos, para que possam ser resolvidos depois se a pasta correspondente for adicionada ou reconectada.

Ao exportar, escolher **Caminhos relativos** grava, quando possível, caminhos relativos ao destino da exportação. Isso é útil quando você quer mover a playlist junto com a pasta de música. M3U8 e XSPF não conseguem preservar o trecho de uma faixa CUE dentro do arquivo do álbum; por isso, o EffeTune omite essas faixas e informa quantas foram excluídas. Ele nunca grava o caminho físico do arquivo do álbum no lugar de uma faixa CUE omitida.

## Segurança e local de armazenamento

- A Biblioteca de música lê os arquivos de música e seus metadados, mas não grava alterações nos arquivos de música.
- O cache de capas e as playlists são dados internos do aplicativo, não alterações incorporadas aos arquivos de música.
- Os grupos de subpastas são derivados dos caminhos relativos salvos no catálogo.
- A área de armazenamento do navegador pode ser apagada pelas configurações do navegador ou por ações do usuário. Exporte playlists importantes conforme necessário.
- Nos navegadores com File System Access, as permissões determinam se o identificador persistente da pasta pode ser reutilizado após recarregar. No modo de fallback, os arquivos selecionados duram apenas durante a sessão e sempre precisam ser escolhidos novamente após recarregar.

## Bibliotecas grandes

O catálogo mantém os dados no disco e divide o trabalho em páginas ou lotes limitados, portanto uma coleção grande não precisa ser carregada inteira na memória. As medições de escala e de referência fixa são diagnósticos locais e opcionais de desenvolvimento. Elas não são requisitos para commits, releases, `verify` ou GitHub Actions e não constituem uma garantia geral de desempenho. O tempo de varredura e os limites práticos dependem da velocidade do armazenamento, da memória disponível, dos metadados, das capas e das limitações do navegador ou do sistema operacional.

Enquanto você rola a lista de faixas, o EffeTune mantém as páginas próximas em cache. No layout móvel, ele lê antecipadamente até duas páginas na direção atual, dá prioridade à página necessária na tela sobre leituras antecipadas adicionais e reutiliza as linhas visíveis que se sobrepõem. Mesmo que a rolagem continue, as leituras concluídas para a área visível são publicadas imediatamente nesse cache limitado. As solicitações de posição são agrupadas na mais recente e, se ela estiver na página que acabou de ser carregada, nenhuma leitura adicional do banco de dados é feita. Leituras antecipadas pendentes que deixaram de ser necessárias são descartadas. O SQLite permite interrupções, mas os adaptadores do catálogo executam atualmente cada instrução de forma síncrona e não oferecem um caminho para interrompê-la a partir de outro worker. Por isso, um salto excepcionalmente rápido ainda pode deixar um breve espaço vazio até a leitura em andamento terminar, principalmente em armazenamento lento.

[← Voltar para o README](README.md)
