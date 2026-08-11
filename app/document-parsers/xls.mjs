const END = -2;
const i32 = (view, offset) => view.getInt32(offset, true);
const u16 = (view, offset) => view.getUint16(offset, true);
const u32 = (view, offset) => view.getUint32(offset, true);
const ref = (row, column) => { let letters = ""; for (let value = column + 1; value; value = Math.floor((value - 1) / 26)) letters = String.fromCharCode(65 + ((value - 1) % 26)) + letters; return `${letters}${row + 1}`; };

const follow = (start, table, limit) => {
  const result = []; const seen = new Set(); let current = start;
  while (current >= 0 && current !== END) { if (seen.has(current) || current >= limit) throw new Error("XLS sector chain is corrupt"); seen.add(current); result.push(current); current = table[current] ?? END; }
  return result;
};

const openCompound = (input) => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 512 || [0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].some((value, index) => bytes[index] !== value)) throw new Error("XLS file does not have a valid compound-document signature");
  const sectorSize = 2 ** u16(view, 30); const miniSize = 2 ** u16(view, 32); const sectorCount = Math.floor((bytes.length - 512) / sectorSize);
  if (![512, 4096].includes(sectorSize) || miniSize !== 64 || u16(view, 28) !== 0xfffe) throw new Error("XLS compound-file format is unsupported");
  const sector = (id) => { if (id < 0 || id >= sectorCount) throw new Error("XLS sector lies outside the file"); const start = 512 + id * sectorSize; return bytes.subarray(start, start + sectorSize); };
  const difat = []; for (let at = 76; at < 512; at += 4) { const id = i32(view, at); if (id >= 0) difat.push(id); }
  let dif = i32(view, 68); const difSeen = new Set(); for (let count = 0; count < u32(view, 72) && dif >= 0; count += 1) { if (difSeen.has(dif)) throw new Error("XLS DIFAT is cyclic"); difSeen.add(dif); const data = sector(dif); const dv = new DataView(data.buffer, data.byteOffset, data.byteLength); for (let at = 0; at < sectorSize - 4; at += 4) { const id = i32(dv, at); if (id >= 0) difat.push(id); } dif = i32(dv, sectorSize - 4); }
  const fat = []; for (const id of difat.slice(0, u32(view, 44))) { const data = sector(id); const dv = new DataView(data.buffer, data.byteOffset, data.byteLength); for (let at = 0; at < sectorSize; at += 4) fat.push(i32(dv, at)); }
  const regular = (start, size = Infinity) => { const ids = follow(start, fat, sectorCount); const length = Math.min(Number.isFinite(size) ? size : ids.length * sectorSize, ids.length * sectorSize); const output = new Uint8Array(length); let position = 0; for (const id of ids) { const part = sector(id).subarray(0, Math.min(sectorSize, length - position)); output.set(part, position); position += part.length; } return output; };
  const directory = regular(i32(view, 48)); const entries = [];
  for (let at = 0; at + 128 <= directory.length; at += 128) { const dv = new DataView(directory.buffer, directory.byteOffset + at, 128); let name = ""; for (let n = 0; n < Math.max(0, u16(dv, 64) - 2); n += 2) name += String.fromCharCode(u16(dv, n)); const type = dv.getUint8(66); if (type) entries.push({ name, type, start: i32(dv, 116), size: Number(dv.getBigUint64(120, true)) }); }
  const root = entries.find((entry) => entry.type === 5); const miniFatBytes = i32(view, 60) >= 0 ? regular(i32(view, 60), u32(view, 64) * sectorSize) : new Uint8Array(); const miniFat = [];
  if (miniFatBytes.length) { const dv = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength); for (let at = 0; at + 4 <= miniFatBytes.length; at += 4) miniFat.push(i32(dv, at)); }
  const miniStream = root?.start >= 0 ? regular(root.start, root.size) : new Uint8Array();
  const read = (entry) => { if (entry.size >= u32(view, 56) || !miniFat.length) return regular(entry.start, entry.size); const output = new Uint8Array(entry.size); let position = 0; for (const id of follow(entry.start, miniFat, Math.ceil(miniStream.length / miniSize))) { const part = miniStream.subarray(id * miniSize, (id + 1) * miniSize).subarray(0, output.length - position); output.set(part, position); position += part.length; } return output; };
  return { entries, read };
};

const records = (bytes, start = 0) => { const result = []; const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let at = start; while (at + 4 <= bytes.length) { const id = u16(view, at); const length = u16(view, at + 2); if (at + 4 + length > bytes.length) break; result.push({ id, offset: at, data: bytes.subarray(at + 4, at + 4 + length) }); at += 4 + length; if (start && id === 0x000a) break; } return result; };

const sharedStringTable = (list, start) => {
  const segments = [list[start].data]; let end = start; while (list[end + 1]?.id === 0x003c) segments.push(list[++end].data);
  let part = 0; let at = 0; const byte = () => { while (at >= segments[part]?.length) { part += 1; at = 0; } if (!segments[part]) throw new Error("XLS shared-string table is truncated"); return segments[part][at++]; }; const word = () => byte() | byte() << 8; const dword = () => (byte() | byte() << 8 | byte() << 16 | byte() << 24) >>> 0; const skip = (count) => { while (count-- > 0) byte(); };
  dword(); const unique = dword(); const strings = [];
  for (let index = 0; index < unique; index += 1) { const length = word(); const flags = byte(); const rich = flags & 8 ? word() : 0; const extended = flags & 4 ? dword() : 0; let wide = Boolean(flags & 1); let value = ""; for (let character = 0; character < length; character += 1) { if (at >= segments[part].length) { part += 1; at = 0; if (!segments[part]) throw new Error("XLS shared string is truncated"); wide = Boolean(byte() & 1); } value += String.fromCharCode(wide ? word() : byte()); } skip(rich * 4 + extended); strings.push(value); }
  return { strings, end };
};

