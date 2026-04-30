import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff, parseHunkHeader, DiffFile, Hunk, DiffLine } from './tell-parse';

// ── Helpers ────────────────────────────────────────────────────────────────

function line(type: DiffLine['type'], oldNum: number | null, newNum: number | null, text: string): DiffLine {
  return { type, oldNum, newNum, text };
}

// ── parseHunkHeader ────────────────────────────────────────────────────────

describe('parseHunkHeader', () => {
  test('full form: @@ -X,Y +A,B @@', () => {
    const result = parseHunkHeader('@@ -18,6 +22,9 @@');
    assert.deepEqual(result, { oldStart: 18, oldLines: 6, newStart: 22, newLines: 9 });
  });

  test('omitted Y defaults to 1', () => {
    const result = parseHunkHeader('@@ -5 +5,3 @@');
    assert.deepEqual(result, { oldStart: 5, oldLines: 1, newStart: 5, newLines: 3 });
  });

  test('omitted B defaults to 1', () => {
    const result = parseHunkHeader('@@ -5,3 +5 @@');
    assert.deepEqual(result, { oldStart: 5, oldLines: 3, newStart: 5, newLines: 1 });
  });

  test('new file form: @@ -0,0 +1,N @@', () => {
    const result = parseHunkHeader('@@ -0,0 +1,46 @@');
    assert.deepEqual(result, { oldStart: 0, oldLines: 0, newStart: 1, newLines: 46 });
  });

  test('trailing context text is ignored', () => {
    const result = parseHunkHeader('@@ -10,4 +10,5 @@ def my_function');
    assert.deepEqual(result, { oldStart: 10, oldLines: 4, newStart: 10, newLines: 5 });
  });

  test('returns null for non-hunk lines', () => {
    assert.equal(parseHunkHeader('--- a/foo.ex'), null);
    assert.equal(parseHunkHeader('+++ b/foo.ex'), null);
    assert.equal(parseHunkHeader(''), null);
  });
});

// ── parseDiff — new file ───────────────────────────────────────────────────

describe('parseDiff — new file', () => {
  const diff = [
    'diff --git a/lib/new.ex b/lib/new.ex',
    'new file mode 100644',
    'index 0000000..abc1234',
    '--- /dev/null',
    '+++ b/lib/new.ex',
    '@@ -0,0 +1,3 @@',
    '+line one',
    '+line two',
    '+line three',
  ].join('\n');

  test('produces one file entry', () => {
    const files = parseDiff(diff);
    assert.equal(files.length, 1);
  });

  test('name and status', () => {
    const [f] = parseDiff(diff);
    assert.equal(f.name, 'lib/new.ex');
    assert.equal(f.status, 'A');
  });

  test('counts', () => {
    const [f] = parseDiff(diff);
    assert.equal(f.additions, 3);
    assert.equal(f.deletions, 0);
  });

  test('hunk header parsed', () => {
    const [f] = parseDiff(diff);
    const h = f.hunks[0];
    assert.equal(h.hunkStartOld, 0);
    assert.equal(h.hunkStartNew, 1);
    assert.equal(h.hunkLinesOld, 0);
    assert.equal(h.hunkLinesNew, 3);
  });

  test('line numbers are correct', () => {
    const [f] = parseDiff(diff);
    const { lines } = f.hunks[0];
    assert.deepEqual(lines[0], line('add', null, 1, 'line one'));
    assert.deepEqual(lines[1], line('add', null, 2, 'line two'));
    assert.deepEqual(lines[2], line('add', null, 3, 'line three'));
  });
});

// ── parseDiff — modified file ──────────────────────────────────────────────

