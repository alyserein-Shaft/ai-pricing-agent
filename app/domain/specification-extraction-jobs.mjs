export const SPECIFICATION_JOB_VERSION = "spec-chunk-orchestrator-1.0.0";
export const DEFAULT_SPECIFICATION_CHUNK_SIZE = 50;
export const MIN_SPECIFICATION_CHUNK_SIZE = 10;
export const MAX_SPECIFICATION_CHUNK_SIZE = 100;

export const normalizeChunkSize = (value) => Math.min(MAX_SPECIFICATION_CHUNK_SIZE, Math.max(MIN_SPECIFICATION_CHUNK_SIZE, Number(value) || DEFAULT_SPECIFICATION_CHUNK_SIZE));

export const buildSpecificationChunks = ({ totalPages, chunkSize = DEFAULT_SPECIFICATION_CHUNK_SIZE, relevantPages = [] }) => {
  const size = normalizeChunkSize(chunkSize);
  const relevant = new Set((relevantPages || []).filter((page) => Number.isInteger(page) && page >= 1 && page <= totalPages));
  const chunks = [];
  for (let pageFrom = 1, chunkNumber = 1; pageFrom <= totalPages; pageFrom += size, chunkNumber += 1) {
    const pageTo = Math.min(totalPages, pageFrom + size - 1);
    const prioritized = relevant.size > 0 && Array.from({ length: pageTo - pageFrom + 1 }, (_, index) => pageFrom + index).some((page) => relevant.has(page));
    chunks.push({ chunkNumber, pageFrom, pageTo, pageCount: pageTo - pageFrom + 1, priority: prioritized ? 10 : 100, relevance: prioritized ? "Relevant" : "Deferred" });
  }
  return chunks.sort((left, right) => left.priority - right.priority || left.chunkNumber - right.chunkNumber);
};

export const progressSnapshot = ({ totalPages, chunks, startedAt, now = Date.now() }) => {
  const completed = chunks.filter((chunk) => ["Completed", "Needs Review"].includes(chunk.status));
  const processedPages = completed.reduce((sum, chunk) => sum + Number(chunk.page_count || chunk.pageCount || 0), 0);
  const elapsedSeconds = Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 1000));
  const secondsPerPage = processedPages ? elapsedSeconds / processedPages : 0;
  const remainingPages = Math.max(0, totalPages - processedPages);
  return {
    totalPages,
    processedPages,
    remainingPages,
    completedChunks: completed.length,
    remainingChunks: Math.max(0, chunks.length - completed.length),
    progress: totalPages ? Math.min(100, Math.round((processedPages / totalPages) * 100)) : 0,
    elapsedSeconds,
    estimatedRemainingSeconds: secondsPerPage ? Math.round(remainingPages * secondsPerPage) : null,
  };
};

const DISCIPLINES = Object.freeze([
  ["Fire Alarm", /\b(?:fire alarm|fire detection|28\s*46\s*00)\b/i],
  ["CCTV", /\b(?:cctv|video surveillance)\b/i],
  ["Access Control", /\baccess control\b/i],
  ["BMS", /\b(?:bms|building management system)\b/i],
  ["Electrical", /\belectrical\b/i],
  ["Mechanical", /\bmechanical\b/i],
  ["Civil", /\bcivil\b/i],
  ["Architecture", /\barchitect(?:ure|ural)\b/i],
  ["Plumbing", /\bplumbing\b/i],
  ["General Notes", /\bgeneral notes\b/i],
  ["Structured Cabling", /\b(?:structured cabling|telecommunications|ict)\b/i],
  ["Public Address", /\b(?:public address|voice evacuation)\b/i],
  ["Audio Visual", /\b(?:audio visual|a\/v)\b/i],
  ["UPS", /\b(?:ups|uninterruptible power)\b/i],
  ["Low Current", /\b(?:low current|extra low voltage|elv)\b/i],
  ["MEP", /\b(?:mep|mechanical electrical plumbing)\b/i],
  ["General Requirements", /\b(?:general requirements|division\s*0?1)\b/i],
  ["Shared Requirements", /\b(?:shared requirements|common requirements)\b/i],
  ["Structural", /\bstructural\b/i],
  ["Fire Fighting", /\bfire fighting\b/i],
  ["HVAC", /\bhvac\b/i],
  ["Elevators and Escalators", /\b(?:elevators?|escalators?)\b/i],
  ["Landscape", /\blandscape\b/i],
]);

export const detectSpecificationDisciplines = (value) => {
  const source = String(value || "");
  const disciplines = DISCIPLINES.filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
  return disciplines.length ? [...new Set(disciplines)] : ["Unknown/Mixed"];
};

const cleanMapText = (value) => String(value || "").replace(/\s+/g, " ").trim();
const physicalPage = (value, totalPages) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= totalPages ? parsed : null;
};