export const decodeRkNumber = (raw) => { let value; if (raw & 2) value = raw >> 2; else { const buffer = new ArrayBuffer(8); const view = new DataView(buffer); view.setUint32(4, raw & 0xfffffffc, true); value = view.getFloat64(0, true); } return raw & 1 ? value / 100 : value; };
const label = (data, length) => { const wide = Boolean(data[8] & 1); let value = ""; for (let index = 0, at = 9; index < length; index += 1, at += wide ? 2 : 1) value += String.fromCharCode(wide ? data[at] | data[at + 1] << 8 : data[at]); return value; };

export const parseBiffWorkbookStream = (bytes, { fileName = "workbook.xls", sha256 = "" } = {}) => {
  const global = records(bytes); const descriptors = []; let strings = [];
  for (let index = 0; index < global.length; index += 1) { const record = global[index]; const view = new DataView(record.data.buffer, record.data.byteOffset, record.data.byteLength); if (record.id === 0x002f) throw new Error("Password-protected XLS workbooks cannot be read"); if (record.id === 0x00fc) { const parsed = sharedStringTable(global, index); strings = parsed.strings; index = parsed.end; } else if (record.id === 0x0085 && record.data.length >= 8) { const length = record.data[6]; const wide = Boolean(record.data[7] & 1); let name = ""; for (let n = 0; n < length; n += 1) name += String.fromCharCode(wide ? u16(view, 8 + n * 2) : record.data[8 + n]); descriptors.push({ name, offset: u32(view, 0), state: record.data[4] }); } }
  const sheets = descriptors.map((descriptor) => { const rowMap = new Map(); const mergedRanges = []; const add = (row, column, value) => { if (!rowMap.has(row)) rowMap.set(row, []); rowMap.get(row).push({ reference: ref(row, column), column: column + 1, row: row + 1, value, formula: null, styleIndex: 0 }); }; for (const record of records(bytes, descriptor.offset)) { const data = record.data; const view = new DataView(data.buffer, data.byteOffset, data.byteLength); if (record.id === 0x00fd && data.length >= 10) add(u16(view, 0), u16(view, 2), strings[u32(view, 6)] ?? ""); else if (record.id === 0x0203 && data.length >= 14) add(u16(view, 0), u16(view, 2), view.getFloat64(6, true)); else if (record.id === 0x027e && data.length >= 10) add(u16(view, 0), u16(view, 2), decodeRkNumber(u32(view, 6))); else if (record.id === 0x00bd && data.length >= 12) { const row = u16(view, 0); const first = u16(view, 2); const last = u16(view, data.length - 2); for (let column = first, offset = 4; column <= last && offset + 6 <= data.length - 2; column += 1, offset += 6) add(row, column, decodeRkNumber(u32(view, offset + 2))); } else if (record.id === 0x0204 && data.length >= 9) add(u16(view, 0), u16(view, 2), label(data, u16(view, 6))); else if (record.id === 0x0006 && data.length >= 14) { const value = view.getFloat64(6, true); if (Number.isFinite(value)) add(u16(view, 0), u16(view, 2), value); } else if (record.id === 0x0205 && data.length >= 8) add(u16(view, 0), u16(view, 2), data[7] ? `#ERROR:${data[6]}` : Boolean(data[6])); else if (record.id === 0x00e5 && data.length >= 2) for (let index = 0; index < u16(view, 0); index += 1) { const offset = 2 + index * 8; mergedRanges.push(`${ref(u16(view, offset), u16(view, offset + 4))}:${ref(u16(view, offset + 2), u16(view, offset + 6))}`); } }
    const rows = [...rowMap.entries()].sort(([a], [b]) => a - b).map(([row, cells]) => ({ sourceRow: row + 1, cells: cells.sort((a, b) => a.column - b.column) })); return { name: descriptor.name, sourcePath: `Workbook@${descriptor.offset}`, hidden: descriptor.state !== 0, state: descriptor.state === 0 ? "visible" : descriptor.state === 1 ? "hidden" : "veryHidden", rows, mergedRanges, frozenRows: 0, frozenColumns: 0, maxRow: Math.max(0, ...rows.map((row) => row.sourceRow)), maxColumn: Math.max(0, ...rows.flatMap((row) => row.cells.map((cell) => cell.column))) }; });
  if (!sheets.length) throw new Error("XLS workbook contains no BIFF worksheet records");
  return { schemaVersion: 1, fileName, sha256, format: "XLS", sheets, warnings: ["Legacy formulas use cached values; macros are never executed."], provenance: { parser: "native-biff-ole-readonly", parserVersion: "1" } };
};

export const parseXlsWorkbook = (bytes, metadata = {}) => { const file = openCompound(bytes); const workbook = file.entries.find((entry) => entry.type === 2 && ["workbook", "book"].includes(entry.name.toLowerCase())); if (!workbook) throw new Error("XLS compound file has no Workbook stream"); return parseBiffWorkbookStream(file.read(workbook), metadata); };
