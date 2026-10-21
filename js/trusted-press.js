/**
 * @typedef {{x: number, y: number}} PressPoint
 */
/**
 * @typedef {{x: number, y: number, radiusX: number, radiusY: number,
 *     force: number, id: number}} TrustedTouchPoint
 */
/**
 * @typedef {{type: string, x: (number|undefined), y: (number|undefined),
 *     button: (string|undefined), buttons: (number|undefined),
 *     clickCount: (number|undefined),
 *     touchPoints: (!Array<!TrustedTouchPoint>|undefined)}}
 *     TrustedPressParams
 */
/**
 * @typedef {{method: string, params: !TrustedPressParams}} TrustedPressCommand
 */

/**
 * Viewport CSS pixels, never device pixels or document quads. Touch only while
 * the profile's mobile emulation is on; a desktop profile gets a mouse press.
 * @param {?PressPoint} point CSS coordinate. Non-finite values produce no
 *     commands.
 * @param {{touch: (boolean|undefined)}=} options Touch when mobile emulation is
 *     on. Defaults to a mouse press.
 * @return {!Array<!TrustedPressCommand>} Ordered debugger input commands.
 */
export function trustedPressCommands(point, options = {}) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return [];
  }
  if (options.touch) {
    return [
      {
        method: 'Input.dispatchTouchEvent',
        params: {
          type: 'touchStart',
          touchPoints: [{x, y, radiusX: 1, radiusY: 1, force: 1, id: 1}],
        },
      },
      {
        method: 'Input.dispatchTouchEvent',
        params: {type: 'touchEnd', touchPoints: []},
      },
    ];
  }
  return [
    {
      method: 'Input.dispatchMouseEvent',
      params: {type: 'mouseMoved', x, y},
    },
    {
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      },
    },
    {
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      },
    },
  ];
}
