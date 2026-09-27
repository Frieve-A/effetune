---
title: "Extensão do navegador - EffeTune"
description: "A extensão processa simultaneamente o áudio de até quatro abas, cada uma com seu próprio Effect Pipeline estéreo."
lang: pt
---

# Extensão do navegador EffeTune

A extensão processa simultaneamente o áudio de até quatro abas, cada uma com seu próprio **Effect Pipeline** estéreo. Ela é útil para ouvir um site de vídeo ou música sem abrir o aplicativo de desktop nem configurar um dispositivo de áudio virtual.

## Compatibilidade e instalação

Use-a em um PC com Chrome 116 ou posterior, ou uma versão compatível do Microsoft Edge baseada em Chromium. Firefox, Safari, navegadores móveis e navegação privada não são compatíveis. Cada aba usa um pipeline de efeitos estéreo.

Instale uma extensão recebida de uma loja na própria loja. Para um pacote local, extraia `effetune-extension-<version>.zip` em uma pasta que você manterá. Abra `chrome://extensions` no Chrome ou `edge://extensions` no Edge, ative **Developer mode**, escolha **Load unpacked** e selecione essa pasta. **Load unpacked** não instala o ZIP; recarregue a extensão nessa página depois de substituir arquivos.

## Iniciar, comparar e parar

1. Abra a aba cujo áudio deseja processar e inicie a reprodução.
2. Abra a extensão EffeTune pela barra de ferramentas do navegador.
3. Escolha **Start on this tab**. Quando a cadeia estiver pronta, o estado muda de **Starting…** para **Processing**.

Para adicionar outra aba, abra a extensão nela e escolha **Start on this tab**. O pop-up mostra todas as sessões. Até quatro abas podem funcionar ao mesmo tempo; pare uma antes de iniciar a quinta. **Bypass** permite ouvir uma aba sem efeitos mantendo a sessão. **Stop** devolve essa aba à reprodução normal sem interromper as demais.

O processamento continua se você fechar o pop-up ou o editor. Ao abri-los novamente, eles mostram a aba e o estado atuais. Depois de reiniciar o navegador, inicie uma nova sessão manualmente: a extensão não captura abas automaticamente.

## Editar e usar predefinições

Escolha **Edit pipeline** para abrir o **EffeTune Pipeline Editor**. Você pode adicionar, reordenar, ativar ou desativar efeitos, ajustar parâmetros e usar as visualizações disponíveis como no EffeTune. **Saved preset** e **Apply to selected tab** mudam toda a cadeia no pop-up. No editor, abra **Pipeline Presets** para salvar uma predefinição completa com **Save as**. Para importar ou exportar predefinições completas, abra **Settings** e escolha **Import preset…** ou **Export preset**. Selecione a aba no cabeçalho do editor para exibir sua cadeia e suas análises. Sem sessões ativas, **Offline pipeline** edita a cadeia padrão do próximo início. No pop-up, selecione a aba à qual deseja aplicar a predefinição.

Escolha **Visualizer** no cabeçalho do editor para ver no [Visualizer](visualizer.md) o áudio processado da aba selecionada; escolha-o novamente para voltar à cadeia. Se essa aba não estiver sendo processada, o Visualizer mostra "Start EffeTune on a tab to show Visualizer.". Títulos das faixas e capas não aparecem na extensão. **Share** e **Import Link** funcionam como no aplicativo web, e os links compartilhados abrem na versão web. Os layouts e predefinições do Visualizer ficam na extensão e não sincronizam com os aplicativos web ou de desktop.

As predefinições e configurações salvas ficam na extensão; elas não sincronizam automaticamente com os aplicativos web ou de desktop. Se uma predefinição exigir roteamento, efeito ou recurso externo indisponível, ela não será aplicada e a cadeia atual será preservada.

Para usar no Room EQ ou no Crosstalk Cancellation uma medição do aplicativo web ou de desktop, exporte-a ali como JSON. No editor da extensão, abra **Settings**, escolha **Import measurement…** e selecione esse arquivo JSON. Inclua as respostas ao impulso na exportação ao usar o Crosstalk Cancellation ou a correção de fase do Room EQ. As medições importadas aparecem imediatamente na lista **Measurement** do Room EQ, permanecem no armazenamento do navegador da extensão e não são sincronizadas automaticamente. Para remover uma cópia importada, selecione-a nessa lista e escolha **Delete** ao lado dela. Após a confirmação, todas as atribuições do Room EQ e do Crosstalk Cancellation que a utilizam são limpas antes da exclusão da cópia.

Para escolher quais dados salvos transferir, abra **Settings > Backup / Restore** no editor. O mesmo arquivo `.effetune_backup` funciona nos aplicativos web e de desktop e pode incluir predefinições da cadeia, predefinições de efeitos, predefinições do Visualizer, respostas ao impulso e medições importadas. Uma cadeia que use roteamento ou efeitos incompatíveis com a extensão permanece salva e pode entrar em um novo backup, embora não possa ser aplicada na extensão. As regras de URL e a configuração Sample rate da extensão não são incluídas.

## Predefinições por URL e taxa de amostragem

Em **Settings**, abra **URL rules…**, adicione um padrão, escolha uma predefinição salva e ative a regra. Os padrões usam `host/path`, como `example.com/music/*`; `*` corresponde a qualquer texto. A primeira regra ativa correspondente é usada. Maiúsculas e minúsculas do nome do host não são diferenciadas; protocolo, parâmetros de consulta e fragmento são ignorados. Reordene as regras para definir a prioridade, ou desative ou exclua as que não precisar.

Você ainda inicia cada aba manualmente. A predefinição é escolhida no início e quando a URL muda; sem correspondência, a cadeia padrão é usada. As alterações das regras valem a partir do próximo início ou navegação. Editar uma cadeia escolhida por uma regra atualiza essa predefinição salva. As outras edições, inclusive após aplicar uma predefinição manualmente, atualizam a cadeia padrão. Excluir uma predefinição desativa suas regras e devolve as abas que as usam à cadeia padrão.

**Sample rate**, em **Settings**, vale para todas as abas ativas: **Auto**, **44.1 kHz**, **48 kHz**, **96 kHz** ou **192 kHz**. Auto deixa o navegador escolher. A mudança reinicia brevemente o processamento de todas as abas, mantendo as capturas. Se uma aba não conseguir funcionar na nova taxa, volta à reprodução normal; escolha outra taxa e inicie o processamento dessa aba novamente.

## Permissões, limites e ajuda

A extensão captura áudio apenas das abas onde você inicia explicitamente o processamento. Ela lê suas URLs, inclusive após a navegação, para escolher predefinições salvas. Não lê o conteúdo das páginas, não insere scripts, não usa o microfone, não grava áudio nem o envia para outros serviços.

Os pipelines estéreo oferecem Bus Routing com Main e Bus 1–4, inclusive caminhos de efeitos paralelos. Mais de dois canais, realização de novas medições e controle de dispositivos, Music Library, conversão de arquivos em lote e recursos exclusivos de desktop que dependem de dispositivos ou caminhos de arquivo não estão disponíveis na extensão.

Parte do conteúdo protegido pode não estar disponível para captura; a extensão não contorna a proteção. Se a captura não iniciar, o EffeTune interrompe o processamento e a aba volta à reprodução normal. Confirme que a aba está tocando áudio e escolha **Start on this tab** novamente. Se aparecer **Needs attention**, faça o mesmo. Se uma predefinição não for aplicada, a cadeia atual será preservada; troque a predefinição ou disponibilize os recursos necessários antes de tentar de novo.
