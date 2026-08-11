import test from "node:test";
import assert from "node:assert/strict";
import { classifyAlMesparScope } from "../app/domain/al-mespar-scope-classifier.mjs";

test("classifies Hotel CSI divisions without treating the project as Fire Alarm", () => {
  assert.deepEqual(classifyAlMesparScope({ item_number: "03-2-1" }), {
    division: "03", discipline: "Structural", category: "Concrete", inAlMesparScope: false,
    reason: "Structural work is outside the defined Al Mespar estimating systems.",
  });
});

test("powered facade cradle remains specialist equipment, not Low Current", () => {
  const result = classifyAlMesparScope({ item_number: "11-1-6", description: "Powered cradle with main power cable" });
  assert.equal(result.discipline, "Specialist Equipment");
  assert.equal(result.inAlMesparScope, false);
});

test("unknown divisions fail closed", () => {
  const result = classifyAlMesparScope({ item_number: "99-1-1" });
  assert.equal(result.discipline, "Unclassified");
  assert.equal(result.inAlMesparScope, false);
});

