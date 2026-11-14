import { beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useConceptMapStore } from '../src/store/useConceptMapStore';
import {
  FLOWCHART_SHAPES_CONFIG,
  getShapeMeta,
} from '../src/components/canvas/shapeDefinitions';
import { PropertyInspector } from '../src/components/inspector/PropertyInspector';
import { TopToolbar } from '../src/components/toolbar/TopToolbar';
import type {
  ArrowDirection,
  FlowchartNodeShape,
  HandlePosition,
} from '../src/domain/types';

describe('Empirical M3 UI Challenge: 25 Handle Combinations, Arrow Directions & UI Resilience', () => {
  const CARDINAL_HANDLES: readonly HandlePosition[] = [
    'top',
    'right',
    'bottom',
    'left',
  ] as const;

  const ALL_HANDLE_OPTIONS: readonly (HandlePosition | 'auto')[] = [
    'top',
    'right',
    'bottom',
    'left',
    'auto',
  ] as const;

  const ARROW_DIRECTIONS: readonly ArrowDirection[] = [
    'forward',
    'reverse',
    'both',
    'none',
  ] as const;

  const ALL_7_SHAPES: readonly FlowchartNodeShape[] = [
    'concept',
    'terminal',
    'process',
    'decision',
    'io',
    'subroutine',
    'document',
  ] as const;

  beforeEach(() => {
    useConceptMapStore.getState().createNewEmptyMap(false, 'concept-map');
  });

  // ==========================================================================
  // CHALLENGE 1: The 25 (5x5) Source x Target Handle Mutation Matrix & Invariants
  // ==========================================================================
  describe('Challenge 1: Complete 25 Handle Combination Matrix via updateRelation', () => {
    it('empirically tests all 25 (source x target) handle combinations and validates manualHandles flags', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Origin Node', { x: 100, y: 100 });
      const nodeB = store.addConcept('Destination Node', { x: 500, y: 300 });
      const relId = store.addRelation(nodeA, nodeB, 'connects')!;
      expect(relId).toBeDefined();

      let testedPairs = 0;

      for (const src of ALL_HANDLE_OPTIONS) {
        for (const tgt of ALL_HANDLE_OPTIONS) {
          testedPairs++;

          const isAutoPair = src === 'auto' && tgt === 'auto';
          const isManualPair = !isAutoPair;

          store.updateRelation(relId, {
            sourceHandle: src,
            targetHandle: tgt,
            manualHandles: isManualPair,
          });

          const currentEdge = useConceptMapStore.getState().visual.edges[relId];
          const currentRel = useConceptMapStore.getState().semantic.relations[relId];

          expect(currentEdge.manualHandles).toBe(isManualPair);
          expect(currentRel.manualHandles).toBe(isManualPair);

          if (src !== 'auto') {
            expect(currentEdge.sourceHandle).toBe(src);
          }
          if (tgt !== 'auto') {
            expect(currentEdge.targetHandle).toBe(tgt);
          }

          // Move nodes arbitrarily — manual handles MUST NOT be modified
          store.moveNodes([
            { conceptId: nodeA, position: { x: Math.random() * 800, y: Math.random() * 800 } },
            { conceptId: nodeB, position: { x: Math.random() * 800, y: Math.random() * 800 } },
          ]);

          const afterMoveEdge = useConceptMapStore.getState().visual.edges[relId];
          expect(afterMoveEdge.manualHandles).toBe(isManualPair);

          if (src !== 'auto') {
            expect(afterMoveEdge.sourceHandle).toBe(src);
          }
          if (tgt !== 'auto') {
            expect(afterMoveEdge.targetHandle).toBe(tgt);
          }
        }
      }

      expect(testedPairs).toBe(25);
    });

    it('empirically verifies resetting from manual to auto clears the manualHandles lock', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('A', { x: 100, y: 100 });
      const nodeB = store.addConcept('B', { x: 400, y: 100 });
      const relId = store.addRelation(nodeA, nodeB, 'leads to', 'sequence', {
        sourceHandle: 'right',
        targetHandle: 'left',
        manualHandles: true,
      })!;

      expect(useConceptMapStore.getState().visual.edges[relId].manualHandles).toBe(true);

      // Simulate clicking "Restaurar portas automáticas"
      store.updateRelation(relId, {
        sourceHandle: 'auto',
        targetHandle: 'auto',
        manualHandles: false,
      });

      const edgeVis = useConceptMapStore.getState().visual.edges[relId];
      expect(edgeVis.manualHandles).toBe(false);

      // Now moving nodes SHOULD be allowed to recalculate smart handles
      store.moveNodes([
        { conceptId: nodeA, position: { x: 400, y: 500 } },
        { conceptId: nodeB, position: { x: 400, y: 100 } },
      ]);

      const updatedEdge = useConceptMapStore.getState().visual.edges[relId];
      expect(updatedEdge.manualHandles).toBe(false);
      // Smart handles for vertical placement (nodeA below nodeB)
      expect(['top', 'bottom', 'left', 'right']).toContain(updatedEdge.sourceHandle);
      expect(['top', 'bottom', 'left', 'right']).toContain(updatedEdge.targetHandle);
    });

    it('investigates PropertyInspector handle selection behavior when setting source to auto while target is manual', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('A', { x: 100, y: 100 });
      const nodeB = store.addConcept('B', { x: 400, y: 100 });
      const relId = store.addRelation(nodeA, nodeB, 'leads to', 'sequence', {
        sourceHandle: 'top',
        targetHandle: 'bottom',
        manualHandles: true,
      })!;

      // User simulates setting sourceHandle to 'auto' in PropertyInspector
      // targetIsManual is true because target is 'bottom'
      const edgeBefore = useConceptMapStore.getState().visual.edges[relId];
      const targetIsManual =
        Boolean(edgeBefore.manualHandles) &&
        Boolean(edgeBefore.targetHandle) &&
        edgeBefore.targetHandle !== 'auto';

      store.updateRelation(relId, {
        sourceHandle: 'auto',
        manualHandles: targetIsManual, // true
      });

      const edgeAfter = useConceptMapStore.getState().visual.edges[relId];
      // Check what sourceHandle is now
      console.log('edgeAfter.sourceHandle:', edgeAfter.sourceHandle, 'manualHandles:', edgeAfter.manualHandles);

      store.setSelection([], [relId]);
      const html = renderToStaticMarkup(<PropertyInspector />);
      console.log('HTML snippet for source select:', html.match(/data-testid="edge-source-handle-select"[^>]*>([\s\S]*?)<\/select>/)?.[0]);
    });
  });

  // ==========================================================================
  // CHALLENGE 2: Arrow Direction Full Permutation Matrix (16 State Transitions)
  // ==========================================================================
  describe('Challenge 2: Arrow Direction State Machine & Transitions', () => {
    it('empirically verifies all 16 transitions between arrowDirection states (forward, reverse, both, none)', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Node 1', { x: 100, y: 100 });
      const nodeB = store.addConcept('Node 2', { x: 300, y: 200 });
      const relId = store.addRelation(nodeA, nodeB, 'flow')!;

      let transitionsCount = 0;

      for (const fromDir of ARROW_DIRECTIONS) {
        store.updateRelation(relId, { arrowDirection: fromDir });
        expect(useConceptMapStore.getState().visual.edges[relId].arrowDirection).toBe(fromDir);

        for (const toDir of ARROW_DIRECTIONS) {
          transitionsCount++;
          store.updateRelation(relId, { arrowDirection: toDir });

          const edgeVis = useConceptMapStore.getState().visual.edges[relId];
          const relSem = useConceptMapStore.getState().semantic.relations[relId];

          expect(edgeVis.arrowDirection).toBe(toDir);
          expect(relSem.arrowDirection).toBe(toDir);
        }
      }

      expect(transitionsCount).toBe(16);
    });
  });

  // ==========================================================================
  // CHALLENGE 3: Mathematical Involution Property of reverseRelationDirection
  // ==========================================================================
  describe('Challenge 3: Mathematical Involution Property of reverseRelationDirection', () => {
    it('proves f(f(x)) === x across all 16 cardinal handle combinations', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Alpha', { x: 100, y: 150 });
      const nodeB = store.addConcept('Beta', { x: 500, y: 350 });

      for (const src of CARDINAL_HANDLES) {
        for (const tgt of CARDINAL_HANDLES) {
          const relId = store.addRelation(nodeA, nodeB, 'transitions', 'sequence', {
            sourceHandle: src,
            targetHandle: tgt,
            manualHandles: true,
          })!;

          const originalEdge = { ...useConceptMapStore.getState().visual.edges[relId] };
          const originalRel = { ...useConceptMapStore.getState().semantic.relations[relId] };

          // First reversal: f(x)
          store.reverseRelationDirection(relId);
          const rev1Edge = useConceptMapStore.getState().visual.edges[relId];
          const rev1Rel = useConceptMapStore.getState().semantic.relations[relId];

          expect(rev1Rel.sourceId).toBe(nodeB);
          expect(rev1Rel.targetId).toBe(nodeA);
          expect(rev1Edge.sourceHandle).toBe(tgt);
          expect(rev1Edge.targetHandle).toBe(src);
          expect(rev1Edge.manualHandles).toBe(true);

          // Second reversal: f(f(x)) === x (Involution)
          store.reverseRelationDirection(relId);
          const rev2Edge = useConceptMapStore.getState().visual.edges[relId];
          const rev2Rel = useConceptMapStore.getState().semantic.relations[relId];

          expect(rev2Rel.sourceId).toBe(originalRel.sourceId);
          expect(rev2Rel.targetId).toBe(originalRel.targetId);
          expect(rev2Edge.sourceHandle).toBe(originalEdge.sourceHandle);
          expect(rev2Edge.targetHandle).toBe(originalEdge.targetHandle);
          expect(rev2Edge.manualHandles).toBe(true);

          // Clean up for next combination
          store.deleteElements([], [relId]);
        }
      }
    });
  });

  // ==========================================================================
  // CHALLENGE 4: "Nova Conexão" Handle Combinations & Multi-Edge Parallelism
  // ==========================================================================
  describe('Challenge 4: Node Inspector Nova Conexão Cardinal Ports & Parallel Connections', () => {
    it('creates connections with asymmetric handle specs (cardinal source + auto target, and vice-versa)', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Src', { x: 100, y: 100 });
      const nodeB = store.addConcept('Tgt', { x: 400, y: 400 });

      // Scenario A: sourceHandle = 'top', targetHandle = undefined (auto)
      const relA = store.addRelation(
        nodeA,
        nodeB,
        'link A',
        'sequence',
        { sourceHandle: 'top', targetHandle: undefined, manualHandles: true }
      )!;

      const edgeA = useConceptMapStore.getState().visual.edges[relA];
      expect(edgeA.sourceHandle).toBe('top');
      expect(edgeA.manualHandles).toBe(true);
      expect(edgeA.targetHandle).toBeDefined();

      // Scenario B: sourceHandle = undefined (auto), targetHandle = 'left'
      const relB = store.addRelation(
        nodeA,
        nodeB,
        'link B',
        'sequence',
        { sourceHandle: undefined, targetHandle: 'left', manualHandles: true }
      )!;

      const edgeB = useConceptMapStore.getState().visual.edges[relB];
      expect(edgeB.targetHandle).toBe('left');
      expect(edgeB.manualHandles).toBe(true);
      expect(edgeB.sourceHandle).toBeDefined();
    });

    it('empirically supports 4 concurrent parallel edges between the exact same 2 nodes with distinct cardinal ports', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Bus Master', { x: 100, y: 200 });
      const nodeB = store.addConcept('Peripheral', { x: 600, y: 200 });

      const edgeSpecs: Array<{ src: HandlePosition; tgt: HandlePosition; label: string }> = [
        { src: 'top', tgt: 'top', label: 'Channel Clock' },
        { src: 'right', tgt: 'left', label: 'Data Bus Out' },
        { src: 'bottom', tgt: 'bottom', label: 'Interrupt Line' },
        { src: 'left', tgt: 'right', label: 'Telemetry Return' },
      ];

      const createdEdgeIds: string[] = [];

      for (const spec of edgeSpecs) {
        const id = store.addRelation(nodeA, nodeB, spec.label, 'sequence', {
          sourceHandle: spec.src,
          targetHandle: spec.tgt,
          manualHandles: true,
        });
        expect(id).toBeDefined();
        createdEdgeIds.push(id!);
      }

      expect(createdEdgeIds).toHaveLength(4);
      expect(new Set(createdEdgeIds).size).toBe(4);

      for (let i = 0; i < edgeSpecs.length; i++) {
        const id = createdEdgeIds[i];
        const spec = edgeSpecs[i];
        const edge = useConceptMapStore.getState().visual.edges[id];
        const rel = useConceptMapStore.getState().semantic.relations[id];

        expect(edge.sourceHandle).toBe(spec.src);
        expect(edge.targetHandle).toBe(spec.tgt);
        expect(edge.manualHandles).toBe(true);
        expect(rel.linkingPhrase).toBe(spec.label);
      }
    });
  });

  // ==========================================================================
  // CHALLENGE 5: Property Inspector Resilience & Edge Selection Reactivity
  // ==========================================================================
  describe('Challenge 5: Property Inspector Component Resilience & Markup Verification', () => {
    it('renders gracefully when an orphaned or non-existent relation is selected without throwing', () => {
      const store = useConceptMapStore.getState();
      // Select non-existent edge
      store.setSelection([], ['non-existent-edge-id']);

      expect(() => {
        const html = renderToStaticMarkup(<PropertyInspector />);
        expect(html).toBeDefined();
      }).not.toThrow();
    });

    it('renders gracefully when an orphaned or non-existent concept is selected without throwing', () => {
      const store = useConceptMapStore.getState();
      // Select non-existent node
      store.setSelection(['non-existent-concept-id'], []);

      expect(() => {
        const html = renderToStaticMarkup(<PropertyInspector />);
        expect(html).toBeDefined();
      }).not.toThrow();
    });

    it('renders PropertyInspector with an edge and correctly assigns selected visual state to the active arrowDirection', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('A', { x: 100, y: 100 });
      const nodeB = store.addConcept('B', { x: 300, y: 100 });
      const relId = store.addRelation(nodeA, nodeB, 'links')!;
      store.setSelection([], [relId]);

      for (const dir of ARROW_DIRECTIONS) {
        store.updateRelation(relId, { arrowDirection: dir });
        const html = renderToStaticMarkup(<PropertyInspector />);

        // The button for dir should have the amber-50 background class
        expect(html).toMatch(new RegExp(`data-testid="edge-arrow-direction-${dir}"[^>]*border-amber-600`));
      }
    });

    it('renders PropertyInspector with an edge and highlights the active source and target handle buttons', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('A', { x: 100, y: 100 });
      const nodeB = store.addConcept('B', { x: 300, y: 100 });
      const relId = store.addRelation(nodeA, nodeB, 'links', 'sequence', {
        sourceHandle: 'left',
        targetHandle: 'right',
        manualHandles: true,
      })!;
      store.setSelection([], [relId]);

      const html = renderToStaticMarkup(<PropertyInspector />);

      // Source left button should have active class 'bg-blue-600 text-white'
      expect(html).toMatch(/data-testid="edge-source-handle-left"[^>]*bg-blue-600/);
      // Target right button should have active class 'bg-blue-600 text-white'
      expect(html).toMatch(/data-testid="edge-target-handle-right"[^>]*bg-blue-600/);
    });
  });

  // ==========================================================================
  // CHALLENGE 6: TopToolbar Freeform Mode & 7 Geometric Shapes Palette
  // ==========================================================================
  describe('Challenge 6: TopToolbar Shape Insertion & Freeform Mode Preservations', () => {
    it('verifies that each of the 7 shapes can be added in freeform mode and preserves shape across node moves', () => {
      const store = useConceptMapStore.getState();
      store.setFreeformCanvas(true);

      expect(useConceptMapStore.getState().visual.layoutSettings.freeformCanvas).toBe(true);

      const createdNodeIds: string[] = [];

      for (let i = 0; i < ALL_7_SHAPES.length; i++) {
        const shape = ALL_7_SHAPES[i];
        const meta = getShapeMeta(shape);
        const id = store.addConcept(
          `Node ${meta.label}`,
          { x: 100 + i * 40, y: 100 + i * 40 },
          shape
        );
        expect(id).toBeDefined();
        createdNodeIds.push(id);
      }

      expect(createdNodeIds).toHaveLength(7);

      // Verify all shapes stored properly
      for (let i = 0; i < ALL_7_SHAPES.length; i++) {
        const id = createdNodeIds[i];
        const expectedShape = ALL_7_SHAPES[i];
        const sem = useConceptMapStore.getState().semantic.concepts[id];
        const vis = useConceptMapStore.getState().visual.nodes[id];

        expect(sem.nodeShape).toBe(expectedShape);
        expect(vis.nodeShape).toBe(expectedShape);
      }

      // Move all nodes at once
      store.moveNodes(
        createdNodeIds.map((id, idx) => ({
          conceptId: id,
          position: { x: 500 + idx * 30, y: 500 + idx * 30 },
        }))
      );

      // Verify shapes persist post-move
      for (let i = 0; i < ALL_7_SHAPES.length; i++) {
        const id = createdNodeIds[i];
        const expectedShape = ALL_7_SHAPES[i];
        expect(useConceptMapStore.getState().semantic.concepts[id].nodeShape).toBe(expectedShape);
        expect(useConceptMapStore.getState().visual.nodes[id].nodeShape).toBe(expectedShape);
      }
    });

    it('validates TopToolbar markup contains freeform entry menu item and shape palette trigger', () => {
      const html = renderToStaticMarkup(<TopToolbar onOpenTableDrawer={() => {}} />);
      expect(html).toContain('data-testid="toolbar-new-menu-btn"');
      expect(html).toContain('data-testid="toolbar-shape-palette-btn"');
    });
  });

  // ==========================================================================
  // CHALLENGE 7: High-Volume Parallel Edges & Diamond Decision Node Stress
  // ==========================================================================
  describe('Challenge 7: High-Volume Parallel Edges & Diamond Decision Node Stress', () => {
    it('empirically verifies 16 distinct connections originating from a decision diamond across 4 cardinal vertices', () => {
      const store = useConceptMapStore.getState();
      const diamondId = store.addConcept('Conditional Diamond', { x: 400, y: 400 }, 'decision');
      const processId = store.addConcept('Execution Step', { x: 900, y: 400 }, 'process');

      const relationIds: string[] = [];

      for (const src of CARDINAL_HANDLES) {
        for (const tgt of CARDINAL_HANDLES) {
          const relId = store.addRelation(
            diamondId,
            processId,
            `case-${src}->${tgt}`,
            'conditional',
            { sourceHandle: src, targetHandle: tgt, manualHandles: true },
            'forward'
          );
          expect(relId).toBeDefined();
          relationIds.push(relId!);
        }
      }

      expect(relationIds).toHaveLength(16);

      // Verify all 16 relations preserve handles
      for (let i = 0; i < 16; i++) {
        const id = relationIds[i];
        const src = CARDINAL_HANDLES[Math.floor(i / 4)];
        const tgt = CARDINAL_HANDLES[i % 4];
        const edge = useConceptMapStore.getState().visual.edges[id];
        expect(edge.sourceHandle).toBe(src);
        expect(edge.targetHandle).toBe(tgt);
        expect(edge.manualHandles).toBe(true);
      }

      // Perform 5 consecutive random moves on both nodes
      for (let step = 0; step < 5; step++) {
        store.moveNodes([
          { conceptId: diamondId, position: { x: 200 + step * 50, y: 150 + step * 70 } },
          { conceptId: processId, position: { x: 700 - step * 30, y: 600 - step * 40 } },
        ]);

        for (let i = 0; i < 16; i++) {
          const id = relationIds[i];
          const src = CARDINAL_HANDLES[Math.floor(i / 4)];
          const tgt = CARDINAL_HANDLES[i % 4];
          const edge = useConceptMapStore.getState().visual.edges[id];
          expect(edge.sourceHandle).toBe(src);
          expect(edge.targetHandle).toBe(tgt);
          expect(edge.manualHandles).toBe(true);
        }
      }
    });

    it('empirically tests rapid back-to-back arrowDirection transitions on the same connection', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('N1', { x: 50, y: 50 });
      const n2 = store.addConcept('N2', { x: 250, y: 50 });
      const relId = store.addRelation(n1, n2, 'rapid')!;

      const sequence: ArrowDirection[] = [
        'reverse',
        'forward',
        'both',
        'none',
        'reverse',
        'both',
        'forward',
        'none',
      ];

      for (const dir of sequence) {
        store.updateRelation(relId, { arrowDirection: dir });
        expect(useConceptMapStore.getState().visual.edges[relId].arrowDirection).toBe(dir);
        expect(useConceptMapStore.getState().semantic.relations[relId].arrowDirection).toBe(dir);
      }
    });
  });
});

