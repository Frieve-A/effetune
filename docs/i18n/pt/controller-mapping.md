---
title: "Mapeamento de controladores - Controle via MIDI, gamepad e teclado - EffeTune"
description: "Controle os parâmetros de efeitos do EffeTune a partir de controladores MIDI, gamepads e do teclado."
lang: pt
---

# Mapeamento de controladores

O Mapeamento de controladores permite ajustar parâmetros de efeitos sem arrastar os controles na tela. Você pode usar um controlador MIDI, um gamepad ou teclas do teclado enquanto o EffeTune estiver em foco. As alterações usam os mesmos intervalos de parâmetro da interface do efeito e aparecem na tela.

## Adicionar um mapeamento

1. Abra **Configurações** e escolha **Mapeamento de controladores...**.
2. Escolha **Adicionar (Learn)**.
3. Mova um controle MIDI, pressione uma tecla ou acione um botão ou eixo do gamepad.
4. Selecione o efeito de destino, a regra de instância e o parâmetro.
5. Ajuste Mín., Máx., Sensibilidade, a direção ou o modo de entrada, se necessário. As alterações são salvas imediatamente.

Use dois mapeamentos quando quiser botões ou teclas separados para aumentar e diminuir. Defina **Direção** como **Aumentar (+)** em um e **Diminuir (−)** no outro. Se uma tecla aprendida já for um atalho do EffeTune, a janela avisará você; o mapeamento tem prioridade enquanto o aplicativo estiver em foco.

Para mapeamentos de botões, escolha **Modo do botão**: **Alternar** muda o estado a cada pressionamento, enquanto **Momentâneo** o mantém ativo apenas enquanto o controle estiver pressionado.

## Escolher o alvo

- **Primeiro** controla o primeiro efeito correspondente no pipeline atual.
- **Último** controla o último efeito correspondente.
- **Todos** envia o mesmo valor a todos os efeitos correspondentes, usando o primeiro como valor inicial para alterações relativas.
- **Ativado** liga ou desliga um efeito.

**Global** controla o aplicativo e o player de música em vez de um efeito: **Bypass principal**, **Alternar A/B**, **Reproduzir/Pausar**, **Parar**, **Próxima faixa/Faixa anterior**, **Avançar/voltar 10 s**, **Velocidade de reprodução**, **Manter o tom**, **Repetir**, **Aleatório** e **Próxima predefinição/Predefinição anterior**.

- Em **Próxima faixa/Faixa anterior**, **Avançar/voltar 10 s** e **Próxima predefinição/Predefinição anterior**, **Direção** define **Aumentar (+)** (avançar) ou **Diminuir (−)** (voltar). Um encoder sem fim ou uma roda jog segue o sentido do giro.
- **Velocidade de reprodução** muda continuamente com um fader ou knob (`1x` no centro) ou percorre as velocidades padrão quando mapeada para um botão ou tecla.
- **Próxima predefinição/Predefinição anterior** percorre as predefinições do usuário em ordem de nome e volta ao início depois da última.
- As ações do player exigem que o player de música esteja aberto. Se as regras de reprodução automática do navegador bloquearem o início do áudio, pressione primeiro Reproduzir na interface do player.

**Mín.** e **Máx.** limitam o intervalo ativo do parâmetro (na unidade do parâmetro); troque um pelo outro para inverter o sentido do controle. **Sensibilidade** ajusta o tamanho do passo relativo (comece em `1`).

## Adicionar automação por tempo ou aleatória

Escolha **Adicionar automação** quando quiser que um parâmetro numérico de efeito mude automaticamente, sem um controlador físico. Selecione primeiro o efeito e o parâmetro de destino e depois configure estes controles:

- **Fonte**: Escolha **Temporizador** (padrão, intervalo de 1 segundo) ou **Relógio**.
- **Relógio**: **Unidade de tempo** seleciona **Hora**, **Minuto** ou **Segundo**, e **Onda** seleciona **Ascendente**, **Seno** ou **Cosseno**. A hora local atual é lida uma vez por segundo e mapeada entre **Mín.** e **Máx.**.
- **Temporizador**: **Agendamento** oferece **Intervalo**, **Uma vez** e **Diário**. **Intervalo** usa **Intervalo (segundos)** de `1` a `2.147.483,647` segundos. **Uma vez** dispara em uma **Data** e **Hora** locais; **Diário** dispara em uma **Hora** local uma vez por dia do calendário.
- **Ação** (Temporizador e mapeamentos numéricos de botão/tecla): **Alterar pela quantidade** soma ou subtrai a **Quantidade** a cada vez, **Valor aleatório no intervalo** escolhe um novo valor entre **Mín.** e **Máx.**, e **Passo aleatório a partir do valor atual** sobe ou desce aleatoriamente pela **Quantidade**.

