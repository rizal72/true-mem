import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Find package.json by searching upward from startDir
 */
function findPackageJsonUp(startDir: string): string | null {
  let currentDir = startDir;
  while (currentDir !== path.dirname(currentDir)) {
    const pkgPath = path.join(currentDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      return pkgPath;
    }
    currentDir = path.dirname(currentDir);
  }
  return null;
}

/**
 * Read version from package.json at RUNTIME.
 * Searches upward from the current module directory.
 */
export function getVersion(): string {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = findPackageJsonUp(currentDir);
    if (pkgPath) {
      const content = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      return pkg.version ?? 'unknown';
    }
    return 'unknown';
  } catch (error) {
    console.error('[True-Mem] Version detection error:', error);
    return 'unknown';
  }
}
