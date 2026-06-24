---
title: "Plugins de Controle - EffeTune"
description: "Plugins de controle para organizar cadeias de efeitos com agrupamento Section."
lang: pt
---

# Efeitos de Controle

Efeitos de controle são utilitários especiais que não processam o áudio diretamente, mas controlam como outros efeitos operam. Eles ajudam a organizar e gerenciar cadeias de efeitos complexas.

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
