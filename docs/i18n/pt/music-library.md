---
title: "Guia da Biblioteca de música - Navegação e reprodução de arquivos de música locais - EffeTune"
description: "Aprenda a configurar a Biblioteca de música no EffeTune, encontrar e reproduzir músicas por subpasta ou metadados e gerenciar playlists."
lang: pt
---

# Como Usar a Biblioteca de música

A Biblioteca de música indexa as pastas de música selecionadas para que você possa navegar pela sua coleção local por faixas, arquivos, álbuns, artistas, gêneros, subpastas, pastas, faixas adicionadas recentemente ou playlists. A reprodução continua passando pela cadeia de efeitos atual do EffeTune, então você ouve com os mesmos efeitos usados na reprodução normal de arquivos de música.

A Biblioteca de música armazena o catálogo, o cache de capas e as playlists dentro do aplicativo. Ela não edita, renomeia, move nem exclui seus arquivos de áudio.

## Ambientes disponíveis {#availability}

- **Aplicativo desktop:** Usa o scanner de pastas completo e pode manter as pastas selecionadas disponíveis entre inicializações. As versões desktop também podem mostrar uma faixa na pasta onde o arquivo está.
- **Navegadores Chromium em PC com File System Access:** Podem manter o acesso às pastas selecionadas após recarregar, embora o navegador possa pedir permissão novamente.
- **Navegadores móveis, Safari, Firefox e outros sem File System Access:** Mantêm acesso aos arquivos selecionados apenas durante a sessão atual da página. O catálogo permanece salvo, mas selecione novamente a pasta ou os arquivos após cada recarregamento para que o EffeTune os reconecte.

A Biblioteca de música indexa extensões comuns de arquivos de áudio, como MP3, WAV, OGG, FLAC, Opus, M4A e AAC. Ela também pode usar uma folha CUE externa para dividir em faixas individuais um arquivo de álbum WAV ou FLAC na mesma pasta.