export const buildSpecificationDocumentMap = ({ pages = [], totalPages, bookmarkEntries = [] } = {}) => {
  const boundedPages = pages.filter((page) => Number(page?.page) >= 1).sort((a, b) => Number(a.page) - Number(b.page));
  const scannedTo = boundedPages.at(-1)?.page || 0;
  const entries = (bookmarkEntries || []).map((entry) => ({
    ...entry,
    title: cleanMapText(entry.title) || null,
    sourcePage: null,
    printedPageReference: null,
    sectionNumber: null,
    sectionTitle: cleanMapText(entry.title) || null,
    discipline: detectSpecificationDisciplines(entry.title).join(", "),
    startPage: physicalPage(entry.page, totalPages),
    endPage: null,
    evidenceText: cleanMapText(entry.title) || null,
    reviewStatus: entry.page ? "Needs Review" : "Unresolved",
    method: "PDF Bookmark",
  }));

  for (const page of boundedPages) {
    const lines = (page.lines || []).map(cleanMapText).filter(Boolean);
    const tocPage = lines.some((line) => /^(?:table of contents|contents)$/i.test(line));
    for (const line of lines.slice(0, 160)) {
      let match = line.match(/^SECTION\s+([\d ]{4,}|\d+(?:\.\d+)+)\s*(?:[-–—:]\s*)?(.+)$/i);
      let method = "Heading Detection";
      let sectionNumber = match?.[1]?.replace(/\s+/g, " ").trim() || null;
      let sectionTitle = match?.[2] || null;
      let printed = null;
      if (!match && tocPage) {
        match = line.match(/^(\d{1,2})\s+([A-Z][A-Z &/\-]{4,})(?:\s+\.{2,}\s*|\s{2,})([ivxlcdm]+|\d+)?$/i)
          || line.match(/^(\d{1,2})\s+([A-Z][A-Z &/\-]{4,})$/);
        if (match) { method = "Visible TOC"; sectionNumber = match[1]; sectionTitle = match[2]; printed = match[3] || null; }
      }
      if (!match) {
        match = line.match(/^(.{3,120}?)\s*\.{2,}\s*([ivxlcdm]+|\d+(?:[-.]\d+)*)$/i);
        if (match && tocPage) { method = "Visible TOC"; sectionTitle = match[1]; printed = match[2]; sectionNumber = null; }
      }
      if (!match) {
        match = line.match(/^DIVISION\s+(\d{1,2})\b(?:\s*[-–—:]\s*)?(.*)$/i);
        if (match) { sectionNumber = match[1]; sectionTitle = match[2] || `Division ${match[1]}`; }
      }
      if (!match || !cleanMapText(sectionTitle)) continue;
      const title = `${sectionNumber ? `${sectionNumber} ` : ""}${cleanMapText(sectionTitle)}`.trim();
      const startPage = method === "Heading Detection" ? Number(page.page) : physicalPage(printed, totalPages);
      entries.push({ title, page: startPage, depth: method === "Visible TOC" ? 1 : 0, sourcePage: Number(page.page), printedPageReference: printed, sectionNumber, sectionTitle: cleanMapText(sectionTitle), discipline: detectSpecificationDisciplines(title).join(", "), startPage, endPage: null, evidenceText: line, method, confidence: method === "Visible TOC" ? (printed ? 88 : 78) : 92, reviewStatus: startPage ? "Needs Review" : "Unresolved" });
    }
  }

  const uniqueByKey = new Map();
  for (const entry of entries) {
    const key = entry.method === "Heading Detection" ? `${entry.method}|${entry.title}` : `${entry.method}|${entry.sourcePage || ""}|${entry.startPage || ""}|${entry.title}`;
    if (!uniqueByKey.has(key)) uniqueByKey.set(key, entry);
  }
  const unique = [...uniqueByKey.values()].sort((a, b) => (a.startPage ?? Number.MAX_SAFE_INTEGER) - (b.startPage ?? Number.MAX_SAFE_INTEGER) || (a.sourcePage ?? 0) - (b.sourcePage ?? 0));
  const located = unique.filter((entry) => entry.startPage);
  for (let index = 0; index < located.length; index += 1) {
    const next = located[index + 1];
    const safeBoundary = next?.startPage ? next.startPage - 1 : Math.min(totalPages, scannedTo || located[index].startPage);
    located[index].endPage = Math.max(located[index].startPage, safeBoundary);
  }
  const covered = new Set();
  for (const entry of located) for (let page = entry.startPage; page <= entry.endPage; page += 1) covered.add(page);
  const gaps = [];
  for (let page = 1; page <= totalPages;) {
    if (covered.has(page)) { page += 1; continue; }
    const start = page;
    while (page <= totalPages && !covered.has(page)) page += 1;
    gaps.push({ startPage: start, endPage: page - 1 });
  }
  for (const gap of gaps) unique.push({ title: `Unknown pages ${gap.startPage}-${gap.endPage}`, page: gap.startPage, depth: 0, sourcePage: null, printedPageReference: null, sectionNumber: null, sectionTitle: "Unknown", discipline: "Unknown/Mixed", startPage: gap.startPage, endPage: gap.endPage, evidenceText: null, method: "Unmapped Range", confidence: 0, reviewStatus: "Unresolved" });
  return { entries: unique, coverage: { totalPages, scannedPages: boundedPages.length, mappedPages: covered.size, unknownPages: totalPages - covered.size, gaps, overlaps: [] } };
};

export const mapSpecificationPages = (pages, projectSystem = "") => pages.map((page) => {
  const heading = (page.lines || []).find((line) => /^(?:section|part|division|chapter|\d+(?:\.\d+)+)\b/i.test(String(line).trim())) || (page.lines || [])[0] || "";
  const text = (page.lines || []).slice(0, 40).join(" ");
  const disciplines = detectSpecificationDisciplines(text).filter((name) => name !== "Unknown/Mixed");
  const relevant = !projectSystem || projectSystem === "Unspecified" || disciplines.length === 0 || disciplines.some((name) => name.toLowerCase() === projectSystem.toLowerCase());
  return { page: page.page, title: String(heading).slice(0, 500) || null, disciplines, relevant, extractionMethod: "explicit-heading-map", confidence: heading ? 85 : 40 };
});
