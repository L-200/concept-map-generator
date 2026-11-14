import { describe, it, expect, beforeEach } from 'vitest';
import { useConceptMapStore } from '../src/store/useConceptMapStore';
import {
  serializeDocumentToJson,
  parseAndValidateJsonDocument,
  generateStandaloneVectorSvg,
} from '../src/services/export/fileExporter';
import type {
  ConceptMapDocument,
  HandlePosition,
  ArrowDirection,
  FlowchartNodeShape,
} from '../src/domain/types';

describe('Milestone M4 Empirical Challenge: JSON Round-Trip, Schema Resilience & Handle Locking', () => {
  beforeEach(() => {
    useConceptMapStore.getState().createNewEmptyMap(false, 'flowchart', {
      freeformCanvas: true,
    });
  });

  // ==========================================================================
  // PILLAR 1: Adversarial Schema Invalidation & Sanitization Oracles
  // ==========================================================================
  describe('Pillar 1: Adversarial Schema Invalidation & Sanitization Oracles', () => {
    it('rejeita primitivos, strings não-JSON e objetos vazios com erros descritivos', () => {
      const invalidInputs = [
        '',
        'not a valid json',
        'null',
        '12345',
        '"just a string"',
        'false',
        '[]',
        '{}',
        JSON.stringify({ semantic: {} }),
        JSON.stringify({ visual: {} }),
        JSON.stringify({ semantic: { concepts: {} }, visual: {} }),
      ];

      for (const input of invalidInputs) {
        expect(
          () => parseAndValidateJsonDocument(input),
          `Input should fail validation: ${input}`
        ).toThrow();
      }
    });

    it('rejeita documentos com arrays ou objetos semânticos obrigatórios ausentes', () => {
      const missingConceptOrder = JSON.stringify({
        schemaVersion: '1.0.0',
        semantic: {
          concepts: {},
          relations: {},
          relationOrder: [],
        },
        visual: { nodes: {}, edges: {} },
      });
      expect(() => parseAndValidateJsonDocument(missingConceptOrder)).toThrow(
        'Arquivo JSON inválido'
      );

      const missingRelationOrder = JSON.stringify({
        schemaVersion: '1.0.0',
        semantic: {
          concepts: {},
          conceptOrder: [],
          relations: {},
        },
        visual: { nodes: {}, edges: {} },
      });
      expect(() => parseAndValidateJsonDocument(missingRelationOrder)).toThrow(
        'Arquivo JSON inválido'
      );
    });

    it('sanitiza coordenadas de nós degeneradas (NaN, Infinity, strings) e preserva coordenadas extremas finitas', () => {
      const corruptDocJson = JSON.stringify({
        schemaVersion: '1.0.0',
        semantic: {
          title: 'Coordenadas Degeneradas',
          concepts: {
            'c-nan': { id: 'c-nan', label: 'NaN Node', depth: 0 },
            'c-inf': { id: 'c-inf', label: 'Inf Node', depth: 0 },
            'c-null': { id: 'c-null', label: 'Null Node', depth: 0 },
            'c-extreme-neg': { id: 'c-extreme-neg', label: 'Extreme Neg', depth: 0 },
            'c-extreme-pos': { id: 'c-extreme-pos', label: 'Extreme Pos', depth: 0 },
            'c-zero': { id: 'c-zero', label: 'Zero Node', depth: 0 },
          },
          conceptOrder: ['c-nan', 'c-inf', 'c-null', 'c-extreme-neg', 'c-extreme-pos', 'c-zero'],
          relations: {},
          relationOrder: [],
        },
        visual: {
          nodes: {
            'c-nan': {
              conceptId: 'c-nan',
              position: { x: 'not-a-number' as any, y: NaN as any },
            },
            'c-inf': {
              conceptId: 'c-inf',
              position: { x: Infinity as any, y: -Infinity as any },
            },
            'c-null': {
              conceptId: 'c-null',
              position: { x: null as any, y: undefined as any },
            },
            'c-extreme-neg': {
              conceptId: 'c-extreme-neg',
              position: { x: -99999999, y: -88888888 },
            },
            'c-extreme-pos': {
              conceptId: 'c-extreme-pos',
              position: { x: 99999999, y: 88888888 },
            },
            'c-zero': {
              conceptId: 'c-zero',
              position: { x: 0, y: 0 },
            },
          },
          edges: {},
        },
      });

      const validated = parseAndValidateJsonDocument(corruptDocJson);

      // Coordenadas degeneradas devem sofrer fallback para {x: 100, y: 100}
      expect(validated.visual.nodes['c-nan'].position).toEqual({ x: 100, y: 100 });
      expect(validated.visual.nodes['c-inf'].position).toEqual({ x: 100, y: 100 });
      expect(validated.visual.nodes['c-null'].position).toEqual({ x: 100, y: 100 });

      // Coordenadas extremas válidas e finitas devem ser rigorosamente preservadas
      expect(validated.visual.nodes['c-extreme-neg'].position).toEqual({
        x: -99999999,
        y: -88888888,
      });
      expect(validated.visual.nodes['c-extreme-pos'].position).toEqual({
        x: 99999999,
        y: 88888888,
      });
      expect(validated.visual.nodes['c-zero'].position).toEqual({ x: 0, y: 0 });
    });

    it('sanitiza valores de strings corruptas em edges (handles, arrowDirection, curveType)', () => {
      const corruptEdgesJson = JSON.stringify({
        schemaVersion: '1.0.0',
        semantic: {
          title: 'Edges Corruptas',
          concepts: {
            'c-1': { id: 'c-1', label: 'C1', depth: 0 },
            'c-2': { id: 'c-2', label: 'C2', depth: 1 },
          },
          conceptOrder: ['c-1', 'c-2'],
          relations: {
            'r-1': { id: 'r-1', sourceId: 'c-1', targetId: 'c-2', type: 'sequence' },
          },
          relationOrder: ['r-1'],
        },
        visual: {
          nodes: {
            'c-1': { conceptId: 'c-1', position: { x: 100, y: 100 } },
            'c-2': { conceptId: 'c-2', position: { x: 200, y: 200 } },
          },
          edges: {
            'r-1': {
              relationId: 'r-1',
              sourceHandle: 'CENTER_UP', // invalid handle
              targetHandle: 'OUT_OF_BOUNDS', // invalid handle
              arrowDirection: 'CIRCULAR', // invalid direction
              curveType: 'HYPERBOLIC', // invalid curve
              manualHandles: 'TRUE_STRING', // non-boolean
              waypoints: [
                null,
                { x: 50, y: 50 },
                { x: NaN, y: 60 },
                { x: 70, y: Infinity },
                { x: 80, y: 80 },
              ],
              labelOffset: {
                x: NaN,
                y: 15,
                t: Infinity,
              },
            },
          },
        },
      });

      const validated = parseAndValidateJsonDocument(corruptEdgesJson);
      const edge = validated.visual.edges['r-1'];

      expect(edge.sourceHandle).toBeUndefined();
      expect(edge.targetHandle).toBeUndefined();
      expect(edge.arrowDirection).toBe('forward');
      expect(edge.curveType).toBe('smoothstep');
      expect(typeof edge.manualHandles).toBe('boolean');

      // Waypoints válidos preservados, inválidos descartados
      expect(edge.waypoints).toEqual([
        { x: 50, y: 50 },
        { x: 80, y: 80 },
      ]);

      // LabelOffset sanitizado: NaN e Infinity -> undefined
      expect(edge.labelOffset?.x).toBeUndefined();
      expect(edge.labelOffset?.y).toBe(15);
      expect(edge.labelOffset?.t).toBeUndefined();
    });

    it('infere manualHandles: true automaticamente quando handles válidos estão presentes mas manualHandles foi omitido', () => {
      const docJson = JSON.stringify({
        schemaVersion: '1.0.0',
        semantic: {
          title: 'Manual Handles Inferred',
          concepts: {
            'c-1': { id: 'c-1', label: 'C1', depth: 0 },
            'c-2': { id: 'c-2', label: 'C2', depth: 1 },
          },
          conceptOrder: ['c-1', 'c-2'],
          relations: {
            'r-1': { id: 'r-1', sourceId: 'c-1', targetId: 'c-2', type: 'sequence' },
          },
          relationOrder: ['r-1'],
        },
        visual: {
          nodes: {
            'c-1': { conceptId: 'c-1', position: { x: 100, y: 100 } },
            'c-2': { conceptId: 'c-2', position: { x: 200, y: 200 } },
          },
          edges: {
            'r-1': {
              relationId: 'r-1',
              sourceHandle: 'left',
              targetHandle: 'right',
              // manualHandles omitido propositalmente
            },
          },
        },
      });

      const validated = parseAndValidateJsonDocument(docJson);
      expect(validated.visual.edges['r-1'].manualHandles).toBe(true);
    });

    it('sanitiza viewport e layoutSettings para limites seguros', () => {
      const docJson = JSON.stringify({
        schemaVersion: '1.0.0',
        semantic: {
          title: 'Viewport Sanitization',
          concepts: {},
          conceptOrder: [],
          relations: {},
          relationOrder: [],
        },
        visual: {
          nodes: {},
          edges: {},
          viewport: {
            x: 'invalid' as any,
            y: Infinity as any,
            zoom: -5, // non-positive zoom
          },
          layoutSettings: {
            algorithm: 'invalid-algo' as any,
            direction: 'DIAGONAL' as any,
            nodeSpacingX: NaN as any,
            nodeSpacingY: -Infinity as any,
            layerSpacing: 'unknown' as any,
            freeformCanvas: 'truthy' as any,
          },
        },
      });

      const validated = parseAndValidateJsonDocument(docJson);
      expect(validated.visual.viewport.x).toBe(0);
      expect(validated.visual.viewport.y).toBe(0);
      expect(validated.visual.viewport.zoom).toBe(1);

      expect(validated.visual.layoutSettings.algorithm).toBe('novak-backbone');
      expect(validated.visual.layoutSettings.direction).toBe('TB');
      expect(validated.visual.layoutSettings.nodeSpacingX).toBe(75);
      expect(validated.visual.layoutSettings.nodeSpacingY).toBe(110);
      expect(validated.visual.layoutSettings.layerSpacing).toBe(115);
      expect(validated.visual.layoutSettings.freeformCanvas).toBe(true);
    });
  });

  // ==========================================================================
  // PILLAR 2: Visual Edge Desynchronization & Synthesis Stress
  // ==========================================================================
  describe('Pillar 2: Visual Edge Desynchronization & Synthesis Stress', () => {
    it('sintetiza arestas visuais com defaults seguros quando visual.edges é um objeto vazio', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('Passo 1', { x: 100, y: 100 });
      const n2 = store.addConcept('Passo 2', { x: 100, y: 250 });
      const n3 = store.addConcept('Passo 3', { x: 100, y: 400 });

      store.addRelation(n1, n2, 'avança', 'sequence');
      store.addRelation(n2, n3, 'conclui', 'sequence');

      const fullDoc = store.exportDocument();
      // Simula arquivo desprovido de seção visual de arestas
      const strippedDoc = {
        ...fullDoc,
        visual: {
          ...fullDoc.visual,
          edges: {},
        },
      };

      const jsonStr = serializeDocumentToJson(strippedDoc as ConceptMapDocument);
      const validated = parseAndValidateJsonDocument(jsonStr);

      // Ambas as arestas devem ter sido sintetizadas
      expect(Object.keys(validated.visual.edges).length).toBe(2);
      for (const relId of validated.semantic.relationOrder) {
        const edge = validated.visual.edges[relId];
        expect(edge).toBeDefined();
        expect(edge.relationId).toBe(relId);
        expect(edge.curveType).toBe('smoothstep');
        expect(edge.arrowDirection).toBe('forward');
        expect(edge.manualHandles).toBe(false);
      }

      // Re-load na store sem exceções
      expect(() => store.loadFromDocument(validated)).not.toThrow();
      const state = useConceptMapStore.getState();
      expect(Object.keys(state.visual.edges).length).toBe(2);

      // Movimentação de nó após re-load com arestas sintetizadas deve computar smart handles normalmente
      store.moveNodes([{ conceptId: n2, position: { x: 200, y: 250 } }]);
      const stateAfterMove = useConceptMapStore.getState();
      expect(stateAfterMove.visual.nodes[n2].position.x).toBe(200);
    });

    it('lida com descompasso entre conceptOrder e concepts sem quebrar visual.nodes', () => {
      const docWithAsymmetricConcepts = JSON.stringify({
        schemaVersion: '1.0.0',
        semantic: {
          title: 'Conceitos Assimétricos',
          concepts: {
            'c-in-dict-only': { id: 'c-in-dict-only', label: 'Dict Only', depth: 0 },
          },
          conceptOrder: ['c-in-order-only'],
          relations: {},
          relationOrder: [],
        },
        visual: {
          nodes: {},
          edges: {},
        },
      });

      const validated = parseAndValidateJsonDocument(docWithAsymmetricConcepts);
      // Deve criar nós para a união de conceptOrder e Object.keys(concepts)
      expect(validated.visual.nodes['c-in-dict-only']).toBeDefined();
      expect(validated.visual.nodes['c-in-order-only']).toBeDefined();
      expect(validated.visual.nodes['c-in-dict-only'].position).toEqual({ x: 100, y: 100 });
      expect(validated.visual.nodes['c-in-order-only'].position).toEqual({ x: 100, y: 100 });
    });
  });

  // ==========================================================================
  // PILLAR 3: Comprehensive 16-Combination Cardinal Handle & 4-Direction Round-Trip Matrix
  // ==========================================================================
  describe('Pillar 3: Comprehensive 16-Combination Cardinal Handle & 4-Direction Round-Trip Matrix', () => {
    it('preserva 100% da matriz de 16 conexões cardinais x 4 direções de seta no ciclo JSON e store', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart', { freeformCanvas: true });

      const n1 = store.addConcept('Origem', { x: 100, y: 100 });
      const n2 = store.addConcept('Destino', { x: 500, y: 500 });

      const CARDINAL_HANDLES: HandlePosition[] = ['top', 'right', 'bottom', 'left'];
      const ARROW_DIRECTIONS: ArrowDirection[] = ['forward', 'reverse', 'both', 'none'];

      const createdRelations: Array<{
        id: string;
        sourceHandle: HandlePosition;
        targetHandle: HandlePosition;
        arrowDirection: ArrowDirection;
        manualHandles: boolean;
      }> = [];

      let index = 0;
      for (const sH of CARDINAL_HANDLES) {
        for (const tH of CARDINAL_HANDLES) {
          const arrowDir = ARROW_DIRECTIONS[index % ARROW_DIRECTIONS.length];
          const isManual = index % 2 === 0; // Alterna manualHandles true / false

          const relId = store.addRelation(
            n1,
            n2,
            `rel-${sH}-${tH}`,
            'sequence',
            {
              sourceHandle: sH,
              targetHandle: tH,
              manualHandles: isManual,
            },
            arrowDir
          );

          expect(relId).not.toBeNull();
          createdRelations.push({
            id: relId!,
            sourceHandle: sH,
            targetHandle: tH,
            arrowDirection: arrowDir,
            manualHandles: isManual,
          });

          index++;
        }
      }

      expect(createdRelations.length).toBe(16);

      // Export document
      const doc = store.exportDocument();
      expect(doc.visual.layoutSettings.freeformCanvas).toBe(true);

      // Serialize to JSON
      const jsonString = serializeDocumentToJson(doc);
      expect(typeof jsonString).toBe('string');
      expect(jsonString.length).toBeGreaterThan(1000);

      // Parse & Validate from JSON
      const validatedDoc = parseAndValidateJsonDocument(jsonString);
      expect(validatedDoc.visual.layoutSettings.freeformCanvas).toBe(true);

      // Re-load in store
      store.loadFromDocument(validatedDoc);
      const reloadedState = useConceptMapStore.getState();

      expect(reloadedState.visual.layoutSettings.freeformCanvas).toBe(true);

      // Oracle verification across all 16 relations
      for (const expected of createdRelations) {
        const edgeInDoc = validatedDoc.visual.edges[expected.id];
        expect(edgeInDoc, `Edge ${expected.id} missing in validated doc`).toBeDefined();
        expect(edgeInDoc.sourceHandle).toBe(expected.sourceHandle);
        expect(edgeInDoc.targetHandle).toBe(expected.targetHandle);
        expect(edgeInDoc.arrowDirection).toBe(expected.arrowDirection);
        expect(edgeInDoc.manualHandles).toBe(expected.manualHandles);

        const edgeInStore = reloadedState.visual.edges[expected.id];
        expect(edgeInStore, `Edge ${expected.id} missing in store`).toBeDefined();
        expect(edgeInStore.sourceHandle).toBe(expected.sourceHandle);
        expect(edgeInStore.targetHandle).toBe(expected.targetHandle);
        expect(edgeInStore.arrowDirection).toBe(expected.arrowDirection);
        expect(edgeInStore.manualHandles).toBe(expected.manualHandles);
      }
    });
  });

  // ==========================================================================
  // PILLAR 4: Post-Reload Node Movement & Handle Lock Oracle (Empirical Lock Guarantee)
  // ==========================================================================
  describe('Pillar 4: Post-Reload Node Movement & Handle Lock Oracle', () => {
    it('mantém handles estritamente travados após loadFromDocument ao mover nós com manualHandles === true', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'concept-map', { freeformCanvas: false });

      const n1 = store.addConcept('A', { x: 100, y: 100 });
      const n2 = store.addConcept('B', { x: 100, y: 300 });

      // R1: Manual handles travados em left -> right
      const r1 = store.addRelation(
        n1,
        n2,
        'manual-rel',
        'sequence',
        {
          sourceHandle: 'left',
          targetHandle: 'right',
          manualHandles: true,
        },
        'forward'
      );

      // R2: Handles automáticos (sem manualHandles)
      const r2 = store.addRelation(
        n1,
        n2,
        'auto-rel',
        'sequence',
        {
          sourceHandle: 'bottom',
          targetHandle: 'top',
          manualHandles: false,
        },
        'forward'
      );

      const exportedDoc = store.exportDocument();
      const json = serializeDocumentToJson(exportedDoc);
      const validated = parseAndValidateJsonDocument(json);

      // Re-load in store
      store.loadFromDocument(validated);

      // Movimento 1: Desloca B para a direita de A (A em (100, 100), B em (500, 100))
      // Em modo TB com layout automático, a conexão automática deve adaptar
      store.moveNodes([{ conceptId: n2, position: { x: 500, y: 100 } }]);
      let state = useConceptMapStore.getState();

      // R1 com manualHandles === true NÃO pode mudar
      expect(state.visual.edges[r1!].sourceHandle).toBe('left');
      expect(state.visual.edges[r1!].targetHandle).toBe('right');
      expect(state.visual.edges[r1!].manualHandles).toBe(true);

      // Movimento 2: Desloca A para abaixo de B (A em (500, 400), B em (500, 100))
      store.moveNodes([{ conceptId: n1, position: { x: 500, y: 400 } }]);
      state = useConceptMapStore.getState();

      // R1 permanece 100% inalterado
      expect(state.visual.edges[r1!].sourceHandle).toBe('left');
      expect(state.visual.edges[r1!].targetHandle).toBe('right');
      expect(state.visual.edges[r1!].manualHandles).toBe(true);

      // Movimento 3: Deslocamento simultâneo de múltiplos nós para posições extremas
      store.moveNodes([
        { conceptId: n1, position: { x: -2000, y: -2000 } },
        { conceptId: n2, position: { x: 4000, y: 4000 } },
      ]);
      state = useConceptMapStore.getState();

      // R1 continua rigorosamente travado
      expect(state.visual.edges[r1!].sourceHandle).toBe('left');
      expect(state.visual.edges[r1!].targetHandle).toBe('right');
      expect(state.visual.edges[r1!].manualHandles).toBe(true);
    });

    it('garante que freeformCanvas: true protege todas as arestas contra sobrescrita mesmo sem manualHandles explícito', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart', { freeformCanvas: true });

      const n1 = store.addConcept('Bloco 1', { x: 100, y: 100 });
      const n2 = store.addConcept('Bloco 2', { x: 100, y: 300 });

      const r1 = store.addRelation(
        n1,
        n2,
        'conexão',
        'sequence',
        {
          sourceHandle: 'top',
          targetHandle: 'bottom',
          manualHandles: false, // Mesmo com false, freeformCanvas deve proteger
        },
        'forward'
      );

      const exportedDoc = store.exportDocument();
      const json = serializeDocumentToJson(exportedDoc);
      const validated = parseAndValidateJsonDocument(json);

      store.loadFromDocument(validated);

      // Move B para a direita
      store.moveNodes([{ conceptId: n2, position: { x: 600, y: 100 } }]);
      const state = useConceptMapStore.getState();

      // Handles permanecem 'top' e 'bottom' porque freeformCanvas === true
      expect(state.visual.edges[r1!].sourceHandle).toBe('top');
      expect(state.visual.edges[r1!].targetHandle).toBe('bottom');
    });

    it('mantém handles manuais travados ao trocar o formato de um nó ou atualizar a relação após reload', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart', { freeformCanvas: true });

      const n1 = store.addConcept('Decisão', { x: 150, y: 150 });
      const n2 = store.addConcept('Processo', { x: 450, y: 150 });
      store.updateNodeShape(n1, 'decision');
      store.updateNodeShape(n2, 'process');

      const r1 = store.addRelation(
        n1,
        n2,
        'sim',
        'yes',
        {
          sourceHandle: 'right',
          targetHandle: 'left',
          manualHandles: true,
        },
        'forward'
      );

      const doc = store.exportDocument();
      const json = serializeDocumentToJson(doc);
      store.loadFromDocument(parseAndValidateJsonDocument(json));

      // 1. Atualiza rótulo e tipo da relação
      store.updateRelation(r1!, { label: 'sim (confirmado)', type: 'yes' });
      let state = useConceptMapStore.getState();
      expect(state.visual.edges[r1!].sourceHandle).toBe('right');
      expect(state.visual.edges[r1!].targetHandle).toBe('left');
      expect(state.visual.edges[r1!].manualHandles).toBe(true);

      // 2. Atualiza formato do nó de origem para 'document'
      store.updateNodeShape(n1, 'document');
      state = useConceptMapStore.getState();
      expect(state.visual.edges[r1!].sourceHandle).toBe('right');
      expect(state.visual.edges[r1!].targetHandle).toBe('left');
      expect(state.visual.edges[r1!].manualHandles).toBe(true);

      // 3. Atualiza formato do nó de destino para 'io'
      store.updateNodeShape(n2, 'io');
      state = useConceptMapStore.getState();
      expect(state.visual.edges[r1!].sourceHandle).toBe('right');
      expect(state.visual.edges[r1!].targetHandle).toBe('left');
      expect(state.visual.edges[r1!].manualHandles).toBe(true);
    });

    it('preserva múltiplas conexões paralelas com portas distintas entre o mesmo par de nós após reload e movimentação', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart', { freeformCanvas: true });

      const n1 = store.addConcept('Origem', { x: 100, y: 100 });
      const n2 = store.addConcept('Destino', { x: 400, y: 100 });

      // 4 conexões paralelas simultâneas entre n1 e n2
      const rTop = store.addRelation(n1, n2, 'ida-topo', 'sequence', {
        sourceHandle: 'top',
        targetHandle: 'top',
        manualHandles: true,
      }, 'forward');

      const rRightLeft = store.addRelation(n1, n2, 'ida-direta', 'sequence', {
        sourceHandle: 'right',
        targetHandle: 'left',
        manualHandles: true,
      }, 'forward');

      const rBottom = store.addRelation(n1, n2, 'ida-base', 'sequence', {
        sourceHandle: 'bottom',
        targetHandle: 'bottom',
        manualHandles: true,
      }, 'forward');

      const rReturn = store.addRelation(n2, n1, 'retorno-loop', 'loop-back', {
        sourceHandle: 'left',
        targetHandle: 'right',
        manualHandles: true,
      }, 'reverse');

      const exported = store.exportDocument();
      const json = serializeDocumentToJson(exported);
      store.loadFromDocument(parseAndValidateJsonDocument(json));

      // Move ambos os nós
      store.moveNodes([
        { conceptId: n1, position: { x: 200, y: 350 } },
        { conceptId: n2, position: { x: 600, y: 50 } },
      ]);

      const state = useConceptMapStore.getState();
      expect(state.visual.edges[rTop!].sourceHandle).toBe('top');
      expect(state.visual.edges[rTop!].targetHandle).toBe('top');

      expect(state.visual.edges[rRightLeft!].sourceHandle).toBe('right');
      expect(state.visual.edges[rRightLeft!].targetHandle).toBe('left');

      expect(state.visual.edges[rBottom!].sourceHandle).toBe('bottom');
      expect(state.visual.edges[rBottom!].targetHandle).toBe('bottom');

      expect(state.visual.edges[rReturn!].sourceHandle).toBe('left');
      expect(state.visual.edges[rReturn!].targetHandle).toBe('right');
      expect(state.visual.edges[rReturn!].arrowDirection).toBe('reverse');
    });
  });

  // ==========================================================================
  // PILLAR 5: Deep Topologies, Adversarial Strings & Multi-Cycle Idempotency
  // ==========================================================================
  describe('Pillar 5: Deep Topologies, Adversarial Strings & Multi-Cycle Idempotency', () => {
    it('processa e preserva sem perdas strings adversárias (XSS, emojis, aspas, quebras de linha e caracteres especiais)', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart', { freeformCanvas: true });

      const labelAdversarial1 = '<script>alert("xss")</script> & "quotes" \'single\'';
      const labelAdversarial2 = '💡 Conceito com Emojis 🚀 e acentuação: Ação e Reação!';
      const labelRel = 'relação com <svg/onload=alert(1)> e caracteres çãõ & < >';

      const n1 = store.addConcept(labelAdversarial1, { x: 100, y: 100 });
      const n2 = store.addConcept(labelAdversarial2, { x: 300, y: 300 });

      const r1 = store.addRelation(
        n1,
        n2,
        labelRel,
        'sequence',
        {
          sourceHandle: 'right',
          targetHandle: 'left',
          manualHandles: true,
        },
        'both'
      );

      const exported = store.exportDocument();
      const json = serializeDocumentToJson(exported);
      const parsed = parseAndValidateJsonDocument(json);

      // Verifica fidelidade semântica
      expect(parsed.semantic.concepts[n1].label).toBe(labelAdversarial1);
      expect(parsed.semantic.concepts[n2].label).toBe(labelAdversarial2);
      expect(parsed.semantic.relations[r1!].linkingPhrase).toBe(labelRel);

      // Carrega na store e gera SVG vetorial
      store.loadFromDocument(parsed);
      const state = useConceptMapStore.getState();
      const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      // SVG deve ter escapado as tags perigosas
      expect(svg).not.toContain('<script>');
      expect(svg).toContain('&lt;script&gt;');
      expect(svg).toContain('&amp;');

      // Verifica também que JSON raw com quebras de linha em concepts é preservado sem perdas
      const rawMultilineJson = JSON.stringify({
        schemaVersion: '1.0.0',
        metadata: { id: 'multiline' },
        semantic: {
          concepts: {
            'c-m': { id: 'c-m', label: 'Linha 1\nLinha 2\nLinha 3', depth: 0 },
          },
          conceptOrder: ['c-m'],
          relations: {},
          relationOrder: [],
        },
        visual: { nodes: {}, edges: {} },
      });
      const parsedMultiline = parseAndValidateJsonDocument(rawMultilineJson);
      expect(parsedMultiline.semantic.concepts['c-m'].label).toBe('Linha 1\nLinha 2\nLinha 3');
    });

    it('mantém estrita idempotência byte-a-byte através de 10 ciclos consecutivos de serialize -> parse', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart', { freeformCanvas: true });

      const n1 = store.addConcept('A', { x: 100, y: 100 });
      const n2 = store.addConcept('B', { x: 300, y: 100 });
      store.updateNodeShape(n1, 'decision');
      store.updateNodeShape(n2, 'process');

      store.addRelation(n1, n2, 'teste', 'sequence', {
        sourceHandle: 'bottom',
        targetHandle: 'top',
        manualHandles: true,
      }, 'reverse');

      // Canonicaliza o documento inicial através de parseAndValidateJsonDocument
      const canonicalDoc = parseAndValidateJsonDocument(
        serializeDocumentToJson(store.exportDocument())
      );
      const canonicalJson = serializeDocumentToJson(canonicalDoc);

      let currentJson = canonicalJson;
      for (let cycle = 1; cycle <= 10; cycle++) {
        const parsed = parseAndValidateJsonDocument(currentJson);
        const reSerialized = serializeDocumentToJson(parsed);

        expect(
          reSerialized,
          `Cycle ${cycle} drifted from canonical serialization`
        ).toBe(canonicalJson);
        currentJson = reSerialized;
      }
    });

    it('preserva diagramMode ("flowchart" / "concept-map") e limpa histórico temporal ao recarregar documento', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart', { freeformCanvas: true });
      const n1 = store.addConcept('Início', { x: 100, y: 100 }, 'terminal');
      const n2 = store.addConcept('Fim', { x: 100, y: 300 }, 'terminal');
      store.addRelation(n1, n2, 'fluxo', 'sequence', {
        sourceHandle: 'bottom',
        targetHandle: 'top',
        manualHandles: true,
      });

      const exported = store.exportDocument();
      expect(exported.metadata.diagramMode).toBe('flowchart');
      expect(exported.semantic.diagramMode).toBe('flowchart');

      const json = serializeDocumentToJson(exported);
      const parsed = parseAndValidateJsonDocument(json);

      expect(parsed.metadata.diagramMode).toBe('flowchart');
      expect(parsed.semantic.diagramMode).toBe('flowchart');

      store.loadFromDocument(parsed);
      expect(useConceptMapStore.getState().semantic.diagramMode).toBe('flowchart');

      // Histórico temporal deve estar limpo
      expect(useConceptMapStore.temporal.getState().pastStates.length).toBe(0);

      // Movimento após load grava histórico de undo
      store.moveNodes([{ conceptId: n2, position: { x: 300, y: 300 } }]);
      expect(useConceptMapStore.temporal.getState().pastStates.length).toBe(1);

      // Desfaz (undo) e verifica restauração com handles manuais intactos
      useConceptMapStore.temporal.getState().undo();
      const afterUndo = useConceptMapStore.getState();
      expect(afterUndo.visual.nodes[n2].position.x).toBe(100);
      expect(afterUndo.visual.nodes[n2].position.y).toBe(300);
      const edge = Object.values(afterUndo.visual.edges)[0];
      expect(edge.manualHandles).toBe(true);
      expect(edge.sourceHandle).toBe('bottom');
      expect(edge.targetHandle).toBe('top');
    });

    it('processa e serializa documento completamente vazio (0 nós, 0 arestas) sem exceções', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'concept-map', { freeformCanvas: true });

      const emptyDoc = store.exportDocument();
      expect(emptyDoc.semantic.conceptOrder.length).toBe(0);
      expect(emptyDoc.semantic.relationOrder.length).toBe(0);

      const json = serializeDocumentToJson(emptyDoc);
      const parsed = parseAndValidateJsonDocument(json);

      expect(parsed.semantic.conceptOrder).toEqual([]);
      expect(parsed.semantic.relationOrder).toEqual([]);
      expect(parsed.visual.nodes).toEqual({});
      expect(parsed.visual.edges).toEqual({});

      expect(() => store.loadFromDocument(parsed)).not.toThrow();
    });

    it('lida com handles definidos explicitamente como "auto" sanitizando para auto e manualHandles: false', () => {
      const docWithAuto = JSON.stringify({
        schemaVersion: '1.0.0',
        metadata: { id: 'auto-handles' },
        semantic: {
          title: 'Auto Handles',
          concepts: {
            'c-1': { id: 'c-1', label: 'C1', depth: 0 },
            'c-2': { id: 'c-2', label: 'C2', depth: 1 },
          },
          conceptOrder: ['c-1', 'c-2'],
          relations: {
            'r-1': { id: 'r-1', sourceId: 'c-1', targetId: 'c-2', type: 'sequence' },
          },
          relationOrder: ['r-1'],
        },
        visual: {
          nodes: {
            'c-1': { conceptId: 'c-1', position: { x: 100, y: 100 } },
            'c-2': { conceptId: 'c-2', position: { x: 100, y: 300 } },
          },
          edges: {
            'r-1': {
              relationId: 'r-1',
              sourceHandle: 'auto',
              targetHandle: 'auto',
              // manualHandles não especificado
            },
          },
        },
      });

      const parsed = parseAndValidateJsonDocument(docWithAuto);
      expect(parsed.visual.edges['r-1'].sourceHandle).toBe('auto');
      expect(parsed.visual.edges['r-1'].targetHandle).toBe('auto');
      expect(parsed.visual.edges['r-1'].manualHandles).toBe(false);
    });

    it('serializa e desserializa topologia cíclica densa (C10) com 10 nós e 10 arestas manuais sem estouro ou perda', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart', { freeformCanvas: true });

      const SHAPES: FlowchartNodeShape[] = [
        'terminal',
        'process',
        'decision',
        'io',
        'subroutine',
        'document',
        'concept',
        'process',
        'decision',
        'terminal',
      ];

      const nodeIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const id = store.addConcept(`Nó-${i}`, {
          x: Math.round(400 + 250 * Math.cos((2 * Math.PI * i) / 10)),
          y: Math.round(400 + 250 * Math.sin((2 * Math.PI * i) / 10)),
        });
        store.updateNodeShape(id, SHAPES[i]);
        nodeIds.push(id);
      }

      // Conecta ciclo C10: 0->1->2->...->9->0
      const relIds: string[] = [];
      const CARDINALS: HandlePosition[] = ['top', 'right', 'bottom', 'left'];
      for (let i = 0; i < 10; i++) {
        const src = nodeIds[i];
        const tgt = nodeIds[(i + 1) % 10];
        const sH = CARDINALS[i % 4];
        const tH = CARDINALS[(i + 2) % 4];

        const relId = store.addRelation(
          src,
          tgt,
          `c-${i}->${(i + 1) % 10}`,
          'sequence',
          {
            sourceHandle: sH,
            targetHandle: tH,
            manualHandles: true,
          },
          i % 2 === 0 ? 'forward' : 'reverse'
        );
        relIds.push(relId!);
      }

      const doc = store.exportDocument();
      const json = serializeDocumentToJson(doc);
      const validated = parseAndValidateJsonDocument(json);

      expect(Object.keys(validated.visual.nodes).length).toBe(10);
      expect(Object.keys(validated.visual.edges).length).toBe(10);

      store.loadFromDocument(validated);
      const restored = useConceptMapStore.getState();

      for (let i = 0; i < 10; i++) {
        const rId = relIds[i];
        const edge = restored.visual.edges[rId];
        expect(edge.manualHandles).toBe(true);
        expect(edge.sourceHandle).toBe(CARDINALS[i % 4]);
        expect(edge.targetHandle).toBe(CARDINALS[(i + 2) % 4]);
        expect(edge.arrowDirection).toBe(i % 2 === 0 ? 'forward' : 'reverse');
      }
    });
  });
});
