import { execSync } from 'node:child_process';
import process from 'node:process';

const port = Number(process.argv[2] || 5173);
const isWin = process.platform === 'win32';

function findListenerPids() {
  try {
    if (isWin) {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
        if (m && Number(m[1]) === port) pids.add(m[2]);
      }
      return [...pids];
    }
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' });
    return out.trim().split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

const pids = findListenerPids();
if (!pids.length) process.exit(0);

for (const pid of pids) {
  try {
    if (isWin) execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    else execSync(`kill -9 ${pid}`);
    console.log(`[free-port] killed pid ${pid} on :${port}`);
  } catch {}
}
