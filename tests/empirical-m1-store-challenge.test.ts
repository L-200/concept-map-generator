import { describe, it, expect, beforeEach } from 'vitest';
import { useConceptMapStore } from '../src/store/useConceptMapStore';
import type {
  ArrowDirection,
  FlowchartNodeShape,
  HandlePosition,
} from '../src/domain/types';
import { ALL_ARROW_DIRECTIONS } from '../src/domain/types';

describe('Empirical M1 Challenge: Store Handle Persistence & Arrow Directions', () => {
  const CARDINAL_HANDLES: HandlePosition[] = ['top', 'right', 'bottom', 'left'];
  const ALL_SHAPES: FlowchartNodeShape[] = [
    'concept',
    'terminal',
    'process',
    'decision',
    'io',
    'subroutine',
    'document',
  ];

  beforeEach(() => {
    useConceptMapStore.getState().createNewEmptyMap(false, 'flowchart');
  });

  it('Challenge 1: Stress-tests all 16 cardinal handle combinations under violent multi-step node moves', () => {
    const store = useConceptMapStore.getState();

    // Iterate through all 16 handle pairs
    for (const srcH of CARDINAL_HANDLES) {
      for (const tgtH of CARDINAL_HANDLES) {
        store.createNewEmptyMap(false, 'flowchart');

        const idA = store.addConcept(`Node_A_${srcH}`, { x: 100, y: 100 });
        const idB = store.addConcept(`Node_B_${tgtH}`, { x: 100, y: 300 });

        const relId = store.addRelation(
          idA,
          idB,
          `${srcH}->${tgtH}`,
          'sequence',
          { sourceHandle: srcH, targetHandle: tgtH, manualHandles: true }
        );

        expect(relId).toBeTruthy();

        // Check initial assignment
        let edge = useConceptMapStore.getState().visual.edges[relId!];
        let rel = useConceptMapStore.getState().semantic.relations[relId!];
        expect(edge.sourceHandle).toBe(srcH);
        expect(edge.targetHandle).toBe(tgtH);
        expect(edge.manualHandles).toBe(true);
        expect(rel.manualHandles).toBe(true);

        // 5 Violent Movements
        const positionsToTest = [
          { a: { x: 100, y: 100 }, b: { x: 600, y: 100 } }, // Horizontal right
          { a: { x: 400, y: 400 }, b: { x: 400, y: -200 } }, // Directly above
          { a: { x: 200, y: 200 }, b: { x: -300, y: 800 } }, // Diagonal negative
          { a: { x: -1000, y: -1000 }, b: { x: 2000, y: 2000 } }, // Extreme coordinates
          { a: { x: 150, y: 150 }, b: { x: 150, y: 150 } }, // Exact overlap
        ];

        for (const pos of positionsToTest) {
          store.moveNodes([
            { conceptId: idA, position: pos.a },
            { conceptId: idB, position: pos.b },
          ]);

          edge = useConceptMapStore.getState().visual.edges[relId!];
          rel = useConceptMapStore.getState().semantic.relations[relId!];

          // INVARIANT ASSERTION: Handles must never be destroyed by moveNodes
          expect(edge.sourceHandle).toBe(srcH);
          expect(edge.targetHandle).toBe(tgtH);
          expect(edge.manualHandles).toBe(true);
          expect(rel.manualHandles).toBe(true);
        }
      }
    }
  });

  it('Challenge 2: Stress-tests handle persistence across all 7 geometric node shape mutations', () => {
    const store = useConceptMapStore.getState();

    const idA = store.addConcept('Origin Node', { x: 150, y: 100 });
    const idB = store.addConcept('Destination Node', { x: 400, y: 350 });

    const relId = store.addRelation(idA, idB, 'flow', 'sequence', {
      sourceHandle: 'left',
      targetHandle: 'bottom',
      manualHandles: true,
    });
    expect(relId).toBeTruthy();

    // Mutate source node shape through all 7 shapes
    for (const shapeA of ALL_SHAPES) {
      store.updateNodeShape(idA, shapeA);
      const nodeA = useConceptMapStore.getState().visual.nodes[idA];
      expect(nodeA.nodeShape).toBe(shapeA);

      const edge = useConceptMapStore.getState().visual.edges[relId!];
      expect(edge.sourceHandle).toBe('left');
      expect(edge.targetHandle).toBe('bottom');
      expect(edge.manualHandles).toBe(true);
    }

    // Mutate target node shape through all 7 shapes
    for (const shapeB of ALL_SHAPES) {
      store.updateNodeShape(idB, shapeB);
      const nodeB = useConceptMapStore.getState().visual.nodes[idB];
      expect(nodeB.nodeShape).toBe(shapeB);

      const edge = useConceptMapStore.getState().visual.edges[relId!];
      expect(edge.sourceHandle).toBe('left');
      expect(edge.targetHandle).toBe('bottom');
      expect(edge.manualHandles).toBe(true);
    }
  });

  it('Challenge 3: Validates updateRelation partial updates, metadata edits, and auto reset', () => {
    const store = useConceptMapStore.getState();

    const idA = store.addConcept('A', { x: 100, y: 100 });
    const idB = store.addConcept('B', { x: 100, y: 300 });

    const relId = store.addRelation(idA, idB, 'text', 'sequence', {
      sourceHandle: 'right',
      targetHandle: 'left',
      manualHandles: true,
    });
    expect(relId).toBeTruthy();

    // 1. Changing label, type, curveType, labelOffset must preserve handles
    store.updateRelation(relId!, {
      linkingPhrase: 'modified text',
      type: 'conditional',
      curveType: 'straight',
      labelOffset: { t: 0.7 },
    });

    let edge = useConceptMapStore.getState().visual.edges[relId!];
    let rel = useConceptMapStore.getState().semantic.relations[relId!];
    expect(edge.sourceHandle).toBe('right');
    expect(edge.targetHandle).toBe('left');
    expect(edge.manualHandles).toBe(true);
    expect(rel.linkingPhrase).toBe('modified text');
    expect(rel.type).toBe('conditional');
    expect(edge.curveType).toBe('straight');

    // 2. Partial update: changing ONLY sourceHandle to 'top' leaves targetHandle 'left'
    store.updateRelation(relId!, { sourceHandle: 'top' });
    edge = useConceptMapStore.getState().visual.edges[relId!];
    expect(edge.sourceHandle).toBe('top');
    expect(edge.targetHandle).toBe('left');
    expect(edge.manualHandles).toBe(true);

    // 3. Partial update: changing ONLY targetHandle to 'bottom' leaves sourceHandle 'top'
    store.updateRelation(relId!, { targetHandle: 'bottom' });
    edge = useConceptMapStore.getState().visual.edges[relId!];
    expect(edge.sourceHandle).toBe('top');
    expect(edge.targetHandle).toBe('bottom');
    expect(edge.manualHandles).toBe(true);

    // 4. Reset to auto with sourceHandle: 'auto', targetHandle: 'auto'
    store.updateRelation(relId!, { sourceHandle: 'auto', targetHandle: 'auto' });
    edge = useConceptMapStore.getState().visual.edges[relId!];
    rel = useConceptMapStore.getState().semantic.relations[relId!];
    expect(edge.manualHandles).toBe(false);
    expect(rel.manualHandles).toBe(false);
    // Since A is at (100, 100) and B is at (100, 300), smart handles in TB should route bottom -> top
    expect(edge.sourceHandle).toBe('bottom');
    expect(edge.targetHandle).toBe('top');

    // 5. If we move B above A in flowchart mode, it becomes a loop-back / return flow, so smart handles adapt to lateral/top
    store.moveNodes([{ conceptId: idB, position: { x: 100, y: -200 } }]);
    edge = useConceptMapStore.getState().visual.edges[relId!];
    expect(edge.manualHandles).toBe(false);
    // Return flow (dy < -20) uses lateral sourceHandle
    expect(['left', 'right']).toContain(edge.sourceHandle);
  });

  it('Challenge 4: Invariance of reverseRelationDirection and all 4 arrowDirection values', () => {
    const store = useConceptMapStore.getState();

    const idA = store.addConcept('Node A', { x: 100, y: 100 });
    const idB = store.addConcept('Node B', { x: 300, y: 300 });

    for (const arrowDir of ALL_ARROW_DIRECTIONS) {
      const relId = store.addRelation(
        idA,
        idB,
        'connect',
        'sequence',
        { sourceHandle: 'top', targetHandle: 'right', manualHandles: true },
        arrowDir
      );

      let edge = useConceptMapStore.getState().visual.edges[relId!];
      let rel = useConceptMapStore.getState().semantic.relations[relId!];
      expect(edge.arrowDirection).toBe(arrowDir);
      expect(rel.arrowDirection).toBe(arrowDir);
      expect(edge.sourceHandle).toBe('top');
      expect(edge.targetHandle).toBe('right');

      // Reverse direction: swaps sourceId <-> targetId AND sourceHandle <-> targetHandle
      store.reverseRelationDirection(relId!);
      edge = useConceptMapStore.getState().visual.edges[relId!];
      rel = useConceptMapStore.getState().semantic.relations[relId!];

      expect(rel.sourceId).toBe(idB);
      expect(rel.targetId).toBe(idA);
      expect(edge.sourceHandle).toBe('right');
      expect(edge.targetHandle).toBe('top');
      expect(edge.manualHandles).toBe(true);
      expect(edge.arrowDirection).toBe(arrowDir);

      // Reverse again: restores original endpoints and handles
      store.reverseRelationDirection(relId!);
      edge = useConceptMapStore.getState().visual.edges[relId!];
      rel = useConceptMapStore.getState().semantic.relations[relId!];

      expect(rel.sourceId).toBe(idA);
      expect(rel.targetId).toBe(idB);
      expect(edge.sourceHandle).toBe('top');
      expect(edge.targetHandle).toBe('right');
      expect(edge.manualHandles).toBe(true);
      expect(edge.arrowDirection).toBe(arrowDir);

      // Clean up for next iteration using deleteElements
      store.deleteElements([], [relId!]);
    }
  });

  it('Challenge 5: Supports 16 concurrent parallel connections between the same two nodes', () => {
    const store = useConceptMapStore.getState();

    const idA = store.addConcept('Core Service', { x: 100, y: 100 });
    const idB = store.addConcept('Satellite Service', { x: 500, y: 100 });

    const createdRelIds: Array<{ id: string; srcH: HandlePosition; tgtH: HandlePosition }> = [];

    // Create 16 parallel connections between A and B
    for (const srcH of CARDINAL_HANDLES) {
      for (const tgtH of CARDINAL_HANDLES) {
        const rId = store.addRelation(
          idA,
          idB,
          `${srcH}->${tgtH}`,
          'sequence',
          { sourceHandle: srcH, targetHandle: tgtH, manualHandles: true }
        );
        expect(rId).toBeTruthy();
        createdRelIds.push({ id: rId!, srcH, tgtH });
      }
    }

    expect(createdRelIds).toHaveLength(16);
    expect(useConceptMapStore.getState().semantic.relationOrder).toHaveLength(16);

    // Move nodes repeatedly
    store.moveNodes([
      { conceptId: idA, position: { x: 200, y: 400 } },
      { conceptId: idB, position: { x: 200, y: 50 } },
    ]);

    // Verify all 16 parallel edges strictly maintained their handles
    const currentEdges = useConceptMapStore.getState().visual.edges;
    for (const item of createdRelIds) {
      const edge = currentEdges[item.id];
      expect(edge).toBeDefined();
      expect(edge.sourceHandle).toBe(item.srcH);
      expect(edge.targetHandle).toBe(item.tgtH);
      expect(edge.manualHandles).toBe(true);
    }
  });

  it('Challenge 6: Freeform Canvas protects all relations from auto-layout and node movements', async () => {
    const store = useConceptMapStore.getState();
    store.createNewEmptyMap(false, 'flowchart', { freeformCanvas: true });

    expect(useConceptMapStore.getState().visual.layoutSettings.freeformCanvas).toBe(true);

    const idA = store.addConcept('Block A', { x: 100, y: 100 });
    const idB = store.addConcept('Block B', { x: 400, y: 400 });

    const relId = store.addRelation(idA, idB, 'free line', 'sequence', {
      sourceHandle: 'top',
      targetHandle: 'left',
    });
    expect(relId).toBeTruthy();

    let edge = useConceptMapStore.getState().visual.edges[relId!];
    expect(edge.sourceHandle).toBe('top');
    expect(edge.targetHandle).toBe('left');
    expect(edge.manualHandles).toBe(true);

    // Run dagre-hierarchical auto layout
    await store.applyAutoLayout({ algorithm: 'dagre-hierarchical' });

    edge = useConceptMapStore.getState().visual.edges[relId!];
    expect(edge.sourceHandle).toBe('top');
    expect(edge.targetHandle).toBe('left');

    // Run elk-layered auto layout
    await store.applyAutoLayout({ algorithm: 'elk-layered' });

    edge = useConceptMapStore.getState().visual.edges[relId!];
    expect(edge.sourceHandle).toBe('top');
    expect(edge.targetHandle).toBe('left');
  });

  it('Challenge 7: Handles self-loop connections without handle degradation', () => {
    const store = useConceptMapStore.getState();

    const idA = store.addConcept('Recursive Function', { x: 200, y: 200 });

    const selfRelId = store.addRelation(
      idA,
      idA,
      'calls itself',
      'loop-back',
      { sourceHandle: 'bottom', targetHandle: 'right', manualHandles: true }
    );
    expect(selfRelId).toBeTruthy();

    let edge = useConceptMapStore.getState().visual.edges[selfRelId!];
    expect(edge.sourceHandle).toBe('bottom');
    expect(edge.targetHandle).toBe('right');
    expect(edge.manualHandles).toBe(true);

    // Move node
    store.moveNodes([{ conceptId: idA, position: { x: 800, y: 600 } }]);

    edge = useConceptMapStore.getState().visual.edges[selfRelId!];
    expect(edge.sourceHandle).toBe('bottom');
    expect(edge.targetHandle).toBe('right');
    expect(edge.manualHandles).toBe(true);

    // Update node shape
    store.updateNodeShape(idA, 'subroutine');
    edge = useConceptMapStore.getState().visual.edges[selfRelId!];
    expect(edge.sourceHandle).toBe('bottom');
    expect(edge.targetHandle).toBe('right');
    expect(edge.manualHandles).toBe(true);
  });

  it('Challenge 8: Monte Carlo random mutation stress harness (100 operations)', () => {
    const store = useConceptMapStore.getState();
    store.createNewEmptyMap(false, 'flowchart');

    // Create 6 nodes
    const nodeIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = store.addConcept(`Node_${i}`, { x: 100 + i * 120, y: 100 + (i % 2) * 200 });
      nodeIds.push(id);
    }

    // Create 10 relations with explicit manual handles
    interface ExpectedEdgeRecord {
      srcH: HandlePosition;
      tgtH: HandlePosition;
      sourceId: string;
      targetId: string;
      arrowDir: ArrowDirection;
    }
    const trackedEdges: Map<string, ExpectedEdgeRecord> = new Map();

    let counter = 0;
    for (let i = 0; i < 5; i++) {
      for (let j = i + 1; j < 6; j++) {
        if (counter >= 10) break;
        const srcH = CARDINAL_HANDLES[counter % 4];
        const tgtH = CARDINAL_HANDLES[(counter + 2) % 4];
        const arrowDir = ALL_ARROW_DIRECTIONS[counter % 4];

        const rId = store.addRelation(
          nodeIds[i],
          nodeIds[j],
          `Rel_${counter}`,
          'sequence',
          { sourceHandle: srcH, targetHandle: tgtH, manualHandles: true },
          arrowDir
        );
        expect(rId).toBeTruthy();
        trackedEdges.set(rId!, {
          srcH,
          tgtH,
          sourceId: nodeIds[i],
          targetId: nodeIds[j],
          arrowDir,
        });
        counter++;
      }
    }

    // Execute 100 pseudo-random operations
    const edgeIds = Array.from(trackedEdges.keys());

    for (let op = 0; op < 100; op++) {
      const opType = op % 4;

      if (opType === 0) {
        // Move 1-3 random nodes
        const randomNode = nodeIds[op % nodeIds.length];
        const newX = ((op * 137) % 1000) - 200;
        const newY = ((op * 241) % 1000) - 200;
        store.moveNodes([{ conceptId: randomNode, position: { x: newX, y: newY } }]);
      } else if (opType === 1) {
        // Update shape of random node
        const randomNode = nodeIds[op % nodeIds.length];
        const shape = ALL_SHAPES[op % ALL_SHAPES.length];
        store.updateNodeShape(randomNode, shape);
      } else if (opType === 2) {
        // Update relation text / type
        const randomEdgeId = edgeIds[op % edgeIds.length];
        store.updateRelation(randomEdgeId, {
          linkingPhrase: `Phrase_${op}`,
          type: op % 2 === 0 ? 'conditional' : 'sequence',
        });
      } else if (opType === 3) {
        // Reverse relation direction
        const randomEdgeId = edgeIds[op % edgeIds.length];
        store.reverseRelationDirection(randomEdgeId);

        // Update tracking record
        const rec = trackedEdges.get(randomEdgeId)!;
        const oldSrcH = rec.srcH;
        const oldTgtH = rec.tgtH;
        const oldSrcId = rec.sourceId;
        const oldTgtId = rec.targetId;

        rec.srcH = oldTgtH;
        rec.tgtH = oldSrcH;
        rec.sourceId = oldTgtId;
        rec.targetId = oldSrcId;
      }

      // Assert Invariants for ALL tracked manual edges
      const state = useConceptMapStore.getState();
      for (const [rId, expected] of trackedEdges.entries()) {
        const edge = state.visual.edges[rId];
        const rel = state.semantic.relations[rId];

        expect(edge).toBeDefined();
        expect(edge.manualHandles).toBe(true);
        expect(rel.manualHandles).toBe(true);
        expect(edge.sourceHandle).toBe(expected.srcH);
        expect(edge.targetHandle).toBe(expected.tgtH);
        expect(rel.sourceId).toBe(expected.sourceId);
        expect(rel.targetId).toBe(expected.targetId);
        expect(edge.arrowDirection).toBe(expected.arrowDir);
      }
    }
  });
});
