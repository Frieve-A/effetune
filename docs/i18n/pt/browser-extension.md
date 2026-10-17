---
title: "Extensão do navegador - Equalizador e efeitos de áudio para Chrome e Edge - EffeTune"
description: "Processe o áudio de até quatro abas do Chrome ou Edge com o EffeTune, com predefinições por URL e taxa de amostragem selecionável."
lang: pt
---

# Extensão do navegador EffeTune

A extensão do navegador EffeTune processa simultaneamente o áudio de até quatro abas do navegador, cada uma com seu próprio Effect Pipeline estéreo. Ela é útil para ouvir sites de vídeo ou música sem iniciar o aplicativo para desktop nem configurar um dispositivo de áudio virtual.

Para mais detalhes sobre o tratamento de dados locais e links externos opcionais, leia a [Política de Privacidade da Extensão do Navegador](../../browser-extension-privacy.md). Para obter ajuda, use o [GitHub Issues](https://github.com/Frieve-A/effetune/issues), mas não publique áudio, títulos ou URLs de abas, predefinições, medições, respostas ao impulso nem outras informações privadas em uma issue pública.

## Compatibilidade

Use a extensão em um PC com Chrome 116 ou posterior, ou em uma versão compatível do Microsoft Edge baseada em Chromium. Firefox, Safari, navegadores móveis e navegação privada não são compatíveis. Cada aba usa um pipeline de efeitos estéreo.

## Instalar um pacote local

Se você obteve a extensão em uma loja do navegador, instale-a por lá. Para um pacote local, extraia `effetune-extension-<version>.zip` em uma pasta que você manterá e carregue a pasta extraída:

1. No Chrome, abra `chrome://extensions`. No Edge, abra `edge://extensions`.
2. Ative **Developer mode**.
3. Escolha **Load unpacked** e selecione a pasta extraída da extensão.

**Load unpacked** não instala o arquivo ZIP diretamente. Recarregue a extensão nessa página após substituir arquivos na pasta extraída.

## Iniciar, comparar e parar o processamento

1. Abra a aba cujo áudio deseja processar e inicie a reprodução.
2. Abra a extensão EffeTune na barra de ferramentas do navegador.
3. Escolha **Start on this tab**. O estado muda de **Starting…** para **Processing** quando a cadeia de efeitos está pronta.

Para adicionar outra aba, abra a extensão a partir dessa aba e escolha **Start on this tab**. O pop-up lista todas as sessões. Até quatro abas podem funcionar ao mesmo tempo; pare uma antes de iniciar uma quinta.

Use **Bypass** ao lado de uma aba para ouvi-la sem efeitos mantendo a sessão ativa. Escolha **Stop** ao lado dessa aba quando terminar; a aba volta à reprodução normal sem interromper as demais.

Você pode fechar o pop-up da extensão ou o editor enquanto o processamento continua. Ao abrir qualquer um deles novamente, a aba atual e o estado do processamento serão exibidos. Após reiniciar o navegador, inicie uma nova sessão; a extensão não captura abas automaticamente.

## Editar o Effect Pipeline e usar predefinições

Escolha **Edit pipeline** para abrir o **EffeTune Pipeline Editor** e selecione a aba desejada no cabeçalho. Adicione, reordene, ative/desative e ajuste efeitos exatamente como no EffeTune; os analisadores acompanham a aba selecionada. Quando nenhuma aba está ativa, **Offline pipeline** edita o pipeline padrão usado na próxima aba que você iniciar.

Selecione **Visualizer** no cabeçalho do editor para ver o áudio processado da aba selecionada no [Visualizer](visualizer.md), ou clique novamente para voltar ao pipeline. Títulos de faixas e capas não são exibidos na extensão, e **Share** / **Import Link** funcionam como no aplicativo web.

Para trocar predefinições rapidamente pelo pop-up, selecione uma aba, escolha um **Saved preset** e clique em **Apply to selected tab**. No editor, use **Pipeline Presets > Save as** para salvar uma predefinição, ou **Settings > Import preset…** / **Export preset** para trocar arquivos `.effetune_preset`. Se uma predefinição exigir roteamento multicanal não suportado, efeitos incompatíveis ou recursos externos ausentes, o pipeline atual permanece inalterado.

Para usar uma medição de sala ou de alto-falante do aplicativo web ou desktop com **Room EQ** ou **Crosstalk Cancellation**:

1. Exporte a medição como JSON no aplicativo web ou desktop (inclua respostas ao impulso ao usar **Crosstalk Cancellation** ou correção de fase do **Room EQ**).
2. No editor da extensão, abra **Settings > Import measurement…** e selecione o arquivo JSON.
3. Selecione a medição importada no **Room EQ** ou no **Crosstalk Cancellation**. Para remover uma cópia importada, selecione-a na lista **Measurement** do Room EQ e escolha **Delete**; após a confirmação, todas as atribuições do Room EQ e do Crosstalk Cancellation que usam essa medição são removidas.

Para transferir predefinições, predefinições de efeitos, predefinições do Visualizer, respostas ao impulso e medições importadas em conjunto entre o aplicativo web, o aplicativo desktop e a extensão, use **Settings > Backup / Restore** (`.effetune_backup`). As predefinições, layouts e medições importadas da extensão ficam armazenados localmente na extensão e não sincronizam automaticamente com o aplicativo web ou desktop. Os backups não incluem as regras de URL nem a configuração de taxa de amostragem da extensão.

## Predefinições por URL e taxa de amostragem

Abra **Settings > URL rules…** para carregar automaticamente uma predefinição salva quando a URL de uma aba corresponder a um padrão `host/path` (como `example.com/music/*`, em que `*` corresponde a qualquer texto). Você continua iniciando cada aba por conta própria; as regras apenas escolhem a predefinição dela na inicialização e quando a URL muda. A primeira regra ativa correspondente na lista prevalece; se nenhuma regra corresponder, o pipeline padrão é usado. As alterações nas regras passam a valer no próximo início ou na próxima navegação de página. Editar um pipeline carregado por uma regra de URL atualiza a predefinição salva dessa regra, enquanto as demais edições, inclusive as feitas depois de aplicar uma predefinição manualmente, atualizam o pipeline padrão. Excluir uma predefinição desativa as regras que a usam e faz as abas que usavam essas regras voltarem ao pipeline padrão.

**Sample rate** em **Settings** aplica-se a todas as abas ativas (**Auto**, **44.1 kHz**, **48 kHz**, **96 kHz** ou **192 kHz**). **Auto** deixa o navegador escolher. Alterar a taxa reinicia brevemente o processamento nas abas ativas, mantendo as capturas. Se uma aba não puder operar na nova taxa, ela volta à reprodução normal; escolha outra taxa e inicie a aba novamente.

## Permissões e limites

A extensão captura áudio apenas das abas em que você clica em **Start on this tab** e lê as URLs dessas abas somente para verificar regras de predefinições por URL. Ela nunca lê o conteúdo das páginas, não injeta scripts, não usa o microfone nem envia áudio pela rede.

Cada aba executa um pipeline estéreo compatível com **Main** e **Bus 1–4**. Saída multicanal (>2 canais), execução de medições acústicas, Biblioteca de música, conversão de arquivos em lote offline e recursos de hardware exclusivos do desktop não estão disponíveis na extensão. Transmissões protegidas (DRM) que bloqueiam a captura pelo navegador retornam à reprodução normal.

## Se algo der errado

- **O estado mostra "Needs attention" ou a captura não inicia:** Certifique-se de que a aba esteja reproduzindo áudio ativamente e clique em **Start on this tab** novamente.
- **Não é possível aplicar uma predefinição:** O editor mantém o pipeline atual. Verifique se quaisquer medições ou respostas ao impulso necessárias foram importadas para a extensão primeiro.

[← Voltar para o README](README.md)
