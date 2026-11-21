import type {
  ConceptId,
  ConceptNodeSemantic,
  ConceptRelationSemantic,
  DiagramMode,
  FlowchartNodeShape,
  FlowEdgeKind,
  ParseDiagnostic,
  ParseResult,
  RelationId,
  RelationType,
  SemanticGraphMetrics,
  SemanticModel,
} from '../../domain/types';

export interface MarkdownParserOptions {
  /** Título padrão caso o Markdown não possua um heading `# Título` ou frontmatter */
  defaultTitle?: string;
  /** Forçar ou sugerir o modo do diagrama caso não esteja especificado no Markdown */
  diagramMode?: DiagramMode;
}

interface ColumnMapping {
  indexCol?: number;
  sourceCol: number;
  phraseCol: number;
  targetCol: number;
  typeCol?: number;
  shapeCol?: number;
  expectedMinCols: number;
}

/**
 * Remove acentos/diacríticos de uma string para comparações insensíveis a acentuação
 * (ex: cabeçalhos de tabela e tipos de relação como "hierárquica" vs "hierarquica").
 */
export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normaliza o rótulo de exibição de um conceito (colapsa espaços múltiplos e faz trim,
 * preservando acentuação e caixa original).
 */
export function cleanDisplayText(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\\\|/g, '|')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Gera a chave canônica de deduplicação de um conceito (case-insensitive e space-normalized).
 */
export function normalizeConceptKey(rawLabel: string): string {
  return cleanDisplayText(rawLabel).toLowerCase();
}

/**
 * Gera um slug base legível a partir da chave normalizada.
 */
function slugifyConceptKey(normalizedKey: string): string {
  const base = stripAccents(normalizedKey)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base ? `concept-${base}` : 'concept-item';
}

/**
 * Divide uma linha de tabela Markdown por `|`, respeitando pipes escapados (`\|`).
 */
export function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim();
  // Remove o primeiro e o último pipe se a linha seguir o formato `| col1 | col2 |`
  const withoutOuterPipes = trimmed.replace(/^\|/, '').replace(/(?<!\\)\|$/, '');

  const cells: string[] = [];
  let current = '';
  let parenDepth = 0;

  for (let i = 0; i < withoutOuterPipes.length; i++) {
    const ch = withoutOuterPipes[i];
    if (ch === '\\' && i + 1 < withoutOuterPipes.length && withoutOuterPipes[i + 1] === '|') {
      current += '|';
      i++; // Pula o pipe escapado
    } else if (
      ch === '|' &&
      i + 1 < withoutOuterPipes.length &&
      withoutOuterPipes[i + 1] === '|' &&
      (parenDepth > 0 ||
        (i > 0 &&
          withoutOuterPipes[i - 1] === ' ' &&
          i + 2 < withoutOuterPipes.length &&
          withoutOuterPipes[i + 2] === ' '))
    ) {
      current += '||';
      i++; // Preserva operador lógico/HTA '||' dentro da célula
    } else if (ch === '|') {
      cells.push(current.trim());
      current = '';
      parenDepth = 0;
    } else {
      if (ch === '(') parenDepth++;
      else if (ch === ')' && parenDepth > 0) parenDepth--;
      current += ch;
    }
  }
  cells.push(current.trim());

  return cells;
}

const TABLE_SEP_REGEX = /^\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?$/;

/**
 * Verifica se uma linha é um separador de tabela Markdown (ex: `|---|---|---|` ou `|:---:|---:|`).
 */
export function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') || !trimmed.includes('-')) {
    return false;
  }
  if (TABLE_SEP_REGEX.test(trimmed)) {
    return true;
  }
  const cells = splitMarkdownTableRow(trimmed);
  return (
    cells.length >= 2 &&
    cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()))
  );
}

/**
 * Normaliza uma string de modo de diagrama para o tipo canônico DiagramMode.
 */
export function normalizeDiagramModeString(raw: string): DiagramMode | null {
  const clean = stripAccents(raw.toLowerCase())
    .trim()
    .replace(/[_\s]+/g, '-');
  if (['flowchart', 'fluxograma', 'fluxo', 'flow'].includes(clean)) {
    return 'flowchart';
  }
  if (
    [
      'concept-map',
      'conceptmap',
      'mapa-conceitual',
      'mapaconceitual',
      'mapa-de-conceitos',
      'novak',
    ].includes(clean)
  ) {
    return 'concept-map';
  }
  return null;
}

export interface FrontmatterResult {
  contentWithoutFrontmatter: string;
  frontmatterMode?: DiagramMode;
  frontmatterTitle?: string;
  frontmatterTreeLayout?: 'vertical' | 'horizontal';
}

export function normalizeTreeLayoutString(raw: string): 'vertical' | 'horizontal' | null {
  const clean = stripAccents(raw.toLowerCase())
    .trim()
    .replace(/[_\s]+/g, '-');
  if (['vertical', 'compact', 'compacto', 'colunas', 'columns', 'empilhado', 'stacked', 'tb-vertical'].includes(clean)) {
    return 'vertical';
  }
  if (['horizontal', 'wide', 'largo', 'standard', 'padrao', 'default', 'tb-horizontal'].includes(clean)) {
    return 'horizontal';
  }
  return null;
}

