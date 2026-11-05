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
  type Node,
  type NodeChange,
  type OnConnectEnd,
  type OnConnectStart,
  type OnMoveEnd,
  type OnNodeDrag,
  type OnReconnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Eye, FileUp, PinOff, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConceptId,
  CrossLinkVisibilityMode,
  HandlePosition,
  Point2D,
  RelationId,
} from '../../domain/types';
import { fetchDefaultWorkspaceInput } from '../../services/workspaceBridge';
import { useConceptMapStore } from '../../store/useConceptMapStore';
import { ConceptNode, type ConceptFlowNode } from './ConceptNode';
import { PropositionEdge, type PropositionFlowEdge } from './PropositionEdge';

const nodeTypes = {
  concept: ConceptNode,
};

const edgeTypes = {
  proposition: PropositionEdge,
};

function sanitizeHandle(
  handleId: string | null | undefined
): HandlePosition | undefined {
  if (
    handleId === 'top' ||
    handleId === 'right' ||
    handleId === 'bottom' ||
    handleId === 'left'
  ) {
    return handleId;
  }
  return undefined;
}

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
  const addPropositionByNames = useConceptMapStore(
    (s) => s.addPropositionByNames
  );
  const createNewEmptyMap = useConceptMapStore((s) => s.createNewEmptyMap);
  const loadFromMarkdown = useConceptMapStore((s) => s.loadFromMarkdown);
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

  // Constrói lista de nós para o React Flow
  const flowNodes: ConceptFlowNode[] = useMemo(() => {
    const selectedSet = new Set(selectedNodeIds);
    const rootSet = new Set(metrics.rootConceptIds);

    return semantic.conceptOrder
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

        return {
          id: conceptId,
          type: 'concept' as const,
          position: pos,
          width,
          height,
          selected: selectedSet.has(conceptId),
          style: {
            width,
            height,
          },
          data: {
            conceptId,
            label: concept.label,
            pinned: nodeVis.pinned,
            computedLayer: nodeVis.computedLayer ?? 0,
            isRoot: rootSet.has(conceptId),
            degree: 0,
            isDimmed,
            isSearchMatch,
            customStyle: nodeVis.style,
          },
        };
      })
      .filter((n): n is NonNullable<typeof n> => Boolean(n));
  }, [
    semantic.conceptOrder,
    semantic.concepts,
    visual.nodes,
    liveDragPositions,
    selectedNodeIds,
    metrics.rootConceptIds,
    activeFocusSet,
    normalizedQuery,
  ]);

  // Constrói lista de arestas (proposições) para o React Flow
  const flowEdges: PropositionFlowEdge[] = useMemo(() => {
    const selectedSet = new Set(selectedEdgeIds);
    const pairCounts: Record<string, RelationId[]> = {};

    for (const relId of semantic.relationOrder) {
      const rel = semantic.relations[relId];
      if (!rel) continue;
      const key =
        rel.sourceId < rel.targetId
          ? `${rel.sourceId}--${rel.targetId}`
          : `${rel.targetId}--${rel.sourceId}`;
      if (!pairCounts[key]) pairCounts[key] = [];
      pairCounts[key].push(relId);
    }

    return semantic.relationOrder
      .map((relId) => {
        const rel = semantic.relations[relId];
        const edgeVis = visual.edges[relId];
        if (!rel || !edgeVis) return null;

        const pairKey =
          rel.sourceId < rel.targetId
            ? `${rel.sourceId}--${rel.targetId}`
            : `${rel.targetId}--${rel.sourceId}`;
        const siblings = pairCounts[pairKey] ?? [relId];
        const parallelIndex = Math.max(0, siblings.indexOf(relId));
        const parallelTotal = siblings.length;

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

        const arrowColor = isSelected
          ? '#2563eb'
          : isCross
            ? '#d97706'
            : '#475569';

        return {
          id: relId,
          type: 'proposition' as const,
          source: rel.sourceId,
          target: rel.targetId,
          sourceHandle:
            edgeVis.sourceHandle && edgeVis.sourceHandle !== 'auto'
              ? edgeVis.sourceHandle
              : 'bottom',
          targetHandle:
            edgeVis.targetHandle && edgeVis.targetHandle !== 'auto'
              ? edgeVis.targetHandle
              : 'top',
          selected: isSelected,
          reconnectable: true,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 18,
            height: 18,
            color: arrowColor,
          },
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
          },
        };
      })
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
  }, [
    semantic.relationOrder,
    semantic.relations,
    visual.edges,
    visual.crossLinkVisibility,
    selectedEdgeIds,
    activeFocusSet,
    normalizedQuery,
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
  }, []);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      didConnectToExistingNodeRef.current = true;
      addRelation(
        connection.source,
        connection.target,
        'relaciona-se com',
        'hierarchical',
        {
          sourceHandle: sanitizeHandle(connection.sourceHandle),
          targetHandle: sanitizeHandle(connection.targetHandle),
        }
      );
    },
    [addRelation]
  );

  const handleConnectEnd: OnConnectEnd = useCallback(
    (event) => {
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
      addConnectedConcept(
        sourceNodeId,
        'Novo Conceito',
        'relaciona-se com',
        'hierarchical',
        {
          x: Math.round(flowPos.x - 80),
          y: Math.round(flowPos.y - 25),
        }
      );
    },
    [addConnectedConcept, screenToFlowPosition]
  );

  const handleReconnect: OnReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      if (!newConnection.source || !newConnection.target) return;
      reconnectRelation(oldEdge.id, newConnection.source, newConnection.target, {
        sourceHandle: sanitizeHandle(newConnection.sourceHandle),
        targetHandle: sanitizeHandle(newConnection.targetHandle),
      });
    },
    [reconnectRelation]
  );

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

  return (
    <div
      className="relative h-full w-full flex-1 bg-slate-50"
      onDoubleClick={(e) => {
        // Duplo clique no fundo do canvas cria um novo conceito naquela posição
        const target = e.target as HTMLElement;
        if (target.classList.contains('react-flow__pane')) {
          const flowPos = screenToFlowPosition({
            x: e.clientX,
            y: e.clientY,
          });
          addConcept('Novo Conceito', {
            x: Math.round(flowPos.x - 80),
            y: Math.round(flowPos.y - 25),
          });
        }
      }}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onNodeDragStop={handleNodeDragStop}
        onConnectStart={handleConnectStart}
        onConnect={handleConnect}
        onConnectEnd={handleConnectEnd}
        onReconnect={handleReconnect}
        onMoveEnd={handleMoveEnd}
        onPaneClick={handlePaneClick}
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
      {isEmptyMap && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-4">
          <div className="pointer-events-auto flex w-full max-w-md flex-col items-center rounded-2xl border border-slate-200 bg-white/95 p-6 text-center shadow-xl backdrop-blur">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <Sparkles className="h-6 w-6" />
            </div>
            <h2 className="text-base font-bold text-slate-900">
              Comece seu Mapa Conceitual
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Crie blocos e ligações livremente ou arraste um arquivo{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-800">
                .md
              </code>{' '}
              diretamente para qualquer lugar da tela.
            </p>

            <div className="mt-5 flex w-full flex-col gap-2">
              <button
                type="button"
                onClick={() => createNewEmptyMap(true)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
                Criar Primeiro Bloco (Conceito Principal)
              </button>

              <button
                type="button"
                onClick={() => {
                  addPropositionByNames(
                    'Conceito Principal',
                    'divide-se em',
                    'Subconceito 1',
                    'hierarchical'
                  );
                }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-2 text-xs font-semibold text-blue-800 transition hover:bg-blue-100"
              >
                Criar Proposição Inicial (Bloco A → Frase → Bloco B)
              </button>

              <button
                type="button"
                onClick={() => {
                  fetchDefaultWorkspaceInput().then((p) => {
                    loadFromMarkdown(p.content, p.fileName);
                  });
                }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
                Carregar Mapa de Exemplo (exemplo.md)
              </button>
            </div>

            <div className="mt-4 flex items-center gap-1.5 text-[11px] text-slate-400">
              <FileUp className="h-3.5 w-3.5" />
              <span>
                Dica: dê <strong>duplo clique</strong> no fundo para criar um
                bloco onde quiser
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Legenda Interativa & Filtro de Ligações Cruzadas (Canto Inferior Esquerdo) */}
      <div className="pointer-events-auto absolute bottom-4 left-4 z-20 flex flex-col gap-2 rounded-xl border border-slate-200/90 bg-white/95 p-3 text-xs shadow-lg backdrop-blur">
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-1.5">
          <span className="font-semibold text-slate-700">
            Legenda & Relações
          </span>
          <span className="text-[11px] text-slate-500">
            {metrics.totalConcepts} nós • {metrics.totalRelations} conexões
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-6 bg-slate-600" />
              <span className="font-medium text-slate-700">Hierárquica</span>
            </div>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
              {metrics.hierarchicalCount}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-6 border-b-2 border-dashed border-amber-600" />
              <span className="font-medium text-amber-800">Ligação Cruzada</span>
            </div>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] text-amber-900">
              {metrics.crossLinkCount}
            </span>
          </div>
        </div>

        {/* Seletor de Visibilidade de Ligações Cruzadas */}
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

