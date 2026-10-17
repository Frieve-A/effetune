---
title: "Perguntas frequentes e solução de problemas - EffeTune"
description: "Perguntas frequentes e guia de solução de problemas do processador de áudio Frieve EffeTune."
lang: pt
---

# FAQ do EffeTune

O EffeTune é um aplicativo de DSP em tempo real para entusiastas de áudio, disponível como aplicativo web e aplicativo desktop. Este documento aborda configuração, solução de problemas, uso multicanal, operação de efeitos e correção de frequência.

Para processar o áudio de uma aba do Chrome ou Edge, consulte o [guia da extensão do navegador](browser-extension.md).

## Conteúdo

1. Configuração Inicial para Streaming
   1. Instalando o VB-CABLE e a correção opcional de aliasing em 96 kHz
   2. Roteamento do serviço de streaming (exemplo do Spotify)
   3. Configurações de áudio do EffeTune
   4. Verificação de operação
2. Solução de Problemas
   1. Qualidade de reprodução de áudio
   2. Uso da CPU
   3. Eco
   4. Problemas de entrada, saída ou efeitos
   5. Incompatibilidade de saída multicanal
   6. Solução de problemas de exibição
3. Conexões Multicanal e Hardware
   1. HDMI + receptor AV
   2. Interfaces sem drivers multicanal
   3. Atraso de canal e alinhamento de tempo
   4. Limite de 16 canais e expansão
4. Perguntas Frequentes
5. Resposta de Frequência e Correção de Sala
6. Dicas de Operação de Efeitos
7. Links de Referência

---

## 1. Configuração Inicial para Streaming

Exemplo no Windows: Spotify → VB-CABLE → EffeTune → DAC/AMP. Os conceitos são semelhantes para outros serviços e sistemas operacionais.

### 1.1. Instalando o VB-CABLE e a correção opcional de aliasing em 96 kHz

Baixe o VB-CABLE Driver Pack45, execute `VBCABLE_Setup_x64.exe` como administrador e reinicie. Se a instalação alterar a saída padrão do sistema para **CABLE Input**, defina novamente seus alto-falantes ou DAC como saída padrão.

Se o VB-CABLE produzir ruído de aliasing acima de 20 kHz, a causa é sua taxa interna de 48 kHz. Somente para esse problema, ajuste **CABLE Input** e **CABLE Output** para 24 bits, 96.000 Hz. Abra `VBCABLE_ControlPanel.exe` como administrador, escolha **Menu▸Internal Sample Rate = 96000 Hz** e clique em **Restart Audio Engine**. O acesso de administrador é necessário para manter essa configuração após reiniciar. Isso altera o próprio VB-CABLE e não é necessário para o uso normal do EffeTune em 96 kHz.

### 1.2. Roteamento do serviço de streaming (exemplo do Spotify)

Abra **Configurações▸Sistema▸Som▸Mixer de volume** e defina a saída do `Spotify.exe` para **CABLE Input**. Reproduza uma faixa para confirmar o silêncio dos alto-falantes.
No macOS, utilize o **SoundSource** da Rogue Amoeba para atribuir a saída do Spotify ao **CABLE Input** da mesma forma.

### 1.3. Configurações de áudio do EffeTune

Abra o EffeTune e escolha **Configuração de Áudio** no menu Configurações.
- **Dispositivo de Entrada:** CABLE Output (VB-Audio Virtual Cable)
- **Dispositivo de Saída:** DAC/alto-falantes físicos
- **Taxa de Amostragem:** selecione 96 kHz. Isso define a taxa de processamento interna do EffeTune para reduzir o aliasing audível nos efeitos não lineares e funciona de forma independente da taxa de amostragem do sistema operacional, do DAC ou do VB-CABLE. Confira a taxa de amostragem efetiva exibida no aplicativo; se houver cortes na reprodução, reduza os efeitos mais exigentes ou diminua a taxa de amostragem.

### 1.4. Verificação de operação

Com o Spotify tocando, alterne o **ON/OFF** principal no EffeTune e confirme se o som muda.

---

## 2. Solução de Problemas

### 2.1. Problemas de qualidade de reprodução de áudio

