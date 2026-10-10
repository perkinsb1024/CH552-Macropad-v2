/** Keep native drags moving through long pages, even while the pointer is still. */
export function installDragAutoScroll(view: Window = window): () => void {
  let pointerY: number | null = null;
  let frame: number | null = null;
  let previousTime: number | null = null;
  const speed = () => {
    if (pointerY === null) return 0;
    const edge = Math.min(96, view.innerHeight / 4);
    if (pointerY < edge) return -1000 * Math.min(1, (edge - pointerY) / edge);
    if (pointerY > view.innerHeight - edge) return 1000 * Math.min(1, (pointerY - view.innerHeight + edge) / edge);
    return 0;
  };
  const stop = () => {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
    pointerY = null;
    previousTime = null;
  };
  const tick = (time: number) => {
    frame = null;
    const velocity = speed();
    if (!velocity) { previousTime = null; return; }
    // Cap elapsed time so a throttled tab cannot jump down the page on return.
    const elapsed = previousTime === null ? 1000 / 60 : Math.min(50, time - previousTime);
    previousTime = time;
    view.scrollBy({ top: velocity * elapsed / 1000, behavior: 'instant' });
    frame = view.requestAnimationFrame(tick);
  };
  const over = (event: DragEvent) => {
    pointerY = event.clientY;
    if (!speed()) { stop(); return; }
    if (frame === null) frame = view.requestAnimationFrame(tick);
  };
  const leave = (event: DragEvent) => {
    if (event.clientX <= 0 || event.clientX >= view.innerWidth
      || event.clientY <= 0 || event.clientY >= view.innerHeight) stop();
  };
  // Capture runs before individual drop targets stop propagation. Do not change
  // drop acceptance: scrolling also works over gaps and invalid targets.
  view.addEventListener('dragover', over, true);
  view.addEventListener('dragleave', leave, true);
  view.addEventListener('drop', stop, true);
  view.addEventListener('dragend', stop, true);
  view.addEventListener('blur', stop);
  return () => {
    stop();
    view.removeEventListener('dragover', over, true);
    view.removeEventListener('dragleave', leave, true);
    view.removeEventListener('drop', stop, true);
    view.removeEventListener('dragend', stop, true);
    view.removeEventListener('blur', stop);
  };
}
