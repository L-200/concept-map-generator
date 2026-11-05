import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { useConceptMapStore } from '../useConceptMapStore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entradaPath = path.resolve(__dirname, '../../../entrada.md');
const rawMarkdown = fs.readFileSync(entradaPath, 'utf-8');

describe('useConceptMapStore & Undo/Redo (Etapa 4)', () => {
  beforeEach(async () => {
    await useConceptMapStore.getState().loadFromMarkdown(rawMarkdown, 'entrada.md');
  });

  it('carrega entrada.md e inicializa 32 nós e 46 arestas no estado semântico e visual', () => {
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
  });
});

