---
title: "Guia da Biblioteca de música - EffeTune"
description: "Aprenda a criar uma Biblioteca de música no EffeTune, navegar por pastas e metadados, reproduzir faixas pelo Effect Pipeline e gerenciar playlists."
lang: pt
---

# Como Usar a Biblioteca de música

A Biblioteca de música indexa as pastas de música selecionadas para que você possa explorar sua coleção local por faixa, álbum, artista, gênero, pasta, faixas adicionadas recentemente ou playlist. A reprodução passa pelo Effect Pipeline atual do EffeTune, assim como na reprodução normal de arquivos de música.

A Biblioteca de música armazena o catálogo, o cache de capas e as playlists dentro do aplicativo. Ela não edita, renomeia, move nem exclui os arquivos de música.

## Ambientes disponíveis

- **Aplicativo desktop:** usa o scanner de pastas completo e consegue manter as pastas selecionadas disponíveis entre inicializações. Na versão desktop, também é possível mostrar uma faixa na pasta onde o arquivo está.
- **Navegadores Chromium em PC:** usam File System Access quando disponível. O acesso à pasta pode ser mantido em alguns casos, mas o navegador também pode pedir permissão novamente.
- **Navegadores móveis, Safari e Firefox:** usam a seleção de pasta ou de arquivo disponível no navegador. No modo de fallback, é possível indexar os arquivos da pasta selecionada, mas, após recarregar a página ou perder a permissão, talvez seja necessário selecionar a pasta ou os arquivos novamente.

A Biblioteca de música indexa extensões comuns de arquivos de áudio, como MP3, WAV, OGG, FLAC, Opus, M4A, AAC e WebM. A possibilidade real de reprodução também depende dos recursos de decodificação de áudio do navegador ou do sistema operacional.

## Abrir a Biblioteca de música

- **Layout para PC:** clique no botão **Biblioteca de música** no cabeçalho.
- **Layout móvel:** abra a aba **Biblioteca** na navegação inferior.
- **Aplicativo desktop:** também é possível abrir por **Visualizar > Biblioteca de música** ou **Ctrl+L** (**Command+L** no macOS).

Para voltar à edição de efeitos, clique no botão **Effect Pipeline** no layout para PC e, no layout móvel, volte para a aba **Efeitos**. No aplicativo desktop, também é possível usar **Visualizar > Effect Pipeline** ou **Ctrl+E** (**Command+E** no macOS).

Se quiser que a Biblioteca de música seja a primeira tela exibida ao iniciar, abra **Configurações > Configuração...** e defina **Visualização ao iniciar:** como **Biblioteca de música**.

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
- **Pastas** - Mostra as pastas registradas na biblioteca e o estado da varredura.
- **Adicionadas recentemente** - Mostra as faixas indexadas recentemente.
- **Playlists** - Mostra as playlists criadas ou importadas dentro da Biblioteca de música.

Com **Pesquisar na biblioteca**, você pode pesquisar faixas, álbuns, artistas e playlists ao mesmo tempo. No layout para PC, é possível ordenar a lista de faixas pelo cabeçalho usando **Título**, **Artista**, **Álbum**, **Gênero** e **Tempo**.

Quando os metadados estão ausentes ou não podem ser lidos, o EffeTune usa o nome do arquivo e as informações da pasta para a exibição. Nas propriedades da faixa, você pode conferir o caminho do arquivo, formato, taxa de amostragem, profundidade de bits, taxa de bits e os principais itens de metadados.

## Reproduzir a partir da biblioteca

Selecione faixas, álbuns, artistas, gêneros, pastas, resultados de pesquisa ou playlists e use as ações abaixo.

- **Reproduzir** - Substitui a fila atual do player e inicia a reprodução.
- **Aleatório** - Reproduz o conjunto de faixas selecionado em ordem aleatória.
- **Reproduzir a seguir** - Insere as faixas selecionadas logo depois da faixa atual.
- **Adicionar à fila** - Adiciona as faixas selecionadas ao fim da fila.
- **Adicionar à playlist** - Salva as faixas selecionadas em uma playlist da Biblioteca de música.

No PC, você pode clicar duas vezes em uma linha de faixa para reproduzir a partir dessa posição, ou abrir as ações da faixa com o botão direito do mouse ou pelo menu **Mais**. No móvel, toque no botão de reprodução da linha da faixa para reproduzir; mantenha a faixa pressionada para abrir o menu de ações.

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
- exportar playlists em formato M3U8 ou XSPF com **Exportar M3U8** ou **Exportar XSPF**.

Durante a importação, é exibida uma prévia de quantos itens coincidem com faixas da biblioteca atual. Os itens sem correspondência também são mantidos, sempre que possível, como itens não resolvidos, para que possam ser resolvidos depois se a pasta correspondente for adicionada ou reconectada.

Ao exportar, escolher **Caminhos relativos** grava, quando possível, caminhos relativos ao destino da exportação. Isso é útil quando você quer mover a playlist junto com a pasta de música.

## Segurança e local de armazenamento

- A Biblioteca de música lê os arquivos de música e seus metadados, mas não grava alterações nos arquivos de música.
- O cache de capas e as playlists são dados internos do aplicativo, não alterações incorporadas aos arquivos de música.
- A área de armazenamento do navegador pode ser apagada pelas configurações do navegador ou por ações do usuário. Exporte playlists importantes conforme necessário.
- No aplicativo web, a possibilidade de continuar usando uma pasta após recarregar a página depende do gerenciamento de permissões do navegador.

[← Voltar para o README](README.md)
