import { describe, expect, it } from "vite-plus/test";

import {
  clampDiffPopupSize,
  computeCenteredPopupResize,
  splitFileDisplayPath,
} from "./diffFilePopup.logic";

describe("splitFileDisplayPath", () => {
  it("splits nested paths into file name and directory", () => {
    expect(splitFileDisplayPath("apps/web/src/components/DiffPanel.tsx")).toEqual({
      fileName: "DiffPanel.tsx",
      directoryName: "apps/web/src/components",
    });
  });

  it("handles root-level files without a directory", () => {
    expect(splitFileDisplayPath("README.md")).toEqual({
      fileName: "README.md",
      directoryName: null,
    });
  });

  it("handles backslash separators and literal backslashes in POSIX paths", () => {
    expect(splitFileDisplayPath("project\\nested\\file.ts")).toEqual({
      fileName: "file.ts",
      directoryName: "project\\nested",
    });
    expect(splitFileDisplayPath("project/back\\slash.txt")).toEqual({
      fileName: "back\\slash.txt",
      directoryName: "project",
    });
  });
});

describe("computeCenteredPopupResize", () => {
  it("doubles pointer delta so the dragged corner tracks the cursor", () => {
    expect(
      computeCenteredPopupResize({
        startWidth: 800,
        startHeight: 600,
        deltaX: 50,
        deltaY: -25,
        viewportWidth: 1600,
        viewportHeight: 1000,
      }),
    ).toEqual({ width: 900, height: 550 });
  });

  it("clamps to minimum and viewport maximum bounds", () => {
    expect(
      computeCenteredPopupResize({
        startWidth: 800,
        startHeight: 600,
        deltaX: 600,
        deltaY: -500,
        viewportWidth: 1200,
        viewportHeight: 800,
      }),
    ).toEqual({ width: 1176, height: 288 });

    expect(clampDiffPopupSize({ width: 500, height: 400 }, { width: 320, height: 260 })).toEqual({
      width: 296,
      height: 236,
    });
  });
});
