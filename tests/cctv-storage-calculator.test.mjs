import test from "node:test";
import assert from "node:assert/strict";
import { calculateCctvStorage } from "../app/domain/cctv-storage-calculator.mjs";

test("missing inputs fail closed and never guess a default", () => {
  const result = calculateCctvStorage({ cameraCount: 213 });
  assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
  assert.deepEqual(result.missingInputs, ["bitrateBitsPerSecond", "recordingHoursPerDay", "retentionDays", "hddCapacityBytes"]);
  assert.equal(result.recommendedHddCount, null);
});

test("no inputs at all fails closed", () => {
  // raidOverheadFactor defaults to 1 (no RAID overhead) -- a reasonable,
  // explicit "none applied" default, not a fabricated engineering
  // assumption about camera count/bitrate/retention, so it alone is never
  // counted as missing.
  const result = calculateCctvStorage();
  assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.missingInputs.length, 5);
});

// Real historical validation: Central Kitchen - Makkah's own final quotation
// (Al Mespar Contracting Corp, Q1067-626-LCU) states its own storage sizing
// result directly in a line item's description: "Recording on 2MP, 213
// camera, 90 days, 149TB/10TB=15HDD, H.265+, 1080P(1920x1080), 25FPS, 18
// Hrs". The per-camera bitrate itself (959651 bit/s) is not independently
// documented in that source -- it is the value that reproduces the
// historical 149TB/15HDD result from first principles, used here to
// validate the FORMULA (multiplication/division/ceiling), not presented as
// an independently-known industry bitrate constant.
test("reproduces Central Kitchen - Makkah's own real, historical 149TB/15HDD storage result", () => {
  const result = calculateCctvStorage({
    cameraCount: 213, bitrateBitsPerSecond: 959651, recordingHoursPerDay: 18, retentionDays: 90,
    hddCapacityBytes: 10e12, raidOverheadFactor: 1,
  });
  assert.equal(result.status, "CALCULATED");
  assert.equal(result.recommendedHddCount, 15);
  assert.ok(Math.abs(result.requiredRawBytes / 1e12 - 149) < 0.1, `expected ~149 TB, got ${result.requiredRawBytes / 1e12}`);
});

test("RAID overhead factor increases usable demand and therefore recommended HDD count", () => {
  const noRaid = calculateCctvStorage({ cameraCount: 10, bitrateBitsPerSecond: 2_000_000, recordingHoursPerDay: 24, retentionDays: 30, hddCapacityBytes: 10e12 });
  const withRaid = calculateCctvStorage({ cameraCount: 10, bitrateBitsPerSecond: 2_000_000, recordingHoursPerDay: 24, retentionDays: 30, hddCapacityBytes: 10e12, raidOverheadFactor: 1.25 });
  assert.equal(noRaid.status, "CALCULATED");
  assert.equal(withRaid.status, "CALCULATED");
  assert.ok(withRaid.requiredUsableBytes > noRaid.requiredUsableBytes);
  assert.ok(withRaid.recommendedHddCount >= noRaid.recommendedHddCount);
});

test("a zero or negative input is treated as missing, never as a valid zero-demand answer", () => {
  const result = calculateCctvStorage({ cameraCount: 0, bitrateBitsPerSecond: 2_000_000, recordingHoursPerDay: 24, retentionDays: 30, hddCapacityBytes: 10e12 });
  assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
  assert.ok(result.missingInputs.includes("cameraCount"));
});
