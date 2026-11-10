/** Parts of the one long page, in the order they appear. */
export type Tab = 'sale' | 'control' | 'how';

export const TABS: { id: Tab; label: string; anchor: string }[] = [
  { id: 'sale', label: 'The sale', anchor: 'top' },
  { id: 'control', label: 'Control room', anchor: 'control-room' },
  { id: 'how', label: 'How it works', anchor: 'how-it-works' },
];
