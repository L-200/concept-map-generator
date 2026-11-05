import { useEffect } from 'react';
import { useConceptMapStore } from '../store/useConceptMapStore';

interface KeyboardShortcutsOptions {
  searchInputRef: React.RefObject<HTMLInputElement>;
}

/**
 * Registra atalhos globais de teclado para produtividade no editor:
 * - Ctrl+Z: Undo
 * - Ctrl+Y ou Ctrl+Shift+Z: Redo
 * - Ctrl+K ou Ctrl+F: Focar barra de busca
 * - Delete / Backspace: Excluir nós e conexões selecionados
 * - P: Fixar / desafixar (Pin) nós selecionados
 * - T: Alternar tipo da conexão selecionada (hierárquica <-> ligação cruzada)
 * - R: Inverter direção da conexão selecionada
 */
export function useKeyboardShortcuts({
  searchInputRef,
}: KeyboardShortcutsOptions): void {
  const hasUnsavedChanges = useConceptMapStore((s) => s.hasUnsavedChanges);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditingInput = Boolean(
        target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable)
      );

      // Atalhos que funcionam mesmo fora do canvas (Ctrl+K / Ctrl+F para focar busca)
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'f')
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (isEditingInput) {
        return;
      }

      const state = useConceptMapStore.getState();

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          useConceptMapStore.temporal.getState().redo();
        } else {
          useConceptMapStore.temporal.getState().undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useConceptMapStore.temporal.getState().redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (
          state.selectedNodeIds.length > 0 ||
          state.selectedEdgeIds.length > 0
        ) {
          e.preventDefault();
          state.deleteElements(state.selectedNodeIds, state.selectedEdgeIds);
        }
      } else if (e.key.toLowerCase() === 'p') {
        if (state.selectedNodeIds.length === 1) {
          e.preventDefault();
          state.toggleNodePin(state.selectedNodeIds[0]);
        } else if (state.selectedNodeIds.length > 1) {
          e.preventDefault();
          state.setNodesPinned(state.selectedNodeIds, true);
        }
      } else if (e.key.toLowerCase() === 't') {
        if (state.selectedEdgeIds.length === 1) {
          e.preventDefault();
          const relId = state.selectedEdgeIds[0];
          const rel = state.semantic.relations[relId];
          if (rel) {
            state.updateRelation(relId, {
              type: rel.type === 'cross-link' ? 'hierarchical' : 'cross-link',
            });
          }
        }
      } else if (e.key.toLowerCase() === 'r') {
        if (state.selectedEdgeIds.length === 1) {
          e.preventDefault();
          state.reverseRelationDirection(state.selectedEdgeIds[0]);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchInputRef]);

  // Alerta ao fechar janela se houver alterações não exportadas
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges]);
}
