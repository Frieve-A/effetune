---
title: "Guia do Teste duplo-cego - Testes de audição às cegas ABX e A/B - EffeTune"
description: "Execute testes cegos de audição ABX e de preferência A/B entre dois pipelines de efeitos no EffeTune e verifique os resultados com significância estatística."
lang: pt
---

# Como Usar o Teste duplo-cego

O Teste duplo-cego permite comparar de ouvido o **Pipeline A** e o **Pipeline B**. É uma forma controlada de descobrir se uma diferença que você *acha* ouvir é realmente perceptível e se você de fato prefere um pipeline ao outro.

Há dois tipos de teste disponíveis:

- **Teste ABX** – Verifica se você consegue distinguir os dois pipelines de forma confiável.
- **Teste de preferência A/B** – Escolhe qual pipeline você prefere, sem saber qual é qual.

Em ambos os casos, o EffeTune registra suas respostas e informa um p-valor para que você veja se o resultado é estatisticamente significativo.

## Preparando os Dois Pipelines

O teste compara os dois pipelines descritos em [Usando Recursos de Pipeline AB](README.md#usando-recursos-de-pipeline-ab):

- O **Pipeline A** e o **Pipeline B** devem conter pelo menos um efeito cada.
- Coloque uma configuração no Pipeline A e a outra no Pipeline B, mantendo todo o restante idêntico (por exemplo, *Com EQ* vs. *Sem EQ*) para que apenas a diferença desejada seja testada.
- Lembre-se de qual configuração você colocou no Pipeline A e qual colocou no Pipeline B. Em um teste de preferência A/B, o resultado informa se o Pipeline A ou o Pipeline B foi preferido de forma significativa.
- A opção “Teste duplo-cego” do menu e os botões de início permanecem desativados até que o Pipeline A e o Pipeline B contenham pelo menos um efeito cada.

## Abrindo o Teste

- **Aplicativo web:** Clique no botão **▼** logo à direita do botão de alternância A/B (o botão que mostra "A" ou "B" para o pipeline atual) no cabeçalho do Effect Pipeline e escolha **Teste duplo-cego** no menu exibido.
- **Aplicativo desktop:** O mesmo menu **▼** está disponível, e você também pode abrir o teste pelo menu **Arquivo**.

Enquanto o teste estiver aberto, a exibição do pipeline de efeitos fica oculta para que você não veja quais efeitos estão ativos e o teste permaneça cego. Feche o teste a qualquer momento com o botão **×** para voltar à visualização normal.

## Configurando o Teste

A tela de configuração oferece os seguintes itens:

- **Nome do teste** – Descreve a diferença que você está testando (por exemplo, *Com EQ vs. Sem EQ*). A caixa combinada funciona como as Predefinições de efeito: você pode **salvar**, **carregar** e **excluir** testes nomeados. Um teste salvo armazena ambos os pipelines e o número de tentativas, permitindo recarregar a mesma comparação depois. É necessário definir um nome antes de compartilhar um teste.
- **Seu nome** – Opcional. É exibido no resultado; se deixado em branco, aparece como *Anônimo*.
- **Número de tentativas** – Quantas tentativas serão executadas (definidas pela caixa numérica ou pelo controle deslizante). Mais tentativas produzem um resultado mais confiável, mas levam mais tempo. O padrão é 20.
- **Manter A/B fixos nos testes ABX** – Ativado por padrão. Durante todo o teste ABX, A corresponde ao Pipeline A original e B ao Pipeline B original. X continua sendo escolhido aleatoriamente a cada tentativa. Desmarque a opção para que as atribuições de A e B também sejam sorteadas a cada tentativa. Essa configuração é incluída ao salvar ou compartilhar o teste.

Pressione **Iniciar teste ABX** ou **Iniciar teste de preferência A/B** para começar.

> **Observação:** Em um teste de preferência A/B, as atribuições de A e B são sempre sorteadas a cada tentativa, independentemente dessa opção. Portanto, o A do teste não corresponde necessariamente ao Pipeline A original, e essa correspondência permanece oculta.

## Reproduzindo o Áudio

O teste apenas alterna entre os pipelines; você fornece a música normalmente:

- Arraste e solte um arquivo de música (ou abra um pelo menu Arquivo), ou
- Envie áudio para o EffeTune a partir de uma fonte física.

A taxa de amostragem do dispositivo de áudio é exibida na tela de teste para referência.

## Executando um teste ABX

1. Use os botões **Alternar para A**, **Alternar para B** e **Alternar para X** para alternar o áudio ao vivo entre as amostras. **X** é igual a A ou B, escolhido aleatoriamente a cada tentativa.
2. Alterne quantas vezes quiser até identificar a qual amostra **X** corresponde.
3. Clique em **X corresponde a A** ou **X corresponde a B** para registrar sua resposta e iniciar a próxima tentativa.

Você também pode alternar pelo teclado: pressione a tecla **A**, **B** ou **X** — ou **1**, **2** ou **3** (linha superior ou teclado numérico) — para mudar a amostra ativa, exatamente como ao clicar no botão correspondente. Para votar, pressione **Q** para **X corresponde a A** ou **W** para **X corresponde a B**.

## Executando um teste de preferência A/B

1. Use os botões **Alternar para A** e **Alternar para B** para comparar as duas amostras (não há X neste modo).
2. Quando decidir qual prefere, clique em **Prefiro A** ou **Prefiro B**.

Você também pode alternar pelo teclado: pressione a tecla **A** ou **B** — ou **1** ou **2** (linha superior ou teclado numérico) — para mudar a amostra ativa. Para votar, pressione **Q** para **Prefiro A** ou **W** para **Prefiro B**.

## Lendo o Resultado

Quando todas as tentativas terminam, o EffeTune exibe o resultado:

- **Teste ABX** – Sua pontuação (porcentagem e acertos / total) e o p-valor de um teste binomial unilateral. Se **p < 0.05**, o resultado é estatisticamente significativo, indicando que suas respostas dificilmente se explicam apenas pelo acaso e que você conseguiu distinguir os dois pipelines. Caso contrário, não é possível afirmar que você conseguiu distingui-los.
- **Teste de preferência A/B** – O pipeline escolhido mais vezes (exibido como Pipeline A em caso de empate) e quantas vezes foi escolhido (contagem / total), junto com o p-valor de um teste binomial bilateral. A porcentagem mostrada é sempre de 50% ou mais porque informa o lado vencedor — portanto, uma porcentagem alta por si só não significa preferência real. O que importa é o p-valor: se **p < 0.05**, sua preferência é significativa; caso contrário, não é possível afirmar que houve preferência significativa (um resultado próximo de 50% é apenas acaso).

O tempo total gasto também é exibido.

## Compartilhando um Teste

Clique em **Compartilhar este teste** para copiar uma URL para a área de transferência. A URL reproduz **ambos os pipelines de efeitos e abre o teste cego**, para que qualquer pessoa que a abra possa executar a mesma comparação de pipelines. Você pode compartilhar a qualquer momento — na tela de configuração antes de começar ou depois de terminar. Se compartilhar antes de iniciar, o que está sendo compartilhado é a comparação entre os dois pipelines; confirme o número de tentativas antes de começar. Se compartilhar após concluir o teste, seu resultado também é incluído, e o destinatário o vê antes de fazer o próprio teste.

O compartilhamento exige ambos os pipelines e um nome de teste, para que a comparação compartilhada tenha contexto e possa ser reproduzida do outro lado.

Para usar uma URL de teste compartilhada:

- **Aplicativo web:** Abra a URL compartilhada no navegador. O EffeTune restaura ambos os pipelines e abre o Teste duplo-cego automaticamente.
- **Aplicativo desktop:** Copie a URL compartilhada, mude para o EffeTune e cole com **Editar > Colar**, **Ctrl+V** (ou **Command+V** no macOS) ou o botão **Colar efeitos** da barra de ferramentas. O EffeTune lê a URL da área de transferência, restaura ambos os pipelines e abre o Teste duplo-cego. Cole a URL enquanto o painel do Teste duplo-cego não estiver aberto.

[← Voltar para o README](README.md)
