# Gerador e Editor Interativo de Mapas Conceituais

Aplicação web local desenvolvida para interpretar tabelas de proposições em Markdown (`entrada.md`), gerar automaticamente um **Mapa Conceitual de Novak** visualmente organizado e permitir edição gráfica completa com o mouse e teclado, além de persistência e exportação em múltiplos formatos (`.cmap.json`, `.md`, `.svg` e `.png`).

---

## 1. Requisitos e Execução

### Pré-requisitos
- **Node.js** `>= 18` (testado em Linux com Node.js `v24.19.0`)
- **NPM** `>= 9`

### Instalação e Execução em Desenvolvimento
No diretório raiz do projeto, execute:

```bash
# 1. Instalar dependências (caso ainda não tenha executado)
npm install

# 2. Iniciar o servidor local de desenvolvimento
npm run dev
```

Acesse **`http://localhost:5173`** no seu navegador.

### Outros Comandos Disponíveis
```bash
# Executar a suíte de testes automatizados (Vitest)
npm test

# Verificar tipagem TypeScript
npm run typecheck

# Gerar build otimizado de produção (na pasta dist/)
npm run build

# Visualizar o build de produção localmente
npm run preview
```

---

## 2. Como Fornecer a Entrada de Dados

A aplicação suporta **5 formas** de entrada e criação de mapas:

### 2.1. Arrastar e Soltar Arquivo `.md` na Janela do Navegador (Drag-and-Drop)
Você pode arrastar qualquer arquivo Markdown (`.md`) ou projeto salvo (`.cmap.json`) diretamente do seu gerenciador de arquivos para **qualquer lugar da tela do navegador**. Uma sobreposição visual (*dropzone*) será exibida e, ao soltar o arquivo, o novo mapa conceitual será gerado e organizado automaticamente.

### 2.2. Criar um Mapa Conceitual do Zero (`Novo Mapa ▾`)
Para construir o seu próprio mapa conceitual manualmente sem precisar escrever Markdown previamente:
1. Clique em **`Novo Mapa ▾`** no canto superior esquerdo e escolha entre **Novo Mapa (com Bloco Inicial)** ou **Canvas Totalmente em Branco**.
2. Adicione conceitos e ligações livremente usando qualquer um dos métodos rápidos:
   - **Botão `+ Ramificar` sobre o bloco selecionado:** Clique em um bloco para exibir sua barra flutuante e clique em **`+ Ramificar`** para criar um novo bloco filho já conectado automaticamente.
   - **Arrastar da borda para o vazio:** Puxe uma conexão a partir de qualquer uma das 4 bolinhas azuis na borda de um bloco e solte o mouse em uma área vazia do fundo — um novo bloco conectado será criado naquele ponto.
   - **Botão `+ Ligação` (na barra superior ou na `Tabela`):** Digite `Bloco A (Origem)`, `Frase de Ligação`, `Bloco B (Destino)` e escolha `Hierárquica` ou `Ligação Cruzada`. Caso os blocos ainda não existam, eles são criados e conectados automaticamente.
   - **Duplo clique no fundo ou botão `+ Bloco`:** Cria um bloco avulso em qualquer posição.

### 2.3. Leitura Automática de `entrada.md` (Padrão)
Ao iniciar com `npm run dev`, um plugin integrado ao servidor Vite ([`vite.config.ts`](vite.config.ts)) lê automaticamente o arquivo [`entrada.md`](entrada.md) na raiz do projeto por meio do endpoint local `/api/default-input`.
- Caso você edite o arquivo `entrada.md` no disco e queira recarregá-lo do zero na interface, basta clicar no botão de **Recarregar (`↻`)** ao lado do botão *Importar* na barra superior.

### 2.4. Formato Esperado da Tabela Markdown
O parser ([`markdownParser.ts`](src/services/parser/markdownParser.ts)) aceita tabelas Markdown tanto no formato de **5 colunas** (com coluna de índice `#`) quanto no formato de **4 colunas** (sem `#`):

**Formato de 5 colunas (padrão `entrada.md`):**
```markdown
| # | Conceito A | Frase de ligação | Conceito B | Tipo |
|---|---|---|---|---|
| 1 | Projeto POP | propõe | Cinturão de proteção | hierárquica |
| 2 | Reserva Ducke | abriga | Recursos hídricos | hierárquica |
| 3 | Impactos ambientais | afetam | Recursos hídricos | ligação cruzada |
```

**Formato de 4 colunas:**
```markdown
| Conceito A | Frase de ligação | Conceito B | Tipo |
|---|---|---|---|
| Projeto POP | propõe | Cinturão de proteção | hierárquica |
| Reserva Ducke | abriga | Recursos hídricos | hierárquica |
| Impactos ambientais | afetam | Recursos hídricos | ligação cruzada |
```

