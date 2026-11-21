import { temporal } from 'zundo';
import { create } from 'zustand';
import type {
  ArrowDirection,
  ConceptId,
  ConceptMapDocument,
  ConceptNodeVisual,
  CrossLinkVisibilityMode,
  DiagramMode,
  Dimensions2D,
  EdgeCurveType,
  FlowchartNodeShape,
  FlowTransitionKind,
  HandlePosition,
  LayoutSettings,
  NodeVisualStyle,
  ParseDiagnostic,
  Point2D,
  RelationId,
  RelationType,
  SemanticGraphMetrics,
  SemanticModel,
  ViewportState,
  VisualModel,
} from '../domain/types';
import {
  computeConceptMapLayout,
  computeEdgeLabelOffsets,
  computeSmartEdgeHandles,
  DEFAULT_LAYOUT_SETTINGS,
} from '../services/layout/layoutEngine';
import { estimateConceptNodeDimensions } from '../services/layout/nodeSizing';
import {
  cleanDisplayText,
  computeSemanticGraphMetrics,
  extractShapeFromLabel,
  normalizeConceptKey,
  parseConceptMapMarkdown,
} from '../services/parser/markdownParser';

export const AUTOSAVE_STORAGE_KEY = 'concept-map-autosave-v1';

const EMPTY_SEMANTIC: SemanticModel = {
  title: 'Mapa Conceitual',
  concepts: {},
  conceptOrder: [],
  relations: {},
  relationOrder: [],
};

const EMPTY_VISUAL: VisualModel = {
  nodes: {},
  edges: {},
  viewport: { x: 0, y: 0, zoom: 1 },
  layoutSettings: { ...DEFAULT_LAYOUT_SETTINGS },
  crossLinkVisibility: 'all',
};

export interface ConceptMapState {
  semantic: SemanticModel;
  visual: VisualModel;
  metrics: SemanticGraphMetrics;
  diagnostics: ParseDiagnostic[];
  sourceFileName: string;
  hasUnsavedChanges: boolean;
  lastSavedAt: string | null;
  isLayoutRunning: boolean;

  // Estado efêmero de UI (não entra no Undo/Redo)
  selectedNodeIds: ConceptId[];
  selectedEdgeIds: RelationId[];
  hoveredNodeId: ConceptId | null;
  searchQuery: string;

  // Ações de alternância de modo
  setDiagramMode: (mode: DiagramMode) => void;
  setFreeformCanvas: (enabled: boolean) => void;

  // Ações de carregamento e persistência
  createNewEmptyMap: (
    withStarterConcept?: boolean,
    mode?: DiagramMode,
    options?: { freeformCanvas?: boolean }
  ) => void;
  loadFromMarkdown: (markdownContent: string, fileName?: string) => Promise<void>;
  loadFromDocument: (doc: ConceptMapDocument) => void;
  exportDocument: () => ConceptMapDocument;
  saveDraftToLocalStorage: () => void;
  restoreDraftFromLocalStorage: () => boolean;
  markSaved: () => void;

  // Ações de manipulação de Conceitos (Nós)
  addConcept: (label?: string, position?: Point2D, shape?: FlowchartNodeShape) => ConceptId;
  addConnectedConcept: (
    sourceId: ConceptId,
    newConceptLabel?: string,
    linkingPhrase?: string,
    type?: RelationType,
    position?: Point2D,
    targetShape?: FlowchartNodeShape
  ) => { conceptId: ConceptId; relationId: RelationId } | null;
  addPropositionByNames: (
    sourceLabel: string,
    linkingPhrase: string,
    targetLabel: string,
    type?: RelationType,
    sourceShape?: FlowchartNodeShape,
    targetShape?: FlowchartNodeShape
  ) => RelationId | null;
  updateConceptLabel: (conceptId: ConceptId, newLabel: string) => void;
  updateConceptStyleAndNotes: (
    conceptId: ConceptId,
    updates: { notes?: string; style?: NodeVisualStyle }
  ) => void;
  updateNodeShape: (conceptId: ConceptId, shape: FlowchartNodeShape) => void;
  createDecisionBranches: (nodeId: ConceptId) => {
    simConceptId: ConceptId;
    naoConceptId: ConceptId;
    simRelationId: RelationId;
    naoRelationId: RelationId;
  } | null;
  moveNodes: (
    moves: Array<{ conceptId: ConceptId; position: Point2D }>,
    markPinned?: boolean
  ) => void;
  resizeNode: (conceptId: ConceptId, dimensions: Dimensions2D) => void;
  resetNodeSize: (conceptId: ConceptId) => void;
  toggleNodePin: (conceptId: ConceptId, pinned?: boolean) => void;
  setNodesPinned: (conceptIds: ConceptId[], pinned: boolean) => void;
  unpinAllNodes: () => void;

  // Ações de manipulação de Conexões (Relações / Proposições)
  addRelation: (
    sourceId: ConceptId,
    targetId: ConceptId,
    linkingPhrase?: string,
    type?: RelationType,
    handles?: {
      sourceHandle?: HandlePosition;
      targetHandle?: HandlePosition;
      manualHandles?: boolean;
    },
    arrowDirection?: ArrowDirection
  ) => RelationId | null;
  updateRelation: (
    relationId: RelationId,
    updates: {
      linkingPhrase?: string;
      type?: RelationType;
      sourceId?: ConceptId;
      targetId?: ConceptId;
      curveType?: EdgeCurveType;
      sourceHandle?: HandlePosition;
      targetHandle?: HandlePosition;
      manualHandles?: boolean;
      arrowDirection?: ArrowDirection;
      labelOffset?: { x?: number; y?: number; t?: number };
    }
  ) => void;
  reverseRelationDirection: (relationId: RelationId) => void;
  reconnectRelation: (
    relationId: RelationId,
    newSourceId: ConceptId,
    newTargetId: ConceptId,
    handles?: {
      sourceHandle?: HandlePosition;
      targetHandle?: HandlePosition;
      manualHandles?: boolean;
    }
  ) => void;

  // Exclusão atômica (com cascata de arestas incidentes)
  deleteElements: (conceptIds: ConceptId[], relationIds: RelationId[]) => void;

  // Layout automático e configurações visuais
  applyAutoLayout: (
    overrideSettings?: Partial<LayoutSettings>,
    forceResetPins?: boolean
  ) => Promise<void>;
  setCrossLinkVisibility: (mode: CrossLinkVisibilityMode) => void;
  setViewport: (viewport: ViewportState) => void;

  // Ações de seleção, foco e busca
  setSelection: (nodeIds: ConceptId[], edgeIds: RelationId[]) => void;
  setHoveredNodeId: (nodeId: ConceptId | null) => void;
  setSearchQuery: (query: string) => void;
}

function generateUniqueConceptId(
  label: string,
  existingConcepts: Record<ConceptId, unknown>
): ConceptId {
  const baseSlug = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const prefix = baseSlug ? `concept-${baseSlug}` : 'concept-novo';
  if (!existingConcepts[prefix]) return prefix;

  let counter = 2;
  while (existingConcepts[`${prefix}-${counter}`]) counter++;
  return `${prefix}-${counter}`;
}

