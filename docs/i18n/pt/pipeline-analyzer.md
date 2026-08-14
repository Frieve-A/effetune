# Pipeline Analyzer

O Pipeline Analyzer mede a resposta do Effect Pipeline ativo sem alterar o áudio que você ouve. Em janelas largas, ele fica ao lado do pipeline; em janelas estreitas, vai para baixo do cabeçalho. Assim, você pode ajustar um efeito e acompanhar a atualização do resultado.

Abra-o pelo botão de gráfico no cabeçalho do Effect Pipeline ou por **View > Pipeline Analyzer** no aplicativo para desktop. Com **Auto** selecionado, as alterações no pipeline iniciam outra medição automaticamente. Desmarque **Auto** para medir as alterações no pipeline somente ao selecionar **Refresh measurements**. Alterações nas configurações de medição sempre iniciam uma nova medição.

## Escolha de canais e respostas de alto-falante

Escolha um canal de entrada. Uma saída aparece inicialmente; use **+ Add Output** para incluir até quatro canais distintos disponíveis no dispositivo atual. Excluir uma saída também remove a configuração de resposta correspondente. A última saída não pode ser excluída.

Cada saída pode usar **No speaker IR** ou um ponto de medição salvo do tweeter, woofer ou outro componente conectado. Escolher uma medição sem escolher um ponto equivale a **No speaker IR**. Quando nenhuma saída usa uma IR de alto-falante, **Before** é o impulso unitário ideal: 1,0 em 0 ms e 0 no restante. Com IRs de alto-falante, **Before** é a soma com sinal das respostas alinhadas. **After** é a soma com sinal após processar cada saída pelo pipeline escolhido, permitindo analisar um FIR Crossover junto com seus componentes. Se uma resposta salva estiver ausente, ela continuará marcada como ausente até ser substituída ou removida.

As respostas salvas são alinhadas pelo início detectado. Medições separadas não preservam a diferença de chegada acústica entre componentes; ajuste o atraso relativo e a polaridade no pipeline antes de avaliar a resposta combinada.

## Configurações de medição

Abra **Measurement settings** para ajustar:

- **Signal** usa **MLS** por padrão. **TSP** é um sinal de teste periódico alternativo, enquanto **Unit Impulse** captura diretamente a resposta no tempo. Os sinais podem medir o pipeline de formas diferentes quando os efeitos são não lineares ou variam com o tempo.
- **Level** define o pico do sinal de teste e tem o padrão de `-12 dBFS`. Efeitos lineares normalmente apresentam a mesma resposta normalizada em qualquer nível; efeitos não lineares ou dependentes do nível podem produzir outro resultado.
- **Sequence Length** determina por quanto tempo MLS ou TSP consegue medir uma resposta sem sobreposição. Valores maiores exigem mais tempo e memória. Aumente-o para delay, reverb ou outros efeitos com cauda longa, principalmente quando o analisador recomendar um valor maior.
- **Stabilization Periods** tem o padrão de 12 e dá tempo para o pipeline se estabilizar antes da captura. Aumente-o se efeitos lentos ainda não tiverem alcançado um estado estável.
- **Averages** tem o padrão de 2. Aumente-o para reduzir a variação entre medições quando o gráfico estiver instável; a medição levará mais tempo.

Os detalhes mostram se o comprimento atual é suficiente, o comprimento e o tempo de estabilização recomendados e o tempo total da medição. As recomendações servem de orientação; aplique-as quando forem adequadas aos efeitos medidos.

Sequence Length, Stabilization Periods e Averages ficam desativados somente com Unit Impulse. Alternar entre Frequency, Phase, Min Group Delay, Excess Group Delay e Impulse muda apenas o gráfico, sem refazer a medição.

## Leitura dos gráficos

- Use os botões de opção **Graph** fora do gráfico para escolher a resposta exibida.
- **Frequency** mostra o nível por frequência.
- **Phase** mostra a fase por frequência.
- **Min Group Delay** mostra o atraso implícito na parte de fase mínima da resposta de magnitude.
- **Excess Group Delay** mostra o atraso restante depois de remover a parte de fase mínima, facilitando separar atraso puro e outros tempos de fase não mínima.
- **Impulse** mostra a resposta ao longo do tempo.

O gráfico sempre mostra **Before** e **After**. Mova o ponteiro para ler as duas curvas na mesma frequência ou instante; ao passar sobre **Before**, **After** fica oculto temporariamente para facilitar a comparação. **Smoothing (oct)** e **Impulse Range (ms)** permanecem visíveis em todos os gráficos para que o layout não se mova. Smoothing fica ativo em Frequency e nos dois gráficos de Group Delay; Impulse Range fica ativo em Impulse. Os controles que não afetam o gráfico escolhido ficam desativados. Cada curva de frequência é referenciada separadamente a 0 dB; cada impulso é escalado pelo pico da própria resposta completa e exibido de -2 ms até o Impulse Range selecionado.

## Como funciona a medição

Cada medição captura o pipeline ativo, suas configurações e seu roteamento, além das respostas de alto-falante selecionadas. Os gráficos mostram as respostas resultantes de frequência, fase, atraso de grupo mínimo, atraso de grupo excedente e impulso; **After** compensa a latência informada pelo pipeline.

MLS e TSP são adequados à medição geral de resposta. Se delay, reverb ou ressonância ultrapassar a janela de medição, o resultado pode se sobrepor; aumente **Sequence Length**. **Unit Impulse** registra diretamente a resposta por um período limitado, portanto caudas muito longas podem ser cortadas.

Efeitos não lineares, variáveis no tempo, aleatórios, ruidosos ou que geram som podem produzir resultados diferentes em outros níveis ou entre medições. Interprete os gráficos como um retrato das configurações escolhidas, não como características fixas.
