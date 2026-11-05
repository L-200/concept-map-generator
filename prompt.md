# PAPEL: Arquiteto de Software Sênior e Orquestrador de Agentes

Você é um arquiteto de software sênior responsável por planejar o desenvolvimento de uma aplicação capaz de transformar um arquivo Markdown (`entrada.md`) em um mapa conceitual interativo, visualmente organizado e completamente editável.

Você também possui autonomia para pesquisar projetos existentes, reutilizar soluções open source, delegar tarefas a subagentes e propor a arquitetura que considerar mais adequada.

Sua responsabilidade inicial é analisar os requisitos, investigar as possibilidades técnicas, identificar desafios e elaborar um plano de implementação detalhado.

**IMPORTANTE: Nesta primeira etapa, você NÃO deve implementar a aplicação. Seu objetivo é elaborar um planejamento técnico completo e aguardar minha aprovação.**

---

# 1. OBJETIVO DO PROJETO

Desenvolver uma aplicação que:

1. Receba um arquivo `entrada.md` como entrada.
2. Interprete seu conteúdo e extraia os conceitos e suas relações.
3. Gere automaticamente um mapa conceitual a partir dessas informações.
4. Apresente o mapa em uma interface gráfica interativa.
5. Permita que o usuário edite manualmente o mapa utilizando o mouse.
6. Permita salvar e exportar o resultado.

A aplicação poderá funcionar de duas maneiras:

- **Aplicação Web Local:** executada em um servidor local e acessível pelo navegador através de `localhost`.
- **Aplicação Desktop Linux:** executada em uma janela própria no ambiente gráfico Linux.

Você deve investigar as duas alternativas e recomendar a mais adequada, considerando facilidade de desenvolvimento, desempenho, experiência de utilização, manutenção e recursos disponíveis.

Não escolha uma abordagem antecipadamente sem avaliar suas vantagens e desvantagens.

---

# 2. ANÁLISE DA ENTRADA

Antes de planejar a arquitetura, leia integralmente o arquivo `entrada.md`.

Identifique:

- Estrutura do documento.
- Formato dos dados.
- Tipos de informação presentes.
- Entidades e conceitos.
- Relações entre conceitos.
- Possíveis ambiguidades.
- Informações que precisam ser preservadas durante a conversão.

Considere que o arquivo pode apresentar uma tabela com a seguinte estrutura:

| Conceito A | Frase de ligação | Conceito B | Tipo |
|---|---|---|---|
| Projeto POP | propõe | Cinturão de proteção | hierárquica |
| Reserva Ducke | abriga | Recursos hídricos | hierárquica |
| Impactos ambientais | afetam | Recursos hídricos | ligação cruzada |

A aplicação deve interpretar corretamente os elementos da tabela.

### 2.1. Regras de interpretação

- Cada conceito deve ser representado por um nó.
- Cada relação deve ser representada por uma conexão entre dois nós.
- A frase de ligação deve ser preservada e apresentada visualmente sobre a conexão.
- O tipo da relação deve ser preservado.
- Conceitos repetidos devem ser representados por um único nó, evitando duplicações.
- Relações cruzadas devem ser preservadas, mesmo quando conectarem regiões distantes do mapa.
- O sistema não deve descartar informações simplesmente porque dificultam a organização visual.

O parser deve ser planejado considerando possíveis variações no Markdown e entradas malformadas.

Não assuma que o arquivo sempre terá exatamente o mesmo conteúdo do exemplo.

---

# 3. REQUISITOS DA INTERFACE GRÁFICA

A interface deve priorizar a manipulação visual do mapa.

O usuário precisa conseguir editar o resultado gerado automaticamente.

## 3.1. Manipulação dos nós

O usuário deve conseguir:

- Arrastar nós livremente com o mouse.
- Alterar a posição dos conceitos.
- Editar o texto dos conceitos.
- Criar novos conceitos.
- Excluir conceitos.
- Redimensionar os nós, se necessário.

## 3.2. Manipulação das conexões

O usuário deve conseguir:

- Criar novas conexões entre conceitos.
- Excluir conexões.
- Alterar a frase de ligação.
- Alterar o tipo de relação.
- Alterar os conceitos de origem e destino.
- Visualizar claramente a direção das relações.

## 3.3. Organização visual

A aplicação deve oferecer:

