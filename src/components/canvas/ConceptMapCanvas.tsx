import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type IsValidConnection,
  type Node,
  type NodeChange,
  type OnConnectEnd,
  type OnConnectStart,
  type OnMoveEnd,
  type OnNodeDrag,
  type OnReconnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Eye,
  FileUp,
  Network,
  PinOff,
  Plus,
  RefreshCw,
  Shapes,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConceptId,
  CrossLinkVisibilityMode,
  HandlePosition,
  Point2D,
  RelationId,
} from '../../domain/types';
import { parseAndValidateJsonDocument } from '../../services/export/fileExporter';
import { classifyCondition } from '../../services/layout/geometry';
import {
  fetchDefaultWorkspaceInput,
  fetchFlowchartWorkspaceInput,
  fetchFreeformWorkspaceInput,
} from '../../services/workspaceBridge';
import { useConceptMapStore } from '../../store/useConceptMapStore';
import { ConceptNode, type ConceptFlowNode } from './ConceptNode';
import { PropositionEdge, type PropositionFlowEdge } from './PropositionEdge';

const nodeTypes = {
  concept: ConceptNode,
};

const edgeTypes = {
  proposition: PropositionEdge,
};

const ARROW_MARKER_CACHE = new Map<
  string,
  { type: MarkerType; width: number; height: number; color: string }
>();

function getArrowMarker(color: string) {
  let marker = ARROW_MARKER_CACHE.get(color);
  if (!marker) {
    marker = {
      type: MarkerType.ArrowClosed,
      width: 18,
      height: 18,
      color,
    };
    ARROW_MARKER_CACHE.set(color, marker);
  }
  return marker;
}

const CARDINAL_SET = new Set(['top', 'right', 'bottom', 'left']);
function sanitizeHandle(handleId: string | null | undefined): HandlePosition | undefined {
  return handleId && CARDINAL_SET.has(handleId) ? (handleId as HandlePosition) : undefined;
}

interface PathwayCardDef {
  key: string;
  borderCls: string;
  titleCls: string;
  icon: React.ReactNode;
  title: string;
  badge: string;
  badgeCls: string;
  desc: string;
  createTestId: string;
  createLabel: string;
  createBtnCls: string;
  exampleTestId: string;
  exampleLabel: string;
  exampleBorderCls: string;
  exampleIconColor: string;
  blankBtn?: { testId: string; label: string };
}

const WELCOME_PATHWAYS: PathwayCardDef[] = [
  {
    key: 'concept-map',
    borderCls: 'border-blue-100 bg-gradient-to-b from-blue-50/50 to-white',
    titleCls: 'text-blue-900',
    icon: <Network className="h-4 w-4 text-blue-600" />,
    title: 'Mapa Conceitual',
    badge: 'Novak',
    badgeCls: 'bg-blue-100 text-blue-700',
    desc: 'Estrutura hierárquica baseada em proposições explícitas (Conceito A → Frase de Ligação → Conceito B).',
    createTestId: 'create-concept-map-btn',
    createLabel: 'Iniciar Mapa Conceitual',
    createBtnCls: 'bg-blue-600 hover:bg-blue-700',
    exampleTestId: 'load-concept-map-example-btn',
    exampleLabel: 'Carregar exemplo.md',
    exampleBorderCls: 'border-blue-200 text-blue-800 hover:bg-blue-50',
    exampleIconColor: 'text-blue-600',
  },
  {
    key: 'flowchart',
    borderCls: 'border-indigo-100 bg-gradient-to-b from-indigo-50/50 to-white',
    titleCls: 'text-indigo-900',
    icon: <Workflow className="h-4 w-4 text-indigo-600" />,
    title: 'Fluxograma',
    badge: 'Processos',
    badgeCls: 'bg-indigo-100 text-indigo-700',
    desc: 'Fluxos de trabalho com blocos de início/fim, tarefas, desvios condicionais (Sim/Não) e rotinas.',
    createTestId: 'create-flowchart-btn',
    createLabel: 'Iniciar Fluxograma',
    createBtnCls: 'bg-indigo-600 hover:bg-indigo-700',
    exampleTestId: 'load-flowchart-example-btn',
    exampleLabel: 'Carregar exemplo-fluxograma.md',
    exampleBorderCls: 'border-indigo-200 text-indigo-800 hover:bg-indigo-50',
    exampleIconColor: 'text-indigo-600',
  },
  {
    key: 'freeform',
    borderCls: 'border-emerald-100 bg-gradient-to-b from-emerald-50/50 to-white',
    titleCls: 'text-emerald-900',
    icon: <Shapes className="h-4 w-4 text-emerald-600" />,
    title: 'Canvas Livre',
    badge: 'Freeform',
    badgeCls: 'bg-emerald-100 text-emerald-700',
    desc: 'Diagramação livre sem restrições heurísticas ou hierárquicas. Conecte qualquer ponto cardeal (topo, direita, base, esquerda) em qualquer formato.',
    createTestId: 'create-freeform-btn',
    createLabel: 'Iniciar Canvas Livre',
    createBtnCls: 'bg-emerald-600 hover:bg-emerald-700',
    exampleTestId: 'load-freeform-example-btn',
    exampleLabel: 'Carregar exemplo-canvas-livre',
    exampleBorderCls: 'border-emerald-200 text-emerald-800 hover:bg-emerald-50',
    exampleIconColor: 'text-emerald-600',
    blankBtn: { testId: 'load-freeform-blank-btn', label: 'Canvas em Branco' },
  },
];