| Sintoma | Solução |
| ------ | ------ |
| Quedas ou falhas | Escolha **Redefinir Áudio** no menu Configurações ou no menu de mais opções do celular. No aplicativo desktop, você também pode escolher **Recarregar** no menu **Visualizar**. Reduza o número de efeitos ativos, se necessário. |
| Distorção ou clipping | Insira o **Level Meter** no final da cadeia e mantenha os níveis abaixo de 0 dBFS. Adicione o **Brickwall Limiter** antes do Level Meter, se necessário. |
| Aliasing acima de 20 kHz ao usar o VB-CABLE | A taxa interna ainda pode estar em 48 kHz. Siga o procedimento opcional de 96 kHz da seção 1.1. |

### 2.2. Alto uso de CPU

Desative os efeitos que você não está usando ou remova-os do **Effect Pipeline**.

### 2.3. Eco

Seus dispositivos de entrada e saída podem estar em loop. Certifique-se de que a saída do EffeTune não retorne à sua entrada.

### 2.4. Problemas de entrada, saída ou efeitos

| Sintoma | Solução |
| ------ | ------ |
| Sem entrada de áudio | Certifique-se de que o player esteja enviando saída para **CABLE Input**. Permita o uso do microfone no navegador e selecione **CABLE Output** em **Configuração de Áudio**. |
| Efeito não funcionando | Confirme se o master, cada efeito e qualquer **Section** estão **ON**. Redefina os parâmetros, se necessário. |
| Sem saída de áudio | Verifique a **Configuração de Áudio**. Se o navegador não permitir selecionar um dispositivo de saída, verifique se as saídas padrão do sistema operacional e do navegador apontam para seu DAC/AMP. |
| Outros players reportam "CABLE Input em uso" | Certifique-se de que nenhum outro aplicativo esteja usando **CABLE Input**. |

Os efeitos que precisam de WebAssembly exibem um aviso na parte superior dos controles quando não podem funcionar. Em **Configuração de Áudio**, ative **Usar processamento de áudio WebAssembly**. Se já estiver ativado, escolha **Redefinir Áudio** ou recarregue o EffeTune. O aviso desaparece quando o efeito volta a funcionar.

### 2.5. Incompatibilidade de saída multicanal

O EffeTune envia os canais em ordem numérica, até 16 canais. Faça **Canais de Saída** corresponder à configuração definida no dispositivo. Em uma configuração 7.1ch, defina o dispositivo e o EffeTune para 8ch e use as etiquetas de canais do dispositivo ao rotear o áudio traseiro. Em uma configuração de 16 canais, selecione 16 canais nos dois locais e confirme o mapeamento de canais do dispositivo.

### 2.6. Solução de problemas de exibição {#display-troubleshooting}

No aplicativo desktop, **Usar aceleração por hardware** vem ativado por padrão. Se a janela piscar ou parar de atualizar, desative a opção em **Configurações > Configuração...** e reinicie o EffeTune. Se os problemas de exibição se repetirem, o EffeTune desativa a opção e reinicia automaticamente. Para tentar novamente, ative-a e reinicie o aplicativo.

---

## 3. Conexões Multicanal e Hardware

### 3.1. HDMI + receptor AV

Configure a saída HDMI do PC de acordo com o layout de alto-falantes do receptor e conecte-o a um receptor AV. O EffeTune pode enviar até 16 canais por um único cabo quando o PC, o receptor e a conexão HDMI oferecem suporte a eles. Receptores mais antigos podem degradar a qualidade do som ou remapear canais inesperadamente.

### 3.2. Interfaces sem drivers multicanal (ex., MOTU M4)

Out 1‑2 e Out 3‑4 aparecem como dispositivos separados, impedindo a saída de 4 canais. Soluções alternativas:
- Use o **Voicemeeter** para mesclar canais via ASIO.
- Use o **ASIO Link Pro** para expor um dispositivo virtual de 4 canais (avançado).

### 3.3. Atraso de canal e alinhamento de tempo

Use o **MultiChannel Panel** ou **Time Alignment** para atrasar canais em passos de 10 µs (mínimo de 1 amostra). Ao alinhar os alto-falantes frontais com alto-falantes traseiros Bluetooth ou sem fio cuja latência medida seja muito maior, atrase os canais frontais em 100-400 ms; esse não é um valor comum para correção da distância dos alto-falantes. A sincronização de vídeo deve ser ajustada no player.

### 3.4. Limite de 16 canais e expansão

Atualmente, o EffeTune suporta até 16 canais de saída.

---

## 4. Perguntas Frequentes