/**
 * Extrai metadados do YAML frontmatter no topo do arquivo (se existente).
 */
export function extractFrontmatter(content: string): FrontmatterResult {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return { contentWithoutFrontmatter: content };
  }

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { contentWithoutFrontmatter: content };
  }

  const frontmatterBody = match[1];
  const contentWithoutFrontmatter = content.slice(match[0].length);

  let frontmatterMode: DiagramMode | undefined;
  let frontmatterTitle: string | undefined;
  let frontmatterTreeLayout: 'vertical' | 'horizontal' | undefined;

  const lines = frontmatterBody.split(/\r?\n/);
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;

    // Detecta type, diagram, mode, tipo
    const modeMatch = trimmedLine.match(
      /^(?:type|diagram|mode|tipo|tipo-de-diagrama|diagram-type)\s*:\s*["']?([^"'\r\n#]+)["']?/i
    );
    if (modeMatch && !frontmatterMode) {
      const parsed = normalizeDiagramModeString(modeMatch[1]);
      if (parsed) frontmatterMode = parsed;
    }

    // Detecta title, titulo, título
    const titleMatch = trimmedLine.match(
      /^(?:title|titulo|título)\s*:\s*["']?([^"'\r\n#]+)["']?/i
    );
    if (titleMatch && !frontmatterTitle) {
      frontmatterTitle = titleMatch[1].trim();
    }

    // Detecta treeLayout, tree-layout, layoutStyle, layout-style, estilo, folhas
    const treeLayoutMatch = trimmedLine.match(
      /^(?:treeLayout|tree-layout|tree_layout|layoutStyle|layout-style|layout_style|estilo|folhas)\s*:\s*["']?([^"'\r\n#]+)["']?/i
    );
    if (treeLayoutMatch && !frontmatterTreeLayout) {
      const parsed = normalizeTreeLayoutString(treeLayoutMatch[1]);
      if (parsed) frontmatterTreeLayout = parsed;
    }
  }

  return {
    contentWithoutFrontmatter,
    frontmatterMode,
    frontmatterTitle,
    frontmatterTreeLayout,
  };
}

/**
 * Detecta diretivas de modo via comentários HTML ou anotações @type / Tipo de Diagrama.
 */
export function detectDirectiveMode(content: string): DiagramMode | null {
  const match = content.match(
    /(?:<!--\s*(?:type|tipo|diagram|mode|modo|tipo\s+de\s+diagrama)\s*[:=]\s*([a-zA-Z0-9_-]+)\s*-->|(?:@(?:type|tipo|diagram|mode|modo)|(?:tipo\s+de\s+diagrama))\s*[:=]\s*([a-zA-Z0-9_-]+))/i
  );
  return match ? normalizeDiagramModeString(match[1] || match[2]) : null;
}

/**
 * Classificação heurística baseada no cabeçalho e conteúdo das células de tabela.
 */
export function detectHeuristicMode(tableLines: { raw: string }[]): DiagramMode {
  const nonSeparatorLines = tableLines.filter((tl) => !isTableSeparatorLine(tl.raw));
  if (nonSeparatorLines.length === 0) return 'concept-map';

  // 1. Inspeciona a linha do cabeçalho
  const firstRowCells = splitMarkdownTableRow(nonSeparatorLines[0].raw);
  const normalizedHeader = firstRowCells.map((c) => stripAccents(c.toLowerCase()).trim());

  const hasConceitoHeader = normalizedHeader.some(
    (c) =>
      c.includes('conceito a') ||
      c.includes('conceito b') ||
      c.includes('conceito 1') ||
      c.includes('conceito 2')
  );

  const hasOrigem = normalizedHeader.some((c) => /\b(origem|source)\b|^origem\s|\sorigem$/.test(c));
  const hasDestino = normalizedHeader.some((c) => /\b(destino|target)\b|^destino\s|\sdestino$/.test(c));
  const hasFlowTerm = normalizedHeader.some((c) =>
    /(transicao|condicao|forma|shape|tipo d[eo] no)/.test(c)
  );

  if (!hasConceitoHeader && ((hasOrigem && hasDestino) || hasFlowTerm)) {
    return 'flowchart';
  }

  // 2. Inspeciona tags de formas inline em células (ex: [Início], (Início), [Processo], etc.)
  const flowchartTagRegex =
    /(?:\[|\()(?:in[ií]cio|fim|terminal|start|end|decis[aã]o|decision|processo|process|etapa|a[cç][aã]o|entrada(?:\/|\s*e\s*)sa[ií]da|io|i\/o|e\/s|subprocesso|subrotina|subroutine|documento|document|relat[oó]rio)(?:\]|\))|\{[\s\S]+?\??\}|\[\[[\s\S]+?\]\]|\(\[[\s\S]+?\]\)|\b(?:in[ií]cio|inicio|terminal|processo|decis[aã]o|decisao|fim)\s*(?:->|>)\s*(?:processo|decis[aã]o|decisao|fim|terminal|subroutine|documento|io)\b/i;

  for (const { raw } of nonSeparatorLines) {
    const cells = splitMarkdownTableRow(raw);
    for (const cell of cells) {
      if (flowchartTagRegex.test(cell)) {
        return 'flowchart';
      }
    }
  }

  // Fallback padrão: 'concept-map' (compatibilidade estrita com exemplo.md)
  return 'concept-map';
}

