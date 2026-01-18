---
title: "Delay Plugins - EffeTune"
description: "Delay effect plugins including standard Delay and Time Alignment for precise audio timing."
lang: en
---

# Plugins de Delay

Uma coleção de ferramentas para ajustar o timing dos seus sinais de áudio ou adicionar repetições distintas. Estes plugins ajudam a afinar o alinhamento temporal do seu áudio, criar ecos rítmicos ou adicionar uma sensação de espaço e profundidade à sua experiência auditiva.

## Lista de Plugins

- [Delay](#delay) - Cria ecos com controlo sobre timing, tom e dispersão estéreo.
- [Time Alignment](#time-alignment) - Ajustes precisos de timing para canais de áudio.

## Delay

Este efeito adiciona ecos distintos ao seu áudio. Pode controlar a rapidez com que os ecos se repetem, como desaparecem e como se espalham entre as colunas, permitindo adicionar profundidade subtil, interesse rítmico ou efeitos espaciais criativos à sua reprodução de música.

### Guia de Experiência Auditiva

- **Profundidade e Espaço Subtis:**
  - Adiciona uma sensação suave de espaço sem "lavar" o som.
  - Pode fazer com que vocais ou instrumentos principais pareçam ligeiramente maiores ou mais presentes.
  - Use tempos de delay curtos e baixo feedback/mix.
- **Melhoria Rítmica:**
  - Cria ecos que sincronizam com o tempo da música (ajustado manualmente).
  - Adiciona groove e energia, especialmente a música eletrónica, bateria ou guitarras.
  - Experimente diferentes tempos de delay (ex: igualando colcheias ou semínimas de ouvido).
- **Eco Slapback:**
  - Um eco muito curto e único, frequentemente usado em vocais ou guitarras em rock e country.
  - Adiciona um efeito percussivo de duplicação.
  - Use tempos de delay muito curtos (30-120ms), feedback zero e mix moderado.
- **Dispersão Estéreo Criativa:**
  - Usando o controlo Ping-Pong, os ecos podem saltar entre as colunas esquerda e direita.
  - Cria uma imagem estéreo mais ampla e envolvente.
  - Pode fazer o som parecer mais dinâmico e interessante.

### Parâmetros

- **Pre-Delay (ms)** - Quanto tempo antes do *primeiro* eco ser ouvido (0 a 100 ms).
  - Valores baixos (0-20ms): O eco começa quase imediatamente.
  - Valores altos (20-100ms): Cria um intervalo notável antes do eco, separando-o do som original.
- **Delay Size (ms)** - O tempo entre cada eco (1 a 5000 ms).
  - Curto (1-100ms): Cria efeitos de espessamento ou 'slapback'.
  - Médio (100-600ms): Efeitos de eco padrão, bons para melhoria rítmica.
  - Longo (600ms+): Ecos distintos e muito espaçados.
  - *Dica:* Tente bater o pé ao ritmo da música para encontrar um tempo de delay que pareça rítmico.
- **Damping (%)** - Controla o quanto as frequências altas e baixas desaparecem a cada eco (0 a 100%).
  - 0%: Os ecos mantêm o seu tom original (mais brilhante).
  - 50%: Um desaparecimento natural e equilibrado.
  - 100%: Os ecos tornam-se significativamente mais escuros e finos rapidamente (mais abafados).
  - Use em conjunto com High/Low Damp.
- **High Damp (Hz)** - Define a frequência acima da qual os ecos começam a perder brilho (1000 a 20000 Hz).
  - Valores baixos (ex: 2000Hz): Os ecos escurecem rapidamente.
  - Valores altos (ex: 10000Hz): Os ecos permanecem brilhantes por mais tempo.
  - Ajuste com Damping para controlo tonal dos ecos.
- **Low Damp (Hz)** - Define a frequência abaixo da qual os ecos começam a perder corpo (20 a 1000 Hz).
  - Valores baixos (ex: 50Hz): Os ecos retêm mais graves.
  - Valores altos (ex: 500Hz): Os ecos tornam-se mais finos rapidamente.
  - Ajuste com Damping para controlo tonal dos ecos.
- **Feedback (%)** - Quantos ecos ouve, ou quanto tempo duram (0 a 99%).
  - 0%: Apenas um eco é ouvido.
  - 10-40%: Algumas repetições notáveis.
  - 40-70%: Rasteiros de ecos mais longos e que desaparecem.
  - 70-99%: Rasteiros muito longos, aproximando-se da auto-oscilação (use com cuidado!).
- **Ping-Pong (%)** - Controla como os ecos saltam entre canais estéreo (0 a 100%). (Afeta apenas a reprodução estéreo).
  - 0%: Delay padrão - eco da entrada esquerda na esquerda, da direita na direita.
  - 50%: Feedback mono - os ecos ficam centrados entre as colunas.
  - 100%: Ping-Pong completo - os ecos alternam entre as colunas esquerda e direita.
  - Valores intermédios criam graus variáveis de dispersão estéreo.
- **Mix (%)** - Equilibra o volume dos ecos em relação ao som original (0 a 100%).
  - 0%: Sem efeito.
  - 5-15%: Profundidade ou ritmo subtil.
  - 15-30%: Ecos claramente audíveis (bom ponto de partida).
  - 30%+: Efeito mais forte e pronunciado. O padrão é 16%.

### Configurações Recomendadas para Melhoria Auditiva

1.  **Profundidade Subtil Vocal/Instrumental:**
    - Delay Size: 80-150ms
    - Feedback: 0-15%
    - Mix: 8-16%
    - Ping-Pong: 0% (ou tente 20-40% para ligeira largura)
    - Damping: 40-60%
2.  **Melhoria Rítmica (Eletrónica/Pop):**
    - Delay Size: Tente igualar o tempo de ouvido (ex: 120-500ms)
    - Feedback: 20-40%
    - Mix: 15-25%
    - Ping-Pong: 0% ou 100%
    - Damping: Ajuste a gosto (mais baixo para repetições mais brilhantes)
3.  **Slapback Rock Clássico (Guitarras/Vocais):**
    - Delay Size: 50-120ms
    - Feedback: 0%
    - Mix: 15-30%
    - Ping-Pong: 0%
    - Damping: 20-40%
4.  **Ecos Estéreo Amplos (Ambient/Pads):**
    - Delay Size: 300-800ms
    - Feedback: 40-60%
    - Mix: 20-35%
    - Ping-Pong: 70-100%
    - Damping: 50-70% (para caudas mais suaves)

### Guia de Início Rápido

1.  **Definir o Timing:**
    - Comece com `Delay Size` para definir o ritmo principal do eco.
    - Ajuste `Feedback` para controlar quantos ecos ouve.
    - Use `Pre-Delay` se quiser um intervalo antes do primeiro eco.
2.  **Ajustar o Tom:**
    - Use `Damping`, `High Damp` e `Low Damp` juntos para moldar como os ecos soam enquanto desaparecem. Comece com Damping por volta de 50% e ajuste as frequências Damp.
3.  **Posição em Estéreo (Opcional):**
    - Se estiver a ouvir em estéreo, experimente `Ping-Pong` para controlar a largura dos ecos.
4.  **Misturar:**
    - Use `Mix` para equilibrar o volume do eco com a música original. Comece baixo (por volta de 16%) e aumente até que o efeito pareça correto.

---

## Time Alignment

Uma ferramenta de precisão que permite ajustar o timing dos canais de áudio com precisão de milissegundos. Perfeito para corrigir problemas de fase ou criar efeitos estéreo específicos.

### Quando Usar
- Corrigir alinhamento de fase entre canais estéreo
- Compensar diferenças de distância das colunas
- Afinar a imagem estéreo
- Corrigir desfasamentos de timing em gravações

### Parâmetros
- **Delay** - Controla o tempo de delay (0 a 100ms)
  - 0ms: Sem delay (timing original)
  - Valores altos: Aumento do delay
  - Ajustes finos para controlo preciso
- **Channel** - Seleciona qual canal atrasar
  - All: Afeta ambos os canais
  - Left: Apenas atrasa o canal esquerdo
  - Right: Apenas atrasa o canal direito

### Usos Recomendados

1. Alinhamento de Colunas
   - Compensar diferentes distâncias das colunas
   - Igualar o timing entre monitores
   - Ajustar à acústica da sala

2. Correção de Gravação
   - Corrigir problemas de fase entre microfones
   - Alinhar múltiplas fontes de áudio
   - Corrigir discrepâncias de timing

3. Efeitos Criativos
   - Criar alargamento estéreo subtil
   - Desenhar efeitos espaciais
   - Experimentar com o timing dos canais

Lembre-se: O objetivo é melhorar o seu prazer auditivo. Experimente os controlos para encontrar sons que adicionem interesse e profundidade à sua música favorita sem a sobrecarregar.
