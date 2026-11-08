import type {
  ConceptNodeSemantic,
  ConceptRelationSemantic,
  DiagramMode,
  FlowchartNodeShape,
  RelationType,
  SemanticModel,
} from '../../domain/types';

export interface MarkdownSerializeOptions {
  /**
   * Incluir coluna numérica `#` (padrão: `true`, gerando 5 colunas idênticas ao `entrada.md`).
   * Se `false`, gera 4 colunas (`| Conceito A | Frase de ligação | Conceito B | Tipo |`).
   */
  includeIndexColumn?: boolean;

  /**
   * Força o modo de serialização ('concept-map' | 'flowchart').
   * Se omitido, utiliza `semantic.diagramMode ?? 'concept-map'`.
   */
  diagramMode?: DiagramMode;

  /**
   * Controla a inclusão explícita de frontmatter YAML.
   * Se omitido, por padrão inclui frontmatter quando `diagramMode === 'flowchart'`,
   * e omite frontmatter quando `diagramMode === 'concept-map'` (preservando exemplo.md).
   */
  includeFrontmatter?: boolean;

  /**
   * Estilo de serialização de formas em fluxogramas:
   * - 'inline': adiciona tags inline aos rótulos dos nós (ex: `[Início] Pedido`)
   * - 'column': adiciona na coluna Tipo / Forma (ex: `início -> processo`)
   * - 'both': inline tags nos nós e tipo na coluna (padrão)
   */
  shapeStyle?: 'inline' | 'column' | 'both';
}

/**
 * Escapa caracteres `|` e quebras de linha para não corromper células da tabela Markdown.
 */
function escapeMarkdownCell(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

/**
 * Converte o tipo canônico da relação para o texto em português esperado na tabela de mapa conceitual.
 */
export function formatRelationTypeLabel(type: RelationType, mode: DiagramMode = 'concept-map'): string {
  if (mode === 'flowchart') {
    switch (type) {
      case 'conditional':
        return 'condicional';
      case 'loop-back':
        return 'retorno';
      case 'cross-link':
        return 'ligação cruzada';
      case 'hierarchical':
        return 'hierárquica';
      case 'sequence':
      default:
        return 'sequencial';
    }
  }
  return type === 'cross-link' ? 'ligação cruzada' : 'hierárquica';
}

/**
 * Retorna a tag inline em português para a forma geométrica do nó de fluxograma.
 */
export function formatFlowchartNodeInlineTag(
  shape?: FlowchartNodeShape,
  isEndNode?: boolean
): string {
  if (!shape || shape === 'concept') return '';
  switch (shape) {
    case 'terminal':
      return isEndNode ? '[Fim]' : '[Início]';
    case 'process':
      return '[Processo]';
    case 'decision':
      return '[Decisão]';
    case 'io':
      return '[Entrada/Saída]';
    case 'subroutine':
      return '[Subprocesso]';
    case 'document':
      return '[Documento]';
    default:
      return '';
  }
}

/**
 * Retorna o nome amigável da forma para uso na coluna Tipo / Forma.
 */
export function formatFlowchartNodeShapeName(
  shape?: FlowchartNodeShape,
  isEndNode?: boolean
): string {
  if (!shape || shape === 'concept') return 'processo';
  if (shape === 'terminal') return isEndNode ? 'fim' : 'início';
  if (shape === 'io') return 'entrada/saída';
  if (shape === 'subroutine') return 'subprocesso';
  return shape;
}

/**
 * Formata o rótulo do nó com tag inline para fluxogramas (se aplicável).
 */
export function formatFlowchartNodeLabel(
  node: ConceptNodeSemantic,
  isEndNode: boolean,
  options: MarkdownSerializeOptions = {}
): string {
  if (options.shapeStyle === 'column') {
    return node.label;
  }

  const hasTag = /^\s*(?:\[[^\]]+\]|\([^\)]+\)|\{[^\}]+\})/i.test(node.label);
  if (hasTag) {
    return node.label;
  }

  const tag = formatFlowchartNodeInlineTag(node.nodeShape, isEndNode);
  return tag ? `${tag} ${node.label}` : node.label;
}

/**
 * Formata o tipo de transição/forma da relação na coluna 5 de fluxogramas.
 */