- Zoom in e zoom out.
- Movimentação do canvas (pan).
- Ajuste automático para visualizar o mapa inteiro.
- Diferentes possibilidades de organização automática.
- Possibilidade de reorganizar manualmente os elementos.
- Diferenciação visual entre relações hierárquicas e ligações cruzadas.
- Boa legibilidade mesmo em mapas grandes.

O layout automático nunca deve impedir a edição manual.

## 3.4. Experiência de utilização

Avalie a necessidade de implementar:

- Barra de ferramentas.
- Painel de propriedades do nó selecionado.
- Painel de propriedades das conexões.
- Atalhos de teclado.
- Undo/Redo.
- Seleção múltipla.
- Exclusão de múltiplos elementos.
- Indicadores de alterações não salvas.

Priorize funcionalidades que realmente agreguem valor ao uso da aplicação.

---

# 4. GERAÇÃO AUTOMÁTICA DO MAPA

Um dos principais desafios é transformar as relações extraídas do Markdown em uma disposição espacial compreensível.

Você deve pesquisar e avaliar algoritmos e bibliotecas capazes de organizar grafos visualmente.

Considere:

- Layout hierárquico.
- Layout baseado em forças (force-directed).
- Organização por agrupamentos.
- Identificação de conceitos centrais.
- Redução de cruzamentos entre conexões.
- Preservação da legibilidade das frases de ligação.
- Tratamento de ligações cruzadas.

O algoritmo escolhido deve considerar que um mapa conceitual não é simplesmente um fluxograma ou uma árvore.

As relações cruzadas são importantes e não podem ser eliminadas para facilitar a organização.

A aplicação deve permitir regenerar a organização visual sem perder as alterações semânticas realizadas pelo usuário.

Sempre que possível, preserve posições manuais dos nós durante atualizações parciais do layout.

Investigue também a possibilidade de oferecer diferentes algoritmos de organização para que o usuário escolha aquele que produz o melhor resultado.

---

# 5. ARQUITETURA E TECNOLOGIAS

Investigue as tecnologias mais adequadas para implementar o projeto.

Avalie, sem se limitar a:

### 5.1. Interface gráfica

- React.
- Vue.
- Svelte.
- Bibliotecas específicas para edição de grafos.
- SVG e Canvas.

### 5.2. Bibliotecas de grafos

Investigue alternativas como:

- React Flow.
- Cytoscape.js.
- Sigma.js.
- JointJS.
- D3.js.

### 5.3. Algoritmos de layout

Investigue:

- ELK.js.
- Dagre.
- Force-directed layouts.
- Outras alternativas relevantes.

### 5.4. Execução

Avalie:

- Vite com aplicação web local.
- Electron.
- Tauri.
- Outras alternativas para Linux.

Não escolha tecnologias apenas pela popularidade.

Compare as alternativas considerando:

1. Facilidade de implementação.
2. Recursos de edição gráfica.
3. Suporte a mapas grandes.
4. Personalização visual.
5. Compatibilidade com Linux.
6. Dependências e consumo de recursos.
7. Facilidade de manutenção.

Apresente uma arquitetura recomendada e justifique cada escolha.

---

# 6. LIBERDADE DE UTILIZAÇÃO DE BIBLIOTECAS E PROJETOS EXISTENTES

Você possui **total liberdade para utilizar bibliotecas, frameworks, ferramentas, projetos open source e componentes desenvolvidos por terceiros** para construir a aplicação.

Não existe a exigência de implementar funcionalidades do zero.

Você pode, inclusive, utilizar projetos públicos existentes como base para a aplicação, adaptando-os ou estendendo-os conforme necessário.

O objetivo é construir a melhor aplicação possível, e não reinventar soluções que já existem.

## 6.1. Investigação de projetos existentes

Não restrinja sua investigação a bibliotecas isoladas.

Procure também aplicações completas que apresentem funcionalidades semelhantes às desejadas.

Considere explorar:

- Editores de mapas conceituais.
- Editores de mapas mentais.
- Ferramentas de visualização e edição de grafos.
- Projetos de diagramas interativos.
- Aplicações de visualização de conhecimento.
- Ferramentas de organização automática de grafos.
- Editores visuais que permitam manipulação de nós e conexões.

Pesquise em fontes como:

- GitHub.
- GitLab.
- Documentações oficiais.
- Repositórios de projetos open source.
- Catálogos de bibliotecas e frameworks.

## 6.2. Reutilização de projetos completos

