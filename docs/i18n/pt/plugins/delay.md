---
title: "Plugins de Delay - EffeTune"
description: "Plugins de delay, incluindo Delay padrão e Time Alignment para ajuste preciso de tempo."
lang: pt
---

# Plugins de Delay

Uma coleção de ferramentas para ajustar o tempo dos seus sinais de áudio ou adicionar repetições distintas. Estes plugins ajudam a refinar o alinhamento temporal do áudio, criar ecos rítmicos ou adicionar sensação de espaço e profundidade à sua experiência de escuta.

## Lista de Plugins

- [Delay](#delay) - Cria ecos com controle de tempo, tom e espalhamento estéreo.
- [Time Alignment](#time-alignment) - Ajusta finamente o tempo de reprodução para alinhar alto-falantes e posição de escuta.

## Delay

Este efeito adiciona ecos distintos ao seu áudio. Você pode controlar a rapidez com que os ecos se repetem, como desaparecem e como se espalham entre os alto-falantes, permitindo adicionar profundidade sutil, interesse rítmico ou efeitos espaciais criativos à reprodução da música.

### Guia de Experiência Auditiva

- **Profundidade e Espaço Sutis:**
  - Adiciona uma sensação suave de espaço sem "lavar" o som.
  - Pode fazer com que vocais ou instrumentos principais pareçam ligeiramente maiores ou mais presentes.
  - Use tempos de delay curtos e baixo feedback/mix.
- **Melhoria Rítmica:**
  - Cria ecos que sincronizam com o tempo da música (ajustado manualmente).
  - Adiciona groove e energia, especialmente a música eletrônica, bateria ou guitarras.
  - Experimente diferentes tempos de delay (ex: igualando colcheias ou semínimas de ouvido).
- **Eco Slapback:**
  - Um eco muito curto e único, frequentemente usado em vocais ou guitarras em rock e country.
  - Adiciona um efeito percussivo de duplicação.
  - Use tempos de delay muito curtos (30-120ms), feedback zero e mix moderado.
- **Dispersão Estéreo Criativa:**
  - Usando o controle Ping-Pong, os ecos podem saltar entre as caixas esquerda e direita.
  - Cria uma imagem estéreo mais ampla e envolvente.
  - Pode fazer o som parecer mais dinâmico e interessante.

### Parâmetros

- **Pre-Delay (ms)** - Adiciona tempo extra antes de o sinal entrar no delay de eco (0 a 100 ms). O primeiro eco é ouvido depois de Pre-Delay + Delay Size.
  - Valores baixos (0-20ms): O padrão de eco começa quase imediatamente.
  - Valores altos (20-100ms): Adiciona um intervalo perceptível antes do padrão de eco, separando-o do som original.
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
- **High Damp (Hz)** - Define a frequência acima da qual os ecos começam a perder brilho (20 a 20000 Hz).
  - Valores baixos (ex: 2000Hz): Os ecos escurecem rapidamente.
  - Valores altos (ex: 10000Hz): Os ecos permanecem brilhantes por mais tempo.
  - Ajuste com Damping para controle tonal dos ecos.
- **Low Damp (Hz)** - Define a frequência abaixo da qual os ecos começam a perder corpo (20 a 20000 Hz).
  - Valores baixos (ex: 50Hz): Os ecos retêm mais graves.
  - Valores altos (ex: 500Hz): Os ecos tornam-se mais finos rapidamente.
  - Ajuste com Damping para controle tonal dos ecos.
  - Para modelagem tonal previsível, mantenha Low Damp abaixo de High Damp. Se os valores cruzarem, o processador os ordena internamente.
- **Feedback (%)** - Quantos ecos ouve, ou quanto tempo duram (0 a 99%).
  - 0%: Apenas um eco é ouvido.
  - 10-40%: Algumas repetições notáveis.
  - 40-70%: Rasteiros de ecos mais longos e que desaparecem.
  - 70-99%: Rasteiros muito longos, aproximando-se da auto-oscilação (use com cuidado!).
- **Ping-Pong (%)** - Controla como os ecos saltam entre canais estéreo (0 a 100%). (Afeta apenas a reprodução estéreo).
  - 0%: Delay padrão - eco da entrada esquerda na esquerda, da direita na direita.
  - 50%: Feedback mono - os ecos ficam centralizados entre as caixas.
  - 100%: Ping-Pong completo - os ecos alternam entre as caixas esquerda e direita.
  - Valores intermediários criam graus variáveis de dispersão estéreo.
- **Mix (%)** - Equilibra o volume dos ecos em relação ao som original (0 a 100%).
  - 0%: Sem efeito.
  - 5-15%: Profundidade ou ritmo sutil.
  - 15-30%: Ecos claramente audíveis (bom ponto de partida).
  - 30%+: Efeito mais forte e pronunciado. O padrão é 16%.

### Configurações Recomendadas para Melhoria Auditiva

1.  **Profundidade Sutil Vocal/Instrumental:**
    - Delay Size: 80-150ms
    - Feedback: 0-15%
    - Mix: 8-16%
    - Ping-Pong: 0% (ou tente 20-40% para leve largura)
    - Damping: 40-60%
2.  **Melhoria Rítmica (Eletrônica/Pop):**
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
    - Use `Pre-Delay` para adicionar um intervalo extra antes de o padrão de eco começar.
2.  **Ajustar o Tom:**
    - Use `Damping`, `High Damp` e `Low Damp` juntos para moldar como os ecos soam enquanto desaparecem. Comece com Damping por volta de 50% e ajuste as frequências Damp.
3.  **Posição em Estéreo (Opcional):**
    - Se estiver a ouvir em estéreo, experimente `Ping-Pong` para controlar a largura dos ecos.
4.  **Misturar:**
    - Use `Mix` para equilibrar o volume do eco com a música original. Comece baixo (por volta de 16%) e aumente até que o efeito pareça correto.

---

## Time Alignment

Ajusta o tempo de reprodução em pequenas quantidades, útil quando você quer compensar diferenças de distância entre alto-falantes ou refinar como o som chega à sua posição de escuta.

### Quando Usar
- Compensar pequenas diferenças de distância entre os alto-falantes e sua posição de escuta
- Refinar o timing dos canais roteados por este plugin
- Verificar se um pequeno atraso deixa a imagem estéreo mais estável ou natural

### Parâmetros
- **Delay** - Controla o tempo de delay aplicado aos canais roteados por este plugin (0 a 100 ms)
  - 0 ms: Sem delay
  - Valores pequenos: Úteis para compensar diferenças mínimas de tempo de chegada entre alto-falantes
  - Valores mais altos: Criam um deslocamento temporal mais perceptível

### Usos Recomendados

1. Compensação de Distância dos Alto-falantes
   - Adicione um pequeno delay quando um alto-falante ou canal chega antes à posição de escuta
   - Ajuste em passos pequenos ouvindo vocais centralizados ou outros sons focados

2. Ajuste Fino da Posição de Escuta
   - Experimente valores bem pequenos primeiro
   - Pare quando a imagem central parecer estável e o som continuar natural

Lembre-se: o objetivo é melhorar o prazer de escuta. Experimente os controles para encontrar sons que adicionem interesse e profundidade à sua música favorita sem sobrecarregá-la.
