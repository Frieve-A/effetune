---
title: "Pipeline Analyzer - Resposta em frequência e fase da cadeia de efeitos - EffeTune"
description: "O Pipeline Analyzer mede a resposta em frequência, a fase, o atraso de grupo e a resposta ao impulso do Effect Pipeline ativo sem alterar o áudio que você ouve."
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

- **Signal:** **MLS** (padrão), **TSP** ou **Unit Impulse**. MLS e TSP usam sinais de teste periódicos (`2^n - 1` e `2^n` amostras), enquanto **Unit Impulse** captura diretamente a resposta ao impulso no domínio do tempo (`2^n` amostras).
- **Level:** Nível de pico do sinal de teste (padrão `-12 dBFS`). Filtros lineares apresentam a mesma resposta em qualquer nível, enquanto compressores, saturadores e outros efeitos dependentes de nível mudam conforme **Level**.
- **Sequence Length:** Comprimento da janela de medição. Aumente-o ao medir reverb, delay ou filtros íngremes de baixa frequência com ressonância longa, especialmente quando o analisador recomendar um comprimento maior.
- **Stabilization Periods:** Número de períodos reproduzidos antes da captura (padrão `12`, usado por MLS e TSP) para que efeitos de variação lenta se estabilizem.
- **Averages:** Número de períodos capturados calculados na média (padrão `2`, usado por MLS e TSP) para reduzir variações.

## Leitura dos gráficos

Use o seletor **Graph** acima do gráfico para alternar entre as vistas sem medir novamente:

- **Frequency:** Resposta de magnitude (dB) por frequência, referenciada a 0 dB.
- **Phase:** Resposta de fase (graus) por frequência.
- **Min Group Delay:** Atraso de grupo implícito na resposta de magnitude de fase mínima.
- **Excess Group Delay:** Atraso de grupo restante após remover a parte de fase mínima (o gráfico é limitado a ±100 ms, enquanto as leituras do cursor mostram o valor real), facilitando identificar atraso puro e tempos de fase linear ou all-pass.
- **Impulse:** Resposta ao impulso no domínio do tempo de `-2 ms` até **Impulse Range (ms)**, normalizada pelo pico.

Passe o cursor sobre o gráfico para ler os valores de **Before** e **After** na posição do cursor; passe o cursor sobre o rótulo **Before** na legenda para ocultar **After** temporariamente. Use **Smoothing (oct)** nos gráficos de frequência, fase e atraso de grupo, e **Impulse Range (ms)** no gráfico de impulso.

## Como funciona a medição

O Pipeline Analyzer captura o pipeline ativo, seu roteamento e quaisquer respostas de alto-falante selecionadas, compensando automaticamente em **After** a latência informada pelo pipeline. Se uma cauda de reverb ou ressonância de filtro ultrapassar **Sequence Length**, aumente **Sequence Length** para evitar sobreposição (MLS/TSP) ou truncamento (**Unit Impulse**). Para efeitos não lineares, modulados ou aleatórios, interprete o gráfico como um instantâneo das configurações e do **Level** atuais.

[← Voltar para o README](README.md)
