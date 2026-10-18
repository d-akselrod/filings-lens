import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { DEFAULT_SETTINGS, type SearchFilters, type SearchSettings } from '../../core/types';

export interface SettingsState {
  settings: SearchSettings;
  set(p: Partial<Omit<SearchSettings, 'filters'>>): void;
  toggleFilter(k: keyof SearchFilters, v: string | number): void;
  reset(): void;
}

export const useSettings: UseBoundStore<StoreApi<SettingsState>> = create<SettingsState>()(set => ({
  settings: DEFAULT_SETTINGS,
  set: p => set(s => ({ settings: { ...s.settings, ...p } })),
  toggleFilter: (k, v) => set(s => {
    const current: Array<string | number> = s.settings.filters[k];
    const next = current.includes(v) ? current.filter(x => x !== v) : [...current, v];
    return { settings: { ...s.settings, filters: { ...s.settings.filters, [k]: next } } };
  }),
  reset: () => set({ settings: DEFAULT_SETTINGS }),
}));
