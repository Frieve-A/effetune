---
title: "Plugins de Modulação - EffeTune"
description: "Efeitos de modulação, incluindo Auto Filter, Auto Pan, Chorus, Frequency Shifter, Phaser e Rotary Speaker."
lang: pt
---

# Plugins de Modulação

Uma coleção de plugins que adicionam movimento e variação à sua música através de efeitos de modulação. Esses efeitos podem fazer com que sua música digital pareça mais orgânica e dinâmica, aprimorando sua experiência auditiva com variações sutis ou dramáticas no som.

## Lista de Plugins

- [Auto Filter](#auto-filter) - Varre um filtro ressonante por LFO ou envelope
- [Auto Pan](#auto-pan) - Move suavemente cada par estéreo no campo sonoro
- [Chorus](#chorus) - Reúne chorus, ensemble, flanger e vibrato com atrasos móveis
- [Doppler Distortion](#doppler-distortion) - Simula as mudanças naturais e dinâmicas no som decorrentes do sutil movimento do cone do alto-falante.
- [Frequency Shifter](#frequency-shifter) - Desloca frequências, aplica Ring Mod ou varredura barber-pole
- [Phaser](#phaser) - Cria picos e vales móveis com filtros all-pass
- [Pitch Shifter](#pitch-shifter) - Altera o tom da sua música sem afetar a velocidade de reprodução
- [Pitch Shifter HQ](#pitch-shifter-hq) - Altera o pitch com menos artefatos de fase quando a qualidade importa mais que a latência ou o uso de CPU
- [Rotary Speaker](#rotary-speaker) - Combina o movimento independente de corneta e tambor
- [Tremolo](#tremolo) - Cria variações rítmicas de volume para um som pulsante e dinâmico
- [Wow Flutter](#wow-flutter) - Reproduz as suaves variações de pitch de discos de vinil e toca-fitas

## Auto Filter

Move automaticamente um filtro ressonante. LFO repete uma varredura; Envelope acompanha o nível da música para sons de Envelope Filter ou Auto Wah.

### Dicas de ajuste

- Para uma mudança tonal suave, comece com LFO, Low-pass, Resonance baixa e Mix em torno de 30–50%.
- Para Auto Wah, escolha Envelope e Band-pass e ajuste Sensitivity para que sons fortes abram o filtro na medida certa.
- Um Attack mais longo suaviza a resposta aos ataques; um Release mais longo torna o retorno mais gradual.

### Parâmetros

- **Predefinições do sistema**: Use **Auto Filter Sweep**, **Stereo Filter Sweep**, **Envelope Filter**, **Auto Wah** ou **Reverse Auto Wah** para carregar uma configuração inicial completa. Depois, ajuste os parâmetros individualmente para refiná-la.
- **Mode**: Alterna entre o movimento periódico do LFO e o Envelope que acompanha o volume.
- **Filter Type**: Low-pass, Band-pass ou High-pass.
- **Minimum Frequency / Maximum Frequency** (20–20.000 Hz): Faixa de movimento. Valores invertidos são reordenados automaticamente; valores iguais fixam o filtro. O limite superior disponível pode ser menor em taxas de amostragem mais baixas.
- **Resonance** (Q 0,5–20): Valores maiores realçam mais a região próxima ao corte.
- **Mix** (0–100%): Proporção entre o som original e o filtrado. Em 0%, permanece apenas o som original.
- **Rate**, **Waveform**, **Stereo Phase**: Velocidade, trajetória e diferença de fase em cada par estéreo do LFO. Usados apenas no modo LFO.
- **Sensitivity**, **Attack**, **Release**, **Direction**: Quantidade de resposta, subida, retorno e direção do envelope. Usados apenas no modo Envelope.

## Auto Pan

Move o nível de cada par estéreo entre esquerda e direita. Se houver um canal sem par, ele permanece no centro.

### Dicas de ajuste

- Comece com Rate em torno de 0,2–0,5 Hz e Depth moderada para um movimento tranquilo.
- Se o efeito parecer amplo demais nos fones, reduza Width; ajuste a posição-base com Center.
- Sine se move mais devagar nas extremidades; Triangle mantém uma velocidade mais uniforme.

### Parâmetros

- **Predefinições do sistema**: Use **Gentle Auto Pan**, **Wide Auto Pan** ou **Fast Auto Pan** para carregar uma configuração inicial completa. Depois, ajuste os parâmetros individualmente para refiná-la.
- **Rate** (0,05–20 Hz): Velocidade do movimento.
- **Depth** (0–100%): Movimento em torno de Center. Em 0%, não há mudança.
- **Center** (-100–100%): Desloca a posição central para a esquerda ou direita.
- **Width** (0–100%): Largura estéreo utilizada.
- **Waveform**: Sine ou Triangle.
- **Phase** (0–360°): Posição inicial do movimento periódico.

## Chorus

Adiciona cópias da música com atrasos em movimento. Mode oferece Chorus, Stereo Chorus, Ensemble, Flanger e Vibrato; aumentar Delay e Depth pode fazer o som processado parecer um pouco atrasado em relação ao original.

### Dicas de ajuste

- Para dar espessura natural, use Classic Chorus ou Stereo Chorus com Rate e Depth moderadas.
- Ensemble fica mais denso à medida que Voices aumenta. Depth excessiva torna a oscilação de pitch mais evidente.
- Apenas Flanger usa Feedback; valores positivos e negativos mudam a polaridade do filtro comb.
- Vibrato é sempre 100% wet.

### Parâmetros

- **Predefinições do sistema**: Use **Classic Chorus**, **Stereo Chorus**, **Ensemble**, **Flanger**, **Jet Flanger** ou **Vibrato** para carregar uma configuração inicial completa. Depois, ajuste os parâmetros individualmente para refiná-la.
- **Mode**: Chorus, Stereo Chorus, Ensemble, Flanger ou Vibrato.
- **Rate** (0,05–10 Hz): Velocidade da modulação.
- **Delay** (0,5–30 ms): Atraso-base do sinal processado.
- **Depth** (0–20 ms): Variação do atraso. Depth é limitado automaticamente ao valor de Delay.
- **Voices** (1–6): Número de taps variáveis em Chorus e Ensemble. Ignorado nos outros modos.
- **Stereo Spread** (0–100%): Diferença de modulação em cada par estéreo. Ignorado no modo Chorus.
- **Feedback** (-75–75%): Usado apenas em Flanger.
- **Mix** (0–100%): Proporção linear entre som original e processado. Ignorado em Vibrato, que é sempre 100% wet.

## Doppler Distortion

Experimente um efeito de áudio único que confere um toque de movimento natural à sua música. Doppler Distortion simula as suaves distorções causadas pelo movimento físico do cone do alto-falante. Este efeito introduz pequenas alterações na profundidade e no timbre do som, assim como as mudanças de tom que você ouve quando uma fonte sonora se desloca em relação a você. Adiciona uma qualidade dinâmica e imersiva à sua experiência de audição, fazendo com que o áudio pareça mais vivo e envolvente.

### Parâmetros

- **Coil Force (N / V)**
  Controla o quanto o sinal de entrada aciona o movimento simulado da bobina do alto-falante. Valores mais altos resultam em uma Doppler distortion mais pronunciada.

- **Speaker Mass (kg)**
  Simula o peso do cone do alto-falante, influenciando a naturalidade com que o movimento é reproduzido.
  - **Valores mais altos:** Aumentam a inércia, resultando em uma resposta mais lenta e em distorções mais suaves e sutis.
  - **Valores mais baixos:** Reduzem a inércia, causando um efeito de modulação mais rápido e pronunciado.

- **Spring Constant (N/m)**
  Determina a rigidez da suspensão do alto-falante. Um Spring Constant maior produz uma resposta mais nítida e definida.

- **Damping Factor (N·s/m)**
  Ajusta a rapidez com que o movimento simulado se estabiliza, equilibrando um movimento vibrante com transições suaves.
  - **Valores mais altos:** Levam a uma estabilização mais rápida, reduzindo as oscilações e produzindo um efeito mais preciso e controlado.
  - **Valores mais baixos:** Permitem que o movimento persista por mais tempo, resultando em uma flutuação dinâmica mais solta e prolongada.

### Configurações Recomendadas

Para um aprimoramento equilibrado e natural, comece com:
- **Coil Force:** 8.0 N / V
- **Speaker Mass:** 0.03 kg
- **Spring Constant:** 6000 N/m
- **Damping Factor:** 1.5 N·s/m

Essas configurações proporcionam um Doppler Distortion sutil que enriquece a experiência de audição sem sobrecarregar o som original.

## Frequency Shifter

Move cada componente de frequência por um número fixo de hertz, e não por um intervalo musical. Ring Mod cria bandas laterais metálicas; Barber-pole dá a impressão de um deslocamento que continua subindo ou descendo. O efeito adiciona um pequeno atraso que varia com a taxa de amostragem, inclusive com Mix em 0%.

### Dicas de ajuste

- Para uma mudança sutil, escolha Shift e comece em torno de ±5–15 Hz. Ao contrário do Pitch Shifter, o espaçamento dos harmônicos também muda.
- Para timbres metálicos, use Ring Mod. Uma Carrier Frequency menor ajuda a preservar o ritmo original.
- Para movimento contínuo, use Barber-pole com Rate baixa e Mix moderado para manter a clareza.

### Parâmetros

- **Predefinições do sistema**: Use **Shift Up**, **Shift Down**, **Fine Detune**, **Ring Modulator**, **Barber-pole Up** ou **Barber-pole Down** para carregar uma configuração inicial completa. Depois, ajuste os parâmetros individualmente para refiná-la.
- **Mode**: Shift, Ring Mod ou Barber-pole.
- **Shift** (-5.000–5.000 Hz): Deslocamento no modo Shift. Valores positivos deslocam para cima; negativos, para baixo.
- **Carrier Frequency** (0,1–10.000 Hz): Frequência da portadora de Ring Mod.
- **Minimum Shift / Maximum Shift** (0–5.000 Hz): Faixa de Barber-pole. Valores invertidos são reordenados; valores iguais fixam o deslocamento.
- **Rate** (0,01–2 Hz), **Direction**: Velocidade e direção de Barber-pole.
- **Stereo Phase** (0–180°): Em todos os modos, cria uma diferença na portadora ou varredura entre esquerda e direita de cada par estéreo.
- **Mix** (0–100%): Proporção entre o som original com atraso alinhado e o processado. Mesmo em 0%, a latência fixa indicada permanece.

Se um deslocamento grande soar áspero ou metálico de forma indesejada, reduza Shift ou Mix.

## Phaser

Mistura o som original com cópias filtradas para criar picos e vales móveis. Classic vai e volta; Barber-pole sugere movimento contínuo para cima ou para baixo.

### Dicas de ajuste

- Para vales claros, comece com Classic, 4–6 Stages, Range moderada e Mix em torno de 50%.
- Aumentar Stages e Feedback deixa o efeito mais profundo e ressonante. Reduza-os se os ataques ficarem coloridos demais.
- Ajuste a abertura com Stereo Phase e escolha Barber-pole Up/Down para movimento contínuo.

### Parâmetros

- **Predefinições do sistema**: Use **Classic Phaser**, **Deep Phaser**, **Stereo Phaser**, **Barber-pole Up** ou **Barber-pole Down** para carregar uma configuração inicial completa. Depois, ajuste os parâmetros individualmente para refiná-la.
- **Mode**: Classic ou Barber-pole.
- **Rate** (0,05–10 Hz): Velocidade da varredura.
- **Center Frequency** (80–8.000 Hz): Centro da varredura logarítmica.
- **Range** (0–6 oitavas): Largura da varredura.
- **Stages** (números pares de 2 a 12): Número de estágios all-pass. Mais estágios criam mais vales.
- **Feedback** (-90–90%): Quantidade do som processado devolvida à entrada. O valor absoluto define a força; o sinal muda a forma de realce.
- **Stereo Phase** (0–180°): Diferença de movimento em cada par estéreo.
- **Direction**: Up/Down de Barber-pole. Ignorado em Classic.
- **Mix** (0–100%): Proporção linear entre som original e processado. O cancelamento é mais profundo perto do centro.

## Pitch Shifter

Um efeito que altera o tom da sua música sem afetar a velocidade de reprodução. Isso permite que você experimente suas músicas favoritas em diferentes tonalidades, fazendo com que soem mais altas ou mais baixas, mantendo o tempo e o ritmo originais.

### Parâmetros
- **Pitch Shift** - Altera o tom geral em semitons (-6 a +6)
  - Valores negativos: Reduz o tom (som mais profundo e grave)
  - Zero: Sem alteração (tom original)
  - Valores positivos: Aumenta o tom (som mais agudo e brilhante)
- **Fine Tune** - Faz ajustes sutis no pitch em cents (-50 a +50)
  - Permite uma afinação precisa entre semitons
  - Ideal para pequenos ajustes quando um semitom completo é excessivo
- **Window Size** - Controla o tamanho da janela de análise em milissegundos (80 a 500ms)
  - Valores menores (80-150ms): Melhor para materiais ricos em transientes, como percussão
  - Valores médios (150-300ms): Bom equilíbrio para a maioria das músicas
  - Valores maiores (300-500ms): Melhor para sons suaves e sustentados
- **XFade Time** - Define o tempo de crossfade entre segmentos processados em milissegundos (20 a 40ms)
  - Afeta a suavidade com que os segmentos com pitch modificado se fundem
  - Valores mais baixos podem soar mais imediatos, porém potencialmente menos suaves
  - Valores mais altos criam transições mais suaves entre os segmentos, mas podem aumentar a oscilação do som e criar uma sensação de sobreposição

## Pitch Shifter HQ

Um alterador de pitch de maior qualidade para audição atenta, indicado quando reduzir o espalhamento de fase importa mais que baixa latência ou menor uso de CPU. Ele muda o pitch sem alterar a velocidade de reprodução e mantém os componentes espectrais mais coesos que o Pitch Shifter padrão. Em contrapartida, usa mais CPU e acrescenta um atraso fixo de processamento de aproximadamente 106,7–116,1ms: cerca de 106,7ms a 48, 96 e 192kHz, e cerca de 116,1ms a 44,1, 88,2 e 176,4kHz. Requer o mecanismo DSP WASM do EffeTune; se esse mecanismo não estiver disponível, o áudio passa sem processamento.

O Pitch Shifter HQ não preserva os formantes. Portanto, mudanças maiores alteram tanto o timbre aparente de vozes e instrumentos quanto o pitch.

### Guia de experiência auditiva

- Para uma mudança sutil, comece com **Pitch Shift** em -1 ou +1 e deixe **Fine Tune** em 0.
- Use **Fine Tune** para ajustar músicas ligeiramente acima ou abaixo da afinação sem deslocá-las um semitom inteiro.
- Escolha o Pitch Shifter HQ em vez do Pitch Shifter padrão quando a redução dos artefatos de fase compensar o maior uso de CPU e o atraso adicional. Use a versão padrão quando a latência for importante ou em dispositivos menos potentes.
- Compare mudanças maiores com cuidado: o pitch muda de forma estável, mas a falta de preservação de formantes torna a alteração de timbre mais evidente.

### Parâmetros

- **Pitch Shift** - Altera o pitch geral em semitons (-6 a +6)
  - Valores negativos reduzem o pitch e valores positivos o elevam
  - Zero mantém o pitch inalterado
- **Fine Tune** - Ajusta o pitch em cents (-50 a +50)
  - Permite um ajuste preciso entre semitons
  - 100 cents equivalem a um semitom

## Rotary Speaker

Divide o som entre uma corneta de agudos e um tambor de graves e aplica velocidades de rotação diferentes. O movimento de nível e um curto atraso Doppler criam o movimento característico de dois rotores.

### Dicas de ajuste

- Slow cria movimento tranquilo e Fast uma rotação mais intensa. Acceleration mais longa torna as mudanças de velocidade mais naturais.
- Ajuste o movimento de pitch com Doppler Depth e o de volume com Amplitude Depth.
- Use Rotor Balance para equilibrar tambor e corneta e Stereo Width para ajustar a abertura.

### Parâmetros

- **Predefinições do sistema**: Use **Rotary Slow**, **Rotary Fast**, **Gentle Rotary**, **Vintage Rotor Slow** ou **Vintage Rotor Fast** para carregar uma configuração inicial completa. Depois, ajuste os parâmetros individualmente para refiná-la.
- **Speed State**: Stop, Slow ou Fast. Durante a mudança, os rotores aceleram ou desaceleram suavemente sem interromper o som.
- **Speed** (25–200%): Multiplicador de velocidade da corneta e do tambor.
- **Acceleration** (0,1–10 s): Define a rapidez com que os rotores se aproximam de uma nova velocidade.
- **Crossover** (200–2.000 Hz): Frequência que separa as bandas do tambor e da corneta.
- **Rotor Balance** (-100–100%): Valores negativos realçam o tambor; positivos, a corneta.
- **Stereo Width** (0–100%): Abertura de cada par estéreo.
- **Doppler Depth** (0–100%): Variação de pitch criada pelo atraso variável.
- **Amplitude Depth** (0–100%): Variação de volume criada pela direção do rotor virtual.
- **Mix** (0–100%): Proporção entre som original e rotativo. Em 0%, permanece apenas o som original.

## Tremolo

Um efeito que adiciona variações rítmicas de volume à sua música, semelhante ao som pulsante encontrado em amplificadores vintage e gravações clássicas. Isso cria uma qualidade dinâmica e expressiva que adiciona movimento e interesse à sua experiência auditiva.

### Guia de Experiência Auditiva
- Experiência com Amplificador Clássico:
  - Recria o icônico som pulsante dos amplificadores valvulados vintage
  - Adiciona movimento rítmico a gravações estáticas
  - Cria uma experiência auditiva hipnótica e envolvente
- Caráter de Gravação Vintage:
  - Simula os efeitos naturais de tremolo usados em gravações clássicas
  - Adiciona caráter vintage e calor
  - Perfeito para ouvir jazz, blues e rock
- Atmosfera Criativa:
  - Cria aumentos e reduções dramáticas
  - Adiciona intensidade emocional à música
  - Perfeito para ouvir música ambiente e atmosférica

### Parâmetros
- **Rate** - Quão rápido o volume muda (0.1 a 50 Hz)
  - Mais lento (0.1-2 Hz): Pulsação suave e sutil
  - Médio (2-6 Hz): Efeito tremolo clássico
  - Mais rápido (6-20 Hz): Efeitos dramáticos e entrecortados
  - Muito rápido (20-50 Hz): Modulação de volume extremamente rápida, que pode adicionar textura áspera ou zumbida; use com moderação para uma escuta confortável
- **Depth** - Quanto o volume varia (0 a 12 dB)
  - Sutil (0-3 dB): Variações gentis de volume
  - Médio (3-6 dB): Efeito de pulsação notável
  - Forte (6-12 dB): Incréscimos dramáticos de volume
- **Ch Phase** - Diferença de fase entre os canais estéreo (-180 a 180 graus)
  - 0°: Ambos os canais pulsam juntos (tremolo mono)
  - 90° ou -90°: Cria um efeito giratório e de redemoinho
  - 180° ou -180°: Os canais pulsam em direções opostas (largura estéreo máxima)
- **Randomness** - Quão irregulares se tornam as variações de volume (0 a 96 dB)
  - Baixo: Pulsação mais previsível e regular
  - Médio: Variação vintage natural
  - Alto: Som mais instável e orgânico
- **Randomness Cutoff** - Velocidade com que as mudanças aleatórias acontecem (1 a 1000 Hz)
  - Mais baixo: Variações aleatórias mais lentas e suaves
  - Mais alto: Mudanças mais rápidas e imprevisíveis
- **Randomness Slope** - Controla a intensidade da filtragem de aleatoriedade (-12 a 0 dB)
  - -12 dB: Variações aleatórias mais suaves e graduais (efeito mais sutil)
  - -6 dB: Resposta equilibrada
  - 0 dB: Variações aleatórias mais acentuadas e pronunciadas (efeito mais forte)
- **Ch Sync** - Nível de sincronização da aleatoriedade entre os canais (0 a 100%)
  - 0%: Cada canal possui aleatoriedade independente
  - 50%: Sincronização parcial entre os canais
  - 100%: Ambos os canais compartilham o mesmo padrão de aleatoriedade

### Configurações Recomendadas para Diferentes Estilos

1. Tremolo de Amplificador Clássico de Guitarra
   - Rate: 4-6 Hz (velocidade média)
   - Depth: 6-8 dB
   - Ch Phase: 0° (mono)
   - Randomness: 0-5 dB
   - Perfeito para: Blues, Rock, Surf Music

2. Efeito Psicodélico Stereo
   - Rate: 2-4 Hz
   - Depth: 4-6 dB
   - Ch Phase: 180° (canais opostos)
   - Randomness: 10-20 dB
   - Perfeito para: Psychedelic Rock, Eletrônica, Experimental

3. Realce Sutil
   - Rate: 1-2 Hz
   - Depth: 2-3 dB
   - Ch Phase: 0-45°
   - Randomness: 5-10 dB
   - Perfeito para: Qualquer música que precise de um movimento suave

4. Pulsação Dramática
   - Rate: 8-12 Hz
   - Depth: 8-12 dB
   - Ch Phase: 90°
   - Randomness: 20-30 dB
   - Perfeito para: Eletrônica, Dance, Ambient

### Guia de Início Rápido

1. Para um Som de Tremolo Clássico:
   - Comece com Rate médio (4-5 Hz)
   - Adicione Depth moderado (6 dB)
   - Configure Ch Phase para 0° para mono ou 90° para movimento estéreo
   - Mantenha Randomness baixo (0-5 dB)
   - Ajuste conforme o gosto

2. Para Mais Caráter:
   - Aumente Randomness gradualmente
   - Experimente diferentes configurações de Ch Phase
   - Teste diferentes combinações de Rate e Depth
   - Confie no seu ouvido

## Wow Flutter

Um efeito que adiciona sutis variações de pitch à sua música, semelhante ao som de oscilação natural que você pode lembrar dos discos de vinil ou fitas cassete. Isso cria uma sensação calorosa e nostálgica que muitas pessoas consideram agradável e relaxante.

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para comparar configurações completas do comportamento do mecanismo de transporte.

- **Warped Record** - Uma oscilação profunda e periódica típica de um disco empenado.
- **Worn Cassette Motor** - Um flutter mais rápido, com movimentos irregulares.
- **Seasick Tape** - Uma oscilação lenta e extrema, com movimento independente em cada canal estéreo.

### Guia de Experiência Auditiva
- Experiência com Disco de Vinil:
  - Recria a oscilação suave dos toca-discos
  - Adiciona movimento orgânico ao som
  - Cria uma atmosfera aconchegante e nostálgica
- Memória de Fita Cassete:
  - Simula o flutter característico dos tocadores de fita
  - Adiciona o caráter vintage dos tocadores de fita
  - Perfeito para vibes lo-fi e retrô
- Atmosfera Criativa:
  - Cria efeitos oníricos, semelhantes a debaixo d'água
  - Adiciona movimento e vida a sons estáticos
  - Perfeito para ouvir ambient e experimental

### Parâmetros
- **Rate** - Quão rápido o som oscila (0.1 a 20 Hz)
  - Mais lento (0.1-2 Hz): Movimento semelhante a de um disco de vinil
  - Médio (2-6 Hz): Flutter semelhante ao de uma fita cassete
  - Mais rápido (6-20 Hz): Efeitos criativos
- **Depth** - O quanto o tempo de delay é modulado, criando a oscilação de pitch (0 a 40 ms)
  - Sutil (0-6 ms): Caráter vintage suave
  - Médio (6-15 ms): Sensação de fita/disco claramente audível
  - Forte (15-40 ms): Efeitos especiais dramáticos
- **Ch Phase** - Diferença de fase entre canais estéreo (-180 a 180 graus)
  - 0°: Ambos os canais oscilam juntos
  - 90° ou -90°: Cria um efeito giratório e de redemoinho
  - 180° ou -180°: Os canais oscilam em direções opostas
- **Randomness** - Quão irregular se torna a oscilação (0 a 40 ms)
  - Baixo: Movimento mais previsível e regular
  - Médio: Variação vintage natural
  - Alto: Som mais instável, como de equipamento desgastado
- **Randomness Cutoff** - Quão rápidas são as mudanças aleatórias (0.1 a 20 Hz)
  - Menor: Mudanças mais lentas e suaves
  - Maior: Mudanças mais rápidas e erráticas
- **Randomness Slope** - Controla a intensidade da filtragem de aleatoriedade (-12 a 0 dB)
  - -12 dB: Variações aleatórias mais suaves e graduais (efeito mais sutil)
  - -6 dB: Resposta equilibrada
  - 0 dB: Variações aleatórias mais acentuadas e pronunciadas (efeito mais forte)
- **Ch Sync** - Nível de sincronização da aleatoriedade entre os canais (0 a 100%)
  - 0%: Cada canal possui aleatoriedade independente
  - 50%: Sincronização parcial entre os canais
  - 100%: Ambos os canais compartilham o mesmo padrão de aleatoriedade

### Configurações Recomendadas para Diferentes Estilos

1. Experiência Clássica de Vinil
   - Rate: 0.3-0.8 Hz (movimento lento e suave)
   - Depth: 2-6 ms
   - Randomness: 1-4 ms
   - Randomness Cutoff: 0.5-3 Hz
   - Ch Phase: 0°
   - Ch Sync: 100%
   - Perfeito para: Jazz, Música Clássica, Vintage Rock

2. Sensação de Cassete Retrô
   - Rate: 4-6 Hz (flutter mais rápido)
   - Depth: 1-3 ms
   - Randomness: 1-5 ms
   - Randomness Cutoff: 3-8 Hz
   - Ch Phase: 0-30°
   - Ch Sync: 80-100%
   - Perfeito para: Lo-Fi, Pop, Rock

3. Atmosfera Onírica
   - Rate: 1-2 Hz
   - Depth: 25-30 ms
   - Randomness: 20-25 ms
   - Ch Phase: 90-180°
   - Ch Sync: 50-70%
   - Perfeito para: Ambient, Eletrônica, Experimental

4. Realce Sutil
   - Rate: 1-2 Hz
   - Depth: 2-5 ms
   - Randomness: 1-3 ms
   - Ch Phase: 0°
   - Ch Sync: 100%
   - Perfeito para: Qualquer música que precise de um caráter vintage suave

### Guia de Início Rápido

1. Para um Som Vintage Natural:
   - Comece com Rate lento (0.5-1 Hz)
   - Adicione Depth leve (2-6 ms)
   - Inclua um pouco de Randomness (1-4 ms)
   - Use Randomness Cutoff em torno de 0.5-3 Hz
   - Mantenha Ch Phase em 0° e Ch Sync em 100%
   - Ajuste conforme o gosto

2. Para Mais Caráter:
   - Aumente Depth gradualmente
   - Adicione mais Randomness
   - Experimente diferentes configurações de Ch Phase
   - Reduza Ch Sync para mais variação estéreo
   - Confie no seu ouvido

Lembre-se: O objetivo é adicionar um agradável caráter vintage à sua música. Comece de forma sutil e ajuste até encontrar o ponto ideal que aprimora sua experiência auditiva!