function generateUniqueRelationId(
  existingRelations: Record<RelationId, unknown>
): RelationId {
  let counter = Object.keys(existingRelations).length + 1;
  while (existingRelations[`rel-${counter}`]) counter++;
  return `rel-${counter}`;
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
      return (globalThis as any).localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

let pendingDraftSnapshot: {
  semantic: SemanticModel;
  visual: VisualModel;
  sourceFileName: string;
  diagnostics: ParseDiagnostic[];
  timestamp: string;
} | null = null;

let draftDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function flushDraftSnapshot(): string | null {
  if (draftDebounceTimer) {
    clearTimeout(draftDebounceTimer);
    draftDebounceTimer = null;
  }
  if (!pendingDraftSnapshot) return null;

  const { semantic, visual, sourceFileName, diagnostics, timestamp } = pendingDraftSnapshot;
  pendingDraftSnapshot = null;

  const doc: ConceptMapDocument = {
    schemaVersion: '1.0.0',
    metadata: {
      id: 'local-draft',
      sourceFileName,
      createdAt: timestamp,
      updatedAt: timestamp,
      originalColumnCount: 5,
      diagramMode: semantic.diagramMode ?? 'concept-map',
    },
    semantic,
    visual,
    parseDiagnostics: diagnostics,
  };

  try {
    const storage = getLocalStorage();
    if (storage) {
      storage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(doc));
    }
  } catch {
    // Quota failure or restricted environment
  }

  return timestamp;
}

function persistDraftSnapshot(
  semantic: SemanticModel,
  visual: VisualModel,
  sourceFileName: string,
  diagnostics: ParseDiagnostic[],
  immediate = false
): string {
  const timestamp = new Date().toISOString();
  pendingDraftSnapshot = {
    semantic,
    visual,
    sourceFileName,
    diagnostics,
    timestamp,
  };

  if (immediate) {
    flushDraftSnapshot();
    return timestamp;
  }

  if (draftDebounceTimer) {
    clearTimeout(draftDebounceTimer);
  }
  draftDebounceTimer = setTimeout(() => {
    flushDraftSnapshot();
  }, 300);

  return timestamp;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    flushDraftSnapshot();
  });
}

const RELATION_RAW_TYPE_MAP: Record<RelationType, string> = {
  sequence: 'sequencial',
  conditional: 'condicional',
  'loop-back': 'retorno',
  hierarchical: 'hierárquica',
  'cross-link': 'ligação cruzada',
};

const getRelationRawType = (type: RelationType): string =>
  RELATION_RAW_TYPE_MAP[type] ?? 'ligação cruzada';

const getFlowKind = (type: RelationType, isFlowchart: boolean): FlowTransitionKind | undefined =>
  isFlowchart ? (type === 'conditional' || type === 'loop-back' ? type : 'sequence') : undefined;

const getDefaultCurveType = (isFlowchart: boolean, type?: RelationType): EdgeCurveType =>
  isFlowchart || type === 'hierarchical' ? 'smoothstep' : 'bezier';

function applySiblingLabelOffsets(
  updatedEdges: Record<RelationId, VisualModel['edges'][string]>,
  semantic: SemanticModel,
  sourceId: ConceptId,
  labelOffsets: Record<RelationId, { t?: number; x?: number; y?: number }>
): void {
  for (const rId of semantic.relationOrder) {
    if (
      semantic.relations[rId]?.sourceId === sourceId &&
      updatedEdges[rId] &&
      labelOffsets[rId]
    ) {
      updatedEdges[rId] = {
        ...updatedEdges[rId],
        labelOffset: labelOffsets[rId],
      };
    }
  }
}

const FLOWCHART_STARTER_NODES = [
  { id: 'concept-inicio', label: 'Início', shape: 'terminal' as const, y: 60, layer: 0 },
  { id: 'concept-processo', label: 'Processo', shape: 'process' as const, y: 180, layer: 1 },
  { id: 'concept-decisao', label: 'Decisão', shape: 'decision' as const, y: 310, layer: 2 },
  { id: 'concept-fim', label: 'Fim', shape: 'terminal' as const, y: 470, layer: 3 },
];

const FLOWCHART_STARTER_EDGES = [
  { id: 'rel-1', src: 'concept-inicio', tgt: 'concept-processo', phrase: '', type: 'sequence' as const, flowKind: 'sequence' as const },
  { id: 'rel-2', src: 'concept-processo', tgt: 'concept-decisao', phrase: '', type: 'sequence' as const, flowKind: 'sequence' as const },
  { id: 'rel-3', src: 'concept-decisao', tgt: 'concept-fim', phrase: 'Sim', type: 'conditional' as const, flowKind: 'conditional' as const },
];

function createStarterMap(mode: DiagramMode): {
  semantic: Pick<SemanticModel, 'concepts' | 'conceptOrder' | 'relations' | 'relationOrder'>;
  visual: Pick<VisualModel, 'nodes' | 'edges'>;
  selectedNodes: ConceptId[];
} {
  if (mode !== 'flowchart') {
    const id = generateUniqueConceptId('Conceito Principal', {});
    return {
      semantic: {
        concepts: { [id]: { id, label: 'Conceito Principal', normalizedKey: normalizeConceptKey('Conceito Principal'), nodeShape: 'concept', sourceMeta: { createdManually: true } } },
        conceptOrder: [id],
        relations: {},
        relationOrder: [],
      },
      visual: {
        nodes: { [id]: { conceptId: id, position: { x: 400, y: 120 }, dimensions: estimateConceptNodeDimensions('Conceito Principal'), pinned: false, customSize: false, computedLayer: 0, nodeShape: 'concept' } },
        edges: {},
      },
      selectedNodes: [id],
    };
  }

  const nodes: Record<ConceptId, ConceptNodeVisual> = {};
  const concepts: Record<ConceptId, SemanticModel['concepts'][string]> = {};
  const edges: Record<RelationId, VisualModel['edges'][string]> = {};
  const relations: Record<RelationId, SemanticModel['relations'][string]> = {};

  FLOWCHART_STARTER_NODES.forEach((item) => {
    concepts[item.id] = { id: item.id, label: item.label, normalizedKey: normalizeConceptKey(item.label), nodeShape: item.shape, sourceMeta: { createdManually: true } };
    nodes[item.id] = { conceptId: item.id, position: { x: 400, y: item.y }, dimensions: estimateConceptNodeDimensions(item.label, undefined, false, item.shape), pinned: false, customSize: false, computedLayer: item.layer, nodeShape: item.shape };
  });

  FLOWCHART_STARTER_EDGES.forEach((item, idx) => {
    relations[item.id] = { id: item.id, orderIndex: idx + 1, sourceId: item.src, linkingPhrase: item.phrase, targetId: item.tgt, type: item.type, flowKind: item.flowKind, rawType: getRelationRawType(item.type), sourceMeta: { createdManually: true } };
    edges[item.id] = { relationId: item.id, curveType: 'smoothstep', sourceHandle: 'bottom', targetHandle: 'top', labelOffset: { t: 0.5 }, flowKind: item.flowKind };
  });

  return {
    semantic: { concepts, conceptOrder: FLOWCHART_STARTER_NODES.map((n) => n.id), relations, relationOrder: FLOWCHART_STARTER_EDGES.map((e) => e.id) },
    visual: { nodes, edges },
    selectedNodes: ['concept-inicio'],
  };
}

interface HandleResolutionInput {
  sourceHandle?: HandlePosition;
  targetHandle?: HandlePosition;
  manualHandles?: boolean;
}

function resolveEdgeHandles(
  existingEdge: VisualModel['edges'][string] | undefined,
  input: HandleResolutionInput | undefined,
  smart: { sourceHandle?: HandlePosition; targetHandle?: HandlePosition } | undefined,
  isFreeform: boolean
): { sourceHandle: HandlePosition; targetHandle: HandlePosition; manualHandles: boolean } {
  const manualHandles = input?.manualHandles !== undefined
    ? input.manualHandles
    : (input?.sourceHandle === 'auto' && input?.targetHandle === 'auto')
      ? false
      : (Boolean(input?.sourceHandle && input.sourceHandle !== 'auto') || Boolean(input?.targetHandle && input.targetHandle !== 'auto'))
        ? true
        : (existingEdge?.manualHandles ?? isFreeform);

  const preserve = manualHandles || isFreeform;
  const resolve = (spec?: HandlePosition, exist?: HandlePosition, fallback?: HandlePosition, def: HandlePosition = 'bottom') => {
    if (spec !== undefined) return spec === 'auto' ? (fallback ?? def) : spec;
    if (preserve && exist && exist !== 'auto') return exist;
    return fallback ?? exist ?? def;
  };

  return {
    manualHandles,
    sourceHandle: resolve(input?.sourceHandle, existingEdge?.sourceHandle, smart?.sourceHandle, 'bottom'),
    targetHandle: resolve(input?.targetHandle, existingEdge?.targetHandle, smart?.targetHandle, 'top'),
  };
}

