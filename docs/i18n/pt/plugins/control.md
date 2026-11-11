---
title: "Plugins de Controle - EffeTune"
description: "Plugins de controle para organizar cadeias de efeitos com agrupamento Section."
lang: pt
---

# Efeitos de Controle

Efeitos de controle são utilitários especiais que não processam o áudio diretamente, mas controlam como outros efeitos operam. Eles ajudam a organizar e gerenciar cadeias de efeitos complexas.

## Live Audio Receive

Recebe nesta posição o áudio ao vivo de outro EffeTune. Os efeitos anteriores são ignorados e os seguintes processam o som. Músicas normais começam no início da cadeia. Não há parâmetros ajustáveis. Sem o marcador ativo, toda a cadeia é usada. O áudio recebido não é retransmitido pelo Network Output.

## Live Audio Send

Envia o áudio desta posição ao Network Output e o mantém nos efeitos locais seguintes. Por exemplo, coloque um EQ compartilhado antes e um Room EQ local depois. Ative Network Output e escolha os dispositivos. Sem marcador ativo, a saída final é enviada. Apenas o primeiro marcador ativo de cada tipo é usado; os demais indicam isso. Não há parâmetros ajustáveis.

## Section

O efeito Section agrupa vários efeitos para que você possa colocar toda aquela parte da cadeia em bypass ou restaurá-la com um único botão ON/OFF. Cada efeito mantém seu próprio estado ON/OFF.

### Visão Geral

- **Nome**: Section
- **Categoria**: Control
- **Descrição**: Agrupa efeitos para que uma seção inteira possa ser colocada em bypass ou restaurada

### Parâmetros

| Parâmetro | Descrição |
|-----------|-------------|
| Comment   | Nome ou descrição da finalidade da seção |

### Uso

1. Coloque o efeito Section no início do grupo de efeitos que você quer controlar junto
2. Digite um nome descritivo no campo "Comment" para identificar a finalidade da seção
3. Coloque o efeito Section em OFF para colocar os efeitos daquela seção em bypass; coloque em ON para restaurar a seção, preservando o estado ON/OFF próprio de cada efeito
4. Efeitos colocados depois de um efeito Section serão controlados por essa seção até que outro efeito Section seja encontrado

### Exemplos de Uso

- Agrupar efeitos relacionados (por exemplo, "EQ Adjustments", "Spatial Effects")
- Criar cadeias de processamento alternativas que podem ser alternadas facilmente
- Organizar cadeias de efeitos complexas em seções lógicas
- Desativar temporariamente um grupo de efeitos sem removê-los
