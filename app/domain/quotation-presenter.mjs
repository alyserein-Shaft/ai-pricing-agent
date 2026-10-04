export const QUOTATION_PRESENTER_VERSION = "quotation-presenter-1.1.0";

// ONBOARDING RECOVERY E -- the one canonical Attention formatter, shared by
// the server-side quotation-header snapshot (worker/presales-workflow-api.mjs,
// at draft-creation time) and any other future presentation surface. Never
// mutates stored data; composes at read/snapshot time only.
//   Mr. + Ahmad   -> "Mr. Ahmad"
//   ""  + Ahmad   -> "Ahmad"        (no title on record, or legacy data)
//   Mr. + ""      -> "Mr."
//   ""  + ""      -> ""
// A legacy record with contact_name already containing the honorific
// ("Mr. Ahmad") and no contact_title naturally avoids double-titling: the
// empty title is filtered out, so contact_name alone passes through.
export const formatContactDisplay = ({ title, name } = {}) =>
  [title, name].map((value) => String(value ?? "").trim()).filter(Boolean).join(" ");

const parseJson = (value, fallback = {}) => {
  try {
    return typeof value === "string"
      ? JSON.parse(value || "")
      : (value ?? fallback);
  } catch {
    return fallback;
  }
};

const number = (value) => Number(value || 0);

const meaningfulText = (value) => {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || text.toLowerCase() === "unknown") return null;
  return text;
};

const clientTerms = (terms = {}) => {
  const output = {};

  if (Number.isFinite(Number(terms.validityDays))) {
    output.validityDays = Number(terms.validityDays);
  }

  if (Number.isFinite(Number(terms.warrantyMonths))) {
    output.warrantyMonths = Number(terms.warrantyMonths);
  }

  const delivery = meaningfulText(terms.delivery);
  if (delivery) output.delivery = delivery;

  const paymentTerms = meaningfulText(terms.paymentTerms);
  if (paymentTerms) output.paymentTerms = paymentTerms;

  if (Array.isArray(terms.exclusions) && terms.exclusions.length) {
    const exclusions = terms.exclusions
      .map(meaningfulText)
      .filter(Boolean);

    if (exclusions.length) output.exclusions = exclusions;
  }

  return output;
};

const clientLine = (line) => {
  const quantity = Number(line.quantity);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("QUOTATION_LINE_QUANTITY_INVALID");
  }

  const lineTotalMinor = number(line.net_selling_minor);

  return {
    sequence: Number(line.sequence),
    itemNumber: line.item_number || null,
    description: line.description || line.product_description || null,
    manufacturer: line.manufacturer_name || null,
    partNumber: line.part_number || null,
    productDescription: line.product_description || null,
    unit: line.unit || null,
    quantity,
    currency: line.currency,
    unitSellingMinor: Number(
      (lineTotalMinor / quantity).toFixed(6),
    ),
    lineTotalMinor,
  };
};

export const buildClientQuotationModel = ({
  revision,
  lines = [],
}) => {
  if (!revision) {
    throw new Error("QUOTATION_REVISION_REQUIRED");
  }

  const sourceSummary = parseJson(revision.source_summary_json, {});
  const header = sourceSummary?.quotationHeader;

  if (!header || !header.projectName || !header.currency) {
    throw new Error("QUOTATION_HEADER_SNAPSHOT_REQUIRED");
  }

  if (!Array.isArray(lines) || !lines.length) {
    throw new Error("QUOTATION_LINES_REQUIRED");
  }

  const presentedLines = [...lines]
    .sort((a, b) =>
      Number(a.sequence) - Number(b.sequence) ||
      String(a.id || "").localeCompare(String(b.id || ""))
    )
    .map(clientLine);

  const subtotalMinor = presentedLines.reduce(
    (sum, line) => sum + number(line.lineTotalMinor),
    0,
  );

  if (subtotalMinor !== number(revision.subtotal_minor)) {
    throw new Error("QUOTATION_PRESENTATION_RECONCILIATION_FAILED");
  }

  return {
    version: QUOTATION_PRESENTER_VERSION,

    header: {
      quotationRevision: Number(revision.revision_number),
      projectName: header.projectName,
      client: meaningfulText(header.client),
      tenderNumber: meaningfulText(header.tenderNumber),
      location: meaningfulText(header.location),
      packageName: meaningfulText(header.packageName),
      currency: header.currency,
      quotationDate: header.quotationDate || revision.created_at,
      status: revision.status,
      // ONBOARDING RECOVERY E -- captured from the current CONFIRMED NPQ at
      // draft-creation time (see worker/presales-workflow-api.mjs), the same
      // immutable-snapshot pattern every other header field already uses.
      // Never re-derived from browser-local state. `attention` is the one
      // pre-composed, ready-to-render string (formatContactDisplay, above);
      // contactTitle/contactName are also exposed raw for any caller that
      // needs them separately. All three are null, not a placeholder, when
      // no contact was recorded -- client-facing output omits them cleanly.
      attention: meaningfulText(header.attention),
      contactTitle: meaningfulText(header.contactTitle),
      contactName: meaningfulText(header.contactName),
    },

    lines: presentedLines,

    summary: {
      currency: revision.currency,
      subtotalMinor: number(revision.subtotal_minor),
      vatBasisPoints: number(revision.vat_basis_points),
      vatMinor: number(revision.vat_minor),
      totalMinor: number(revision.total_minor),
    },

    terms: clientTerms(
      parseJson(revision.terms_json, {}),
    ),
  };
};
