import test from "node:test";
import assert from "node:assert/strict";
import { qualifyBoqRow } from "../app/domain/boq-row-qualification.mjs";

const row = (overrides = {}) => ({ row_type: "BOQ Item", item_number: "08-1-1", description: "Double swing door", original_unit: "Sets", original_quantity: "3", source_location: JSON.stringify({ sheet: "Div- 8", row: 18 }), ...overrides });

test("measurable product rows remain BOQ Items", () => assert.equal(qualifyBoqRow(row()).rowType, "BOQ Item"));
test("headers and totals cannot enter pricing", () => { assert.equal(qualifyBoqRow(row({ row_type: "Section Header" })).rowType, "Header"); assert.equal(qualifyBoqRow(row({ row_type: "Subtotal" })).rowType, "Excluded"); });
test("Division 1 tender language becomes preamble or general condition", () => { assert.equal(qualifyBoqRow(row({ item_number: "01-1-1", description: "Tender Documents and Scope of Works", source_location: JSON.stringify({ sheet: "Div-1", row: 13 }) })).rowType, "Preamble"); assert.equal(qualifyBoqRow(row({ item_number: "01-4-1", description: "Obtain authority approvals", source_location: JSON.stringify({ sheet: "Div-1", row: 224 }) })).rowType, "General Condition"); });
test("unknown rows fail closed without automatic confirmation", () => { const result = qualifyBoqRow(row({ row_type: "Unknown", description: "", original_unit: "", original_quantity: "" })); assert.equal(result.rowType, "Excluded"); assert.equal(result.certain, false); });
