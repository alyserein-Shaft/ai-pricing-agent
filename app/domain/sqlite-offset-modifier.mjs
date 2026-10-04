// The single place a UTC offset becomes a SQLite date modifier.
//
// `julianday(value, modifier)` is the only offset-aware tool SQLite offers: it
// takes a fixed `+HH:MM`-style duration, not an IANA zone. That is precisely the
// gap this module is honest about -- the zone is the identity and lives in
// `effective-time-policy.mjs`; this file only renders the evaluation offset it
// derives.
//
// A bare project-calendar day `D` denotes the start of `D` in the project's
// declared zone, which is `D 00:00 +offset`. Expressed as a UTC instant that is
// `D 00:00 - offset`, so the modifier CARRIES THE OPPOSITE SIGN of the offset.
// Getting that sign wrong is not a rounding error: for Asia/Riyadh it moves every
// bare effective date three hours earlier than the project declared, so this
// inversion is stated once, here, and asserted from both directions in the tests
// rather than re-derived by each consumer.

const MAX_OFFSET_MINUTES = 14 * 60;

// Validate and render. Rejecting non-integers is a security property, not
// tidiness: the result is interpolated into SQL text, so a value that was not
// provably an integer must never reach the string.
export const toSqliteOffsetModifier = (offsetMinutes) => {
  if (!Number.isInteger(offsetMinutes)) {
    throw new TypeError(`SQLite offset modifier requires an integer minute offset, received ${String(offsetMinutes)}.`);
  }
  if (Math.abs(offsetMinutes) > MAX_OFFSET_MINUTES) {
    throw new RangeError(`SQLite offset modifier ${offsetMinutes} is outside the real-world IANA range of +/-${MAX_OFFSET_MINUTES} minutes.`);
  }
  if (offsetMinutes === 0) return "0 minutes";
  return `${offsetMinutes > 0 ? "-" : "+"}${Math.abs(offsetMinutes)} minutes`;
};