const STATIC_SHAPE_MAP: Record<string, FlowchartNodeShape> = {
  inicio: 'terminal',
  fim: 'terminal',
  start: 'terminal',
  end: 'terminal',
  terminal: 'terminal',
  termino: 'terminal',
  parada: 'terminal',
  stop: 'terminal',
  processo: 'process',
  process: 'process',
  etapa: 'process',
  acao: 'process',
  tarefa: 'process',
  atividade: 'process',
  step: 'process',
  task: 'process',
  action: 'process',
  decisao: 'decision',
  decision: 'decision',
  desvio: 'decision',
  teste: 'decision',
  escolha: 'decision',
  io: 'io',
  'i/o': 'io',
  'e/s': 'io',
  es: 'io',
  dados: 'io',
  data: 'io',
  concept: 'concept',
  conceito: 'concept',
};

const SHAPE_SUBSTRING_RULES: [RegExp, FlowchartNodeShape][] = [
  [/entrada|saida|input|output/, 'io'],
  [/sub|rotina|routine|procedimento/, 'subroutine'],
  [/document|relatorio|report|comprovante|certidao/, 'document'],
];

/**
 * Mapeia tokens textuais de formato de nó para o FlowchartNodeShape canônico.
 */
export function normalizeNodeShapeString(raw: string): FlowchartNodeShape | null {
  const clean = stripAccents(raw.toLowerCase())
    .trim()
    .replace(/[^a-z0-9/_-]/g, '');

  if (STATIC_SHAPE_MAP[clean]) {
    return STATIC_SHAPE_MAP[clean];
  }

  for (const [pattern, shape] of SHAPE_SUBSTRING_RULES) {
    if (pattern.test(clean)) return shape;
  }

  return null;
}

export interface ExtractedShapeResult {
  cleanLabel: string;
  shape?: FlowchartNodeShape;
  rawShapeTag?: string;
}

const TAG_PATTERN =
  '(?:in[ií]cio|fim|terminal|start|end|t[eé]rmino|decis[aã]o|decision|condi[cç][aã]o|processo|process|etapa|a[cç][aã]o|tarefa|entrada(?:/|\\s*e\\s*)sa[ií]da|io|i/o|e/s|input(?:/output)?|output|subprocesso|subrotina|subroutine|documento|document|relat[oó]rio)';

const EXACT_TAG_REGEX = new RegExp(`^(?:\\[|\\()(${TAG_PATTERN})(?:\\]|\\))$`, 'i');
const PREFIX_TAG_REGEX = new RegExp(`^(?:\\[|\\()(${TAG_PATTERN})(?:\\]|\\))\\s*[-:]?\\s*(.+)$`, 'i');
const SUFFIX_TAG_REGEX = new RegExp(`^(.*?)\\s*(?:\\[|\\()(${TAG_PATTERN})(?:\\]|\\))$`, 'i');

/**
 * Extrai tags de forma declaradas inline nos rótulos de nós (prefixo, sufixo ou delimitadores).
 */
const MERMAID_DELIMITERS: [RegExp, FlowchartNodeShape, string][] = [
  [/^\[\[([\s\S]+)\]\]$/, 'subroutine', '[[...]]'],
  [/^\{([\s\S]+)\}$/, 'decision', '{...}'],
  [/^\(\[([\s\S]+)\]\)$/, 'terminal', '([...])'],
  [/^(?:\[\/|\[\\)([\s\S]+?)(?:\/\]|\\\])$/, 'io', '[/.../]'],
];

export function extractShapeFromLabel(rawLabel: string): ExtractedShapeResult {
  const trimmed = rawLabel.trim();
  if (!trimmed) return { cleanLabel: '' };

  for (const [regex, shape, rawShapeTag] of MERMAID_DELIMITERS) {
    const match = trimmed.match(regex);
    if (match) {
      return { cleanLabel: cleanDisplayText(match[1]), shape, rawShapeTag };
    }
  }

  const exact = trimmed.match(EXACT_TAG_REGEX);
  if (exact) {
    return {
      cleanLabel: cleanDisplayText(exact[1]),
      shape: normalizeNodeShapeString(exact[1]) ?? undefined,
      rawShapeTag: exact[0],
    };
  }

  const prefix = trimmed.match(PREFIX_TAG_REGEX);
  if (prefix) {
    return {
      cleanLabel: cleanDisplayText(prefix[2]),
      shape: normalizeNodeShapeString(prefix[1]) ?? undefined,
      rawShapeTag: prefix[1],
    };
  }

  const suffix = trimmed.match(SUFFIX_TAG_REGEX);
  if (suffix && suffix[1].trim()) {
    return {
      cleanLabel: cleanDisplayText(suffix[1]),
      shape: normalizeNodeShapeString(suffix[2]) ?? undefined,
      rawShapeTag: suffix[2],
    };
  }

  return { cleanLabel: cleanDisplayText(trimmed) };
}

