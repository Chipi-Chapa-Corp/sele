export interface PopupSize {
  readonly width: number;
  readonly height: number;
}

const MIN_DIFF_POPUP_WIDTH = 384;
const MIN_DIFF_POPUP_HEIGHT = 288;
const DIFF_POPUP_VIEWPORT_MARGIN = 24;

export function splitFileDisplayPath(filePath: string): {
  readonly fileName: string;
  readonly directoryName: string | null;
} {
  const slashIndex = filePath.includes("/")
    ? filePath.lastIndexOf("/")
    : filePath.lastIndexOf("\\");
  if (slashIndex < 0) {
    return { fileName: filePath, directoryName: null };
  }
  const fileName = filePath.slice(slashIndex + 1);
  const directoryName = filePath.slice(0, slashIndex);
  return {
    fileName: fileName.length > 0 ? fileName : filePath,
    directoryName: directoryName.length > 0 ? directoryName : null,
  };
}

export function clampDiffPopupSize(size: PopupSize, viewport: PopupSize): PopupSize {
  const maxWidth = Math.max(240, viewport.width - DIFF_POPUP_VIEWPORT_MARGIN);
  const maxHeight = Math.max(200, viewport.height - DIFF_POPUP_VIEWPORT_MARGIN);
  const minWidth = Math.min(MIN_DIFF_POPUP_WIDTH, maxWidth);
  const minHeight = Math.min(MIN_DIFF_POPUP_HEIGHT, maxHeight);
  return {
    width: Math.round(Math.max(minWidth, Math.min(maxWidth, size.width))),
    height: Math.round(Math.max(minHeight, Math.min(maxHeight, size.height))),
  };
}

/**
 * The popup is centered by its viewport overlay, so dragging one corner moves both opposite
 * edges by half the total change. Doubling the pointer delta keeps the dragged corner under
 * the cursor.
 */
export function computeCenteredPopupResize(input: {
  readonly startWidth: number;
  readonly startHeight: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}): PopupSize {
  return clampDiffPopupSize(
    {
      width: input.startWidth + 2 * input.deltaX,
      height: input.startHeight + 2 * input.deltaY,
    },
    {
      width: input.viewportWidth,
      height: input.viewportHeight,
    },
  );
}
