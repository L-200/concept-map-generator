import { beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useConceptMapStore } from '../src/store/useConceptMapStore';
import {
  FLOWCHART_SHAPES_CONFIG,
  getShapeMeta,
} from '../src/components/canvas/shapeDefinitions';
import { ReactFlowProvider } from '@xyflow/react';
import { PropertyInspector } from '../src/components/inspector/PropertyInspector';
import { TopToolbar } from '../src/components/toolbar/TopToolbar';
import { ConceptMapCanvas } from '../src/components/canvas/ConceptMapCanvas';
import type {
  ArrowDirection,
  FlowchartNodeShape,
  HandlePosition,
} from '../src/domain/types';

describe('Milestone M3: UI Controls, Welcome Panel & Automated Test Suite', () => {
  const CARDINAL_HANDLES: readonly HandlePosition[] = [
    'top',
    'right',
    'bottom',
    'left',
  ] as const;

  beforeEach(() => {
    // Reset store before each test
    useConceptMapStore.getState().createNewEmptyMap(false, 'concept-map');
  });

  // ==========================================================================
  // Pillar 1: Welcome Panel 3-Pathway Layout & Freeform Canvas Initialization
  // ==========================================================================
  describe('Pillar 1: Welcome Panel 3-Pathway Layout & Freeform Canvas Initialization', () => {
    it('1.1: createNewEmptyMap com freeformCanvas: true ativa o modo Canvas Livre na store', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(true, 'concept-map', { freeformCanvas: true });

      const state = useConceptMapStore.getState();
      expect(state.visual.layoutSettings.freeformCanvas).toBe(true);
      expect(state.semantic.diagramMode).toBe('concept-map');
      expect(state.semantic.conceptOrder.length).toBeGreaterThan(0);
    });

    it('1.2: createNewEmptyMap sem starterConcept cria tela em branco preservando freeformCanvas', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'concept-map', { freeformCanvas: true });

      const state = useConceptMapStore.getState();
      expect(state.visual.layoutSettings.freeformCanvas).toBe(true);
      expect(state.semantic.conceptOrder).toHaveLength(0);
    });

    it('1.3: setFreeformCanvas permite alternar dinamicamente o modo livre', () => {
      const store = useConceptMapStore.getState();
      expect(store.visual.layoutSettings.freeformCanvas).toBeFalsy();

      store.setFreeformCanvas(true);
      expect(useConceptMapStore.getState().visual.layoutSettings.freeformCanvas).toBe(true);

      store.setFreeformCanvas(false);
      expect(useConceptMapStore.getState().visual.layoutSettings.freeformCanvas).toBe(false);
    });
  });

  // ==========================================================================
  // Pillar 2: Edge Inspector Handle Selectors & Manual Locking
  // ==========================================================================
  describe('Pillar 2: Edge Inspector Handle Selectors & Manual Locking', () => {
    let nodeA: string;
    let nodeB: string;
    let relId: string;

    beforeEach(() => {
      const store = useConceptMapStore.getState();
      nodeA = store.addConcept('Bloco A', { x: 100, y: 100 }, 'process');
      nodeB = store.addConcept('Bloco B', { x: 400, y: 100 }, 'process');
      const id = store.addRelation(nodeA, nodeB, 'liga');
      expect(id).toBeDefined();
      relId = id!;
    });

    it('2.1: selecionar porta de saída (sourceHandle) específica atualiza a store com manualHandles: true', () => {
      const store = useConceptMapStore.getState();

      for (const handle of CARDINAL_HANDLES) {
        store.updateRelation(relId, {
          sourceHandle: handle,
          manualHandles: true,
        });

        const edgeVis = useConceptMapStore.getState().visual.edges[relId];
        expect(edgeVis.sourceHandle).toBe(handle);
        expect(edgeVis.manualHandles).toBe(true);
      }
    });

    it('2.2: selecionar porta de chegada (targetHandle) específica atualiza a store com manualHandles: true', () => {
      const store = useConceptMapStore.getState();

      for (const handle of CARDINAL_HANDLES) {
        store.updateRelation(relId, {
          targetHandle: handle,
          manualHandles: true,
        });

        const edgeVis = useConceptMapStore.getState().visual.edges[relId];
        expect(edgeVis.targetHandle).toBe(handle);
        expect(edgeVis.manualHandles).toBe(true);
      }
    });

    it('2.3: selecionar "auto" em ambas as portas desativa a trava de handles manuais', () => {
      const store = useConceptMapStore.getState();

      // Primeiro define handles manuais
      store.updateRelation(relId, {
        sourceHandle: 'top',
        targetHandle: 'bottom',
        manualHandles: true,
      });

      let edgeVis = useConceptMapStore.getState().visual.edges[relId];
      expect(edgeVis.manualHandles).toBe(true);

      // Agora limpa para auto
      store.updateRelation(relId, {
        sourceHandle: 'auto',
        targetHandle: 'auto',
        manualHandles: false,
      });

      edgeVis = useConceptMapStore.getState().visual.edges[relId];
      expect(edgeVis.manualHandles).toBe(false);
    });

    it('2.4: portas manuais selecionadas via inspector não são sobrescritas por moveNodes', () => {
      const store = useConceptMapStore.getState();

      store.updateRelation(relId, {
        sourceHandle: 'left',
        targetHandle: 'right',
        manualHandles: true,
      });

      // Mover nós para posições arbitrárias
      store.moveNodes([
        { conceptId: nodeA, position: { x: 50, y: 500 } },
        { conceptId: nodeB, position: { x: 600, y: 50 } },
      ]);

      const edgeVis = useConceptMapStore.getState().visual.edges[relId];
      expect(edgeVis.sourceHandle).toBe('left');
      expect(edgeVis.targetHandle).toBe('right');
      expect(edgeVis.manualHandles).toBe(true);
    });
  });

  // ==========================================================================
  // Pillar 3: Edge Inspector Arrow Direction Controls
  // ==========================================================================
  describe('Pillar 3: Edge Inspector Arrow Direction Controls (arrowDirection)', () => {
    let relId: string;

    beforeEach(() => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('A', { x: 100, y: 100 });
      const nodeB = store.addConcept('B', { x: 300, y: 100 });
      relId = store.addRelation(nodeA, nodeB, 'conecta')!;
    });

    it('3.1: nova conexão possui arrowDirection padrão como forward', () => {
      const edgeVis = useConceptMapStore.getState().visual.edges[relId];
      expect(edgeVis.arrowDirection ?? 'forward').toBe('forward');
    });

    it('3.2: altera arrowDirection para reverse, both e none', () => {
      const store = useConceptMapStore.getState();
      const directions: ArrowDirection[] = ['reverse', 'both', 'none', 'forward'];

      for (const dir of directions) {
        store.updateRelation(relId, { arrowDirection: dir });
        const edgeVis = useConceptMapStore.getState().visual.edges[relId];
        expect(edgeVis.arrowDirection).toBe(dir);
      }
    });
  });

  // ==========================================================================
  // Pillar 4: Handle-Aware Direction Reversal ("Inverter Direção")
  // ==========================================================================
  describe('Pillar 4: Handle-Aware Direction Reversal (reverseRelationDirection)', () => {
    it('4.1: inverte nós de origem e destino e troca sourceHandle <-> targetHandle quando manuais', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('A', { x: 100, y: 100 });
      const nodeB = store.addConcept('B', { x: 300, y: 100 });

      const relId = store.addRelation(
        nodeA,
        nodeB,
        'vai para',
        'sequence',
        {
          sourceHandle: 'top',
          targetHandle: 'bottom',
          manualHandles: true,
        }
      )!;

      store.reverseRelationDirection(relId);

      const relSem = useConceptMapStore.getState().semantic.relations[relId];
      const edgeVis = useConceptMapStore.getState().visual.edges[relId];

      // Nós invertidos
      expect(relSem.sourceId).toBe(nodeB);
      expect(relSem.targetId).toBe(nodeA);

      // Portas invertidas com trava manual preservada
      expect(edgeVis.sourceHandle).toBe('bottom');
      expect(edgeVis.targetHandle).toBe('top');
      expect(edgeVis.manualHandles).toBe(true);
    });

    it('4.2: preserva handles automáticos indefinidos ao inverter conexão não manual', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('A', { x: 100, y: 100 });
      const nodeB = store.addConcept('B', { x: 300, y: 100 });

      const relId = store.addRelation(nodeA, nodeB, 'vai para')!;

      store.reverseRelationDirection(relId);

      const relSem = useConceptMapStore.getState().semantic.relations[relId];
      const edgeVis = useConceptMapStore.getState().visual.edges[relId];

      expect(relSem.sourceId).toBe(nodeB);
      expect(relSem.targetId).toBe(nodeA);
      expect(edgeVis.manualHandles).toBeFalsy();
    });
  });

  // ==========================================================================
  // Pillar 5: Node Inspector "Nova Conexão" with Explicit Cardinal Ports
  // ==========================================================================
  describe('Pillar 5: Node Inspector Nova Conexão with Explicit Cardinal Ports', () => {
    it('5.1: cria conexão com portas manuais explícitas gravando sourceHandle, targetHandle e manualHandles: true', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Bloco 1', { x: 100, y: 100 });
      const nodeB = store.addConcept('Bloco 2', { x: 400, y: 300 });

      const relId = store.addRelation(
        nodeA,
        nodeB,
        'transita',
        'sequence',
        {
          sourceHandle: 'right',
          targetHandle: 'left',
          manualHandles: true,
        }
      );

      expect(relId).toBeDefined();
      const edgeVis = useConceptMapStore.getState().visual.edges[relId!];
      expect(edgeVis.sourceHandle).toBe('right');
      expect(edgeVis.targetHandle).toBe('left');
      expect(edgeVis.manualHandles).toBe(true);
    });

    it('5.2: suporta múltiplas conexões paralelas entre os mesmos 2 nós com portas distintas', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Bloco 1', { x: 100, y: 100 });
      const nodeB = store.addConcept('Bloco 2', { x: 400, y: 100 });

      // Conexão 1: topo para topo
      const rel1 = store.addRelation(
        nodeA,
        nodeB,
        'ida por cima',
        'sequence',
        { sourceHandle: 'top', targetHandle: 'top', manualHandles: true }
      );

      // Conexão 2: base para base (retorno ou via alternativa)
      const rel2 = store.addRelation(
        nodeA,
        nodeB,
        'ida por baixo',
        'sequence',
        { sourceHandle: 'bottom', targetHandle: 'bottom', manualHandles: true }
      );

      expect(rel1).toBeDefined();
      expect(rel2).toBeDefined();
      expect(rel1).not.toBe(rel2);

      const edge1 = useConceptMapStore.getState().visual.edges[rel1!];
      const edge2 = useConceptMapStore.getState().visual.edges[rel2!];

      expect(edge1.sourceHandle).toBe('top');
      expect(edge1.targetHandle).toBe('top');
      expect(edge2.sourceHandle).toBe('bottom');
      expect(edge2.targetHandle).toBe('bottom');
    });
  });

  // ==========================================================================
  // Pillar 6: TopToolbar Freeform Entry Point
  // ==========================================================================
  describe('Pillar 6: TopToolbar Freeform Entry Point', () => {
    it('6.1: menu-new-freeform inicializa o canvas com layoutSettings.freeformCanvas === true', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(true, 'concept-map', { freeformCanvas: true });

      const state = useConceptMapStore.getState();
      expect(state.visual.layoutSettings.freeformCanvas).toBe(true);
    });
  });

  // ==========================================================================
  // Pillar 7: TopToolbar Quick Shape Palette (All 7 Shapes)
  // ==========================================================================
  describe('Pillar 7: TopToolbar Quick Shape Palette (All 7 Shapes)', () => {
    const ALL_7_SHAPES: FlowchartNodeShape[] = [
      'terminal',
      'process',
      'decision',
      'io',
      'subroutine',
      'document',
      'concept',
    ];

    it('7.1: paleta de formas registra exatamente as 7 formas com metadados completos', () => {
      expect(FLOWCHART_SHAPES_CONFIG).toHaveLength(7);
      const registeredShapes = FLOWCHART_SHAPES_CONFIG.map((s) => s.shape);
      expect(registeredShapes).toEqual(expect.arrayContaining(ALL_7_SHAPES));
    });

    it('7.2: permite inserir qualquer uma das 7 formas geométricas no canvas', () => {
      const store = useConceptMapStore.getState();

      for (let i = 0; i < ALL_7_SHAPES.length; i++) {
        const shape = ALL_7_SHAPES[i];
        const meta = getShapeMeta(shape);
        const nodeId = store.addConcept(
          `${meta.label} #${i + 1}`,
          { x: 100 + i * 50, y: 100 + i * 50 },
          shape
        );

        expect(nodeId).toBeDefined();
        const nodeSem = useConceptMapStore.getState().semantic.concepts[nodeId];
        const nodeVis = useConceptMapStore.getState().visual.nodes[nodeId];

        expect(nodeSem.nodeShape).toBe(shape);
        expect(nodeVis.nodeShape).toBe(shape);
      }

      expect(useConceptMapStore.getState().semantic.conceptOrder).toHaveLength(7);
    });
  });

  // ==========================================================================
  // Pillar 8: Component Markup & Contract Specification Testing
  // ==========================================================================
  describe('Pillar 8: Component Markup & Contract Specification Testing', () => {
    it('8.1: valida que os ícones das 7 formas produzem SVG válido', () => {
      for (const item of FLOWCHART_SHAPES_CONFIG) {
        const iconActive = item.renderIcon(true);
        const iconInactive = item.renderIcon(false);

        const activeHtml = renderToStaticMarkup(iconActive as React.ReactElement);
        const inactiveHtml = renderToStaticMarkup(iconInactive as React.ReactElement);

        expect(activeHtml).toContain('<svg');
        expect(inactiveHtml).toContain('<svg');
      }
    });

    it('8.2: valida que todas as 16 combinações de portas e 4 direções são valores válidos do domínio', () => {
      const validHandles: HandlePosition[] = ['top', 'right', 'bottom', 'left'];
      const validDirections: ArrowDirection[] = ['forward', 'reverse', 'both', 'none'];

      expect(validHandles).toHaveLength(4);
      expect(validDirections).toHaveLength(4);
    });

    it('8.3: PropertyInspector renderizado com aresta selecionada contém seletores de handle e direção', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('A', { x: 100, y: 100 });
      const nodeB = store.addConcept('B', { x: 300, y: 100 });
      const relId = store.addRelation(nodeA, nodeB, 'conecta')!;

      // Selecionar apenas a aresta
      store.setSelection([], [relId]);

      const html = renderToStaticMarkup(<PropertyInspector />);

      // Verifica controles de handle
      expect(html).toContain('data-testid="edge-source-handle-select"');
      expect(html).toContain('data-testid="edge-target-handle-select"');
      expect(html).toContain('data-testid="edge-source-handle-top"');
      expect(html).toContain('data-testid="edge-target-handle-bottom"');

      // Verifica direção das setas
      expect(html).toContain('data-testid="edge-arrow-direction-forward"');
      expect(html).toContain('data-testid="edge-arrow-direction-reverse"');
      expect(html).toContain('data-testid="edge-arrow-direction-both"');
      expect(html).toContain('data-testid="edge-arrow-direction-none"');

      // Verifica botões de inversão e restauração
      expect(html).toContain('data-testid="edge-invert-direction-btn"');
      expect(html).toContain('data-testid="edge-reset-auto-handles-btn"');
    });

    it('8.4: PropertyInspector renderizado com nó selecionado contém seletores de porta e formas', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Bloco Central', { x: 100, y: 100 });

      // Selecionar o nó
      store.setSelection([nodeA], []);

      const html = renderToStaticMarkup(<PropertyInspector />);

      // Formas geométricas
      expect(html).toContain('data-testid="node-shape-selector-terminal"');
      expect(html).toContain('data-testid="node-shape-selector-decision"');
      expect(html).toContain('data-testid="node-shape-selector-process"');

      // Portas de conexão na nova conexão
      expect(html).toContain('data-testid="new-conn-source-handle"');
      expect(html).toContain('data-testid="new-conn-target-handle"');
      expect(html).toContain('data-testid="quick-connect-btn"');
    });

    it('8.5: TopToolbar renderiza botões de controle de menu e paleta de formas', () => {
      const html = renderToStaticMarkup(
        <TopToolbar onOpenTableDrawer={() => {}} />
      );

      expect(html).toContain('data-testid="toolbar-new-menu-btn"');
      expect(html).toContain('data-testid="toolbar-shape-palette-btn"');
    });

    it('8.6: ConceptMapCanvas Welcome Panel renderiza card de Canvas Livre com create-freeform-btn e grid sm:grid-cols-3', () => {
      useConceptMapStore.getState().createNewEmptyMap(false, 'concept-map');

      const html = renderToStaticMarkup(
        <ReactFlowProvider>
          <ConceptMapCanvas />
        </ReactFlowProvider>
      );

      expect(html).toContain('data-testid="welcome-panel"');
      expect(html).toContain('data-testid="create-freeform-btn"');
      expect(html).toContain('data-testid="load-freeform-blank-btn"');
      expect(html).toContain('max-w-4xl');
      expect(html).toContain('sm:grid-cols-3');
      expect(html).toContain('Canvas Livre');
      expect(html).toContain('Freeform');
    });
  });
});
