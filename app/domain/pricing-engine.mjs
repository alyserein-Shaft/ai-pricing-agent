export const PRICING_ENGINE_VERSION = "pricing-engine-1.0.0";
export const PRICING_RULESET_VERSION = "pricing-rules-2026-08-02";

const round = (value, precision = 2) => { const factor = 10 ** precision; return Math.round((Number(value) + Number.EPSILON) * factor) / factor; };
const number = (value, code) => { const parsed = Number(value); if (!Number.isFinite(parsed)) throw Object.assign(new Error(code), { code }); return parsed; };
const present = (value) => value !== null && value !== undefined && String(value).trim() !== "";
const validDate = (value, at) => present(value) && new Date(value) >= new Date(at);

export const priceValidity = (source, at = new Date().toISOString()) => {
  if (source.status === "Rejected" || source.supersededAt) return "Rejected";
  if (!source.validUntil) return "No Validity Provided";
  if (source.effectiveFrom && new Date(source.effectiveFrom) > new Date(at)) return "Future";
  if (new Date(source.validUntil) < new Date(at)) return "Expired";
  const days = (new Date(source.validUntil) - new Date(at)) / 86400000;
  return days <= 14 ? "Expiring Soon" : "Valid";
};

export const selectPriceSources = ({ sources, projectId, productId, quantity, region, at, precedence = ["Project Supplier Quote", "Supplier Quote", "Manufacturer Price List", "Framework Price", "Organization Price", "Historical Approved Price", "Manual Verified Price", "Manual Unverified Price"] }) => {
  const ranked = sources.filter((source) => source.productId === productId).map((source) => {
    const validity = priceValidity(source, at), projectMatch = !source.projectId || source.projectId === projectId, quantityMatch = !source.minimumQuantity || Number(quantity) >= Number(source.minimumQuantity), regionMatch = !source.region || source.region === region, approved = source.approvalStatus === "Approved", rank = precedence.indexOf(source.priceType);
    const eligible = projectMatch && quantityMatch && regionMatch && approved && ["Valid", "Expiring Soon"].includes(validity) && source.downstreamUse !== "Discovery Only";
    return { ...source, validity, eligible, rank: rank < 0 ? precedence.length : rank, status: eligible ? "Valid Alternative" : validity === "Expired" ? "Expired" : !approved ? "Unverified" : "Rejected", explanation: !projectMatch ? "Price is scoped to another project." : !quantityMatch ? "Minimum quantity is not met." : !regionMatch ? "Regional scope does not match." : !approved ? "Price source is not approved." : validity === "Expired" ? "Price source has expired." : source.downstreamUse === "Discovery Only" ? "Source is restricted to discovery." : "Source is current, approved and in scope." };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.rank - b.rank || Number(b.reliability || 0) - Number(a.reliability || 0));
  if (ranked[0]?.eligible) ranked[0] = { ...ranked[0], status: "Recommended", explanation: `Recommended by configured precedence: ${ranked[0].priceType}; validity, scope, approval and quantity checks passed. A user must still select it explicitly.` };
  return ranked;
};

export const applyDiscounts = ({ amount, discounts = [], context }) => {
  let running = number(amount, "INVALID_LIST_PRICE"); if (running < 0) throw Object.assign(new Error("Negative price is not allowed."), { code: "NEGATIVE_PRICE" }); const chain = [];
  const ordered = [...discounts].sort((a, b) => Number(a.order) - Number(b.order));
  for (const discount of ordered) {
    if (discount.scope === "Material" && context.componentType !== "Material") continue;
    if (discount.projectId && discount.projectId !== context.projectId) continue;
    if (discount.manufacturer && discount.manufacturer !== context.manufacturer) continue;
    if (discount.sourceId && discount.sourceId !== context.sourceId) continue;
    if (!validDate(discount.validUntil, context.at)) continue;
    const rate = number(discount.percentage, "INVALID_DISCOUNT"); if (rate < 0 || rate > 100) throw Object.assign(new Error("Discount must be between 0 and 100%."), { code: "INVALID_DISCOUNT" });
    const base = discount.mode === "Additive" ? amount : running, discountAmount = round(base * rate / 100, context.precision); running = round(running - discountAmount, context.precision); chain.push({ ...discount, calculationBase: round(base, context.precision), amount: discountAmount, balance: running });
  }
  if (running < 0) throw Object.assign(new Error("Discounts produce a negative cost."), { code: "NEGATIVE_NET_COST" }); return { net: running, chain };
};

export const convertCurrency = ({ amount, sourceCurrency, projectCurrency, exchangeRate, precision = 2 }) => {
  if (sourceCurrency === projectCurrency) return { originalAmount: amount, sourceCurrency, projectCurrency, rate: 1, convertedAmount: round(amount, precision), direction: "Identity" };
  if (!exchangeRate || exchangeRate.from !== sourceCurrency || exchangeRate.to !== projectCurrency || !validDate(exchangeRate.validUntil, new Date().toISOString()) || exchangeRate.approvalStatus !== "Approved") throw Object.assign(new Error("An approved current exchange rate is required."), { code: "EXCHANGE_RATE_REQUIRED" });
  return { originalAmount: amount, sourceCurrency, projectCurrency, rate: exchangeRate.rate, convertedAmount: round(amount * exchangeRate.rate, precision), direction: `${sourceCurrency}/${projectCurrency}`, source: exchangeRate.source, version: exchangeRate.version };
};

export const quantityMultiplier = ({ quantity, unit, lumpSumMode }) => {
  if (!present(quantity)) throw Object.assign(new Error("Quantity is required."), { code: "QUANTITY_REQUIRED" }); const parsed = number(quantity, "INVALID_QUANTITY"); if (parsed < 0) throw Object.assign(new Error("Quantity cannot be negative."), { code: "INVALID_QUANTITY" });
  if (/^(ls|lump sum|lot)$/i.test(String(unit))) { if (lumpSumMode !== "SinglePackage") throw Object.assign(new Error("Lump-sum treatment must be configured."), { code: "LUMP_SUM_RULE_REQUIRED" }); return 1; }
  return parsed;
};

export const calculateCostComponent = ({ component, bases, precision = 2 }) => {
  const rate = number(component.rate ?? component.amount ?? 0, "INVALID_COMPONENT_RATE"); let amount;
  if (component.method === "Fixed") amount = rate;
  else if (component.method === "Per Item") amount = rate * number(bases.quantity, "INVALID_QUANTITY");
  else if (component.method === "Percentage of Material") amount = number(bases.material, "INVALID_MATERIAL_BASE") * rate / 100;
  else if (component.method === "Percentage of Direct Cost") amount = number(bases.directCost, "INVALID_DIRECT_COST_BASE") * rate / 100;
  else if (component.method === "Hours") amount = rate * number(component.quantity, "INVALID_HOURS");
  else throw Object.assign(new Error(`Unsupported component method: ${component.method}`), { code: "UNSUPPORTED_COMPONENT_METHOD" });
  return { ...component, calculatedAmount: round(amount, precision), formula: component.method === "Fixed" ? "fixed amount" : `${component.method}: ${rate}` };
};

export const sellingPrice = ({ totalCost, method, rate, fixedPrice, minimumMargin = 0, authorizedException = false, precision = 2 }) => {
  const cost = number(totalCost, "INVALID_TOTAL_COST"); let gross;
  if (method === "Target Margin") { if (rate >= 100) throw Object.assign(new Error("Target margin must be below 100%."), { code: "INVALID_MARGIN" }); gross = cost / (1 - rate / 100); }
  else if (method === "Markup") gross = cost * (1 + rate / 100);
  else if (method === "Fixed") gross = number(fixedPrice, "INVALID_FIXED_PRICE");
  else throw Object.assign(new Error("Selling-price method is required."), { code: "SELLING_METHOD_REQUIRED" });
  gross = round(gross, precision); const profit = round(gross - cost, precision), margin = gross ? round(profit / gross * 100, 4) : 0, markup = cost ? round(profit / cost * 100, 4) : 0; const state = margin < 0 ? "Negative Margin" : margin < minimumMargin ? "Below Minimum" : margin < Number(rate || 0) ? "Below Target" : "Above Target";
  if ((margin < minimumMargin || margin < 0) && !authorizedException) throw Object.assign(new Error("Selling price breaches the approved minimum margin."), { code: "MINIMUM_MARGIN_BREACH", margin, minimumMargin }); return { gross, profit, margin, markup, state };
};

export const calculatePricingLine = (input) => {
  const blockers = []; if (!input.technicalApproval || input.technicalApproval.status !== "Approved" || input.technicalApproval.candidateId !== input.candidateId) blockers.push("TECHNICAL_APPROVAL_REQUIRED"); if (!input.safetyDecision || !/^Eligible/.test(input.safetyDecision.priceEligibility || "")) blockers.push("SAFETY_PRICE_ELIGIBILITY_REQUIRED"); if (!present(input.unit)) blockers.push("UNIT_REQUIRED");
  let multiplier; try { multiplier = quantityMultiplier({ quantity: input.quantity, unit: input.unit, lumpSumMode: input.lumpSumMode }); } catch (error) { blockers.push(error.code); }
  const ranked = selectPriceSources({ sources: input.priceSources || [], projectId: input.projectId, productId: input.productId, quantity: input.quantity, region: input.region, at: input.calculatedAt, precedence: input.sourcePrecedence }); const selected = ranked.find((entry) => entry.id === input.selectedPriceSourceId), source = selected?.eligible ? { ...selected, status: "Selected", explanation: `${selected.explanation} Explicitly selected for this calculation.` } : null; if (!input.selectedPriceSourceId) blockers.push("PRICE_SOURCE_SELECTION_REQUIRED"); else if (!source) blockers.push("CURRENT_PRICE_SOURCE_REQUIRED"); if (blockers.length) return { status: "Pricing Blocked", blockers: [...new Set(blockers)], sources: ranked, approvalReady: false };
  const conversion = convertCurrency({ amount: source.amount, sourceCurrency: source.currency, projectCurrency: input.projectCurrency, exchangeRate: input.exchangeRate, precision: input.precision }); const discounted = applyDiscounts({ amount: conversion.convertedAmount, discounts: input.discounts || [], context: { componentType: "Material", projectId: input.projectId, manufacturer: input.manufacturer, sourceId: source.id, at: input.calculatedAt, precision: input.precision || 2 } }); const materialTotal = round(discounted.net * multiplier, input.precision);
  const components = (input.costComponents || []).map((component) => calculateCostComponent({ component, bases: { quantity: multiplier, material: materialTotal, directCost: materialTotal }, precision: input.precision })); const directCost = round(materialTotal + components.filter((entry) => !["Overhead", "Risk", "Contingency"].includes(entry.type)).reduce((sum, entry) => sum + entry.calculatedAmount, 0), input.precision); const indirect = components.filter((entry) => ["Overhead", "Risk", "Contingency"].includes(entry.type)).reduce((sum, entry) => sum + entry.calculatedAmount, 0); const totalCost = round(directCost + indirect, input.precision);
  const sale = sellingPrice({ totalCost, ...input.sellingRule, precision: input.precision }); const customerDiscount = round(sale.gross * Number(input.customerDiscount?.percentage || 0) / 100, input.precision), netSelling = round(sale.gross - customerDiscount, input.precision); const resultingMargin = netSelling ? round((netSelling - totalCost) / netSelling * 100, 4) : -100; if (resultingMargin < Number(input.sellingRule.minimumMargin || 0) && !input.customerDiscount?.authorizedException) return { status: "Pricing Blocked", blockers: ["CUSTOMER_DISCOUNT_MINIMUM_BREACH"], approvalReady: false, totalCost, grossSelling: sale.gross };
  const vatRate = Number(input.vatRule?.applicable === false ? 0 : input.vatRule?.rate || 0); if (vatRate < 0 || vatRate > 100) throw Object.assign(new Error("VAT rate is invalid."), { code: "INVALID_VAT" }); const vat = round(netSelling * vatRate / 100, input.precision), finalValue = round(netSelling + vat, input.precision);
  return { engineVersion: PRICING_ENGINE_VERSION, rulesetVersion: PRICING_RULESET_VERSION, status: source.validity === "Expiring Soon" ? "Needs Review" : "Draft Price", approvalReady: true, selectedSource: source, sourceAlternatives: ranked.filter((entry) => entry.id !== source.id), originalListPrice: source.amount, conversion, discounts: discounted.chain, netMaterialUnitCost: discounted.net, quantity: multiplier, materialTotal, components, directCost, totalCost, grossSelling: sale.gross, customerDiscount, netSelling, vatRate, vat, finalValue, grossProfit: round(netSelling - totalCost, input.precision), margin: resultingMargin, markup: totalCost ? round((netSelling - totalCost) / totalCost * 100, 4) : 0, explanation: `${source.priceType} ${source.reference || source.id} supplied ${source.amount} ${source.currency}. ${discounted.chain.length} controlled discount${discounted.chain.length === 1 ? " was" : "s were"} applied to material only. Total cost is ${totalCost} ${input.projectCurrency}; net selling is ${netSelling}, VAT is ${vat}, and final value is ${finalValue}.` };
};

export const allocateSharedCost = ({ amount, items, method }) => {
  if (!items.length) throw Object.assign(new Error("Allocation requires items."), { code: "ALLOCATION_ITEMS_REQUIRED" }); const weights = items.map((item) => method === "Even" ? 1 : method === "By Quantity" ? Number(item.quantity) : method === "By Material Value" ? Number(item.materialTotal) : method === "Manual" ? Number(item.weight) : NaN); if (weights.some((entry) => !Number.isFinite(entry) || entry < 0) || weights.reduce((a, b) => a + b, 0) <= 0) throw Object.assign(new Error("Allocation weights are invalid."), { code: "INVALID_ALLOCATION" }); const totalWeight = weights.reduce((a, b) => a + b, 0); let allocated = 0; return items.map((item, index) => { const value = index === items.length - 1 ? round(amount - allocated, 2) : round(amount * weights[index] / totalWeight, 2); allocated += value; return { itemId: item.id, amount: value, method, weight: weights[index] }; });
};

export const aggregateProjectPricing = (lines) => { const approved = lines.filter((line) => line.approvalReady); const sum = (field) => round(approved.reduce((total, line) => total + Number(line[field] || 0), 0), 2); const totalCost = sum("totalCost"), netSelling = sum("netSelling"); return { itemCount: lines.length, pricedItemCount: approved.length, material: sum("materialTotal"), totalCost, grossSelling: sum("grossSelling"), customerDiscount: sum("customerDiscount"), netSelling, vat: sum("vat"), finalValue: sum("finalValue"), grossProfit: round(netSelling - totalCost, 2), grossMargin: netSelling ? round((netSelling - totalCost) / netSelling * 100, 4) : 0 }; };

export const validateManualPriceInput = ({ input, user, technicalApproval }) => { const missing = ["projectId", "boqItemId", "candidateId", "productId", "price", "currency", "source", "validUntil", "reason", "scope"].filter((field) => !present(input?.[field])); const permittedRole = ["Procurement", "Commercial Manager", "Admin"].includes(user?.role); const technical = technicalApproval?.status === "Approved" && technicalApproval?.candidateId === input?.candidateId; return { permitted: !missing.length && Number(input?.price) > 0 && validDate(input?.validUntil, new Date().toISOString()) && permittedRole && technical, missing, permittedRole, technicalApproved: technical, classification: present(input?.source) ? "Manual Verified Price" : "Manual Unverified Price", auditRequired: true }; };