| Pergunta | Resposta |
| ------ | ------ |
| Quais dispositivos são compatíveis com a versão PWA? | A versão PWA pode ser usada nos principais ambientes móveis e desktop, como smartphones/tablets Android, iPhone/iPad, Windows, macOS, Linux e ChromeOS. Por ser uma PWA, ela roda no navegador em vez de ser um app nativo específico do dispositivo; o método de instalação, a seleção de dispositivos de entrada/saída de áudio e os formatos de música compatíveis dependem do navegador e do sistema operacional. |
| Não consigo instalar a versão PWA | Use o botão **Instalar versão PWA** no site do EffeTune ou, no canto superior direito da versão web, abra o menu de engrenagem e escolha **Instalar aplicativo**. Se a opção de instalação não aparecer, abra o site no Chrome ou no Edge, no Android ou no computador. No iPhone/iPad, abra no Safari e use o menu de compartilhamento para adicionar à Tela de Início. Navegadores dentro de outros apps, a navegação privada e navegadores antigos podem não mostrar a opção de instalação. |
| Entrada surround (5.1ch etc.)? | A Web Audio API limita a entrada a 2 canais. A saída e os efeitos suportam até 16 canais. |
| Comprimento recomendado da cadeia de efeitos? | Use tantos efeitos quanto sua CPU permitir sem causar quedas ou alta latência. |
| Como obter a melhor qualidade de som? | Defina a **Taxa de Amostragem** do EffeTune como 96 kHz, comece com efeitos sutis e monitore o headroom com o **Level Meter**. Se houver cortes, primeiro reduza os efeitos mais exigentes ou o número de efeitos ativos; diminua a taxa somente se ainda for necessário. Adicione o **Brickwall Limiter** se necessário. |
| Funciona com qualquer fonte? | Sim. Com um dispositivo de áudio virtual, você pode processar streaming, arquivos locais ou equipamentos físicos. |
| O EffeTune pode reproduzir conteúdo protegido por DRM? | Não diretamente. O EffeTune processa áudio, enquanto o conteúdo protegido é destinado à reprodução apenas em ambientes autorizados pelo provedor e pode não estar disponível para aplicativos de processamento de áudio de terceiros. Use o aplicativo ou site oficial do provedor, respeitando os termos do serviço e os métodos de saída de áudio compatíveis. O EffeTune não remove nem contorna a proteção do conteúdo. |
| Posso usar apenas o player de arquivos de música sem entrada de áudio? | Sim. Se, ao abrir o EffeTune, o som captado pelo microfone estiver vazando para os fones de ouvido, selecione **Nenhum (somente player de arquivos de música)** em **Dispositivo de Entrada:** na **Configuração de Áudio**. O EffeTune mantém a cadeia de efeitos ativa com uma fonte silenciosa, então o player e efeitos geradores de sinal como **Oscillator** continuam funcionando. Se você selecionar uma entrada de áudio, também poderá conectar uma interface de áudio USB ou similar para processar equipamentos externos, ou verificar o sinal de entrada com **Spectrum Analyzer**. |
| Posso processar áudio de outros apps no aplicativo web móvel? | Em geral, não. Navegadores móveis não oferecem uma entrada de loopback genérica para o áudio de outros aplicativos; em dispositivos móveis, o uso do EffeTune normalmente fica centrado no player integrado. |
| Quais formatos de arquivo de música são compatíveis? | Depende dos recursos de decodificação de áudio do navegador e do sistema operacional. Como referência, MP3, WAV e AAC/M4A costumam funcionar na maioria dos ambientes; FLAC, OGG/Vorbis e Opus/WebM variam conforme o ambiente. O aplicativo para desktop do macOS converte automaticamente arquivos Apple Lossless (ALAC) em formato M4A/MP4 para reprodução. O EffeTune também pode reproduzir o áudio de arquivos de vídeo MP4, M4V, MOV, MKV, WebM e 3GP, e o item **Video** do Visualizer pode mostrar a imagem; a compatibilidade depende do codec de áudio interno, sendo AAC a opção compatível mais comum. Se um arquivo não tocar, experimente MP3, AAC/M4A ou WAV. |
| Posso reproduzir vários arquivos de música? | Sim. Em **Abrir arquivos de música**, selecione vários arquivos na janela de seleção de arquivos do dispositivo e abra-os; eles serão carregados como uma lista de reprodução. A disponibilidade de seleção múltipla ou de seleção de todos os arquivos de uma pasta depende do dispositivo, do navegador e da janela de seleção de arquivos. |
| O que a Biblioteca de música faz? | Ela indexa as pastas de música selecionadas para que você possa navegar e pesquisar por faixa, álbum, artista, gênero ou subpasta que contém diretamente o arquivo, e tocar os resultados no EffeTune. Os metadados da biblioteca e as playlists ficam salvos no aplicativo, não nos arquivos de áudio. |
| Onde a Biblioteca de música está disponível? | O aplicativo desktop tem o scanner completo de pastas. Navegadores Chromium usam File System Access quando disponível. Safari e Firefox usam uma importação alternativa, então talvez seja necessário selecionar pastas ou arquivos novamente após recarregar ou perder permissões. |
| Como atualizo ou reconecto pastas da Biblioteca de música? | Use **Reescanear biblioteca de música** depois de adicionar, remover ou editar arquivos. Se uma pasta indicar falta de acesso, use o botão **Reconectar** dela e conceda acesso à mesma pasta novamente. |
| Quais formatos de playlist a Biblioteca de música pode importar ou exportar? | A Biblioteca de música pode importar playlists M3U, M3U8, PLS e XSPF e exportar playlists M3U8 ou XSPF. |
| A Biblioteca de música altera meus arquivos de áudio? | Não. Escaneamento, leitura de metadados, cache de capas, edição de playlists e ações de reprodução ficam dentro do aplicativo e nunca modificam os arquivos de áudio no disco. |
| Não consigo selecionar o dispositivo de saída no aplicativo web | Depende do suporte do navegador e das permissões. Tente usar uma página segura no Chrome/Chromium ou defina o DAC/AMP desejado como saída padrão do sistema operacional ou do navegador. |
| Por que a Taxa de Amostragem ou os Canais de Saída voltaram para outro valor? | A tela de configurações mostra 96 kHz como padrão da Taxa de Amostragem, mas antes de você salvar uma configuração o aplicativo pode iniciar com o padrão do sistema operacional ou do navegador. Na versão Web, o navegador ou o dispositivo pode rejeitar 96 kHz ou outro valor incompatível; nesse caso, o EffeTune usa uma taxa disponível. Confira a taxa de amostragem efetiva exibida no aplicativo. O suporte aos canais de saída também depende do navegador e do dispositivo. |
| Por que o indicador de taxa de amostragem e canais ficou vermelho? | O EffeTune detectou que o processamento dos efeitos ativados não terminou a tempo de acompanhar em tempo real. O aviso vermelho desaparece cerca de 10 segundos após o processamento voltar ao normal. Reduza o número de efeitos ativados. |
| O player web lembra a lista de reprodução? | As configurações de repetição e aleatório são salvas, mas a seleção normal de arquivos não é restaurada após recarregar a página por limitações do navegador. |
| A reprodução móvel continua com a tela desligada? | Não de forma confiável em todos os navegadores, especialmente no iOS. O EffeTune usa Wake Lock quando disponível, mas a reprodução em segundo plano depende do navegador. |
| Qual é a diferença entre os modos de economia de energia do EffeTune? | Abra **Configurações > Configuração... > Economia de energia** (aplicativos Web/PWA e desktop). **Prioridade ao processamento em segundo plano** mantém o processamento da entrada externa ativo durante o silêncio. **Economia de energia equilibrada (Padrão)** reduz o DSP e as atualizações visuais durante o silêncio mantendo a entrada de áudio selecionada conectada. **Economia máxima de energia** também libera a entrada de áudio quando ela permanece em silêncio em segundo plano ou sem uso no modo Player pelo tempo configurado. A entrada não é reiniciada quando um sinal retorna; abra o aplicativo e escolha **Retomar o processamento de áudio** (ou **Retomar a entrada de áudio**) no menu. |
| O que faz “Ignorar DSP de exibição quando oculto”? | Vem ativado por padrão. Quando os gráficos do analisador não estão visíveis (por exemplo, ao navegar na Biblioteca de música, usar o minirreprodutor, durante um Teste duplo-cego ou com a janela minimizada), o EffeTune ignora os efeitos Analyzer para economizar CPU sem alterar o som. Desative se o histórico do analisador precisar continuar atualizando em segundo plano. |
| O que faz “Sincronizar elementos visuais com o áudio”? | Alinha gráficos e medidores ao som que você ouve. Vem desativado por padrão porque pode adicionar latência de áudio (indisponível na extensão do navegador). Dispositivos Bluetooth ou semelhantes ainda podem deixar os elementos visuais ligeiramente fora de sincronia. |
| O que “Limite de silêncio” e “Interromper a entrada de áudio após” alteram? | **Limite de silêncio** (-90 a -20 dBFS em passos de 10 dB) define o nível abaixo do qual o áudio é tratado como silêncio; um valor menor tem menos chance de tratar trechos baixos como silêncio. Em **Economia máxima de energia**, **Interromper a entrada de áudio após** (1/5/15 minutos ou **Nunca**) define quanto tempo a entrada precisa permanecer em silêncio em segundo plano ou sem uso no modo Player antes que o EffeTune a libere. |
| “Prioridade ao processamento em segundo plano” garante processamento com a versão Web/PWA oculta? | Não. Evita que o EffeTune suspenda o processamento da entrada externa durante o silêncio, mas o navegador ou o sistema operacional ainda podem limitar ou suspender abas em segundo plano. |
| Custo do receptor AV vs. interface? | Reutilizar um receptor AV com HDMI é simples. Para configurações centradas em PC, uma interface multicanal mais amplificadores pequenos oferece bom custo e qualidade. |
| Sem som de outros aplicativos logo após instalar o VB-CABLE | A saída padrão do sistema operacional foi alterada para **CABLE Input**. Altere-a de volta nas configurações de som. |
| Apenas os canais 3+4 mudam o volume após a divisão | Coloque um efeito **Volume** após o divisor e defina **Channel** para 3+4. Se colocado antes, todos os canais mudam. |
| Por que um IR Reverb compartilhado soa seco ou informa que falta a IR? | URLs e predefinições armazenam apenas o ID de conteúdo da IR, não o arquivo de áudio. Importe exatamente o arquivo original para religá-lo automaticamente, ou escolha um substituto na **Biblioteca de respostas ao impulso**. Verifique também **Dry** e **Dry Level**: sem a IR, nenhum sinal wet é produzido. |
| Como outra pessoa pode reproduzir meu resultado do IR Reverb? | Compartilhe a predefinição ou a URL junto com o arquivo IR original e suas informações de fonte/licença. O destinatário deve importar o arquivo inalterado; bytes idênticos produzem o mesmo ID. Iguale também a taxa de amostragem de áudio, a seleção de canais de saída e os ajustes do IR Reverb. |

