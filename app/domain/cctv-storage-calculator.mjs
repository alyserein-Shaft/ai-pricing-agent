// CCTV System Pack v1 -- CCTV Recording Storage Sizing.
//
// A pure, deterministic domain function, mirroring
// fire-alarm-slc-capacity-calculator.mjs's exact discipline: it performs
// ONLY arithmetic on explicit, already-verified inputs -- it never reads the
// DB, never bakes in a literal bitrate/camera-count/retention assumption for
// any specific project, and never uses LLM/semantic reasoning. If a required
// input is missing, it returns INSUFFICIENT_EVIDENCE and lists exactly which
// inputs are missing -- it never guesses a default retention period,
// bitrate, or activity factor.
//
// Standard CCTV storage formula (industry-standard, not project-specific):
//   requiredBits = cameraCount * bitrateBitsPerSecond * recordingHoursPerDay
//                  * 3600 * retentionDays
//   requiredBytes = requiredBits / 8
//   usableBytes = requiredBytes / raidOverheadFactor (if RAID is used, the
//     caller supplies the overhead factor explicitly -- e.g. 1.25 for
//     RAID5-with-1-parity-drive-in-5, never invented here)
//   recommendedHddCount = ceil(usableBytes / hddCapacityBytes)
//
// Validated against real evidence: Central Kitchen - Makkah's own final
// quotation (Al Mespar Contracting Corp, Q1067-626-LCU) states its own
// storage sizing result directly in one line item's description ("Recording
// on 2MP, 213 camera, 90 days, 149TB/10TB=15HDD, H.265+, 1080P, 25FPS, 18
// Hrs") -- see tests/cctv-storage-calculator.test.mjs for the reproduction
// of this real historical result from these same first-principles inputs
// (no RAID overhead applied, matching the historical note's own math exactly
// -- 149 / 10 = 14.9, ceil = 15).
export const CCTV_STORAGE_STATUSES = Object.freeze(["CALCULATED", "INSUFFICIENT_EVIDENCE"]);

const isPositive = (value) => Number.isFinite(value) && value > 0;

export const calculateCctvStorage = ({ cameraCount, bitrateBitsPerSecond, recordingHoursPerDay, retentionDays, hddCapacityBytes, raidOverheadFactor = 1 } = {}) => {
  const missingInputs = [];
  if (!isPositive(cameraCount)) missingInputs.push("cameraCount");
  if (!isPositive(bitrateBitsPerSecond)) missingInputs.push("bitrateBitsPerSecond");
  if (!isPositive(recordingHoursPerDay)) missingInputs.push("recordingHoursPerDay");
  if (!isPositive(retentionDays)) missingInputs.push("retentionDays");
  if (!isPositive(hddCapacityBytes)) missingInputs.push("hddCapacityBytes");
  if (!isPositive(raidOverheadFactor)) missingInputs.push("raidOverheadFactor");

  if (missingInputs.length) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      requiredRawBytes: null, requiredUsableBytes: null, recommendedHddCount: null,
      calculationTrace: ["A CCTV storage calculation requires camera count, per-camera bitrate, recording hours/day, retention days, HDD capacity, and RAID overhead factor -- none of these are ever assumed by default."],
      missingInputs,
    };
  }

  const requiredBits = cameraCount * bitrateBitsPerSecond * recordingHoursPerDay * 3600 * retentionDays;
  const requiredRawBytes = requiredBits / 8;
  const requiredUsableBytes = requiredRawBytes * raidOverheadFactor;
  const recommendedHddCount = Math.ceil(requiredUsableBytes / hddCapacityBytes);

  return {
    status: "CALCULATED",
    requiredRawBytes,
    requiredUsableBytes,
    recommendedHddCount,
    calculationTrace: [
      `${cameraCount} camera(s) x ${bitrateBitsPerSecond} bit/s x ${recordingHoursPerDay} hr/day x 3600 x ${retentionDays} day(s) = ${requiredBits} bits raw demand.`,
      raidOverheadFactor !== 1 ? `RAID overhead factor ${raidOverheadFactor} applied (caller-supplied, never invented).` : "No RAID overhead applied (factor 1).",
      `${requiredUsableBytes} bytes usable demand / ${hddCapacityBytes} bytes per HDD, rounded up = ${recommendedHddCount} HDD(s).`,
    ],
    missingInputs: [],
  };
};
