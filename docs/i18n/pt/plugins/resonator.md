---
title: "Plugins de Ressonador - EffeTune"
description: "Plugins de ressonância: Adaptive Prediction, Horn Resonator e Modal Resonator."
lang: pt
---

# Plugins de Ressonador

Plugins que acrescentam caráter ressonante à música, desde simulações de objetos e alto-falantes até ressonâncias que evoluem a partir do aprendizado do próprio áudio.

## Lista de Plugins

- [Adaptive Prediction](#adaptive-prediction) - Aprende a prever o áudio para extrair o resíduo ou criar ressonâncias que evoluem
- [Horn Resonator](#horn-resonator) - Simula a ressonância de sistemas de alto-falantes horn
- [Horn Resonator Plus](#horn-resonator-plus) - Ressonância de alto-falante tipo corneta mais suave para coloração natural na escuta
- [Modal Resonator](#modal-resonator) - Efeito de ressonância de frequência com até 5 ressonadores

## Adaptive Prediction

Adaptive Prediction aprende a prever a forma de onda de entrada com base no áudio anterior. Use-o para reduzir componentes previsíveis, ouvir a previsão ou realimentá-la para criar uma ressonância que desenvolve seu próprio som. Os canais esquerdo e direito aprendem separadamente.

**Residual** é o som original menos a previsão. Com o aprendizado, tons repetidos podem diminuir no resíduo, destacando mudanças e detalhes imprevisíveis. Acima de 0, **Autonomy** faz a previsão também acompanhar o som gerado. Em 1, a geração é desconectada da entrada externa; o aprendizado continua usando essa entrada, a menos que esteja congelado.

### Guia de escuta e presets do sistema

Abra **Predefinições de efeito** no cabeçalho do efeito. Trocar de preset preserva o aprendizado já adquirido pelo efeito em execução.

| Preset | Gap | Autonomy | Original / Residual / Prediction | Uso inicial |
| --- | --- | --- | --- | --- |
| **Surprise** (padrão) | 1 ms | 0 | 0 / 1 / 0 | Ouça detalhes que mudam enquanto tons previsíveis são reduzidos. |
| **Prediction** | 5 ms | 0 | 0 / 0 / 1 | Substitua o original pela previsão. Deixe uma entrada audível tocar por alguns segundos. |
| **Resonator** | 10 ms | 0.98 | 0.6 / 0 / 0.6 | Misture o original com uma ressonância em evolução influenciada pela música. |
| **Hold** | 10 ms | 1 | 0 / 0 / 1 | Congele o aprendizado e ouça a geração autônoma do modelo aprendido. |

Compare **Surprise** e **Prediction** com um tom sustentado ou um trecho repetitivo. Para som autônomo, deixe Prediction aprender primeiro e depois escolha **Hold** ou marque sua caixa. Hold fixa as regras aprendidas: altura, timbre e nível ainda podem mudar ou desaparecer. Ele não sustenta uma nota nem repete uma gravação. Um efeito sem treinamento ou recém-reiniciado não consegue iniciar som autônomo a partir do silêncio.

### Parâmetros

- **Gap (ms)** — Exclui os 0–500 ms mais recentes das informações de onda usadas na previsão (inicial: 1 ms). Valores maiores usam um passado mais distante e podem mudar o timbre ou reduzir a precisão. Mesmo em 0, são usadas amostras anteriores. Não é latência de saída nem duração de uma janela de gravação. Alterá-lo preserva o modelo, que se readapta à nova distância.
- **Learn** — Velocidade de adaptação à entrada, de 0 a 0.1 (inicial: 0.02). Aumente para aprender mais rápido; diminua para mudar mais lentamente. Em 0, as correções por erro param, mas Weight Decay finito ainda pode reduzir os coeficientes.
- **Weight Decay (s)** — Tempo de decaimento dos coeficientes durante o aprendizado ativo, de 0.5 a 60 segundos. Tempos curtos enfraquecem antes o aprendizado passado; tempos longos o preservam mais. Não é a duração do histórico de áudio.
- **Infinity** — Desativa Weight Decay (marcado por padrão). Desmarque para usar o tempo de Weight Decay.
- **Autonomy** — Mistura a previsão da entrada e a geração realimentada, de 0 a 1 (inicial: 0). Aumente para reforçar a influência do som gerado sobre si mesmo. Em 1, a geração recebe apenas sua própria realimentação. Os níveis da mistura de saída não alteram essa realimentação.
- **Original / Residual / Prediction** — Ganhos independentes de −2 a +2, inicialmente 0 / 1 / 0. Zero silencia, valores positivos somam e negativos invertem a polaridade. Magnitudes acima de 1 aumentam o nível. Não há normalização automática da mistura. Como Residual = Original − Prediction, 0 / 1 / 1 reconstrói o original antes da limitação dos picos de saída.
- **Freeze** — Para o aprendizado e Weight Decay, mantendo o processamento e a geração. Desative para voltar a aprender.
- **Hold** — Aplica Freeze e Autonomy 1 juntos. Seus controles ficam desabilitados enquanto Hold está ativo; desativá-lo restaura os ajustes individuais.
- **Reset** — Apaga os coeficientes aprendidos, os estados e o histórico de áudio. Mantém os ajustes dos controles. A previsão começa em silêncio e precisa aprender novamente.

O aprendizado e Weight Decay pausam quando a entrada externa fica abaixo de −60 dBFS, para que o silêncio não apague o modelo. O som gerado não participa dessa decisão. Os coeficientes e o som em curso são temporários e não são salvos em presets; um efeito recriado precisa aprender novamente. Enquanto está ativo, Adaptive Prediction continua processando durante o silêncio para preservar o som aprendido. Desative o efeito quando não precisar mais dele.

### Quando o resultado não é o esperado

- Se Prediction ou Hold ficar em silêncio, desative Hold e Freeze, mantenha Learn acima de 0 e reproduza uma entrada audível. Comece com Autonomy 0.
- Se a ressonância ficar forte demais, reduza Prediction ou Autonomy. O limitador controla os picos de amostra, mas misturas altas podem mudar o timbre.
- Se um problema de processamento for informado, pressione Reset e reproduza áudio para aprender novamente.
- Adaptive Prediction aceita mono ou estéreo. Ative **Usar processamento de áudio WebAssembly** em **Configuração de Áudio**. Escolha um canal ou um par estéreo no roteamento do efeito. Formatos incompatíveis fazem o efeito ser ignorado.

## Horn Resonator

Um plugin que simula a ressonância de um alto-falante com trompa usando um modelo de guia de onda digital. Ele adiciona um caráter quente e natural de alto-falante com trompa ao modelar reflexões de onda no gargalo e na boca, permitindo moldar o som com controles simples.

### Guia de Audição

- Realce suave de médios: destaca vocais e instrumentos acústicos sem aspereza.
- Ambiente natural de trompa: adiciona coloração vintage de alto-falantes para uma experiência de audição mais rica.
- Amortecimento suave de altas frequências: evita picos agudos para um timbre relaxado.

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para experimentar diretamente estas configurações completas.

- **Gramophone** - Uma corneta bem aberta, com o colorido de um antigo gramofone acústico.
- **Vintage Theater** - A resposta de uma grande corneta de cinema que alcança os graves.
- **Megaphone** - Uma corneta cônica curta, com médios diretos e enfáticos.

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

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para experimentar diretamente estas configurações completas.

- **Gramophone** - Uma corneta bem aberta, com o colorido de um antigo gramofone acústico.
- **Vintage Theater** - A resposta de uma grande corneta de cinema que alcança os graves.
- **Megaphone** - Uma corneta cônica curta, com médios diretos e enfáticos.

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

### Predefinições do sistema

Clique em **Predefinições de efeito** no cabeçalho do efeito para carregar um padrão completo de ressonâncias.

- **Wooden Body** - Modos de ressonância graves e mais duradouros, com o caráter de uma caixa de madeira.
- **Metal Can** - Modos de ressonância mais agudos que soam por mais tempo, com caráter metálico.
- **Plastic Enclosure** - Modos de ressonância mais agudos e curtos, com o caráter de uma caixa leve.

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