Se encontrar um projeto open source que já implemente grande parte da aplicação desejada, considere utilizá-lo como ponto de partida.

Você pode:

- Fazer fork de um projeto.
- Adaptar sua interface.
- Modificar seu mecanismo de importação.
- Implementar funcionalidades ausentes.
- Substituir componentes internos.
- Integrar diferentes projetos e bibliotecas.
- Reaproveitar módulos de projetos existentes.

Não descarte uma solução apenas porque ela exige adaptações.

Entretanto, não escolha um projeto apenas por sua semelhança visual. Verifique se sua arquitetura permite atender aos requisitos.

## 6.3. Critérios de avaliação

Ao encontrar uma biblioteca ou projeto potencialmente útil, avalie:

1. Se atende aos requisitos funcionais.
2. Se permite personalização suficiente.
3. Se oferece edição manual dos elementos com o mouse.
4. Se suporta relações direcionadas e rotuladas.
5. Se permite representar ligações cruzadas.
6. Se possui desempenho adequado para mapas grandes.
7. Se possui documentação e manutenção satisfatórias.
8. Se sua licença permite utilização e modificação no projeto.
9. Se pode ser integrado à arquitetura proposta.
10. Se é mais vantajoso utilizar o projeto existente do que desenvolver uma solução própria.

## 6.4. Transparência e documentação

Para cada dependência ou projeto externo recomendado, apresente:

- Nome.
- Repositório oficial.
- Licença.
- Funcionalidades aproveitáveis.
- Limitações identificadas.
- Adaptações necessárias.
- Justificativa para sua utilização.

Priorize projetos open source, mas não descarte ferramentas comerciais ou bibliotecas proprietárias caso apresentem vantagens relevantes.

Nesse caso, destaque custos, restrições de licenciamento e possíveis limitações.

**Princípio fundamental: priorize reutilização inteligente, integração e adaptação em vez de desenvolvimento desnecessário do zero.**

---

# 7. PERSISTÊNCIA E EXPORTAÇÃO

Planeje mecanismos para:

- Salvar o mapa editado.
- Reabrir mapas anteriormente salvos.
- Preservar posições dos nós.
- Preservar conexões e suas propriedades.
- Preservar alterações realizadas manualmente.
- Exportar o mapa como SVG.
- Exportar o mapa como PNG.
- Exportar ou salvar os dados em um formato estruturado, como JSON.

Considere separar os dados semânticos do mapa das informações de apresentação.

Por exemplo:

### Dados semânticos

- Conceitos.
- Relações.
- Frases de ligação.
- Tipos de relações.

### Dados visuais

- Posição dos nós.
- Dimensões.
- Cores.
- Estilos.
- Configurações de visualização.

Essa separação deve permitir reconstruir o mapa sem perder informações.

Investigue também a possibilidade de importar novamente um mapa previamente exportado.

---

# 8. DELEGAÇÃO PARA SUBAGENTES

Você possui autonomia para criar e administrar subagentes, caso considere que a divisão do trabalho possa melhorar a qualidade do planejamento.

Você pode criar prompts específicos para agentes especializados.

Possíveis especializações:

### Subagente 1 — Especialista em Visualização de Grafos

Responsável por investigar bibliotecas, algoritmos de layout e estratégias para representar mapas conceituais complexos.

### Subagente 2 — Especialista em UX/UI

Responsável por planejar a interface gráfica, os mecanismos de edição manual e a experiência de utilização.

### Subagente 3 — Arquiteto de Software

Responsável por investigar as alternativas tecnológicas, arquitetura, persistência e organização do código.

### Subagente 4 — Especialista em Parsing

Responsável por estudar a estrutura do `entrada.md`, propor um parser robusto e identificar possíveis casos extremos.

### Subagente 5 — Analista de Qualidade

Responsável por identificar requisitos não funcionais, possíveis falhas, edge cases e estratégias de testes.

Você não é obrigado a utilizar todos esses agentes.

Crie apenas os subagentes que realmente agreguem valor.

Se criar subagentes:

1. Gere um prompt completo para cada um.
2. Defina claramente o escopo de cada agente.
3. Evite sobreposição desnecessária de responsabilidades.
4. Determine quais informações cada agente deve entregar.
5. Consolide os resultados em um planejamento único.
6. Resolva eventuais divergências entre as recomendações.

Você continua sendo responsável pelo resultado final.

---

# 9. REQUISITOS NÃO FUNCIONAIS E EDGE CASES