describe('parseDiff — modified file', () => {
  const diff = [
    'diff --git a/lib/foo.ex b/lib/foo.ex',
    'index abc..def 100644',
    '--- a/lib/foo.ex',
    '+++ b/lib/foo.ex',
    '@@ -10,4 +10,5 @@',
    ' context one',
    '-old line',
    '+new line one',
    '+new line two',
    ' context two',
  ].join('\n');

  test('status is M', () => {
    const [f] = parseDiff(diff);
    assert.equal(f.status, 'M');
    assert.equal(f.name, 'lib/foo.ex');
  });

  test('counts', () => {
    const [f] = parseDiff(diff);
    assert.equal(f.additions, 2);
    assert.equal(f.deletions, 1);
  });

  test('line numbers advance correctly through ctx/del/add', () => {
    const [f] = parseDiff(diff);
    const { lines } = f.hunks[0];
    // oldCursor starts at 10, newCursor starts at 10
    assert.deepEqual(lines[0], line('ctx', 10, 10, 'context one'));  // old=10, new=10 → both advance to 11
    assert.deepEqual(lines[1], line('del', 11, null, 'old line'));   // old=11 → advances to 12; new stays 11
    assert.deepEqual(lines[2], line('add', null, 11, 'new line one')); // new=11 → advances to 12; old stays 12
    assert.deepEqual(lines[3], line('add', null, 12, 'new line two')); // new=12 → advances to 13; old stays 12
    assert.deepEqual(lines[4], line('ctx', 12, 13, 'context two')); // old=12, new=13
  });
});

// ── parseDiff — deleted file ───────────────────────────────────────────────

describe('parseDiff — deleted file', () => {
  const diff = [
    'diff --git a/lib/old.ex b/lib/old.ex',
    'deleted file mode 100644',
    'index abc1234..0000000',
    '--- a/lib/old.ex',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-line one',
    '-line two',
  ].join('\n');

  test('status is D and name is preserved', () => {
    const [f] = parseDiff(diff);
    assert.equal(f.status, 'D');
    assert.equal(f.name, 'lib/old.ex');
  });

  test('counts', () => {
    const [f] = parseDiff(diff);
    assert.equal(f.additions, 0);
    assert.equal(f.deletions, 2);
  });

  test('del lines have correct oldNum', () => {
    const [f] = parseDiff(diff);
    const { lines } = f.hunks[0];
    assert.deepEqual(lines[0], line('del', 1, null, 'line one'));
    assert.deepEqual(lines[1], line('del', 2, null, 'line two'));
  });
});

// ── parseDiff — multiple files ─────────────────────────────────────────────

describe('parseDiff — multiple files', () => {
  const diff = [
    'diff --git a/lib/a.ex b/lib/a.ex',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/lib/a.ex',
    '@@ -0,0 +1,1 @@',
    '+hello',
    'diff --git a/lib/b.ex b/lib/b.ex',
    '--- a/lib/b.ex',
    '+++ b/lib/b.ex',
    '@@ -5,3 +5,3 @@',
    ' ctx',
    '-remove',
    '+insert',
    ' ctx2',
  ].join('\n');

  test('produces two files', () => {
    const files = parseDiff(diff);
    assert.equal(files.length, 2);
  });

  test('first file is A, second is M', () => {
    const [a, b] = parseDiff(diff);
    assert.equal(a.status, 'A');
    assert.equal(a.name, 'lib/a.ex');
    assert.equal(b.status, 'M');
    assert.equal(b.name, 'lib/b.ex');
  });

  test('each file has independent line numbering', () => {
    const [a, b] = parseDiff(diff);
    assert.deepEqual(a.hunks[0].lines[0], line('add', null, 1, 'hello'));
    // b starts at old=5, new=5
    assert.deepEqual(b.hunks[0].lines[0], line('ctx', 5, 5, 'ctx'));
    assert.deepEqual(b.hunks[0].lines[1], line('del', 6, null, 'remove'));
    assert.deepEqual(b.hunks[0].lines[2], line('add', null, 6, 'insert'));
  });
});

// ── parseDiff — multiple hunks in one file ─────────────────────────────────

