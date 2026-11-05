import type {
  ConceptId,
  ConceptNodeSemantic,
  ConceptRelationSemantic,
  ParseDiagnostic,
  ParseResult,
  RelationId,
  RelationType,
  SemanticGraphMetrics,
  SemanticModel,
} from '../../domain/types';

export interface MarkdownParserOptions {
  /** Título padrão caso o Markdown não possua um heading `# Título` */
  defaultTitle?: string;
}

interface ColumnMapping {
  indexCol?: number;
  sourceCol: number;
  phraseCol: number;
  targetCol: number;
  typeCol?: number;
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
 * Detecta se as células pertencem a um cabeçalho de tabela e mapeia os índices das colunas.
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

  normalizedCells.forEach((colName, idx) => {
    if (
      indexCol === undefined &&
      ['#', 'id', 'no', 'num', 'nº', 'numero', 'indice', 'index', 'ordem'].includes(colName)
    ) {
      indexCol = idx;
    } else if (
      sourceCol === -1 &&
      (colName.includes('conceito a') ||
        colName.includes('conceito 1') ||
        colName.includes('origem') ||
        colName === 'source' ||
        colName === 'de' ||
        colName === 'sujeito')
    ) {
      sourceCol = idx;
    } else if (
      phraseCol === -1 &&
      (colName.includes('frase') ||
        colName.includes('ligacao') ||
        colName.includes('relacao') ||
        colName.includes('verbo') ||
        colName.includes('predicado') ||
        colName === 'label' ||
        colName === 'linking phrase')
    ) {
      phraseCol = idx;
    } else if (
      targetCol === -1 &&
      (colName.includes('conceito b') ||
        colName.includes('conceito 2') ||
        colName.includes('destino') ||
        colName === 'target' ||
        colName === 'para' ||
        colName === 'objeto')
    ) {
      targetCol = idx;
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

  if (sourceCol !== -1 && phraseCol !== -1 && targetCol !== -1) {
    const usedCols = [sourceCol, phraseCol, targetCol];
    if (indexCol !== undefined) usedCols.push(indexCol);
    if (typeCol !== undefined) usedCols.push(typeCol);
    return {
      indexCol,
      sourceCol,
      phraseCol,
      targetCol,
      typeCol,
      expectedMinCols: Math.max(...usedCols) + 1,
    };
  }

  return null;
}

/**
 * Cria um mapeamento de colunas posicional quando a tabela não possui cabeçalho reconhecível.
 */
function inferPositionalMapping(cells: string[]): ColumnMapping {
  // Caso 5+ colunas onde a primeira coluna é um índice numérico (padrão entrada.md)
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

  // Caso 4 colunas (padrão exemplo do prompt.md: Conceito A | Frase | Conceito B | Tipo)
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
 * Classifica o tipo da relação a partir do texto bruto da célula.
 */
export function parseRelationType(rawType: string): {
  type: RelationType;
  isDefaulted: boolean;
  isUnknown: boolean;
} {
  const cleaned = stripAccents(rawType.toLowerCase()).trim();

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
    } else {
      crossLinkCount++;
    }
  }

  // Raízes hierárquicas: nós com inDegreeHier === 0 (se houver arestas hierárquicas)
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

  // Usa um guarda de limite de profundidade para ser seguro mesmo se o usuário criar ciclo hierárquico
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

  // Fallback para nós em componentes puramente cíclicos onde nenhum teve inDegreeHier === 0
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
  };
}

/**
 * Realiza o parsing tolerante a falhas de um documento Markdown contendo tabela(s)
 * de proposições de mapa conceitual (`Conceito A | Frase de ligação | Conceito B | Tipo`).
 */
export function parseConceptMapMarkdown(
  markdownContent: string,
  options: MarkdownParserOptions = {}
): ParseResult {
  const diagnostics: ParseDiagnostic[] = [];
  const defaultTitle = options.defaultTitle ?? 'Mapa Conceitual';

  const concepts: Record<ConceptId, ConceptNodeSemantic> = {};
  const conceptOrder: ConceptId[] = [];
  const conceptIdByNormalizedKey = new Map<string, ConceptId>();
  const usedConceptIds = new Set<ConceptId>();

  const relations: Record<RelationId, ConceptRelationSemantic> = {};
  const relationOrder: RelationId[] = [];
  const seenRelationSignatures = new Set<string>();

  if (!markdownContent || markdownContent.trim().length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'EMPTY_FILE',
      message: 'O arquivo Markdown está vazio.',
    });

