#!/usr/bin/env node
/**
 * Local dev script — injects a fixture JSON into the Tell HTML template
 * and opens the result in the browser. No agent, no CLI needed.
 *
 * Usage:
 *   node scripts/dev.js                        # uses fixtures/sample.json
 *   node scripts/dev.js fixtures/other.json    # custom fixture
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const fixturePath = path.resolve(process.argv[2] || path.join(root, 'fixtures', 'sample.json'));
const templatePath = path.join(root, 'templates', 'tell-template.html');
const outPath = path.join(root, 'demo', 'dev.html');

if (!fs.existsSync(fixturePath)) {
  console.error(`Fixture not found: ${fixturePath}`);
  process.exit(1);
}

if (!fs.existsSync(templatePath)) {
  console.error(`Template not found: ${templatePath}`);
  process.exit(1);
}

const fixture = fs.readFileSync(fixturePath, 'utf8');
const template = fs.readFileSync(templatePath, 'utf8');

// Validate fixture is parseable JSON
let parsed;
try {
  parsed = JSON.parse(fixture);
} catch (err) {
  console.error(`Invalid JSON in fixture: ${err.message}`);
  process.exit(1);
}

if (!template.includes('__TELL_DATA_PLACEHOLDER__')) {
  console.error('Template missing __TELL_DATA_PLACEHOLDER__ — wrong template?');
  process.exit(1);
}

// Escape </script> sequences that would break the inline JSON block
const safe = fixture.replace(/<\/script>/gi, '<\\/script>');
const out = template.replace('__TELL_DATA_PLACEHOLDER__', safe);

fs.writeFileSync(outPath, out, 'utf8');
console.log(`Written: ${outPath}`);

// Open in browser
const platform = process.platform;
try {
  if (platform === 'darwin') {
    execSync(`open "${outPath}"`);
  } else if (platform === 'win32') {
    execSync(`start "" "${outPath}"`);
  } else {
    execSync(`xdg-open "${outPath}"`);
  }
  console.log('Opened in browser.');
} catch {
  console.log(`Open manually: ${outPath}`);
}

console.log(`\nFixture: ${path.relative(root, fixturePath)}`);
console.log(`Files: ${parsed.files?.length ?? '?'}  Hunks: ${parsed.files?.reduce((n, f) => n + (f.hunks?.length ?? 0), 0) ?? '?'}`);
