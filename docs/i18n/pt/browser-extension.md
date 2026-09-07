---
title: "Extensão do navegador - EffeTune"
description: "Processe o áudio de uma aba do Chrome ou Edge com a extensão EffeTune."
lang: pt
---

# Extensão do navegador EffeTune

A extensão processa o áudio de uma única aba com o mesmo **Effect Pipeline** estéreo do EffeTune. Ela é útil para ouvir um site de vídeo ou música sem abrir o aplicativo de desktop nem configurar um dispositivo de áudio virtual.

## Compatibilidade e instalação

Use-a em um PC com Chrome 116 ou posterior, ou uma versão compatível do Microsoft Edge baseada em Chromium. Firefox, Safari, navegadores móveis e navegação privada não são compatíveis. Uma sessão processa apenas uma aba por vez em uma cadeia estéreo serial.

Instale uma extensão recebida de uma loja na própria loja. Para um pacote local, extraia `effetune-extension-<version>.zip` em uma pasta que você manterá. Abra `chrome://extensions` no Chrome ou `edge://extensions` no Edge, ative **Developer mode**, escolha **Load unpacked** e selecione essa pasta. **Load unpacked** não instala o ZIP; recarregue a extensão nessa página depois de substituir arquivos.

## Iniciar, comparar e parar

1. Abra a aba cujo áudio deseja processar e inicie a reprodução.
2. Abra a extensão EffeTune pela barra de ferramentas do navegador.
3. Escolha **Start processing**. Quando a cadeia estiver pronta, o estado muda de **Starting…** para **Processing**.

A aba escolhida fica fixa durante a sessão. Para processar outra, escolha **Stop processing**, abra a extensão nessa outra aba e inicie novamente. **Bypass effects** permite ouvir a aba capturada sem efeitos e mantém a sessão. **Stop processing** libera o áudio da aba e restaura seu caminho normal de reprodução.

O processamento continua se você fechar o pop-up ou o editor. Ao abri-los novamente, eles mostram a aba e o estado atuais. Depois de reiniciar o navegador, inicie uma nova sessão manualmente: a extensão não captura abas automaticamente.

## Editar e usar predefinições

Escolha **Edit pipeline** para abrir o **EffeTune Pipeline Editor**. Você pode adicionar, reordenar, ativar ou desativar efeitos, ajustar parâmetros e usar as visualizações disponíveis como no EffeTune. **Saved preset** e **Apply** mudam toda a cadeia no pop-up. No editor, abra **Pipeline Presets** para salvar uma predefinição completa com **Save as**. Para importar ou exportar predefinições completas, abra **Settings** e escolha **Import preset…** ou **Export preset**.

As predefinições e configurações salvas ficam na extensão; elas não sincronizam automaticamente com os aplicativos web ou de desktop. Se uma predefinição exigir roteamento, efeito ou recurso externo indisponível, ela não será aplicada e a cadeia atual será preservada.

Para usar no Room EQ ou no Crosstalk Cancellation uma medição do aplicativo web ou de desktop, exporte-a ali como JSON. No editor da extensão, abra **Settings**, escolha **Import measurement…** e selecione esse arquivo JSON. Inclua as respostas ao impulso na exportação ao usar o Crosstalk Cancellation ou a correção de fase do Room EQ. As medições importadas permanecem no armazenamento do navegador da extensão e não são sincronizadas automaticamente. Para remover uma delas, escolha **Delete imported measurement…** em **Settings**; as atribuições que a utilizam são limpas antes da exclusão.

## Permissões, limites e ajuda

A extensão captura áudio somente da aba em que você inicia explicitamente o processamento. Ela não precisa de microfone, acesso a todos os sites, gravação ou envio do seu áudio para outro lugar.

Ela aceita cadeias estéreo normais. Cadeias multibus ou ramificadas, mais de dois canais, realização de novas medições e controle de dispositivos, Music Library, conversão em lote e recursos exclusivos de desktop que dependem de dispositivos ou caminhos de arquivo não estão disponíveis.

Parte do conteúdo protegido pode não estar disponível para captura; a extensão não contorna a proteção. Se a captura não iniciar, o EffeTune interrompe o processamento e a aba volta à reprodução normal. Confirme que a aba está tocando áudio e escolha **Start processing** novamente. Se aparecer **Needs attention**, faça o mesmo. Se uma predefinição não for aplicada, a cadeia atual será preservada; troque a predefinição ou disponibilize os recursos necessários antes de tentar de novo.
