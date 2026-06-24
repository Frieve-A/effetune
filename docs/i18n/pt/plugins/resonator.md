---
title: "Plugins de Ressonador - EffeTune"
description: "Plugins de ressonância, incluindo Horn Resonator e Modal Resonator."
lang: pt
---

# Plugins de Ressonador

Uma coleção de plugins que enfatizam características ressonantes para adicionar texturas tonais únicas e cor à sua música. Esses efeitos simulam ressonâncias encontradas em objetos físicos ou sistemas de alto-falantes, aprimorando sua experiência de audição com calor, brilho ou caráter vintage.

## Lista de Plugins

- [Horn Resonator](#horn-resonator) - Simula a ressonância de sistemas de alto-falantes horn
- [Horn Resonator Plus](#horn-resonator-plus) - Ressonância de alto-falante tipo corneta mais suave para coloração natural na escuta
- [Modal Resonator](#modal-resonator) - Efeito de ressonância de frequência com até 5 ressonadores

## Horn Resonator

Um plugin que simula a ressonância de um alto-falante com trompa usando um modelo de guia de onda digital. Ele adiciona um caráter quente e natural de alto-falante com trompa ao modelar reflexões de onda no gargalo e na boca, permitindo moldar o som com controles simples.

### Guia de Audição

- Realce suave de médios: destaca vocais e instrumentos acústicos sem aspereza.
- Ambiente natural de trompa: adiciona coloração vintage de alto-falantes para uma experiência de audição mais rica.
- Amortecimento suave de altas frequências: evita picos agudos para um timbre relaxado.

### Parâmetros

- **Crossover (Hz)** - Define o ponto de corte entre o caminho de baixa frequência (atrasado) e o caminho de alta frequência processado pelo modelo de corneta. (20–5000 Hz)
- **Horn Length (cm)** - Ajusta o comprimento da trompa simulada. Trompas mais longas deslocam as ressonâncias para frequências mais baixas e as deixam mais próximas entre si; trompas mais curtas deslocam as ressonâncias para frequências mais altas e mais espaçadas, deixando o som mais focado. (20–120 cm)
- **Throat Diameter (cm)** - Controla o tamanho da abertura na garganta da corneta (entrada). Valores menores tendem a aumentar o brilho e a ênfase no médio-agudo; valores maiores adicionam calor. (0.5–50 cm)
- **Mouth Diameter (cm)** - Controla o tamanho da abertura na boca da corneta (saída). Isso afeta o casamento de impedância com o ar ao redor e influencia a reflexão dependente de frequência na boca. Valores maiores geralmente expandem a percepção do som e reduzem a reflexão de baixas; valores menores concentram o som e aumentam a reflexão de baixas. (5–200 cm)
- **Curve (%)** - Ajusta a forma de expansão da trompa (como o raio aumenta do gargalo até a boca).
    - `0 %`: Cria um formato cônico (raio aumenta linearmente com a distância).
    - Valores positivos (`> 0 %`): Criam expansões que crescem mais rapidamente em direção à boca (por exemplo, exponencial). Valores maiores significam expansão mais lenta perto do gargalo e muito rápida perto da boca.
    - Valores negativos (`< 0 %`): Criam expansões que crescem muito rapidamente perto do gargalo e depois mais lentamente em direção à boca (por exemplo, parabólico ou tractrix). Valores mais negativos significam expansão inicial mais rápida.
    (-100–100 %)
- **Damping (dB/m)** - Define a atenuação interna (absorção sonora) por metro dentro do guia de onda da trompa. Valores mais altos reduzem picos de ressonância e criam um som mais suave e amortecido. (0–10 dB/m)
- **Throat Reflection** - Ajusta o coeficiente de reflexão na garganta da corneta (entrada). Valores mais altos aumentam a quantidade de som refletido de volta para a trompa, o que pode clarear a resposta e enfatizar certas ressonâncias. (0–0.99)
- **Output Gain (dB)** - Controla o nível de saída geral do caminho de sinal processado (alta frequência) antes de misturar com o caminho de baixa frequência atrasado. Use-o para igualar ou aumentar o nível do efeito. (-36–36 dB)

### Início Rápido

1. Defina **Crossover** para determinar a faixa de frequência enviada ao modelo de trompa (por ex., 800–2000 Hz). Frequências abaixo desse intervalo são atrasadas e misturadas de volta.
2. Comece com **Horn Length** em cerca de 60–70 cm para um caráter típico de médios.
3. Ajuste **Throat Diameter** e **Mouth Diameter** para moldar o timbre central (brilho vs. calor, foco vs. amplitude).
4. Use **Curve** para refinar o caráter ressonante (experimente 0% para cônico, positivo para expansão exponencial, negativo para expansão tipo tractrix).
5. Ajuste **Damping** e **Throat Reflection** para suavidade ou ênfase nas ressonâncias da trompa.
6. Use **Output Gain** para equilibrar o nível do som da trompa em relação às frequências graves atrasadas.

## Horn Resonator Plus

Horn Resonator Plus adiciona à música um caráter mais suave e natural de alto-falante tipo corneta. Use quando quiser que vocais, metais, instrumentos acústicos ou faixas completas soem mais quentes e vivos, mantendo a ressonância menos afiada que no Horn Resonator padrão.

Ele é baseado no mesmo modelo de trompa do [Horn Resonator](#horn-resonator), com um modelo mais detalhado de reflexão na boca e na garganta para que as ressonâncias decaiam de forma mais suave.

### Guia de Audição

- Cor de corneta mais suave: adiciona caráter de alto-falante horn-loaded com menos ringing afiado.
- Presença mais quente: pode deixar vocais, metais e música acústica mais vivos.
- Comportamento natural nos agudos: a faixa alta fica mais próxima de uma corneta acústica ou alto-falante com corneta do que na versão padrão.

### Melhorias Técnicas

- **Filtro de reflexão de boca de 2ª ordem**: Modelagem mais suave da reflexão dependente de frequência na abertura da boca.
- **Reflexão de garganta dependente de frequência**: A reflexão da garganta muda com a frequência para um comportamento de corneta mais natural.

### Parâmetros e Uso

Horn Resonator Plus usa os mesmos parâmetros que [Horn Resonator](#horn-resonator). Por favor, consulte a seção Horn Resonator para descrições de parâmetros, configurações e valores recomendados.

### Diretrizes de Uso

- **Horn Resonator**: Escolha quando quiser processamento mais leve com caráter básico de corneta.
- **Horn Resonator Plus**: Escolha quando quiser uma coloração de corneta mais suave e natural e puder aceitar um uso de CPU um pouco maior.

### Guia de Início Rápido

Use os mesmos controles que [Horn Resonator](#horn-resonator). Escolha Horn Resonator Plus quando quiser um caráter de alto-falante tipo corneta mais suave.

---

## Modal Resonator

Um efeito que adiciona ressonâncias afinadas à música, de modo parecido com objetos físicos ou partes de alto-falantes vibrando em suas frequências naturais. Use quando quiser mais brilho, corpo, cor metálica ou ressonância de alto-falante durante a escuta.

### Guia de Experiência de Audição

- **Ressonância Metálica:**
  - Cria timbres semelhantes a sinos ou metálicos que seguem a dinâmica do material de origem.
  - Útil para adicionar brilho ou caráter metálico a percussão, sintetizadores ou gravações completas.
  - Use múltiplos ressonadores em frequências cuidadosamente ajustadas com tempos de decaimento moderados.
- **Realce Tonal:**
  - Reforça sutilmente frequências específicas na música.
  - Pode acentuar harmônicos ou adicionar plenitude a faixas de frequência específicas.
  - Use baixos valores de mix (10–20%) para realce sutil.
- **Simulação de Alto-falantes Full-Range:**
  - Simula o comportamento modal de loudspeakers físicos.
  - Recria as ressonâncias características que ocorrem quando drivers dividem suas vibrações em diferentes frequências.
  - Ajuda a simular o som característico de tipos específicos de loudspeakers.
- **Efeitos Especiais:**
  - Cria qualidades tímbricas incomuns e texturas de outro mundo.
  - Útil quando você quer um efeito de ressonância evidente em vez de realce natural.
  - Experimente configurações extremas apenas quando quiser que as ressonâncias façam parte do som.

### Parâmetros

- **Resonator Selection (1-5)** - Cinco ressonadores independentes que podem ser ativados/desativados e configurados separadamente.
  - Use múltiplos ressonadores para efeitos de ressonância complexos e em camadas.
  - Cada ressonador pode direcionar diferentes regiões de frequência.
  - Experimente relações harmônicas entre ressonadores para resultados mais musicais.

Para cada ressonador:

- **Enable** - Alterna o ressonador individual.
- **Freq (Hz)** - Define a frequência ressonante principal (20 a 20.000 Hz).
- **Decay (ms)** - Controla a duração da ressonância após o som de entrada (1 a 500 ms).
- **LPF Freq (Hz)** - Filtro passa-baixo que molda o timbre da ressonância (20 a 20.000 Hz).
- **HPF Freq (Hz)** - Filtro passa-alto que remove frequências baixas indesejadas da ressonância (20 a 20.000 Hz).
- **Gain (dB)** - Controla o nível de saída de cada ressonador (-18 a +18 dB).

Controle global:

- **Mix (%)** - Equilibra a saída combinada de todos os ressonadores ativados em relação ao som original (0 a 100%).

### Configurações Recomendadas para Realce de Audição

1. **Realce Suave de Alto-falantes:**
   - Ative 2–3 ressonadores
   - Freq: 400 Hz, 900 Hz, 1600 Hz
   - Decay: 60–100 ms
   - LPF Freq: 2000–4000 Hz
   - Mix: 10–20%

2. **Caráter Metálico:**
   - Ative 3–5 ressonadores
   - Freq: 1000–6500 Hz
   - Decay: 100–200 ms
   - LPF Freq: 4000–8000 Hz
   - Mix: 15–30%

3. **Realce de Graves:**
   - Ative 1–2 ressonadores
   - Freq: 50–150 Hz
   - HPF Freq: 20–60 Hz, mantido abaixo da ressonância-alvo
   - Decay: 50–100 ms
   - LPF Freq: 1000–2000 Hz
   - Mix: 10–25%

4. **Simulação Full-Range de Alto-falantes:**
   - Ative todos os 5 ressonadores
   - Freq: 100 Hz, 400 Hz, 800 Hz, 1600 Hz, 3000 Hz
   - HPF Freq: 20 Hz, 120 Hz, 250 Hz, 500 Hz, 1000 Hz
   - Decay: progressivamente mais curto de graves a agudos (100 ms a 30 ms)
   - LPF Freq: progressivamente mais alto de graves a agudos (2000 Hz a 4000 Hz)
   - Mix: 20–40%

### Guia de Início Rápido

1. **Escolha Pontos de Ressonância:**
   - Comece ativando um ou dois ressonadores.
   - Defina as frequências para as áreas que deseja realçar.
   - Para efeitos mais complexos, adicione ressonadores adicionais com frequências complementares.

2. **Ajuste o Caráter:**
   - Use o parâmetro `Decay` para controlar a duração da ressonância.
   - Molde o timbre com o controle `LPF Freq`.
   - Defina `HPF Freq` abaixo da ressonância que você quer preservar, especialmente em ajustes de graves.
   - Tempos de decaimento mais longos criam tons mais evidentes, tipo sino.

3. **Misture com o Original:**
   - Use o parâmetro `Mix` para equilibrar o efeito com seu material de origem.
   - Comece com valores baixos (10–20%) para realce sutil.
   - Aumente para efeitos mais dramáticos.

4. **Ajuste Fino:**
   - Faça pequenos ajustes em frequências e tempos de decaimento.
   - Ative/desative ressonadores individuais para encontrar a combinação perfeita.
   - Lembre-se de que mudanças sutis podem ter grande impacto no som geral.
