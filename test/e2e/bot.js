// In-page autoplay bot for browser tests: taps the touch surface with real pointer events
// as each note reaches the strikeline. Runs inside the page via page.evaluate().
export function installBot({ skipEvery = 0 } = {}) {
  const state = window.fretline;
  const surface = document.querySelector('#touchSurface');
  let id = 1000;
  let next = 0;
  const fire = (type, x, y, pid) =>
    surface.dispatchEvent(
      new PointerEvent(type, { pointerId: pid, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }),
    );
  const tick = () => {
    const s = state.session;
    if (!s || !s.running) return;
    const t = s.audio.songTime();
    const layout = state.renderer.laneScreenPositions();
    while (next < s.engine.notes.length && s.engine.notes[next].time <= t + 0.004) {
      const n = s.engine.notes[next++];
      if (skipEvery && n.id % skipEvery === 0) continue;
      const hold = Math.max(50, ((n.endTime - n.time) * 1000) / s.speed);
      const points = n.open
        ? [[layout.lanes[1], layout.strikeY - layout.laneWidth * 3]]
        : n.lanes.map((l) => [layout.lanes[l], layout.strikeY]);
      for (const [x, y] of points) {
        const pid = id++;
        fire('pointerdown', x, y, pid);
        setTimeout(() => fire('pointerup', x, y, pid), hold);
      }
    }
    if (s.engine.spMeter >= 0.5 && !s.engine.spActive) state.hud.onStarPower?.();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