**Regras de interpretação do Parser:**
- **Unicidade de conceitos:** Conceitos com o mesmo nome (mesmo com diferenças de maiúsculas/minúsculas ou espaços extras) são automaticamente unificados em um único nó.
- **Tipos de relação:** Reconhece `hierárquica` (e variações sem acento) e `ligação cruzada` (ou `cruzada`, `transversal`, `cross-link`). Caso omitido, assume `hierárquica` como padrão e registra um aviso diagnóstico sem interromper o carregamento.
- **Tolerância a falhas:** Textos fora da tabela são ignorados com segurança e linhas incompletas são reportadas na aba de diagnósticos sem travar a aplicação.

### 2.5. Importação e Edição via `Importar` ou `Tabela`
- **Botão `Importar`:** Abre o seletor de arquivos para carregar `.md` ou `.cmap.json`.
- **Botão `Tabela`:** Permite adicionar novas proposições em formulário tabular, editar frases/tipos inline ou editar diretamente o código Markdown sincronizado.

---

## 3. Funcionalidades de Edição e Interação

### Manipulação com o Mouse no Canvas
- **Mover conceitos:** Clique e arraste qualquer nó. Ao mover um nó manualmente, ele é automaticamente marcado como **Fixado (`📌 Pinned`)**, garantindo que sua posição manual seja preservada caso você acione o botão **Organizar** posteriormente.
- **Criar novo bloco:** Dê **duplo clique** em qualquer área vazia do canvas ou clique no botão **`+ Bloco`** na barra superior.
- **Ramificar / Criar bloco conectado:** Selecione um bloco e clique em **`+ Ramificar`** acima dele, ou arraste de uma de suas 4 portas azuis e solte em uma área vazia do canvas.
- **Criar proposição completa (`+ Ligação`):** Use o botão **`+ Ligação`** na barra superior para conectar blocos existentes ou criar novos blocos já interligados.
- **Editar texto de um conceito ou frase de ligação:** Dê **duplo clique** diretamente sobre o nó (ou clique em **Editar** na barra flutuante do nó) ou sobre a pílula da frase de ligação (`Enter` confirma, `Esc` cancela).
- **Redimensionar nó:** Ao selecionar um conceito, arraste qualquer uma das alças azuis nas bordas/cantos da caixa.
- **Criar conexão entre dois blocos existentes:** Passe o mouse sobre um conceito (ou selecione-o) para revelar as 4 portas azuis (topo, direita, base, esquerda) e arraste até outro conceito.
- **Reconectar origem ou destino:** Clique em uma conexão e arraste a ponta da seta (ou a extremidade de origem) para outro conceito.
- **Foco de vizinhança (Hover):** Ao passar o mouse sobre um conceito, o sistema destaca automaticamente suas conexões diretas de 1º grau e atenua o restante do mapa para facilitar a leitura em regiões densas.
- **Seleção múltipla:** Segure `Shift` e arraste o mouse sobre o canvas (ou `Shift + Clique`) para selecionar vários elementos simultaneamente.

### Motores de Layout Automático
Na barra superior, você pode alternar entre **5 algoritmos de organização espacial** (nas direções **Vertical ⬇** ou **Horizontal ➡**):
1. **Hierárquico Novak (Backbone 2-Fases — Padrão):** Usa as relações `hierárquica` como espinha dorsal para definir as camadas verticais (mantendo a raiz como `Projeto POP` no topo) e roteia as `ligação cruzada` pelas laterais com linhas tracejadas âmbar, evitando que ligações cruzadas deformem a hierarquia.
2. **ELK Layered Unificado:** Algoritmo Sugiyama completo via `elkjs` com prioridade direcional `10:1` para relações hierárquicas.
3. **Dagre Compacto:** Árvore hierárquica compacta via `@dagrejs/dagre`.
4. **Orgânico (D3-Force):** Simulação física baseada em forças de repulsão, colisão e gravidade hierárquica via `d3-force`.
5. **Radial / Centralidade:** Distribui os conceitos em anéis concêntricos a partir da raiz hierárquica.

### Atalhos de Teclado

| Atalho | Ação |
| :--- | :--- |
| `Duplo Clique no Canvas` | Criar novo conceito na posição do cursor |
| `Duplo Clique em Nó / Frase` | Editar texto inline (`Enter` salva, `Esc` cancela) |
| `Ctrl + Z` | Desfazer (Undo) |
| `Ctrl + Y` ou `Ctrl + Shift + Z` | Refazer (Redo) |
| `Ctrl + K` ou `Ctrl + F` | Focar barra de busca instantânea |
| `Delete` ou `Backspace` | Excluir conceitos e conexões selecionados |
| `P` | Fixar / Desafixar (`📌 Pin`) posição do(s) conceito(s) selecionado(s) |
| `T` | Alternar tipo da conexão selecionada (`hierárquica` ↔ `ligação cruzada`) |
| `R` | Inverter direção da conexão selecionada (`Conceito A ↔ Conceito B`) |

---

## 4. Persistência e Exportação

