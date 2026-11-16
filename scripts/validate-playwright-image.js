import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Playwright refuses to run when the npm package version does not match the
// browser build baked into the Docker base image. Dependabot bumps one side at a
// time, so enforce the pairing here: the image tag must equal the installed
// playwright-core version (which is exactly what `npm ci` puts in the image).
function fail(message) {
  console.error(`❌ [Validation Error] ${message}`);
  console.error('   Playwright npm packages and the Docker base image must be the same version.');
  console.error('   Fix: align the FROM tag in Dockerfile with the "playwright" dependency in package.json.');
  process.exit(1);
}

const dockerfilePath = path.join(rootDir, 'Dockerfile');
const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
const imageMatch = dockerfile.match(/^FROM\s+mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble\b/m);

if (!imageMatch) {
  fail('Could not find a "FROM mcr.microsoft.com/playwright:vX.Y.Z-noble" line in Dockerfile.');
}

const imageVersion = imageMatch[1];
const playwrightPkgPath = path.join(rootDir, 'node_modules', 'playwright-core', 'package.json');

if (!fs.existsSync(playwrightPkgPath)) {
  console.log('⚠️  [SKIP] node_modules/playwright-core not installed; run "npm ci" first to validate the Playwright image pairing.');
  process.exit(0);
}

const npmVersion = JSON.parse(fs.readFileSync(playwrightPkgPath, 'utf8')).version;

if (npmVersion !== imageVersion) {
  fail(`Playwright version mismatch: Docker image is v${imageVersion}-noble but installed playwright-core is ${npmVersion}.`);
}

console.log(`✅ [OK] Playwright image v${imageVersion}-noble matches installed playwright-core ${npmVersion}.`);