function miniMapNodeColor(node: Node): string {
  const data = node.data as ConceptFlowNode['data'] | undefined;
  if (data?.isRoot) return '#2563eb';
  if (data?.pinned) return '#f59e0b';
  return '#64748b';
}

export function ConceptMapCanvas() {
  const semantic = useConceptMapStore((s) => s.semantic);
  const visual = useConceptMapStore((s) => s.visual);
  const metrics = useConceptMapStore((s) => s.metrics);
  const selectedNodeIds = useConceptMapStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useConceptMapStore((s) => s.selectedEdgeIds);
  const hoveredNodeId = useConceptMapStore((s) => s.hoveredNodeId);
  const searchQuery = useConceptMapStore((s) => s.searchQuery);

  const moveNodes = useConceptMapStore((s) => s.moveNodes);
  const addConcept = useConceptMapStore((s) => s.addConcept);
  const addConnectedConcept = useConceptMapStore((s) => s.addConnectedConcept);
  const createNewEmptyMap = useConceptMapStore((s) => s.createNewEmptyMap);
  const loadFromMarkdown = useConceptMapStore((s) => s.loadFromMarkdown);
  const loadFromDocument = useConceptMapStore((s) => s.loadFromDocument);
  const addRelation = useConceptMapStore((s) => s.addRelation);
  const reconnectRelation = useConceptMapStore((s) => s.reconnectRelation);
  const setSelection = useConceptMapStore((s) => s.setSelection);
  const setViewport = useConceptMapStore((s) => s.setViewport);
  const setCrossLinkVisibility = useConceptMapStore(
    (s) => s.setCrossLinkVisibility
  );
  const unpinAllNodes = useConceptMapStore((s) => s.unpinAllNodes);

  const { screenToFlowPosition, fitView } = useReactFlow();

  // Posições efêmeras durante o arraste com o mouse para 60 FPS sem poluir a pilha de Undo
  const [liveDragPositions, setLiveDragPositions] = useState<
    Record<ConceptId, Point2D>
  >({});

  // Estado de conexão ativa para realce de portas no canvas livre
  const [isConnecting, setIsConnecting] = useState(false);

  // Validação de conexões: impede apenas conectar a mesma porta nela mesma no mesmo bloco
  const isValidConnection: IsValidConnection = useCallback(
    (connection: Connection | Edge) => {
      if (!connection.source || !connection.target) return false;
      if (
        connection.source === connection.target &&
        connection.sourceHandle === connection.targetHandle
      ) {
        return false;
      }
      return true;
    },
    []
  );

  // Referências para suportar "arrastar conexão para o vazio = criar novo conceito conectado"
  const connectingNodeIdRef = useRef<ConceptId | null>(null);
  const didConnectToExistingNodeRef = useRef(false);

  // Ajusta câmera ao carregar mapa inicial
  const prevConceptCountRef = useRef(0);
  useEffect(() => {
    const count = semantic.conceptOrder.length;
    if (count > 0 && prevConceptCountRef.current === 0) {
      const timer = setTimeout(() => {
        fitView({ padding: 0.14, duration: 300 });
      }, 60);
      prevConceptCountRef.current = count;
      return () => clearTimeout(timer);
    }
    prevConceptCountRef.current = count;
  }, [semantic.conceptOrder.length, fitView]);

  const handlePathwayAction = (key: string, action: 'create' | 'example' | 'blank') => {
    if (key === 'concept-map') {
      if (action === 'create') createNewEmptyMap(true, 'concept-map');
      else fetchDefaultWorkspaceInput().then((p) => loadFromMarkdown(p.content, p.fileName));
    } else if (key === 'flowchart') {
      if (action === 'create') createNewEmptyMap(true, 'flowchart');
      else fetchFlowchartWorkspaceInput().then((p) => loadFromMarkdown(p.content, p.fileName));
    } else {
      if (action === 'create') createNewEmptyMap(true, 'concept-map', { freeformCanvas: true });
      else if (action === 'blank') createNewEmptyMap(false, 'concept-map', { freeformCanvas: true });
      else fetchFreeformWorkspaceInput().then((p) => loadFromDocument(parseAndValidateJsonDocument(p.content)));
    }
  };

  // Calcula vizinhança de 1º grau do nó sob o cursor (hover)
  const activeFocusSet = useMemo(() => {
    const focusId = hoveredNodeId;
    if (!focusId) return null;

    const neighbors = new Set<ConceptId>([focusId]);
    const connectedEdges = new Set<RelationId>();

    for (const relId of semantic.relationOrder) {
      const rel = semantic.relations[relId];
      if (!rel) continue;
      if (rel.sourceId === focusId || rel.targetId === focusId) {
        neighbors.add(rel.sourceId);
        neighbors.add(rel.targetId);
        connectedEdges.add(relId);
      }
    }

    return { neighbors, connectedEdges };
  }, [hoveredNodeId, semantic.relationOrder, semantic.relations]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isFlowchart = semantic.diagramMode === 'flowchart';

  // Cache persistente de nós para isolamento O(1) a 60 FPS durante o arraste
  const nodeCacheRef = useRef<Record<ConceptId, ConceptFlowNode>>({});

  // Constrói lista de nós para o React Flow com reutilização de referência estável
  const flowNodes: ConceptFlowNode[] = useMemo(() => {
    const selectedSet = new Set(selectedNodeIds);
    const rootSet = new Set(metrics.rootConceptIds);
    const isCurrentFlowchart = semantic.diagramMode === 'flowchart';
    const nextCache: Record<ConceptId, ConceptFlowNode> = {};

    const nodes = semantic.conceptOrder
      .map((conceptId) => {
        const concept = semantic.concepts[conceptId];
        const nodeVis = visual.nodes[conceptId];
        if (!concept || !nodeVis) return null;

        const pos = liveDragPositions[conceptId] ?? nodeVis.position;
        const width = nodeVis.dimensions?.width ?? 180;
        const height = nodeVis.dimensions?.height ?? 52;

        const isSearchMatch =
          normalizedQuery.length > 0 &&
          concept.label.toLowerCase().includes(normalizedQuery);

        const isDimmed = Boolean(
          (activeFocusSet && !activeFocusSet.neighbors.has(conceptId)) ||
            (normalizedQuery.length > 0 && !isSearchMatch)
        );

        const isSelected = selectedSet.has(conceptId);
        const isRoot = rootSet.has(conceptId);
        const nodeShape =
          nodeVis.nodeShape ??
          concept.nodeShape ??
          (isCurrentFlowchart ? 'process' : 'concept');
        const diagramMode = semantic.diagramMode ?? 'concept-map';

        const cached = nodeCacheRef.current[conceptId];
        if (
          cached &&
          cached.position.x === pos.x &&
          cached.position.y === pos.y &&
          cached.width === width &&
          cached.height === height &&
          cached.selected === isSelected &&
          cached.data.label === concept.label &&
          cached.data.pinned === nodeVis.pinned &&
          cached.data.computedLayer === (nodeVis.computedLayer ?? 0) &&
          cached.data.isRoot === isRoot &&
          cached.data.isDimmed === isDimmed &&
          cached.data.isSearchMatch === isSearchMatch &&
          cached.data.customStyle === nodeVis.style &&
          cached.data.nodeShape === nodeShape &&
          cached.data.diagramMode === diagramMode
        ) {
          nextCache[conceptId] = cached;
          return cached;
        }

        const newNode: ConceptFlowNode = {
          id: conceptId,
          type: 'concept' as const,
          position: pos,
          width,
          height,
          // Sem `measured`, o React Flow zera os handleBounds sempre que o objeto do nó
          // é recriado (ex.: a cada frame de arraste) e as arestas deixam de ser renderizadas.
          measured: { width, height },
          selected: isSelected,
          style: {
            width,
            height,
          },
          data: {
            conceptId,
            label: concept.label,
            pinned: nodeVis.pinned,
            computedLayer: nodeVis.computedLayer ?? 0,
            isRoot,
            degree: 0,
            isDimmed,
            isSearchMatch,
            customStyle: nodeVis.style,
            nodeShape,
            diagramMode,
          },
        };

        nextCache[conceptId] = newNode;
        return newNode;
      })
      .filter((n): n is NonNullable<typeof n> => Boolean(n));

    nodeCacheRef.current = nextCache;
    return nodes;
  }, [
    semantic.conceptOrder,
    semantic.concepts,
    semantic.diagramMode,
    visual.nodes,
    liveDragPositions,
    selectedNodeIds,
    metrics.rootConceptIds,
    activeFocusSet,
    normalizedQuery,
  ]);

  // Mapeamento topológico de arestas paralelas em passo único O(E)
  const parallelEdgeIndexMap = useMemo(() => {
    const pairGroups = new Map<string, RelationId[]>();
    for (const relId of semantic.relationOrder) {
      const rel = semantic.relations[relId];
      if (!rel) continue;
      const key =
        rel.sourceId < rel.targetId
          ? `${rel.sourceId}--${rel.targetId}`
          : `${rel.targetId}--${rel.sourceId}`;
      let group = pairGroups.get(key);
      if (!group) {
        group = [];
        pairGroups.set(key, group);
      }
      group.push(relId);
    }

    const indexMap = new Map<RelationId, { index: number; total: number }>();
    for (const siblings of pairGroups.values()) {
      const total = siblings.length;
      for (let i = 0; i < total; i++) {
        indexMap.set(siblings[i], { index: i, total });
      }
    }
    return indexMap;
  }, [semantic.relationOrder, semantic.relations]);

  // Constrói lista de arestas (proposições) para o React Flow
  const flowEdges: PropositionFlowEdge[] = useMemo(() => {
    const selectedSet = new Set(selectedEdgeIds);
    const isCurrentFlowchart = semantic.diagramMode === 'flowchart';

    return semantic.relationOrder
      .map((relId) => {
        const rel = semantic.relations[relId];
        const edgeVis = visual.edges[relId];
        if (!rel || !edgeVis) return null;

        const parallel = parallelEdgeIndexMap.get(relId) ?? { index: 0, total: 1 };
        const parallelIndex = parallel.index;
        const parallelTotal = parallel.total;

        const isCross = rel.type === 'cross-link';
        const visMode = visual.crossLinkVisibility;

        const isHidden = visMode === 'hide-cross' && isCross;
        const isConnectedToHover = Boolean(
          activeFocusSet?.connectedEdges.has(relId)
        );
        const isSelected = selectedSet.has(relId);

        const isSearchMatch =
          normalizedQuery.length > 0 &&
          rel.linkingPhrase.toLowerCase().includes(normalizedQuery);

        let isDimmed = false;
        if (activeFocusSet) {
          isDimmed = !isConnectedToHover;
        } else if (visMode === 'hover-only' && isCross && !isSelected) {
          isDimmed = true;
        } else if (visMode === 'highlight-cross' && !isCross && !isSelected) {
          isDimmed = true;
        } else if (normalizedQuery.length > 0 && !isSearchMatch) {
          isDimmed = true;
        }

        // Cor da ponta da seta adaptada a condições Sim / Não em fluxograma
        const cond = isCurrentFlowchart ? classifyCondition(rel.linkingPhrase) : 'neutral';
        const isSim = cond === 'affirmative';
        const isNao = cond === 'negative';

        const arrowColor = isSelected
          ? '#2563eb'
          : isSim
            ? '#059669'
            : isNao
              ? '#e11d48'
              : isCross
                ? '#d97706'
                : '#475569';

        const arrowDirection =
          edgeVis.arrowDirection ?? rel.arrowDirection ?? 'forward';

        const markerConfig = getArrowMarker(arrowColor);

        const markerEnd =
          arrowDirection === 'forward' || arrowDirection === 'both'
            ? markerConfig
            : undefined;

        const markerStart =
          arrowDirection === 'reverse' || arrowDirection === 'both'
            ? markerConfig
            : undefined;

        const resolvedSourceHandle =
          edgeVis.sourceHandle && edgeVis.sourceHandle !== 'auto'
            ? edgeVis.sourceHandle
            : 'bottom';

        const resolvedTargetHandle =
          edgeVis.targetHandle && edgeVis.targetHandle !== 'auto'
            ? edgeVis.targetHandle
            : 'top';

        return {
          id: relId,
          type: 'proposition' as const,
          source: rel.sourceId,
          target: rel.targetId,
          sourceHandle: resolvedSourceHandle,
          targetHandle: resolvedTargetHandle,
          selected: isSelected,
          reconnectable: true,
          markerStart,
          markerEnd,
          data: {
            relationId: relId,
            linkingPhrase: rel.linkingPhrase,
            relationType: rel.type,
            curveType: edgeVis.curveType,
            labelT: edgeVis.labelOffset?.t ?? 0.5,
            parallelIndex,
            parallelTotal,
            isDimmed,
            isHidden,
            isSearchMatch,
            flowKind: rel.flowKind,
            diagramMode: semantic.diagramMode ?? 'concept-map',
            sourceHandle: resolvedSourceHandle,
            targetHandle: resolvedTargetHandle,
            manualHandles: edgeVis.manualHandles ?? rel.manualHandles ?? false,
            arrowDirection,
          },
        };
      })
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
  }, [
    semantic.relationOrder,
    semantic.relations,
    semantic.diagramMode,
    visual.edges,
    visual.crossLinkVisibility,
    selectedEdgeIds,
    activeFocusSet,
    normalizedQuery,
    parallelEdgeIndexMap,
  ]);

  // Atualiza posições locais durante arraste contínuo e seleção de nós
  const handleNodesChange = useCallback(
    (changes: NodeChange<ConceptFlowNode>[]) => {
      const nextDrag: Record<ConceptId, Point2D> = {};
      let hasPositionChange = false;
      let selectionChanged = false;
      const currentSelectedNodes = new Set(
        useConceptMapStore.getState().selectedNodeIds
      );

      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          nextDrag[change.id] = change.position;
          hasPositionChange = true;
        } else if (change.type === 'select') {
          selectionChanged = true;
          if (change.selected) {
            currentSelectedNodes.add(change.id);
          } else {
            currentSelectedNodes.delete(change.id);
          }
        }
      }

      if (hasPositionChange) {
        setLiveDragPositions((prev) => ({ ...prev, ...nextDrag }));
      }

      if (selectionChanged) {
        const currentSelectedEdges =
          useConceptMapStore.getState().selectedEdgeIds;
        setSelection(Array.from(currentSelectedNodes), currentSelectedEdges);
      }
    },
    [setSelection]
  );

  // Atualiza seleção de arestas
  const handleEdgesChange = useCallback(
    (changes: EdgeChange<PropositionFlowEdge>[]) => {
      let selectionChanged = false;
      const currentSelectedEdges = new Set(
        useConceptMapStore.getState().selectedEdgeIds
      );

      for (const change of changes) {
        if (change.type === 'select') {
          selectionChanged = true;
          if (change.selected) {
            currentSelectedEdges.add(change.id);
          } else {
            currentSelectedEdges.delete(change.id);
          }
        }
      }

      if (selectionChanged) {
        const currentSelectedNodes =
          useConceptMapStore.getState().selectedNodeIds;
        setSelection(currentSelectedNodes, Array.from(currentSelectedEdges));
      }
    },
    [setSelection]
  );

  // Consolida o movimento na store ao soltar o botão do mouse (1 entrada de Undo + pinned=true)
  const handleNodeDragStop: OnNodeDrag<ConceptFlowNode> = useCallback(
    (_event, _node, draggedNodes) => {
      const moves = draggedNodes.map((n) => ({
        conceptId: n.id,
        position: liveDragPositions[n.id] ?? n.position,
      }));
      setLiveDragPositions({});
      moveNodes(moves, true);
    },
    [liveDragPositions, moveNodes]
  );

  const handleConnectStart: OnConnectStart = useCallback((_event, params) => {
    connectingNodeIdRef.current = params.nodeId;
    didConnectToExistingNodeRef.current = false;
    setIsConnecting(true);
  }, []);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      didConnectToExistingNodeRef.current = true;
      const isFlow = semantic.diagramMode === 'flowchart';
      addRelation(
        connection.source,
        connection.target,
        isFlow ? '' : 'relaciona-se com',
        isFlow ? 'sequence' : 'hierarchical',
        {
          sourceHandle: sanitizeHandle(connection.sourceHandle),
          targetHandle: sanitizeHandle(connection.targetHandle),
          manualHandles: true,
        }
      );
    },
    [addRelation, semantic.diagramMode]
  );

  const handleConnectEnd: OnConnectEnd = useCallback(
    (event) => {
      setIsConnecting(false);
      const sourceNodeId = connectingNodeIdRef.current;
      connectingNodeIdRef.current = null;

      if (!sourceNodeId || didConnectToExistingNodeRef.current) {
        return;
      }

      const targetEl = event.target as HTMLElement | null;
      if (!targetEl || !targetEl.classList.contains('react-flow__pane')) {
        return;
      }

      const clientX =
        'changedTouches' in event
          ? event.changedTouches[0]?.clientX ?? 0
          : event.clientX;
      const clientY =
        'changedTouches' in event
          ? event.changedTouches[0]?.clientY ?? 0
          : event.clientY;

      const flowPos = screenToFlowPosition({ x: clientX, y: clientY });
      const isFlow = semantic.diagramMode === 'flowchart';
      addConnectedConcept(
        sourceNodeId,
        isFlow ? 'Nova Etapa' : 'Novo Conceito',
        isFlow ? '' : 'relaciona-se com',
        isFlow ? 'sequence' : 'hierarchical',
        {
          x: Math.round(flowPos.x - 80),
          y: Math.round(flowPos.y - 25),
        },
        isFlow ? 'process' : 'concept'
      );
    },
    [addConnectedConcept, screenToFlowPosition, semantic.diagramMode]
  );

  const handleReconnectStart = useCallback(() => {
    setIsConnecting(true);
  }, []);

  const handleReconnect: OnReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      if (!newConnection.source || !newConnection.target) return;
      reconnectRelation(oldEdge.id, newConnection.source, newConnection.target, {
        sourceHandle: sanitizeHandle(newConnection.sourceHandle),
        targetHandle: sanitizeHandle(newConnection.targetHandle),
        manualHandles: true,
      });
    },
    [reconnectRelation]
  );

  const handleReconnectEnd = useCallback(() => {
    setIsConnecting(false);
  }, []);

  const handleMoveEnd: OnMoveEnd = useCallback(
    (_event, viewport) => {
      setViewport(viewport);
    },
    [setViewport]
  );

  const handlePaneClick = useCallback(() => {
    setSelection([], []);
  }, [setSelection]);

  const pinnedCount = useMemo(
    () => Object.values(visual.nodes).filter((n) => n.pinned).length,
    [visual.nodes]
  );

  const isEmptyMap = semantic.conceptOrder.length === 0;
  const [isWelcomeDismissed, setIsWelcomeDismissed] = useState(false);

  useEffect(() => {
    if (semantic.conceptOrder.length === 0) {
      setIsWelcomeDismissed(false);
    }
  }, [semantic]);

  return (
    <div
      className="relative h-full w-full flex-1 bg-slate-50"
      onDoubleClick={(e) => {
        // Duplo clique no fundo do canvas cria um novo conceito/etapa naquela posição
        const target = e.target as HTMLElement;
        if (target.classList.contains('react-flow__pane')) {
          const flowPos = screenToFlowPosition({
            x: e.clientX,
            y: e.clientY,
          });
          const isFlow = semantic.diagramMode === 'flowchart';
          addConcept(
            isFlow ? 'Nova Etapa' : 'Novo Conceito',
            {
              x: Math.round(flowPos.x - 80),
              y: Math.round(flowPos.y - 25),
            },
            isFlow ? 'process' : 'concept'
          );
        }
      }}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        className={isConnecting ? 'react-flow--connecting' : undefined}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onNodeDragStop={handleNodeDragStop}
        onConnectStart={handleConnectStart}
        onConnect={handleConnect}
        onConnectEnd={handleConnectEnd}
        onReconnectStart={handleReconnectStart}
        onReconnect={handleReconnect}
        onReconnectEnd={handleReconnectEnd}
        onMoveEnd={handleMoveEnd}
        onPaneClick={handlePaneClick}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        selectionOnDrag
        panOnDrag={[1, 2]}
        selectionMode={SelectionMode.Partial}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        panActivationKeyCode={null}
        minZoom={0.15}
        maxZoom={2.5}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={18}
          size={1.2}
          color="#cbd5e1"
        />
        <Controls
          position="bottom-right"
          showInteractive={false}
          className="!rounded-xl !border !border-slate-200 !bg-white/95 !shadow-md"
        />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          style={{ marginBottom: 48, marginRight: 48 }}
          className="!rounded-xl !border !border-slate-200 !bg-white/95 !shadow-md"
          nodeColor={miniMapNodeColor}
        />
      </ReactFlow>

      {/* Painel de Boas-vindas / Criação Manual quando o Mapa está Vazio */}
      {isEmptyMap && !isWelcomeDismissed && (
        <div
          data-testid="welcome-panel"
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-4"
        >
          <div className="pointer-events-auto flex w-full max-w-4xl flex-col items-center rounded-2xl border border-slate-200/90 bg-white/95 p-6 shadow-2xl backdrop-blur">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-xs">
              <Sparkles className="h-6 w-6" />
            </div>
            <h2 className="text-base font-bold text-slate-900">
              Comece seu Mapa Conceitual, Fluxograma ou Canvas Livre
            </h2>
            <p className="mt-1 max-w-lg text-center text-xs leading-relaxed text-slate-600">
              Crie diagramas estruturados a partir de modelos iniciais, utilize o canvas livre irrestrito ou explore exemplos interativos.
            </p>

            {/* Grade de Vias Triplas (Triple Pathways) */}
            <div className="mt-5 grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
              {WELCOME_PATHWAYS.map((pw) => (
                <div
                  key={pw.key}
                  className={`flex flex-col justify-between rounded-xl border p-4 shadow-xs ${pw.borderCls}`}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${pw.titleCls}`}>
                        {pw.icon}
                        {pw.title}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${pw.badgeCls}`}>
                        {pw.badge}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-600">
                      {pw.desc}
                    </p>
                  </div>

                  <div className="mt-4 flex flex-col gap-2">
                    <button
                      type="button"
                      data-testid={pw.createTestId}
                      onClick={() => handlePathwayAction(pw.key, 'create')}
                      className={`inline-flex w-full items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition ${pw.createBtnCls}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {pw.createLabel}
                    </button>
                    <button
                      type="button"
                      data-testid={pw.exampleTestId}
                      onClick={() => handlePathwayAction(pw.key, 'example')}
                      className={`inline-flex w-full items-center justify-center gap-2 rounded-lg border bg-white px-3.5 py-1.5 text-xs font-medium transition ${pw.exampleBorderCls}`}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${pw.exampleIconColor}`} />
                      {pw.exampleLabel}
                    </button>
                    {pw.blankBtn && (
                      <button
                        type="button"
                        data-testid={pw.blankBtn.testId}
                        onClick={() => handlePathwayAction(pw.key, 'blank')}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-50"
                      >
                        <Sparkles className="h-3 w-3 text-emerald-600" />
                        {pw.blankBtn.label}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 w-full text-[11px] text-slate-400">
              <div className="flex items-center gap-1.5">
                <FileUp className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Arraste um arquivo <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10.5px] text-slate-700">.md</code> ou dê <strong>duplo clique</strong> no fundo para criar.
                </span>
              </div>
              <button
                type="button"
                data-testid="dismiss-welcome-panel-btn"
                onClick={() => setIsWelcomeDismissed(true)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                Usar canvas vazio (sem blocos)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Legenda Interativa & Filtro (Canto Inferior Esquerdo) */}
      <div className="pointer-events-auto absolute bottom-4 left-4 z-20 flex flex-col gap-2 rounded-xl border border-slate-200/90 bg-white/95 p-3 text-xs shadow-lg backdrop-blur">
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-1.5">
          <span className="font-semibold text-slate-700">
            {isFlowchart ? 'Legenda do Fluxograma' : 'Legenda & Relações'}
          </span>
          <span className="text-[11px] text-slate-500">
            {metrics.totalConcepts} nós • {metrics.totalRelations} conexões
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          {[
            {
              label: isFlowchart ? 'Sequencial' : 'Hierárquica',
              dashed: false,
              color: 'bg-slate-600',
              textCls: 'text-slate-700',
              badgeCls: 'bg-slate-100 text-slate-700',
              count: isFlowchart ? (metrics.sequenceCount ?? metrics.hierarchicalCount) : metrics.hierarchicalCount,
            },
            isFlowchart
              ? { label: 'Condicional', dashed: false, color: 'bg-emerald-600', textCls: 'text-emerald-800', badgeCls: 'bg-emerald-100 text-emerald-900', count: metrics.conditionalCount ?? 0 }
              : { label: 'Ligação Cruzada', dashed: true, color: 'border-amber-600', textCls: 'text-amber-800', badgeCls: 'bg-amber-100 text-amber-900', count: metrics.crossLinkCount },
            ...(isFlowchart && (metrics.loopBackCount ?? 0) > 0
              ? [{ label: 'Retorno', dashed: true, color: 'border-amber-600', textCls: 'text-amber-800', badgeCls: 'bg-amber-100 text-amber-900', count: metrics.loopBackCount }]
              : []),
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={`inline-block h-0.5 w-6 ${item.dashed ? 'border-b-2 border-dashed ' + item.color : item.color}`} />
                <span className={`font-medium ${item.textCls}`}>{item.label}</span>
              </div>
              <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${item.badgeCls}`}>
                {item.count}
              </span>
            </div>
          ))}
        </div>

        {/* Seletor de Visibilidade de Ligações Cruzadas */}
        {!isFlowchart && (
          <div className="mt-1 flex items-center gap-1.5 border-t border-slate-100 pt-2">
            <Eye className="h-3.5 w-3.5 text-slate-500" />
            <label htmlFor="crosslink-filter" className="text-slate-600">
              Cruzadas:
            </label>
            <select
              id="crosslink-filter"
              value={visual.crossLinkVisibility}
              onChange={(e) =>
                setCrossLinkVisibility(e.target.value as CrossLinkVisibilityMode)
              }
              className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">Mostrar todas</option>
              <option value="hover-only">Atenuar (foco no hover)</option>
              <option value="highlight-cross">Destacar cruzadas</option>
              <option value="hide-cross">Ocultar cruzadas</option>
            </select>
          </div>
        )}

        {/* Contador de Nós Fixados (Pinned) */}
        {pinnedCount > 0 && (
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5 text-[11px] text-amber-800">
            <span>📌 {pinnedCount} nó(s) fixado(s) manualmente</span>
            <button
              type="button"
              onClick={unpinAllNodes}
              className="flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-900 hover:bg-amber-100"
              title="Desafixar todos os nós para permitir reorganização total"
            >
              <PinOff className="h-3 w-3" />
              Liberar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

