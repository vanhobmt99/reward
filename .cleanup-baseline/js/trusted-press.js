// Viewport CSS pixels, never device pixels or document quads. Touch only while
// the profile's mobile emulation is on; a desktop profile gets a mouse press.
export function trustedPressCommands(point, options = {}) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
  if (options.touch) {
    return [
      {
        method: "Input.dispatchTouchEvent",
        params: {
          type: "touchStart",
          touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }],
        },
      },
      {
        method: "Input.dispatchTouchEvent",
        params: { type: "touchEnd", touchPoints: [] },
      },
    ];
  }
  return [
    {
      method: "Input.dispatchMouseEvent",
      params: { type: "mouseMoved", x, y },
    },
    {
      method: "Input.dispatchMouseEvent",
      params: {
        type: "mousePressed",
        x,
        y,
        button: "left",
        buttons: 1,
        clickCount: 1,
      },
    },
    {
      method: "Input.dispatchMouseEvent",
      params: {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        buttons: 0,
        clickCount: 1,
      },
    },
  ];
}
