# Pipeline Analyzer

O Pipeline Analyzer mede a resposta do Effect Pipeline ativo sem alterar o áudio que você ouve. Em janelas largas, ele fica ao lado do pipeline; em janelas estreitas, vai para baixo do cabeçalho. Assim, você pode ajustar um efeito e acompanhar o resultado.

Abra-o pelo botão de gráfico no cabeçalho do Effect Pipeline ou por **View > Pipeline Analyzer** no aplicativo para desktop. Alterações no pipeline ou nas configurações de medição iniciam outra medição automaticamente.

## Canais e respostas de alto-falante

Escolha um canal de entrada. Uma saída aparece inicialmente; use **+ Adicionar saída** para incluir até quatro canais distintos disponíveis no dispositivo atual. Excluir uma saída também remove a configuração de resposta correspondente. A última saída não pode ser excluída.

Cada saída pode usar **Sem IR de alto-falante** ou um ponto de medição salvo do tweeter, woofer ou outro componente conectado. **Antes** é a soma com sinal das respostas alinhadas; **Depois** é a soma com sinal após processar cada saída pelo pipeline escolhido. Isso permite analisar um FIR Crossover junto com seus componentes. Se uma resposta salva estiver ausente, ela continuará marcada como ausente até ser substituída ou removida.

As respostas salvas são alinhadas pelo início detectado. Medições separadas não preservam a diferença de chegada acústica entre componentes; ajuste o atraso relativo e a polaridade no pipeline antes de avaliar Total.

## Configurações de medição

Abra **Configurações de medição** para alterar:

- **Sinal**: **MLS** é o padrão. **TSP** oferece um sinal periódico de fase varrida com os mesmos controles de estabilização e média. **Impulso unitário** faz uma captura direta no domínio do tempo.
- **Nível**: pico do sinal de teste, com padrão de `-12 dBFS`. Efeitos não lineares ou dependentes de nível podem produzir outro resultado.
- **Comprimento da sequência**: MLS usa de 32.767 a 524.287 amostras e TSP usa as potências de dois correspondentes, de 32.768 a 524.288. A mesma ordem é preservada ao trocar o sinal. Sequências maiores representam uma resposta mais longa antes da sobreposição circular. O analisador pode recomendar outro valor, mas nunca o altera automaticamente.
- **Períodos de estabilização**: 12 por padrão. MLS ou TSP é executado continuamente durante esses períodos antes da captura. A duração real é exibida.
- **Médias**: 2 por padrão. Mais períodos reduzem a variação entre repetições.

Os detalhes também mostram o **alcance atual**, o **comprimento recomendado**, a **estabilização recomendada** em períodos e segundos e o **tempo total do sinal de teste**. Esses valores servem apenas como orientação; o Pipeline Analyzer nunca altera as configurações automaticamente.

Comprimento da sequência, Períodos de estabilização e Médias só ficam desativados com Impulso unitário. Alternar entre Frequency, Phase, Group Delay e Impulse muda apenas o gráfico, sem refazer a medição.

## Leitura e método

**Frequency** mostra o nível, **Phase** a fase, **Group Delay** o atraso por frequência e **Impulse** a resposta no tempo. O gráfico sempre mostra apenas **Antes** e **Depois**. Mova o ponteiro para ler os dois valores; ao passar sobre **Antes**, **Depois** fica oculto temporariamente. Frequency e Group Delay compartilham a **Suavização (oct)**. Cada curva de frequência é referenciada separadamente a 0 dB; cada impulso é normalizado pelo próprio pico completo e exibido de -2 ms até a **Faixa do impulso (ms)** escolhida.

Cada execução congela o pipeline, seus recursos, o roteamento, as respostas de alto-falante e as configurações em um worker isolado. MLS usa correlação circular e TSP usa sua varredura inversa para recuperar a resposta periódica, exceto em DC. A latência informada pelo pipeline é subtraída da fase, do atraso de grupo e do tempo de impulso exibidos. O Impulso unitário normaliza a captura pelo nível escolhido e mantém uma captura de cauda limitada.

Com efeitos não lineares, variáveis no tempo, aleatórios, ruidosos ou que geram som, o resultado é uma captura no nível e estado inicial escolhidos, não uma função de transferência universal. Ele pode variar entre medições. Saída numérica inválida ou ausência de um processador ou recurso necessário causa falha na medição.
