// Editor-only view navigation.  The transform never touches the project or
// its camera; the export worker renders independently at the requested size.
export function setupPreviewViewport({
  space,
  grid,
  canvas,
  renderer,
  reset,
  isBusy,
}) {
  let zoom = 1,
    panX = 0,
    panY = 0,
    drag = null;
  const maxBufferEdge = 3072;
  function resizeBuffer() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = renderer.getPixelRatio();
    // A zoomed-in stage can be much larger than the viewport.  Keep it sharp
    // where practical, but bound GPU allocation at very large zoom levels.
    const scale = Math.min(
      1,
      maxBufferEdge / (Math.max(rect.width, rect.height) * dpr),
    );
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    if (
      canvas.width !== Math.floor(width * dpr) ||
      canvas.height !== Math.floor(height * dpr)
    ) {
      renderer.setSize(width, height, false);
    }
  }
  function transform(resize = false) {
    grid.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    const percent = Math.round(zoom * 100);
    reset.textContent = `${percent}%`;
    reset.setAttribute("aria-label", `重置主预览缩放（当前 ${percent}%）`);
    if (resize) resizeBuffer();
  }
  space.addEventListener(
    "wheel",
    (event) => {
      if (isBusy() || !event.deltaY) return;
      event.preventDefault();
      const rect = grid.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? space.clientHeight
            : 1);
      const next = Math.max(
        0.2,
        Math.min(
          8,
          zoom * Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.0015),
        ),
      );
      if (next === zoom) return;
      // Preserve the same point in the grid under the mouse, even for the
      // combined side-by-side or overlaid reference views.
      const u = (event.clientX - rect.left) / rect.width;
      const v = (event.clientY - rect.top) / rect.height;
      zoom = next;
      transform();
      const after = grid.getBoundingClientRect();
      panX += event.clientX - (after.left + u * after.width);
      panY += event.clientY - (after.top + v * after.height);
      transform(true);
    },
    { passive: false },
  );
  reset.addEventListener("click", () => {
    zoom = 1;
    panX = 0;
    panY = 0;
    transform(true);
  });
  // Middle-drag provides a way to navigate a magnified canvas without
  // interfering with the existing left-button transform and picking tools.
  space.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 1 || isBusy() || drag) return;
      event.preventDefault();
      event.stopPropagation();
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        panX,
        panY,
      };
      space.classList.add("is-panning");
      space.setPointerCapture(event.pointerId);
    },
    true,
  );
  space.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault();
    panX = drag.panX + event.clientX - drag.x;
    panY = drag.panY + event.clientY - drag.y;
    transform();
  });
  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    space.classList.remove("is-panning");
    if (space.hasPointerCapture(event.pointerId))
      space.releasePointerCapture(event.pointerId);
  }
  space.addEventListener("pointerup", endDrag);
  space.addEventListener("pointercancel", endDrag);
  space.addEventListener("lostpointercapture", endDrag);
  transform();
  return { resize: resizeBuffer };
}
