import { beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import { useConceptMapStore } from '../src/store/useConceptMapStore';
import {
  FLOWCHART_SHAPES_CONFIG,
  getShapeMeta,
} from '../src/components/canvas/shapeDefinitions';
import {
  estimateConceptNodeDimensions,
  DECISION_MIN_WIDTH,
  DECISION_MIN_HEIGHT,
  DECISION_WIDTH_FACTOR,
  DECISION_HEIGHT_FACTOR,
  TERMINAL_MIN_WIDTH,
  TERMINAL_MIN_HEIGHT,
  TERMINAL_EXTRA_WIDTH,
  IO_MIN_WIDTH,
  IO_MIN_HEIGHT,
  IO_EXTRA_WIDTH,
  SUBROUTINE_MIN_WIDTH,
  SUBROUTINE_MIN_HEIGHT,
  SUBROUTINE_EXTRA_WIDTH,
  DOCUMENT_MIN_WIDTH,
  DOCUMENT_MIN_HEIGHT,
  DOCUMENT_EXTRA_HEIGHT,
  PROCESS_MIN_WIDTH,
  PROCESS_MIN_HEIGHT,
  DEFAULT_NODE_MIN_WIDTH,
  DEFAULT_NODE_MIN_HEIGHT,
} from '../src/services/layout/nodeSizing';
import { PropertyInspector } from '../src/components/inspector/PropertyInspector';
import { TopToolbar } from '../src/components/toolbar/TopToolbar';
import { ConceptMapCanvas } from '../src/components/canvas/ConceptMapCanvas';
import type {
  ArrowDirection,
  FlowchartNodeShape,
  HandlePosition,
} from '../src/domain/types';

describe('Empirical M3 Challenge: Freeform Canvas Workflows, Shape Palette & Welcome Panel', () => {
  const ALL_7_SHAPES: readonly FlowchartNodeShape[] = [
    'terminal',
    'process',
    'decision',
    'io',
    'subroutine',
    'document',
    'concept',
  ] as const;

  const CARDINAL_HANDLES: readonly HandlePosition[] = [
    'top',
    'right',
    'bottom',
    'left',
  ] as const;

  const ARROW_DIRECTIONS: readonly ArrowDirection[] = [
    'forward',
    'reverse',
    'both',
    'none',
  ] as const;

  beforeEach(() => {
    useConceptMapStore.getState().createNewEmptyMap(false, 'concept-map');
  });

  // ==========================================================================
  // CHALLENGE PILLAR 1: Freeform Mode Initialization & Locking Under Mutation Stress
  // ==========================================================================
  describe('Challenge Pillar 1: Freeform Mode Initialization & Locking Under Mutation Stress', () => {
    it('1.1: createNewEmptyMap with freeformCanvas: true sets and locks freeform mode with starter node', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(true, 'concept-map', { freeformCanvas: true });

      const state = useConceptMapStore.getState();
      expect(state.visual.layoutSettings.freeformCanvas).toBe(true);
      expect(state.semantic.diagramMode).toBe('concept-map');
      expect(state.semantic.conceptOrder).toHaveLength(1);

      const starterId = state.semantic.conceptOrder[0];
      const starterNode = state.visual.nodes[starterId];
      expect(starterNode).toBeDefined();
      expect(starterNode.nodeShape).toBe('concept');
    });

    it('1.2: createNewEmptyMap without starter node sets freeform mode with empty canvas', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart', { freeformCanvas: true });

      const state = useConceptMapStore.getState();
      expect(state.visual.layoutSettings.freeformCanvas).toBe(true);
      expect(state.semantic.diagramMode).toBe('flowchart');
      expect(state.semantic.conceptOrder).toHaveLength(0);
      expect(Object.keys(state.visual.nodes)).toHaveLength(0);
    });

    it('1.3: freeform mode remains strictly locked across sequential additions of 20 nodes of varied shapes', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'concept-map', { freeformCanvas: true });
      expect(useConceptMapStore.getState().visual.layoutSettings.freeformCanvas).toBe(true);

      const createdIds: string[] = [];
      for (let i = 0; i < 20; i++) {
        const shape = ALL_7_SHAPES[i % ALL_7_SHAPES.length];
        const id = store.addConcept(`Bloco #${i + 1}`, { x: i * 30, y: i * 20 }, shape);
        expect(id).toBeDefined();
        createdIds.push(id);

        // Verification after each addition: freeformCanvas MUST remain true
        const currentState = useConceptMapStore.getState();
        expect(currentState.visual.layoutSettings.freeformCanvas).toBe(true);
        expect(currentState.visual.nodes[id].nodeShape).toBe(shape);
      }

      expect(useConceptMapStore.getState().semantic.conceptOrder).toHaveLength(20);
    });

    it('1.4: freeform mode remains locked through connected concept creation, label updates, deletions and settings update', async () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(true, 'concept-map', { freeformCanvas: true });
      const rootId = useConceptMapStore.getState().semantic.conceptOrder[0];

      // Add connected concept
      const childId = store.addConnectedConcept(rootId, 'Filho 1', 'conecta', 'decision');
      expect(childId).toBeDefined();
      expect(useConceptMapStore.getState().visual.layoutSettings.freeformCanvas).toBe(true);

      // Update label
      store.updateConceptLabel(rootId, 'Novo Rótulo Raiz');
      expect(useConceptMapStore.getState().visual.layoutSettings.freeformCanvas).toBe(true);

      // Update layout direction via applyAutoLayout
      await store.applyAutoLayout({ direction: 'LR' });
      expect(useConceptMapStore.getState().visual.layoutSettings.freeformCanvas).toBe(true);
      expect(useConceptMapStore.getState().visual.layoutSettings.direction).toBe('LR');

      // Delete child node
      store.deleteElements([childId!], []);
      expect(useConceptMapStore.getState().visual.layoutSettings.freeformCanvas).toBe(true);
      expect(useConceptMapStore.getState().semantic.conceptOrder).not.toContain(childId);
    });

    it('1.5: freeform mode protects edge handles from moveNodes and updateNodeShape even without explicit manualHandles: true', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'concept-map', { freeformCanvas: true });

      const n1 = store.addConcept('A', { x: 100, y: 100 }, 'process');
      const n2 = store.addConcept('B', { x: 500, y: 100 }, 'decision');

      // Add edge with explicit handles, but manualHandles omitted or false
      const relId = store.addRelation(n1, n2, 'fluxo', 'sequence', {
        sourceHandle: 'left',
        targetHandle: 'top',
        manualHandles: false,
      })!;
      expect(relId).toBeDefined();

      // In freeformCanvas === true, the edge handles must NOT be recalculated on moveNodes
      store.moveNodes([
        { id: n1, position: { x: 800, y: 900 } },
        { id: n2, position: { x: 100, y: 100 } },
      ]);

      const edgeVisAfterMove = useConceptMapStore.getState().visual.edges[relId];
      expect(edgeVisAfterMove.sourceHandle).toBe('left');
      expect(edgeVisAfterMove.targetHandle).toBe('top');

      // In freeformCanvas === true, updateNodeShape must also NOT overwrite handles
      store.updateNodeShape(n1, 'subroutine');
      const edgeVisAfterShape = useConceptMapStore.getState().visual.edges[relId];
      expect(edgeVisAfterShape.sourceHandle).toBe('left');
      expect(edgeVisAfterShape.targetHandle).toBe('top');
    });

    it('1.6: setFreeformCanvas toggles freeform mode preserving manual handles when toggled off', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'concept-map');
      expect(store.visual.layoutSettings.freeformCanvas).toBeFalsy();

      const n1 = store.addConcept('A', { x: 100, y: 100 }, 'process');
      const n2 = store.addConcept('B', { x: 500, y: 100 }, 'process');

      // Edge 1: manual handles
      const r1 = store.addRelation(n1, n2, 'manual', 'sequence', {
        sourceHandle: 'bottom',
        targetHandle: 'bottom',
        manualHandles: true,
      })!;

      // Edge 2: auto handles
      const r2 = store.addRelation(n1, n2, 'auto', 'sequence')!;

      // Toggle freeform ON
      store.setFreeformCanvas(true);
      expect(useConceptMapStore.getState().visual.layoutSettings.freeformCanvas).toBe(true);

      // Move nodes
      store.moveNodes([{ id: n2, position: { x: 100, y: 500 } }]);

      // Both edges must have their handles preserved in freeform mode
      expect(useConceptMapStore.getState().visual.edges[r1].sourceHandle).toBe('bottom');
      expect(useConceptMapStore.getState().visual.edges[r1].targetHandle).toBe('bottom');

      // Toggle freeform OFF
      store.setFreeformCanvas(false);
      expect(useConceptMapStore.getState().visual.layoutSettings.freeformCanvas).toBe(false);

      // Move nodes again: manual edge r1 must STILL be preserved
      store.moveNodes([{ id: n2, position: { x: 600, y: 600 } }]);
      expect(useConceptMapStore.getState().visual.edges[r1].sourceHandle).toBe('bottom');
      expect(useConceptMapStore.getState().visual.edges[r1].targetHandle).toBe('bottom');
      expect(useConceptMapStore.getState().visual.edges[r1].manualHandles).toBe(true);
    });

    it('1.7: setDiagramMode preserves manual handles and freeform handles', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'concept-map');
      const n1 = store.addConcept('A', { x: 100, y: 100 });
      const n2 = store.addConcept('B', { x: 100, y: 300 });
      // In concept-map with A at (100,100) and B at (100,300), smart handles are bottom -> top
      // User manually anchored top -> bottom
      const rId = store.addRelation(n1, n2, 'liga', 'hierarchical', {
        sourceHandle: 'top',
        targetHandle: 'bottom',
        manualHandles: true,
      })!;

      store.setDiagramMode('flowchart');

      const edgeVis = useConceptMapStore.getState().visual.edges[rId];
      expect(edgeVis.sourceHandle).toBe('top');
      expect(edgeVis.targetHandle).toBe('bottom');
    });
  });

  // ==========================================================================
  // CHALLENGE PILLAR 2: All 7 Shapes Insertion, Bounding Boxes & Dimension Oracles
  // ==========================================================================
  describe('Challenge Pillar 2: All 7 Shapes Insertion, Bounding Boxes & Dimension Oracles', () => {
    it('2.1: FLOWCHART_SHAPES_CONFIG contains exactly the 7 canonical shapes', () => {
      expect(FLOWCHART_SHAPES_CONFIG).toHaveLength(7);
      const registeredShapes = FLOWCHART_SHAPES_CONFIG.map((s) => s.shape);
      for (const shape of ALL_7_SHAPES) {
        expect(registeredShapes).toContain(shape);
      }
    });

    it('2.2: Oracle test for minimum bounding box dimensions across all 7 shapes with short label', () => {
      const shortLabel = 'X';

      // Canonical formula oracle
      const termDims = estimateConceptNodeDimensions(shortLabel, undefined, false, 'terminal');
      const procDims = estimateConceptNodeDimensions(shortLabel, undefined, false, 'process');
      const decDims = estimateConceptNodeDimensions(shortLabel, undefined, false, 'decision');
      const ioDims = estimateConceptNodeDimensions(shortLabel, undefined, false, 'io');
      const subDims = estimateConceptNodeDimensions(shortLabel, undefined, false, 'subroutine');
      const docDims = estimateConceptNodeDimensions(shortLabel, undefined, false, 'document');
      const conDims = estimateConceptNodeDimensions(shortLabel, undefined, false, 'concept');

      // Terminal: min 130x44, +28 width
      expect(termDims.width).toBeGreaterThanOrEqual(TERMINAL_MIN_WIDTH);
      expect(termDims.height).toBeGreaterThanOrEqual(TERMINAL_MIN_HEIGHT);
      expect(termDims.width).toBe(Math.max(TERMINAL_MIN_WIDTH, DEFAULT_NODE_MIN_WIDTH + TERMINAL_EXTRA_WIDTH));

      // Process: min 140x48
      expect(procDims.width).toBe(PROCESS_MIN_WIDTH);
      expect(procDims.height).toBe(PROCESS_MIN_HEIGHT);

      // Decision: min 160x85, factors 1.45 and 1.55
      expect(decDims.width).toBeGreaterThanOrEqual(DECISION_MIN_WIDTH);
      expect(decDims.height).toBeGreaterThanOrEqual(DECISION_MIN_HEIGHT);
      expect(decDims.width).toBe(Math.max(DECISION_MIN_WIDTH, Math.round(DEFAULT_NODE_MIN_WIDTH * DECISION_WIDTH_FACTOR)));
      expect(decDims.height).toBe(Math.max(DECISION_MIN_HEIGHT, Math.round(DEFAULT_NODE_MIN_HEIGHT * DECISION_HEIGHT_FACTOR)));

      // IO: min 150x48, +32 width
      expect(ioDims.width).toBeGreaterThanOrEqual(IO_MIN_WIDTH);
      expect(ioDims.height).toBeGreaterThanOrEqual(IO_MIN_HEIGHT);
      expect(ioDims.width).toBe(Math.max(IO_MIN_WIDTH, DEFAULT_NODE_MIN_WIDTH + IO_EXTRA_WIDTH));

      // Subroutine: min 160x48, +28 width
      expect(subDims.width).toBeGreaterThanOrEqual(SUBROUTINE_MIN_WIDTH);
      expect(subDims.height).toBeGreaterThanOrEqual(SUBROUTINE_MIN_HEIGHT);
      expect(subDims.width).toBe(Math.max(SUBROUTINE_MIN_WIDTH, DEFAULT_NODE_MIN_WIDTH + SUBROUTINE_EXTRA_WIDTH));

      // Document: min 140x56, +14 height
      expect(docDims.width).toBeGreaterThanOrEqual(DOCUMENT_MIN_WIDTH);
      expect(docDims.height).toBeGreaterThanOrEqual(DOCUMENT_MIN_HEIGHT);
      expect(docDims.height).toBe(Math.max(DOCUMENT_MIN_HEIGHT, DEFAULT_NODE_MIN_HEIGHT + DOCUMENT_EXTRA_HEIGHT));

      // Concept: standard Novak 140x48
      expect(conDims.width).toBe(DEFAULT_NODE_MIN_WIDTH);
      expect(conDims.height).toBe(DEFAULT_NODE_MIN_HEIGHT);
    });

    it('2.3: Oracle test for multi-line long text scaling across all 7 shapes', () => {
      const longLabel = 'Mapeamento Sistemático dos Fundamentos e Heurísticas de Validação Arquitetural de Software Distribuído em Nuvem';

      for (const shape of ALL_7_SHAPES) {
        const dims = estimateConceptNodeDimensions(longLabel, undefined, false, shape);
        expect(dims.width).toBeGreaterThan(DEFAULT_NODE_MIN_WIDTH);
        expect(dims.height).toBeGreaterThan(DEFAULT_NODE_MIN_HEIGHT);
        expect(Number.isFinite(dims.width)).toBe(true);
        expect(Number.isFinite(dims.height)).toBe(true);
      }

      // Decision on long text must be strictly wider and taller than process on same text
      const decLong = estimateConceptNodeDimensions(longLabel, undefined, false, 'decision');
      const procLong = estimateConceptNodeDimensions(longLabel, undefined, false, 'process');
      expect(decLong.width).toBeGreaterThan(procLong.width);
      expect(decLong.height).toBeGreaterThan(procLong.height);
    });

    it('2.4: addConcept for each of the 7 shapes stores exact calculated dimensions and shape in store', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'concept-map', { freeformCanvas: true });

      for (const shape of ALL_7_SHAPES) {
        const label = `Bloco ${getShapeMeta(shape).label}`;
        const nodeId = store.addConcept(label, { x: 200, y: 200 }, shape);

        const expectedDims = estimateConceptNodeDimensions(label, undefined, false, shape);
        const nodeVis = useConceptMapStore.getState().visual.nodes[nodeId];
        const nodeSem = useConceptMapStore.getState().semantic.concepts[nodeId];

        expect(nodeSem.nodeShape).toBe(shape);
        expect(nodeVis.nodeShape).toBe(shape);
        expect(nodeVis.dimensions).toEqual(expectedDims);
      }
    });

    it('2.5: customSize protection retains manual dimensions across shape queries', () => {
      const customDims = { width: 350, height: 180 };
      const preserved = estimateConceptNodeDimensions(
        'Texto Qualquer',
        customDims,
        true,
        'decision'
      );
      expect(preserved).toEqual(customDims);
    });
  });

  // ==========================================================================
  // CHALLENGE PILLAR 3: Rapid Shape Swapping & Connection Stress-Testing
  // ==========================================================================
  describe('Challenge Pillar 3: Rapid Shape Swapping & Connection Stress-Testing', () => {
    it('3.1: rapid shape swapping across all 7 shapes dynamically updates dimensions without coordinate drift', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'concept-map', { freeformCanvas: true });

      const nodeId = store.addConcept('Polymorphic Node', { x: 300, y: 250 }, 'concept');
      const initialPos = { ...useConceptMapStore.getState().visual.nodes[nodeId].position };

      // Cycle through shapes twice (14 swaps)
      const swapSequence: FlowchartNodeShape[] = [
        ...ALL_7_SHAPES,
        ...ALL_7_SHAPES,
      ];

      for (const targetShape of swapSequence) {
        store.updateNodeShape(nodeId, targetShape);

        const state = useConceptMapStore.getState();
        const vis = state.visual.nodes[nodeId];
        const sem = state.semantic.concepts[nodeId];

        expect(sem.nodeShape).toBe(targetShape);
        expect(vis.nodeShape).toBe(targetShape);
        expect(vis.position).toEqual(initialPos); // Position must not shift

        const expectedDims = estimateConceptNodeDimensions(
          'Polymorphic Node',
          undefined,
          false,
          targetShape
        );
        expect(vis.dimensions).toEqual(expectedDims);
      }
    });

    it('3.2: 7-node heterogeneous network with 21 pairwise edges preserves all handles under simultaneous move', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'concept-map', { freeformCanvas: true });

      // Create 7 nodes, each with distinct shape
      const nodeIds: string[] = [];
      for (let i = 0; i < ALL_7_SHAPES.length; i++) {
        const shape = ALL_7_SHAPES[i];
        const id = store.addConcept(`Node-${shape}`, { x: i * 150, y: i * 80 }, shape);
        nodeIds.push(id);
      }

      // Create 21 edges (complete graph K7) with cycling cardinal handles and arrow directions
      const edgeIds: string[] = [];
      const edgeSpecs: Record<string, { srcH: HandlePosition; tgtH: HandlePosition; dir: ArrowDirection }> = {};
      let comboIndex = 0;

      for (let i = 0; i < nodeIds.length; i++) {
        for (let j = i + 1; j < nodeIds.length; j++) {
          const srcH = CARDINAL_HANDLES[comboIndex % CARDINAL_HANDLES.length];
          const tgtH = CARDINAL_HANDLES[(comboIndex + 2) % CARDINAL_HANDLES.length];
          const dir = ARROW_DIRECTIONS[comboIndex % ARROW_DIRECTIONS.length];

          const edgeId = store.addRelation(
            nodeIds[i],
            nodeIds[j],
            `rel-${comboIndex}`,
            'hierarchical',
            { sourceHandle: srcH, targetHandle: tgtH, manualHandles: true },
            dir
          )!;

          expect(edgeId).toBeDefined();
          edgeIds.push(edgeId);
          edgeSpecs[edgeId] = { srcH, tgtH, dir };
          comboIndex++;
        }
      }

      expect(edgeIds).toHaveLength(21);

      // Stress move all 7 nodes simultaneously 5 times with random offsets
      for (let round = 1; round <= 5; round++) {
        const moves = nodeIds.map((id, idx) => ({
          id,
          position: {
            x: Math.round(50 + idx * 120 + Math.sin(round + idx) * 100),
            y: Math.round(50 + idx * 90 + Math.cos(round + idx) * 100),
          },
        }));

        store.moveNodes(moves);

        // Verify all 21 edges retain their handles and directions 100%
        const currentState = useConceptMapStore.getState();
        for (const eId of edgeIds) {
          const edgeVis = currentState.visual.edges[eId];
          const spec = edgeSpecs[eId];
          expect(edgeVis.sourceHandle).toBe(spec.srcH);
          expect(edgeVis.targetHandle).toBe(spec.tgtH);
          expect(edgeVis.arrowDirection).toBe(spec.dir);
          expect(edgeVis.manualHandles).toBe(true);
        }
      }
    });

    it('3.3: 4 parallel edges between same pair with different cardinal ports survive shape swaps and reverseRelationDirection', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'concept-map', { freeformCanvas: true });

      const nA = store.addConcept('Decisão Principal', { x: 100, y: 100 }, 'decision');
      const nB = store.addConcept('Processo Alvo', { x: 500, y: 100 }, 'process');

      // 4 distinct cardinal pairings
      const eTop = store.addRelation(nA, nB, 'via-topo', 'sequence', {
        sourceHandle: 'top',
        targetHandle: 'top',
        manualHandles: true,
      })!;
      const eRight = store.addRelation(nA, nB, 'via-direita', 'sequence', {
        sourceHandle: 'right',
        targetHandle: 'left',
        manualHandles: true,
      })!;
      const eBottom = store.addRelation(nA, nB, 'via-base', 'sequence', {
        sourceHandle: 'bottom',
        targetHandle: 'bottom',
        manualHandles: true,
      })!;
      const eLeft = store.addRelation(nA, nB, 'via-esquerda', 'sequence', {
        sourceHandle: 'left',
        targetHandle: 'right',
        manualHandles: true,
      })!;

      expect(eTop).toBeDefined();
      expect(eRight).toBeDefined();
      expect(eBottom).toBeDefined();
      expect(eLeft).toBeDefined();

      // Swap shapes: decision -> io, process -> subroutine
      store.updateNodeShape(nA, 'io');
      store.updateNodeShape(nB, 'subroutine');

      // Verify all 4 parallel edges remain intact
      let edges = useConceptMapStore.getState().visual.edges;
      expect(edges[eTop].sourceHandle).toBe('top');
      expect(edges[eTop].targetHandle).toBe('top');
      expect(edges[eRight].sourceHandle).toBe('right');
      expect(edges[eRight].targetHandle).toBe('left');
      expect(edges[eBottom].sourceHandle).toBe('bottom');
      expect(edges[eBottom].targetHandle).toBe('bottom');
      expect(edges[eLeft].sourceHandle).toBe('left');
      expect(edges[eLeft].targetHandle).toBe('right');

      // Invert direction of eRight (sourceHandle 'right' <-> targetHandle 'left')
      store.reverseRelationDirection(eRight);

      edges = useConceptMapStore.getState().visual.edges;
      const relations = useConceptMapStore.getState().semantic.relations;

      // Semantic source and target must be swapped
      expect(relations[eRight].sourceId).toBe(nB);
      expect(relations[eRight].targetId).toBe(nA);

      // Handles must be inverted: source is now 'left', target is now 'right'
      expect(edges[eRight].sourceHandle).toBe('left');
      expect(edges[eRight].targetHandle).toBe('right');
    });
  });

  // ==========================================================================
  // CHALLENGE PILLAR 4: Welcome Panel & Shape Palette DOM Contracts
  // ==========================================================================
  describe('Challenge Pillar 4: Welcome Panel & Shape Palette DOM Contracts', () => {
    it('4.1: Welcome Panel renders 3 pathway cards with Freeform card in ConceptMapCanvas', () => {
      useConceptMapStore.getState().createNewEmptyMap(false, 'concept-map');

      const html = renderToStaticMarkup(
        <ReactFlowProvider>
          <ConceptMapCanvas />
        </ReactFlowProvider>
      );

      // Container and grid layout
      expect(html).toContain('data-testid="welcome-panel"');
      expect(html).toContain('sm:grid-cols-3');
      expect(html).toContain('max-w-4xl');

      // Card 1: Concept Map
      expect(html).toContain('data-testid="create-concept-map-btn"');
      expect(html).toContain('data-testid="load-concept-map-example-btn"');

      // Card 2: Flowchart
      expect(html).toContain('data-testid="create-flowchart-btn"');
      expect(html).toContain('data-testid="load-flowchart-example-btn"');

      // Card 3: Freeform Canvas
      expect(html).toContain('data-testid="create-freeform-btn"');
      expect(html).toContain('data-testid="load-freeform-blank-btn"');
      expect(html).toContain('Canvas Livre');
      expect(html).toContain('Freeform');
    });

    it('4.2: TopToolbar renders New Menu with Freeform option and Quick Shape Palette', () => {
      const html = renderToStaticMarkup(
        <TopToolbar onOpenTableDrawer={() => {}} />
      );

      // Buttons
      expect(html).toContain('data-testid="toolbar-new-menu-btn"');
      expect(html).toContain('data-testid="toolbar-shape-palette-btn"');
      expect(html).toContain('+ Forma ▾');
    });

    it('4.3: PropertyInspector renders all 7 shapes when a node is selected', () => {
      const store = useConceptMapStore.getState();
      const nId = store.addConcept('Sample Node', { x: 100, y: 100 }, 'concept');
      store.setSelection([nId], []);

      const html = renderToStaticMarkup(<PropertyInspector />);

      for (const shape of ALL_7_SHAPES) {
        expect(html).toContain(`data-testid="node-shape-selector-${shape}"`);
      }
    });

    it('4.4: PropertyInspector renders 4 handle buttons and 4 direction buttons for edges', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('A', { x: 100, y: 100 });
      const n2 = store.addConcept('B', { x: 300, y: 100 });
      const rId = store.addRelation(n1, n2, 'link')!;
      store.setSelection([], [rId]);

      const html = renderToStaticMarkup(<PropertyInspector />);

      // Source handles
      for (const h of CARDINAL_HANDLES) {
        expect(html).toContain(`data-testid="edge-source-handle-${h}"`);
        expect(html).toContain(`data-testid="edge-target-handle-${h}"`);
      }

      // Arrow directions
      for (const dir of ARROW_DIRECTIONS) {
        expect(html).toContain(`data-testid="edge-arrow-direction-${dir}"`);
      }

      // Invert and reset buttons
      expect(html).toContain('data-testid="edge-invert-direction-btn"');
      expect(html).toContain('data-testid="edge-reset-auto-handles-btn"');
    });
  });
});
