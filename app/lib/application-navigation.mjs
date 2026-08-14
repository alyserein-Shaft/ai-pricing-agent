export const GLOBAL_DESTINATIONS = Object.freeze([
  { id: "Home", label: "Home", icon: "⌂", workspace: "Home" },
  { id: "Projects", label: "Projects", icon: "▦", workspace: "Projects" },
  {
    id: "Knowledge",
    label: "Knowledge",
    icon: "▤",
    workspace: "Knowledge",
    children: [
      { id: "Knowledge Files", label: "Files", workspace: "Knowledge", section: "Files" },
      { id: "Knowledge Products", label: "Products", workspace: "Knowledge", section: "Products" },
      { id: "Knowledge Manufacturers", label: "Manufacturers", workspace: "Knowledge", section: "Manufacturers" },
      { id: "Knowledge Prices", label: "Prices", workspace: "Knowledge", section: "Prices" },
      { id: "Knowledge Case Studies", label: "Case Studies", workspace: "Knowledge", section: "Case Studies" },
    ],
  },
  { id: "Reports", label: "Reports", icon: "▥", workspace: "Reports", commercial: true },
  { id: "Administration", label: "Administration", icon: "⚙", workspace: "Administration" },
]);

export const PROJECT_NAVIGATION = Object.freeze([
  { id: "Overview", label: "Overview", workspace: "Overview" },
  {
    id: "Tender",
    label: "Tender",
    children: [
      { id: "Documents", label: "Documents", workspace: "Documents" },
      { id: "BOQ", label: "BOQ", workspace: "BOQ" },
      { id: "AI Understanding Review", label: "AI Understanding Review", workspace: "AI Understanding Review" },
      { id: "Requirements", label: "Requirements", workspace: "Technical Review" },
    ],
  },
  { id: "Product Selection", label: "Product Selection", workspace: "Technical Matching" },
  {
    id: "Pricing",
    label: "Pricing",
    children: [
      { id: "Supplier Price Evidence", label: "Supplier Price Evidence", workspace: "Price Sources" },
      { id: "Costing & Pricing", label: "Costing & Pricing", workspace: "Costing" },
    ],
  },
  { id: "Quotation", label: "Quotation", workspace: "Quotation" },
  { id: "Activity", label: "Activity", workspace: "Activity" },
]);

export const LEGACY_GLOBAL_WORKSPACE_MAP = Object.freeze({
  Dashboard: { workspace: "Home" },
  Home: { workspace: "Home" },
  Projects: { workspace: "Projects" },
  Knowledge: { workspace: "Knowledge", section: "Files", canonicalWorkspace: "Knowledge" },
  "Knowledge Library": { workspace: "Knowledge", section: "Files", canonicalWorkspace: "Knowledge" },
  "Product Library": { workspace: "Product Library", section: "Products", canonicalWorkspace: "Knowledge" },
  "Pricing Memory": { workspace: "Knowledge", section: "Prices" },
  "Case Studies": { workspace: "Case Studies", section: "Case Studies", canonicalWorkspace: "Knowledge" },
  Reports: { workspace: "Reports" },
  Settings: { workspace: "Administration" },
  Administration: { workspace: "Administration" },
});

export function resolveGlobalDestination(workspace, section = "") {
  const mapped = LEGACY_GLOBAL_WORKSPACE_MAP[workspace] || null;
  if (!mapped) return null;
  const requestedSection = section === "Price Lists" ? "Prices" : section;
  const resolvedSection = requestedSection || mapped.section || "";
  if (["Knowledge", "Knowledge Library"].includes(workspace)) {
    if (resolvedSection === "Products") return { workspace: "Product Library", section: "Products", canonicalWorkspace: "Knowledge" };
    if (resolvedSection === "Case Studies") return { workspace: "Case Studies", section: "Case Studies", canonicalWorkspace: "Knowledge" };
    return { workspace: "Knowledge", section: resolvedSection, canonicalWorkspace: "Knowledge" };
  }
  return { ...mapped, section: resolvedSection };
}

export function globalNavigationSelection(workspace, section = "") {
  const resolved = resolveGlobalDestination(workspace, section);
  if (!resolved) return { parent: "", child: "" };
  if (["Knowledge", "Product Library", "Case Studies"].includes(resolved.workspace)) {
    const child = resolved.workspace === "Product Library"
      ? "Knowledge Products"
      : resolved.workspace === "Case Studies"
        ? "Knowledge Case Studies"
        : resolved.section === "Manufacturers"
          ? "Knowledge Manufacturers"
          : resolved.section === "Prices"
            ? "Knowledge Prices"
            : "Knowledge Files";
    return { parent: "Knowledge", child };
  }
  return { parent: resolved.workspace, child: "" };
}

export function projectNavigationSelection(workspace) {
  for (const item of PROJECT_NAVIGATION) {
    if (item.workspace === workspace) return { parent: item.id, child: "" };
    const child = item.children?.find((entry) => entry.workspace === workspace);
    if (child) return { parent: item.id, child: child.id };
  }
  if (workspace === "Project Context") return { parent: "Tender", child: "Documents" };
  if (["Supplier RFQs"].includes(workspace)) return { parent: "Pricing", child: "Supplier Price Evidence" };
  if (["Commercial Review"].includes(workspace)) return { parent: "Quotation", child: "" };
  return { parent: "", child: "" };
}

export function buildGlobalLocation(workspace, section = "") {
  const resolved = resolveGlobalDestination(workspace, section);
  const canonicalWorkspace = resolved?.canonicalWorkspace || resolved?.workspace || workspace;
  const query = new URLSearchParams({ workspace: canonicalWorkspace });
  if (resolved?.section || section) query.set("section", resolved?.section || section);
  return `?${query.toString()}`;
}

export function canonicalizeGlobalSearch(search = "") {
  const query = new URLSearchParams(search);
  if (query.get("project")) return search.startsWith("?") ? search : `?${search}`;
  const requestedWorkspace = query.get("workspace") || query.get("module") || "Home";
  const resolved = resolveGlobalDestination(requestedWorkspace, query.get("section") || "");
  if (!resolved) return null;
  query.delete("module");
  query.set("workspace", resolved.canonicalWorkspace || resolved.workspace);
  if (resolved.section) query.set("section", resolved.section);
  else query.delete("section");
  return `?${query.toString()}`;
}
