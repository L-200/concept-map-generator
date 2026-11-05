/**
 * Identificadores únicos estáveis para Conceitos (nós) e Relações/Proposições (arestas).
 */
export type ConceptId = string;
export type RelationId = string;

/**
 * Tipos canônicos de relação no modelo semântico:
 * - 'hierarchical': relação de subordinação/estrutura hierárquica ("hierárquica")
 * - 'cross-link': relação transversal entre subárvores ("ligação cruzada")
 */
export type RelationType = 'hierarchical' | 'cross-link';

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
  /** Notas opcionais do usuário */
  notes?: string;
  /** Metadados de rastreabilidade da origem */
  sourceMeta?: {
    firstSeenLine?: number;
    createdManually?: boolean;
  };
}

export interface ConceptRelationSemantic {
  /** Identificador único e estável da relação (ex: "rel-1") */
  id: RelationId;
  /** Índice sequencial na tabela (#) para ordenação determinística */
  orderIndex: number;
  /** ID do conceito de origem (Conceito A) */
  sourceId: ConceptId;
  /** Frase de ligação exibida sobre a conexão (ex: "propõe") */
  linkingPhrase: string;
  /** ID do conceito de destino (Conceito B) */
  targetId: ConceptId;
  /** Tipo canônico da relação */
  type: RelationType;
  /** Texto original da coluna Tipo no Markdown (ex: "hierárquica" | "ligação cruzada") */
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
}

export interface SemanticModel {
  /** Título do mapa conceitual */
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
  };
  semantic: SemanticModel;
  visual: VisualModel;
  parseDiagnostics?: ParseDiagnostic[];
}