- **Auto-Save Local Automático:** Todas as edições feitas no mapa são salvas automaticamente no navegador (`localStorage`) a cada alteração, recuperando sua sessão ao reabrir a página.
- **Menu `Exportar ▾` (Barra Superior):**
  1. **Salvar Projeto (`.cmap.json`):** Exporta um arquivo JSON estruturado separando dados semânticos (`semantic`) e dados visuais (`visual`), permitindo reabrir o mapa exatamente como foi deixado.
  2. **Exportar Markdown (`.md`):** Gera a tabela Markdown de 5 colunas (`| # | Conceito A | Frase de ligação | Conceito B | Tipo |`) contendo todas as alterações semânticas realizadas.
  3. **Exportar Imagem Vetorial (`.svg`):** Gera um documento SVG vetorial autônomo e escalável enquadrando 100% do mapa (independente do zoom atual na tela).
  4. **Exportar PNG Alta Resolução (`.png`):** Renderiza o mapa completo em imagem PNG de alta densidade (`2x DPI`) pronta para relatórios e apresentações.

---

## 5. Tecnologias Utilizadas

| Categoria | Tecnologia | Papel no Projeto |
| :--- | :--- | :--- |
| **Linguagem & Build** | **TypeScript 5.7** + **Vite 6** | Tipagem estática estrita, servidor local rápido com HMR e plugin de leitura de `entrada.md`. |
| **Interface & Estilo** | **React 18** + **Tailwind CSS 3** + **Lucide React** | Componentes de interface, inspetor contextual lateral, barra de ferramentas e ícones vetoriais. |
| **Canvas de Grafos** | **`@xyflow/react` (React Flow v12)** | Renderização híbrida DOM/SVG, manipulação de nós/arestas com mouse, `<NodeResizer>`, `<EdgeLabelRenderer>`, `<MiniMap>` e `<Controls>`. |
| **Algoritmos de Layout** | **`elkjs`** + **`@dagrejs/dagre`** + **`d3-force`** | Motores de organização espacial hierárquica em camadas, backbone de duas fases, físico/orgânico e radial. |
| **Estado & Undo/Redo** | **`zustand`** + **`zundo`** | Gerenciamento de estado reativo separando modelo semântico e visual, com histórico temporal de Undo/Redo. |
| **Testes Automatizados** | **Vitest** | Testes unitários e de integração validando o parser Markdown, os 5 motores de layout, a store com Undo/Redo e a exportação SVG/JSON/MD. |

---

## 6. Estrutura de Diretórios

```text
concept-map-generator/
├── entrada.md                                 # Arquivo Markdown padrão de entrada
├── vite.config.ts                             # Configuração Vite + plugin de leitura de entrada.md
├── src/
│   ├── domain/
│   │   └── types.ts                           # Modelo de dados (SemanticModel, VisualModel, Document)
│   ├── services/
│   │   ├── workspaceBridge.ts                 # Cliente HTTP para leitura automática de entrada.md
│   │   ├── parser/
│   │   │   ├── markdownParser.ts              # Parser tolerante a falhas + métricas topológicas
│   │   │   ├── markdownSerializer.ts          # Serializador reverso para tabela Markdown (5/4 colunas)
│   │   │   └── __tests__/markdownParser.test.ts
│   │   ├── layout/
│   │   │   ├── nodeSizing.ts                  # Cálculo adaptativo de dimensões de nós e rótulos
│   │   │   ├── layoutEngine.ts                # 5 motores de layout + preservação de nós fixados + anticolisão
│   │   │   └── __tests__/layoutEngine.test.ts
│   │   └── export/
│   │       ├── fileExporter.ts                # Exportação/Importação JSON, Markdown, SVG vetorial e PNG 2x
│   │       └── __tests__/fileExporter.test.ts
│   ├── store/
│   │   ├── useConceptMapStore.ts              # Store Zustand + Zundo (Undo/Redo, CRUD, Auto-Save)
│   │   └── __tests__/useConceptMapStore.test.ts
│   ├── components/
│   │   ├── canvas/
│   │   │   ├── ConceptMapCanvas.tsx           # Superfície interativa React Flow + Legenda e Filtros
│   │   │   ├── ConceptNode.tsx                # Nó customizado editável, redimensionável e fixável
│   │   │   └── PropositionEdge.tsx            # Conexão direcionada com pílula editável (hierárquica vs cruzada)
│   │   ├── toolbar/
│   │   │   └── TopToolbar.tsx                 # Barra superior de ações, layouts, busca e exportação
│   │   ├── inspector/
│   │   │   └── PropertyInspector.tsx          # Painel lateral de propriedades de nós, conexões e lote
│   │   └── modals/
│   │       └── PropositionsDrawer.tsx         # Modal de tabela interativa, código Markdown e diagnósticos
│   ├── hooks/
│   │   └── useKeyboardShortcuts.ts            # Atalhos globais de teclado e alerta beforeunload
│   ├── App.tsx                                # Componente raiz da aplicação
│   └── main.tsx                               # Entrypoint React
└── package.json
```
