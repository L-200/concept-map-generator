import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { useConceptMapStore } from '../useConceptMapStore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exemploPath = path.resolve(__dirname, '../../../exemplo.md');
const rawMarkdown = fs.readFileSync(exemploPath, 'utf-8');

describe('useConceptMapStore & Undo/Redo (Etapa 4)', () => {
  let storageMap: Record<string, string> = {};
  const mockStorage = {
    getItem: (key: string) => storageMap[key] ?? null,
    setItem: (key: string, value: string) => {
      storageMap[key] = String(value);
    },
    removeItem: (key: string) => {
      delete storageMap[key];
    },
    clear: () => {
      storageMap = {};
    },
  };

  beforeEach(async () => {
    storageMap = {};
    (globalThis as any).localStorage = mockStorage;
    if (typeof (globalThis as any).window === 'undefined') {
      (globalThis as any).window = globalThis;
    }
    (globalThis as any).window.localStorage = mockStorage;

    await useConceptMapStore.getState().loadFromMarkdown(rawMarkdown, 'exemplo.md');
  });

  it('carrega exemplo.md e inicializa 32 nós e 46 arestas no estado semântico e visual', () => {
    const state = useConceptMapStore.getState();
    expect(state.metrics.totalConcepts).toBe(32);
    expect(state.metrics.totalRelations).toBe(46);
    expect(Object.keys(state.visual.nodes)).toHaveLength(32);
    expect(Object.keys(state.visual.edges)).toHaveLength(46);
    expect(state.hasUnsavedChanges).toBe(false);
  });

  it('marca automaticamente um nó como pinned=true ao ser movido manualmente e preserva no re-layout', async () => {
    const store = useConceptMapStore.getState();
    expect(store.visual.nodes['concept-reserva-ducke'].pinned).toBe(false);

    store.moveNodes([
      {
        conceptId: 'concept-reserva-ducke',
        position: { x: 950, y: 420 },
      },
    ]);

    const afterMove = useConceptMapStore.getState();
    expect(afterMove.visual.nodes['concept-reserva-ducke'].position).toEqual({
      x: 950,
      y: 420,
    });
    expect(afterMove.visual.nodes['concept-reserva-ducke'].pinned).toBe(true);
    expect(afterMove.hasUnsavedChanges).toBe(true);

    // Reexecuta layout respeitando nós fixados
    await useConceptMapStore.getState().applyAutoLayout({
      algorithm: 'dagre-hierarchical',
      respectPinnedNodes: true,
    });

    const afterRelayout = useConceptMapStore.getState();
    expect(afterRelayout.visual.nodes['concept-reserva-ducke'].position).toEqual({
      x: 950,
      y: 420,
    });
  });

  it('executa exclusão em cascata de um hub (Membro do parlamento estadual com 11 conexões) e restaura 100% com Undo', () => {
    const store = useConceptMapStore.getState();
    expect(store.metrics.totalConcepts).toBe(32);
    expect(store.metrics.totalRelations).toBe(46);

    // Exclui "Membro do parlamento estadual" (que possui 11 conexões em entrada.md)
    store.deleteElements(['concept-membro-do-parlamento-estadual'], []);

    const afterDelete = useConceptMapStore.getState();
    expect(afterDelete.metrics.totalConcepts).toBe(31);
    expect(afterDelete.metrics.totalRelations).toBe(35);
    expect(
      afterDelete.semantic.concepts['concept-membro-do-parlamento-estadual']
    ).toBeUndefined();

    // Executa Undo (Ctrl+Z)
    useConceptMapStore.temporal.getState().undo();

    const afterUndo = useConceptMapStore.getState();
    expect(afterUndo.metrics.totalConcepts).toBe(32);
    expect(afterUndo.metrics.totalRelations).toBe(46);
    expect(
      afterUndo.semantic.concepts['concept-membro-do-parlamento-estadual']?.label
    ).toBe('Membro do parlamento estadual');

    // Executa Redo (Ctrl+Y)
    useConceptMapStore.temporal.getState().redo();
    expect(useConceptMapStore.getState().metrics.totalRelations).toBe(35);
  });

  it('permite criar novos conceitos, criar conexões, editar frases, alternar tipo e inverter direção', () => {
    const store = useConceptMapStore.getState();
    const newId = store.addConcept('Gestão Participativa', { x: 400, y: 300 });

    expect(useConceptMapStore.getState().semantic.concepts[newId]?.label).toBe(
      'Gestão Participativa'
    );

    const relId = useConceptMapStore
      .getState()
      .addRelation(newId, 'concept-reserva-ducke', 'fortalece', 'cross-link');
    expect(relId).toBeTruthy();

    const stateAfterAdd = useConceptMapStore.getState();
    expect(stateAfterAdd.metrics.totalConcepts).toBe(33);
    expect(stateAfterAdd.metrics.totalRelations).toBe(47);
    expect(stateAfterAdd.semantic.relations[relId!]?.type).toBe('cross-link');

    // Altera frase e tipo para hierárquica
    stateAfterAdd.updateRelation(relId!, {
      linkingPhrase: 'protege diretamente',
      type: 'hierarchical',
    });
    expect(useConceptMapStore.getState().semantic.relations[relId!]?.linkingPhrase).toBe(
      'protege diretamente'
    );
    expect(useConceptMapStore.getState().semantic.relations[relId!]?.type).toBe(
      'hierarchical'
    );

    // Inverte direção (origem <-> destino)
    useConceptMapStore.getState().reverseRelationDirection(relId!);
    const reversed = useConceptMapStore.getState().semantic.relations[relId!];
    expect(reversed?.sourceId).toBe('concept-reserva-ducke');
    expect(reversed?.targetId).toBe(newId);
  });

  it('permite iniciar um novo mapa do zero e construir blocos e ligações manualmente (createNewEmptyMap, addConnectedConcept e addPropositionByNames)', () => {
    const store = useConceptMapStore.getState();

    // 1. Inicia um mapa totalmente em branco
    store.createNewEmptyMap(false);
    expect(useConceptMapStore.getState().metrics.totalConcepts).toBe(0);
    expect(useConceptMapStore.getState().metrics.totalRelations).toBe(0);
    expect(useConceptMapStore.getState().sourceFileName).toBe('novo-mapa.md');

    // 2. Inicia um novo mapa com bloco inicial ("Conceito Principal")
    useConceptMapStore.getState().createNewEmptyMap(true);
    const afterStarter = useConceptMapStore.getState();
    expect(afterStarter.metrics.totalConcepts).toBe(1);
    const rootId = afterStarter.semantic.conceptOrder[0];
    expect(afterStarter.semantic.concepts[rootId]?.label).toBe('Conceito Principal');

    // 3. Ramifica um novo bloco conectado a partir do bloco raiz
    const branched = useConceptMapStore
      .getState()
      .addConnectedConcept(rootId, 'Subconceito A', 'divide-se em', 'hierarchical');
    expect(branched).not.toBeNull();
    expect(useConceptMapStore.getState().metrics.totalConcepts).toBe(2);
    expect(useConceptMapStore.getState().metrics.totalRelations).toBe(1);

    // 4. Adiciona uma proposição completa por nomes (reaproveitando "Conceito Principal" e criando "Subconceito B")
    const relId2 = useConceptMapStore
      .getState()
      .addPropositionByNames(
        'conceito principal', // testa deduplicação case-insensitive
        'também abrange',
        'Subconceito B',
        'hierarchical'
      );
    expect(relId2).toBeTruthy();

    const finalState = useConceptMapStore.getState();
    expect(finalState.metrics.totalConcepts).toBe(3);
    expect(finalState.metrics.totalRelations).toBe(2);

    // Verifica que arestas irmãs saindo do mesmo nó recebem offsets escalonados (38% e 62%)
    const edgeOffsets = Object.values(finalState.visual.edges).map(
      (e) => e.labelOffset?.t
    );
    expect(edgeOffsets).toContain(0.38);
    expect(edgeOffsets).toContain(0.62);
  });

  it('preserva espaços entre palavras (inclusive espaço final durante digitação) ao editar conexões e conceitos', () => {
    const store = useConceptMapStore.getState();

    // Simula digitação tecla a tecla com espaço no final ("relaciona ", "relaciona com ")
    store.updateRelation('rel-1', { linkingPhrase: 'relaciona ' });
    expect(useConceptMapStore.getState().semantic.relations['rel-1'].linkingPhrase).toBe(
      'relaciona '
    );

    store.updateRelation('rel-1', { linkingPhrase: 'relaciona com ' });
    expect(useConceptMapStore.getState().semantic.relations['rel-1'].linkingPhrase).toBe(
      'relaciona com '
    );

    store.updateRelation('rel-1', { linkingPhrase: 'relaciona com vários blocos' });
    expect(useConceptMapStore.getState().semantic.relations['rel-1'].linkingPhrase).toBe(
      'relaciona com vários blocos'
    );

    // Simula digitação com espaço no rótulo de conceito
    store.updateConceptLabel('concept-projeto-pop', 'Projeto ');
    expect(
      useConceptMapStore.getState().semantic.concepts['concept-projeto-pop'].label
    ).toBe('Projeto ');
  });

  describe('Fluxogramas & Ações Estendidas de Estado (Milestone 2)', () => {
    it('alterna para modo flowchart (setDiagramMode), define curva ortogonal (smoothstep) e restaura com Undo', () => {
      const store = useConceptMapStore.getState();
      expect(store.semantic.diagramMode ?? 'concept-map').toBe('concept-map');

      // Alterna para fluxograma
      store.setDiagramMode('flowchart');
      const stateFlow = useConceptMapStore.getState();
      expect(stateFlow.semantic.diagramMode).toBe('flowchart');
      expect(stateFlow.hasUnsavedChanges).toBe(true);

      // Todas as arestas em fluxograma assumem curva smoothstep
      for (const edge of Object.values(stateFlow.visual.edges)) {
        expect(edge.curveType).toBe('smoothstep');
      }

      // Reverte via Undo
      useConceptMapStore.temporal.getState().undo();
      const stateUndone = useConceptMapStore.getState();
      expect(stateUndone.semantic.diagramMode ?? 'concept-map').toBe('concept-map');

      // Re-aplica via Redo
      useConceptMapStore.temporal.getState().redo();
      expect(useConceptMapStore.getState().semantic.diagramMode).toBe('flowchart');
    });

    it('atualiza o formato de nó (updateNodeShape) para formas geométricas e recalcula dimensões de forma reversível via Undo', () => {
      const store = useConceptMapStore.getState();
      const targetId = 'concept-projeto-pop';
      const initialVisual = store.visual.nodes[targetId];
      expect(store.semantic.concepts[targetId]).toBeDefined();

      // Atualiza para decision (losango)
      store.updateNodeShape(targetId, 'decision');
      const afterDecision = useConceptMapStore.getState();
      expect(afterDecision.semantic.concepts[targetId].nodeShape).toBe('decision');
      expect(afterDecision.visual.nodes[targetId].nodeShape).toBe('decision');
      // Dimensões do losango devem ser ampliadas em relação ao conceito original
      expect(afterDecision.visual.nodes[targetId].dimensions?.width).toBeGreaterThanOrEqual(
        initialVisual.dimensions?.width ?? 140
      );

      // Atualiza sucessivamente para outras formas válidas
      store.updateNodeShape(targetId, 'io');
      expect(useConceptMapStore.getState().semantic.concepts[targetId].nodeShape).toBe('io');

      store.updateNodeShape(targetId, 'terminal');
      expect(useConceptMapStore.getState().semantic.concepts[targetId].nodeShape).toBe('terminal');

      // Undo restaura forma anterior (io)
      useConceptMapStore.temporal.getState().undo();
      expect(useConceptMapStore.getState().semantic.concepts[targetId].nodeShape).toBe('io');

      // Undo restaura decision
      useConceptMapStore.temporal.getState().undo();
      expect(useConceptMapStore.getState().semantic.concepts[targetId].nodeShape).toBe('decision');
    });

    it('cria tela em branco diferenciando modo concept-map e flowchart (createNewEmptyMap)', () => {
      const store = useConceptMapStore.getState();

      // Tela em branco concept-map
      store.createNewEmptyMap(false, 'concept-map');
      const blankConcept = useConceptMapStore.getState();
      expect(blankConcept.metrics.totalConcepts).toBe(0);
      expect(blankConcept.semantic.diagramMode).toBe('concept-map');
      expect(blankConcept.sourceFileName).toBe('novo-mapa.md');

      // Tela em branco flowchart
      store.createNewEmptyMap(false, 'flowchart');
      const blankFlow = useConceptMapStore.getState();
      expect(blankFlow.metrics.totalConcepts).toBe(0);
      expect(blankFlow.semantic.diagramMode).toBe('flowchart');
      expect(blankFlow.sourceFileName).toBe('novo-fluxograma.md');
      expect(blankFlow.visual.layoutSettings.algorithm).toBe('dagre-hierarchical');
    });

    it('cria pipeline inicial completo para fluxograma: Início -> Processo -> Decisão -> Fim (createNewEmptyMap(true, "flowchart"))', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(true, 'flowchart');

      const state = useConceptMapStore.getState();
      expect(state.metrics.totalConcepts).toBe(4);
      expect(state.metrics.totalRelations).toBe(3);
      expect(state.semantic.diagramMode).toBe('flowchart');
      expect(state.semantic.title).toBe('Novo Fluxograma');
      expect(state.sourceFileName).toBe('novo-fluxograma.md');

      // Valida os 4 nós canônicos
      const concepts = state.semantic.conceptOrder.map((id) => state.semantic.concepts[id]);
      expect(concepts[0].label).toBe('Início');
      expect(concepts[0].nodeShape).toBe('terminal');
      expect(concepts[1].label).toBe('Processo');
      expect(concepts[1].nodeShape).toBe('process');
      expect(concepts[2].label).toBe('Decisão');
      expect(concepts[2].nodeShape).toBe('decision');
      expect(concepts[3].label).toBe('Fim');
      expect(concepts[3].nodeShape).toBe('terminal');

      // Valida as 3 conexões
      const relations = state.semantic.relationOrder.map((id) => state.semantic.relations[id]);
      expect(relations[0].sourceId).toBe('concept-inicio');
      expect(relations[0].targetId).toBe('concept-processo');
      expect(relations[0].type).toBe('sequence');

      expect(relations[1].sourceId).toBe('concept-processo');
      expect(relations[1].targetId).toBe('concept-decisao');
      expect(relations[1].type).toBe('sequence');

      expect(relations[2].sourceId).toBe('concept-decisao');
      expect(relations[2].targetId).toBe('concept-fim');
      expect(relations[2].linkingPhrase).toBe('Sim');
      expect(relations[2].type).toBe('conditional');

      // Histórico temporal deve iniciar zerado
      expect(useConceptMapStore.temporal.getState().pastStates).toHaveLength(0);
    });

    it('cria ramificações de decisão "Sim" e "Não" a partir de nó losango (createDecisionBranches) com reversão atômica via Undo', () => {
      const store = useConceptMapStore.getState();
      const decisionNodeId = 'concept-projeto-pop';
      store.updateNodeShape(decisionNodeId, 'decision');

      const initialConcepts = store.metrics.totalConcepts;
      const initialRelations = store.metrics.totalRelations;

      const branchResult = store.createDecisionBranches(decisionNodeId);
      expect(branchResult).not.toBeNull();
      expect(branchResult?.simConceptId).toBeTruthy();
      expect(branchResult?.naoConceptId).toBeTruthy();

      const afterBranches = useConceptMapStore.getState();
      expect(afterBranches.metrics.totalConcepts).toBe(initialConcepts + 2);
      expect(afterBranches.metrics.totalRelations).toBe(initialRelations + 2);

      const simConcept = afterBranches.semantic.concepts[branchResult!.simConceptId];
      const naoConcept = afterBranches.semantic.concepts[branchResult!.naoConceptId];
      expect(simConcept.label).toBe('Ação (Sim)');
      expect(simConcept.nodeShape).toBe('process');
      expect(naoConcept.label).toBe('Ação (Não)');
      expect(naoConcept.nodeShape).toBe('process');

      const simRel = afterBranches.semantic.relations[branchResult!.simRelationId];
      const naoRel = afterBranches.semantic.relations[branchResult!.naoRelationId];
      expect(simRel.linkingPhrase).toBe('Sim');
      expect(simRel.type).toBe('conditional');
      expect(naoRel.linkingPhrase).toBe('Não');
      expect(naoRel.type).toBe('conditional');

      // Testa reversão em passo único (Undo deve desfazer ambos os ramos e ambas as arestas)
      useConceptMapStore.temporal.getState().undo();
      const afterUndo = useConceptMapStore.getState();
      expect(afterUndo.metrics.totalConcepts).toBe(initialConcepts);
      expect(afterUndo.metrics.totalRelations).toBe(initialRelations);
      expect(afterUndo.semantic.concepts[branchResult!.simConceptId]).toBeUndefined();
      expect(afterUndo.semantic.concepts[branchResult!.naoConceptId]).toBeUndefined();

      // Redo recria ambos
      useConceptMapStore.temporal.getState().redo();
      expect(useConceptMapStore.getState().metrics.totalConcepts).toBe(initialConcepts + 2);
    });

    it('persiste e restaura rascunho de fluxograma no localStorage preservando diagramMode, formas de nó e conexões condicionais', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(true, 'flowchart');

      // Adiciona ramificação adicional
      store.createDecisionBranches('concept-decisao');

      // Dispara salvamento manual de rascunho
      store.saveDraftToLocalStorage();

      // Limpa store criando um mapa conceitual vazio
      store.createNewEmptyMap(false, 'concept-map');
      expect(useConceptMapStore.getState().metrics.totalConcepts).toBe(0);
      expect(useConceptMapStore.getState().semantic.diagramMode).toBe('concept-map');

      // Restaura do localStorage
      const restored = useConceptMapStore.getState().restoreDraftFromLocalStorage();
      expect(restored).toBe(true);

      const restoredState = useConceptMapStore.getState();
      expect(restoredState.semantic.diagramMode).toBe('flowchart');
      expect(restoredState.sourceFileName).toBe('novo-fluxograma.md');
      expect(restoredState.metrics.totalConcepts).toBe(6); // 4 iniciais + 2 ramos
      expect(restoredState.semantic.concepts['concept-decisao'].nodeShape).toBe('decision');
    });

    it('exporta ConceptMapDocument contendo metadados de diagramMode e formas geométricas com total fidelidade', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(true, 'flowchart');

      const doc = store.exportDocument();
      expect(doc.schemaVersion).toBe('1.0.0');
      expect(doc.metadata.diagramMode).toBe('flowchart');
      expect(doc.semantic.diagramMode).toBe('flowchart');
      expect(doc.semantic.concepts['concept-inicio'].nodeShape).toBe('terminal');
      expect(doc.visual.nodes['concept-inicio'].nodeShape).toBe('terminal');
    });

    it('preserva dimensões mínimas de losango (largura >= 160, altura >= 85) após updateConceptLabel e resetNodeSize', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(true, 'flowchart');

      const decisaoVis = useConceptMapStore.getState().visual.nodes['concept-decisao'];
      expect(decisaoVis?.nodeShape).toBe('decision');
      expect(decisaoVis?.dimensions?.width).toBeGreaterThanOrEqual(160);
      expect(decisaoVis?.dimensions?.height).toBeGreaterThanOrEqual(85);

      // 1. Atualização de rótulo para texto curto
      store.updateConceptLabel('concept-decisao', 'Ok?');
      const visAfterShort = useConceptMapStore.getState().visual.nodes['concept-decisao'];
      expect(visAfterShort?.dimensions?.width).toBeGreaterThanOrEqual(160);
      expect(visAfterShort?.dimensions?.height).toBeGreaterThanOrEqual(85);

      // 2. Redimensionamento manual seguido de reset
      store.resizeNode('concept-decisao', { width: 300, height: 200 });
      expect(useConceptMapStore.getState().visual.nodes['concept-decisao']?.customSize).toBe(true);

      store.resetNodeSize('concept-decisao');
      const visAfterReset = useConceptMapStore.getState().visual.nodes['concept-decisao'];
      expect(visAfterReset?.customSize).toBe(false);
      expect(visAfterReset?.dimensions?.width).toBeGreaterThanOrEqual(160);
      expect(visAfterReset?.dimensions?.height).toBeGreaterThanOrEqual(85);
    });

    it('addPropositionByNames suporta formas de nó e calcula dimensões ampliadas para nós de decisão', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(false, 'flowchart');

      store.addPropositionByNames(
        '{Requisito Atendido?}',
        'Sim',
        'Prosseguir',
        'conditional',
        'decision',
        'process'
      );

      const state = useConceptMapStore.getState();
      const decisionNode = Object.values(state.visual.nodes).find(
        (n) => n.nodeShape === 'decision'
      );
      expect(decisionNode).toBeDefined();
      expect(decisionNode?.dimensions?.width).toBeGreaterThanOrEqual(160);
      expect(decisionNode?.dimensions?.height).toBeGreaterThanOrEqual(85);
    });

    it('carrega exemplo-fluxograma.md via loadFromMarkdown e define layoutSettings.algorithm como dagre-hierarchical', async () => {
      const flowchartPath = path.resolve(__dirname, '../../../exemplo-fluxograma.md');
      const flowchartMd = fs.readFileSync(flowchartPath, 'utf-8');
      await useConceptMapStore.getState().loadFromMarkdown(flowchartMd, 'exemplo-fluxograma.md');

      const state = useConceptMapStore.getState();
      expect(state.semantic.diagramMode).toBe('flowchart');
      expect(state.visual.layoutSettings.algorithm).toBe('dagre-hierarchical');
    });
  });
});



