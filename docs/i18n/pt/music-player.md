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

## Controles de reprodução

- Pausar, retomar ou fechar o player com **×** aplica um fade curto para evitar estalos.
- Clique no botão de velocidade ao lado de **Aleatório** para escolher uma das nove predefinições ou definir qualquer velocidade de `0.25x` a `4x` em passos de `0.01x`. **Manter o tom** vem ativado por padrão, mantendo o tom constante quando a velocidade muda; desative-o para que o tom suba e desça com a velocidade, como em uma fita ou em um disco.
- No aplicativo desktop, escolha **Visualizar > Minirreprodutor** (`Ctrl/Cmd+Shift+M`) ou clique no botão de minirreprodutor do player para mudar para uma janela compacta. Clique no botão de fixar para mantê-la sempre no topo.

## Reprodução sem intervalos

**Reprodução sem intervalos**, em **Configuração de Áudio**, vem ativada por padrão e reproduz faixas locais compatíveis sem intervalo; o suporte é limitado pelo formato do arquivo e pelo ambiente do navegador ou do aplicativo. Formatos não suportados e alguns ambientes móveis usam um modo alternativo seguro que economiza memória, por isso ainda pode haver um breve intervalo. Ao desativá-la, a prioridade passa a ser o menor uso de memória e a estabilidade, ao custo de um possível breve intervalo; a mudança não interrompe a faixa atual. A reprodução sem intervalos só funciona na velocidade 1x; mudar a velocidade durante a reprodução sem intervalos reinicia a faixa na mesma posição, com uma breve interrupção.

## Vídeo {#video}

O vídeo aparece na área da capa do player. No layout de desktop, iniciar um vídeo expande automaticamente o painel do player. Você pode recolhê-lo novamente durante a reprodução atual. Mova o ponteiro sobre o vídeo ou toque nele para mostrar o botão de expansão; ele desaparece após um breve período sem interação. Selecione **⛶** para ocupar toda a área de exibição do aplicativo; mova o ponteiro sobre o vídeo ou toque nele para mostrar os controles de reprodução na parte inferior. Você também pode adicionar um item **Video** no Visualizer. Para incluir arquivos de vídeo na Biblioteca de música, consulte o [guia da Biblioteca de música](music-library.md#availability).

No layout móvel, o vídeo expandido e seus controles giram juntos quando isso permite aproveitar melhor a tela. **Girar vídeo expandido no celular**, em **Configurações > Configuração... > Exibição**, fica ativado por padrão; desative para impedir a rotação. Ao voltar ao player pequeno, a exibição normal é restaurada. O layout de desktop e as configurações de orientação do dispositivo não mudam.

Fora do Mini Player, use estes gestos no vídeo ou nas bordas pretas ao redor dele:

- **Mouse:** Clique para reproduzir ou pausar. Clique duas vezes para expandir ou restaurar o vídeo sem alterar seu estado de reprodução ou pausa.
- **Toque:** Toque para mostrar os controles. Com o vídeo expandido, toque duas vezes na metade esquerda para voltar 10 segundos ou na metade direita para avançar 10 segundos. Tocar duas vezes na prévia pequena não muda a posição de reprodução.

Os botões e controles deslizantes continuam funcionando normalmente.

[← Voltar para o README](README.md)
