---
title: "Plugins de restauração - EffeTune"
description: "Plugins de restauração para cliques, picos clipados, zumbido elétrico e ruído de fundo constante."
lang: pt
---

# Plugins de restauração

Os plugins de restauração reduzem problemas indesejados de uma gravação sem tirar o prazer de ouvir a música.

## Lista de plugins

- [Click Remover](#click-remover) - Repara cliques, estalos, pops e pequenas falhas
- [Clip Restorer](#clip-restorer) - Restaura picos achatados por clipping intenso
- [Hum Remover](#hum-remover) - Remove zumbido elétrico constante e seus harmônicos
- [Noise Reduction](#noise-reduction) - Reduz chiado e zumbido constantes de fundo sem prejudicar a música

## Click Remover

Click Remover corrige falhas curtas e isoladas, como estalos de disco, pops, cliques e pequenas interrupções. Use-o para ocorrências ocasionais, não para chiado ou zumbido constantes.

### Guia de escuta

1. Comece com **Sensitivity** em 50% e **Max Repair Length** em 1 ms.
2. Aumente **Sensitivity** aos poucos até os cliques incomodarem menos. Se ataques de bateria ou outros detalhes nítidos ficarem suaves, reduza-o.
3. Aumente **Max Repair Length** somente para pops ou falhas mais longos; mantenha-o curto para estalos comuns.
4. Durante o trecho afetado, confira **REPAIRS/S** e compare com o efeito desativado antes de manter um ajuste mais forte.

### Parâmetros

- **Sensitivity** (0–100%, inicial 50%) controla a facilidade com que uma mudança curta é tratada como falha. Valores altos reparam mais cliques suspeitos; valores baixos são mais conservadores e preservam ataques musicais.
- **Max Repair Length** (0,1–2 ms, inicial 1 ms) limita a duração de cada reparo. Aumente para pops ou falhas um pouco mais longos e reduza para estalos curtos.

### Como ler a tela

**REPAIRS/S** mostra o número recente de reparos por segundo. Um valor próximo de zero indica que não há falhas curtas sendo reparadas. Um valor alto e contínuo em música normal é motivo para reduzir **Sensitivity** ou **Max Repair Length**.

## Clip Restorer

Clip Restorer reconstrói picos achatados por clipping digital intenso. É útil em gravações com distorção de topo plano evidente, mas não recupera todos os detalhes perdidos antes de o áudio chegar ao EffeTune.

### Guia de escuta

1. Comece com **Threshold** em -0,10 dB e **Output Gain** em -3 dB.
2. Reduza um pouco **Threshold** se ainda houver picos claramente clipados. Aumente-o em direção a 0 dB se sons altos e sustentados forem alterados sem necessidade.
3. Quando possível, mantenha **Output Gain** abaixo de 0 dB; picos restaurados podem superar os picos achatados originais.
4. Veja **RESTORED** em um trecho danificado e compare com o efeito desativado para escolher o ajuste menos invasivo.

### Parâmetros

- **Threshold** (-18–0 dB, inicial -0,10 dB) define o nível tratado como pico clipado. Perto de 0 dB, trata apenas picos quase em escala total; valores menores incluem clipping menos evidente, mas podem afetar mais material alto.
- **Output Gain** (-12–0 dB, inicial -3 dB) define o nível de saída após a restauração. Aumente em direção a 0 dB para mais volume ou reduza para deixar mais margem.

### Como ler a tela

**RESTORED** mostra a porcentagem recente de amostras reparadas como picos clipados. Um valor pequeno pode ser normal, pois o clipping costuma ser breve. Se permanecer alto em material que não parece clipado, aumente **Threshold**.

## Hum Remover

Hum Remover reduz zumbido elétrico constante e seus harmônicos, como o de 50 ou 60 Hz vindo de toca-discos, cabos ou alimentação. Ele serve para um tom contínuo, não para ruído geral de fundo.

### Guia de escuta

1. Comece com **Frequency** em **Auto**, **Harmonics** em 8 e **Tracking Speed** em 50%.
2. Se souber a frequência elétrica da gravação, escolha **50 Hz** ou **60 Hz**. Caso contrário, deixe **Auto** e confira **FUNDAMENTAL**.
3. Aumente **Harmonics** se ainda restar zumbido acima da fundamental; reduza-o se a música perder corpo ou detalhes.
4. Aumente **Tracking Speed** se o zumbido variar lentamente de altura; reduza para um zumbido estável. Se um baixo sustentado coincidir exatamente com um harmônico, reduza **Harmonics**.

### Parâmetros

- **Frequency** (**Auto**, **50 Hz** ou **60 Hz**; inicial **Auto**) seleciona a fundamental do zumbido. **Auto** acompanha um zumbido de rede detectado; escolha um valor fixo se a frequência for conhecida.
- **Harmonics** (1–64, inicial 8) escolhe quantos múltiplos da fundamental serão removidos. Valores altos limpam mais zumbido; valores baixos preservam mais música perto dos harmônicos altos. O controle deslizante usa uma escala logarítmica para permitir ajustes mais precisos nos valores baixos.
- **Tracking Speed** (0–100%, inicial 50%) controla a rapidez do acompanhamento automático. Valores altos acompanham mudanças mais depressa; valores baixos servem para um zumbido estável.

### Como ler a tela

**FUNDAMENTAL** mostra a frequência que está sendo tratada. **REMOVED** mostra, em dBFS, o nível do componente removido: mais perto de 0 dBFS significa zumbido removido mais forte; um valor muito baixo, como -140 dBFS, significa pouco ou nenhum zumbido removido.

## Noise Reduction

Noise Reduction reduz ruído de fundo constante, como chiado de fita, ruído de equipamento ou ruído do ambiente. Use-o quando houver uma camada contínua de ruído atrás da música. Ele funciona melhor com ruído que permanece entre as notas; não foi feito para remover cliques isolados, sons de fundo variáveis ou outra música na gravação.

### Guia de escuta

1. Comece com **Reduction** 12 dB, **Sensitivity** 0 dB, **Smoothing** 50%, **Treble Care** 50% e **Mix** 100%.
2. Aumente **Reduction** aos poucos até limpar as partes silenciosas. Diminua se vozes, pratos ou a ambiência parecerem pouco naturais.
3. Para chiado contínuo evidente, aumente um pouco **Sensitivity**; para música já limpa, diminua-o.
4. Se a redução parecer oscilar ou mudar a cor do som, aumente **Smoothing**. Se a música ficar suave demais, diminua **Smoothing** ou **Reduction**.
5. Compare com o efeito desativado e use **Mix** para manter parte do som original quando isso soar mais natural.

### Parâmetros

- **Reduction** (0–24 dB, inicial 12 dB) define a redução máxima do ruído de fundo. Valores baixos são mais sutis; valores altos reduzem mais ruído, mas podem esconder detalhes fracos. Para ruído leve, comece entre 6 e 12 dB.
- **Sensitivity** (-12–+12 dB, inicial 0 dB) controla quão facilmente o som é tratado como ruído de fundo. Aumente se o ruído constante ainda estiver audível; diminua se instrumentos suaves, caudas de reverb ou ambiência forem reduzidos demais. Pequenos ajustes costumam bastar.
- **Smoothing** (0–100%, inicial 50%) torna a redução mais uniforme entre frequências próximas. Valores altos ajudam a evitar um caráter oscilante ou aquoso; valores baixos agem de modo mais seletivo. Se a música ficar opaca, reduza este valor e **Reduction**.
- **Treble Care** (0–100%, inicial 50%) protege detalhes musicais de alta frequência. Aumente para preservar o brilho de pratos, cordas e vozes; diminua somente se o chiado agudo continuar incômodo. Um valor intermediário equilibra a maioria das músicas.
- **Mix** (0–100%, inicial 100%) equilibra o resultado tratado e o original. Em 100%, você ouve apenas o resultado tratado; diminua se um pouco da ambiência original soar mais natural. Em 0%, o som não muda, útil para comparar.

### Ajustes recomendados

1. **Limpeza suave:** Reduction 6–10 dB, Sensitivity -2 a 0 dB, Smoothing 40–60%, Treble Care 50–70%.
2. **Chiado claro de fita ou equipamento:** Reduction 12–18 dB, Sensitivity 0 a +4 dB, Smoothing 60–80%, Treble Care 50–70%.
3. **Preservar agudos delicados:** Reduction 6–12 dB, Sensitivity -4 a 0 dB, Smoothing 50–70%, Treble Care 70–100%, Mix 70–100%.
