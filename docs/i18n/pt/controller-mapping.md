---
title: "Mapeamento de controladores - EffeTune"
description: "Controle parâmetros do EffeTune por MIDI, comando ou teclado."
lang: pt
---

# Mapeamento de controladores

Esta função permite ajustar parâmetros sem arrastar os controlos no ecrã. Pode usar um controlador MIDI, um comando ou teclas enquanto o EffeTune tiver o foco; as alterações também aparecem na interface.

## Adicionar um mapeamento

1. Abra **Settings** e escolha **Mapeamento de controladores...**.
2. Escolha **Adicionar (Learn)** e mova o controlo, prima a tecla ou use o comando.
3. Selecione o efeito, a regra de instância e o parâmetro.
4. Se necessário, ajuste Min, Max, Sensitivity, a direção ou o modo. As alterações são guardadas imediatamente.

Para botões separados de aumento e redução, crie dois mapeamentos: um **+** e outro **−**. Se uma tecla coincidir com um atalho do EffeTune, aparece um aviso e o mapeamento tem prioridade enquanto a aplicação tiver o foco.

Para mapeamentos de botões, escolha **Modo do botão**: **Alternar** muda o estado a cada pressão, enquanto **Momentâneo** só fica ativo enquanto mantém o controlo premido.

## Automatizar pelo tempo ou aleatoriamente

Escolha **Adicionar automatização** para alterar um parâmetro numérico sem um controlador físico. O novo mapeamento começa com um **Temporizador** de um segundo. Com **Relógio**, escolha **Hora**, **Minuto** ou **Segundo** e uma onda **Ascendente**, **Seno** ou **Cosseno**. A hora local é lida uma vez por segundo e aplicada entre Mín. e Máx.

Com o Temporizador, defina **Intervalo (segundos)** como 1 ou mais. **Alterar pela quantidade** soma ou subtrai a **Quantidade** em cada evento; **Valor aleatório no intervalo** escolhe um novo valor entre Mín. e Máx.; **Passo aleatório a partir do valor atual** sobe ou desce a partir do valor em uso.

O **Agendamento** oferece **Intervalo**, **Uma vez** e **Diário**. O intervalo vai de 1 a 2 147 483,647 segundos e mede o tempo decorrido enquanto a aplicação está em execução. Se houver atraso, só é aplicada uma alteração, o intervalo seguinte recomeça nesse momento e os eventos perdidos não são repetidos. Uma vez usa a **Data** e a **Hora** locais; Diário usa a hora local e espera pelo dia seguinte se a hora de hoje já passou. Ambos seguem o calendário e o relógio locais do computador, incluindo alterações manuais e o horário de verão; Diário é executado no máximo uma vez por data local. Um horário passado aparece como **Expirado** e não é recuperado; altere a data ou a hora para o futuro para o reativar.

Relógio e Temporizador só controlam parâmetros numéricos de efeitos, não Enabled, listas, Master Bypass ou A/B Toggle. As ações aleatórias também estão disponíveis para botões ou teclas físicos mapeados para um parâmetro numérico. Se a aplicação ou o computador atrasarem um evento, é aplicada uma única alteração ao retomar, sem repetir os eventos perdidos. A mesma configuração não produz sempre a mesma sequência aleatória.

**Primeiro** e **Último** escolhem a primeira ou a última instância correspondente. **Todos** aplica o mesmo valor a todas e usa a primeira como ponto de partida relativo. **Enabled** liga ou desliga o efeito; **Global** inclui Master Bypass e A/B Toggle. Min e Max limitam o curso e são introduzidos na unidade apresentada para o parâmetro; troque-os para inverter a direção. Comece com Sensitivity 1.

## Fontes de controlo

- **MIDI:** suporta CC, notas e pitch bend através de Web MIDI. CC começa no modo absoluto; escolha o modo relativo adequado para um encoder sem fim. Chromium e Firefox suportam Web MIDI, mas Safari não. BLE-MIDI e MIDI de rede funcionam quando o sistema os apresenta como portas MIDI.
- **Mackie Control (MCU):** selecione **MCU** como protocol. São suportados faders motorizados e toque, V-Pot e anéis LED, e LED dos botões. Texto LCD, medidores, mostrador de tempo e handshake não são suportados. Depois de alternar entre Generic e MCU, faça Learn novamente.
- **Comando:** os botões avançam ou alternam parâmetros e podem repetir quando mantidos para valores contínuos ou listas. Os eixos começam em modo relativo, ideal para sticks que regressam ao centro; use absoluto para controlos sem retorno ao centro.
- **Teclado:** só funciona com o EffeTune em foco e não atua durante a escrita em campos de texto. Os toggles ignoram a repetição do sistema; aumentar e reduzir podem repetir.

## Ligação e resolução de problemas

Os mapeamentos permanecem guardados após desligar e retomam quando regressa um dispositivo com o mesmo nome. Se uma alteração do sistema ou do controlador mudar o nome, faça Learn novamente nos mapeamentos afetados. Comandos idênticos partilham mapeamentos e portas MIDI com o mesmo nome distinguem-se apenas pela ordem de ligação.

Se não aparecerem dispositivos MIDI, permita o acesso MIDI ao EffeTune e reabra a janela. No Safari, teclado e comando continuam disponíveis.