As automações de Relógio e Temporizador se aplicam apenas a parâmetros numéricos de efeitos (não a **Ativado**, parâmetros de lista nem operações **Global**) e são executadas no máximo uma vez por segundo. Se o aplicativo ou o computador estiver pausado ou em suspensão quando um temporizador de **Intervalo** vencer, o EffeTune aplica um único passo ao retomar e começa o próximo intervalo a partir daí. Um agendamento **Uma vez** cujo horário passou enquanto o EffeTune estava fechado é marcado como **Expirado**; defina uma **Data** ou **Hora** futura para ativá-lo novamente.

### Exemplos práticos

- Radius do Vinyl Simulator: Use **Temporizador**, defina **Intervalo (segundos)** como `1`, escolha **Alterar pela quantidade**, defina **Direção** como **Diminuir (−)** e **Quantidade** como `1 mm`, e defina **Mín.** e **Máx.** como `60` e `146 mm` para que a agulha vá da borda externa até o sulco interno e pare em **Mín.**.
- Variação de timbre ao longo do dia: Use **Relógio** com **Minuto** e **Seno** para varrer suavemente um parâmetro numérico do Radio Simulator entre **Mín.** e **Máx.**.
- Deriva aleatória lenta: Use **Temporizador** com um intervalo maior e **Passo aleatório a partir do valor atual**, começando com uma **Quantidade** pequena para que as mudanças continuem graduais.
- Alteração agendada: Selecione **Uma vez** para uma única data e hora locais, ou **Diário** para o mesmo horário local todos os dias.

## Tipos de entrada

### MIDI

O EffeTune oferece suporte a MIDI CC, notas e pitch bend via Web MIDI (disponível em navegadores Chromium, no Firefox e no aplicativo desktop; sem suporte no Safari). Dispositivos genéricos usam entrada CC absoluta por padrão; selecione um modo relativo para encoders sem fim. BLE-MIDI e MIDI em rede funcionam quando aparecem como portas MIDI do sistema operacional.

### Mackie Control (MCU)

Defina o protocolo do dispositivo como **MCU** em superfícies de controle compatíveis. Há suporte a faders motorizados, toque no fader, entrada V-Pot, anéis de LED e LEDs de botões (texto do LCD, medidores de nível, displays de timecode e handshakes de dispositivo não são usados). Refaça o aprendizado dos mapeamentos depois de alternar um dispositivo entre **Generic** e **MCU**.

### Gamepad

Os botões podem alternar parâmetros ou alterá-los em passos e repetem enquanto são mantidos pressionados. Os eixos usam o modo relativo por padrão, para que os analógicos com retorno ao centro deixem o parâmetro onde você os soltou; mude para o modo absoluto em eixos do tipo acelerador, que permanecem na posição.

### Teclado

Os mapeamentos de teclado funcionam enquanto o EffeTune estiver em foco e são ignorados durante a digitação em campos de texto. Mapeamentos de alternância ignoram a repetição de tecla, enquanto os de aumento/diminuição se repetem na taxa de repetição de teclas do sistema operacional quando mantidos pressionados.

## Conexão e solução de problemas

Cada dispositivo MIDI mostra **Conectado** ou **Desconectado** abaixo do nome. Os mapeamentos continuam salvos quando um controlador é desconectado e voltam a funcionar automaticamente quando retorna um dispositivo com o mesmo nome de porta MIDI ou de gamepad. Se uma atualização de driver ou do sistema operacional mudar o nome do dispositivo, refaça o aprendizado dos mapeamentos afetados. Gamepads com o mesmo nome compartilham os mapeamentos, e portas MIDI com o mesmo nome são diferenciadas apenas pela ordem em que são conectadas. Se os dispositivos MIDI não aparecerem, conceda a permissão de MIDI e abra **Mapeamento de controladores...** novamente. Usuários do Safari ainda podem usar os mapeamentos de teclado e de gamepad.

[← Voltar para o README](README.md)
