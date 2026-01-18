---
title: "Spatial Plugins - EffeTune"
description: "Spatial audio plugins including Stereo Blend, Crossfeed Filter, MS Matrix, and Multiband Balance."
lang: en
---

# Plugins de Áudio Espacial

Uma coleção de plugins que aprimoram como a música soa em seus fones de ouvido ou alto-falantes ajustando o balanço estéreo (esquerda e direita). Esses efeitos podem fazer sua música soar mais espaçosa e natural, especialmente ao ouvir com fones de ouvido.

## Lista de Plugins

- [Crossfeed Filter](#crossfeed-filter) - Filtro de crossfeed para fones de ouvido para imagem estéreo natural
- [MS Matrix](#ms-matrix) - Ajusta a imagem estéreo controlando separadamente os níveis de Mid e Side, com troca opcional dos canais esquerdo/direito  
- [Multiband Balance](#multiband-balance) - Controle de balanço estéreo dependente de frequência de 5 bandas
- [Stereo Blend](#stereo-blend) - Controla a largura estéreo de mono a estéreo aprimorado

## Crossfeed Filter

Um filtro de crossfeed para fones de ouvido que simula a diafonia acústica natural que ocorre ao ouvir através de alto-falantes. Este efeito ajuda a reduzir a separação estéreo exagerada frequentemente experimentada com fones de ouvido, criando uma experiência de audição mais natural e confortável que imita a forma como o som chega aos nossos ouvidos em um ambiente acústico real.

### Características principais
- Simula a diafonia acústica natural para audição com fones de ouvido
- Nível de crossfeed e temporização ajustáveis
- Filtragem passa-baixa para imitar a diafonia dependente de frequência
- Processamento apenas estéreo (automaticamente contornado para sinais mono)

### Parâmetros
- **Level** (-60 dB a 0 dB): Controla a quantidade de sinal de crossfeed
  - Valores mais baixos (-20 dB a -6 dB): Crossfeed sutil e natural
  - Valores mais altos (-6 dB a 0 dB): Efeito mais pronunciado
- **Delay** (0 ms a 1 ms): Simula a diferença de tempo da diafonia acústica
  - Valores mais baixos (0.1-0.3 ms): Imagem mais apertada e focada
  - Valores mais altos (0.3-1.0 ms): Apresentação mais espaçosa, similar a alto-falantes
- **LPF Freq** (100 Hz a 20000 Hz): Controla a resposta de frequência do crossfeed
  - Valores mais baixos (500-1000 Hz): Diafonia mais natural dependente de frequência
  - Valores mais altos (1000-20000 Hz): Resposta de frequência mais ampla

### Configurações recomendadas

1. Audição Natural com Fones de Ouvido
   - Level: -12 dB
   - Delay: 0.3 ms
   - LPF Freq: 700 Hz
   - Efeito: Crossfeed sutil para audição confortável a longo prazo

2. Simulação de Alto-falantes
   - Level: -6 dB
   - Delay: 0.5 ms
   - LPF Freq: 1000 Hz
   - Efeito: Apresentação mais pronunciada similar a alto-falantes

3. Aprimoramento Sutil
   - Level: -20 dB
   - Delay: 0.2 ms
   - LPF Freq: 500 Hz
   - Efeito: Crossfeed muito suave para ouvintes sensíveis

### Guia de aplicação

1. Otimização de Fones de Ouvido
   - Comece com configurações conservadoras (-15 dB level, 0.3 ms delay)
   - Ajuste o nível para conforto e naturalidade
   - Afine o atraso para percepção espacial
   - Use LPF para controlar a resposta de frequência

2. Considerações de Estilo Musical
   - Clássica/Jazz: Níveis mais baixos (-15 a -10 dB) para apresentação natural
   - Rock/Pop: Níveis moderados (-10 a -6 dB) para energia
   - Eletrônica: Níveis mais altos (-6 a 0 dB) para espacialidade

3. Ambiente de Audição
   - Ambientes silenciosos: Níveis mais baixos para efeito sutil
   - Ambientes barulhentos: Níveis mais altos para melhor foco
   - Sessões de audição longas: Configurações conservadoras para reduzir fadiga

### Guia de início rápido

1. Configuração inicial
   - Configure Level para -12 dB
   - Configure Delay para 0.3 ms
   - Configure LPF Freq para 700 Hz

2. Ajuste fino
   - Ajuste Level para a quantidade desejada de crossfeed
   - Modifique Delay para percepção espacial
   - Afine LPF Freq para resposta de frequência

3. Otimização
   - Ouça para apresentação natural e confortável
   - Evite configurações excessivas que soem artificiais
   - Teste com vários estilos musicais

Lembre-se: O Crossfeed Filter é projetado para tornar a audição com fones de ouvido mais natural e confortável. Comece com configurações conservadoras e ajuste gradualmente para encontrar o equilíbrio ideal para suas preferências de audição e material musical.

## MS Matrix

Processador mid/side flexível que permite controlar de forma independente o centro (mid) e a largura (side) do seu sinal estéreo. Use controles de ganho simples e troca opcional de canais esquerdo/direito para ajustar como o áudio se posiciona no campo estéreo sem roteamento complexo.

### Recursos Principais
- Ganho de Mid e Side separados (–18 dB a +18 dB)  
- Chave Mode: Encode (Stereo→M/S) ou Decode (M/S→Stereo)  
- Troca opcional dos canais esquerdo/direito antes da codificação ou após a decodificação  
- Alterações de parâmetros sem cliques para ajustes suaves  

### Parâmetros
- **Mode** (Encode/Decode)  
- **Mid Gain** (–18 dB a +18 dB): Ajusta o nível do conteúdo central  
- **Side Gain** (–18 dB a +18 dB): Ajusta o nível da diferença estéreo (largura)  
- **Swap L/R** (Off/On): Inverte os canais esquerdo e direito antes de codificar ou após decodificar  

### Configurações Recomendadas
1. **Largura Sutil**  
   - Mode: Decode  
   - Mid Gain: 0 dB  
   - Side Gain: +3 dB  
   - Swap: Off  
2. **Foco Central**  
   - Mode: Decode  
   - Mid Gain: +3 dB  
   - Side Gain: –3 dB  
   - Swap: Off  
3. **Inversão Criativa**  
   - Mode: Encode  
   - Mid Gain: 0 dB  
   - Side Gain: 0 dB  
   - Swap: On  

### Guia de Início Rápido
1. Selecione **Mode** para conversão  
2. Ajuste **Mid Gain** e **Side Gain**  
3. Ative **Swap L/R** para correção de canais ou inversão criativa  
4. Bypass para comparar e verificar ausência de problemas de fase  

## Multiband Balance

Um processador espacial sofisticado que divide o áudio em cinco bandas de frequência e permite o controle de balanço estéreo independente de cada banda. Este plugin oferece controle preciso sobre a imagem estéreo em todo o espectro de frequências, proporcionando possibilidades criativas para design de som e mixagem, bem como aplicações corretivas para gravações estéreo problemáticas.

### Características Principais
- Controle de balanço estéreo dependente de frequência de 5 bandas
- Filtros crossover Linkwitz-Riley de alta qualidade
- Controle de balanço linear para ajuste estéreo preciso
- Processamento independente dos canais esquerdo e direito
- Mudanças de parâmetros sem cliques com tratamento automático de fade

### Parâmetros

#### Frequências de Crossover
- **Freq 1** (20-500 Hz): Separa bandas baixas e médio-baixas
- **Freq 2** (100-2000 Hz): Separa bandas médio-baixas e médias
- **Freq 3** (500-8000 Hz): Separa bandas médias e médio-altas
- **Freq 4** (1000-20000 Hz): Separa bandas médio-altas e altas

#### Controles de Banda
Cada banda tem controle de balanço independente:
- **Band 1 Bal.** (-100% a +100%): Controla balanço estéreo de frequências baixas
- **Band 2 Bal.** (-100% a +100%): Controla balanço estéreo de frequências médio-baixas
- **Band 3 Bal.** (-100% a +100%): Controla balanço estéreo de frequências médias
- **Band 4 Bal.** (-100% a +100%): Controla balanço estéreo de frequências médio-altas
- **Band 5 Bal.** (-100% a +100%): Controla balanço estéreo de frequências altas

### Configurações Recomendadas

1. Aprimoramento Estéreo Natural
   - Banda Baixa (20-100 Hz): 0% (centralizado)
   - Médio-Baixa (100-500 Hz): ±20%
   - Média (500-2000 Hz): ±40%
   - Médio-Alta (2000-8000 Hz): ±60%
   - Alta (8000+ Hz): ±80%
   - Efeito: Cria uma expansão estéreo graduada que aumenta com a frequência

2. Mix Focado
   - Banda Baixa: 0%
   - Médio-Baixa: ±10%
   - Média: ±30%
   - Médio-Alta: ±20%
   - Alta: ±40%
   - Efeito: Mantém foco central enquanto adiciona largura sutil

3. Paisagem Sonora Imersiva
   - Banda Baixa: 0%
   - Médio-Baixa: ±40%
   - Média: ±60%
   - Médio-Alta: ±80%
   - Alta: ±100%
   - Efeito: Cria um campo sonoro envolvente com graves ancorados

### Guia de Aplicação

1. Aprimoramento de Mix
   - Mantenha frequências baixas (abaixo de 100 Hz) centralizadas para graves estáveis
   - Aumente gradualmente a largura estéreo com a frequência
   - Use configurações moderadas (±30-50%) para aprimoramento natural
   - Monitore em mono para verificar problemas de fase

2. Solução de Problemas
   - Corrija problemas de fase em faixas de frequência específicas
   - Aperte graves desfocados centralizando frequências baixas
   - Reduza artefatos estéreo ásperos em altas frequências
   - Conserte faixas estéreo mal gravadas

3. Design de Som Criativo
   - Crie movimento dependente de frequência
   - Projete efeitos espaciais únicos
   - Construa paisagens sonoras imersivas
   - Aprimore instrumentos ou elementos específicos

4. Ajuste do Campo Estéreo
   - Ajuste fino do balanço estéreo por banda de frequência
   - Correção de distribuição estéreo desigual
   - Aprimoramento da separação estéreo onde necessário
   - Manutenção da compatibilidade mono

### Guia de Início Rápido

1. Configuração Inicial
   - Comece com todas as bandas centralizadas (0%)
   - Defina frequências de crossover em pontos padrão:
     * Freq 1: 100 Hz
     * Freq 2: 500 Hz
     * Freq 3: 2000 Hz
     * Freq 4: 8000 Hz

2. Aprimoramento Básico
   - Mantenha Band 1 (graves) centralizada
   - Faça pequenos ajustes nas bandas mais altas
   - Ouça mudanças na imagem espacial
   - Verifique compatibilidade mono

3. Ajuste Fino
   - Ajuste pontos de crossover para corresponder ao seu material
   - Faça mudanças graduais nas posições das bandas
   - Ouça artefatos indesejados
   - Compare com bypass para perspectiva

Lembre-se: O Multiband Balance é uma ferramenta poderosa que requer ajuste cuidadoso. Comece com configurações sutis e aumente a complexidade conforme necessário. Sempre verifique seus ajustes tanto em estéreo quanto em mono para garantir compatibilidade.

## Stereo Blend

Um efeito que ajuda a alcançar um campo sonoro mais natural ajustando a largura estéreo da sua música. É particularmente útil para audição com fones de ouvido, onde pode reduzir a separação estéreo exagerada que frequentemente ocorre com fones, tornando a experiência de audição mais natural e menos cansativa. Também pode aprimorar a imagem estéreo para audição em alto-falantes quando necessário.

### Guia de Aprimoramento da Audição
- Otimização para Fones:
  - Reduz a largura estéreo (60-90%) para apresentação mais natural, semelhante a alto-falantes
  - Minimiza a fadiga auditiva da separação estéreo excessiva
  - Cria um palco sonoro frontal mais realista
- Aprimoramento de Alto-falantes:
  - Mantém a imagem estéreo original (100%) para reprodução precisa
  - Aprimoramento sutil (110-130%) para palco sonoro mais amplo quando necessário
  - Ajuste cuidadoso para manter campo sonoro natural
- Controle do Campo Sonoro:
  - Foco em apresentação natural e realista
  - Evita largura excessiva que poderia soar artificial
  - Otimiza para seu ambiente específico de audição

### Parâmetros
- **Stereo** - Controla a largura estéreo (0-200%)
  - 0%: Mono total (canais esquerdo e direito somados)
  - 100%: Imagem estéreo original
  - 200%: Estéreo aprimorado com largura máxima (L-R/R-L)

### Configurações Recomendadas para Diferentes Cenários de Audição

1. Audição com Fones (Natural)
   - Stereo: 60-90%
   - Efeito: Separação estéreo reduzida
   - Perfeito para: Sessões longas de audição, reduzindo fadiga

2. Audição com Alto-falantes (Referência)
   - Stereo: 100%
   - Efeito: Imagem estéreo original
   - Perfeito para: Reprodução precisa

3. Aprimoramento de Alto-falantes
   - Stereo: 110-130%
   - Efeito: Aprimoramento sutil da largura
   - Perfeito para: Ambientes com alto-falantes próximos

### Guia de Otimização por Estilo Musical

- Música Clássica
  - Fones: 70-80%
  - Alto-falantes: 100%
  - Benefício: Perspectiva natural de sala de concerto

- Jazz & Acústica
  - Fones: 80-90%
  - Alto-falantes: 100-110%
  - Benefício: Som íntimo e realista de conjunto

- Rock & Pop
  - Fones: 85-95%
  - Alto-falantes: 100-120%
  - Benefício: Impacto equilibrado sem largura artificial

- Música Eletrônica
  - Fones: 90-100%
  - Alto-falantes: 100-130%
  - Benefício: Espacialidade controlada mantendo foco

### Guia de Início Rápido

1. Escolha Sua Configuração de Audição
   - Identifique se está usando fones ou alto-falantes
   - Isso determina seu ponto de partida para ajuste

2. Comece com Configurações Conservadoras
   - Fones: Comece em 80%
   - Alto-falantes: Comece em 100%
   - Ouça o posicionamento natural do som

3. Ajuste Fino para Sua Música
   - Faça ajustes pequenos (5-10% por vez)
   - Foque em alcançar campo sonoro natural
   - Preste atenção ao conforto auditivo

Lembre-se: O objetivo é alcançar uma experiência de audição natural e confortável que reduz a fadiga e mantém a apresentação musical pretendida. Evite configurações extremas que podem soar impressionantes no início mas se tornam cansativas com o tempo.