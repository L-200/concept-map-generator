/**
 * Identificadores únicos estáveis para Conceitos (nós) e Relações/Proposições (arestas).
 */
export type ConceptId = string;
export type RelationId = string;

/**
 * Modo operacional do diagrama:
 * - 'concept-map': Mapa conceitual padrão (Novak), nós retangulares arredondados,
 *                  frases de ligação obrigatórias entre conceitos.
 * - 'flowchart': Fluxograma com formas geométricas específicas (início, processo,
 *                decisão, etc.) e transições sequenciais/condicionais.
 */
export type DiagramMode = 'concept-map' | 'flowchart';

/**
 * Formas canônicas de nós para fluxogramas e mapas conceituais:
 * - 'concept': nó padrão de mapa conceitual (retângulo suavemente arredondado)
 * - 'terminal': pílula / estádio (border-radius: 9999px) para Início e Fim
 * - 'process': retângulo operacional clássico de etapa / ação
 * - 'decision': losango (diamante) com portas nos 4 vértices para desvios Sim/Não
 * - 'io': paralelogramo para entrada e saída de dados / interação do usuário
 * - 'subroutine': retângulo com bordas verticais duplas para subprocessos/rotinas
 * - 'document': retângulo com base ondulada para documentos e relatórios gerados
 */
export type FlowchartNodeShape =
  | 'concept'
  | 'terminal'
  | 'process'
  | 'decision'
  | 'io'
  | 'subroutine'
  | 'document';

/** Lista imutável de todas as formas geométricas disponíveis */
export const ALL_FLOWCHART_NODE_SHAPES: readonly FlowchartNodeShape[] = [
  'concept',
  'terminal',
  'process',
  'decision',
  'io',
  'subroutine',
  'document',
] as const;

/** Modo padrão do sistema */
export const DEFAULT_DIAGRAM_MODE: DiagramMode = 'concept-map';

/**
 * Modalidade específica de transição de fluxo em fluxogramas:
 * - 'sequence': fluxo sequencial / operacional normal
 * - 'conditional': desvio condicional (ex: Sim / Não, Aprovado / Reprovado)
 * - 'loop-back': retorno / reprocessamento para etapa anterior
 */
export type FlowTransitionKind = 'sequence' | 'conditional' | 'loop-back';

/** Alias para manter conformidade com referências a FlowEdgeKind */
export type FlowEdgeKind = FlowTransitionKind;

/**
 * Tipos canônicos de relação no modelo semântico unificado:
 * - 'hierarchical': relação de subordinação/estrutura hierárquica ("hierárquica")
 * - 'cross-link': relação transversal entre subárvores ("ligação cruzada")
 * - 'sequence': transição sequencial em fluxograma ("sequencial")
 * - 'conditional': transição condicional ou ramo de decisão ("condicional")
 * - 'loop-back': retorno ou laço de repetição ("retorno")
 */
export type RelationType =
  | 'hierarchical'
  | 'cross-link'
  | 'sequence'
  | 'conditional'
  | 'loop-back';

/**
 * ============================================================================
 * 1. CAMADA SEMÂNTICA (Independente de UI, coordenadas ou biblioteca gráfica)
 * ============================================================================
 */

export interface ConceptNodeSemantic {
  /** Identificador único e estável do conceito (ex: "concept-projeto-pop") */
  id: ConceptId;
  /** Rótulo de exibição preservando a grafia original (ex: "Projeto POP") */
  label: string;
  /** Chave canônica normalizada para deduplicação (ex: "projeto pop") */
  normalizedKey: string;
  /** Forma geométrica do nó (opcional, padrão 'concept' para mapa conceitual, ou formas de fluxograma) */
  nodeShape?: FlowchartNodeShape;
  /** Notas opcionais do usuário */
  notes?: string;
  /** Metadados de rastreabilidade da origem */
  sourceMeta?: {
    firstSeenLine?: number;
    createdManually?: boolean;
    rawShapeTag?: string;
  };
}

