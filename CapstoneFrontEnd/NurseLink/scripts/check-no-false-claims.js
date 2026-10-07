#!/usr/bin/env node
/**
 * Fails the build if "HIPAA" or "encrypted" shows up in UI source — this app
 * makes neither claim truthfully (no HIPAA review has happened, nothing in
 * the database is encrypted), so neither word belongs in anything a user
 * reads. See CapstoneFrontEnd/NurseLink/README.md "Known Limitations".
 *
 * Plain Node, no test framework: there isn't one in this project yet, and
 * this check doesn't need one.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const UI_DIRS = ['app', 'components'];
const EXTENSIONS = new Set(['.ts', '.tsx']);
const FORBIDDEN = [/HIPAA/i, /encrypted/i];

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

let violations = [];
for (const dir of UI_DIRS) {
  const dirPath = path.join(ROOT, dir);
  if (!fs.existsSync(dirPath)) continue;
  for (const file of walk(dirPath, [])) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const pattern of FORBIDDEN) {
        if (pattern.test(line)) {
          violations.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      }
    });
  }
}

if (violations.length) {
  console.error('False security/compliance claim(s) found in UI source:\n');
  violations.forEach((v) => console.error('  ' + v));
  console.error('\nRemove the claim or reword it honestly (see README Known Limitations).');
  process.exit(1);
}

console.log('No HIPAA/encrypted claims found in UI source.');
