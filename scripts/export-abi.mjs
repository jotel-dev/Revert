import console from 'node:console';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const contractsDir = path.resolve(import.meta.dirname, '..', 'packages', 'contracts');
const outArtifactPath = path.join(contractsDir, 'out', 'RevertEscrow.sol', 'RevertEscrow.json');
const abiOutDir = path.join(contractsDir, 'abi');
const abiOutPath = path.join(abiOutDir, 'RevertEscrow.json');

if (!fs.existsSync(outArtifactPath)) {
  console.error(`Compiled artifact not found at ${outArtifactPath}. Run forge build first.`);
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(outArtifactPath, 'utf8'));

fs.mkdirSync(abiOutDir, { recursive: true });
fs.writeFileSync(
  abiOutPath,
  JSON.stringify({ contractName: 'RevertEscrow', abi: artifact.abi }, null, 2) + '\n',
);
console.log(`Exported ABI to ${abiOutPath} (${artifact.abi.length} entries)`);
