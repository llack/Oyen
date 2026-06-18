// Applies native-module fixes after `npm install` (replaces the old manual setup steps).
// Idempotent and cross-platform — steps that don't apply on a given OS are simply skipped.
import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NM = join(process.cwd(), 'node_modules');
const log = (m) => console.log(`[postinstall] ${m}`);

// 1) Drop ssh2's optional `cpu-features` native dep — it breaks electron-rebuild on Electron 42.
//    ssh2 falls back to its pure-JS implementation, so nothing is lost.
const cpuFeatures = join(NM, 'cpu-features');
if (existsSync(cpuFeatures)) {
  rmSync(cpuFeatures, { recursive: true, force: true });
  log('removed cpu-features');
}

// 2) Patch node-pty so it builds on Windows. These edits target source shipped in the npm
//    tarball; they are no-ops on platforms where the affected files aren't compiled.
const PTY = join(NM, '@homebridge', 'node-pty-prebuilt-multiarch');
const patch = (rel, fn) => {
  const file = join(PTY, rel);
  if (!existsSync(file)) return;
  const before = readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) { writeFileSync(file, after); log(`patched ${rel}`); }
};

// Disable Spectre mitigation (the toolset isn't available on default build machines).
patch('binding.gyp', (c) =>
  c.replace(/'SpectreMitigation':\s*'Spectre'/g, "'SpectreMitigation': 'false'"));

// Guard a helper that can throw and crash the pty process.
patch('lib/conpty_console_list_agent.js', (c) =>
  c.includes('[shellPid]') ? c : c.replace(
    'var consoleProcessList = getConsoleProcessList(shellPid);',
    'var consoleProcessList;\r\ntry { consoleProcessList = getConsoleProcessList(shellPid); } catch (e) { consoleProcessList = [shellPid]; }'));

// winpty: disable Spectre and make the .bat helpers run from the current directory.
patch('deps/winpty/src/winpty.gyp', (c) => c
  .replace(/'SpectreMitigation':\s*'Spectre'/g, "'SpectreMitigation': 'false'")
  .replace(/cd shared && GetCommitHash\.bat/g, 'cd shared && .\\\\GetCommitHash.bat')
  .replace(/cd shared && UpdateGenVersion\.bat/g, 'cd shared && .\\\\UpdateGenVersion.bat'));