function updateIncidentSmartHandles(
  semantic: SemanticModel,
  nodes: Record<ConceptId, ConceptNodeVisual>,
  edges: Record<RelationId, VisualModel['edges'][string]>,
  affectedIds: Set<ConceptId>,
  direction: 'TB' | 'LR',
  isFreeform: boolean
): Record<RelationId, VisualModel['edges'][string]> {
  if (isFreeform) return edges;

  const isIncident = (relId: RelationId) => {
    const rel = semantic.relations[relId];
    return Boolean(rel && (affectedIds.has(rel.sourceId) || affectedIds.has(rel.targetId)));
  };

  if (!semantic.relationOrder.some((rId) => isIncident(rId) && !edges[rId]?.manualHandles)) {
    return edges;
  }

  const smartHandles = computeSmartEdgeHandles(semantic, nodes, direction);
  let nextEdges = edges;

  for (const relId of semantic.relationOrder) {
    if (!isIncident(relId)) continue;
    const prev = edges[relId];
    const smart = smartHandles[relId];
    if (prev && smart && !prev.manualHandles &&
      (prev.sourceHandle !== smart.sourceHandle || prev.targetHandle !== smart.targetHandle)
    ) {
      if (nextEdges === edges) nextEdges = { ...edges };
      nextEdges[relId] = { ...prev, sourceHandle: smart.sourceHandle, targetHandle: smart.targetHandle };
    }
  }

  return nextEdges;
}

function resolveOrCreateConceptNode(
  cleanLabel: string,
  shape: FlowchartNodeShape | undefined,
  rawShapeTag: string | undefined,
  concepts: Record<ConceptId, SemanticModel['concepts'][string]>,
  conceptOrder: ConceptId[],
  nodes: Record<ConceptId, ConceptNodeVisual>,
  calcPosition: () => Point2D,
  layer = 0
): ConceptId {
  const key = normalizeConceptKey(cleanLabel);
  const existingId = Object.values(concepts).find((c) => c.normalizedKey === key)?.id;
  if (existingId) {
    if (shape && !concepts[existingId]?.nodeShape) {
      concepts[existingId] = { ...concepts[existingId], nodeShape: shape };
      const prevVis = nodes[existingId];
      if (prevVis) {
        nodes[existingId] = {
          ...prevVis,
          nodeShape: shape,
          dimensions: estimateConceptNodeDimensions(
            cleanLabel,
            prevVis.dimensions,
            prevVis.customSize,
            shape
          ),
        };
      }
    }
    return existingId;
  }

  const id = generateUniqueConceptId(cleanLabel, concepts);
  const dims = estimateConceptNodeDimensions(cleanLabel, undefined, false, shape);

  concepts[id] = {
    id,
    label: cleanLabel,
    normalizedKey: key,
    nodeShape: shape,
    sourceMeta: {
      createdManually: true,
      ...(rawShapeTag ? { rawShapeTag } : {}),
    },
  };
  conceptOrder.push(id);

  nodes[id] = {
    conceptId: id,
    position: calcPosition(),
    dimensions: dims,
    pinned: false,
    customSize: false,
    computedLayer: layer,
    nodeShape: shape,
  };

  return id;
}

function createVisualEdgeRecord(
  relationId: RelationId,
  sourceId: ConceptId,
  semantic: SemanticModel,
  nodes: Record<ConceptId, ConceptNodeVisual>,
  edges: Record<RelationId, VisualModel['edges'][string]>,
  direction: 'TB' | 'LR',
  isFlowchart: boolean,
  type: RelationType,
  flowKind: FlowTransitionKind | undefined,
  handleInput?: HandleResolutionInput,
  arrowDirection: ArrowDirection = 'forward',
  isFreeform = false
): Record<RelationId, VisualModel['edges'][string]> {
  const smartHandles = computeSmartEdgeHandles(semantic, nodes, direction);
  const labelOffsets = computeEdgeLabelOffsets(semantic);
  const { sourceHandle, targetHandle, manualHandles } = resolveEdgeHandles(
    undefined,
    handleInput,
    smartHandles[relationId],
    isFreeform
  );

  const updatedEdges: Record<RelationId, VisualModel['edges'][string]> = {
    ...edges,
    [relationId]: {
      relationId,
      curveType: getDefaultCurveType(isFlowchart, type),
      sourceHandle,
      targetHandle,
      manualHandles,
      arrowDirection,
      labelOffset: labelOffsets[relationId] ?? { t: 0.5 },
      ...(flowKind ? { flowKind } : {}),
    },
  };

  applySiblingLabelOffsets(updatedEdges, semantic, sourceId, labelOffsets);
  return updatedEdges;
}

interface StoreMutation {
  semantic?: SemanticModel;
  visual?: VisualModel;
  metrics?: SemanticGraphMetrics;
  recomputeMetrics?: boolean;
  selectedNodeIds?: ConceptId[];
  selectedEdgeIds?: RelationId[];
  isLayoutRunning?: boolean;
}

function commitMutation(
  state: ConceptMapState,
  set: (partial: Partial<ConceptMapState>) => void,
  mutation: StoreMutation
): string {
  const semantic = mutation.semantic ?? state.semantic;
  const visual = mutation.visual ?? state.visual;
  const metrics =
    mutation.metrics ??
    (mutation.recomputeMetrics ? computeSemanticGraphMetrics(semantic) : state.metrics);

  const savedAt = persistDraftSnapshot(
    semantic,
    visual,
    state.sourceFileName,
    state.diagnostics
  );

  const update: Partial<ConceptMapState> = {
    visual,
    hasUnsavedChanges: true,
    lastSavedAt: savedAt,
  };

  if (mutation.semantic !== undefined) update.semantic = semantic;
  if (mutation.metrics !== undefined || mutation.recomputeMetrics) update.metrics = metrics;
  if (mutation.selectedNodeIds !== undefined) update.selectedNodeIds = mutation.selectedNodeIds;
  if (mutation.selectedEdgeIds !== undefined) update.selectedEdgeIds = mutation.selectedEdgeIds;
  if (mutation.isLayoutRunning !== undefined) update.isLayoutRunning = mutation.isLayoutRunning;

  set(update);
  return savedAt;
}

