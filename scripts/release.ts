import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const releaseZipName = 'release.zip';
const tempDirName = 'release-temp';

const filesToCopy = [
  '.dockerignore',
  '.env.example',
  '.npmrc',
  'Dockerfile',
  'docker-compose.yml',
  'drizzle.config.ts',
  'eslint.config.mjs',
  'next.config.ts',
  'package.json',
  'package-lock.json',
  'postcss.config.mjs',
  'proxy.ts',
  'tsconfig.json',
  'app',
  'components',
  'db',
  'fonts',
  'lib',
  'modules',
  'public',
  'scripts',
];

function cleanUp(tempDir: string) {
  if (fs.existsSync(tempDir)) {
    console.log(`Cleaning up temporary directory: ${tempDir}`);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function run() {
  const rootDir = path.resolve(__dirname, '..');
  const tempDir = path.join(rootDir, tempDirName);
  const releasesDir = path.join(rootDir, 'releases');
  const zipFile = path.join(releasesDir, releaseZipName);

  console.log('Starting release packaging...');

  // 1. Clean up any existing temp artifacts
  cleanUp(tempDir);
  
  // Ensure releases directory exists
  if (!fs.existsSync(releasesDir)) {
    fs.mkdirSync(releasesDir, { recursive: true });
  }

  // Remove existing release.zip inside releases/
  if (fs.existsSync(zipFile)) {
    console.log(`Removing old zip file: ${zipFile}`);
    fs.unlinkSync(zipFile);
  }

  // 2. Create temp directory
  fs.mkdirSync(tempDir, { recursive: true });

  // 3. Copy whitelisted files and folders
  console.log('Copying files for release...');
  for (const fileOrDir of filesToCopy) {
    const srcPath = path.join(rootDir, fileOrDir);
    const destPath = path.join(tempDir, fileOrDir);

    if (fs.existsSync(srcPath)) {
      console.log(`- Copying: ${fileOrDir}`);
      // Exclude scripts/release.ts from the copy to keep output clean
      if (fileOrDir === 'scripts') {
        fs.mkdirSync(destPath, { recursive: true });
        const scriptFiles = fs.readdirSync(srcPath);
        for (const scriptFile of scriptFiles) {
          if (scriptFile !== 'release.ts') {
            fs.cpSync(path.join(srcPath, scriptFile), path.join(destPath, scriptFile), { recursive: true });
          }
        }
      } else {
        fs.cpSync(srcPath, destPath, { recursive: true });
      }
    } else {
      console.warn(`Warning: Whitelisted path not found: ${fileOrDir}`);
    }
  }

  // 4. Create the zip file using the native zip command
  console.log(`Generating zip archive: ${releaseZipName}...`);
  try {
    // Run zip command from within temp directory to place items in the root of the archive
    execSync(`zip -r "${zipFile}" .`, { cwd: tempDir, stdio: 'inherit' });
    console.log(`\nSuccess! Release packaged successfully into: ${zipFile}`);
  } catch (error) {
    console.error('Error generating zip archive:', error);
    process.exit(1);
  } finally {
    // 5. Clean up temporary directory
    cleanUp(tempDir);
  }
}

run();
