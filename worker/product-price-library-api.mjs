import { authenticateLibraryActor } from "./library-auth.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const parse = (value, fallback) => { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const today = () => new Date().toISOString().slice(0, 10);
const canGovernGlobal = (role) => ["Administrator", "Library Manager"].includes(role);
const ownedProject = async (db, projectId, userId) => !projectId || db.prepare("SELECT id FROM projects WHERE id=? AND owner_user_id=?").bind(projectId, userId).first();
const decision = async (db, user, entityType, entityId, action, previousValue, newValue, reason, projectId = null) => db.prepare("INSERT INTO product_library_decisions (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, decided_by, decided_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id("libdecision"), projectId, entityType, entityId, action, JSON.stringify(previousValue), JSON.stringify(newValue), reason, user.id, user.role).run();

const visibleProduct = async (db, productId) => db.prepare("SELECT p.*, m.name manufacturer, b.name brand, f.name family FROM canonical_library_products p JOIN product_manufacturers m ON m.id=p.manufacturer_id LEFT JOIN product_brands b ON b.id=p.brand_id LEFT JOIN product_families f ON f.id=p.family_id WHERE p.requested_product_id=?").bind(productId).first();
const mapProduct = (row) => ({ ...row, attributes: parse(row.attributes, []), standards: parse(row.standards, []), approvedForDiscovery: Boolean(row.approved_for_discovery) });

export const queryLibraryProducts = async (db, { query = "", discovery = false, sourceId = null, page = 1, pageSize = 50 } = {}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(200, Math.max(1, Number(pageSize) || 50));
  const q = `%${String(query || "").trim().toLowerCase()}%`;
  const sourceJoin = sourceId
    ? "JOIN (SELECT DISTINCT product_id FROM product_source_evidence WHERE source_id=?) source_scope ON source_scope.product_id=requested.id"
    : "";
  const where = `WHERE (?='%%' OR lower(requested.part_number) LIKE ? OR lower(requested.description) LIKE ? OR lower(c.part_number) LIKE ?
    OR lower(c.description) LIKE ? OR lower(m.name) LIKE ?
    OR EXISTS (SELECT 1 FROM product_aliases a WHERE a.product_id IN (requested.id,c.id) AND a.deleted_at IS NULL AND lower(a.alias) LIKE ?)
    OR EXISTS (SELECT 1 FROM manufacturer_order_code_observations o WHERE o.canonical_product_id=c.id AND o.status='Active' AND lower(o.original_order_code) LIKE ?))
    AND (?=0 OR c.approved_for_discovery=1)`;
  const commonBindings = [q, q, q, q, q, q, q, q, discovery ? 1 : 0];
  const sourceBindings = sourceId ? [sourceId] : [];
  const count = await db.prepare(`SELECT COUNT(DISTINCT requested.id) total_products
    FROM library_products requested
    ${sourceJoin}
    JOIN canonical_library_products c ON c.requested_product_id=requested.id
    JOIN product_manufacturers m ON m.id=c.manufacturer_id
    LEFT JOIN product_brands b ON b.id=c.brand_id LEFT JOIN product_families f ON f.id=c.family_id
    ${where}`).bind(...sourceBindings, ...commonBindings).first();
  const totalProducts = Number(count?.total_products || 0);
  const result = await db.prepare(`SELECT DISTINCT c.*, requested.id requested_product_id, requested.part_number requested_part_number,
    requested.identity_status requested_identity_status, requested.review_status requested_review_status,
    requested.approved_for_discovery requested_approved_for_discovery,
    m.name manufacturer, b.name brand, f.name family,
    EXISTS (SELECT 1 FROM product_lifecycle_events lifecycle WHERE lifecycle.product_id=c.id AND lower(lifecycle.lifecycle_status)='active') lifecycle_evidence_supported
    FROM library_products requested
    ${sourceJoin}
    JOIN canonical_library_products c ON c.requested_product_id=requested.id
    JOIN product_manufacturers m ON m.id=c.manufacturer_id
    LEFT JOIN product_brands b ON b.id=c.brand_id LEFT JOIN product_families f ON f.id=c.family_id
    ${where}
    ORDER BY CASE WHEN lower(requested.part_number)=lower(trim(?,'%')) THEN 0 ELSE 1 END, m.name, requested.part_number
    LIMIT ? OFFSET ?`).bind(...sourceBindings, ...commonBindings, q, safePageSize, (safePage - 1) * safePageSize).all();
  return {
    products: (result.results || []).map((row) => ({
      ...mapProduct(row),
      canonicalProductId: row.id,
      canonicalPartNumber: row.part_number,
      requestedProductId: row.requested_product_id,
      requestedPartNumber: row.requested_part_number,
      requestedIdentityStatus: row.requested_identity_status,
      reviewStatus: row.requested_review_status,
      approvedForDiscovery: Boolean(row.requested_approved_for_discovery),
      lifecycleEvidenceSupported: Boolean(row.lifecycle_evidence_supported),
      resolvesToCanonical: row.requested_product_id !== row.id,
    })),
    page: safePage,
    pageSize: safePageSize,
    totalProducts,
    totalPages: Math.max(1, Math.ceil(totalProducts / safePageSize)),
  };
};

export const visibleLibrarySource = async (db, { sourceId, projectId = null, userId }) => {
  if (!sourceId) return null;
  const source = await db.prepare("SELECT id,scope_type,project_id FROM product_sources WHERE id=?").bind(sourceId).first();
  if (!source) return null;
  if (projectId && !(await ownedProject(db, projectId, userId))) return null;
  if (source.scope_type === "Global") return source;
  if (!source.project_id || (projectId && source.project_id !== projectId)) return null;
  return await ownedProject(db, source.project_id, userId) ? source : null;
};

export const persistHoneywellLibrary = async (env, { bytes, document, user }) => {
  const sourceExists = await env.DB.prepare("SELECT id FROM product_sources WHERE checksum=? AND scope_type='Global' AND project_id IS NULL").bind(document.sha256).first();
  if (sourceExists) return { sourceId: sourceExists.id, idempotent: true };
  const extracted = ingestHoneywellFarenhytWorkbook(bytes, { documentId: document.document_id, fileName: document.original_filename });
  const manufacturerId = id("manufacturer"), brandId = id("brand"), sourceId = id("productsource");
  const existingManufacturer = await env.DB.prepare("SELECT id FROM product_manufacturers WHERE normalized_name='HONEYWELL'").first();
  const resolvedManufacturerId = existingManufacturer?.id || manufacturerId;
  const statements = [];
  if (!existingManufacturer) statements.push(env.DB.prepare("INSERT INTO product_manufacturers (id, name, normalized_name, status, created_by) VALUES (?, 'Honeywell', 'HONEYWELL', 'Needs Review', ?)").bind(manufacturerId, user.id));
  const existingBrand = await env.DB.prepare("SELECT id FROM product_brands WHERE manufacturer_id=? AND normalized_name='FARENHYT'").bind(resolvedManufacturerId).first(); const resolvedBrandId = existingBrand?.id || brandId;
  if (!existingBrand) statements.push(env.DB.prepare("INSERT INTO product_brands (id, manufacturer_id, name, normalized_name, status) VALUES (?, ?, 'Farenhyt', 'FARENHYT', 'Needs Review')").bind(brandId, resolvedManufacturerId));
  statements.push(env.DB.prepare("INSERT INTO product_sources (id, project_id, document_id, document_version_id, checksum, source_type, authority, scope_type, file_name, release_version, effective_from, valid_until, currency, validity_state, review_status, downstream_use, metadata, created_by) VALUES (?, NULL, ?, ?, ?, ?, ?, 'Global', ?, ?, ?, NULL, ?, ?, 'Needs Review', 'Discovery Only', ?, ?)").bind(sourceId, document.document_id, document.id, document.sha256, extracted.priceSource.sourceType, "Manufacturer", document.original_filename, extracted.priceSource.releaseVersion, extracted.priceSource.effectiveFrom, extracted.priceSource.currency, extracted.priceSource.validityState, JSON.stringify({ libraryVersion: extracted.libraryVersion, rulesetVersion: extracted.rulesetVersion, summary: extracted.summary, excludedSheets: extracted.excludedSheets }), user.id));
  const familyIds = new Map(); for (const family of extracted.families) { const key = family.normalizedName; if (familyIds.has(key)) continue; const familyId = id("family"); familyIds.set(key, familyId); statements.push(env.DB.prepare("INSERT INTO product_families (id, brand_id, name, normalized_name, engineering_domain, review_status) VALUES (?, ?, ?, ?, ?, 'Needs Review')").bind(familyId, resolvedBrandId, family.name, family.normalizedName, family.engineeringDomain)); }
  const resolvedKeys = new Map();
  for (const product of extracted.products) {
    const exactExisting = await env.DB.prepare("SELECT id, normalized_part_number FROM canonical_library_products WHERE requested_product_id=id AND manufacturer_id=? AND upper(part_number)=upper(?) LIMIT 1").bind(resolvedManufacturerId, product.partNumber).first();
    const resolvedKey = exactExisting?.normalized_part_number || product.normalizedPartNumber;
    resolvedKeys.set(product.id, resolvedKey);
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO library_products (id, manufacturer_id, brand_id, family_id, part_number, normalized_part_number, description, lifecycle_status, country_of_origin, attributes, standards, review_status, approved_for_discovery, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Needs Review', 0, ?)").bind(id("product"), resolvedManufacturerId, resolvedBrandId, familyIds.get(String(product.family).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()) || null, product.partNumber, resolvedKey, product.description, product.lifecycleStatus, product.countryOfOrigin, JSON.stringify(product.attributes), JSON.stringify(product.standards), user.id));
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO product_source_evidence (id, product_id, source_id, sheet, row_number, cells, original_text, parser_version) VALUES (?, (SELECT id FROM library_products WHERE manufacturer_id=? AND normalized_part_number=?), ?, ?, ?, ?, ?, ?)").bind(id("evidence"), resolvedManufacturerId, resolvedKey, sourceId, product.source.sheet, product.source.row, JSON.stringify(product.source.cells), product.description, PRODUCT_LIBRARY_VERSION));
  }
  for (const price of extracted.prices) { const product = extracted.products.find((entry) => entry.id === price.productId); if (!product) continue; statements.push(env.DB.prepare("INSERT OR IGNORE INTO price_records (id, product_id, source_id, amount_minor, currency, price_type, effective_from, valid_until, validity_state, approval_status, downstream_use, source_location) VALUES (?, (SELECT id FROM library_products WHERE manufacturer_id=? AND normalized_part_number=?), ?, ?, ?, ?, ?, NULL, ?, 'Needs Review', 'Discovery Only', ?)").bind(id("price"), resolvedManufacturerId, resolvedKeys.get(product.id) || product.normalizedPartNumber, sourceId, Math.round(price.amount * 100), price.currency, price.priceType, price.effectiveFrom, price.validityState, JSON.stringify(price.source))); }
  for (const event of extracted.lifecycle) statements.push(env.DB.prepare("INSERT INTO product_lifecycle_events (id, source_id, product_id, obsolete_part_number, lifecycle_status, replacement_candidates, review_status, source_location) VALUES (?, ?, (SELECT id FROM library_products WHERE manufacturer_id=? AND normalized_part_number=?), ?, ?, ?, 'Needs Review', ?)").bind(id("lifecycle"), sourceId, resolvedManufacturerId, event.obsoletePart.toUpperCase().replace(/\s+/g, ""), event.obsoletePart, event.lifecycleStatus, JSON.stringify(event.replacementCandidates), JSON.stringify(event.source)));
  for (let offset = 0; offset < statements.length; offset += 50) await env.DB.batch(statements.slice(offset, offset + 50));
  return { sourceId, idempotent: false, summary: extracted.summary, safety: { productsApproved: 0, currentPricesApproved: 0, downstreamUse: "Discovery Only" } };
};

export const persistGeneralXlsxPriceList = async (env, { bytes, document, user }) => {
  const existing = await env.DB.prepare("SELECT id FROM product_sources WHERE checksum=? AND scope_type='Global' AND project_id IS NULL").bind(document.sha256).first();
  if (existing) return { sourceId: existing.id, idempotent: true, duplicateBasis: "SHA-256" };
  const extracted = ingestGeneralXlsxPriceList(bytes, { documentId: document.document_id, documentVersionId: document.id, fileName: document.original_filename, sha256: document.sha256 });
  const sourceId = id("productsource"), statements = [], manufacturerIds = new Map(), brandIds = new Map(), productIds = new Map();
  statements.push(env.DB.prepare("INSERT INTO product_sources (id, project_id, document_id, document_version_id, checksum, source_type, authority, scope_type, file_name, release_version, effective_from, valid_until, currency, validity_state, review_status, downstream_use, metadata, created_by) VALUES (?, NULL, ?, ?, ?, ?, 'Source Document — Review Required', 'Global', ?, NULL, NULL, NULL, ?, 'Validity Review Required', 'Needs Review', 'Discovery Only', ?, ?)").bind(sourceId, document.document_id, document.id, document.sha256, document.document_type, document.original_filename, extracted.priceSource.currency, JSON.stringify({ importer: extracted.importer, parserVersion: extracted.parserVersion, summary: extracted.summary, warnings: extracted.warnings, unresolvedRows: extracted.unresolvedRows, unknownCurrencyPriceCandidates: extracted.prices.filter(price => !price.currency) }), user.id));
  for (const product of extracted.products) {
    const manufacturerKey = String(product.manufacturer).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
    let manufacturerId = manufacturerIds.get(manufacturerKey);
    if (!manufacturerId) { const existingManufacturer = await env.DB.prepare("SELECT id FROM product_manufacturers WHERE normalized_name=?").bind(manufacturerKey).first(); manufacturerId = existingManufacturer?.id || id("manufacturer"); manufacturerIds.set(manufacturerKey, manufacturerId); if (!existingManufacturer) statements.push(env.DB.prepare("INSERT INTO product_manufacturers (id,name,normalized_name,status,created_by) VALUES (?,?,?,'Needs Review',?)").bind(manufacturerId, product.manufacturer, manufacturerKey, user.id)); }
    let brandId = null;
    if (product.brand) { const brandKey = `${manufacturerId}:${String(product.brand).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()}`; brandId = brandIds.get(brandKey); if (!brandId) { const normalizedBrand = brandKey.slice(brandKey.indexOf(":") + 1), existingBrand = await env.DB.prepare("SELECT id FROM product_brands WHERE manufacturer_id=? AND normalized_name=?").bind(manufacturerId, normalizedBrand).first(); brandId = existingBrand?.id || id("brand"); brandIds.set(brandKey, brandId); if (!existingBrand) statements.push(env.DB.prepare("INSERT INTO product_brands (id,manufacturer_id,name,normalized_name,status) VALUES (?,?,?,?,'Needs Review')").bind(brandId, manufacturerId, product.brand, normalizedBrand)); } }
    let productId = productIds.get(product.id);
    if (!productId) { const existingProduct = await env.DB.prepare("SELECT id FROM canonical_library_products WHERE requested_product_id=id AND manufacturer_id=? AND normalized_part_number=? LIMIT 1").bind(manufacturerId, product.normalizedPartNumber).first(); productId = existingProduct?.id || id("product"); productIds.set(product.id, productId); if (!existingProduct) statements.push(env.DB.prepare("INSERT OR IGNORE INTO library_products (id,manufacturer_id,brand_id,family_id,part_number,normalized_part_number,description,lifecycle_status,attributes,standards,review_status,approved_for_discovery,created_by) VALUES (?,?,?,NULL,?,?,?,'Unknown — Review Required',?,'[]','Needs Review',0,?)").bind(productId, manufacturerId, brandId, product.partNumber, product.normalizedPartNumber, product.description, JSON.stringify([{ name: "source_quantity", value: product.quantity, authority: "Source Fact Only" }, { name: "source_unit", value: product.unit, authority: "Source Fact Only" }, { name: "source_code", value: product.code, authority: "Source Fact Only" }, { name: "source_cd", value: product.cd, authority: "Source Fact Only" }, { name: "source_discount", value: product.discount, authority: "Source Fact Only — Not a Discount Rule" }, { name: "source_section", value: product.section, authority: "Source Fact Only" }]), user.id)); }
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO product_source_evidence (id,product_id,source_id,sheet,row_number,cells,original_text,parser_version) VALUES (?,?,?,?,?,?,?,?)").bind(id("evidence"), productId, sourceId, product.source.sheet, product.source.row, JSON.stringify({ references: product.source.cells, originalValues: product.source.originalValues }), product.description, GENERAL_XLSX_PRICE_LIST_VERSION));
  }
  for (const price of extracted.prices) { if (!price.currency) continue; const productId = productIds.get(price.productId); if (!productId) continue; statements.push(env.DB.prepare("INSERT OR IGNORE INTO price_records (id,product_id,source_id,amount_minor,currency,price_type,effective_from,valid_until,validity_state,approval_status,downstream_use,source_location) VALUES (?,?,?,?,?,?,NULL,NULL,'Validity Review Required','Needs Review','Discovery Only',?)").bind(id("price"), productId, sourceId, Math.round(price.amount * 100), price.currency, price.priceType, JSON.stringify({ ...price.source, quantity: price.quantity, unit: price.unit, code: price.code, cd: price.cd, discount: price.discount, discountAuthority: "Source Fact Only — Not an Approved Rule" })) ); }
  for (let offset = 0; offset < statements.length; offset += 50) await env.DB.batch(statements.slice(offset, offset + 50));
  return { sourceId, idempotent: false, importer: extracted.importer, summary: extracted.summary, warnings: extracted.warnings, safety: { productsApproved: 0, validCurrentPrices: 0, costingEligiblePrices: 0, downstreamUse: "Discovery Only", boqRecordsModified: 0, matchingInvoked: false } };
};

export const persistIfp75Datasheet = async (env, { document, user }) => {
  const existing = await env.DB.prepare("SELECT id FROM product_sources WHERE checksum=? AND scope_type='Global' AND project_id IS NULL").bind(document.sha256).first();
  if (existing) return { sourceId: existing.id, idempotent: true, duplicateBasis: "SHA-256", attributesCreated: 0, productsLinked: 0 };
  const extracted = extractIfp75Datasheet({ checksum: document.sha256, byteSize: document.byte_size });
  const existingManufacturer = await env.DB.prepare("SELECT id FROM product_manufacturers WHERE normalized_name='HONEYWELL'").first();
  const manufacturerId = existingManufacturer?.id || id("manufacturer");
  const existingBrand = existingManufacturer ? await env.DB.prepare("SELECT id FROM product_brands WHERE manufacturer_id=? AND normalized_name='FARENHYT'").bind(manufacturerId).first() : null;
  const brandId = existingBrand?.id || id("brand");
  const sourceId = id("productsource");
  const statements = [];
  if (!existingManufacturer) statements.push(env.DB.prepare("INSERT INTO product_manufacturers (id, name, normalized_name, status, created_by) VALUES (?, 'Honeywell', 'HONEYWELL', 'Needs Review', ?)").bind(manufacturerId, user.id));
  if (!existingBrand) statements.push(env.DB.prepare("INSERT INTO product_brands (id, manufacturer_id, name, normalized_name, status) VALUES (?, ?, 'Farenhyt', 'FARENHYT', 'Needs Review')").bind(brandId, manufacturerId));
  statements.push(env.DB.prepare("INSERT INTO product_sources (id, project_id, document_id, document_version_id, checksum, source_type, authority, scope_type, file_name, release_version, effective_from, valid_until, currency, validity_state, review_status, downstream_use, metadata, created_by) VALUES (?, NULL, ?, ?, ?, 'Product Datasheet', 'Official Manufacturer', 'Global', ?, ?, ?, NULL, NULL, 'Current Document — Applicability Review Required', 'Needs Review', 'Discovery Only', ?, ?)").bind(sourceId, document.document_id, document.id, document.sha256, document.original_filename, IFP75_DATASHEET_SOURCE_VERSION, extracted.source.publicationDate, JSON.stringify({ ...extracted.source, warnings: extracted.warnings }), user.id));
  for (const candidate of extracted.products) {
    const normalized = candidate.code.replace(/[^A-Z0-9]/g, "");
    const existingProduct = await env.DB.prepare("SELECT id FROM canonical_library_products WHERE requested_product_id=id AND manufacturer_id=? AND normalized_part_number=?").bind(manufacturerId, normalized).first();
    const productId = existingProduct?.id || id("product");
    if (!existingProduct) statements.push(env.DB.prepare("INSERT INTO library_products (id, manufacturer_id, brand_id, family_id, part_number, normalized_part_number, description, lifecycle_status, attributes, standards, review_status, approved_for_discovery, created_by) VALUES (?, ?, ?, NULL, ?, ?, ?, 'Unknown — Review Required', '[]', '[]', 'Needs Review', 0, ?)").bind(productId, manufacturerId, brandId, candidate.code, normalized, candidate.description, user.id));
    statements.push(env.DB.prepare("INSERT INTO product_documents (id, product_id, variant_id, document_id, document_version_id, document_type, source_location, source_reliability, review_status, created_by) VALUES (?, ?, NULL, ?, ?, 'Product Datasheet', ?, 'Authoritative Manufacturer Source', 'Needs Review', ?)").bind(id("productdocument"), productId, document.document_id, document.id, JSON.stringify({ pages: [1, 2, 3, 4], sourceId, parserVersion: IFP75_DATASHEET_PARSER_VERSION, sourceVersion: IFP75_DATASHEET_SOURCE_VERSION }), user.id));
    statements.push(env.DB.prepare("INSERT INTO product_source_evidence (id, product_id, source_id, sheet, row_number, page, cells, original_text, parser_version) VALUES (?, ?, ?, NULL, NULL, 1, '[]', ?, ?)").bind(id("evidence"), productId, sourceId, "The IFP-75 and IFP-75HV (red) and the IFP-75B and IFP-75HVB (black)", IFP75_DATASHEET_PARSER_VERSION));
    for (const attribute of candidate.attributes) {
      const evidence = { sourceId, documentId: document.document_id, documentVersionId: document.id, page: attribute.page, section: attribute.section, exactText: attribute.exactText, parserVersion: IFP75_DATASHEET_PARSER_VERSION, sourceVersion: IFP75_DATASHEET_SOURCE_VERSION };
      statements.push(env.DB.prepare("INSERT INTO product_attributes (id, product_id, variant_id, attribute_name, value_json, original_value, normalized_value, unit, source_id, evidence_json, confidence, review_status, version_number, created_by) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'Needs Review', 1, ?)").bind(id("attribute"), productId, attribute.attributeName, JSON.stringify({ original: attribute.originalValue, normalized: attribute.normalizedValue, unit: attribute.unit }), attribute.originalValue, attribute.normalizedValue, attribute.unit, sourceId, JSON.stringify(evidence), attribute.confidence, user.id));
    }
    for (const claim of extracted.listingClaims) {
      const evidence = { sourceId, documentVersionId: document.id, page: claim.page, section: claim.section, exactText: claim.exactText, parserVersion: IFP75_DATASHEET_PARSER_VERSION, sourceVersion: IFP75_DATASHEET_SOURCE_VERSION };
      statements.push(env.DB.prepare("INSERT INTO product_certifications (id, product_id, variant_id, certification_type, standard_body, standard_number, part, revision_year, scope, region, document_id, evidence_location, status, confidence, review_status, version_number, created_by) VALUES (?, ?, NULL, ?, ?, ?, NULL, NULL, 'Manufacturer datasheet claim only', NULL, ?, ?, 'Unverified', ?, 'Needs Review', 1, ?)").bind(id("certification"), productId, claim.type, claim.body, claim.number, document.document_id, JSON.stringify(evidence), claim.confidence, user.id));
    }
  }
  statements.push(env.DB.prepare("INSERT INTO library_processing_jobs (id, source_id, kind, stage, status, progress, attempt, max_attempts, timeout_ms, cancel_requested, parser_version, model_version, prompt_version, rule_version, input_fingerprint, idempotency_key, logs_json, created_by, started_at, completed_at) VALUES (?, ?, 'Product Source', 'Needs Review', 'Needs Review', 100, 1, 3, 300000, 0, ?, 'not-used', 'not-used', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").bind(id("libraryjob"), sourceId, IFP75_DATASHEET_PARSER_VERSION, IFP75_DATASHEET_SOURCE_VERSION, document.sha256, `ifp75-datasheet:${document.sha256}`, JSON.stringify([{ stage: "Completed", message: "Official IFP-75 datasheet extracted; all attributes and listing claims await review." }]), user.id));
  for (let offset = 0; offset < statements.length; offset += 50) await env.DB.batch(statements.slice(offset, offset + 50));
  return { sourceId, idempotent: false, productsLinked: extracted.products.map((product) => product.code), attributesCreated: extracted.products.reduce((sum, product) => sum + product.attributes.length, 0), listingClaimsCreated: extracted.products.length * extracted.listingClaims.length, warnings: extracted.warnings };
};

export const handleProductPriceLibraryApi = async (request, env) => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/library/") && !url.pathname.startsWith("/api/products/") && !url.pathname.startsWith("/api/price-sources/")) return null;
  if (!env.DB) return json({ error: { code: "PRODUCT_LIBRARY_UNAVAILABLE", message: "Product library storage is unavailable." } }, 503);
  const authentication = await authenticateLibraryActor(request, env); if (authentication.error) return json({ error: authentication.error }, authentication.error.status); const user = authentication.actor;

  if (url.pathname === "/api/library/taxonomy" && request.method === "GET") return json({ version: FIRE_ALARM_LIBRARY_VERSION, engineeringDomain: "Fire Alarm", taxonomy: FIRE_ALARM_TAXONOMY, attributeProfiles: FIRE_ALARM_ATTRIBUTE_PROFILES });

  if (url.pathname === "/api/library/products" && request.method === "GET") {
    const sourceId = url.searchParams.get("sourceId");
    if (sourceId) {
      const requestedProjectId = url.searchParams.get("projectId");
      if (!(await visibleLibrarySource(env.DB, { sourceId, projectId: requestedProjectId, userId: user.id }))) return json({ error: { code: "PRODUCT_SOURCE_NOT_FOUND", message: "Product source not found." } }, 404);
    }
    const result = await queryLibraryProducts(env.DB, {
      query: url.searchParams.get("q") || "",
      discovery: url.searchParams.get("discovery") === "true",
      sourceId,
      page: url.searchParams.get("page") || 1,
      pageSize: url.searchParams.get("pageSize") || 50,
    });
    return json({ ...result, sourceId: sourceId || null, safety: { matchingPerformed: false, priceEligibilityInferred: false, commercialApprovalInferred: false } });
  }
  if (url.pathname === "/api/library/sources" && request.method === "GET") {
    const projectId = url.searchParams.get("projectId"); if (!(await ownedProject(env.DB, projectId, user.id))) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
    const rows = projectId ? await env.DB.prepare("SELECT * FROM product_sources WHERE scope_type='Global' OR project_id=? ORDER BY created_at DESC").bind(projectId).all() : await env.DB.prepare("SELECT * FROM product_sources WHERE scope_type='Global' ORDER BY created_at DESC").all();
    return json({ sources: (rows.results || []).map((row) => ({ ...row, metadata: parse(row.metadata, {}) })) });
  }
  if (url.pathname === "/api/library/prices" && request.method === "GET") {
    const projectId = url.searchParams.get("projectId"); if (!(await ownedProject(env.DB, projectId, user.id))) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1)); const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") || 50))); const currency = url.searchParams.get("currency"); const state = url.searchParams.get("state"); const supplier = url.searchParams.get("supplier");
    const rows = await env.DB.prepare(`SELECT r.*, p.id canonical_product_id,p.part_number, p.description, s.source_type, s.review_status source_review_status, sp.name supplier_name FROM price_records r JOIN canonical_library_products p ON p.requested_product_id=r.product_id JOIN product_sources s ON s.id=r.source_id LEFT JOIN suppliers sp ON sp.id=r.supplier_id WHERE (r.project_id IS NULL OR r.project_id=?) AND (? IS NULL OR r.currency=?) AND (? IS NULL OR r.validity_state=?) AND (? IS NULL OR sp.name=?) ORDER BY r.created_at DESC LIMIT ? OFFSET ?`).bind(projectId || "", currency, currency, state, state, supplier, supplier, pageSize, (page - 1) * pageSize).all();
    return json({ page, pageSize, prices: rows.results || [], safety: { finalPriceSelectionPerformed: false, costingEligibilityInferred: false } });
  }
  const ingestMatch = url.pathname.match(/^\/api\/library\/document-versions\/([^/]+)\/ingest$/);
  if (ingestMatch && request.method === "POST") { if (!canGovernGlobal(user.role)) return json({ error: { code: "LIBRARY_ROLE_REQUIRED", message: "A Library Manager or Administrator must ingest global product sources." } }, 403); const document = await env.DB.prepare("SELECT v.*, d.document_type, d.project_id FROM document_versions v JOIN documents d ON d.id=v.document_id JOIN projects p ON p.id=d.project_id WHERE v.id=? AND p.owner_user_id=?").bind(decodeURIComponent(ingestMatch[1]), user.id).first(); if (!document) return json({ error: { code: "DOCUMENT_VERSION_NOT_FOUND", message: "Document version not found." } }, 404); if (!/price list|product catalogue|product datasheet/i.test(document.document_type)) return json({ error: { code: "SOURCE_CLASSIFICATION_REQUIRED", message: "Confirm this document as a Price List, Product Catalogue, or Product Datasheet before ingestion." } }, 409); const object = await env.FILES.get(document.object_key); if (!object) return json({ error: { code: "SOURCE_OBJECT_MISSING", message: "The source file is unavailable." } }, 409); try { if (/product datasheet/i.test(document.document_type)) return json(await persistIfp75Datasheet(env, { document, user }), 201); const bytes = new Uint8Array(await object.arrayBuffer()); return json(hasHoneywellFarenhytWorkbookStructure(bytes) ? await persistHoneywellLibrary(env, { bytes, document, user }) : await persistGeneralXlsxPriceList(env, { bytes, document, user }), 201); } catch (error) { return json({ error: { code: error.code || "PRODUCT_LIBRARY_INGESTION_FAILED", message: error.message } }, 422); } }
  const productMatch = url.pathname.match(/^\/api\/products\/([^/]+)(?:\/(prices|history|approve-discovery))?$/);
  if (productMatch) {
    const product = await visibleProduct(env.DB, decodeURIComponent(productMatch[1])); if (!product) return json({ error: { code: "PRODUCT_NOT_FOUND", message: "Product not found." } }, 404); const operation = productMatch[2] || "detail";
    if (operation === "detail" && request.method === "GET") {
      const requestedId = decodeURIComponent(productMatch[1]);
      const [requested, evidence, prices, attributes, certifications, compatibility, accessories, documents, observations] = await Promise.all([
        env.DB.prepare("SELECT id,part_number,identity_status,superseded_by_product_id FROM library_products WHERE id=?").bind(requestedId).first(),
        env.DB.prepare("SELECT e.*, s.file_name, s.source_type, s.validity_state, s.downstream_use source_downstream_use, s.review_status source_review_status FROM product_source_evidence e JOIN product_sources s ON s.id=e.source_id WHERE e.product_id=? ORDER BY e.created_at").bind(product.id).all(),
        env.DB.prepare("SELECT r.*,s.file_name,s.source_type,s.valid_until source_valid_until,s.validity_state source_validity_state,s.downstream_use source_downstream_use FROM price_records r JOIN product_sources s ON s.id=r.source_id WHERE r.product_id=? ORDER BY r.created_at DESC").bind(product.id).all(),
        env.DB.prepare("SELECT * FROM product_attributes WHERE product_id=? AND deleted_at IS NULL ORDER BY created_at DESC").bind(product.id).all(),
        env.DB.prepare("SELECT * FROM product_certifications WHERE product_id=? AND deleted_at IS NULL ORDER BY created_at DESC").bind(product.id).all(),
        env.DB.prepare("SELECT * FROM product_compatibility WHERE source_product_id=? AND deleted_at IS NULL ORDER BY created_at DESC").bind(product.id).all(),
        env.DB.prepare("SELECT * FROM product_accessories WHERE product_id=? AND deleted_at IS NULL ORDER BY created_at DESC").bind(product.id).all(),
        env.DB.prepare("SELECT * FROM product_documents WHERE product_id=? AND deleted_at IS NULL ORDER BY created_at DESC").bind(product.id).all(),
        env.DB.prepare("SELECT original_order_code,original_product_id,source_id,source_row,review_status,status FROM manufacturer_order_code_observations WHERE canonical_product_id=? AND status='Active' ORDER BY source_row").bind(product.id).all(),
      ]);
      const mappedPrices = (prices.results || []).map((row) => ({ ...row, amount: row.amount_minor / 100, eligibleForCosting: row.approval_status === "Approved" && row.downstream_use === "Costing" && Boolean(row.valid_until) && row.valid_until >= today() }));
      return json({ product: mapProduct(product), requested, canonicalResolution: { requestedProductId: requestedId, canonicalProductId: product.id, requestedPartNumber: requested?.part_number || product.part_number, canonicalPartNumber: product.part_number, resolved: requestedId !== product.id }, evidence: evidence.results || [], prices: mappedPrices, attributes: attributes.results || [], certifications: certifications.results || [], compatibility: compatibility.results || [], accessories: accessories.results || [], documents: documents.results || [], orderCodeObservations: observations.results || [], safety: { costingEligiblePrices: mappedPrices.filter((row) => row.eligibleForCosting).length, missingEvidenceIsNotInferred: true } });
    }
    if (operation === "history" && request.method === "GET") { const events = await env.DB.prepare("SELECT * FROM product_lifecycle_events WHERE product_id=? OR obsolete_part_number=? ORDER BY created_at DESC").bind(product.id, product.part_number).all(); return json({ lifecycle: (events.results || []).map((row) => ({ ...row, replacement_candidates: parse(row.replacement_candidates, []), source_location: parse(row.source_location, {}) })) }); }
    if (operation === "prices" && request.method === "GET") { const projectId = url.searchParams.get("projectId"); if (!(await ownedProject(env.DB, projectId, user.id))) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404); const rows = await env.DB.prepare("SELECT r.*, s.file_name, s.source_type, s.review_status source_review_status, s.scope_type source_scope_type, sp.name supplier_name FROM price_records r JOIN product_sources s ON s.id=r.source_id LEFT JOIN suppliers sp ON sp.id=r.supplier_id WHERE r.product_id=? AND (r.project_id IS NULL OR r.project_id=?) ORDER BY r.valid_until DESC, r.created_at DESC").bind(product.id, projectId || "").all(); const prices = (rows.results || []).map((row) => ({ ...row, amount: row.amount_minor / 100, eligibleForCosting: row.approval_status === "Approved" && row.downstream_use === "Costing" && Boolean(row.valid_until) && row.valid_until >= today() && (!row.project_id || row.project_id === projectId), terms: parse(row.terms, {}), source_location: parse(row.source_location, {}) })); return json({ prices, rule: "Only approved, unexpired, explicitly costing-enabled evidence in the current project scope is eligible." }); }
    if (operation === "approve-discovery" && request.method === "POST") { if (!canGovernGlobal(user.role)) return json({ error: { code: "LIBRARY_ROLE_REQUIRED", message: "A Library Manager or Administrator must review global products." } }, 403); const body = await request.json(); const reason = String(body.reason || "").trim(); if (reason.length < 10) return json({ error: { code: "REVIEW_REASON_REQUIRED", message: "Provide a substantive review reason." } }, 422); await env.DB.prepare("UPDATE library_products SET review_status='Reviewed', approved_for_discovery=1, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(product.id).run(); await decision(env.DB, user, "Product", product.id, "Approved for Discovery", { approved: false }, { approved: true }, reason); return json({ approvedForDiscovery: true, costingEligible: false }); }
  }
  const productEvidenceMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/(versions|variants|aliases|regional-part-numbers|attributes|certifications|compatibility|accessories|documents|conflicts)$/);
  if (productEvidenceMatch && request.method === "GET") {
    const productId = decodeURIComponent(productEvidenceMatch[1]); if (!(await visibleProduct(env.DB, productId))) return json({ error: { code: "PRODUCT_NOT_FOUND", message: "Product not found." } }, 404);
    const definitions = {
      versions: ["product_versions", "product_id"], variants: ["product_variants", "base_product_id"], aliases: ["product_aliases", "product_id"], "regional-part-numbers": ["regional_part_numbers", "product_id"], attributes: ["product_attributes", "product_id"], certifications: ["product_certifications", "product_id"], compatibility: ["product_compatibility", "source_product_id"], accessories: ["product_accessories", "product_id"], documents: ["product_documents", "product_id"], conflicts: ["product_conflicts", "product_id"],
    };
    const [table, field] = definitions[productEvidenceMatch[2]]; const rows = await env.DB.prepare(`SELECT * FROM ${table} WHERE ${field}=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`).bind(productId).all();
    return json({ productId, resource: productEvidenceMatch[2], records: rows.results || [] });
  }
  const sourceVersionsMatch = url.pathname.match(/^\/api\/price-sources\/([^/]+)\/versions$/);
  if (sourceVersionsMatch && request.method === "GET") { const rows = await env.DB.prepare("SELECT * FROM price_source_versions WHERE source_id=? ORDER BY version_number DESC").bind(decodeURIComponent(sourceVersionsMatch[1])).all(); return json({ versions: rows.results || [] }); }
  const sourceMatch = url.pathname.match(/^\/api\/price-sources\/([^/]+)\/(review|prices)$/);
  if (sourceMatch) { const source = await env.DB.prepare("SELECT * FROM product_sources WHERE id=?").bind(decodeURIComponent(sourceMatch[1])).first(); if (!source) return json({ error: { code: "PRICE_SOURCE_NOT_FOUND", message: "Price source not found." } }, 404); if (!(await ownedProject(env.DB, source.project_id, user.id))) return json({ error: { code: "PRICE_SOURCE_NOT_FOUND", message: "Price source not found." } }, 404);
    if (sourceMatch[2] === "prices" && request.method === "GET") { const rows = await env.DB.prepare("SELECT r.*, p.id canonical_product_id,p.part_number, p.description FROM price_records r JOIN canonical_library_products p ON p.requested_product_id=r.product_id WHERE r.source_id=? ORDER BY p.part_number").bind(source.id).all(); return json({ prices: rows.results || [] }); }
    if (sourceMatch[2] === "review" && request.method === "POST") { if (source.scope_type === "Global" && !canGovernGlobal(user.role)) return json({ error: { code: "LIBRARY_ROLE_REQUIRED", message: "A Library Manager or Administrator must review global sources." } }, 403); const body = await request.json(); const reason = String(body.reason || "").trim(); if (reason.length < 10) return json({ error: { code: "REVIEW_REASON_REQUIRED", message: "Provide a substantive review reason." } }, 422); const requestedUse = body.downstreamUse === "Costing" ? "Costing" : "Discovery Only"; const validityCurrent = Boolean(source.valid_until) && source.valid_until >= today(); if (requestedUse === "Costing" && !validityCurrent) return json({ error: { code: "PRICE_VALIDITY_REQUIRED", message: "Costing approval requires a current explicit validity end date." } }, 409); await env.DB.batch([env.DB.prepare("UPDATE product_sources SET review_status='Reviewed', downstream_use=? WHERE id=?").bind(requestedUse, source.id), env.DB.prepare("UPDATE price_records SET approval_status='Approved', downstream_use=?, reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP WHERE source_id=?").bind(requestedUse, user.id, source.id)]); await decision(env.DB, user, "Price Source", source.id, "Reviewed", { status: source.review_status, downstreamUse: source.downstream_use }, { status: "Reviewed", downstreamUse: requestedUse }, reason, source.project_id); return json({ reviewed: true, downstreamUse: requestedUse, costingEligible: requestedUse === "Costing" }); }
  }
  return json({ error: { code: "PRODUCT_LIBRARY_API_NOT_FOUND", message: "Product library operation not found." } }, 404);
};
import { FIRE_ALARM_ATTRIBUTE_PROFILES, FIRE_ALARM_LIBRARY_VERSION, FIRE_ALARM_TAXONOMY, GENERAL_XLSX_PRICE_LIST_VERSION, hasHoneywellFarenhytWorkbookStructure, ingestGeneralXlsxPriceList, ingestHoneywellFarenhytWorkbook, PRODUCT_LIBRARY_VERSION } from "../app/domain/product-price-library.mjs";
import { extractIfp75Datasheet, IFP75_DATASHEET_PARSER_VERSION, IFP75_DATASHEET_SOURCE_VERSION } from "../app/domain/ifp75-datasheet.mjs";
