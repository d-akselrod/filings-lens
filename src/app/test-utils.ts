/** Test-only: a controllable window.matchMedia for jsdom. Returns a setter that re-evaluates and notifies listeners. */
export function mockMatchMedia(initial: (query: string) => boolean): (next: (query: string) => boolean) => void {
  let matcher = initial;
  const lists = new Map<string, { matches: boolean; listeners: Set<(e: MediaQueryListEvent) => void> }>();
  window.matchMedia = ((query: string) => {
    let entry = lists.get(query);
    if (!entry) lists.set(query, (entry = { matches: matcher(query), listeners: new Set() }));
    const list = entry;
    return {
      media: query,
      get matches() { return list.matches; },
      onchange: null,
      addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => list.listeners.add(l),
      removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => list.listeners.delete(l),
      addListener: (l: (e: MediaQueryListEvent) => void) => list.listeners.add(l),
      removeListener: (l: (e: MediaQueryListEvent) => void) => list.listeners.delete(l),
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return next => {
    matcher = next;
    for (const [query, list] of lists) {
      list.matches = matcher(query);
      for (const l of list.listeners) l({ matches: list.matches, media: query } as MediaQueryListEvent);
    }
  };
}
