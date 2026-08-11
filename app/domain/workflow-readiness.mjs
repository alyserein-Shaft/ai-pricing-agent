export const deriveWorkflowStages = (steps, context) => {
  const { documentCount, scopeMissing, outstandingPrices, rfqCount, openControls, approvalRevision, finalIssueExported, boqLineCount } = context;
  const governedStage = !documentCount ? 1 : scopeMissing ? 2 : outstandingPrices ? (rfqCount ? 4 : 3) : openControls ? 6 : !approvalRevision ? 7 : 8;

  return steps.map((stage, index) => {
    const number = index + 1;
    const complete = number === 1 ? documentCount > 0
      : number === 2 ? !scopeMissing
      : number >= 3 && number <= 5 ? outstandingPrices === 0
      : number === 6 ? openControls === 0
      : number === 7 ? Boolean(approvalRevision)
      : finalIssueExported;
    const current = number === governedStage;
    const status = complete ? "Complete" : current ? "Current" : number < governedStage ? "Skipped" : "Blocked";
    const detail = number === 1 ? `${documentCount} registered source${documentCount === 1 ? "" : "s"}`
      : number === 2 ? scopeMissing ? "Reviewed BOQ required" : `${boqLineCount} BOQ lines`
      : number === 3 ? outstandingPrices ? `${outstandingPrices} prices unresolved` : "All costs source-linked"
      : number === 4 ? outstandingPrices ? `${rfqCount} RFQ package${rfqCount === 1 ? "" : "s"}` : rfqCount ? "Supplier evidence resolved" : "Not required"
      : number === 5 ? outstandingPrices ? "Complete source-backed costs" : "Cost build ready"
      : number === 6 ? openControls ? `${openControls} control${openControls === 1 ? "" : "s"} open` : "All controls passed"
      : number === 7 ? approvalRevision ? `Approved R${approvalRevision}` : "Commercial approval required"
      : finalIssueExported ? "Current issue exported" : approvalRevision ? "Ready for governed export" : "Approved revision required";
    return { ...stage, number, complete, current, status, detail };
  });
};
