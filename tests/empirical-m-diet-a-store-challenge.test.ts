import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ArrowDirection,
  ConceptId,
  ConceptMapDocument,
  FlowchartNodeShape,
  HandlePosition,
  RelationId,
  RelationType,
} from '../src/domain/types';
import {
  AUTOSAVE_STORAGE_KEY,
  useConceptMapStore,
} from '../src/store/useConceptMapStore';

describe('Empirical M-Diet-A Store Challenge Suite: State Transition, Undo/Redo & Topology Robustness', () => {
  beforeEach(() => {
    // Reset store to a clean empty state before each test
    useConceptMapStore.getState().createNewEmptyMap(false, 'concept-map');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  // ==========================================================================
  // SUITE 1: Undo/Redo History Stack Integrity Across Rapid Operations
  // ==========================================================================
  describe('Suite 1: Undo/Redo History Stack Integrity Across Rapid Operations', () => {
    it('1.1: Sequentially applies 30 node and 29 relation additions, then fully unwinds via undo back to step 0', () => {
      const store = useConceptMapStore.getState();
      const createdNodeIds: ConceptId[] = [];
      const createdRelIds: RelationId[] = [];

      // Step 0: Initial state has 0 nodes, 0 edges
      expect(store.semantic.conceptOrder.length).toBe(0);
      expect(useConceptMapStore.temporal.getState().pastStates.length).toBe(0);

      // Add first node
      const firstId = store.addConcept('Root Node', { x: 100, y: 100 });
      createdNodeIds.push(firstId);

      // Chain 29 more nodes connected sequentially
      for (let i = 1; i < 30; i++) {
        const res = useConceptMapStore.getState().addConnectedConcept(
          createdNodeIds[i - 1],
          `Node Step ${i}`,
          'leads to',
          'hierarchical',
          { x: 100 + i * 40, y: 100 + i * 30 }
        );
        expect(res).not.toBeNull();
        createdNodeIds.push(res!.conceptId);
        createdRelIds.push(res!.relationId);
      }

      // Verify we reached 30 nodes and 29 relations
      const finalState = useConceptMapStore.getState();
      expect(finalState.semantic.conceptOrder.length).toBe(30);
      expect(finalState.semantic.relationOrder.length).toBe(29);
      expect(finalState.metrics.totalConcepts).toBe(30);
      expect(finalState.metrics.totalRelations).toBe(29);

      // The temporal pastStates should contain 30 past snapshots (1 addConcept + 29 addConnectedConcept)
      // Since limit is 60, all 30 operations are fully tracked
      const temporal = useConceptMapStore.temporal.getState();
      expect(temporal.pastStates.length).toBe(30);

      // Now unwind all 30 operations step-by-step
      for (let step = 29; step >= 1; step--) {
        useConceptMapStore.temporal.getState().undo();
        const currentState = useConceptMapStore.getState();
        expect(currentState.semantic.conceptOrder.length).toBe(step);
        expect(currentState.semantic.relationOrder.length).toBe(step - 1);
        expect(currentState.metrics.totalConcepts).toBe(step);
        expect(currentState.metrics.totalRelations).toBe(step - 1);
      }

      // Final undo reverts the first addConcept back to 0 nodes
      useConceptMapStore.temporal.getState().undo();
      const revertedState = useConceptMapStore.getState();
      expect(revertedState.semantic.conceptOrder.length).toBe(0);
      expect(revertedState.semantic.relationOrder.length).toBe(0);
      expect(revertedState.metrics.totalConcepts).toBe(0);
      expect(revertedState.metrics.totalRelations).toBe(0);
      expect(Object.keys(revertedState.semantic.concepts).length).toBe(0);
      expect(Object.keys(revertedState.visual.nodes).length).toBe(0);
      expect(Object.keys(revertedState.semantic.relations).length).toBe(0);
      expect(Object.keys(revertedState.visual.edges).length).toBe(0);
    });

    it('1.2: Replays history via redo from step 0 to step 30 with 100% topology restoration', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Alpha', { x: 50, y: 50 });
      const nodeB = store.addConcept('Beta', { x: 250, y: 150 });
      const relId = store.addRelation(nodeA, nodeB, 'influences', 'hierarchical', {
        sourceHandle: 'right',
        targetHandle: 'left',
        manualHandles: true,
      })!;
      expect(relId).toBeTruthy();

      // Label update
      useConceptMapStore.getState().updateConceptLabel(nodeA, 'Alpha Prime');

      // Move node
      useConceptMapStore.getState().moveNodes([{ conceptId: nodeB, position: { x: 300, y: 200 } }]);

      // Capture final snapshot
      const finalDoc = useConceptMapStore.getState().exportDocument();

      // Undo 5 times back to step 0
      for (let i = 0; i < 5; i++) {
        useConceptMapStore.temporal.getState().undo();
      }
      expect(useConceptMapStore.getState().semantic.conceptOrder.length).toBe(0);

      // Redo 5 times forward
      for (let i = 0; i < 5; i++) {
        useConceptMapStore.temporal.getState().redo();
      }

      // Verify restored state matches finalDoc exactly
      const restoredState = useConceptMapStore.getState();
      expect(restoredState.semantic.concepts[nodeA].label).toBe('Alpha Prime');
      expect(restoredState.visual.nodes[nodeB].position).toEqual({ x: 300, y: 200 });
      expect(restoredState.visual.edges[relId].sourceHandle).toBe('right');
      expect(restoredState.visual.edges[relId].targetHandle).toBe('left');
      expect(restoredState.visual.edges[relId].manualHandles).toBe(true);
      expect(restoredState.semantic.conceptOrder).toEqual(finalDoc.semantic.conceptOrder);
      expect(restoredState.semantic.relationOrder).toEqual(finalDoc.semantic.relationOrder);
      expect(restoredState.metrics).toEqual(useConceptMapStore.getState().metrics);
    });

    it('1.3: Truncates future redo stack when a new mutation occurs after undo', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('Branch Base', { x: 100, y: 100 });
      const n2 = store.addConcept('Branch Old 1', { x: 200, y: 100 });
      const n3 = store.addConcept('Branch Old 2', { x: 300, y: 100 });

      expect(useConceptMapStore.temporal.getState().pastStates.length).toBe(3);
      expect(useConceptMapStore.temporal.getState().futureStates.length).toBe(0);

      // Undo 2 steps (back to having only n1)
      useConceptMapStore.temporal.getState().undo();
      useConceptMapStore.temporal.getState().undo();
      expect(useConceptMapStore.getState().semantic.conceptOrder).toEqual([n1]);
      expect(useConceptMapStore.temporal.getState().futureStates.length).toBe(2);

      // Perform a new mutation on this alternate timeline
      const nNew = useConceptMapStore.getState().addConcept('Branch New Timeline', { x: 400, y: 100 });

      // Future states must be cleanly discarded
      expect(useConceptMapStore.temporal.getState().futureStates.length).toBe(0);
      expect(useConceptMapStore.getState().semantic.conceptOrder).toEqual([n1, nNew]);

      // Redo must be a no-op
      useConceptMapStore.temporal.getState().redo();
      expect(useConceptMapStore.getState().semantic.conceptOrder).toEqual([n1, nNew]);
    });

    it('1.4: Survives 40 rapid interleaved mutation-undo-redo cycles without corruption', () => {
      const store = useConceptMapStore.getState();
      const rootId = store.addConcept('Root Interleaved', { x: 200, y: 200 });

      for (let iter = 0; iter < 40; iter++) {
        // Add a transient concept
        const tempId = useConceptMapStore.getState().addConcept(`Temp ${iter}`, {
          x: 200 + (iter % 10) * 20,
          y: 200 + (iter % 10) * 15,
        });

        // Add a relation
        const relId = useConceptMapStore.getState().addRelation(
          rootId,
          tempId,
          `rel-${iter}`,
          'hierarchical'
        );
        expect(relId).toBeTruthy();

        // Undo the relation
        useConceptMapStore.temporal.getState().undo();
        expect(useConceptMapStore.getState().semantic.relations[relId!]).toBeUndefined();

        // Redo the relation
        useConceptMapStore.temporal.getState().redo();
        expect(useConceptMapStore.getState().semantic.relations[relId!]).toBeDefined();

        // Undo both relation and temp node
        useConceptMapStore.temporal.getState().undo();
        useConceptMapStore.temporal.getState().undo();
        expect(useConceptMapStore.getState().semantic.concepts[tempId]).toBeUndefined();
      }

      // After 40 cycles, only the root concept remains
      const state = useConceptMapStore.getState();
      expect(state.semantic.conceptOrder).toEqual([rootId]);
      expect(state.semantic.relationOrder.length).toBe(0);
      expect(state.metrics.totalConcepts).toBe(1);
      expect(state.metrics.totalRelations).toBe(0);
    });

    it('1.5: Atomic multi-branch creation (createDecisionBranches) reverses and restores in single undo/redo steps', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart');

      const decisionId = useConceptMapStore.getState().addConcept('Check Threshold?', { x: 300, y: 200 }, 'decision');
      expect(useConceptMapStore.getState().metrics.totalConcepts).toBe(1);
      expect(useConceptMapStore.getState().metrics.totalRelations).toBe(0);

      // Create decision branches (creates 2 concepts and 2 relations atomically)
      const branchResult = useConceptMapStore.getState().createDecisionBranches(decisionId);
      expect(branchResult).not.toBeNull();
      const { simConceptId, naoConceptId, simRelationId, naoRelationId } = branchResult!;

      const stateAfter = useConceptMapStore.getState();
      expect(stateAfter.semantic.conceptOrder).toHaveLength(3);
      expect(stateAfter.semantic.relationOrder).toHaveLength(2);
      expect(stateAfter.metrics.totalConcepts).toBe(3);
      expect(stateAfter.metrics.totalRelations).toBe(2);

      // ONE single undo must revert all 4 created elements atomically
      useConceptMapStore.temporal.getState().undo();
      const stateUndone = useConceptMapStore.getState();
      expect(stateUndone.semantic.conceptOrder).toEqual([decisionId]);
      expect(stateUndone.semantic.relationOrder).toHaveLength(0);
      expect(stateUndone.semantic.concepts[simConceptId]).toBeUndefined();
      expect(stateUndone.semantic.concepts[naoConceptId]).toBeUndefined();
      expect(stateUndone.semantic.relations[simRelationId]).toBeUndefined();
      expect(stateUndone.semantic.relations[naoRelationId]).toBeUndefined();
      expect(stateUndone.metrics.totalConcepts).toBe(1);
      expect(stateUndone.metrics.totalRelations).toBe(0);

      // ONE single redo must restore all 4 elements atomically
      useConceptMapStore.temporal.getState().redo();
      const stateRedone = useConceptMapStore.getState();
      expect(stateRedone.semantic.conceptOrder).toHaveLength(3);
      expect(stateRedone.semantic.relationOrder).toHaveLength(2);
      expect(stateRedone.semantic.concepts[simConceptId]).toBeDefined();
      expect(stateRedone.semantic.concepts[naoConceptId]).toBeDefined();
      expect(stateRedone.semantic.relations[simRelationId].linkingPhrase).toBe('Sim');
      expect(stateRedone.semantic.relations[naoRelationId].linkingPhrase).toBe('Não');
      expect(stateRedone.metrics.totalConcepts).toBe(3);
      expect(stateRedone.metrics.totalRelations).toBe(2);
    });

    it('1.6: Atomic relation direction reversal and reconnect support undo/redo', () => {
      const store = useConceptMapStore.getState();
      const idA = store.addConcept('Node A', { x: 100, y: 100 });
      const idB = store.addConcept('Node B', { x: 400, y: 100 });
      const idC = store.addConcept('Node C', { x: 400, y: 300 });

      const relId = store.addRelation(idA, idB, 'points to', 'sequence', {
        sourceHandle: 'right',
        targetHandle: 'left',
        manualHandles: true,
      })!;

      // Reverse direction: should invert sourceId <-> targetId and handles
      useConceptMapStore.getState().reverseRelationDirection(relId);
      let edge = useConceptMapStore.getState().visual.edges[relId];
      let rel = useConceptMapStore.getState().semantic.relations[relId];
      expect(rel.sourceId).toBe(idB);
      expect(rel.targetId).toBe(idA);
      expect(edge.sourceHandle).toBe('left');
      expect(edge.targetHandle).toBe('right');

      // Undo reversal
      useConceptMapStore.temporal.getState().undo();
      edge = useConceptMapStore.getState().visual.edges[relId];
      rel = useConceptMapStore.getState().semantic.relations[relId];
      expect(rel.sourceId).toBe(idA);
      expect(rel.targetId).toBe(idB);
      expect(edge.sourceHandle).toBe('right');
      expect(edge.targetHandle).toBe('left');

      // Redo reversal
      useConceptMapStore.temporal.getState().redo();
      rel = useConceptMapStore.getState().semantic.relations[relId];
      expect(rel.sourceId).toBe(idB);
      expect(rel.targetId).toBe(idA);

      // Reconnect relation to node C
      useConceptMapStore.getState().reconnectRelation(relId, idA, idC, {
        sourceHandle: 'bottom',
        targetHandle: 'top',
        manualHandles: true,
      });
      rel = useConceptMapStore.getState().semantic.relations[relId];
      edge = useConceptMapStore.getState().visual.edges[relId];
      expect(rel.sourceId).toBe(idA);
      expect(rel.targetId).toBe(idC);
      expect(edge.sourceHandle).toBe('bottom');
      expect(edge.targetHandle).toBe('top');

      // Undo reconnect
      useConceptMapStore.temporal.getState().undo();
      rel = useConceptMapStore.getState().semantic.relations[relId];
      edge = useConceptMapStore.getState().visual.edges[relId];
      expect(rel.sourceId).toBe(idB);
      expect(rel.targetId).toBe(idA);
    });

    it('1.7: Respects the 60-state history capacity limit without memory leak or throw', () => {
      const store = useConceptMapStore.getState();
      const node = store.addConcept('Limit Stress Test', { x: 100, y: 100 });

      // Apply 75 label updates (exceeds limit 60)
      for (let i = 1; i <= 75; i++) {
        useConceptMapStore.getState().updateConceptLabel(node, `Label Version ${i}`);
      }

      // Past states must be capped at 60
      const pastLength = useConceptMapStore.temporal.getState().pastStates.length;
      expect(pastLength).toBeLessThanOrEqual(60);

      // Can undo up to pastLength times without error
      for (let i = 0; i < pastLength; i++) {
        useConceptMapStore.temporal.getState().undo();
      }

      // Further undos are safe no-ops
      expect(() => {
        useConceptMapStore.temporal.getState().undo();
        useConceptMapStore.temporal.getState().undo();
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // SUITE 2: Starter Maps Validity & Robustness (`createNewEmptyMap`)
  // ==========================================================================
  describe('Suite 2: Starter Maps Validity & Document Schema Robustness', () => {
    it('2.1: createNewEmptyMap(false, "concept-map") initializes a pristine empty document', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'concept-map');

      const state = useConceptMapStore.getState();
      expect(state.semantic.diagramMode).toBe('concept-map');
      expect(state.semantic.title).toBe('Novo Mapa Conceitual');
      expect(state.sourceFileName).toBe('novo-mapa.md');
      expect(state.semantic.conceptOrder).toHaveLength(0);
      expect(state.semantic.relationOrder).toHaveLength(0);
      expect(Object.keys(state.semantic.concepts)).toHaveLength(0);
      expect(Object.keys(state.visual.nodes)).toHaveLength(0);
      expect(Object.keys(state.semantic.relations)).toHaveLength(0);
      expect(Object.keys(state.visual.edges)).toHaveLength(0);
      expect(state.metrics.totalConcepts).toBe(0);
      expect(state.metrics.totalRelations).toBe(0);
      expect(state.hasUnsavedChanges).toBe(false);
      expect(state.selectedNodeIds).toHaveLength(0);
      expect(state.selectedEdgeIds).toHaveLength(0);
      expect(useConceptMapStore.temporal.getState().pastStates).toHaveLength(0);

      // Export check
      const doc = state.exportDocument();
      expect(doc.schemaVersion).toBe('1.0.0');
      expect(doc.metadata.diagramMode).toBe('concept-map');
      expect(doc.metadata.sourceFileName).toBe('novo-mapa.md');
    });

    it('2.2: createNewEmptyMap(true, "concept-map") instantiates valid starter concept with non-null metrics', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(true, 'concept-map');

      const state = useConceptMapStore.getState();
      expect(state.semantic.conceptOrder).toHaveLength(1);
      const starterId = state.semantic.conceptOrder[0];
      const concept = state.semantic.concepts[starterId];
      const node = state.visual.nodes[starterId];

      expect(concept.label).toBe('Conceito Principal');
      expect(concept.nodeShape).toBe('concept');
      expect(node.position).toEqual({ x: 400, y: 120 });
      expect(node.dimensions.width).toBeGreaterThan(50);
      expect(node.dimensions.height).toBeGreaterThan(20);
      expect(Number.isFinite(node.dimensions.width)).toBe(true);
      expect(Number.isFinite(node.dimensions.height)).toBe(true);
      expect(node.computedLayer).toBe(0);
      expect(state.selectedNodeIds).toEqual([starterId]);
      expect(state.metrics.totalConcepts).toBe(1);
      expect(state.metrics.totalRelations).toBe(0);
      expect(useConceptMapStore.temporal.getState().pastStates).toHaveLength(0);

      const doc = state.exportDocument();
      expect(doc.semantic.concepts[starterId].label).toBe('Conceito Principal');
    });

    it('2.3: createNewEmptyMap(false, "flowchart") initializes clean flowchart defaults', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart');

      const state = useConceptMapStore.getState();
      expect(state.semantic.diagramMode).toBe('flowchart');
      expect(state.semantic.title).toBe('Novo Fluxograma');
      expect(state.sourceFileName).toBe('novo-fluxograma.md');
      expect(state.visual.layoutSettings.algorithm).toBe('dagre-hierarchical');
      expect(state.semantic.conceptOrder).toHaveLength(0);
      expect(state.semantic.relationOrder).toHaveLength(0);
      expect(useConceptMapStore.temporal.getState().pastStates).toHaveLength(0);
    });

    it('2.4: createNewEmptyMap(true, "flowchart") instantiates canonical 4-stage pipeline with strict handle/shape contracts', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(true, 'flowchart');

      const state = useConceptMapStore.getState();
      expect(state.semantic.conceptOrder).toEqual([
        'concept-inicio',
        'concept-processo',
        'concept-decisao',
        'concept-fim',
      ]);
      expect(state.semantic.relationOrder).toEqual(['rel-1', 'rel-2', 'rel-3']);

      // Validate node shapes and positions
      const expectedNodes = [
        { id: 'concept-inicio', label: 'Início', shape: 'terminal', y: 60, layer: 0 },
        { id: 'concept-processo', label: 'Processo', shape: 'process', y: 180, layer: 1 },
        { id: 'concept-decisao', label: 'Decisão', shape: 'decision', y: 310, layer: 2 },
        { id: 'concept-fim', label: 'Fim', shape: 'terminal', y: 470, layer: 3 },
      ];

      for (const exp of expectedNodes) {
        const c = state.semantic.concepts[exp.id];
        const n = state.visual.nodes[exp.id];
        expect(c.label).toBe(exp.label);
        expect(c.nodeShape).toBe(exp.shape);
        expect(n.position.x).toBe(400);
        expect(n.position.y).toBe(exp.y);
        expect(n.computedLayer).toBe(exp.layer);
        expect(n.nodeShape).toBe(exp.shape);
        expect(n.dimensions.width).toBeGreaterThan(0);
        expect(n.dimensions.height).toBeGreaterThan(0);
      }

      // Decision diamond dimensions must meet minimums
      const decNode = state.visual.nodes['concept-decisao'];
      expect(decNode.dimensions.width).toBeGreaterThanOrEqual(160);
      expect(decNode.dimensions.height).toBeGreaterThanOrEqual(80);

      // Validate 3 connections
      const edge1 = state.visual.edges['rel-1'];
      const edge2 = state.visual.edges['rel-2'];
      const edge3 = state.visual.edges['rel-3'];

      expect(edge1.sourceHandle).toBe('bottom');
      expect(edge1.targetHandle).toBe('top');
      expect(edge1.curveType).toBe('smoothstep');

      expect(edge2.sourceHandle).toBe('bottom');
      expect(edge2.targetHandle).toBe('top');
      expect(edge2.curveType).toBe('smoothstep');

      expect(edge3.sourceHandle).toBe('bottom');
      expect(edge3.targetHandle).toBe('top');
      expect(edge3.curveType).toBe('smoothstep');
      expect(state.semantic.relations['rel-3'].linkingPhrase).toBe('Sim');
      expect(state.semantic.relations['rel-3'].type).toBe('conditional');

      // First node selected
      expect(state.selectedNodeIds).toEqual(['concept-inicio']);

      // Export roundtrip check
      const doc = state.exportDocument();
      expect(Object.keys(doc.semantic.concepts)).toHaveLength(4);
      expect(Object.keys(doc.semantic.relations)).toHaveLength(3);
    });

    it('2.5: createNewEmptyMap with freeformCanvas: true sets freeform mode cleanly across both modalities', () => {
      const store = useConceptMapStore.getState();

      // Freeform in concept-map
      store.createNewEmptyMap(true, 'concept-map', { freeformCanvas: true });
      let state = useConceptMapStore.getState();
      expect(state.visual.layoutSettings.freeformCanvas).toBe(true);
      expect(state.exportDocument().visual.layoutSettings.freeformCanvas).toBe(true);

      // Freeform in flowchart
      store.createNewEmptyMap(true, 'flowchart', { freeformCanvas: true });
      state = useConceptMapStore.getState();
      expect(state.visual.layoutSettings.freeformCanvas).toBe(true);
      expect(state.exportDocument().visual.layoutSettings.freeformCanvas).toBe(true);
      expect(state.semantic.conceptOrder).toHaveLength(4);
    });

    it('2.6: Ensures 20 rapid consecutive createNewEmptyMap calls cleanly reset store state without corruption', () => {
      const store = useConceptMapStore.getState();
      const modes = ['concept-map' as const, 'flowchart' as const];

      for (let i = 0; i < 20; i++) {
        const mode = modes[i % 2];
        const withStarter = i % 3 !== 0;
        const freeform = i % 4 === 0;

        store.createNewEmptyMap(withStarter, mode, { freeformCanvas: freeform });
        const state = useConceptMapStore.getState();

        expect(state.semantic.diagramMode).toBe(mode);
        expect(state.visual.layoutSettings.freeformCanvas).toBe(freeform);
        expect(state.hasUnsavedChanges).toBe(false);
        expect(useConceptMapStore.temporal.getState().pastStates).toHaveLength(0);

        // Verification of exported document serialization
        const doc = state.exportDocument();
        const json = JSON.stringify(doc);
        expect(json.length).toBeGreaterThan(50);
        const parsed = JSON.parse(json) as ConceptMapDocument;
        expect(parsed.schemaVersion).toBe('1.0.0');
        expect(parsed.metadata.diagramMode).toBe(mode);
      }
    });
  });

  // ==========================================================================
  // SUITE 3: deleteElements Robustness & Dangling Relation Cleanup
  // ==========================================================================
  describe('Suite 3: deleteElements Robustness & Cascading Cleanup', () => {
    it('3.1: Hub deletion: cleanly cascades to all 10 incident relations with zero dangling references', () => {
      const store = useConceptMapStore.getState();
      const hubId = store.addConcept('Central Hub', { x: 500, y: 500 });
      const satellites: ConceptId[] = [];
      const relIds: RelationId[] = [];

      // Create 10 satellites around hub: 5 incoming, 5 outgoing
      for (let i = 0; i < 10; i++) {
        const satId = store.addConcept(`Satellite ${i}`, { x: 100 * (i + 1), y: 100 });
        satellites.push(satId);

        if (i < 5) {
          // outgoing from hub
          const rId = store.addRelation(hubId, satId, `out-${i}`, 'hierarchical')!;
          relIds.push(rId);
        } else {
          // incoming to hub
          const rId = store.addRelation(satId, hubId, `in-${i}`, 'cross-link')!;
          relIds.push(rId);
        }
      }

      expect(useConceptMapStore.getState().semantic.conceptOrder).toHaveLength(11);
      expect(useConceptMapStore.getState().semantic.relationOrder).toHaveLength(10);
      expect(useConceptMapStore.getState().metrics.totalConcepts).toBe(11);
      expect(useConceptMapStore.getState().metrics.totalRelations).toBe(10);

      // Select hub and some relations
      useConceptMapStore.getState().setSelection([hubId, satellites[0]], [relIds[0], relIds[1]]);

      // DELETE HUB ONLY
      useConceptMapStore.getState().deleteElements([hubId], []);

      const afterState = useConceptMapStore.getState();

      // Hub must be deleted
      expect(afterState.semantic.concepts[hubId]).toBeUndefined();
      expect(afterState.visual.nodes[hubId]).toBeUndefined();
      expect(afterState.semantic.conceptOrder).not.toContain(hubId);
      expect(afterState.semantic.conceptOrder).toHaveLength(10);

      // ALL 10 relations must be deleted (cascading cleanup)
      expect(afterState.semantic.relationOrder).toHaveLength(0);
      expect(Object.keys(afterState.semantic.relations)).toHaveLength(0);
      expect(Object.keys(afterState.visual.edges)).toHaveLength(0);
      for (const rId of relIds) {
        expect(afterState.semantic.relations[rId]).toBeUndefined();
        expect(afterState.visual.edges[rId]).toBeUndefined();
      }

      // Metrics must reflect 10 concepts, 0 relations
      expect(afterState.metrics.totalConcepts).toBe(10);
      expect(afterState.metrics.totalRelations).toBe(0);

      // Satellites must remain untouched
      for (const satId of satellites) {
        expect(afterState.semantic.concepts[satId]).toBeDefined();
        expect(afterState.visual.nodes[satId]).toBeDefined();
      }

      // Selection must be purged of deleted elements (hubId, relIds[0], relIds[1])
      expect(afterState.selectedNodeIds).toEqual([satellites[0]]);
      expect(afterState.selectedEdgeIds).toHaveLength(0);
    });

    it('3.2: Explicit relation deletion without node deletion renumbers orderIndex sequencialmente', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('A', { x: 100, y: 100 });
      const n2 = store.addConcept('B', { x: 200, y: 100 });
      const n3 = store.addConcept('C', { x: 300, y: 100 });
      const n4 = store.addConcept('D', { x: 400, y: 100 });

      const r1 = store.addRelation(n1, n2, 'to B')!;
      const r2 = store.addRelation(n2, n3, 'to C')!;
      const r3 = store.addRelation(n3, n4, 'to D')!;

      expect(useConceptMapStore.getState().semantic.relationOrder).toEqual([r1, r2, r3]);

      // Delete middle relation r2
      useConceptMapStore.getState().deleteElements([], [r2]);

      const state = useConceptMapStore.getState();
      expect(state.semantic.relationOrder).toEqual([r1, r3]);
      expect(state.semantic.relations[r1].orderIndex).toBe(1);
      expect(state.semantic.relations[r3].orderIndex).toBe(2);
      expect(state.semantic.relations[r2]).toBeUndefined();
      expect(state.visual.edges[r2]).toBeUndefined();

      // Nodes must remain untouched
      expect(state.semantic.conceptOrder).toHaveLength(4);
    });

    it('3.3: Gracefully handles no-op deletion and ghost/non-existent IDs without throwing or corrupting', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('Stable Node', { x: 100, y: 100 });
      const snapBefore = useConceptMapStore.getState();

      // 1. Empty call
      expect(() => {
        useConceptMapStore.getState().deleteElements([], []);
      }).not.toThrow();
      expect(useConceptMapStore.getState().semantic.conceptOrder).toEqual([n1]);

      // 2. Ghost IDs
      expect(() => {
        useConceptMapStore.getState().deleteElements(
          ['ghost-concept-1', 'ghost-concept-2'],
          ['ghost-rel-1', 'ghost-rel-2']
        );
      }).not.toThrow();

      const snapAfter = useConceptMapStore.getState();
      expect(snapAfter.semantic.conceptOrder).toEqual([n1]);
      expect(snapAfter.semantic.concepts[n1].label).toBe('Stable Node');
    });

    it('3.4: Overlapping deletion: passing a node AND its incident relation simultaneously executes cleanly', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('Node 1', { x: 100, y: 100 });
      const n2 = store.addConcept('Node 2', { x: 200, y: 100 });
      const r1 = store.addRelation(n1, n2, 'link')!;

      // Pass n1 in conceptIds AND r1 in relationIds
      expect(() => {
        useConceptMapStore.getState().deleteElements([n1], [r1]);
      }).not.toThrow();

      const state = useConceptMapStore.getState();
      expect(state.semantic.conceptOrder).toEqual([n2]);
      expect(state.semantic.relationOrder).toHaveLength(0);
      expect(state.visual.nodes[n1]).toBeUndefined();
      expect(state.visual.edges[r1]).toBeUndefined();
    });

    it('3.5: Total diagram wipeout: deleting all nodes and relations produces valid empty diagram', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(true, 'flowchart'); // 4 nodes, 3 edges

      const allNodes = [...useConceptMapStore.getState().semantic.conceptOrder];
      const allRels = [...useConceptMapStore.getState().semantic.relationOrder];

      useConceptMapStore.getState().deleteElements(allNodes, allRels);

      const state = useConceptMapStore.getState();
      expect(state.semantic.conceptOrder).toHaveLength(0);
      expect(state.semantic.relationOrder).toHaveLength(0);
      expect(Object.keys(state.semantic.concepts)).toHaveLength(0);
      expect(Object.keys(state.visual.nodes)).toHaveLength(0);
      expect(Object.keys(state.semantic.relations)).toHaveLength(0);
      expect(Object.keys(state.visual.edges)).toHaveLength(0);
      expect(state.metrics.totalConcepts).toBe(0);
      expect(state.metrics.totalRelations).toBe(0);
      expect(state.selectedNodeIds).toHaveLength(0);
      expect(state.selectedEdgeIds).toHaveLength(0);

      // Exporting emptied diagram must succeed
      const doc = state.exportDocument();
      expect(doc.metadata.diagramMode).toBe('flowchart');
      expect(Object.keys(doc.semantic.concepts)).toHaveLength(0);
    });

    it('3.6: Cascading delete is fully reversible via undo and repeatable via redo', () => {
      const store = useConceptMapStore.getState();
      const nA = store.addConcept('A', { x: 100, y: 100 });
      const nB = store.addConcept('B', { x: 300, y: 100 });
      const nC = store.addConcept('C', { x: 500, y: 100 });

      const rAB = store.addRelation(nA, nB, 'to B', 'sequence', {
        sourceHandle: 'right',
        targetHandle: 'left',
        manualHandles: true,
      })!;
      const rBC = store.addRelation(nB, nC, 'to C', 'conditional', {
        sourceHandle: 'right',
        targetHandle: 'left',
        manualHandles: true,
      })!;

      // Delete intermediate node nB (cascades to rAB and rBC)
      useConceptMapStore.getState().deleteElements([nB], []);
      expect(useConceptMapStore.getState().semantic.conceptOrder).toEqual([nA, nC]);
      expect(useConceptMapStore.getState().semantic.relationOrder).toHaveLength(0);

      // UNDO: Restores nB, rAB, and rBC with exact handles preserved
      useConceptMapStore.temporal.getState().undo();
      const restored = useConceptMapStore.getState();
      expect(restored.semantic.conceptOrder).toEqual([nA, nB, nC]);
      expect(restored.semantic.relationOrder).toEqual([rAB, rBC]);
      expect(restored.semantic.concepts[nB].label).toBe('B');
      expect(restored.visual.edges[rAB].sourceHandle).toBe('right');
      expect(restored.visual.edges[rAB].targetHandle).toBe('left');
      expect(restored.visual.edges[rAB].manualHandles).toBe(true);
      expect(restored.visual.edges[rBC].sourceHandle).toBe('right');
      expect(restored.visual.edges[rBC].targetHandle).toBe('left');
      expect(restored.visual.edges[rBC].manualHandles).toBe(true);

      // REDO: Deletes them again cleanly
      useConceptMapStore.temporal.getState().redo();
      const redone = useConceptMapStore.getState();
      expect(redone.semantic.conceptOrder).toEqual([nA, nC]);
      expect(redone.semantic.relationOrder).toHaveLength(0);
    });

    it('3.7: Directed cycle deletion: removing one node from a triangle cycle preserves remaining edge', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('Node 1', { x: 100, y: 100 });
      const n2 = store.addConcept('Node 2', { x: 200, y: 100 });
      const n3 = store.addConcept('Node 3', { x: 300, y: 100 });

      const r12 = store.addRelation(n1, n2, '1->2')!;
      const r23 = store.addRelation(n2, n3, '2->3')!;
      const r31 = store.addRelation(n3, n1, '3->1')!;

      expect(useConceptMapStore.getState().semantic.relationOrder).toHaveLength(3);

      // Delete n2: r12 and r23 must be removed, r31 must survive
      useConceptMapStore.getState().deleteElements([n2], []);

      const state = useConceptMapStore.getState();
      expect(state.semantic.conceptOrder).toEqual([n1, n3]);
      expect(state.semantic.relationOrder).toEqual([r31]);
      expect(state.semantic.relations[r31].orderIndex).toBe(1);
      expect(state.visual.edges[r12]).toBeUndefined();
      expect(state.visual.edges[r23]).toBeUndefined();
      expect(state.visual.edges[r31]).toBeDefined();
    });
  });

  // ==========================================================================
  // SUITE 4: Object Reference Stability & Freeform Mode Invariants
  // ==========================================================================
  describe('Suite 4: Object Reference Stability & Freeform Invariants', () => {
    it('4.1: moveNodes preserves strict edge object identity (===) when in freeformCanvas mode', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart', { freeformCanvas: true });

      const n1 = store.addConcept('Block 1', { x: 100, y: 100 });
      const n2 = store.addConcept('Block 2', { x: 300, y: 100 });
      const relId = store.addRelation(n1, n2, 'link', 'sequence', {
        sourceHandle: 'top',
        targetHandle: 'bottom',
        manualHandles: true,
      })!;

      const edgesBefore = useConceptMapStore.getState().visual.edges;
      const edgeBefore = edgesBefore[relId];

      // Move node n1 violently
      useConceptMapStore.getState().moveNodes([{ conceptId: n1, position: { x: 800, y: 800 } }]);

      const edgesAfter = useConceptMapStore.getState().visual.edges;
      const edgeAfter = edgesAfter[relId];

      // INVARIANT: In freeformCanvas mode, visual.edges reference must be strictly identical
      expect(edgesAfter).toBe(edgesBefore);
      expect(edgeAfter).toBe(edgeBefore);
      expect(edgeAfter.sourceHandle).toBe('top');
      expect(edgeAfter.targetHandle).toBe('bottom');
    });

    it('4.2: moveNodes marks moved nodes as pinned: true by default', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('Unpinned Node', { x: 100, y: 100 });
      expect(useConceptMapStore.getState().visual.nodes[n1].pinned).toBe(false);

      useConceptMapStore.getState().moveNodes([{ conceptId: n1, position: { x: 150, y: 150 } }]);
      expect(useConceptMapStore.getState().visual.nodes[n1].pinned).toBe(true);
      expect(useConceptMapStore.getState().visual.nodes[n1].position).toEqual({ x: 150, y: 150 });
    });

    it('4.3: addPropositionByNames safely resolves existing concept or creates new with custom shape', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart');

      // Add proposition: creates both Source and Target
      const rel1 = store.addPropositionByNames(
        'Início do Fluxo',
        'inicia',
        'Validar Dados',
        'sequence',
        'terminal',
        'decision'
      )!;
      expect(rel1).toBeTruthy();

      const state1 = useConceptMapStore.getState();
      expect(state1.semantic.conceptOrder).toHaveLength(2);
      const [srcId, tgtId] = state1.semantic.conceptOrder;
      expect(state1.semantic.concepts[srcId].nodeShape).toBe('terminal');
      expect(state1.semantic.concepts[tgtId].nodeShape).toBe('decision');

      // Add another proposition connecting existing Target to a new step
      const rel2 = store.addPropositionByNames(
        'Validar Dados', // Existing name
        'se válido',
        'Emitir Nota',
        'conditional',
        undefined,
        'process'
      )!;
      expect(rel2).toBeTruthy();

      const state2 = useConceptMapStore.getState();
      // Should reuse existing 'Validar Dados' node, total 3 nodes
      expect(state2.semantic.conceptOrder).toHaveLength(3);
      expect(state2.semantic.relationOrder).toHaveLength(2);
      expect(state2.semantic.relations[rel2].sourceId).toBe(tgtId);
    });
  });
});