Para incluir arquivos MP4, WebM, M4V, MOV, MKV e 3GP, ative **Incluir formatos de vídeo na Biblioteca de música** em **Configurações > Configuração... > Geral** e depois adicione ou reescaneie uma pasta. Essa opção fica desativada por padrão; alterá-la não modifica imediatamente o catálogo existente. A reprodução efetiva, incluindo o codec de áudio dentro de um arquivo de vídeo, depende do decodificador do navegador ou do sistema operacional. Para a exibição de vídeo, consulte o [guia do Player de música](music-player.md#video).

## Abrir a Biblioteca de música

- **Layout para PC:** Clique no botão **Biblioteca de música** no cabeçalho.
- **Layout móvel:** Abra a aba **Biblioteca** na navegação inferior.
- **Aplicativo desktop:** Você também pode usar **Visualizar > Biblioteca de música** ou **Ctrl+L** (**Command+L** no macOS).

Para voltar à edição de efeitos, clique no botão **Effect Pipeline** no layout para PC, volte para a aba **Efeitos** no layout móvel ou use **Visualizar > Effect Pipeline** ou **Ctrl+E** (**Command+E** no macOS) no aplicativo desktop.

Se quiser que a Biblioteca de música seja a primeira tela exibida ao iniciar, abra **Configurações > Configuração...** e defina **Visualização ao iniciar:** como **Biblioteca de música**. Na lista ao lado de Biblioteca de música, escolha qual seção será exibida primeiro: **Faixas**, **Arquivos**, **Álbuns**, **Artistas**, **Gêneros**, **Subpastas**, **Pastas** ou **Playlists**.

## Adicionar pastas de música

1. Abra a Biblioteca de música.
2. Selecione **Adicionar pasta de música**.
3. Escolha a pasta que contém suas músicas. Em navegadores móveis ou sem acesso persistente a pastas, o seletor pode pedir para escolher os arquivos da pasta em vez de conceder acesso contínuo à pasta.
4. Aguarde o término da varredura. A linha de status mostra o número de faixas e álbuns e o progresso durante a indexação.

Se você tentar adicionar uma pasta que já está dentro de uma pasta existente da biblioteca, o EffeTune avisa em vez de indexar conteúdo duplicado. Se adicionar uma pasta pai que contém pastas já indexadas, o EffeTune pode mesclá-las na nova pasta.

## Navegação e pesquisa

Use as abas de navegação para explorar sua coleção:

- **Faixas:** Todas as faixas indexadas (uma tabela ordenável no PC; uma lista compacta no celular).
- **Arquivos:** Faixas listadas por caminho de arquivo para escolher um arquivo diretamente. As faixas definidas por uma folha CUE aparecem como entradas separadas.
- **Álbuns:** Álbuns agrupados a partir dos metadados das faixas.
- **Artistas:** Artistas e artistas do álbum obtidos dos metadados (valores separados por ponto e vírgula, como `Artist A; Artist B`, são indexados em cada artista mantendo o crédito completo exibido).
- **Gêneros:** Grupos de gênero obtidos dos metadados.
- **Subpastas:** Faixas agrupadas pela subpasta pai direta dentro de cada pasta raiz indexada (por exemplo, `Artist/Album`).
- **Pastas:** Pastas raiz registradas, seu estado de varredura e sua hierarquia de pastas.
- **Adicionadas recentemente:** Faixas indexadas recentemente.
- **Playlists:** Playlists criadas ou importadas dentro da Biblioteca de música.

Em **Pastas**, abra uma raiz registrada para navegar por suas pastas na **Visualização em árvore** ou mude para a **Visualização plana** para listar todas as faixas dessa raiz de uma só vez. Na **Visualização em árvore**, pastas com apenas uma subpasta e sem faixas diretas são combinadas em uma única linha (como `Artist / Album`) para ir direto à pasta do álbum, enquanto o caminho de navegação permite abrir qualquer pasta intermediária.

Use **Pesquisar na biblioteca** para filtrar faixas, álbuns, artistas e playlists. Termos com três ou mais caracteres correspondem a qualquer parte do título, artista, álbum, gênero, nome do arquivo ou caminho; termos de um ou dois caracteres correspondem ao início de uma palavra. No PC, clique nos cabeçalhos da tabela de faixas (**N.º da faixa**, **Título**, **Artista**, **Álbum**, **Gênero** ou **Tempo**) ou use a lista **Ordenar** nas outras visualizações. No celular, use a lista **Ordenar** para mudar a ordem em qualquer visualização fora das playlists salvas.

Quando um resultado de pesquisa, nível de pasta, álbum, artista, gênero, subpasta ou playlist contém 300 faixas ou menos, todas as faixas são selecionadas por padrão para que você possa iniciar a reprodução imediatamente. Resultados com 301 faixas ou mais não são selecionados automaticamente; use as caixas de seleção das linhas, **Selecionar tudo** ou **Desmarcar tudo** para alterar a seleção. No celular, toque e segure qualquer linha de faixa para mostrar as caixas e os controles de seleção.

Se faltarem tags, o EffeTune usa o nome do arquivo e da pasta. As propriedades da faixa mostram o caminho do arquivo, formato, taxa de amostragem, profundidade de bits, taxa de bits, metadados e, nas faixas CUE, o caminho da folha CUE e o trecho da faixa.

## Arquivos de álbum com CUE

Coloque uma folha `.cue` externa na mesma pasta dos arquivos WAV ou FLAC que ela referencia e adicione ou reescaneie a pasta. Cada entrada `TRACK ... AUDIO` válida aparece como uma faixa individual na Biblioteca de música.

Para a capa, a Biblioteca de música verifica primeiro a imagem incorporada no áudio de origem e, em seguida, procura ao lado do arquivo `.cue` por `cover.jpg`, `cover.png`, `front.jpg`, `front.png` ou uma imagem com o mesmo nome do arquivo de áudio.

Você também pode abrir uma folha `.cue` diretamente pelo player (**Abrir arquivos de música**, **Arquivo > Abrir arquivo de música...** no desktop ou **Abrir música** no celular):
- **Aplicativo desktop:** Selecione apenas o arquivo `.cue`.
- **Navegador Chromium em PC:** Se a pasta do álbum já estiver registrada na Biblioteca de música com permissão concedida, selecione apenas o arquivo `.cue`.
- **Outros navegadores:** Selecione o arquivo `.cue` junto com todos os arquivos WAV/FLAC que ele referencia, e somente eles, além de uma imagem de capa correspondente, se quiser.

Se uma folha CUE for inválida ou seus arquivos de áudio não puderem ser associados, o EffeTune avisa e importa os arquivos WAV ou FLAC como faixas únicas de arquivo inteiro. Corrija a folha CUE ou os nomes dos arquivos e reescaneie a pasta para tentar de novo.

## Reproduzir a partir da biblioteca

Selecione uma faixa, álbum, artista, gênero, subpasta, pasta, resultado de pesquisa ou playlist e escolha:

- **Reproduzir:** Substitui a fila atual do player e inicia a reprodução.
- **Aleatório:** Reproduz a seleção em ordem aleatória.
- **Reproduzir a seguir:** Insere a seleção após a faixa atual.
- **Adicionar à fila:** Adiciona a seleção ao final da fila.
- **Adicionar à playlist:** Adiciona a seleção a uma playlist da Biblioteca de música.

No PC, clique duas vezes na linha de uma faixa para reproduzir a partir dela, ou clique com o botão direito / abra **Mais** para ver as ações da faixa. No celular, toque em uma faixa para reproduzi-la ou mantenha pressionado para selecionar várias faixas.

## Atualizar e reconectar pastas

Use **Reescanear** após adicionar, remover, renomear ou editar tags de arquivos nas suas pastas de música. A nova varredura atualiza as faixas modificadas, remove do catálogo os arquivos excluídos e reconecta itens de playlists quando arquivos correspondentes são encontrados.

Estado das pastas em **Pastas**:
- **OK:** Pronta para navegar e reproduzir.
- **Não escaneado:** Adicionada, mas ainda não indexada.
- **Não encontrado:** O caminho da pasta não foi mais encontrado.
- **Reconectar:** A permissão do navegador ou da pasta é necessária novamente; clique em **Reconectar** e conceda acesso à mesma pasta.

Se não for possível abrir uma faixa da biblioteca porque a pasta está offline, reconecte ou importe a pasta novamente.

Escolher **Remover** apenas retira a pasta do catálogo do EffeTune; seus arquivos no disco nunca são excluídos.

## Playlists

As playlists da Biblioteca de música são salvas dentro do EffeTune e podem conter faixas de qualquer pasta indexada:

- Crie uma playlist a partir de faixas selecionadas na biblioteca ou salve a fila atual do player como uma playlist.
- Use **Renomear**, **Duplicar** e **Excluir** para gerenciar playlists, e arraste faixas (ou use **Mover para cima** / **Mover para baixo**) para mudar a ordem das faixas.
- Use **Importar playlist** para arquivos M3U, M3U8, PLS e XSPF, e **Exportar M3U8** ou **Exportar XSPF** dentro de uma playlist para exportá-la.

### Reproduzidas recentemente e Favoritos

Duas playlists automáticas aparecem na grade de playlists depois de usadas:

- **Reproduzidas recentemente:** Mantém as últimas 100 faixas diferentes reproduzidas pela Biblioteca de música, da mais recente para a mais antiga.
- **Favoritos:** Reúne as faixas marcadas com a **☆** ao lado da faixa no PC ou com **Adicionar aos favoritos** no menu **Mais** da faixa (no PC, também disponível com o botão direito). Clique no botão de reprodução do cartão **Favoritos** para iniciá-la imediatamente.

Os nomes acompanham o idioma atual da interface e não podem ser renomeados, mas você pode duplicar, exportar ou excluir essas playlists como qualquer outra.

### Importar e exportar playlists

As varreduras de pastas importam automaticamente arquivos de playlist compatíveis encontrados nas suas pastas de música e os atualizam ao reescanear quando o arquivo de playlist muda no disco; essa atualização substitui as edições que você fez nessa playlist no EffeTune. Entradas sem correspondência são mantidas como itens não resolvidos para que sejam vinculadas automaticamente quando a pasta correspondente for adicionada ou reconectada.

Ao exportar uma playlist, ative **Caminhos relativos** se quiser mover o arquivo M3U8 ou XSPF exportado junto com a pasta de música. Como arquivos M3U8 e XSPF padrão não armazenam intervalos de subfaixas CUE, as faixas CUE são omitidas durante a exportação e o EffeTune informa quantas foram ignoradas.

## Segurança e local de armazenamento

- A Biblioteca de música lê arquivos de áudio e metadados sem modificar seus arquivos no disco.
- Limpar os dados do site no navegador remove o catálogo e as playlists do aplicativo web; exporte as playlists importantes para mantê-las.
- Coleções grandes são carregadas progressivamente conforme você rola a tela. Use a Biblioteca de música em uma única janela do EffeTune por vez.

[← Voltar para o README](README.md)