const INDEX_COL_NAMES = new Set(['#', 'id', 'no', 'num', 'nº', 'numero', 'indice', 'index', 'ordem', 'item']);

/**
 * Detecta se as células pertencem a um cabeçalho de tabela e mapeia os índices das colunas.
 * Suporta de 3 a 6 colunas para mapas conceituais e fluxogramas.
 */
function detectHeaderMapping(cells: string[]): ColumnMapping | null {
  const normalizedCells = cells.map((c) =>
    stripAccents(c.toLowerCase()).replace(/\s+/g, ' ').trim()
  );

  let indexCol: number | undefined;
  let sourceCol = -1;
  let phraseCol = -1;
  let targetCol = -1;
  let typeCol: number | undefined;
  let shapeCol: number | undefined;

  normalizedCells.forEach((colName, idx) => {
    if (indexCol === undefined && INDEX_COL_NAMES.has(colName)) {
      indexCol = idx;
    } else if (sourceCol === -1 && /(conceito\s*[a1]|origem|source|^de$|etapa anterior|^sujeito$)/.test(colName)) {
      sourceCol = idx;
    } else if (phraseCol === -1 && /(label|linking phrase|transition|condition|frase|ligacao|transicao|condicao|rotulo|acao|verbo|predicado)/.test(colName)) {
      phraseCol = idx;
    } else if (targetCol === -1 && /(conceito\s*[b2]|destino|target|^para$|proxima etapa|etapa seguinte|^objeto$)/.test(colName)) {
      targetCol = idx;
    } else if (shapeCol === undefined && /(forma|shape|tipo d[eo] no|geometria)/.test(colName)) {
      shapeCol = idx;
    } else if (typeCol === undefined && /(type|kind|tipo|natureza|categoria|classificacao)/.test(colName)) {
      typeCol = idx;
    }
  });

  // Se Tipo / Forma foi mapeado como shapeCol, mas typeCol está indefinido, compartilha a coluna
  if (shapeCol !== undefined && typeCol === undefined) {
    typeCol = shapeCol;
  } else if (typeCol !== undefined && shapeCol === undefined) {
    const rawTypeName = normalizedCells[typeCol] ?? '';
    if (rawTypeName.includes('forma') || rawTypeName.includes('shape')) {
      shapeCol = typeCol;
    }
  }

  if (sourceCol !== -1 && phraseCol !== -1 && targetCol !== -1) {
    const usedCols = [sourceCol, phraseCol, targetCol];
    if (indexCol !== undefined) usedCols.push(indexCol);
    if (typeCol !== undefined) usedCols.push(typeCol);
    if (shapeCol !== undefined) usedCols.push(shapeCol);
    return {
      indexCol,
      sourceCol,
      phraseCol,
      targetCol,
      typeCol,
      shapeCol,
      expectedMinCols: Math.max(...usedCols) + 1,
    };
  }

  return null;
}

/**
 * Cria mapeamento posicional de colunas quando a tabela não possui cabeçalho explícito.
 */
function inferPositionalMapping(cells: string[]): ColumnMapping {
  const hasIndex = cells.length >= 5 && /^\d+$/.test(cells[0].trim());
  const offset = hasIndex ? 1 : 0;
  return {
    indexCol: hasIndex ? 0 : undefined,
    sourceCol: offset,
    phraseCol: offset + 1,
    targetCol: offset + 2,
    typeCol: cells.length > offset + 3 ? offset + 3 : undefined,
    shapeCol: cells.length > offset + 4 ? offset + 4 : undefined,
    expectedMinCols: hasIndex ? (cells.length >= 6 ? 6 : 5) : Math.min(Math.max(cells.length, 3), 5),
  };
}

/**
 * Classifica o tipo e subtipo da relação/transição a partir do texto bruto da célula e contexto.
 */
const FLOW_CONDITIONAL_PHRASES = new Set([
  'sim', 'nao', 'yes', 'no', 'true', 'false', 'aprovado', 'reprovado', 'valido', 'invalido',
]);

export function parseRelationType(
  rawType: string,
  diagramMode: DiagramMode = 'concept-map',
  linkingPhrase = ''
): {
  type: RelationType;
  flowKind?: FlowEdgeKind;
  isDefaulted: boolean;
  isUnknown: boolean;
} {
  const cleaned = stripAccents(rawType.toLowerCase()).trim();
  const phraseClean = stripAccents(linkingPhrase.toLowerCase()).trim();

  if (diagramMode === 'flowchart') {
    if (/(condi|branch|desvio)/.test(cleaned)) {
      return { type: 'conditional', flowKind: 'conditional', isDefaulted: false, isUnknown: false };
    }
    if (/(loop|retorn|volta|reprocess)/.test(cleaned)) {
      return { type: 'loop-back', flowKind: 'loop-back', isDefaulted: false, isUnknown: false };
    }
    if (/(seq|fluxo|operac)/.test(cleaned)) {
      return { type: 'sequence', flowKind: 'sequence', isDefaulted: false, isUnknown: false };
    }
    if (FLOW_CONDITIONAL_PHRASES.has(phraseClean) || phraseClean.endsWith('?')) {
      return { type: 'conditional', flowKind: 'conditional', isDefaulted: false, isUnknown: false };
    }
    if (/(cruzad|cross)/.test(cleaned)) {
      return { type: 'cross-link', flowKind: 'sequence', isDefaulted: false, isUnknown: false };
    }
    if (cleaned.includes('hier')) {
      return { type: 'hierarchical', flowKind: 'sequence', isDefaulted: false, isUnknown: false };
    }
    return { type: 'sequence', flowKind: 'sequence', isDefaulted: !cleaned, isUnknown: false };
  }

  if (!cleaned) return { type: 'hierarchical', isDefaulted: true, isUnknown: false };
  if (/(cruzad|cross|transvers|associat)/.test(cleaned)) {
    return { type: 'cross-link', isDefaulted: false, isUnknown: false };
  }
  if (/(hier|subord|arvore|estrutur)/.test(cleaned)) {
    return { type: 'hierarchical', isDefaulted: false, isUnknown: false };
  }
  return { type: 'hierarchical', isDefaulted: false, isUnknown: true };
}

