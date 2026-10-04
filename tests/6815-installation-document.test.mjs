import assert from "node:assert/strict";
import test from "node:test";

import {
  extractHoneywell6815InstallationDocument,
  HONEYWELL_6815_INSTALLATION_SHA256,
} from "../app/domain/6815-installation-document.mjs";

const extract = () =>
  extractHoneywell6815InstallationDocument({
    checksum: HONEYWELL_6815_INSTALLATION_SHA256,
  });

test("6815 official installation document is checksum locked", () => {
  assert.throws(
    () => extractHoneywell6815InstallationDocument({ checksum: "wrong" }),
    { code: "HONEYWELL_6815_INSTALLATION_CHECKSUM_MISMATCH" }
  );
});

test("6815 is explicitly extracted as an SLC Expander and proposed Loop Card", () => {
  const result = extract();
  assert.deepEqual(result.products.map((p) => p.code), ["6815"]);
  assert.equal(result.products[0].proposedFamily, "Loop Card");

  const type = result.products[0].attributes.find(
    (a) => a.attributeName === "product_type"
  );
  assert.equal(type.normalizedValue, "SLC Expander");
});

test("6815 direct electrical and environmental facts retain manufacturer evidence", () => {
  const attributes = extract().products[0].attributes;
  const byName = (name) => attributes.find((a) => a.attributeName === name);

  assert.equal(byName("standby_current").normalizedValue, "78");
  assert.equal(byName("alarm_current").normalizedValue, "78");
  assert.equal(byName("operating_voltage").normalizedValue, "24");
  assert.equal(byName("operating_temperature").normalizedValue, "0–49");

  assert.ok(
    attributes.every(
      (a) =>
        a.reviewStatus === "Needs Review" &&
        a.exactText &&
        Number.isInteger(a.page)
    )
  );
});

test("6815 compatibility remains at the scope explicitly stated by the document", () => {
  const compatibility = extract().products[0].attributes.find(
    (a) => a.attributeName === "compatible_panel_family"
  );

  assert.match(compatibility.normalizedValue, /Silent Knight/);
  assert.match(compatibility.normalizedValue, /Farenhyt/);
});

test("6815 parser never invents capacity or a one-loop expansion count", () => {
  const attributes = extract().products[0].attributes;

  for (const forbidden of [
    "added_slc_loops",
    "max_detectors_per_loop",
    "max_modules_per_loop",
    "max_system_points",
    "detector_capacity",
    "module_capacity",
  ]) {
    assert.equal(
      attributes.some((a) => a.attributeName === forbidden),
      false,
      `${forbidden} must not be created from this source`
    );
  }
});
