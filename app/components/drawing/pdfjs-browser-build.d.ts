// pdfjs-dist ships type declarations for "pdfjs-dist" (main) and for
// "pdfjs-dist/legacy/build/pdf.mjs" (used server-side by the drawing
// extraction engines), but not for the browser build's own file path --
// see node_modules/pdfjs-dist/legacy/build/pdf.d.mts for the same
// re-export pattern this mirrors. DrawingVisualReviewPanel.tsx dynamically
// imports this module client-side (not the legacy/Node build) so the
// browser's native Canvas/DOMMatrix are used instead of the legacy build's
// polyfills.
declare module "pdfjs-dist/build/pdf.mjs" {
  export * from "pdfjs-dist";
}
