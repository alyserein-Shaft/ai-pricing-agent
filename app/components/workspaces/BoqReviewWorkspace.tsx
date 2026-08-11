import type { ReactNode } from "react";

export function BoqReviewWorkspace({ children }: { children: ReactNode }) {
  return <section className="module-page">
    <div className="module-heading"><div><small>STEP 02 · EXTRACTION REVIEW</small><h1>Bill of quantities</h1><p>Review the persisted, source-traceable extraction before downstream use.</p></div></div>
    {children}
  </section>;
}
