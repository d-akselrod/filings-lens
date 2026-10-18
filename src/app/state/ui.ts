import { create, type StoreApi, type UseBoundStore } from 'zustand';

export interface UiState {
  view: 'ask' | 'scorecard';
  /** The citation number whose source card is highlighted. */
  highlighted: number | null;
  byokOpen: boolean;
  set(p: Partial<Omit<UiState, 'set'>>): void;
}

export const useUi: UseBoundStore<StoreApi<UiState>> = create<UiState>()(set => ({
  view: 'ask',
  highlighted: null,
  byokOpen: false,
  set: p => set(p),
}));
