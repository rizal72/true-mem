import fs from 'node:fs';
import path from 'node:path';

/**
 * Read version from package.json at RUNTIME.
 * This ensures the version is always current, even after npm version bump.
 */
export function getVersion(): string {
  try {
    // Start from dist/ directory (where bundled code runs) and go up
    const distDir = __dirname;
    const pkgPath = path.join(distDir, '..', 'package.json');
    const content = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
