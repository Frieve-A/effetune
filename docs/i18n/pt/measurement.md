---
title: "Medição e Correção de Resposta em Frequência - EffeTune"
description: "Meça a resposta em frequência do seu sistema de áudio com um microfone no EffeTune, crie um EQ de correção e importe, calibre e exporte respostas ao impulso."
lang: pt
---

# Medição e Correção de Resposta em Frequência

Para medir a resposta em frequência do seu sistema de áudio e criar uma correção de EQ plana:
1. Abra a [ferramenta de medição de resposta em frequência](https://effetune.frieve.com/features/measurement/measurement.html) ou selecione **Medição da resposta em frequência** no menu **Configurações**.
2. Siga a configuração guiada para ajustar seu microfone de medição e dispositivo de saída.
3. Meça a resposta em frequência do seu sistema em uma ou mais posições de escuta.
4. Gere uma correção de EQ paramétrico que pode ser importada diretamente no EffeTune.
5. Aplique a correção para obter uma reprodução sonora mais precisa e neutra.

## Canais de saída

Defina **Número de canais do dispositivo de saída** conforme a configuração do dispositivo: **6** para 5.1 ou **8** para 7.1. As opções de canal de saída e de largura de banda por canal ficam limitadas a esse intervalo. Os sinais de teste e as medições sempre usam esse número de canais, portanto mantenha **6** mesmo ao medir somente Ch 3 (central) e Ch 4 (subwoofer) em um dispositivo 5.1.

Para um sistema multicanal, selecione **Todos os Canais** para medir todas as saídas juntas, ou itens individuais de **Canal de Saída** para medi-los um por vez. Em **Configurações avançadas**, escolha **Desativado**, **A mesma para todos os canais** ou **Por canal** para a largura de banda do sweep. Com **Por canal**, use **Canal a configurar** para definir a faixa de frequências de cada canal de saída selecionado. Durante o ajuste de nível, o **Modo de canal** começa em **Rotação automática**; selecione um canal de sinal de teste ou **Manual** quando necessário.

## Importar uma resposta ao impulso

Se você já tiver um arquivo WAV de resposta ao impulso, escolha **Importar** e selecione-o. O EffeTune salva cada canal do WAV como um resultado de medição, que pode ser usado no **Room EQ** e em outros recursos baseados em medições.

## Calibrar a interface de áudio

Para remover a resposta da própria interface de áudio, conecte diretamente a saída à entrada e salve esse loopback como uma medição normal sem calibração, com uma resposta ao impulso. Na medição dos alto-falantes, selecione esse ponto salvo em **Calibração da interface de áudio**, mantendo a mesma interface, os mesmos canais, a mesma taxa de amostragem e as mesmas configurações de ganho de entrada e saída. Escolha **Nenhuma (sem calibração)** para medir sem a calibração por loopback.

## Ver e exportar resultados

As medições que contêm dados de resposta ao impulso mostram um gráfico normalizado de **Resposta ao impulso**, que abre exibindo de 0 a 10 ms a partir do início detectado. Use a roda do mouse ou os botões para ajustar o zoom do eixo de tempo e arraste o gráfico ou use o controle deslizante para percorrê-lo. Ao selecionar um ponto, o gráfico é atualizado; **Todos (média)** mostra o primeiro ponto com uma resposta ao impulso salva e o identifica acima do gráfico. Use **Exportar resposta ao impulso (WAV)** abaixo do gráfico para salvar a resposta completa e não normalizada do ponto exibido como um WAV mono de ponto flutuante de 32 bits na taxa de amostragem da medição.

Para inspecionar as respostas Frequency, Phase, Min Group Delay, Excess Group Delay e Impulse do pipeline ativo, incluindo até quatro saídas selecionadas e, opcionalmente, respostas de alto-falantes salvas, consulte o [guia do Pipeline Analyzer](pipeline-analyzer.md).

[← Voltar para o README](README.md)