export interface ConceptRelationSemantic {
  /** Identificador único e estável da relação (ex: "rel-1") */
  id: RelationId;
  /** Índice sequencial na tabela (#) para ordenação determinística */
  orderIndex: number;
  /** ID do conceito de origem (Conceito A / Bloco Origem) */
  sourceId: ConceptId;
  /** Frase de ligação exibida sobre a conexão (ex: "propõe" ou "" em fluxogramas) */
  linkingPhrase: string;
  /** ID do conceito de destino (Conceito B / Bloco Destino) */
  targetId: ConceptId;
  /** Tipo canônico da relação */
  type: RelationType;
  /** Modalidade específica da transição de fluxo ('sequence' | 'conditional' | 'loop-back') */
  flowKind?: FlowTransitionKind;
  /** Texto original da coluna Tipo no Markdown (ex: "hierárquica" | "ligação cruzada" | "condicional") */
  rawType?: string;
  /** Metadados de rastreabilidade da linha original */
  sourceMeta?: {
    lineNumber?: number;
    rawRowText?: string;
    createdManually?: boolean;
  };
}

export interface SemanticGraphMetrics {
  totalConcepts: number;
  totalRelations: number;
  hierarchicalCount: number;
  crossLinkCount: number;
  rootConceptIds: ConceptId[];
  leafConceptIds: ConceptId[];
  isConnected: boolean;
  hasDirectedCycles: boolean;
  hasHierarchicalCycles: boolean;
  /** Profundidade hierárquica calculada a partir das raízes (0, 1, 2...) */
  hierarchicalDepthById: Record<ConceptId, number>;
  /** Contadores específicos para modo fluxograma (opcionais para retrocompatibilidade) */
  sequenceCount?: number;
  conditionalCount?: number;
  loopBackCount?: number;
}

export interface SemanticModel {
  /** Modo operacional do diagrama (padrão: 'concept-map') */
  diagramMode?: DiagramMode;
  /** Título do mapa conceitual ou fluxograma */
  title: string;
  /** Dicionário de conceitos indexado por ConceptId */
  concepts: Record<ConceptId, ConceptNodeSemantic>;
  /** Ordem determinística de IDs de conceitos */
  conceptOrder: ConceptId[];
  /** Dicionário de relações indexado por RelationId */
  relations: Record<RelationId, ConceptRelationSemantic>;
  /** Ordem determinística de IDs de relações (preserva a sequência #) */
  relationOrder: RelationId[];
}

/**
 * ============================================================================
 * 2. CAMADA VISUAL (Apresentação, Posicionamento, Fixação e Viewport)
 * ============================================================================
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface Dimensions2D {
  width: number;
  height: number;
}

export type HandlePosition = 'top' | 'right' | 'bottom' | 'left' | 'auto';

export interface NodeVisualStyle {
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  textColor?: string;
}

export interface ConceptNodeVisual {
  conceptId: ConceptId;
  /** Posição (x, y) no canvas */
  position: Point2D;
  /** Dimensões medidas ou redimensionadas manualmente pelo usuário */
  dimensions?: Dimensions2D;
  /**
   * Indica se o nó teve sua posição fixada (automaticamente ao ser movido
   * manualmente pelo usuário ou pelo botão de alfinete).
   * Nós com `pinned: true` têm sua posição preservada durante re-layouts parciais.
   */
  pinned: boolean;
  /** Indica se o nó foi redimensionado manualmente pelo usuário */
  customSize?: boolean;
  /** Camada hierárquica calculada pelo motor de layout (ex: 0 a 5) */
  computedLayer?: number;
  /** Estilo visual customizado opcional */
  style?: NodeVisualStyle;
  /** Forma geométrica visual do nó (sincronizada com o semântico) */
  nodeShape?: FlowchartNodeShape;
}

export type EdgeCurveType = 'bezier' | 'smoothstep' | 'straight';

export interface EdgeVisualStyle {
  strokeColor?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
}

export interface ConceptRelationVisual {
  relationId: RelationId;
  curveType: EdgeCurveType;
  sourceHandle?: HandlePosition;
  targetHandle?: HandlePosition;
  /** Posição paramétrica (t entre 0.15 e 0.85) ou deslocamento da frase de ligação */
  labelOffset?: {
    x?: number;
    y?: number;
    t?: number;
  };
  waypoints?: Point2D[];
  style?: EdgeVisualStyle;
  /** Modalidade visual do fluxo (opcional) */
  flowKind?: FlowTransitionKind;
}

export type LayoutAlgorithmType =
  | 'novak-backbone'
  | 'elk-layered'
  | 'dagre-hierarchical'
  | 'force-directed'
  | 'radial-tree';

export type CrossLinkVisibilityMode =
  | 'all'
  | 'hover-only'
  | 'highlight-cross'
  | 'hide-cross';