    const emptySemantic: SemanticModel = {
      title: defaultTitle,
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

  const lines = markdownContent.replace(/\r\n/g, '\n').split('\n');
  let extractedTitle: string | undefined;

  // Coleta linhas candidatas de tabela e primeiro título Markdown se existir
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

  if (tableLines.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'NO_TABLE_FOUND',
      message: 'Nenhuma tabela Markdown foi encontrada no arquivo.',
    });

    const emptySemantic: SemanticModel = {
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

  // Helper para registrar ou recuperar um Conceito garantindo unicidade por chave canônica
  const getOrCreateConcept = (rawLabel: string, lineNumber: number): ConceptId => {
    const displayLabel = cleanDisplayText(rawLabel);
    const normalizedKey = normalizeConceptKey(displayLabel);

    const existingId = conceptIdByNormalizedKey.get(normalizedKey);
    if (existingId) {
      const existingNode = concepts[existingId];
      if (existingNode && existingNode.label !== displayLabel) {
        diagnostics.push({
          severity: 'info',
          code: 'CASE_MISMATCH_CONCEPT',
          message: `Conceito "${displayLabel}" na linha ${lineNumber} foi unificado ao conceito existente "${existingNode.label}".`,
          lineNumber,
        });
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

    concepts[candidateId] = {
      id: candidateId,
      label: displayLabel,
      normalizedKey,
      sourceMeta: {
        firstSeenLine: lineNumber,
        createdManually: false,
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

    // Ignora linhas separadoras `|---|---|`
    if (isTableSeparatorLine(raw)) {
      continue;
    }

    const cells = splitMarkdownTableRow(raw);

    // Verifica se a linha atual é um cabeçalho de tabela
    const headerCandidate = detectHeaderMapping(cells);
    if (headerCandidate) {
      activeMapping = headerCandidate;
      detectedColumnCount = cells.length;
      continue;
    }

    // Se ainda não temos mapeamento (tabela sem cabeçalho explícito), infere pela primeira linha de dados
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

    // Validação de linha malformada / incompleta
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

    // Caso a tabela tenha cabeçalho de 5 colunas (com #), mas uma linha específica tenha sido escrita com 4 colunas (sem #)
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

    if (!linkingPhrase) {
      diagnostics.push({
        severity: 'warning',
        code: 'EMPTY_LINKING_PHRASE',
        message: `Linha ${lineNumber}: Frase de ligação vazia entre "${sourceLabel}" e "${targetLabel}".`,
        lineNumber,
        rawLine: raw,
      });
    }

    const typeInfo = parseRelationType(rawType);
    if (typeInfo.isDefaulted) {
      diagnostics.push({
        severity: 'warning',
        code: 'MISSING_TYPE_DEFAULTED',
        message: `Linha ${lineNumber}: Tipo de relação ausente; assumido como "hierárquica".`,
        lineNumber,
        rawLine: raw,
      });
    } else if (typeInfo.isUnknown) {
      diagnostics.push({
        severity: 'warning',
        code: 'UNKNOWN_RELATION_TYPE',
        message: `Linha ${lineNumber}: Tipo de relação "${rawType}" desconhecido; classificado como "hierárquica".`,
        lineNumber,
        rawLine: raw,
      });
    }

    const sourceId = getOrCreateConcept(sourceLabel, lineNumber);
    const targetId = getOrCreateConcept(targetLabel, lineNumber);

    if (sourceId === targetId) {
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

    // Determina o orderIndex preservando o número da coluna `#` se disponível, ou sequencial
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
      rawType: cleanDisplayText(rawType) || (typeInfo.type === 'hierarchical' ? 'hierárquica' : 'ligação cruzada'),
      sourceMeta: {
        lineNumber,
        rawRowText: raw,
        createdManually: false,
      },
    };
    relationOrder.push(relationId);
  }

  const semantic: SemanticModel = {
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
