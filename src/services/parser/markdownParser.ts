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

  for (let i = 0; i < withoutOuterPipes.length; i++) {
    const ch = withoutOuterPipes[i];
    if (ch === '\\' && i + 1 < withoutOuterPipes.length && withoutOuterPipes[i + 1] === '|') {
      current += '|';
      i++; // Pula o pipe escapado
    } else if (ch === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());

  return cells;
}

/**
 * Verifica se uma linha é um separador de tabela Markdown (ex: `|---|---|---|` ou `|:---:|---:|`).
 */
export function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') || !trimmed.includes('-')) {
    return false;
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
  }

  return {
    contentWithoutFrontmatter,
    frontmatterMode,
    frontmatterTitle,
  };
}

/**
 * Detecta diretivas de modo via comentários HTML ou anotações @type / Tipo de Diagrama.
 */
export function detectDirectiveMode(content: string): DiagramMode | null {
  // 1. Comentário HTML: <!-- type: flowchart --> ou <!-- tipo: fluxograma -->
  const commentMatch = content.match(
    /<!--\s*(?:type|tipo|diagram|mode|modo|tipo\s+de\s+diagrama)\s*[:=]\s*([a-zA-Z0-9_-]+)\s*-->/i
  );
  if (commentMatch) {
    const parsed = normalizeDiagramModeString(commentMatch[1]);
    if (parsed) return parsed;
  }

  // 2. Diretivas de texto: @type: flowchart ou Tipo de Diagrama: Fluxograma
  const directiveMatch = content.match(
    /(?:@(?:type|tipo|diagram|mode|modo)|(?:tipo\s+de\s+diagrama))\s*[:=]\s*([a-zA-Z0-9_-]+)/i
  );
  if (directiveMatch) {
    const parsed = normalizeDiagramModeString(directiveMatch[1]);
    if (parsed) return parsed;
  }

  return null;
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

  const hasOrigem = normalizedHeader.some(
    (c) => c === 'origem' || c.startsWith('origem ') || c === 'source' || c.endsWith(' origem')
  );
  const hasDestino = normalizedHeader.some(
    (c) => c === 'destino' || c.startsWith('destino ') || c === 'target' || c.endsWith(' destino')
  );
  const hasFlowTerm = normalizedHeader.some(
    (c) =>
      c === 'transicao' ||
      c === 'condicao' ||
      c === 'forma' ||
      c === 'shape' ||
      c === 'tipo de no' ||
      c === 'tipo do no' ||
      c === 'transicao / condicao' ||
      c === 'tipo / forma' ||
      c.includes('transicao') ||
      c.includes('condicao') ||
      c.includes('forma') ||
      c.includes('tipo de no')
  );

  if (
    !hasConceitoHeader &&
    ((hasOrigem && hasDestino) ||
      (hasFlowTerm &&
        (hasOrigem ||
          hasDestino ||
          normalizedHeader.some(
            (c) => c.includes('forma') || c.includes('transicao') || c.includes('condicao')
          ))))
  ) {
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

/**
 * Mapeia tokens textuais de formato de nó para o FlowchartNodeShape canônico.
 */
export function normalizeNodeShapeString(raw: string): FlowchartNodeShape | null {
  const clean = stripAccents(raw.toLowerCase())
    .trim()
    .replace(/[^a-z0-9/_-]/g, '');

  if (
    clean === 'inicio' ||
    clean === 'fim' ||
    clean === 'start' ||
    clean === 'end' ||
    clean === 'terminal' ||
    clean === 'termino' ||
    clean === 'parada' ||
    clean === 'stop'
  ) {
    return 'terminal';
  }

  if (
    clean === 'processo' ||
    clean === 'process' ||
    clean === 'etapa' ||
    clean === 'acao' ||
    clean === 'tarefa' ||
    clean === 'atividade' ||
    clean === 'step' ||
    clean === 'task' ||
    clean === 'action'
  ) {
    return 'process';
  }

  if (
    clean === 'decisao' ||
    clean === 'decision' ||
    clean === 'desvio' ||
    clean === 'teste' ||
    clean === 'escolha'
  ) {
    return 'decision';
  }

  if (
    clean === 'io' ||
    clean === 'i/o' ||
    clean === 'e/s' ||
    clean === 'es' ||
    clean.includes('entrada') ||
    clean.includes('saida') ||
    clean.includes('input') ||
    clean.includes('output') ||
    clean === 'dados' ||
    clean === 'data'
  ) {
    return 'io';
  }

  if (
    clean.includes('sub') ||
    clean.includes('rotina') ||
    clean.includes('routine') ||
    clean.includes('procedimento')
  ) {
    return 'subroutine';
  }

  if (
    clean.includes('document') ||
    clean.includes('relatorio') ||
    clean.includes('report') ||
    clean.includes('comprovante') ||
    clean.includes('certidao')
  ) {
    return 'document';
  }

  if (clean === 'concept' || clean === 'conceito') {
    return 'concept';
  }

  return null;
}

export interface ExtractedShapeResult {
  cleanLabel: string;
  shape?: FlowchartNodeShape;
  rawShapeTag?: string;
}

/**
 * Extrai tags de forma declaradas inline nos rótulos de nós (prefixo, sufixo ou delimitadores).
 */
export function extractShapeFromLabel(rawLabel: string): ExtractedShapeResult {
  const trimmed = rawLabel.trim();
  if (!trimmed) {
    return { cleanLabel: '' };
  }

  // 1. Sintaxes de delimitador estilo Mermaid:
  // Subprocesso: [[Texto]]
  const subroutineMatch = trimmed.match(/^\[\[([\s\S]+)\]\]$/);
  if (subroutineMatch) {
    return {
      cleanLabel: cleanDisplayText(subroutineMatch[1]),
      shape: 'subroutine',
      rawShapeTag: '[[...]]',
    };
  }

  // Decisão: {Texto} ou {Texto?}
  const decisionMatch = trimmed.match(/^\{([\s\S]+)\}$/);
  if (decisionMatch) {
    return {
      cleanLabel: cleanDisplayText(decisionMatch[1]),
      shape: 'decision',
      rawShapeTag: '{...}',
    };
  }

  // Terminal: ([Texto])
  const stadiumMatch = trimmed.match(/^\(\[([\s\S]+)\]\)$/);
  if (stadiumMatch) {
    return {
      cleanLabel: cleanDisplayText(stadiumMatch[1]),
      shape: 'terminal',
      rawShapeTag: '([...])',
    };
  }

  // Entrada/Saída: [/Texto/] ou [\Texto\]
  const ioMermaidMatch = trimmed.match(/^(?:\[\/|\[\\)([\s\S]+?)(?:\/\]|\\\])$/);
  if (ioMermaidMatch) {
    return {
      cleanLabel: cleanDisplayText(ioMermaidMatch[1]),
      shape: 'io',
      rawShapeTag: '[/.../]',
    };
  }

  // 2. Tags entre colchetes ou parênteses:
  const TAG_PATTERN =
    '(?:in[ií]cio|fim|terminal|start|end|t[eé]rmino|decis[aã]o|decision|condi[cç][aã]o|processo|process|etapa|a[cç][aã]o|tarefa|entrada(?:/|\\s*e\\s*)sa[ií]da|io|i/o|e/s|input(?:/output)?|output|subprocesso|subrotina|subroutine|documento|document|relat[oó]rio)';

  // Standalone tag exata: [Início], (Início), [Decisão], [Fim]
  const exactMatch = trimmed.match(new RegExp(`^(?:\\[|\\()(${TAG_PATTERN})(?:\\]|\\))$`, 'i'));
  if (exactMatch) {
    const shape = normalizeNodeShapeString(exactMatch[1]);
    return {
      cleanLabel: cleanDisplayText(exactMatch[1]),
      shape: shape ?? undefined,
      rawShapeTag: exactMatch[0],
    };
  }

  // Tag prefixada: [Início] Protocolar Pedido ou (Início) Protocolar Pedido
  const prefixMatch = trimmed.match(new RegExp(`^(?:\\[|\\()(${TAG_PATTERN})(?:\\]|\\))\\s*[-:]?\\s*(.+)$`, 'i'));
  if (prefixMatch) {
    const shape = normalizeNodeShapeString(prefixMatch[1]);
    return {
      cleanLabel: cleanDisplayText(prefixMatch[2]),
      shape: shape ?? undefined,
      rawShapeTag: prefixMatch[1],
    };
  }

  // Tag sufixada: Protocolar Pedido [Início] ou Protocolar Pedido (Início)
  const suffixMatch = trimmed.match(new RegExp(`^(.*?)\\s*(?:\\[|\\()(${TAG_PATTERN})(?:\\]|\\))$`, 'i'));
  if (suffixMatch && suffixMatch[1].trim()) {
    const shape = normalizeNodeShapeString(suffixMatch[2]);
    return {
      cleanLabel: cleanDisplayText(suffixMatch[1]),
      shape: shape ?? undefined,
      rawShapeTag: suffixMatch[2],
    };
  }

  return {
    cleanLabel: cleanDisplayText(trimmed),
  };
}

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
    if (
      indexCol === undefined &&
      ['#', 'id', 'no', 'num', 'nº', 'numero', 'indice', 'index', 'ordem', 'item'].includes(colName)
    ) {
      indexCol = idx;
    } else if (
      sourceCol === -1 &&
      (colName.includes('conceito a') ||
        colName.includes('conceito 1') ||
        colName.includes('origem') ||
        colName === 'source' ||
        colName === 'de' ||
        colName.includes('etapa anterior') ||
        colName === 'sujeito')
    ) {
      sourceCol = idx;
    } else if (
      phraseCol === -1 &&
      (colName.includes('frase') ||
        colName.includes('ligacao') ||
        colName.includes('transicao') ||
        colName.includes('condicao') ||
        colName.includes('rotulo') ||
        colName.includes('acao') ||
        colName.includes('verbo') ||
        colName.includes('predicado') ||
        colName === 'label' ||
        colName === 'linking phrase' ||
        colName === 'transition' ||
        colName === 'condition')
    ) {
      phraseCol = idx;
    } else if (
      targetCol === -1 &&
      (colName.includes('conceito b') ||
        colName.includes('conceito 2') ||
        colName.includes('destino') ||
        colName === 'target' ||
        colName === 'para' ||
        colName.includes('proxima etapa') ||
        colName.includes('etapa seguinte') ||
        colName === 'objeto')
    ) {
      targetCol = idx;
    } else if (
      shapeCol === undefined &&
      (colName.includes('forma') ||
        colName.includes('shape') ||
        colName.includes('tipo de no') ||
        colName.includes('tipo do no') ||
        colName.includes('geometria'))
    ) {
      shapeCol = idx;
    } else if (
      typeCol === undefined &&
      (colName.includes('tipo') ||
        colName.includes('natureza') ||
        colName.includes('categoria') ||
        colName === 'type' ||
        colName === 'kind' ||
        colName.includes('classificacao'))
    ) {
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
  // Caso 6 colunas com índice: # | Origem | Frase | Destino | Tipo | Forma
  if (cells.length >= 6 && /^\d+$/.test(cells[0].trim())) {
    return {
      indexCol: 0,
      sourceCol: 1,
      phraseCol: 2,
      targetCol: 3,
      typeCol: 4,
      shapeCol: 5,
      expectedMinCols: 6,
    };
  }

  // Caso 5+ colunas onde a primeira coluna é um índice numérico (padrão entrada.md / exemplo.md)
  if (cells.length >= 5 && /^\d+$/.test(cells[0].trim())) {
    return {
      indexCol: 0,
      sourceCol: 1,
      phraseCol: 2,
      targetCol: 3,
      typeCol: 4,
      expectedMinCols: 5,
    };
  }

  // Caso 5 colunas sem índice numérico: Origem | Frase | Destino | Tipo | Forma
  if (cells.length >= 5) {
    return {
      sourceCol: 0,
      phraseCol: 1,
      targetCol: 2,
      typeCol: 3,
      shapeCol: 4,
      expectedMinCols: 5,
    };
  }

  // Caso 4 colunas (padrão exemplo: Conceito A | Frase | Conceito B | Tipo)
  if (cells.length >= 4) {
    return {
      sourceCol: 0,
      phraseCol: 1,
      targetCol: 2,
      typeCol: 3,
      expectedMinCols: 4,
    };
  }

  // Caso 3 colunas (sem coluna Tipo)
  return {
    sourceCol: 0,
    phraseCol: 1,
    targetCol: 2,
    expectedMinCols: 3,
  };
}

/**
 * Classifica o tipo e subtipo da relação/transição a partir do texto bruto da célula e contexto.
 */
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

  // Em modo fluxograma:
  if (diagramMode === 'flowchart') {
    // 1. Condicional explícita na coluna Tipo
    if (cleaned.includes('condi') || cleaned.includes('branch') || cleaned.includes('desvio')) {
      return { type: 'conditional', flowKind: 'conditional', isDefaulted: false, isUnknown: false };
    }

    // 2. Retorno / Loop na coluna Tipo
    if (
      cleaned.includes('loop') ||
      cleaned.includes('retorn') ||
      cleaned.includes('volta') ||
      cleaned.includes('reprocess')
    ) {
      return { type: 'loop-back', flowKind: 'loop-back', isDefaulted: false, isUnknown: false };
    }

    // 3. Sequencial explícita na coluna Tipo
    if (cleaned.includes('seq') || cleaned.includes('fluxo') || cleaned.includes('operac')) {
      return { type: 'sequence', flowKind: 'sequence', isDefaulted: false, isUnknown: false };
    }

    // 4. Frase de ligação indicativa de condicional (ex: Sim, Não, True, False, Aprovado, Reprovado)
    if (
      ['sim', 'nao', 'yes', 'no', 'true', 'false', 'aprovado', 'reprovado', 'valido', 'invalido'].includes(phraseClean) ||
      phraseClean.endsWith('?')
    ) {
      return { type: 'conditional', flowKind: 'conditional', isDefaulted: false, isUnknown: false };
    }

    // 5. Cruzada ou Hierárquica em fluxograma (se declarada expressamente)
    if (cleaned.includes('cruzad') || cleaned.includes('cross')) {
      return { type: 'cross-link', flowKind: 'sequence', isDefaulted: false, isUnknown: false };
    }
    if (cleaned.includes('hier')) {
      return { type: 'hierarchical', flowKind: 'sequence', isDefaulted: false, isUnknown: false };
    }

    // 6. Se o campo de tipo estiver vazio ou contiver apenas formas (ex: início -> processo)
    // Em fluxograma, o padrão canônico é 'sequence' sem ser tratado como erro desconhecido
    return { type: 'sequence', flowKind: 'sequence', isDefaulted: !cleaned, isUnknown: false };
  }

  // Em modo mapa conceitual padrão (Novak):
  if (!cleaned) {
    return { type: 'hierarchical', isDefaulted: true, isUnknown: false };
  }

  if (
    cleaned.includes('cruzad') ||
    cleaned.includes('cross') ||
    cleaned.includes('transvers') ||
    cleaned.includes('associat')
  ) {
    return { type: 'cross-link', isDefaulted: false, isUnknown: false };
  }

  if (
    cleaned.includes('hier') ||
    cleaned.includes('subord') ||
    cleaned.includes('arvore') ||
    cleaned.includes('estrutur')
  ) {
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

    if (rel.type === 'hierarchical') {
      hierarchicalCount++;
      outDegreeHier[rel.sourceId]++;
      inDegreeHier[rel.targetId]++;
      adjHier[rel.sourceId].push(rel.targetId);
    } else if (rel.type === 'cross-link') {
      crossLinkCount++;
    } else if (rel.type === 'sequence') {
      sequenceCount++;
      outDegreeHier[rel.sourceId]++;
      inDegreeHier[rel.targetId]++;
      adjHier[rel.sourceId].push(rel.targetId);
    } else if (rel.type === 'conditional') {
      conditionalCount++;
      outDegreeHier[rel.sourceId]++;
      inDegreeHier[rel.targetId]++;
      adjHier[rel.sourceId].push(rel.targetId);
    } else if (rel.type === 'loop-back') {
      loopBackCount++;
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

    while (queue.length > 0) {
      const curr = queue.shift()!;
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
  const queue: ConceptId[] = [];

  for (const rootId of rootConceptIds) {
    hierarchicalDepthById[rootId] = 0;
    queue.push(rootId);
  }

  // Usa um guarda de limite de profundidade para ser seguro mesmo se houver ciclos
  const maxDepth = Math.max(totalConcepts, 1);
  while (queue.length > 0) {
    const u = queue.shift()!;
    const currentDepth = hierarchicalDepthById[u] ?? 0;
    if (currentDepth >= maxDepth) continue;

    for (const v of adjHier[u]) {
      if (
        hierarchicalDepthById[v] === undefined ||
        hierarchicalDepthById[v] < currentDepth + 1
      ) {
        hierarchicalDepthById[v] = currentDepth + 1;
        queue.push(v);
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
  const { contentWithoutFrontmatter, frontmatterMode, frontmatterTitle } =
    extractFrontmatter(markdownContent ?? '');

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

  if (!effectiveMarkdown || effectiveMarkdown.trim().length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'EMPTY_FILE',
      message: 'O arquivo Markdown está vazio.',
    });

    const emptySemantic: SemanticModel = {
      diagramMode: frontmatterMode ?? directiveMode ?? options.diagramMode ?? 'concept-map',
      title: frontmatterTitle ?? defaultTitle,
      concepts: {},
      conceptOrder: [],
      relations: {},
      relationOrder: [],
    };

    return {
      semantic: emptySemantic,
      metrics: computeSemanticGraphMetrics(emptySemantic),
      diagnostics,
      detectedColumnCount: 5,
    };
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

    if (trimmed.includes('|')) {
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

    const emptySemantic: SemanticModel = {
      diagramMode: detectedMode,
      title: extractedTitle ?? defaultTitle,
      concepts: {},
      conceptOrder: [],
      relations: {},
      relationOrder: [],
    };

    return {
      semantic: emptySemantic,
      metrics: computeSemanticGraphMetrics(emptySemantic),
      diagnostics,
      detectedColumnCount: 5,
    };
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
        const isRelationTypeWord =
          cleanedShape.includes('condi') ||
          cleanedShape.includes('retorn') ||
          cleanedShape.includes('loop') ||
          cleanedShape.includes('seq') ||
          cleanedShape.includes('hier') ||
          cleanedShape.includes('cruzad');

        if (!isRelationTypeWord) {
          const single = normalizeNodeShapeString(parts[0]);
          if (single) {
            targetColShape = single;
          }
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
