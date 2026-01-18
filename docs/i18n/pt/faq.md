---
title: "FAQ & Troubleshooting - EffeTune"
description: "Frequently asked questions and troubleshooting guide for Frieve EffeTune audio processor."
lang: en
---

# FAQ do EffeTune

O EffeTune é uma aplicação DSP em tempo real para entusiastas de áudio disponível como aplicativo web e aplicativo desktop. Este documento aborda configuração, solução de problemas, uso multicanal, operação de efeitos e correção de frequência.

## Conteúdo

1. Configuração Inicial para Streaming
   1.1. Instalando o VB-CABLE e usando 96 kHz
   1.2. Entrada de serviço de streaming (exemplo do Spotify)
   1.3. Configurações de áudio do EffeTune
   1.4. Verificação de operação
2. Solução de Problemas
   2.1. Qualidade de reprodução de áudio
   2.2. Uso da CPU
   2.3. Eco
   2.4. Problemas de entrada, saída ou efeitos
   2.5. Incompatibilidade de saída multicanal
3. Conexões Multicanal e Hardware
   3.1. HDMI + receptor AV
   3.2. Interfaces sem drivers multicanal
   3.3. Atraso de canal e alinhamento de tempo
   3.4. Limite de 8 canais e expansão
4. Perguntas Frequentes
5. Resposta de Frequência e Correção de Sala
6. Dicas de Operação de Efeitos
7. Links de Referência

---

## 1. Configuração Inicial para Streaming

Exemplo no Windows: Spotify → VB-CABLE → EffeTune → DAC/AMP. Os conceitos são semelhantes para outros serviços e sistemas operacionais.

### 1.1. Instalando o VB-CABLE e habilitando 96 kHz

Baixe o VB-CABLE Driver Pack45, execute o `VBCABLE_Setup_x64.exe` como administrador e reinicie. Retorne a saída padrão do sistema operacional para seus alto-falantes/DAC e defina ambos os formatos **CABLE Input** e **CABLE Output** para 24 bits, 96.000 Hz. Execute o `VBCABLE_ControlPanel.exe` como administrador, escolha **Menu▸Internal Sample Rate = 96000 Hz** e, em seguida, clique em **Restart Audio Engine**.

### 1.2. Roteamento do serviço de streaming (exemplo do Spotify)

Abra **Settings▸System▸Sound▸Volume mixer** e defina a saída do `Spotify.exe` para **CABLE Input**. Reproduza uma faixa para confirmar o silêncio dos alto-falantes.
No macOS, utilize o **SoundSource** da Rogue Amoeba para atribuir a saída do Spotify ao **CABLE Input** da mesma forma.

### 1.3. Configurações de áudio do EffeTune

Inicie o aplicativo desktop e abra **Config Audio**.
- **Input Device:** CABLE Output (VB-Audio Virtual Cable)
- **Output Device:** DAC/Alto-falantes físicos
- **Sample Rate:** 96.000 Hz (taxas mais baixas podem degradar a qualidade)

### 1.4. Verificação de operação

Com o Spotify tocando, alterne o **ON/OFF** principal no EffeTune e confirme se o som muda.

---

## 2. Solução de Problemas

### 2.1. Problemas de qualidade de reprodução de áudio

| Sintoma | Solução |
| ------ | ------ |
| Quedas ou falhas | Clique no botão **Reset Audio** no canto superior esquerdo do aplicativo web ou escolha **Reload** no menu **View** no aplicativo desktop. Reduza o número de efeitos ativos, se necessário. |
| Distorção ou clipping | Insira o **Level Meter** no final da cadeia e mantenha os níveis abaixo de 0 dBFS. Adicione o **Brickwall Limiter** antes do Level Meter, se necessário. |
| Aliasing acima de 20 kHz | O VB-CABLE ainda pode estar rodando a 48 kHz. Verifique novamente a configuração inicial. |

### 2.2. Alto uso de CPU

Desative os efeitos que você não está usando ou remova-os do **Effect Pipeline**.

### 2.3. Eco

Seus dispositivos de entrada e saída podem estar em loop. Certifique-se de que a saída do EffeTune não retorne à sua entrada.

### 2.4. Problemas de entrada, saída ou efeitos

| Sintoma | Solução |
| ------ | ------ |
| Sem entrada de áudio | Certifique-se de que o player esteja enviando saída para **CABLE Input**. Permita a permissão do microfone no navegador e selecione **CABLE Output** como dispositivo de entrada. |
| Efeito não funcionando | Confirme se o master, cada efeito e qualquer **Section** estão **ON**. Redefina os parâmetros, se necessário. |
| Sem saída de áudio | Para o aplicativo web, verifique se as saídas do sistema operacional e do navegador apontam para seu DAC/AMP. Para o aplicativo desktop, verifique o dispositivo de saída em **Config Audio**. |
| Outros players reportam "CABLE Input em uso" | Certifique-se de que nenhum outro aplicativo esteja usando **CABLE Input**. |

