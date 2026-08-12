import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { extractBoqBytes } from "../app/domain/boq-extractor.mjs";

const ipsWorkbook = () => zipSync({
  "xl/workbook.xml": strToU8(
    '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="IPS BOQ" sheetId="1" r:id="rId1"/></sheets></workbook>',
  ),
  "xl/_rels/workbook.xml.rels": strToU8(
    '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  ),
  "xl/sharedStrings.xml": strToU8(
    '<?xml version="1.0"?><sst>' +
      '<si><t>Item No.</t></si>' +
      '<si><t>Description</t></si>' +
      '<si><t>Unit</t></si>' +
      '<si><t>Quantity</t></si>' +
      '<si><t>9</t></si>' +
      '<si><t>DIVISION 27 TOTAL AMOUNT</t></si>' +
      '<si><t>27.05.1</t></si>' +
      '<si><t>Supply, Installation, Testing and Commissioning of Single Isolated Power system</t></si>' +
    '</sst>',
  ),
  "xl/worksheets/sheet1.xml": strToU8(
    '<worksheet><sheetData>' +
      '<row r="1">' +
        '<c r="A1" t="s"><v>0</v></c>' +
        '<c r="B1" t="s"><v>1</v></c>' +
        '<c r="C1" t="s"><v>2</v></c>' +
        '<c r="D1" t="s"><v>3</v></c>' +
      '</row>' +
      '<row r="2">' +
        '<c r="A2" t="s"><v>4</v></c>' +
        '<c r="B2" t="s"><v>5</v></c>' +
        '<c r="C2"><v>405348.3333333333</v></c>' +
      '</row>' +
      '<row r="3">' +
        '<c r="A3" t="s"><v>7</v></c>' +
      '</row>' +
    '</sheetData></worksheet>',
  ),
});

test("division total footer remains commercial evidence and never becomes a BOQ item", () => {
  const result = extractBoqBytes(ipsWorkbook(), {
    extension: "xlsx",
    fileName: "BOQ - Nurse Call & IPS.xlsx",
  });

  assert.equal(result.rows[0].description, "DIVISION 27 TOTAL AMOUNT");
  assert.equal(result.rows[0].rowType, "Subtotal");
});

test("descriptive installation scope without unit or quantity is a note, not a hierarchy header", () => {
  const result = extractBoqBytes(ipsWorkbook(), {
    extension: "xlsx",
    fileName: "BOQ - Nurse Call & IPS.xlsx",
  });

  assert.equal(
    result.rows[1].description,
    "Supply, Installation, Testing and Commissioning of Single Isolated Power system",
  );
  assert.equal(result.rows[1].rowType, "Note");
});
