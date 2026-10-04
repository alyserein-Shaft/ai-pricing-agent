// Type bridge for drawing-coordinate-mapper.mjs (checkJs is off, so without
// this declaration TS infers `never[]`/`{}` from default parameter values
// rather than the real shapes these pure functions accept).

export type CanonicalBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth?: number;
  pageHeight?: number;
};

export type PageDimensions = { pageWidth: number; pageHeight: number };

export type DrawingViewport = { scale?: number; rotation?: number };

export type ScreenBox = { left: number; top: number; width: number; height: number };

export declare function mapCanonicalBoxToViewport(
  box: CanonicalBoundingBox | null | undefined,
  page: PageDimensions | null | undefined,
  viewport?: DrawingViewport,
): ScreenBox | null;

export declare function mapViewportBoxToCanonical(
  box: ScreenBox | null | undefined,
  page: PageDimensions | null | undefined,
  viewport?: DrawingViewport,
): CanonicalBoundingBox | null;

export declare function viewportPixelSize(
  page: PageDimensions | null | undefined,
  viewport?: DrawingViewport,
): { width: number; height: number } | null;

// Canonical box of one pdf.js text item (transform, advance width, font height).
export declare function textItemCanonicalBox(
  transform: ArrayLike<number> | null | undefined,
  width: number,
  height: number,
  originX?: number,
  originY?: number,
): CanonicalBoundingBox;
