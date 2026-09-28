const { loadEsmModule } = require("./esm-loader.js");

const { trustedPressCommands } = loadEsmModule("../js/trusted-press.js");

describe("trusted press delivery", () => {
  const point = { x: 12.5, y: 40.25 };

  test("desktop profile sends the same CSS point as a mouse press", () => {
    const commands = trustedPressCommands(point, { touch: false });
    expect(commands.map((command) => command.method)).toEqual([
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
    ]);
    expect(commands[1].params).toEqual({
      type: "mousePressed",
      x: 12.5,
      y: 40.25,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    expect(JSON.stringify(commands)).not.toMatch(/devicePixel|scaleFactor/);
  });

  test("mobile emulation sends the same CSS point as a touch", () => {
    const commands = trustedPressCommands(point, { touch: true });
    expect(commands.map((command) => command.method)).toEqual([
      "Input.dispatchTouchEvent",
      "Input.dispatchTouchEvent",
    ]);
    expect(commands[0].params.touchPoints[0]).toMatchObject({
      x: 12.5,
      y: 40.25,
    });
    expect(commands[1].params).toEqual({ type: "touchEnd", touchPoints: [] });
  });

  test("a point that is not a coordinate is not a press", () => {
    expect(
      trustedPressCommands({ x: Number.NaN, y: 1 }, { touch: false }),
    ).toEqual([]);
    expect(trustedPressCommands(null, { touch: true })).toEqual([]);
  });
});
