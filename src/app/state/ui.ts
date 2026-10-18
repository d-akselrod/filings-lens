import { create, type StoreApi, type UseBoundStore } from 'zustand';

export interface UiState {
  view: 'ask' | 'scorecard';
  /** The citation number whose source card is highlighted. */
  highlighted: number | null;
  /** Bumped on every citation click, so clicking the same chip again scrolls to its card again. */
  highlightNonce: number;
  evidenceTab: 'sources' | 'trace';
  /** The Sources drawer on narrow screens. */
  evidenceOpen: boolean;
  byokOpen: boolean;
  set(p: Partial<Omit<UiState, 'set' | 'cite'>>): void;
  /** A citation chip was clicked: show and scroll to its source wherever the evidence is. */
  cite(n: number): void;
}

export const useUi: UseBoundStore<StoreApi<UiState>> = create<UiState>()(set => ({
  view: 'ask',
  highlighted: null,
  highlightNonce: 0,
  evidenceTab: 'sources',
  evidenceOpen: false,
  byokOpen: false,
  set: p => set(p),
  cite: n => set(s => ({ highlighted: n, highlightNonce: s.highlightNonce + 1, evidenceTab: 'sources', evidenceOpen: true })),
}));
