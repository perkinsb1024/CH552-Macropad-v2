import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { selectedSlot } from '../store';
import { IconArrow } from './Icons';

export function Sidebar({ children }: { children: ComponentChildren }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const sidebar = ref.current;
    const scroll = sidebar?.querySelector<HTMLElement>('.sidebar-scroll');
    const content = scroll?.firstElementChild;
    if (!sidebar || !scroll || !content) return;
    const header = document.querySelector<HTMLElement>('.topbar');
    const footer = document.querySelector<HTMLElement>('.footer');
    const workspace = sidebar.closest<HTMLElement>('.workspace');
    const update = () => {
      const top = header?.getBoundingClientRect().height ?? 64;
      sidebar.style.setProperty('--sidebar-top', `${top}px`);
      // Use the full viewport until the footer arrives, then shrink the scroll
      // region so the sticky sidebar stays below the header at the page end.
      const bottomSpace = workspace ? parseFloat(getComputedStyle(workspace).paddingBottom) || 0 : 0;
      const footerBoundary = footer ? footer.getBoundingClientRect().top - bottomSpace : Infinity;
      const bottom = Math.min(window.innerHeight, footerBoundary);
      // Put the bottom gap inside the scrollable content so it is revealed
      // only at the end, while unfinished content reaches the viewport edge.
      const restingBottom = Math.min(window.innerHeight - 18, footerBoundary);
      sidebar.style.setProperty('--sidebar-bottom-padding', `${4 + bottom - restingBottom}px`);
      sidebar.style.setProperty('--sidebar-height', `${Math.max(0, bottom - top)}px`);
      sidebar.dataset.moreAbove = String(scroll.scrollTop > 1);
      sidebar.dataset.moreBelow = String(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop > 1);
    };
    scroll.addEventListener('scroll', update, { passive: true });
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const observer = new ResizeObserver(update);
    observer.observe(scroll);
    observer.observe(content);
    if (header) observer.observe(header);
    update();
    return () => {
      scroll.removeEventListener('scroll', update);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
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
  const scrollPage = (direction: number) => {
    const scroll = ref.current?.querySelector<HTMLElement>('.sidebar-scroll');
    scroll?.scrollBy({
      top: direction * scroll.clientHeight * 0.75,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };
  return <aside class="column-side" ref={ref}>
    <div class="sidebar-scroll"><div class="column">{children}</div></div>
    <button type="button" class="sidebar-scroll-arrow sidebar-scroll-up" aria-label="Scroll sidebar up" title="Scroll up" onClick={() => scrollPage(-1)}><IconArrow up /></button>
    <button type="button" class="sidebar-scroll-arrow sidebar-scroll-down" aria-label="Scroll sidebar down" title="Scroll down" onClick={() => scrollPage(1)}><IconArrow /></button>
  </aside>;
}