export interface LayoutSettings {
  algorithm: LayoutAlgorithmType;
  direction: 'TB' | 'LR';
  nodeSpacingX: number;
  nodeSpacingY: number;
  layerSpacing: number;
  /** Preservar nós com `pinned: true` ao recalcular o layout */
  respectPinnedNodes: boolean;
}

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export interface VisualModel {
  nodes: Record<ConceptId, ConceptNodeVisual>;
  edges: Record<RelationId, ConceptRelationVisual>;
  viewport: ViewportState;
  layoutSettings: LayoutSettings;
  crossLinkVisibility: CrossLinkVisibilityMode;
}

/**
 * ============================================================================
 * 2.1 CONTRATOS DE DADOS DO CANVAS (React Flow / UI Bridge)
 * ============================================================================
 */

export interface CanvasNodeData extends Record<string, unknown> {
  conceptId: ConceptId;
  label: string;
  pinned: boolean;
  computedLayer: number;
  isRoot: boolean;
  degree: number;
  isDimmed: boolean;
  isSearchMatch: boolean;
  customStyle?: NodeVisualStyle;
  /** Forma do nó para renderização no canvas */
  nodeShape?: FlowchartNodeShape;
  /** Modo do diagrama atual no canvas */
  diagramMode?: DiagramMode;
}

/** Alias para compatibilidade com o componente ConceptNode */
export type ConceptNodeData = CanvasNodeData;

export interface CanvasEdgeData extends Record<string, unknown> {
  relationId: RelationId;
  linkingPhrase: string;
  relationType: RelationType;
  curveType: EdgeCurveType;
  labelT: number;
  parallelIndex: number;
  parallelTotal: number;
  isDimmed: boolean;
  isHidden: boolean;
  isSearchMatch: boolean;
  /** Tipo refinado de transição do fluxo */
  flowKind?: FlowTransitionKind;
  /** Modo do diagrama para estilização contextual */
  diagramMode?: DiagramMode;
}

/** Alias para compatibilidade com o componente PropositionEdge */
export type PropositionEdgeData = CanvasEdgeData;

/**
 * ============================================================================
 * 3. DIAGNÓSTICOS DO PARSER E DOCUMENTO DE PERSISTÊNCIA COMPLETO
 * ============================================================================
 */

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export type DiagnosticCode =
  | 'EMPTY_FILE'
  | 'NO_TABLE_FOUND'
  | 'MISSING_HEADER'
  | 'EXTRA_COLUMNS_IGNORED'
  | 'MISSING_TYPE_DEFAULTED'
  | 'UNKNOWN_RELATION_TYPE'
  | 'EMPTY_LINKING_PHRASE'
  | 'MALFORMED_ROW_SKIPPED'
  | 'CASE_MISMATCH_CONCEPT'
  | 'DUPLICATE_RELATION_SKIPPED'
  | 'SELF_LOOP_DETECTED';

export interface ParseDiagnostic {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  message: string;
  lineNumber?: number;
  rawLine?: string;
}

export interface ParseResult {
  semantic: SemanticModel;
  metrics: SemanticGraphMetrics;
  diagnostics: ParseDiagnostic[];
  detectedColumnCount: number;
}

export interface ConceptMapDocument {
  schemaVersion: '1.0.0';
  metadata: {
    id: string;
    sourceFileName?: string;
    createdAt: string;
    updatedAt: string;
    originalColumnCount?: number;
    /** Modo operacional registrado nos metadados do documento */
    diagramMode?: DiagramMode;
  };
  semantic: SemanticModel;
  visual: VisualModel;
  parseDiagnostics?: ParseDiagnostic[];
}

/**
 * ============================================================================
 * 4. TYPE GUARDS E UTILITÁRIOS DE DOMÍNIO
 * ============================================================================
 */

export function isDiagramMode(value: unknown): value is DiagramMode {
  return value === 'concept-map' || value === 'flowchart';
}

export function isFlowchartNodeShape(value: unknown): value is FlowchartNodeShape {
  return (
    typeof value === 'string' &&
    (ALL_FLOWCHART_NODE_SHAPES as readonly string[]).includes(value)
  );
}

export function isFlowTransitionKind(value: unknown): value is FlowTransitionKind {
  return (
    value === 'sequence' ||
    value === 'conditional' ||
    value === 'loop-back'
  );
}
