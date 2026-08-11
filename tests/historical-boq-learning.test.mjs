import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';

const datasetPath = new URL('../outputs/historical-boq-learning/historical_boq_learning.json', import.meta.url);
const workbookPath = new URL('../outputs/historical-boq-learning/Historical_BOQ_Learning_Review.xlsx', import.meta.url);
const migrationPath = new URL('../drizzle/0048_historical_boq_learning.sql', import.meta.url);
const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
const migration = fs.readFileSync(migrationPath, 'utf8');

test('registers exactly the five controlled historical projects', () => {
  assert.equal(dataset.projects.length, 5);
  assert.deepEqual(
    dataset.projects.map((project) => project.pair).sort(),
    ['Complete Learning Pair', 'Partial Learning Pair', 'Partial Learning Pair', 'Partial Learning Pair', 'Partial Pair'],
  );
});

test('keeps learning isolated from live project workflow tables', () => {
  assert.deepEqual(dataset.liveTableCountsAfter, dataset.liveTableCountsBefore);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS historical_boq_projects/);
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*(?:projects|boq_items|product_match_runs|pricing_runs)/i);
});

test('limits automatic row alignment to the one complete learning pair', () => {
  const complete = dataset.projects.find((project) => project.pair === 'Complete Learning Pair');
  assert.ok(dataset.alignments.length > 0);
  assert.ok(dataset.alignments.every((alignment) => alignment.project_id === complete.id));
  assert.ok(dataset.alignments.every((alignment) => alignment.evidence && Number.isFinite(alignment.confidence)));
});

test('prevents product and price learning from BOQ alignment', () => {
  assert.ok(dataset.alignments.every((alignment) => !('price' in alignment)));
  assert.ok(dataset.finalRows.every((row) => row.manufacturer == null || typeof row.manufacturer === 'string'));
  assert.ok(dataset.finalRows.every((row) => !('selling_price' in row) && !('supplier_price' in row)));
});

test('registers recovered Dialysis files with archive provenance', () => {
  assert.equal(dataset.recoveredFiles.length, 5);
  assert.ok(dataset.recoveredFiles.every((file) => file.containerPath.endsWith('.rar')));
  assert.ok(dataset.recoveredFiles.every((file) => file.containerChecksum && file.archiveMember));
  const dialysis = dataset.projects.find((project) => project.name.includes('Dialysis'));
  assert.equal(dialysis.pairBeforeRecovery, 'Missing Source BOQ');
  assert.equal(dialysis.pair, 'Partial Pair');
});

test('keeps encrypted files safely blocked', () => {
  assert.equal(dataset.blockedFiles.length, 4);
  assert.ok(dataset.blockedFiles.every((file) => file.reason.includes('password required')));
});

test('does not auto-approve revalidated alignment candidates', () => {
  const exactStrong = dataset.alignmentReviews.filter((row) => ['Exact Alignment', 'Strong Alignment'].includes(row.originalOutcome));
  assert.ok(exactStrong.length > 0);
  assert.equal(dataset.approvedGroundTruth.length, 0);
  assert.ok(dataset.alignments.every((alignment) => alignment.eligible === 0));
  assert.ok(exactStrong.every((row) => row.humanDecision === ''));
});

test('bounds unresolved assistance to same-project candidates with visible conflicts', () => {
  assert.ok(dataset.unresolvedAssistance.every((row) => row.candidates.length <= 5));
  const finalById = new Map(dataset.finalRows.map((row) => [row.id, row]));
  assert.ok(dataset.unresolvedAssistance.every((row) => row.candidates.every((candidate) => finalById.get(candidate.finalRowId)?.project_id === row.projectId)));
  assert.ok(dataset.unresolvedAssistance.flatMap((row) => row.candidates).every((candidate) => 'unitDifference' in candidate && 'quantityDifference' in candidate));
  assert.ok(dataset.unresolvedAssistance.every((row) => row.alignmentDecision === ''));
});

test('keeps split and merge risks explicit and patterns inactive', () => {
  assert.ok(dataset.splitMergeCandidates.length > 0);
  assert.equal(dataset.activePatterns.length, 0);
  assert.ok(dataset.patterns.every((pattern) => pattern.scope === 'Project-Scoped Experimental'));
});

test('creates the reviewer workbook', () => {
  assert.ok(fs.statSync(workbookPath).size > 100_000);
  const archive = unzipSync(new Uint8Array(fs.readFileSync(workbookPath)));
  const workbookXml = strFromU8(archive['xl/workbook.xml']);
  for (const sheet of ['Approved Ground Truth', 'Exact and Strong Review', 'Unresolved Review Queue', 'Blocked Files']) {
    assert.match(workbookXml, new RegExp(sheet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const worksheetXml = Object.entries(archive).filter(([name]) => name.startsWith('xl/worksheets/sheet')).map(([, bytes]) => strFromU8(bytes)).join('\n');
  assert.match(worksheetXml, /histRow_/);
});