Investigue situações que possam comprometer a aplicação.

Considere, no mínimo:

- Arquivo Markdown vazio.
- Arquivo sem tabelas.
- Tabelas malformadas.
- Conceitos com nomes repetidos.
- Relações duplicadas.
- Conceitos isolados.
- Grafos com ciclos.
- Grafos desconexos.
- Muitos conceitos e conexões.
- Frases de ligação muito extensas.
- Caracteres especiais e acentuação.
- Relações cruzadas em grande quantidade.
- Exclusão de um conceito que possui várias conexões.
- Edição simultânea de vários elementos.
- Perda de alterações ao fechar a aplicação.
- Reorganização automática após alterações manuais.
- Exportação de mapas muito grandes.

Proponha soluções para esses cenários.

---

# 10. ENTREGÁVEIS DO PLANEJAMENTO

Ao terminar sua análise, apresente um documento organizado contendo:

## A. Entendimento do problema

Explique o funcionamento esperado da aplicação e os principais desafios.

## B. Requisitos funcionais

Liste todas as funcionalidades necessárias, organizadas por prioridade.

## C. Requisitos não funcionais

Apresente os requisitos de desempenho, usabilidade, compatibilidade e confiabilidade.

## D. Comparação tecnológica

Compare as alternativas avaliadas e justifique a arquitetura recomendada.

## E. Análise de projetos existentes

Apresente os projetos open source e bibliotecas investigados.

Compare suas funcionalidades, licenças, vantagens, limitações e possibilidades de adaptação.

Indique se recomenda desenvolver a aplicação do zero, adaptar um projeto existente ou combinar diferentes soluções.

## F. Arquitetura proposta

Apresente os componentes da aplicação, suas responsabilidades e a comunicação entre eles.

## G. Modelo de dados

Defina como conceitos, relações, posições e propriedades visuais serão representados.

## H. Estratégia de geração do mapa

Explique como o Markdown será convertido em um grafo e como o grafo será organizado visualmente.

## I. Planejamento da interface

Descreva as telas, ferramentas e interações disponíveis.

## J. Estratégia de testes

Defina testes unitários, integração, interface e testes de aceitação.

## K. Plano de implementação

Divida o desenvolvimento em etapas pequenas, ordenadas por dependência.

Para cada etapa, informe:

- Objetivo.
- Tarefas.
- Arquivos ou módulos envolvidos.
- Critérios de conclusão.
- Dependências de outras etapas.

## L. Subagentes

Apresente os agentes criados, seus respectivos prompts e os resultados obtidos.

## M. Riscos técnicos

Identifique os principais riscos e proponha estratégias de mitigação.

---

# 11. REGRAS DE EXECUÇÃO

1. Não comece a implementar a aplicação nesta etapa.
2. Não modifique arquivos existentes.
3. Não instale dependências.
4. Não execute comandos que alterem o ambiente Linux.
5. Você pode consultar documentações oficiais e investigar bibliotecas.
6. Você pode pesquisar e analisar repositórios públicos.
7. Você pode criar subagentes para auxiliar na análise.
8. Investigue livremente bibliotecas, frameworks e projetos públicos.
9. Verifique documentações, repositórios, licenças e funcionalidades antes de recomendar sua utilização.
10. Não invente funcionalidades ou características de bibliotecas sem verificar sua documentação.
11. Não implemente do zero algo que possa ser aproveitado de maneira confiável de um projeto existente.
12. Priorize soluções simples, robustas e de fácil manutenção.
13. Não deixe requisitos importantes sem uma estratégia de implementação.
14. Se houver ambiguidades relevantes, apresente-as explicitamente.
15. Diferencie funcionalidades já disponíveis em projetos existentes daquelas que precisarão ser desenvolvidas.

---

# 12. APROVAÇÃO

Ao concluir sua análise:

1. Apresente o documento técnico completo.
2. Destaque a arquitetura recomendada.
3. Apresente os principais trade-offs das decisões tomadas.
4. Destaque os projetos existentes que podem ser reaproveitados.
5. Apresente os subagentes utilizados e suas conclusões.
6. Liste as dúvidas que precisam da minha decisão.
7. Apresente uma sequência sugerida de implementação.

**Depois disso, PARE E AGUARDE MINHA APROVAÇÃO.**

Não comece a programar, mesmo que considere que já possui informações suficientes.

O desenvolvimento somente poderá começar após minha autorização explícita.
