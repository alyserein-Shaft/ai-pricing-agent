// Column-reference arithmetic, split out so both the XLSX reader and the
// merged-cell policy share ONE implementation.
//
// This is deliberately the smallest possible shared unit: a column LETTER
// sequence ("A", "B", ..., "AA") to its 1-based number and back. It exists
// because a merge target's column identity must come from the cell REFERENCE and
// never from an array position -- a sparse row such as [A, C, D] would otherwise
// shift every subsequent logical column one place to the left.

/** "A" -> 1, "B" -> 2, ..., "AA" -> 27. Unparseable input yields 0. */
export function columnNumber(letters) {
  if (typeof letters !== "string" || letters.trim() === "") return 0;
  return [...letters.trim().toUpperCase()].reduce(
    (value, letter) => value * 26 + letter.charCodeAt(0) - 64,
    0,
  );
}

/** 1 -> "A", 27 -> "AA". */
export function columnLetters(index) {
  let letters = "";
  let value = Number(index);
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}
