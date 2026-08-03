/**
 * Starts Expo + Vite via concurrently.
 * Fixes Windows "spawn cmd.exe ENOENT" when System32 is missing from PATH
 * (common in some IDE / PowerShell environments).
 */
const path = require('path');
const { spawn, execSync } = require('child_process');

const system32 = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32')
  : 'C:\\Windows\\System32';

const pathKey = process.env.Path !== undefined ? 'Path' : 'PATH';
const currentPath = process.env[pathKey] || '';
if (!currentPath.toLowerCase().includes(system32.toLowerCase())) {
  process.env[pathKey] = `${currentPath};${system32};${path.dirname(system32)}`;
}
process.env.ComSpec = process.env.ComSpec || path.join(system32, 'cmd.exe');

/** Avoid Expo's interactive "port in use?" prompt under concurrently. */
function freePort(port) {
  if (process.platform !== 'win32') return;
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`,
      { encoding: 'utf8' }
    );
    const pids = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s) && s !== String(process.pid));
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        console.log(`[start] Freed port ${port} (stopped PID ${pid})`);
      } catch {
        // ignore if process already exited
      }
    }
  } catch {
    // nothing listening
  }
}

freePort(8081);

const concurrentlyBin = path.join(
  __dirname,
  '..',
  'node_modules',
  'concurrently',
  'dist',
  'bin',
  'concurrently.js'
);

const child = spawn(
  process.execPath,
  [
    concurrentlyBin,
    '-n',
    'expo,vite',
    '-c',
    'cyan,magenta',
    'npm run start --prefix NurseLink',
    'npm run dev --prefix NurseLink-web',
  ],
  {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  }
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