### 2.5. Incompatibilidade de saída multicanal

O EffeTune envia canais na ordem 1→2→…→8. Se o Windows estiver configurado para 4 canais, os canais traseiros podem ser mapeados para o centro/sub. **Solução alternativa:** defina o dispositivo para 7.1ch, envie 8ch do EffeTune e use os canais 5 e 6 para áudio traseiro.

---

## 3. Conexões Multicanal e Hardware

### 3.1. HDMI + receptor AV

Configure a saída HDMI do seu PC para 7.1ch e conecte-a a um receptor AV. O EffeTune pode enviar até 8 canais através de um único cabo. Receptores mais antigos podem degradar a qualidade do som ou remapear canais inesperadamente.

### 3.2. Interfaces sem drivers multicanal (ex., MOTU M4)

Out 1‑2 e Out 3‑4 aparecem como dispositivos separados, impedindo a saída de 4 canais. Soluções alternativas:
- Use o **Voicemeeter** para mesclar canais via ASIO.
- Use o **ASIO Link Pro** para expor um dispositivo virtual de 4 canais (avançado).

### 3.3. Atraso de canal e alinhamento de tempo

Use o **MultiChannel Panel** ou **Time Alignment** para atrasar canais em passos de 10 µs (mínimo de 1 amostra). Para grandes atrasos, atrase os canais frontais em 100-400 ms. A sincronização de vídeo deve ser ajustada no lado do player.

### 3.4. Limite de 8 canais e expansão

Os drivers de sistema operacional atuais suportam até 8 canais. O EffeTune pode suportar mais canais quando os sistemas operacionais permitirem.

---

## 4. Perguntas Frequentes

| Pergunta | Resposta |
| ------ | ------ |
| Entrada surround (5.1ch etc.)? | A Web Audio API limita a entrada a 2 canais. A saída e os efeitos suportam até 8 canais. |
| Comprimento recomendado da cadeia de efeitos? | Use tantos efeitos quanto sua CPU permitir sem causar quedas ou alta latência. |
| Como obter a melhor qualidade de som? | Use 96 kHz ou superior, comece com configurações sutis, monitore o headroom com o **Level Meter** e adicione o **Brickwall Limiter**, se necessário. |
| Funciona com qualquer fonte? | Sim. Com um dispositivo de áudio virtual, você pode processar streaming, arquivos locais ou equipamentos físicos. |
| Custo do receptor AV vs. interface? | Reutilizar um receptor AV com HDMI é simples. Para configurações centradas em PC, uma interface multicanal mais amplificadores pequenos oferece bom custo e qualidade. |
| Sem som de outros aplicativos logo após instalar o VB-CABLE | A saída padrão do sistema operacional foi alterada para **CABLE Input**. Altere-a de volta nas configurações de som. |
| Apenas os canais 3+4 mudam o volume após a divisão | Coloque um efeito **Volume** após o divisor e defina **Channel** para 3+4. Se colocado antes, todos os canais mudam. |

---

## 5. Resposta de Frequência e Correção de Sala

### 5.1. Importando configurações do AutoEQ para o 15Band PEQ

A partir do EffeTune v1.51 ou posterior, você pode importar configurações do equalizador AutoEQ diretamente do botão no canto superior direito.

### 5.2. Colando configurações de correção de medição

Copie as configurações do 5Band PEQ da página de medição e cole na visualização do **Effect Pipeline** usando **Ctrl+V** ou o menu.

---

## 6. Dicas de Operação de Efeitos

* O fluxo de sinal é de cima para baixo.
* Use o efeito **Matrix** para conversões como 2→4ch ou 8→2ch (defina **Channel = All** no roteamento de bus).
* Gerencie nível, mudo e atraso para até 8 canais com o **MultiChannel Panel**.

---

## 7. Links de Referência

* EffeTune Desktop: <https://github.com/Frieve-A/effetune/releases>
* Versão Web do EffeTune: <https://effetune.frieve.com/features/measurement/measurement.html>
* VB-CABLE: <https://vb-audio.com/Cable/>
* Voicemeeter: <https://vb-audio.com/Voicemeeter/>
* ASIO Link Pro (versão corrigida não oficial): procure por "ASIO Link Pro 2.4.1"
