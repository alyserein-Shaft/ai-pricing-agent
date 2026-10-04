// Type bridge for drawing-crop-selection.mjs (checkJs is off, so without
// this declaration TS infers overly-narrow types from the `= []`/`= 4`
// default parameter values rather than the real shapes this pure selector
// accepts/returns).

export type DenseTextCropRegion = {
  rect: { x: number; y: number; width: number; height: number };
  itemCount: number;
};

export declare function computeDenseTextCropRegions(input?: {
  assets?: Array<Record<string, any>>;
  pageWidth?: number;
  pageHeight?: number;
  maxRegions?: number;
  cellSize?: number;
  padding?: number;
}): DenseTextCropRegion[];
export declare function computeComplementaryCropRegions(input?: {
 assets?: Array<Record<string, any>>; pageWidth?: number; pageHeight?: number; maxRegions?: number;
}): Array<DenseTextCropRegion & { purpose: string }>;
