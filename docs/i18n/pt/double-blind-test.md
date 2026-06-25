---
title: "Guia do Double Blind Test - EffeTune"
description: "Aprenda a fazer testes cegos ABX e de preferência A/B entre dois pipelines de efeitos no EffeTune e a verificar os resultados com significância estatística."
lang: pt
---

# Como Usar o Double Blind Test

O Double Blind Test permite comparar **Pipeline A** e **Pipeline B** ouvindo, sem saber qual deles está sendo reproduzido. Ele serve para verificar sem viés se uma diferença que você *acha* ouvir é realmente distinguível e se você de fato prefere um pipeline ao outro.

Existem dois tipos de teste:

- **ABX Test** - Verifica se você consegue distinguir os dois pipelines de forma confiável.
- **A/B Preference Test** - Permite escolher qual pipeline você prefere, sem saber qual é qual.

Em ambos os casos, o EffeTune registra suas respostas e informa um p-valor, para que você veja se o resultado é estatisticamente significativo.

## Preparando os Dois Pipelines

O teste compara os dois pipelines descritos em [Usando Recursos de Pipeline AB](README.md#usando-recursos-de-pipeline-ab):

- O **Pipeline A** e o **Pipeline B** devem conter pelo menos um efeito cada.
- Coloque uma das configurações que deseja comparar no Pipeline A e a outra no Pipeline B. Mantenha todo o restante igual, exceto o ponto que deseja testar (por exemplo, *Com EQ* e *Sem EQ*), para que apenas essa diferença seja avaliada.
- No **A/B Preference Test**, não importa qual das duas configurações fica no Pipeline A e qual fica no Pipeline B. Durante o teste, as amostras A e B são reatribuídas aleatoriamente a cada tentativa, portanto nenhuma posição tem vantagem. Se você trocar as configurações de lugar, o rótulo do pipeline vencedor exibido no resultado também será trocado, mas a interpretação estatística não muda. O importante é lembrar qual configuração foi colocada em cada pipeline: o resultado informa se o Pipeline A ou o Pipeline B foi preferido de forma significativa, e você interpreta isso em relação à sua própria configuração. Um resultado claro geralmente indica que você escolheu de forma consistente uma diferença que realmente separa sua preferência. Se os dois soarem iguais, ou se suas escolhas variarem, normalmente o teste não indicará uma preferência significativa.
- Você pode abrir o painel de teste a qualquer momento, mas os botões de início ficam desativados até que os dois pipelines estejam presentes. Se o Pipeline B estiver ausente, um aviso será exibido.

## Abrindo o Teste

- **Aplicativo web:** clique no botão **▼** logo à direita do botão de alternância A/B (o botão que mostra "A" ou "B" conforme o pipeline atual) no cabeçalho Effect Pipeline e escolha **Double Blind Test** no menu exibido.
- **Aplicativo desktop:** além do mesmo menu **▼**, você também pode abrir o teste pelo menu **Arquivo** > **Double Blind Test**.

Enquanto o teste estiver aberto, a visualização do pipeline de efeitos fica oculta para que você não veja quais efeitos estão ativos e a condição cega seja preservada. Você pode fechar o teste a qualquer momento com o botão **×** e voltar à tela normal.

## Configurando o Teste

A tela de configuração oferece os seguintes itens:

- **Test name** - Descreve a diferença que você está testando (por exemplo, *Com EQ e Sem EQ*). A caixa combinada funciona como Effect Presets: você pode salvar, carregar e excluir testes nomeados. Um teste salvo inclui os dois pipelines e o número de tentativas, permitindo recarregar a mesma comparação depois. É preciso preencher **Test name** para compartilhar um teste.
- **Your name** - Opcional. Aparece no resultado; se ficar em branco, vira *Anonymous*.
- **Number of tests** - Quantas tentativas serão executadas, definidas pelo campo de entrada ou pelo controle deslizante. Mais tentativas tornam o resultado mais confiável, mas também levam mais tempo. O padrão é 20.

Pressione **Start ABX Test** ou **Start A/B Preference Test** para começar.

> **Observação:** Os **A** e **B** do teste são algo separado do Pipeline A e Pipeline B do Effect Pipeline. A cada tentativa, o pipeline cujo som será atribuído a A ou a B é decidido novamente de forma aleatória, e essa correspondência não aparece na tela. Portanto, você não sabe qual pipeline real está ouvindo como A naquele momento e não pode presumir que "A" seja Pipeline A. É isso que mantém o teste cego.

## Reproduzindo o Áudio

O teste apenas alterna os pipelines; você fornece a música como de costume:

- arraste e solte um arquivo de música (ou abra um pelo menu **Arquivo**), ou
- envie áudio ao EffeTune a partir de uma fonte física.

A taxa de amostragem do dispositivo de áudio é mostrada na tela de teste como referência.

## Executando um ABX Test

1. Use os botões **Switch to A**, **Switch to B** e **Switch to X** para alternar o áudio em reprodução entre as amostras. **X** é igual a A ou B, escolhido aleatoriamente em cada tentativa.
2. Alterne quantas vezes quiser até conseguir identificar com qual amostra **X** combina.
3. Clique em **X matches A** ou **X matches B** para registrar sua resposta; a próxima tentativa começa em seguida.

Você também pode alternar pelo teclado: pressione as teclas **A**, **B** ou **X**, ou **1**, **2** ou **3** (linha superior ou teclado numérico), para alternar a amostra ativa como se tivesse clicado no botão correspondente. Para votar, pressione **Q** para **X matches A** ou **W** para **X matches B**.

## Executando um A/B Preference Test

1. Use os botões **Switch to A** e **Switch to B** para comparar as duas amostras (não há X neste modo).
2. Quando decidir qual prefere, clique em **Prefer A** ou **Prefer B**.

Você também pode alternar pelo teclado: pressione as teclas **A** ou **B**, ou **1** ou **2** (linha superior ou teclado numérico), para alternar a amostra ativa. Para votar, pressione **Q** para **Prefer A** ou **W** para **Prefer B**.

## Lendo o Resultado

Quando todas as tentativas terminam, o EffeTune mostra o resultado:

- **ABX Test** - São exibidos sua pontuação (porcentagem e acertos / total) e o p-valor de um teste binomial unilateral. Se **p < 0.05**, o resultado é estatisticamente significativo, então suas respostas dificilmente são explicadas apenas pelo acaso e é possível dizer que você conseguiu distinguir os pipelines. Caso contrário, não é possível afirmar que você conseguiu distingui-los.
- **A/B Preference Test** - São exibidos o pipeline escolhido mais vezes (mostrado como Pipeline A em caso de empate), o número de escolhas (contagem / total) e o p-valor de um teste binomial bilateral. A porcentagem exibida sempre é 50% ou mais, porque indica o lado vencedor; portanto, uma porcentagem alta por si só não significa uma preferência real. A decisão é feita pelo p-valor: se **p < 0.05**, houve uma preferência significativa. Caso contrário, não é possível afirmar que houve uma preferência significativa (um resultado perto de 50% está dentro do acaso).

O tempo total gasto no teste também é exibido.

## Compartilhando um Teste

Clique em **Share this test** para copiar uma URL para a área de transferência. Essa URL **reproduz os dois pipelines de efeitos e abre o teste cego**, para que a pessoa que a receber possa fazer a mesma comparação de pipelines. Você pode compartilhar a qualquer momento: na tela de configuração antes de começar ou depois de terminar. Se compartilhar antes do início, o ponto principal compartilhado é a comparação entre os dois pipelines; confirme o número de tentativas antes de começar. Se compartilhar depois de concluir o teste, seu resultado também será incluído, e a pessoa que receber a URL poderá vê-lo antes de fazer o mesmo teste.

Para compartilhar, são necessários os dois pipelines e um **Test name**. Assim, a comparação compartilhada tem significado e pode ser reproduzida por outra pessoa.

Como usar uma URL de teste compartilhada:

- **Aplicativo web:** abra a URL compartilhada no navegador. O EffeTune restaura os dois pipelines e abre o Double Blind Test automaticamente.
- **Aplicativo desktop:** copie a URL compartilhada, mude para o EffeTune e cole usando **Editar > Colar**, **Ctrl+V** (ou **Command+V** no macOS) ou o botão **Colar efeitos** da barra de ferramentas. O EffeTune lê a URL da área de transferência, restaura os dois pipelines e abre o Double Blind Test. Cole a URL enquanto o painel Double Blind Test ainda não estiver aberto.

[← Voltar para o README](README.md)