/**
 * Calcula métricas topológicas completas sobre o Modelo Semântico:
 * raízes, folhas, conectividade, existência de ciclos (geral e hierárquico) e profundidade por nó.
 */
export function computeSemanticGraphMetrics(semantic: SemanticModel): SemanticGraphMetrics {
  const conceptIds = semantic.conceptOrder;
  const relations = semantic.relationOrder.map((id) => semantic.relations[id]).filter(Boolean);

  const totalConcepts = conceptIds.length;
  const totalRelations = relations.length;
  let hierarchicalCount = 0;
  let crossLinkCount = 0;
  let sequenceCount = 0;
  let conditionalCount = 0;
  let loopBackCount = 0;

  const inDegreeTotal: Record<ConceptId, number> = {};
  const outDegreeTotal: Record<ConceptId, number> = {};
  const inDegreeHier: Record<ConceptId, number> = {};
  const outDegreeHier: Record<ConceptId, number> = {};

  const adjTotal: Record<ConceptId, ConceptId[]> = {};
  const adjHier: Record<ConceptId, ConceptId[]> = {};
  const adjUndirected: Record<ConceptId, Set<ConceptId>> = {};

  for (const id of conceptIds) {
    inDegreeTotal[id] = 0;
    outDegreeTotal[id] = 0;
    inDegreeHier[id] = 0;
    outDegreeHier[id] = 0;
    adjTotal[id] = [];
    adjHier[id] = [];
    adjUndirected[id] = new Set();
  }

  for (const rel of relations) {
    if (!adjTotal[rel.sourceId] || !adjTotal[rel.targetId]) continue;

    outDegreeTotal[rel.sourceId]++;
    inDegreeTotal[rel.targetId]++;
    adjTotal[rel.sourceId].push(rel.targetId);

    adjUndirected[rel.sourceId].add(rel.targetId);
    adjUndirected[rel.targetId].add(rel.sourceId);

    if (rel.type === 'cross-link') {
      crossLinkCount++;
    } else if (rel.type === 'loop-back') {
      loopBackCount++;
    } else {
      if (rel.type === 'hierarchical') hierarchicalCount++;
      else if (rel.type === 'sequence') sequenceCount++;
      else if (rel.type === 'conditional') conditionalCount++;
      outDegreeHier[rel.sourceId]++;
      inDegreeHier[rel.targetId]++;
      adjHier[rel.sourceId].push(rel.targetId);
    }
  }

  // Raízes hierárquicas / de fluxo: nós com inDegreeHier === 0
  const rootConceptIds = conceptIds.filter((id) => inDegreeHier[id] === 0);
  const leafConceptIds = conceptIds.filter((id) => outDegreeTotal[id] === 0);

  // Conectividade fraca (BFS no grafo não-direcionado)
  let isConnected = true;
  if (totalConcepts > 1) {
    const visited = new Set<ConceptId>();
    const queue: ConceptId[] = [conceptIds[0]];
    visited.add(conceptIds[0]);

    let head = 0;
    while (head < queue.length) {
      const curr = queue[head++];
      for (const neighbor of adjUndirected[curr]) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    isConnected = visited.size === totalConcepts;
  }

  // Detecção de ciclos direcionados via DFS com 3 cores (0=unvisited, 1=visiting, 2=visited)
  const detectCycle = (adj: Record<ConceptId, ConceptId[]>): boolean => {
    const state: Record<ConceptId, number> = {};
    for (const id of conceptIds) state[id] = 0;

    const dfs = (u: ConceptId): boolean => {
      state[u] = 1;
      for (const v of adj[u]) {
        if (state[v] === 1) return true;
        if (state[v] === 0 && dfs(v)) return true;
      }
      state[u] = 2;
      return false;
    };

    for (const id of conceptIds) {
      if (state[id] === 0 && dfs(id)) {
        return true;
      }
    }
    return false;
  };

  const hasDirectedCycles = detectCycle(adjTotal);
  const hasHierarchicalCycles = detectCycle(adjHier);

  // Cálculo de profundidade hierárquica (BFS a partir das raízes hierárquicas)
  const hierarchicalDepthById: Record<ConceptId, number> = {};
  const depthQueue: ConceptId[] = [];

  for (const rootId of rootConceptIds) {
    hierarchicalDepthById[rootId] = 0;
    depthQueue.push(rootId);
  }

  // Usa um guarda de limite de profundidade para ser seguro mesmo se houver ciclos
  const maxDepth = Math.max(totalConcepts, 1);
  let depthHead = 0;
  while (depthHead < depthQueue.length) {
    const u = depthQueue[depthHead++];
    const currentDepth = hierarchicalDepthById[u] ?? 0;
    if (currentDepth >= maxDepth) continue;

    for (const v of adjHier[u]) {
      if (
        hierarchicalDepthById[v] === undefined ||
        hierarchicalDepthById[v] < currentDepth + 1
      ) {
        hierarchicalDepthById[v] = currentDepth + 1;
        depthQueue.push(v);
      }
    }
  }

  // Fallback para nós em componentes puramente cíclicos
  for (const id of conceptIds) {
    if (hierarchicalDepthById[id] === undefined) {
      hierarchicalDepthById[id] = 0;
    }
  }

  return {
    totalConcepts,
    totalRelations,
    hierarchicalCount,
    crossLinkCount,
    rootConceptIds,
    leafConceptIds,
    isConnected,
    hasDirectedCycles,
    hasHierarchicalCycles,
    hierarchicalDepthById,
    sequenceCount,
    conditionalCount,
    loopBackCount,
  };
}

/**
 * Realiza o parsing tolerante a falhas de um documento Markdown contendo tabela(s)
 * de proposições de mapa conceitual ou fluxograma.
 */
export function parseConceptMapMarkdown(
  markdownContent: string,
  options: MarkdownParserOptions = {}
): ParseResult {
  const diagnostics: ParseDiagnostic[] = [];
  const defaultTitle = options.defaultTitle ?? 'Mapa Conceitual';

  // 1. Extração do Frontmatter YAML (Tier 1)
  const {
    contentWithoutFrontmatter,
    frontmatterMode,
    frontmatterTitle,
    frontmatterTreeLayout,
  } = extractFrontmatter(markdownContent ?? '');

  const effectiveMarkdown = contentWithoutFrontmatter;

  // 2. Detecção de Diretivas HTML / Textuais (Tier 2)
  const directiveMode = detectDirectiveMode(effectiveMarkdown);

  const concepts: Record<ConceptId, ConceptNodeSemantic> = {};
  const conceptOrder: ConceptId[] = [];
  const conceptIdByNormalizedKey = new Map<string, ConceptId>();
  const usedConceptIds = new Set<ConceptId>();

  const relations: Record<RelationId, ConceptRelationSemantic> = {};
  const relationOrder: RelationId[] = [];
  const seenRelationSignatures = new Set<string>();

  const makeEmptyResult = (mode: DiagramMode, title: string): ParseResult => {
    const semantic: SemanticModel = {
      diagramMode: mode,
      title,
      concepts: {},
      conceptOrder: [],
      relations: {},
      relationOrder: [],
    };
    return {
      semantic,
      metrics: computeSemanticGraphMetrics(semantic),
      diagnostics,
      detectedColumnCount: 5,
    };
  };

  if (!effectiveMarkdown || effectiveMarkdown.trim().length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'EMPTY_FILE',
      message: 'O arquivo Markdown está vazio.',
    });
    return makeEmptyResult(
      frontmatterMode ?? directiveMode ?? options.diagramMode ?? 'concept-map',
      frontmatterTitle ?? defaultTitle
    );
  }

  const lines = effectiveMarkdown.replace(/\r\n/g, '\n').split('\n');
  let extractedTitle: string | undefined = frontmatterTitle;

  interface IndexedLine {
    lineNumber: number;
    raw: string;
  }

  const tableLines: IndexedLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!extractedTitle && /^#\s+(.+)$/.test(trimmed)) {
      const match = trimmed.match(/^#\s+(.+)$/);
      if (match?.[1]) {
        extractedTitle = match[1].trim();
      }
      continue;
    }

    if (trimmed.includes('|') && !/^[-*+#]\s/.test(trimmed)) {
      tableLines.push({ lineNumber: i + 1, raw });
    }
  }

  // 3. Resolução Final do Modo do Diagrama (3-Tier Cascade)
  let detectedMode: DiagramMode;
  if (options.diagramMode) {
    detectedMode = options.diagramMode;
  } else if (frontmatterMode) {
    detectedMode = frontmatterMode;
  } else if (directiveMode) {
    detectedMode = directiveMode;
  } else {
    // Heurística de cabeçalho e formas (Tier 3) com fallback padrão para 'concept-map'
    detectedMode = detectHeuristicMode(tableLines);
  }

  if (tableLines.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'NO_TABLE_FOUND',
      message: 'Nenhuma tabela Markdown foi encontrada no arquivo.',
    });
    return makeEmptyResult(detectedMode, extractedTitle ?? defaultTitle);
  }

  // Helper de registro de nó garantindo deduplicação e preservação de formas
  const getOrCreateConcept = (
    rawLabel: string,
    lineNumber: number,
    explicitShape?: FlowchartNodeShape,
    rawShapeTag?: string
  ): ConceptId => {
    const extracted = extractShapeFromLabel(rawLabel);
    const displayLabel = extracted.cleanLabel;
    const normalizedKey = normalizeConceptKey(displayLabel);

    const shapeToAssign = extracted.shape ?? explicitShape;
    const shapeTag = rawShapeTag ?? extracted.rawShapeTag;

    const existingId = conceptIdByNormalizedKey.get(normalizedKey);
    if (existingId) {
      const existingNode = concepts[existingId];
      if (existingNode) {
        if (existingNode.label !== displayLabel) {
          diagnostics.push({
            severity: 'info',
            code: 'CASE_MISMATCH_CONCEPT',
            message: `Conceito "${displayLabel}" na linha ${lineNumber} foi unificado ao conceito existente "${existingNode.label}".`,
            lineNumber,
          });
        }
        // Atualiza a forma do nó se uma forma mais específica for identificada
        if (
          shapeToAssign &&
          (!existingNode.nodeShape ||
            existingNode.nodeShape === 'concept' ||
            (existingNode.nodeShape === 'process' && shapeToAssign !== 'concept'))
        ) {
          existingNode.nodeShape = shapeToAssign;
        }
        if (shapeTag && !existingNode.sourceMeta?.rawShapeTag) {
          existingNode.sourceMeta = {
            ...existingNode.sourceMeta,
            rawShapeTag: shapeTag,
          };
        }
      }
      return existingId;
    }

    let candidateId = slugifyConceptKey(normalizedKey);
    let suffix = 2;
    while (usedConceptIds.has(candidateId)) {
      candidateId = `${slugifyConceptKey(normalizedKey)}-${suffix}`;
      suffix++;
    }

    usedConceptIds.add(candidateId);
    conceptIdByNormalizedKey.set(normalizedKey, candidateId);

    // Forma padrão: em modo fluxograma, nós não marcados assumem 'process'
    // Em mapa conceitual, assumem 'concept' (ou undefined)
    const finalShape: FlowchartNodeShape | undefined =
      shapeToAssign ?? (detectedMode === 'flowchart' ? 'process' : undefined);

    concepts[candidateId] = {
      id: candidateId,
      label: displayLabel,
      normalizedKey,
      nodeShape: finalShape,
      sourceMeta: {
        firstSeenLine: lineNumber,
        createdManually: false,
        rawShapeTag: shapeTag,
      },
    };
    conceptOrder.push(candidateId);

    return candidateId;
  };

  let activeMapping: ColumnMapping | null = null;
  let detectedColumnCount = 5;
  let sequentialOrder = 1;

  for (let i = 0; i < tableLines.length; i++) {
    const { lineNumber, raw } = tableLines[i];

    if (isTableSeparatorLine(raw)) {
      continue;
    }

    const cells = splitMarkdownTableRow(raw);

    const headerCandidate = detectHeaderMapping(cells);
    if (headerCandidate) {
      activeMapping = headerCandidate;
      detectedColumnCount = cells.length;
      continue;
    }

    if (!activeMapping) {
      activeMapping = inferPositionalMapping(cells);
      detectedColumnCount = Math.max(cells.length, activeMapping.expectedMinCols);
      diagnostics.push({
        severity: 'info',
        code: 'MISSING_HEADER',
        message: `Cabeçalho da tabela não identificado na linha ${lineNumber}; colunas inferidas por posição.`,
        lineNumber,
        rawLine: raw,
      });
    }

    let rowMapping = activeMapping;
    if (cells.length < 3) {
      diagnostics.push({
        severity: 'error',
        code: 'MALFORMED_ROW_SKIPPED',
        message: `Linha ${lineNumber} ignorada: quantidade insuficiente de colunas (${cells.length}).`,
        lineNumber,
        rawLine: raw,
      });
      continue;
    }

    // Adaptação se uma tabela de 5 colunas tiver linhas escritas com 4 colunas sem índice
    if (
      rowMapping.indexCol === 0 &&
      cells.length === 4 &&
      !/^\d+$/.test(cells[0].trim())
    ) {
      rowMapping = {
        sourceCol: 0,
        phraseCol: 1,
        targetCol: 2,
        typeCol: 3,
        expectedMinCols: 4,
      };
    }

    const rawSource = cells[rowMapping.sourceCol] ?? '';
    const rawPhrase = cells[rowMapping.phraseCol] ?? '';
    const rawTarget = cells[rowMapping.targetCol] ?? '';
    const rawType =
      rowMapping.typeCol !== undefined && rowMapping.typeCol < cells.length
        ? cells[rowMapping.typeCol]
        : '';
    const rawShape =
      rowMapping.shapeCol !== undefined && rowMapping.shapeCol < cells.length
        ? cells[rowMapping.shapeCol]
        : '';

    const sourceLabel = cleanDisplayText(rawSource);
    const linkingPhrase = cleanDisplayText(rawPhrase);
    const targetLabel = cleanDisplayText(rawTarget);

    if (!sourceLabel || !targetLabel) {
      diagnostics.push({
        severity: 'error',
        code: 'MALFORMED_ROW_SKIPPED',
        message: `Linha ${lineNumber} ignorada: Conceito A ou Conceito B está vazio.`,
        lineNumber,
        rawLine: raw,
      });
      continue;
    }

    if (cells.length > detectedColumnCount) {
      diagnostics.push({
        severity: 'info',
        code: 'EXTRA_COLUMNS_IGNORED',
        message: `Linha ${lineNumber} possui colunas extras além das ${detectedColumnCount} esperadas; colunas excedentes foram ignoradas.`,
        lineNumber,
        rawLine: raw,
      });
    }

    // Em modo fluxograma, frases de ligação vazias são permitidas e esperadas!
    if (!linkingPhrase && detectedMode !== 'flowchart') {
      diagnostics.push({
        severity: 'warning',
        code: 'EMPTY_LINKING_PHRASE',
        message: `Linha ${lineNumber}: Frase de ligação vazia entre "${sourceLabel}" e "${targetLabel}".`,
        lineNumber,
        rawLine: raw,
      });
    }

    // Parsing de formas declaradas na coluna de Forma ou Tipo
    let sourceColShape: FlowchartNodeShape | undefined;
    let targetColShape: FlowchartNodeShape | undefined;

    const shapeTextToInspect = rawShape || (rawType.includes('->') || rawType.includes('>') ? rawType : '');
    if (shapeTextToInspect) {
      const parts = shapeTextToInspect.split(/->|>/).map((s) => s.trim());
      if (parts.length === 2) {
        sourceColShape = normalizeNodeShapeString(parts[0]) ?? undefined;
        targetColShape = normalizeNodeShapeString(parts[1]) ?? undefined;
      } else if (parts.length === 1 && parts[0]) {
        const cleanedShape = stripAccents(parts[0].toLowerCase()).trim();
        if (!/(condi|retorn|loop|seq|hier|cruzad)/.test(cleanedShape)) {
          const single = normalizeNodeShapeString(parts[0]);
          if (single) targetColShape = single;
        }
      }
    }

    // Classificação da relação
    const typeInfo = parseRelationType(rawType, detectedMode, linkingPhrase);

    if (typeInfo.isDefaulted && detectedMode !== 'flowchart') {
      diagnostics.push({
        severity: 'warning',
        code: 'MISSING_TYPE_DEFAULTED',
        message: `Linha ${lineNumber}: Tipo de relação ausente; assumido como "hierárquica".`,
        lineNumber,
        rawLine: raw,
      });
    } else if (typeInfo.isUnknown && detectedMode !== 'flowchart') {
      diagnostics.push({
        severity: 'warning',
        code: 'UNKNOWN_RELATION_TYPE',
        message: `Linha ${lineNumber}: Tipo de relação "${rawType}" desconhecido; classificado como "hierárquica".`,
        lineNumber,
        rawLine: raw,
      });
    }

    const sourceId = getOrCreateConcept(sourceLabel, lineNumber, sourceColShape);
    const targetId = getOrCreateConcept(targetLabel, lineNumber, targetColShape);

    if (sourceId === targetId && typeInfo.type !== 'loop-back') {
      diagnostics.push({
        severity: 'warning',
        code: 'SELF_LOOP_DETECTED',
        message: `Linha ${lineNumber}: Auto-relação detectada no conceito "${sourceLabel}".`,
        lineNumber,
        rawLine: raw,
      });
    }

    const normalizedPhrase = linkingPhrase.toLowerCase();
    const signature = `${sourceId}::${normalizedPhrase}::${targetId}::${typeInfo.type}`;

    if (seenRelationSignatures.has(signature)) {
      diagnostics.push({
        severity: 'warning',
        code: 'DUPLICATE_RELATION_SKIPPED',
        message: `Linha ${lineNumber}: Relação duplicada ignorada (${sourceLabel} -> ${linkingPhrase} -> ${targetLabel}).`,
        lineNumber,
        rawLine: raw,
      });
      continue;
    }
    seenRelationSignatures.add(signature);

    let orderIndex = sequentialOrder;
    if (rowMapping.indexCol !== undefined && rowMapping.indexCol < cells.length) {
      const parsedNum = Number.parseInt(cells[rowMapping.indexCol].trim(), 10);
      if (!Number.isNaN(parsedNum) && parsedNum > 0) {
        orderIndex = parsedNum;
      }
    }
    sequentialOrder++;

    const relationId: RelationId = `rel-${relationOrder.length + 1}`;
    relations[relationId] = {
      id: relationId,
      orderIndex,
      sourceId,
      linkingPhrase,
      targetId,
      type: typeInfo.type,
      flowKind: typeInfo.flowKind,
      rawType: cleanDisplayText(rawType) || (typeInfo.type === 'hierarchical' ? 'hierárquica' : 'sequencial'),
      sourceMeta: {
        lineNumber,
        rawRowText: raw,
        createdManually: false,
      },
    };
    relationOrder.push(relationId);
  }

  const semantic: SemanticModel = {
    diagramMode: detectedMode,
    treeLayout: frontmatterTreeLayout,
    title: extractedTitle ?? defaultTitle,
    concepts,
    conceptOrder,
    relations,
    relationOrder,
  };

  return {
    semantic,
    metrics: computeSemanticGraphMetrics(semantic),
    diagnostics,
    detectedColumnCount,
  };
}
