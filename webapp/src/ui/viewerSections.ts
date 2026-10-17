const initialized = new WeakSet<HTMLDetailsElement>();
const prefix = 'macropad.liveView.section.';

/** Keep native disclosure behavior, restoring each section independently. */
export function viewerSection(name: string, defaultOpen = true) {
  return {
    ref(element: HTMLDetailsElement | null) {
      if (!element || initialized.has(element)) return;
      initialized.add(element);
      let open = defaultOpen;
      try {
        const saved = localStorage.getItem(prefix + name);
        if (saved !== null) open = saved === 'open';
      } catch { /* Storage may be unavailable in private browsing. */ }
      element.open = open;
    },
    onToggle(event: Event) {
      const element = event.currentTarget as HTMLDetailsElement;
      try { localStorage.setItem(prefix + name, element.open ? 'open' : 'closed'); }
      catch { /* Disclosures still work when storage is unavailable. */ }
    },
  };
}
