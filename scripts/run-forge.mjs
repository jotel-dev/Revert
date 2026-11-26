import { spawnSync } from 'node:child_process';
import console from 'node:console';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

function resolveForgeBin() {
  const isWin = process.platform === 'win32';
  const exe = isWin ? 'forge.exe' : 'forge';
  const homeBin = path.join(os.homedir(), '.foundry', 'bin', exe);
  if (fs.existsSync(homeBin)) return homeBin;
  return 'forge';
}

const forgeBin = resolveForgeBin();
const contractsDir = path.resolve(import.meta.dirname, '..', 'packages', 'contracts');
const args = process.argv.slice(2);

const res = spawnSync(forgeBin, args, {
  cwd: contractsDir,
  stdio: 'inherit',
  shell: false,
});

if (res.error) {
  console.error(`Failed to execute ${forgeBin}:`, res.error.message);
  process.exit(1);
}
process.exit(res.status ?? 1);
