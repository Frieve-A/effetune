// A hidden fullscreen player leaves the rest of the page inert in Chromium.
// Observe only the fullscreen element, in the isolated world, without exposing IPC.
const fullscreenResize = new ResizeObserver(() => {
  const element = document.fullscreenElement;
  if (element && element.getClientRects().length === 0) {
    document.exitFullscreen().catch(error => {
      console.error('Browser hidden fullscreen exit failed:', error);
    });
  }
});

document.addEventListener('fullscreenchange', () => {
  fullscreenResize.disconnect();
  if (document.fullscreenElement) fullscreenResize.observe(document.fullscreenElement);
});
