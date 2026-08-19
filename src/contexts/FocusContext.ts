import { createContext, useContext } from 'react';

export type FocusZone = 'sidebar' | 'content' | 'overlay';

interface FocusContextType {
  focusZone: FocusZone;
  setFocusZone: (zone: FocusZone) => void;
}

export const FocusContext = createContext<FocusContextType>({
  focusZone: 'content',
  setFocusZone: () => {},
});

export function useFocusZone() {
  return useContext(FocusContext);
}
