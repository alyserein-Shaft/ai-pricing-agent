// TARGETED TITLE-BLOCK VISION READ -- drawing-number field only.
//
// Native text cannot supply this project's own drawing numbers (measured: 0/13
// under the strict title-block rules in
// app/domain/drawing-title-block-metadata.mjs), so the sanctioned fallback
// applies: a local title-block crop plus the existing Muse perception provider,
// asked for transcription only.
//
// Muse NEVER decides the drawing number. It transcribes; the deterministic
// parser in app/domain/drawing-title-block-metadata.mjs accepts a value only from
// an explicit label/value pairing. Nothing is persisted here -- governance is a
// separate, human-actor-gated step.
import { readFileSync } from "node:fs";

import { callMusePerception } from "../worker/drawing-vision-muse-provider.mjs";
import { parseDrawingNumberFromTranscription } from "../app/domain/drawing-title-block-metadata.mjs";

// The crop is rendered by the PDF toolchain (PyMuPDF) and passed in as PNG
// bytes; this step is the sanctioned VISION READ only.
const [pngPath] = process.argv.slice(2);
if (!pngPath) throw new Error("USAGE: node scripts/read-drawing-number-vision.mjs <titleBlockCrop.png>");

const env = {};
for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
  const match = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}

const cropPath = pngPath;
const png = readFileSync(pngPath);

const started = Date.now();
const outcome = await callMusePerception(env, { imageBytes: png });
const durationMs = Date.now() - started;

const transcription = outcome?.content ?? outcome?.text ?? null;
const parsed = parseDrawingNumberFromTranscription(transcription);

console.log(JSON.stringify({
  cropPath,
  durationMs,
  outcomeCode: outcome?.code ?? null,
  transcription: transcription ? transcription.slice(0, 1200) : null,
  parsedDrawingNumber: parsed.ok ? parsed.drawingNumber : null,
  parsedReason: parsed.ok ? null : parsed.reason,
  parsedValues: parsed.values ?? null,
}, null, 1));
