---
title: "Reverb Plugins - EffeTune"
description: "Reverb effect plugins including RS Reverb, Dattorro Plate Reverb, and FDN Reverb."
lang: en
---

# Plugins de Reverberação

Uma coleção de plugins que adicionam espaço e atmosfera à sua música. Esses efeitos podem fazer sua música soar como se estivesse sendo tocada em diferentes ambientes, desde salas íntimas até grandes salas de concerto, aprimorando sua experiência de audição com ambiência natural e profundidade.

## Lista de Plugins

- [Dattorro Plate Reverb](#dattorro-plate-reverb) - Reverb de placa clássico baseado no algoritmo Dattorro
- [FDN Reverb](#fdn-reverb) - Reverb de Rede de Atraso de Feedback com matriz de difusão avançada
- [RS Reverb](#rs-reverb) - Cria ambiência e espaço natural de sala

## Dattorro Plate Reverb

Uma implementação clássica de reverb de placa baseada no renomado algoritmo de Jon Dattorro do artigo de 1997 "Effect Design, Part 1: Reverberator and Other Filters." Este algoritmo é celebrado por sua qualidade sonora rica e suave e tornou-se uma referência padrão no design de reverb digital. Perfeito para adicionar ambiência rica e brilhante à sua música.

### Guia de Experiência de Audição
- Som de Placa Exuberante:
  - Caráter clássico de reverb de placa de estúdio
  - Cauda de reverb suave e densa sem artefatos metálicos
  - Belo brilho e calor característicos dos reverbs de placa
- Ambiência Versátil:
  - De aprimoramento sutil de sala a salões expansivos
  - Funciona lindamente com qualquer gênero musical
  - Adiciona acabamento profissional às gravações
- Movimento Natural:
  - A modulação adiciona vida orgânica ao reverb
  - Previne caudas estáticas e artificiais
  - Cria um espaço vivo e respirante ao redor da sua música

### Parâmetros
- **Pre Delay** - Silêncio inicial antes do início do reverb (0.0 a 100.0 ms)
  - 0-10ms: Reverb imediato, sensação íntima
  - 10-30ms: Sensação natural de espaço
  - 30-100ms: Cria impressão de espaços maiores
- **Bandwidth** - Filtragem do sinal de entrada (0.0 a 1.0)
  - Valores mais baixos: Tom de entrada mais escuro e quente
  - Valores mais altos (perto de 1.0): Entrada mais brilhante, frequência completa
  - Padrão 0.9995: Ótimo conforme sugerido por Dattorro
- **Input Diff 1** - Primeira etapa de difusão de entrada (0.0 a 1.0)
  - Controla a dispersão inicial do sinal de entrada
  - Padrão 0.75: Valor recomendado do artigo de Dattorro
  - Valores mais altos: Reflexões iniciais mais difusas e suaves
- **Input Diff 2** - Segunda etapa de difusão de entrada (0.0 a 1.0)
  - Dispersa mais o sinal de entrada
  - Padrão 0.625: Valor recomendado do artigo de Dattorro
  - Trabalha com Input Diff 1 para criar difusão complexa
- **Decay** - Quanto tempo dura a cauda do reverb (0.0 a 1.0)
  - Baixo (0.1-0.3): Decaimento curto e controlado
  - Médio (0.4-0.6): Decaimento natural tipo sala
  - Alto (0.7-1.0): Caudas longas e expansivas
- **Decay Diff 1** - Difusão de decaimento no tanque (0.0 a 1.0)
  - Controla a densidade durante a fase de decaimento
  - Padrão 0.70: Valor recomendado do artigo de Dattorro
  - Afeta a suavidade da cauda do reverb
- **Damping** - Absorção de alta frequência ao longo do tempo (0.0 a 1.0)
  - 0.0: Sem amortecimento, reverb brilhante em toda parte
  - 0.0005 (padrão): Amortecimento muito sutil e natural
  - Valores mais altos: Decaimento mais escuro e quente
- **Mod Depth** - Quantidade de modulação de atraso (0.0 a 16.0 amostras)
  - 0.0: Sem modulação, reverb estático
  - 1.0-4.0: Movimento sutil, adiciona vida
  - 8.0-16.0: Efeito tipo chorus mais notável
- **Mod Rate** - Velocidade de modulação (0.0 a 10.0 Hz)
  - 0.5-1.5Hz: Movimento lento e suave
  - 2.0-4.0Hz: Modulação mais ativa
  - Valores mais altos: Efeito rápido e brilhante
- **Wet Mix** - Quantidade de reverb adicionada (0 a 100%)
  - 10-30%: Aprimoramento sutil
  - 30-50%: Presença notável
  - 50-100%: Efeito de reverb dominante
- **Dry Mix** - Quantidade de sinal original (0 a 100%)
  - Geralmente mantida em 100% para audição normal
  - Reduzir para efeitos especiais ou lavagens ambientes

### Configurações Recomendadas para Diferentes Estilos Musicais

1. Piano Clássico
   - Decay: 0.6-0.7
   - Damping: 0.001
   - Mod Depth: 1.0
   - Wet Mix: 25-35%
   - Perfeito para: Piano solo, música de câmara

2. Vocais e Acústico
   - Decay: 0.4-0.5
   - Damping: 0.002
   - Pre Delay: 15-25ms
   - Wet Mix: 20-30%
   - Perfeito para: Vocais, violão

3. Ambiente e Atmosférico
   - Decay: 0.8-0.95
   - Mod Depth: 4.0-8.0
   - Mod Rate: 0.5-1.0Hz
   - Wet Mix: 50-70%
   - Perfeito para: Ambient, eletrônica, paisagens sonoras

4. Aprimoramento Geral
   - Decay: 0.5
   - Damping: 0.0005
   - Mod Depth: 1.0
   - Wet Mix: 20-30%
   - Perfeito para: Uso geral, acabamento sutil

### Guia de Início Rápido

1. Definir o Caráter Básico
   - Comece com Decay para controlar o comprimento do reverb
   - Ajuste Pre Delay para a distância percebida
   - Configure Wet Mix para a presença de reverb desejada

2. Moldar o Timbre
   - Use Bandwidth para controlar o brilho de entrada
   - Ajuste Damping para o decaimento de alta frequência
   - Ajuste fino dos parâmetros de difusão para densidade

3. Adicionar Movimento
   - Configure Mod Depth para variação sutil (tente 1.0)
   - Ajuste Mod Rate para velocidade (tente 1.0Hz)
   - Estes parâmetros adicionam vida ao reverb

4. Equilíbrio Final
   - Ajuste a mistura Wet/Dry ao gosto
   - Confie em seus ouvidos para os ajustes finais
   - Os valores padrão são um ótimo ponto de partida

O Dattorro Plate Reverb traz um reverb clássico de qualidade profissional para sua experiência de audição. Seu caráter suave e exuberante o torna perfeito para aprimorar qualquer gravação com uma ambiência bela e natural!

## FDN Reverb

Um efeito de reverb sofisticado baseado na arquitetura de Rede de Atraso de Feedback (FDN) usando uma matriz de difusão Hadamard. Isso cria uma reverberação rica e complexa com excelente densidade e características de decaimento natural, perfeita para aprimorar sua experiência de audição musical com efeitos espaciais imersivos.

### Guia de Experiência de Audição
- Sensação de Sala Natural:
  - Cria a sensação de ouvir em espaços acústicos reais
  - Adiciona profundidade e dimensão à sua música
  - Faz gravações estéreo parecerem mais espaçosas e vivas
- Aprimoramento Atmosférico:
  - Transforma gravações planas em experiências imersivas
  - Adiciona belos sustains e caudas às notas musicais
  - Cria uma sensação de estar no espaço de performance
- Ambiência Personalizável:
  - Ajustável desde salas íntimas até grandes salas de concerto
  - Controle fino sobre o caráter e cor do espaço
  - Modulação suave adiciona movimento natural e vida

### Parâmetros
- **Reverb Time** - Duração do efeito de reverb (0.20 a 10.00 s)
  - Curto (0.2-1.0s): Decaimento rápido e controlado para clareza
  - Médio (1.0-3.0s): Reverberação natural tipo sala
  - Longo (3.0-10.0s): Caudas expansivas e atmosféricas
- **Density** - Número de caminhos de eco para complexidade (4 a 8 linhas)
  - 4 linhas: Ecos individuais mais simples e definidos
  - 6 linhas: Bom equilíbrio de complexidade e clareza
  - 8 linhas: Máxima suavidade e densidade
- **Pre Delay** - Silêncio inicial antes do início do reverb (0.0 a 100.0 ms)
  - 0-20ms: Reverb imediato, sensação íntima
  - 20-50ms: Sensação natural de distância de sala
  - 50-100ms: Cria impressão de espaços maiores
- **Base Delay** - Timing fundamental para a rede de reverb (10.0 a 60.0 ms)
  - Valores menores: Caráter de reverb mais apertado e focado
  - Valores maiores: Qualidade sonora mais espaçosa e aberta
  - Afeta as relações de timing fundamentais
- **Delay Spread** - Quanto os tempos de atraso variam entre linhas (0.0 a 25.0 ms)
  - Implementação: Cada linha de atraso fica progressivamente mais longa usando uma curva de potência (expoente 0.8)
  - 0.0ms: Todas as linhas têm o mesmo timing base (padrões mais regulares)
  - Valores maiores: Padrões de reflexão mais naturais e irregulares
  - Adiciona variação realista encontrada em espaços acústicos reais
- **HF Damp** - Como as altas frequências desvanecem ao longo do tempo (0.0 a 12.0 dB/s)
  - 0.0: Sem amortecimento, som brilhante durante todo o decaimento
  - 3.0-6.0: Simulação natural de absorção do ar
  - 12.0: Amortecimento pesado para caráter quente e suave
- **Low Cut** - Remove baixas frequências do reverb (20 a 500 Hz)
  - 20-50Hz: Resposta completa de graves no reverb
  - 100-200Hz: Graves controlados para evitar confusão
  - 300-500Hz: Graves apertados e claros
- **Mod Depth** - Quantidade de modulação de pitch para efeito chorus (0.0 a 10.0 cents)
  - 0.0: Sem modulação, reverb estático puro
  - 2.0-5.0: Movimento sutil que adiciona vida e realismo
  - 10.0: Efeito chorus-like notável
- **Mod Rate** - Velocidade da modulação (0.10 a 5.00 Hz)
  - 0.1-0.5Hz: Movimento muito lento e suave
  - 1.0-2.0Hz: Variação de som natural
  - 3.0-5.0Hz: Modulação rápida e mais óbvia
- **Diffusion** - Quanto a matriz Hadamard mistura sinais (0 a 100%)
  - Implementação: Controla a quantidade de mistura matricial aplicada
  - 0%: Mistura mínima, padrões de eco mais distintos
  - 50%: Difusão equilibrada para som natural
  - 100%: Mistura máxima para a densidade mais suave
- **Wet Mix** - Quantidade de reverb adicionada ao som (0 a 100%)
  - 10-30%: Aprimoramento espacial sutil
  - 30-60%: Presença notável de reverb
  - 60-100%: Efeito de reverb dominante
- **Dry Mix** - Quantidade de sinal original preservada (0 a 100%)
  - Geralmente mantida em 100% para audição normal
  - Pode ser reduzida para efeitos atmosféricos especiais
- **Stereo Width** - Quão amplo o reverb se espalha em estéreo (0 a 200%)
  - Implementação: 0% = mono, 100% = estéreo normal, 200% = largura exagerada
  - 0%: Reverb aparece no centro (mono)
  - 100%: Espalhamento estéreo natural
  - 200%: Imagem estéreo extra-ampla

### Configurações Recomendadas para Diferentes Experiências de Audição

1. Aprimoramento de Música Clássica
   - Reverb Time: 2.5-3.5s
   - Density: 8 linhas
   - Pre Delay: 30-50ms
   - HF Damp: 4.0-6.0
   - Perfeito para: Gravações orquestrais, música de câmara

2. Atmosfera de Clube de Jazz
   - Reverb Time: 1.2-1.8s
   - Density: 6 linhas
   - Pre Delay: 15-25ms
   - HF Damp: 2.0-4.0
   - Perfeito para: Jazz acústico, performances íntimas

3. Aprimoramento Pop/Rock
   - Reverb Time: 1.0-2.0s
   - Density: 6-7 linhas
   - Pre Delay: 10-30ms
   - Wet Mix: 20-40%
   - Perfeito para: Gravações modernas, adição de espaço

4. Paisagens Sonoras Ambientes
   - Reverb Time: 4.0-8.0s
   - Density: 8 linhas
   - Mod Depth: 3.0-6.0
   - Wet Mix: 60-80%
   - Perfeito para: Música atmosférica, relaxamento

### Guia de Início Rápido

1. Definir o Caráter do Espaço
   - Comece com Reverb Time para corresponder ao tamanho de espaço desejado
   - Configure Density para 6-8 para som suave e natural
   - Ajuste Pre Delay para controlar a percepção de distância

2. Moldar o Timbre
   - Use HF Damp para simular absorção natural do ar
   - Configure Low Cut para prevenir acúmulo de graves
   - Ajuste Diffusion para suavidade (tente 70-100%)

3. Adicionar Movimento Natural
   - Configure Mod Depth para 2-4 cents para vida sutil
   - Use Mod Rate em torno de 0.3-1.0 Hz para variação suave
   - Ajuste Stereo Width para impressão espacial

4. Equilibrar o Efeito
   - Comece com 30% Wet Mix
   - Mantenha Dry Mix em 100% para audição normal
   - Ajuste fino baseado em sua música e preferências

O FDN Reverb transforma sua experiência de audição adicionando espaços acústicos realistas com reverberação bela e natural a qualquer gravação. Perfeito para amantes da música que querem aprimorar suas faixas favoritas com reverberação bela e natural!

## RS Reverb

Um efeito que pode transportar sua música para diferentes espaços, desde salas aconchegantes até salões majestosos. Adiciona ecos e reflexões naturais que tornam sua música mais tridimensional e imersiva.

### Guia de Experiência de Audição
- Espaço Íntimo:
  - Faz a música parecer estar em uma sala quente e aconchegante
  - Perfeito para audição próxima e pessoal
  - Adiciona profundidade sutil sem perder clareza
- Experiência de Sala de Concerto:
  - Recria a grandiosidade de apresentações ao vivo
  - Adiciona espaço majestoso à música clássica e orquestral
  - Cria uma experiência de concerto imersiva
- Aprimoramento Atmosférico:
  - Adiciona qualidades sonhadoras e etéreas
  - Perfeito para música ambiente e atmosférica
  - Cria paisagens sonoras envolventes

### Parâmetros
- **Pre-Delay** - Controla quão rapidamente o efeito de espaço começa (0 a 50 ms)
  - Valores mais baixos: Sensação imediata e íntima
  - Valores mais altos: Mais sensação de distância
  - Comece com 10ms para som natural
- **Room Size** - Define quão grande o espaço parece (2.0 a 50.0 m)
  - Pequeno (2-5m): Sensação de sala aconchegante
  - Médio (5-15m): Atmosfera de sala ao vivo
  - Grande (15-50m): Grandiosidade de sala de concerto
- **Reverb Time** - Quanto tempo os ecos duram (0.1 a 10.0 s)
  - Curto (0.1-1.0s): Som claro e focado
  - Médio (1.0-3.0s): Som natural de sala
  - Longo (3.0-10.0s): Espacioso e atmosférico
- **Density** - Quão rico o espaço parece (4 a 8)
  - Valores mais baixos: Ecos mais definidos
  - Valores mais altos: Atmosfera mais suave
  - Comece com 6 para som natural
- **Diffusion** - Como o som se espalha (0.2 a 0.8)
  - Valores mais baixos: Ecos mais distintos
  - Valores mais altos: Mistura mais suave
  - Tente 0.5 para som equilibrado
- **Damping** - Como os ecos desaparecem (0 a 100%)
  - Valores mais baixos: Som mais brilhante e aberto
  - Valores mais altos: Mais quente e íntimo
  - Comece em torno de 40% para sensação natural
- **High Damp** - Controla o brilho do espaço (1000 a 20000 Hz)
  - Valores mais baixos: Espaço mais escuro e quente
  - Valores mais altos: Mais brilhante e aberto
  - Comece em torno de 8000Hz para som natural
- **Low Damp** - Controla a plenitude do espaço (20 a 500 Hz)
  - Valores mais baixos: Som mais cheio e rico
  - Valores mais altos: Mais claro e controlado
  - Comece em torno de 100Hz para graves equilibrados
- **Mix** - Equilibra o efeito com o som original (0 a 100%)
  - 10-30%: Aprimoramento sutil
  - 30-50%: Espaço notável
  - 50-100%: Efeito dramático

### Configurações Recomendadas para Diferentes Estilos de Música

1. Música Clássica em Sala de Concerto
   - Room Size: 30-40m
   - Reverb Time: 2.0-2.5s
   - Mix: 30-40%
   - Perfeito para: Obras orquestrais, concertos de piano

2. Clube de Jazz Íntimo
   - Room Size: 8-12m
   - Reverb Time: 1.0-1.5s
   - Mix: 20-30%
   - Perfeito para: Jazz, apresentações acústicas

3. Pop/Rock Moderno
   - Room Size: 15-20m
   - Reverb Time: 1.2-1.8s
   - Mix: 15-25%
   - Perfeito para: Música contemporânea

4. Ambiente/Eletrônica
   - Room Size: 25-40m
   - Reverb Time: 3.0-6.0s
   - Mix: 40-60%
   - Perfeito para: Música eletrônica atmosférica

### Guia de Início Rápido

1. Escolha Seu Espaço
   - Comece com Room Size para definir o espaço básico
   - Ajuste Reverb Time para a atmosfera desejada
   - Ajuste fino do Mix para equilíbrio adequado

2. Molde o Som
   - Use Damping para controlar o calor
   - Ajuste High/Low Damp para o tom
   - Configure Density e Diffusion para textura

3. Ajuste Fino do Efeito
   - Adicione Pre-Delay para mais profundidade
   - Ajuste Mix para equilíbrio final
   - Confie em seus ouvidos e ajuste ao gosto

Lembre-se: O objetivo é aprimorar sua música com espaço e atmosfera naturais. Comece com configurações sutis e ajuste até encontrar o equilíbrio perfeito para sua experiência de audição!