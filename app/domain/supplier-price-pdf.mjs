import { extractSpecificationPdfPages } from "./specification-extractor.mjs";

const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();

const numeric = value => {
  const parsed = Number(clean(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const isoDate = value => {
  const source = clean(value);
  const dmy = source.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const parsed = new Date(source);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
};

const addDays = (iso, days) => {
  if (!iso || !Number.isFinite(days)) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const isNoise = line =>
  !line ||
  /^(?:SL|Unit QTY|Quotation|Subject:|Customer Name:|Attention:|Prepared by:|Email:)/i.test(line) ||
  /Model .*Description .*Unit Price/i.test(line) ||
  /^Company\s/i.test(line) ||
  /^VAT number:/i.test(line) ||
  /^Date:/i.test(line) ||
  /^Quotation number:/i.test(line) ||
  /^Total (?:Without|With) VAT/i.test(line) ||
  /^General Terms/i.test(line) ||
  /^\d+$/.test(line);

const possiblePartNumber = token => {
  const value = clean(token);
  if (!value || /\s/.test(value)) return false;
  if (/^\d+(?:\.\d+)?[A-Za-z]+$/.test(value)) return false;
  return (
    /^[A-Z0-9_-]{5,}$/i.test(value) &&
    (/[A-Za-z]/.test(value) || value.length >= 8)
  );
};

const metadataFromPages = pages => {
  const lines = pages.flatMap(page => page.lines.map(clean)).filter(Boolean);
  const joined = lines.join("\n");

  let supplier = null;
  const supplierLine = lines.find(line => /^Company\s+.+/i.test(line));
  if (supplierLine) supplier = supplierLine.replace(/^Company\s+/i, "").trim();

  let quotationReference =
    joined.match(/Quotation number:\s*([A-Z0-9._/-]+)/i)?.[1] || null;
  if (!quotationReference) {
    const index = lines.findIndex(line => /^Quotation number:\s*$/i.test(line));
    if (index >= 0) quotationReference = clean(lines[index + 1]) || null;
  }

  const issueDate =
    isoDate(joined.match(/Date:\s*([^\n]+)/i)?.[1]) ||
    isoDate(joined.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/)?.[0]);

  const currency =
    joined.match(/Currency:[^\n]*\b([A-Z]{3})\b/i)?.[1]?.toUpperCase() ||
    joined.match(/\b(SAR|USD|EUR|AED|QAR|EGP)\s+[\d,]+(?:\.\d+)?/i)?.[1]?.toUpperCase() ||
    null;

  const validityDays = Number(
    joined.match(/Quotation Validity:\s*(\d+)\s*Days/i)?.[1] ||
    joined.match(/valid for\s*(\d+)\s*days/i)?.[1] ||
    0,
  );

  return {
    supplier,
    quotationReference,
    currency,
    issueDate,
    validUntil: validityDays > 0 ? addDays(issueDate, validityDays) : null,
    validityDays: validityDays || null,
  };
};

export const extractSupplierQuotePdfPages = pages => {
  const metadata = metadataFromPages(pages);
  const rows = [];

  for (const page of pages) {
    const lines = page.lines.map(clean);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];

      const priceMatch = line.match(
        /^(.*?)\s+\b([A-Z]{3})\s+([\d,]+(?:\.\d+)?)\s+\2\s+([\d,]+(?:\.\d+)?)\s*$/i,
      );
      if (!priceMatch) continue;

      let prefix = clean(priceMatch[1]);
      const currency = priceMatch[2].toUpperCase();
      const unitPrice = numeric(priceMatch[3]);
      const totalPrice = numeric(priceMatch[4]);

      let unit = null;
      let quantity = null;
      let itemNumber = null;

      const inlineUnitQty = prefix.match(/^(.*?)\s+([A-Za-z]{1,8})\s+([\d,.]+)$/);
      if (inlineUnitQty) {
        prefix = clean(inlineUnitQty[1]);
        unit = inlineUnitQty[2];
        quantity = numeric(inlineUnitQty[3]);
      }

      for (let offset = 1; offset <= 3 && (!unit || quantity === null); offset += 1) {
        const candidate = clean(lines[index + offset]);
        const unitQty = candidate.match(/^([A-Za-z]{1,8})\s+([\d,.]+)$/);
        if (unitQty) {
          unit = unitQty[1];
          quantity = numeric(unitQty[2]);
          const maybeItem = clean(lines[index + offset + 1]);
          if (/^\d+(?:\.\d+)*$/.test(maybeItem)) itemNumber = maybeItem;
          break;
        }

        const partUnitQty = candidate.match(/^(\S+)\s+([A-Za-z]{1,8})\s+([\d,.]+)$/);
        if (partUnitQty) {
          if (!prefix) prefix = partUnitQty[1];
          unit = partUnitQty[2];
          quantity = numeric(partUnitQty[3]);
          const maybeItem = clean(lines[index + offset + 1]);
          if (/^\d+(?:\.\d+)*$/.test(maybeItem)) itemNumber = maybeItem;
          break;
        }
      }

      const tokens = prefix.split(/\s+/);
      let partNumber = null;
      let inlineDescription = prefix;

      if (possiblePartNumber(tokens[0])) {
        partNumber = tokens[0];
        inlineDescription = clean(tokens.slice(1).join(" "));
      }

      const previous = clean(lines[index - 1]);
      const next1 = clean(lines[index + 1]);
      const next2 = clean(lines[index + 2]);
      const next3 = clean(lines[index + 3]);

      const descriptionParts = [];
      if (!isNoise(previous) && !/\b(?:SAR|USD|EUR|AED|QAR|EGP)\s+[\d,]+(?:\.\d+)?/i.test(previous))
        descriptionParts.push(previous);
      if (inlineDescription) descriptionParts.push(inlineDescription);

      for (const tail of [next1, next2, next3]) {
        if (
          tail &&
          !isNoise(tail) &&
          !/^([A-Za-z]{1,8})\s+[\d,.]+$/.test(tail) &&
          !/^(\S+)\s+([A-Za-z]{1,8})\s+[\d,.]+$/.test(tail) &&
          !/\b(?:SAR|USD|EUR|AED|QAR|EGP)\s+[\d,]+(?:\.\d+)?/i.test(tail)
        ) {
          descriptionParts.push(tail);
          break;
        }
      }

      const description = clean([...new Set(descriptionParts)].join(" ")) || partNumber;

      rows.push({
        rowType: description && unitPrice !== null ? "SUPPLIER_LINE" : "UNKNOWN",
        sheet: `PDF page ${page.page}`,
        rowNumber: index + 1,
        itemNumber,
        supplier: metadata.supplier,
        quotationReference: metadata.quotationReference,
        manufacturer: null,
        partNumber,
        description,
        unit,
        quantity,
        currency: currency || metadata.currency,
        listPrice: null,
        unitPrice,
        discount: null,
        netUnitPrice: unitPrice,
        issueDate: metadata.issueDate,
        validUntil: metadata.validUntil,
        reviewStatus: "Needs Review",
        raw: {
          page: page.page,
          line: index + 1,
          sourceLine: line,
          previousLine: previous || null,
          followingLines: [next1, next2, next3].filter(Boolean),
          totalPrice,
          extractionQuality: page.extractionQuality,
        },
      });
    }
  }

  return {
    parser: "pdfjs-coordinate-layout",
    parserVersion: "1",
    metadata,
    rows,
  };
};

export const extractSupplierQuotePdf = async (
  bytes,
  { fileName = "supplier-quote.pdf" } = {},
) => {
  const pages = await extractSpecificationPdfPages(
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    { fileName },
  );
  return extractSupplierQuotePdfPages(pages);
};