describe('parseDiff — multiple hunks in one file', () => {
  const diff = [
    'diff --git a/lib/foo.ex b/lib/foo.ex',
    '--- a/lib/foo.ex',
    '+++ b/lib/foo.ex',
    '@@ -1,2 +1,3 @@',
    ' ctx A',
    '+added in hunk one',
    ' ctx B',
    '@@ -50,2 +51,2 @@',
    ' ctx C',
    '-old',
    '+new',
    ' ctx D',
  ].join('\n');

  test('two hunks are parsed', () => {
    const [f] = parseDiff(diff);
    assert.equal(f.hunks.length, 2);
  });

  test('hunk one has correct start positions', () => {
    const [f] = parseDiff(diff);
    const h1 = f.hunks[0];
    assert.equal(h1.hunkStartOld, 1);
    assert.equal(h1.hunkStartNew, 1);
  });

  test('hunk two has correct start positions', () => {
    const [f] = parseDiff(diff);
    const h2 = f.hunks[1];
    assert.equal(h2.hunkStartOld, 50);
    assert.equal(h2.hunkStartNew, 51);
  });

  test('hunk two line numbers start independently from header', () => {
    const [f] = parseDiff(diff);
    const { lines } = f.hunks[1];
    assert.deepEqual(lines[0], line('ctx', 50, 51, 'ctx C'));
    assert.deepEqual(lines[1], line('del', 51, null, 'old'));
    assert.deepEqual(lines[2], line('add', null, 52, 'new'));
    assert.deepEqual(lines[3], line('ctx', 52, 53, 'ctx D'));
  });

  test('aggregate counts span both hunks', () => {
    const [f] = parseDiff(diff);
    assert.equal(f.additions, 2); // one in hunk 1, one in hunk 2
    assert.equal(f.deletions, 1);
  });
});

// ── parseDiff — renamed file ───────────────────────────────────────────────

describe('parseDiff — renamed file', () => {
  const diff = [
    'diff --git a/lib/old_name.ex b/lib/new_name.ex',
    'similarity index 95%',
    'rename from lib/old_name.ex',
    'rename to lib/new_name.ex',
    '--- a/lib/old_name.ex',
    '+++ b/lib/new_name.ex',
    '@@ -1,2 +1,2 @@',
    ' ctx',
    '-old line',
    '+new line',
  ].join('\n');

  test('status is R', () => {
    const [f] = parseDiff(diff);
    assert.equal(f.status, 'R');
  });

  test('name is new path, oldName is previous path', () => {
    const [f] = parseDiff(diff);
    assert.equal(f.name, 'lib/new_name.ex');
    assert.equal(f.oldName, 'lib/old_name.ex');
  });
});

// ── parseDiff — hunk header strips trailing context text ───────────────────

describe('parseDiff — hunk header format', () => {
  const diff = [
    'diff --git a/lib/foo.ex b/lib/foo.ex',
    '--- a/lib/foo.ex',
    '+++ b/lib/foo.ex',
    '@@ -1,2 +1,3 @@ def my_function do',
    ' ctx',
    '+added',
    ' ctx2',
  ].join('\n');

  test('header stored without trailing function context', () => {
    const [f] = parseDiff(diff);
    assert.equal(f.hunks[0].header, '@@ -1,2 +1,3 @@');
  });
});

// ── parseDiff — empty input ────────────────────────────────────────────────

describe('parseDiff — edge cases', () => {
  test('empty string produces empty array', () => {
    assert.deepEqual(parseDiff(''), []);
  });

  test('diff with no hunks (binary file notice)', () => {
    const diff = [
      'diff --git a/image.png b/image.png',
      'index abc..def 100644',
      'Binary files a/image.png and b/image.png differ',
    ].join('\n');
    const files = parseDiff(diff);
    assert.equal(files.length, 1);
    assert.equal(files[0].hunks.length, 0);
    assert.equal(files[0].additions, 0);
  });
});
