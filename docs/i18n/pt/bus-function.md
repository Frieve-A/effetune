---
title: "Bus Function Guide - EffeTune"
description: "Learn how to use the Bus feature in EffeTune for flexible audio routing and complex effect chains."
lang: en
---

# Como Usar o Recurso de Barramento

O recurso de Barramento permite o roteamento flexível de áudio entre efeitos, possibilitando um processamento de áudio mais complexo e versátil.

## Conceito Básico

- Cada efeito permite que você especifique um **Barramento de Entrada** que recebe o sinal de áudio a ser processado, e um **Barramento de Saída** que fornece o áudio processado.
- Por padrão, se não for especificado de outra forma, cada efeito utiliza o **Barramento Principal** tanto para entrada quanto para saída.
- Até quatro barramentos adicionais (**Barramento 1 a Barramento 4**) podem ser usados.

![Função do Barramento](../../../images/bus_function.png)

## Configurando Barramentos de Entrada e Saída para Efeitos

- Clique no **botão de Roteamento** localizado à esquerda dos botões de cima/baixo exibidos em cada efeito.
- Ao clicar no botão de Roteamento, uma janela de configurações é aberta, permitindo a seleção livre do Barramento de Entrada e do Barramento de Saída a partir do Barramento Principal ou de Barramento 1 a Barramento 4.
- As alterações são aplicadas imediatamente.
- Para fechar a janela, clique no botão × no canto superior direito ou clique fora da janela.

- Se a entrada ou a saída estiver definida para Barramento 1 ou superior, será exibido "Barramento X→Barramento Y" próximo ao botão de Roteamento.
  - Exemplo: Ao processar áudio do Barramento 2 e enviá-lo para o Barramento 3, será exibido "Barramento 2→Barramento 3".

## Mecanismo de Processamento de Áudio

- Os efeitos são processados sequencialmente de cima para baixo.
- Cada efeito pega os sinais de áudio do Barramento de Entrada especificado, processa-os e envia o resultado para o Barramento de Saída.
- Se um Barramento de Entrada for utilizado pela primeira vez, o processamento começa a partir do silêncio.
- Se o Barramento de Entrada e o Barramento de Saída forem os mesmos, o áudio do Barramento de Saída é sobrescrito pelo resultado processado.
- Se barramentos diferentes forem especificados para entrada e saída, o áudio processado é adicionado ao Barramento de Saída.
- No final, a reprodução de áudio é sempre a partir do **Barramento Principal**.

[← Voltar para o README](README.md)