export const useConceptMapStore = create<ConceptMapState>()(
  temporal(
    (set, get) => ({
      semantic: EMPTY_SEMANTIC,
      visual: EMPTY_VISUAL,
      metrics: computeSemanticGraphMetrics(EMPTY_SEMANTIC),
      diagnostics: [],
      sourceFileName: 'novo-mapa.md',
      hasUnsavedChanges: false,
      lastSavedAt: null,
      isLayoutRunning: false,

      selectedNodeIds: [],
      selectedEdgeIds: [],
      hoveredNodeId: null,
      searchQuery: '',

      setDiagramMode: (mode: DiagramMode) => {
        const state = get();
        if (state.semantic.diagramMode === mode) return;

        const isFlowchart = mode === 'flowchart';
        const nextSemantic: SemanticModel = { ...state.semantic, diagramMode: mode };
        const smartHandles = computeSmartEdgeHandles(nextSemantic, state.visual.nodes, state.visual.layoutSettings.direction);
        const isFreeform = Boolean(state.visual.layoutSettings.freeformCanvas);
        const updatedEdges: Record<RelationId, VisualModel['edges'][string]> = {};

        for (const [rId, edge] of Object.entries(state.visual.edges)) {
          const rel = nextSemantic.relations[rId];
          const preserve = Boolean(edge.manualHandles || rel?.manualHandles || isFreeform);
          const smart = smartHandles[rId];
          updatedEdges[rId] = {
            ...edge,
            curveType: getDefaultCurveType(isFlowchart, rel?.type),
            sourceHandle: preserve ? edge.sourceHandle : (smart?.sourceHandle ?? edge.sourceHandle),
            targetHandle: preserve ? edge.targetHandle : (smart?.targetHandle ?? edge.targetHandle),
          };
        }

        commitMutation(state, set, {
          semantic: nextSemantic,
          visual: {
            ...state.visual,
            edges: updatedEdges,
            layoutSettings: {
              ...state.visual.layoutSettings,
              algorithm: isFlowchart && state.visual.layoutSettings.algorithm === 'novak-backbone' ? 'dagre-hierarchical' : state.visual.layoutSettings.algorithm,
            },
          },
          recomputeMetrics: true,
        });
      },

      setFreeformCanvas: (enabled: boolean) => {
        set({
          visual: { ...get().visual, layoutSettings: { ...get().visual.layoutSettings, freeformCanvas: enabled } },
          hasUnsavedChanges: true,
        });
      },

      createNewEmptyMap: (
        withStarterConcept = false,
        mode: DiagramMode = 'concept-map',
        options?: { freeformCanvas?: boolean }
      ) => {
        const isFlowchart = mode === 'flowchart';
        const defaultTitle = isFlowchart ? 'Novo Fluxograma' : 'Novo Mapa Conceitual';
        const defaultFileName = isFlowchart ? 'novo-fluxograma.md' : 'novo-mapa.md';
        const starter = withStarterConcept ? createStarterMap(mode) : null;

        const nextSemantic: SemanticModel = {
          ...EMPTY_SEMANTIC,
          diagramMode: mode,
          title: defaultTitle,
          ...(starter?.semantic ?? {}),
        };

        const nextVisual: VisualModel = {
          ...EMPTY_VISUAL,
          layoutSettings: {
            ...get().visual.layoutSettings,
            algorithm: isFlowchart ? 'dagre-hierarchical' : get().visual.layoutSettings.algorithm,
            freeformCanvas: options?.freeformCanvas ?? false,
          },
          ...(starter?.visual ?? {}),
        };

        const savedAt = nextSemantic.conceptOrder.length > 0
          ? persistDraftSnapshot(nextSemantic, nextVisual, defaultFileName, [])
          : new Date().toISOString();

        set({
          semantic: nextSemantic,
          visual: nextVisual,
          metrics: computeSemanticGraphMetrics(nextSemantic),
          diagnostics: [],
          sourceFileName: defaultFileName,
          hasUnsavedChanges: false,
          lastSavedAt: savedAt,
          isLayoutRunning: false,
          selectedNodeIds: starter ? starter.selectedNodes : [],
          selectedEdgeIds: [],
          hoveredNodeId: null,
          searchQuery: '',
        });

        useConceptMapStore.temporal.getState().clear();
      },

      loadFromMarkdown: async (markdownContent: string, fileName = 'exemplo.md') => {
        set({ isLayoutRunning: true });
        const parsed = parseConceptMapMarkdown(markdownContent);
        const hasFreeformDirective =
          /^---[\s\S]*?\n\s*(?:freeform|freeformCanvas|canvas-livre)\s*:\s*true\b[\s\S]*?\n---/im.test(markdownContent) ||
          /canvas-livre|freeform/i.test(fileName);
        const layoutSettings: LayoutSettings = {
          ...DEFAULT_LAYOUT_SETTINGS,
          algorithm: parsed.semantic.diagramMode === 'flowchart' ? 'dagre-hierarchical' : DEFAULT_LAYOUT_SETTINGS.algorithm,
          freeformCanvas: hasFreeformDirective,
        };
        const layoutResult = await computeConceptMapLayout(parsed.semantic, undefined, layoutSettings);
        const nextVisual: VisualModel = {
          nodes: layoutResult.nodes,
          edges: layoutResult.edges,
          viewport: { x: 0, y: 0, zoom: 1 },
          layoutSettings,
          crossLinkVisibility: 'all',
        };
        const savedAt = persistDraftSnapshot(parsed.semantic, nextVisual, fileName, parsed.diagnostics);

        set({
          semantic: parsed.semantic,
          visual: nextVisual,
          metrics: parsed.metrics,
          diagnostics: parsed.diagnostics,
          sourceFileName: fileName,
          hasUnsavedChanges: false,
          lastSavedAt: savedAt,
          isLayoutRunning: false,
          selectedNodeIds: [],
          selectedEdgeIds: [],
        });
        useConceptMapStore.temporal.getState().clear();
      },

      loadFromDocument: (doc: ConceptMapDocument) => {
        const fileName = doc.metadata.sourceFileName ?? 'mapa-salvo.cmap.json';
        const diagnostics = doc.parseDiagnostics ?? [];
        const savedAt = persistDraftSnapshot(doc.semantic, doc.visual, fileName, diagnostics);
        set({
          semantic: doc.semantic,
          visual: doc.visual,
          metrics: computeSemanticGraphMetrics(doc.semantic),
          diagnostics,
          sourceFileName: fileName,
          hasUnsavedChanges: false,
          lastSavedAt: savedAt,
          selectedNodeIds: [],
          selectedEdgeIds: [],
        });
        useConceptMapStore.temporal.getState().clear();
      },

      exportDocument: (): ConceptMapDocument => {
        const state = get();
        const now = new Date().toISOString();
        return {
          schemaVersion: '1.0.0',
          metadata: {
            id: 'concept-map-doc',
            sourceFileName: state.sourceFileName,
            createdAt: now,
            updatedAt: now,
            originalColumnCount: 5,
            diagramMode: state.semantic.diagramMode ?? 'concept-map',
          },
          semantic: state.semantic,
          visual: state.visual,
          parseDiagnostics: state.diagnostics,
        };
      },

      saveDraftToLocalStorage: () => {
        const { semantic, visual, sourceFileName, diagnostics } = get();
        set({ lastSavedAt: persistDraftSnapshot(semantic, visual, sourceFileName, diagnostics, true) });
      },

      restoreDraftFromLocalStorage: (): boolean => {
        try {
          flushDraftSnapshot();
          const raw = getLocalStorage()?.getItem(AUTOSAVE_STORAGE_KEY);
          if (!raw) return false;
          const doc = JSON.parse(raw) as ConceptMapDocument;
          if (!doc?.semantic?.concepts || !doc?.visual?.nodes) return false;
          get().loadFromDocument(doc);
          return true;
        } catch {
          return false;
        }
      },

      markSaved: () => {
        const { semantic, visual, sourceFileName, diagnostics } = get();
        set({ hasUnsavedChanges: false, lastSavedAt: persistDraftSnapshot(semantic, visual, sourceFileName, diagnostics, true) });
      },

      addConcept: (
        label = 'Novo Conceito',
        position?: Point2D,
        shape?: FlowchartNodeShape
      ): ConceptId => {
        const state = get();
        const cleanLabel = cleanDisplayText(label) || 'Novo Conceito';
        const id = generateUniqueConceptId(cleanLabel, state.semantic.concepts);
        const actualShape: FlowchartNodeShape =
          shape ?? (state.semantic.diagramMode === 'flowchart' ? 'process' : 'concept');
        const dimensions = estimateConceptNodeDimensions(
          cleanLabel,
          undefined,
          false,
          actualShape
        );

        const targetPos: Point2D = position ?? {
          x: Math.round(250 + (state.semantic.conceptOrder.length % 5) * 60),
          y: Math.round(180 + (state.semantic.conceptOrder.length % 5) * 50),
        };

        commitMutation(state, set, {
          semantic: {
            ...state.semantic,
            concepts: {
              ...state.semantic.concepts,
              [id]: { id, label: cleanLabel, normalizedKey: normalizeConceptKey(cleanLabel), nodeShape: actualShape, sourceMeta: { createdManually: true } },
            },
            conceptOrder: [...state.semantic.conceptOrder, id],
          },
          visual: {
            ...state.visual,
            nodes: {
              ...state.visual.nodes,
              [id]: { conceptId: id, position: targetPos, dimensions, pinned: false, customSize: false, computedLayer: 0, nodeShape: actualShape },
            },
          },
          recomputeMetrics: true,
          selectedNodeIds: [id],
          selectedEdgeIds: [],
        });

        return id;
      },

      addConnectedConcept: (
        sourceId: ConceptId,
        newConceptLabel?: string,
        linkingPhrase?: string,
        type?: RelationType,
        position?: Point2D,
        targetShape?: FlowchartNodeShape
      ) => {
        const state = get();
        const isFlowchart = state.semantic.diagramMode === 'flowchart';
        const sourceConcept = state.semantic.concepts[sourceId];
        const sourceNodeVis = state.visual.nodes[sourceId];
        if (!sourceConcept || !sourceNodeVis) return null;

        const defaultLabel = isFlowchart ? 'Nova Etapa' : 'Novo Conceito';
        const defaultPhrase = isFlowchart ? '' : 'relaciona-se com';
        const cleanLabel = cleanDisplayText(newConceptLabel ?? defaultLabel) || defaultLabel;
        const cleanPhrase = cleanDisplayText(linkingPhrase ?? defaultPhrase);
        const actualType: RelationType = type ?? (isFlowchart ? 'sequence' : 'hierarchical');
        const actualShape: FlowchartNodeShape = targetShape ?? (isFlowchart ? 'process' : 'concept');

        const newConceptId = generateUniqueConceptId(
          cleanLabel,
          state.semantic.concepts
        );
        const dimensions = estimateConceptNodeDimensions(
          cleanLabel,
          undefined,
          false,
          actualShape
        );

        // Conta quantos filhos já saem deste nó para distribuir lateralmente sem colisão
        const outgoingCount = state.semantic.relationOrder.filter(
          (rId) => state.semantic.relations[rId]?.sourceId === sourceId
        ).length;

        const isHorizontal = state.visual.layoutSettings.direction === 'LR';
        const spreadOffset =
          outgoingCount === 0
            ? 0
            : (outgoingCount % 2 === 1 ? 1 : -1) * Math.ceil(outgoingCount / 2) * (isHorizontal ? 100 : 210);

        const targetPos: Point2D = position
          ? { x: Math.round(position.x), y: Math.round(position.y) }
          : {
              x: Math.round(sourceNodeVis.position.x + (isHorizontal ? 260 : spreadOffset)),
              y: Math.round(sourceNodeVis.position.y + (isHorizontal ? spreadOffset : 150)),
            };

        const relationId = generateUniqueRelationId(state.semantic.relations);
        const orderIndex = state.semantic.relationOrder.length + 1;

        const flowKind = getFlowKind(actualType, isFlowchart);
        const rawType = getRelationRawType(actualType);

        const nextSemantic: SemanticModel = {
          ...state.semantic,
          concepts: {
            ...state.semantic.concepts,
            [newConceptId]: {
              id: newConceptId,
              label: cleanLabel,
              normalizedKey: normalizeConceptKey(cleanLabel),
              nodeShape: actualShape,
              sourceMeta: { createdManually: true },
            },
          },
          conceptOrder: [...state.semantic.conceptOrder, newConceptId],
          relations: {
            ...state.semantic.relations,
            [relationId]: {
              id: relationId,
              orderIndex,
              sourceId,
              linkingPhrase: cleanPhrase,
              targetId: newConceptId,
              type: actualType,
              flowKind,
              rawType,
              sourceMeta: { createdManually: true },
            },
          },
          relationOrder: [...state.semantic.relationOrder, relationId],
        };

        const nextNodes = {
          ...state.visual.nodes,
          [newConceptId]: {
            conceptId: newConceptId,
            position: targetPos,
            dimensions,
            pinned: false,
            customSize: false,
            computedLayer: (sourceNodeVis.computedLayer ?? 0) + 1,
            nodeShape: actualShape,
          },
        };

        const updatedEdges = createVisualEdgeRecord(
          relationId,
          sourceId,
          nextSemantic,
          nextNodes,
          state.visual.edges,
          state.visual.layoutSettings.direction,
          isFlowchart,
          actualType,
          flowKind,
          undefined,
          'forward',
          Boolean(state.visual.layoutSettings.freeformCanvas)
        );

        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: nextNodes,
          edges: updatedEdges,
        };

        commitMutation(state, set, {
          semantic: nextSemantic,
          visual: nextVisual,
          recomputeMetrics: true,
          selectedNodeIds: [newConceptId],
          selectedEdgeIds: [],
        });

        return { conceptId: newConceptId, relationId };
      },

      addPropositionByNames: (
        sourceLabel: string,
        linkingPhrase: string,
        targetLabel: string,
        type: RelationType = 'hierarchical',
        sourceShape?: FlowchartNodeShape,
        targetShape?: FlowchartNodeShape
      ): RelationId | null => {
        const state = get();
        const isFlowchart = state.semantic.diagramMode === 'flowchart';

        const extractedSource = extractShapeFromLabel(sourceLabel);
        const cleanSource = extractedSource.cleanLabel || cleanDisplayText(sourceLabel);
        const extractedTarget = extractShapeFromLabel(targetLabel);
        const cleanTarget = extractedTarget.cleanLabel || cleanDisplayText(targetLabel);
        const cleanPhrase =
          cleanDisplayText(linkingPhrase) || (isFlowchart ? '' : 'relaciona-se com');

        if (!cleanSource || !cleanTarget) return null;

        const nextConcepts = { ...state.semantic.concepts };
        const nextConceptOrder = [...state.semantic.conceptOrder];
        const nextNodes = { ...state.visual.nodes };

        const effectiveSourceShape: FlowchartNodeShape | undefined =
          sourceShape ??
          extractedSource.shape ??
          (isFlowchart ? 'process' : undefined);

        const sourceId = resolveOrCreateConceptNode(
          cleanSource,
          effectiveSourceShape,
          extractedSource.rawShapeTag,
          nextConcepts,
          nextConceptOrder,
          nextNodes,
          () => {
            const idx = nextConceptOrder.length;
            return {
              x: Math.round(320 + (idx % 4) * 220),
              y: Math.round(120 + Math.floor(idx / 4) * 150),
            };
          },
          0
        );

        const effectiveTargetShape: FlowchartNodeShape | undefined =
          targetShape ??
          extractedTarget.shape ??
          (isFlowchart ? 'process' : undefined);

        const srcNode = nextNodes[sourceId];
        const targetId = resolveOrCreateConceptNode(
          cleanTarget,
          effectiveTargetShape,
          extractedTarget.rawShapeTag,
          nextConcepts,
          nextConceptOrder,
          nextNodes,
          () => {
            const count = state.semantic.relationOrder.filter((rId) => state.semantic.relations[rId]?.sourceId === sourceId).length;
            const spreadX = count === 0 ? 0 : (count % 2 === 1 ? 1 : -1) * Math.ceil(count / 2) * 210;
            return {
              x: Math.round((srcNode?.position.x ?? 320) + spreadX),
              y: Math.round((srcNode?.position.y ?? 120) + 150),
            };
          },
          (srcNode?.computedLayer ?? 0) + 1
        );

        const relationId = generateUniqueRelationId(state.semantic.relations);
        const orderIndex = state.semantic.relationOrder.length + 1;

        const nextSemantic: SemanticModel = {
          ...state.semantic,
          concepts: nextConcepts,
          conceptOrder: nextConceptOrder,
          relations: {
            ...state.semantic.relations,
            [relationId]: {
              id: relationId,
              orderIndex,
              sourceId,
              linkingPhrase: cleanPhrase,
              targetId,
              type,
              rawType: type === 'hierarchical' ? 'hierárquica' : 'ligação cruzada',
              sourceMeta: { createdManually: true },
            },
          },
          relationOrder: [...state.semantic.relationOrder, relationId],
        };

        const updatedEdges = createVisualEdgeRecord(
          relationId,
          sourceId,
          nextSemantic,
          nextNodes,
          state.visual.edges,
          state.visual.layoutSettings.direction,
          isFlowchart,
          type,
          undefined
        );

        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: nextNodes,
          edges: updatedEdges,
        };

        commitMutation(state, set, {
          semantic: nextSemantic,
          visual: nextVisual,
          recomputeMetrics: true,
          selectedNodeIds: [targetId],
          selectedEdgeIds: [],
        });

        return relationId;
      },

      updateConceptLabel: (conceptId: ConceptId, newLabel: string) => {
        const state = get();
        const existing = state.semantic.concepts[conceptId];
        // Preserva espaços digitados entre palavras nos campos controlados (sem dar trim a cada tecla)
        const sanitizedLabel = newLabel.replace(/\r?\n/g, ' ');
        if (!existing || !sanitizedLabel.trim() || existing.label === sanitizedLabel) return;

        const prevNodeVisual = state.visual.nodes[conceptId];
        const nextDimensions = estimateConceptNodeDimensions(
          sanitizedLabel,
          prevNodeVisual?.dimensions,
          prevNodeVisual?.customSize,
          existing.nodeShape ?? prevNodeVisual?.nodeShape
        );

        commitMutation(state, set, {
          semantic: {
            ...state.semantic,
            concepts: {
              ...state.semantic.concepts,
              [conceptId]: { ...existing, label: sanitizedLabel, normalizedKey: normalizeConceptKey(sanitizedLabel) },
            },
          },
          visual: {
            ...state.visual,
            nodes: {
              ...state.visual.nodes,
              [conceptId]: { ...prevNodeVisual, dimensions: nextDimensions },
            },
          },
        });
      },

      updateConceptStyleAndNotes: (
        conceptId: ConceptId,
        updates: { notes?: string; style?: NodeVisualStyle }
      ) => {
        const state = get();
        const concept = state.semantic.concepts[conceptId];
        const nodeVis = state.visual.nodes[conceptId];
        if (!concept || !nodeVis) return;

        commitMutation(state, set, {
          semantic: updates.notes !== undefined
            ? { ...state.semantic, concepts: { ...state.semantic.concepts, [conceptId]: { ...concept, notes: updates.notes } } }
            : state.semantic,
          visual: updates.style !== undefined
            ? { ...state.visual, nodes: { ...state.visual.nodes, [conceptId]: { ...nodeVis, style: { ...nodeVis.style, ...updates.style } } } }
            : state.visual,
        });
      },

      updateNodeShape: (conceptId: ConceptId, shape: FlowchartNodeShape) => {
        const state = get();
        const concept = state.semantic.concepts[conceptId];
        const nodeVis = state.visual.nodes[conceptId];
        if (!concept || !nodeVis) {
          return;
        }

        const nextSemantic: SemanticModel = {
          ...state.semantic,
          concepts: {
            ...state.semantic.concepts,
            [conceptId]: {
              ...concept,
              nodeShape: shape,
            },
          },
        };

        const nextDimensions = estimateConceptNodeDimensions(
          concept.label,
          nodeVis.dimensions,
          false,
          shape
        );

        const updatedNodes = {
          ...state.visual.nodes,
          [conceptId]: {
            ...nodeVis,
            nodeShape: shape,
            dimensions: nextDimensions,
            customSize: false,
          },
        };

        const nextEdges = updateIncidentSmartHandles(
          nextSemantic,
          updatedNodes,
          state.visual.edges,
          new Set([conceptId]),
          state.visual.layoutSettings.direction,
          Boolean(state.visual.layoutSettings.freeformCanvas)
        );

        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: updatedNodes,
          edges: nextEdges,
        };

        commitMutation(state, set, {
          semantic: nextSemantic,
          visual: nextVisual,
        });
      },

      createDecisionBranches: (nodeId: ConceptId) => {
        const state = get();
        const sourceConcept = state.semantic.concepts[nodeId];
        const sourceNodeVis = state.visual.nodes[nodeId];
        if (!sourceConcept || !sourceNodeVis) return null;

        const isHorizontal = state.visual.layoutSettings.direction === 'LR';
        const width = sourceNodeVis.dimensions?.width ?? 160;
        const height = sourceNodeVis.dimensions?.height ?? 80;

        const branchSpecs = [
          {
            phrase: 'Sim',
            label: 'Ação (Sim)',
            pos: isHorizontal
              ? { x: Math.round(sourceNodeVis.position.x + width + 120), y: Math.round(sourceNodeVis.position.y) }
              : { x: Math.round(sourceNodeVis.position.x), y: Math.round(sourceNodeVis.position.y + height + 130) },
            handles: isHorizontal ? { src: 'right' as const, tgt: 'left' as const } : { src: 'bottom' as const, tgt: 'top' as const },
            layer: (sourceNodeVis.computedLayer ?? 0) + 1,
          },
          {
            phrase: 'Não',
            label: 'Ação (Não)',
            pos: isHorizontal
              ? { x: Math.round(sourceNodeVis.position.x), y: Math.round(sourceNodeVis.position.y + height + 120) }
              : { x: Math.round(sourceNodeVis.position.x + width + 110), y: Math.round(sourceNodeVis.position.y) },
            handles: isHorizontal ? { src: 'bottom' as const, tgt: 'top' as const } : { src: 'right' as const, tgt: 'top' as const },
            layer: sourceNodeVis.computedLayer ?? 0,
          },
        ];

        const nextConcepts = {
          ...state.semantic.concepts,
          [nodeId]: { ...sourceConcept, nodeShape: 'decision' as FlowchartNodeShape },
        };
        const nextNodes: Record<ConceptId, ConceptNodeVisual> = {
          ...state.visual.nodes,
          [nodeId]: {
            ...sourceNodeVis,
            nodeShape: 'decision',
            dimensions:
              sourceNodeVis.nodeShape === 'decision'
                ? sourceNodeVis.dimensions
                : estimateConceptNodeDimensions(sourceConcept.label, sourceNodeVis.dimensions, false, 'decision'),
          },
        };
        const nextConceptOrder = [...state.semantic.conceptOrder];
        const nextRelations = { ...state.semantic.relations };
        const nextRelationOrder = [...state.semantic.relationOrder];
        const nextEdges = { ...state.visual.edges };

        const createdIds: ConceptId[] = [];
        const createdRelIds: RelationId[] = [];

        for (const branch of branchSpecs) {
          const cId = generateUniqueConceptId(branch.label, nextConcepts);
          createdIds.push(cId);
          nextConcepts[cId] = {
            id: cId,
            label: branch.label,
            normalizedKey: normalizeConceptKey(branch.label),
            nodeShape: 'process',
            sourceMeta: { createdManually: true },
          };
          nextConceptOrder.push(cId);
          nextNodes[cId] = {
            conceptId: cId,
            position: branch.pos,
            dimensions: estimateConceptNodeDimensions(branch.label, undefined, false, 'process'),
            pinned: false,
            customSize: false,
            computedLayer: branch.layer,
            nodeShape: 'process',
          };

          const rId = generateUniqueRelationId(nextRelations);
          createdRelIds.push(rId);
          nextRelations[rId] = {
            id: rId,
            orderIndex: nextRelationOrder.length + 1,
            sourceId: nodeId,
            linkingPhrase: branch.phrase,
            targetId: cId,
            type: 'conditional',
            flowKind: 'conditional',
            rawType: 'condicional',
            sourceMeta: { createdManually: true },
          };
          nextRelationOrder.push(rId);
          nextEdges[rId] = {
            relationId: rId,
            curveType: 'smoothstep',
            sourceHandle: branch.handles.src,
            targetHandle: branch.handles.tgt,
            labelOffset: { t: 0.5 },
            flowKind: 'conditional',
          };
        }

        const nextSemantic: SemanticModel = {
          ...state.semantic,
          concepts: nextConcepts,
          conceptOrder: nextConceptOrder,
          relations: nextRelations,
          relationOrder: nextRelationOrder,
        };
        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: nextNodes,
          edges: nextEdges,
        };

        commitMutation(state, set, {
          semantic: nextSemantic,
          visual: nextVisual,
          recomputeMetrics: true,
          selectedNodeIds: createdIds,
          selectedEdgeIds: createdRelIds,
        });

        return {
          simConceptId: createdIds[0],
          naoConceptId: createdIds[1],
          simRelationId: createdRelIds[0],
          naoRelationId: createdRelIds[1],
        };
      },

      moveNodes: (
        moves: Array<{ conceptId: ConceptId; position: Point2D }>,
        markPinned = true
      ) => {
        if (moves.length === 0) return;
        const state = get();
        const updatedNodes = { ...state.visual.nodes };

        for (const { conceptId, position } of moves) {
          const prev = updatedNodes[conceptId];
          if (!prev) continue;
          updatedNodes[conceptId] = {
            ...prev,
            position: {
              x: Math.round(position.x),
              y: Math.round(position.y),
            },
            // Conforme decisão #3 aprovada pelo usuário: mover manualmente marca o nó como pinned=true
            pinned: markPinned ? true : prev.pinned,
          };
        }

        const nextEdges = updateIncidentSmartHandles(
          state.semantic,
          updatedNodes,
          state.visual.edges,
          new Set(moves.map((m) => m.conceptId)),
          state.visual.layoutSettings.direction,
          Boolean(state.visual.layoutSettings.freeformCanvas)
        );

        const nextVisual: VisualModel = {
          ...state.visual,
          nodes: updatedNodes,
          edges: nextEdges,
        };

        commitMutation(state, set, {
          visual: nextVisual,
        });
      },

      resizeNode: (conceptId: ConceptId, dimensions: Dimensions2D) => {
        const state = get();
        const prev = state.visual.nodes[conceptId];
        if (!prev) return;

        commitMutation(state, set, {
          visual: {
            ...state.visual,
            nodes: {
              ...state.visual.nodes,
              [conceptId]: {
                ...prev,
                dimensions: { width: Math.max(100, Math.round(dimensions.width)), height: Math.max(40, Math.round(dimensions.height)) },
                customSize: true,
              },
            },
          },
        });
      },

      resetNodeSize: (conceptId: ConceptId) => {
        const state = get();
        const concept = state.semantic.concepts[conceptId];
        const prev = state.visual.nodes[conceptId];
        if (!concept || !prev) return;

        commitMutation(state, set, {
          visual: {
            ...state.visual,
            nodes: {
              ...state.visual.nodes,
              [conceptId]: {
                ...prev,
                dimensions: estimateConceptNodeDimensions(concept.label, undefined, false, concept.nodeShape ?? prev.nodeShape),
                customSize: false,
              },
            },
          },
        });
      },

      toggleNodePin: (conceptId: ConceptId, pinned?: boolean) => {
        const prev = get().visual.nodes[conceptId];
        if (!prev) return;
        get().setNodesPinned([conceptId], pinned !== undefined ? pinned : !prev.pinned);
      },

      setNodesPinned: (conceptIds: ConceptId[], pinned: boolean) => {
        if (conceptIds.length === 0) return;
        const state = get();
        const updatedNodes = { ...state.visual.nodes };
        for (const id of conceptIds) {
          if (updatedNodes[id]) updatedNodes[id] = { ...updatedNodes[id], pinned };
        }
        commitMutation(state, set, { visual: { ...state.visual, nodes: updatedNodes } });
      },

      unpinAllNodes: () => {
        get().setNodesPinned(Object.keys(get().visual.nodes), false);
      },

      addRelation: (
        sourceId: ConceptId,
        targetId: ConceptId,
        linkingPhrase?: string,
        type: RelationType = 'hierarchical',
        handles?: {
          sourceHandle?: HandlePosition;
          targetHandle?: HandlePosition;
          manualHandles?: boolean;
        },
        arrowDirection: ArrowDirection = 'forward'
      ): RelationId | null => {
        const state = get();
        if (!state.semantic.concepts[sourceId] || !state.semantic.concepts[targetId]) {
          return null;
        }

        const isFlowchart = state.semantic.diagramMode === 'flowchart';
        const isFreeform = Boolean(state.visual.layoutSettings.freeformCanvas);
        const relationId = generateUniqueRelationId(state.semantic.relations);
        const orderIndex = state.semantic.relationOrder.length + 1;
        const defaultPhrase = isFlowchart ? '' : 'relaciona-se com';
        const cleanPhrase = cleanDisplayText(linkingPhrase ?? defaultPhrase);
        const actualType: RelationType =
          isFlowchart && type === 'hierarchical' ? 'sequence' : type;

        const flowKind = getFlowKind(actualType, isFlowchart);
        const rawType = getRelationRawType(actualType);
        const { manualHandles: isManual } = resolveEdgeHandles(
          undefined,
          handles,
          undefined,
          isFreeform
        );

        const nextSemantic: SemanticModel = {
          ...state.semantic,
          relations: {
            ...state.semantic.relations,
            [relationId]: {
              id: relationId,
              orderIndex,
              sourceId,
              linkingPhrase: cleanPhrase,
              targetId,
              type: actualType,
              flowKind,
              rawType,
              manualHandles: isManual,
              arrowDirection,
              sourceMeta: {
                createdManually: true,
              },
            },
          },
          relationOrder: [...state.semantic.relationOrder, relationId],
        };

        const updatedEdges = createVisualEdgeRecord(
          relationId,
          sourceId,
          nextSemantic,
          state.visual.nodes,
          state.visual.edges,
          state.visual.layoutSettings.direction,
          isFlowchart,
          actualType,
          flowKind,
          handles,
          arrowDirection,
          isFreeform
        );

        const nextVisual: VisualModel = {
          ...state.visual,
          edges: updatedEdges,
        };

        commitMutation(state, set, {
          semantic: nextSemantic,
          visual: nextVisual,
          recomputeMetrics: true,
          selectedNodeIds: [],
          selectedEdgeIds: [relationId],
        });

        return relationId;
      },

      updateRelation: (
        relationId: RelationId,
        updates: {
          linkingPhrase?: string;
          type?: RelationType;
          sourceId?: ConceptId;
          targetId?: ConceptId;
          curveType?: EdgeCurveType;
          sourceHandle?: HandlePosition;
          targetHandle?: HandlePosition;
          manualHandles?: boolean;
          arrowDirection?: ArrowDirection;
          labelOffset?: { x?: number; y?: number; t?: number };
        }
      ) => {
        const state = get();
        const existingRel = state.semantic.relations[relationId];
        const existingEdge = state.visual.edges[relationId];
        if (!existingRel || !existingEdge) return;

        const isFlowchart = state.semantic.diagramMode === 'flowchart';
        const isFreeform = Boolean(state.visual.layoutSettings.freeformCanvas);

        const nextType = updates.type ?? existingRel.type;
        const nextSourceId =
          updates.sourceId && state.semantic.concepts[updates.sourceId]
            ? updates.sourceId
            : existingRel.sourceId;
        const nextTargetId =
          updates.targetId && state.semantic.concepts[updates.targetId]
            ? updates.targetId
            : existingRel.targetId;

        const nextPhrase =
          updates.linkingPhrase !== undefined
            ? updates.linkingPhrase.replace(/\r?\n/g, ' ')
            : existingRel.linkingPhrase;

        const flowKind = getFlowKind(nextType, isFlowchart);
        const rawType = getRelationRawType(nextType);
        const nextArrowDirection: ArrowDirection =
          updates.arrowDirection ??
          existingEdge.arrowDirection ??
          existingRel.arrowDirection ??
          'forward';

        const { manualHandles } = resolveEdgeHandles(existingEdge, updates, undefined, isFreeform);

        const nextSemantic: SemanticModel = {
          ...state.semantic,
          relations: {
            ...state.semantic.relations,
            [relationId]: {
              ...existingRel,
              sourceId: nextSourceId,
              targetId: nextTargetId,
              linkingPhrase: nextPhrase,
              type: nextType,
              flowKind,
              rawType,
              manualHandles,
              arrowDirection: nextArrowDirection,
            },
          },
        };

        const smartHandles = computeSmartEdgeHandles(
          nextSemantic,
          state.visual.nodes,
          state.visual.layoutSettings.direction
        );

        const { sourceHandle, targetHandle } = resolveEdgeHandles(
          existingEdge,
          updates,
          smartHandles[relationId],
          isFreeform
        );

        const defaultCurveForType = getDefaultCurveType(isFlowchart, nextType);
        const nextCurveType =
          updates.curveType ??
          (updates.type ? defaultCurveForType : existingEdge.curveType);

        const nextVisual: VisualModel = {
          ...state.visual,
          edges: {
            ...state.visual.edges,
            [relationId]: {
              ...existingEdge,
              curveType: nextCurveType,
              sourceHandle,
              targetHandle,
              manualHandles,
              arrowDirection: nextArrowDirection,
              labelOffset: updates.labelOffset
                ? { ...existingEdge.labelOffset, ...updates.labelOffset }
                : existingEdge.labelOffset,
              flowKind: flowKind ?? existingEdge.flowKind,
            },
          },
        };

        const topologyChanged =
          (updates.type !== undefined && updates.type !== existingRel.type) ||
          (updates.sourceId !== undefined && updates.sourceId !== existingRel.sourceId) ||
          (updates.targetId !== undefined && updates.targetId !== existingRel.targetId);

        commitMutation(state, set, {
          semantic: nextSemantic,
          visual: nextVisual,
          recomputeMetrics: topologyChanged,
        });
      },

      reverseRelationDirection: (relationId: RelationId) => {
        const state = get();
        const rel = state.semantic.relations[relationId];
        const edge = state.visual.edges[relationId];
        if (!rel || !edge) return;

        const isManual = Boolean(edge.manualHandles || state.visual.layoutSettings.freeformCanvas);
        get().updateRelation(relationId, {
          sourceId: rel.targetId,
          targetId: rel.sourceId,
          ...(isManual
            ? { sourceHandle: edge.targetHandle, targetHandle: edge.sourceHandle, manualHandles: true }
            : {}),
        });
      },

      reconnectRelation: (
        relationId: RelationId,
        newSourceId: ConceptId,
        newTargetId: ConceptId,
        handles?: {
          sourceHandle?: HandlePosition;
          targetHandle?: HandlePosition;
          manualHandles?: boolean;
        }
      ) => {
        get().updateRelation(relationId, {
          sourceId: newSourceId,
          targetId: newTargetId,
          sourceHandle: handles?.sourceHandle,
          targetHandle: handles?.targetHandle,
          manualHandles: handles?.manualHandles ?? true,
        });
      },

      deleteElements: (conceptIds: ConceptId[], relationIds: RelationId[]) => {
        if (conceptIds.length === 0 && relationIds.length === 0) return;

        const state = get();
        const deletedConceptsSet = new Set(conceptIds);
        const deletedRelationsSet = new Set(relationIds);

        // Cascata: qualquer relação incidente a um conceito excluído também é removida
        for (const relId of state.semantic.relationOrder) {
          const rel = state.semantic.relations[relId];
          if (rel && (deletedConceptsSet.has(rel.sourceId) || deletedConceptsSet.has(rel.targetId))) {
            deletedRelationsSet.add(relId);
          }
        }

        const nextConcepts = { ...state.semantic.concepts };
        const nextNodes = { ...state.visual.nodes };
        deletedConceptsSet.forEach((cId) => {
          delete nextConcepts[cId];
          delete nextNodes[cId];
        });

        const nextRelations = { ...state.semantic.relations };
        const nextEdges = { ...state.visual.edges };
        deletedRelationsSet.forEach((rId) => {
          delete nextRelations[rId];
          delete nextEdges[rId];
        });

        const nextConceptOrder = state.semantic.conceptOrder.filter((id) => !deletedConceptsSet.has(id));
        const nextRelationOrder = state.semantic.relationOrder.filter((id) => !deletedRelationsSet.has(id));

        // Renumera orderIndex sequencialmente
        nextRelationOrder.forEach((id, idx) => {
          if (nextRelations[id]) nextRelations[id] = { ...nextRelations[id], orderIndex: idx + 1 };
        });

        commitMutation(state, set, {
          semantic: { ...state.semantic, concepts: nextConcepts, conceptOrder: nextConceptOrder, relations: nextRelations, relationOrder: nextRelationOrder },
          visual: { ...state.visual, nodes: nextNodes, edges: nextEdges },
          recomputeMetrics: true,
          selectedNodeIds: state.selectedNodeIds.filter((id) => !deletedConceptsSet.has(id)),
          selectedEdgeIds: state.selectedEdgeIds.filter((id) => !deletedRelationsSet.has(id)),
        });
      },

      applyAutoLayout: async (
        overrideSettings?: Partial<LayoutSettings>,
        forceResetPins = false
      ) => {
        const state = get();
        set({ isLayoutRunning: true });

        const effectiveVisual: VisualModel = forceResetPins
          ? {
              ...state.visual,
              nodes: Object.fromEntries(
                Object.entries(state.visual.nodes).map(([k, v]) => [k, { ...v, pinned: false }])
              ),
            }
          : state.visual;

        const nextSettings: LayoutSettings = { ...state.visual.layoutSettings, ...overrideSettings };
        const layoutResult = await computeConceptMapLayout(state.semantic, effectiveVisual, nextSettings);

        commitMutation(state, set, {
          visual: { ...state.visual, nodes: layoutResult.nodes, edges: layoutResult.edges, layoutSettings: nextSettings },
          isLayoutRunning: false,
        });
      },

      setCrossLinkVisibility: (mode: CrossLinkVisibilityMode) => {
        set({ visual: { ...get().visual, crossLinkVisibility: mode } });
      },

      setViewport: (viewport: ViewportState) => {
        set({ visual: { ...get().visual, viewport } });
      },

      setSelection: (nodeIds: ConceptId[], edgeIds: RelationId[]) => {
        const state = get();
        const sameNodes =
          state.selectedNodeIds.length === nodeIds.length &&
          state.selectedNodeIds.every((id, idx) => id === nodeIds[idx]);
        const sameEdges =
          state.selectedEdgeIds.length === edgeIds.length &&
          state.selectedEdgeIds.every((id, idx) => id === edgeIds[idx]);

        if (!sameNodes || !sameEdges) {
          set({ selectedNodeIds: nodeIds, selectedEdgeIds: edgeIds });
        }
      },

      setHoveredNodeId: (nodeId: ConceptId | null) => {
        if (get().hoveredNodeId === nodeId) return;
        set({ hoveredNodeId: nodeId });
      },

      setSearchQuery: (query: string) => {
        set({ searchQuery: query });
      },
    }),
    {
      limit: 60,
      partialize: (state) => ({
        semantic: state.semantic,
        visual: state.visual,
        metrics: state.metrics,
      }),
      equality: (pastState, currentState) =>
        pastState.semantic === currentState.semantic &&
        pastState.visual.nodes === currentState.visual.nodes &&
        pastState.visual.edges === currentState.visual.edges,
    }
  )
);
