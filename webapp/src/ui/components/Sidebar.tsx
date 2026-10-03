import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { selectedSlot } from '../store';

export function Sidebar({ children }: { children: ComponentChildren }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const sidebar = ref.current;
    const scroll = sidebar?.querySelector<HTMLElement>('.sidebar-scroll');
    const content = scroll?.firstElementChild;
    if (!sidebar || !scroll || !content) return;
    const header = document.querySelector<HTMLElement>('.topbar');
    const update = () => {
      if (header) sidebar.style.setProperty('--sidebar-top', `${header.getBoundingClientRect().height + 18}px`);
      sidebar.dataset.moreAbove = String(scroll.scrollTop > 1);
      sidebar.dataset.moreBelow = String(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop > 1);
    };
    scroll.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroll);
    observer.observe(content);
    if (header) observer.observe(header);
    update();
    return () => {
      scroll.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);
  const slotKey = JSON.stringify(selectedSlot.value);
  useLayoutEffect(() => {
    const scroll = ref.current?.querySelector<HTMLElement>('.sidebar-scroll');
    if (scroll) {
      scroll.scrollTop = 0;
      scroll.dispatchEvent(new Event('scroll'));
    }
  }, [slotKey]);
  return <aside class="column-side" ref={ref}>
    <div class="sidebar-scroll"><div class="column">{children}</div></div>
  </aside>;
}
