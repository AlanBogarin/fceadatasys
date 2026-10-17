import { spawn } from 'node:child_process';
import { AppError } from '../errors.js';

export type ScanResult = { clean: boolean; engine: string; signature?: string };
export interface Scanner { scan(bytes: Buffer): Promise<ScanResult> }
export interface ClamConfig { command: string; database?: string; timeoutMs: number; maxSignatureAgeDays: number }

export function parseClamResult(code: number | null, output: string, errors: string): ScanResult | undefined {
  const engine = /^Engine version:\s*(\S+)/mi.exec(output)?.[1] ?? 'ClamAV';
  const found = /^stdin:\s*(.+) FOUND\s*$/mi.exec(output);
  if (code === 1 && found) return { clean: false, engine, signature: found[1].slice(0, 200) };
  if (code === 0 && /^stdin: OK\s*$/mi.test(output) && /^Scanned files:\s*[1-9]\d*\s*$/mi.test(output) && !/\b(?:ERROR|WARNING)\b/i.test(output + errors)) return { clean: true, engine };
  return undefined;
}

/** No shell, no user arguments or filenames. Scan the exact bytes later persisted. */
export function createClamScanner(config: ClamConfig): Scanner {
  return { scan: bytes => new Promise((resolve, reject) => {
    const args = ['--stdout', '--scan-pdf=yes', '--alert-encrypted=yes', '--alert-exceeds-max=yes', '--max-filesize=25M', '--max-scansize=50M', '--max-files=1000', '--max-recursion=10', '--max-scantime=0', `--fail-if-cvd-older-than=${config.maxSignatureAgeDays}`, ...(config.database ? [`--database=${config.database}`] : []), '-'];
    const child = spawn(config.command, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    let settled = false;
    const finish = (result?: ScanResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result) resolve(result);
      else reject(new AppError(503, 'ANTIMALWARE_UNAVAILABLE', 'ClamAV no pudo completar el análisis. El archivo no fue habilitado.'));
    };
    const timer = setTimeout(() => { child.kill(); finish(); }, config.timeoutMs);
    const collect = (chunk: Buffer, stderr = false) => {
      if (stderr) errors += chunk.toString('utf8'); else output += chunk.toString('utf8');
      if (output.length + errors.length > 65536) { child.kill(); finish(); }
    };
    child.stdout.on('data', chunk => collect(chunk));
    child.stderr.on('data', chunk => collect(chunk, true));
    child.on('error', () => finish());
    child.stdin.on('error', () => { /* exit/error determines failure; do not crash on EPIPE */ });
    child.on('close', code => {
      finish(parseClamResult(code, output, errors));
    });
    child.stdin.end(bytes);
  }) };
}
