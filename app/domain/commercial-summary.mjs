export function commercialLineTotals(lines = [], currency = "SAR", calculatedAt = null) {
  const totalRecord = (predicate, state, exclusionReason) => {
    const included = lines.filter(predicate);
    const amountMinor = included.reduce(
      (sum, line) => sum + Number(line.final_value_minor || 0),
      0,
    );
    return {
      amountMinor,
      amount: amountMinor / 100,
      currency,
      includedLineCount: included.length,
      excludedLineCount: lines.length - included.length,
      state,
      exclusionReason,
      calculatedAt,
    };
  };
  return {
    draftCalculated: totalRecord(
      () => true,
      lines.length ? "Calculated" : "Not Started",
      "No calculated pricing line",
    ),
    technicallyEligible: totalRecord(
      (line) => Boolean(line.approval_ready),
      "Technical Eligibility",
      "Line is not approval-ready",
    ),
    commerciallyApproved: totalRecord(
      (line) =>
        Boolean(line.approval_ready) && Boolean(line.commercially_approved),
      "Commercial Approval",
      "Line or pricing run lacks commercial approval",
    ),
  };
}