---

## 5. Resposta de Frequência e Correção de Sala

### 5.1. Importando configurações do AutoEQ para o 15Band PEQ

Você pode importar configurações do equalizador AutoEQ diretamente do botão no canto superior direito.

### 5.2. Colando configurações de correção de medição

Copie as configurações do 5Band PEQ da página de medição e cole na visualização do **Effect Pipeline** usando **Ctrl+V** ou o menu.

### 5.3. Usando uma medição multicanal com o Room EQ

Na página de medição, selecione os canais individuais que deseja em **Canal de Saída** para medi-los em uma única sessão. Depois de salvar, o Room EQ mostra uma entrada separada para cada canal, como `Nome da medição [Ch 1]`, nas listas **Measurement Ch 1**, **Measurement Ch 2** e nas outras listas específicas de canal. Em cada lista **Measurement Ch**, selecione a entrada que corresponde àquele canal de saída. O Room EQ não atribui canais automaticamente.

Use **Copiar ajustes de PEQ por canal** quando quiser colar uma correção estática da resposta de frequência no **Effect Pipeline**. Use o Room EQ quando quiser uma correção de sala por canal baseada em resposta ao impulso.

---

## 6. Dicas de Operação de Efeitos

* O fluxo de sinal é de cima para baixo.
* Use o efeito **Matrix** para conversões como 2→4ch ou 16→2ch (defina **Channel = All** no roteamento de bus).
* Gerencie nível, mudo e atraso para até 16 canais com o **MultiChannel Panel**.
* Para um envio/retorno de reverb multicanal, use **Matrix** para copiar os canais de origem desejados para um bus livre, coloque **IR Reverb** nesse bus com **Dry** desativado e **Wet Level** em 0 dB e use os ganhos do Matrix como níveis de envio. Roteie o bus wet de volta apenas para os canais de saída desejados para não duplicar o caminho dry original.

---

## 7. Links de Referência

* EffeTune Desktop: <https://github.com/Frieve-A/effetune/releases>
* Versão Web do EffeTune: <https://effetune.frieve.com/effetune.html>
* Medição de Resposta em Frequência: <https://effetune.frieve.com/features/measurement/measurement.html>
* VB-CABLE: <https://vb-audio.com/Cable/>
* Voicemeeter: <https://vb-audio.com/Voicemeeter/>
* ASIO Link Pro (versão corrigida não oficial): procure por "ASIO Link Pro 2.4.1"

[← Voltar para o README](README.md)
