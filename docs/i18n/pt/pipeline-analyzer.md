---
title: "Pipeline Analyzer - Resposta em frequência e fase da cadeia de efeitos - EffeTune"
description: "O Pipeline Analyzer mede a resposta em frequência, a fase, o atraso de grupo, a resposta ao impulso, a distorção e o decaimento do Effect Pipeline ativo sem alterar o áudio que você ouve."
lang: pt
---

# Pipeline Analyzer

O Pipeline Analyzer mede a resposta do Effect Pipeline ativo sem alterar o áudio que você ouve. Ele fica ao lado do pipeline em janelas largas ou abaixo do cabeçalho em janelas estreitas, permitindo ajustar efeitos enquanto acompanha a atualização da resposta.

Abra-o pelo botão de gráfico no cabeçalho do Effect Pipeline ou por **Visualizar > Pipeline Analyzer** no aplicativo desktop. Quando **Auto** está ativado, edições no pipeline iniciam uma nova medição automaticamente. Desmarque **Auto** para que as edições no pipeline só sejam medidas novamente quando você clicar em **Refresh measurements**; alterar os canais, as respostas de alto-falante ou as configurações de medição sempre inicia uma nova medição.

## Escolha de canais e respostas de alto-falante

Selecione um canal de entrada do pipeline ativo (até 16 canais) e até quatro canais de saída usando **+ Add Output**. Pelo menos uma saída sempre permanece, portanto a última não pode ser removida. Excluir uma saída também remove a resposta de alto-falante configurada para ela.

Cada saída pode usar **No speaker IR** ou um ponto de medição salvo para o alto-falante ou driver conectado:

- **Sem IRs de alto-falante:** **Before** é um impulso de referência plano ideal e **After** mostra apenas a resposta do pipeline de efeitos.
- **Com IRs de alto-falante:** **Before** é a resposta combinada das medições de alto-falante selecionadas e **After** é a resposta combinada após o pipeline processar cada saída. Isso permite verificar um **Channel Divider** ou **FIR Crossover** junto com as medições reais dos drivers.

Uma resposta salva que não está mais disponível continua selecionada, mas aparece como — até você substituí-la ou limpá-la.

Como medições separadas de alto-falantes são alinhadas pelos inícios detectados e não preservam diferenças físicas de tempo de chegada entre drivers, configure o atraso relativo e a polaridade dos drivers no pipeline antes de avaliar a resposta somada.

## Configurações de medição

Abra **Measurement settings** para ajustar como o pipeline é medido:

- **Signal:** **Log Sweep** (padrão), **MLS**, **TSP** ou **Unit Impulse**. Use **Log Sweep** para examinar também a distorção harmônica. A varredura vai de 20 Hz a 20 kHz, dentro dos limites da taxa de amostragem. **MLS** e **TSP** usam sinais periódicos; **Unit Impulse** captura diretamente a resposta ao impulso.
- **Level:** Nível de pico do sinal de teste (padrão `-12 dBFS`). Filtros lineares apresentam a mesma resposta em qualquer nível, enquanto compressores, saturadores e outros efeitos dependentes de nível mudam conforme **Level**.
- **Requested sweep length** (**Log Sweep**) / **Sequence Length** (outros sinais): **Log Sweep** usa `131072` amostras por padrão e pode prolongar a varredura para separar harmônicos; os valores reais de **Sweep length** e **Total stimulus time** aparecem após a medição. A resposta cobre apenas até 1,5 segundo após o pico principal do impulso, mesmo que a varredura seja mais longa. Para examinar caudas de reverb, delays ou ressonâncias mais longos, escolha **MLS**, **TSP** ou **Unit Impulse** e aumente **Sequence Length** conforme necessário.
- **Stabilization Periods:** Número de períodos reproduzidos antes da captura (padrão `12`, usado por MLS e TSP) para que efeitos de variação lenta se estabilizem. Essa opção não está disponível com **Log Sweep** nem **Unit Impulse**.
- **Averages:** Número de capturas usadas na média (padrão `2`, usado por **Log Sweep**, MLS e TSP) para reduzir variações.

## Leitura dos gráficos

Use o seletor **Graph** acima do gráfico para alternar entre as vistas sem medir novamente:

- **Frequency:** Resposta de magnitude (dB) por frequência, referenciada a 0 dB.
- **Phase:** Resposta de fase (graus) por frequência.
- **Min Group Delay:** Atraso de grupo implícito na resposta de magnitude de fase mínima.
- **Excess Group Delay:** Atraso de grupo restante após remover a parte de fase mínima (o gráfico é limitado a ±100 ms, enquanto as leituras do cursor mostram o valor real), facilitando identificar atraso puro e tempos de fase linear ou all-pass.
- **Impulse:** Resposta ao impulso no domínio do tempo de `-2 ms` até **Impulse Range (ms)**, normalizada pelo pico.
- **Distortion:** Com **Log Sweep**, mostra a distorção harmônica como porcentagem da fundamental ao longo das frequências. H2, H3 e THD (ordens 2–3) aparecem inicialmente; H4–H10 podem ser adicionadas sem repetir a medição. Quanto maior o valor, maior a distorção. Se esse gráfico não estiver disponível com outro sinal, selecione **Log Sweep**. Uma saída silenciosa ou sem dados válidos não permite calcular a distorção. As respostas de alto-falante salvas contribuem com sua resposta linear, não com a distorção do próprio alto-falante.
- **Waterfall:** Mostra frequência, nível relativo (dB) e tempo de decaimento (ms). Em **Response**, escolha **After** (padrão) ou **Before** para examinar a saída do pipeline ou as respostas de alto-falante selecionadas antes do processamento. Cada vista é normalizada pelo próprio pico; compare a forma do decaimento, não os níveis absolutos. Arraste para girar o gráfico 3D e use a roda do mouse ou o gesto de pinça para ampliar ou reduzir.

Nos gráficos de frequência, fase, atraso de grupo e impulso, passe o cursor para ler os valores de **Before** e **After** nessa posição; passe o cursor sobre o rótulo **Before** na legenda para ocultar **After** temporariamente. Use **Smoothing (oct)** nos gráficos de frequência, fase e atraso de grupo, e **Impulse Range (ms)** no gráfico de impulso.

## Como funciona a medição

O Pipeline Analyzer captura o pipeline ativo, seu roteamento e quaisquer respostas de alto-falante selecionadas, compensando automaticamente em **After** a latência informada pelo pipeline. Para efeitos não lineares, modulados ou aleatórios, interprete o gráfico como um instantâneo das configurações e do **Level** atuais.

[← Voltar para o README](README.md)