export function formatFlowchartRelationType(
  rel: ConceptRelationSemantic,
  sourceShape?: FlowchartNodeShape,
  targetShape?: FlowchartNodeShape,
  isTargetEnd?: boolean
): string {
  if (rel.flowKind === 'loop-back' || rel.type === 'loop-back') {
    return 'retorno';
  }
  if (rel.flowKind === 'conditional' || rel.type === 'conditional') {
    return 'condicional';
  }
  if (rel.rawType && (rel.rawType.includes('->') || rel.rawType.includes('retorno') || rel.rawType.includes('condicional'))) {
    return rel.rawType;
  }
  if (sourceShape || targetShape) {
    const src = formatFlowchartNodeShapeName(sourceShape, false);
    const tgt = formatFlowchartNodeShapeName(targetShape, isTargetEnd);
    return `${src} -> ${tgt}`;
  }
  return 'sequencial';
}

/**
 * Serializa o Modelo Semântico de volta para uma tabela Markdown.
 * Em modo 'concept-map', preserva o formato de 4 ou 5 colunas sem frontmatter (compatível com exemplo.md).
 * Em modo 'flowchart', inclui cabeçalho YAML frontmatter e serializa as formas dos nós.
 */
export function serializeSemanticModelToMarkdown(
  semantic: SemanticModel,
  options: MarkdownSerializeOptions = {}
): string {
  const mode = options.diagramMode ?? semantic.diagramMode ?? 'concept-map';
  const isFlowchart = mode === 'flowchart';
  const includeIndex = options.includeIndexColumn ?? true;
  const includeFrontmatter = options.includeFrontmatter ?? isFlowchart;
  const rows: string[] = [];

  if (includeFrontmatter) {
    rows.push('---');
    rows.push(`type: ${mode}`);
    if (semantic.title && semantic.title !== 'Mapa Conceitual' && semantic.title !== 'Novo Fluxograma') {
      rows.push(`title: ${semantic.title}`);
    }
    rows.push('---');
    rows.push('');
  }

  if (isFlowchart) {
    if (includeIndex) {
      rows.push('| # | Origem | Transição / Condição | Destino | Tipo / Forma |');
      rows.push('|---|---|---|---|---|');
    } else {
      rows.push('| Origem | Transição / Condição | Destino | Tipo / Forma |');
      rows.push('|---|---|---|---|');
    }
  } else {
    if (includeIndex) {
      rows.push('| # | Conceito A | Frase de ligação | Conceito B | Tipo |');
      rows.push('|---|---|---|---|---|');
    } else {
      rows.push('| Conceito A | Frase de ligação | Conceito B | Tipo |');
      rows.push('|---|---|---|---|');
    }
  }

  const orderedRelations = semantic.relationOrder
    .map((id) => semantic.relations[id])
    .filter((rel): rel is NonNullable<typeof rel> => Boolean(rel));

  // Identifica quais nós de destino atuam como folhas (potenciais nós de Fim)
  const sourceNodeIds = new Set(orderedRelations.map((r) => r.sourceId));

  orderedRelations.forEach((rel, index) => {
    const sourceNode = semantic.concepts[rel.sourceId];
    const targetNode = semantic.concepts[rel.targetId];
    if (!sourceNode || !targetNode) {
      return;
    }

    if (isFlowchart) {
      const isTargetEnd = !sourceNodeIds.has(rel.targetId);
      const colSource = escapeMarkdownCell(formatFlowchartNodeLabel(sourceNode, false, options));
      const colPhrase = escapeMarkdownCell(rel.linkingPhrase);
      const colTarget = escapeMarkdownCell(formatFlowchartNodeLabel(targetNode, isTargetEnd, options));
      const colType = escapeMarkdownCell(
        formatFlowchartRelationType(rel, sourceNode.nodeShape, targetNode.nodeShape, isTargetEnd)
      );

      if (includeIndex) {
        rows.push(
          `| ${index + 1} | ${colSource} | ${colPhrase} | ${colTarget} | ${colType} |`
        );
      } else {
        rows.push(`| ${colSource} | ${colPhrase} | ${colTarget} | ${colType} |`);
      }
    } else {
      const colSource = escapeMarkdownCell(sourceNode.label);
      const colPhrase = escapeMarkdownCell(rel.linkingPhrase);
      const colTarget = escapeMarkdownCell(targetNode.label);
      const colType = escapeMarkdownCell(formatRelationTypeLabel(rel.type, 'concept-map'));

      if (includeIndex) {
        rows.push(
          `| ${index + 1} | ${colSource} | ${colPhrase} | ${colTarget} | ${colType} |`
        );
      } else {
        rows.push(`| ${colSource} | ${colPhrase} | ${colTarget} | ${colType} |`);
      }
    }
  });

  return `${rows.join('\n')}\n`;
}
