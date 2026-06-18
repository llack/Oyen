const os = require('os');
const fs = require('fs');
const pty = require('@homebridge/node-pty-prebuilt-multiarch');
const sftpProvider = require('./providers/sftp-provider');

const sessions = new Map();
let nextId = 1;

function pickShell(override) {
  if (override && fs.existsSync(override)) return override;
  if (process.platform === 'win32') {
    const candidates = [
      process.env.OYEN_TERMINAL_SHELL,
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      process.env.ComSpec,
      `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\cmd.exe`
    ];
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) return candidate;
    }
    return 'powershell.exe';
  }
  return process.env.SHELL || '/bin/zsh';
}

function safeCwd(requested) {
  try {
    if (requested && fs.existsSync(requested) && fs.statSync(requested).isDirectory()) {
      return requested;
    }
  } catch (_) {}
  return os.homedir();
}

function spawnSession({ cwd, cols, rows, shell: shellOverride }) {
  const shell = pickShell(shellOverride);
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: Math.max(2, cols || 80),
    rows: Math.max(2, rows || 24),
    cwd: safeCwd(cwd),
    env: { ...process.env, TERM: 'xterm-256color' }
  });

  const id = String(nextId++);
  sessions.set(id, { type: 'pty', pty: ptyProcess });
  return { id, shell };
}

async function spawnRemoteSession({ authority, cwd, cols, rows }) {
  if (!authority) throw new Error('authority required');
  const entry = await sftpProvider.acquireClient(authority);
  let channel;
  try {
    channel = await new Promise((resolve, reject) => {
      entry.client.shell(
        { term: 'xterm-256color', rows: Math.max(2, rows || 24), cols: Math.max(2, cols || 80) },
        (err, ch) => err ? reject(err) : resolve(ch)
      );
    });
  } catch (err) {
    sftpProvider.releaseClient(authority);
    throw err;
  }
  const id = String(nextId++);
  sessions.set(id, { type: 'remote', channel, authority });
  if (cwd) {
    const remotePath = extractRemotePath(cwd);
    if (remotePath && remotePath !== '/') {
      const quoted = remotePath.replace(/'/g, "'\\''");
      try { channel.write(`cd '${quoted}' 2>/dev/null\n`); } catch (_) {}
    }
  }
  return { id };
}

function extractRemotePath(uri) {
  try {
    const u = new URL(uri);
    return decodeURIComponent(u.pathname || '/');
  } catch {
    return '';
  }
}

function writeSession(id, data) {
  const session = sessions.get(id);
  if (!session) return false;
  if (session.type === 'pty') session.pty.write(data);
  else session.channel.write(data);
  return true;
}

function resizeSession(id, cols, rows) {
  const session = sessions.get(id);
  if (!session) return false;
  const c = Math.max(2, cols);
  const r = Math.max(2, rows);
  try {
    if (session.type === 'pty') session.pty.resize(c, r);
    else session.channel.setWindow(r, c, 0, 0);
  } catch (_) {}
  return true;
}

function disposeSession(id) {
  const session = sessions.get(id);
  if (!session) return false;
  if (session.type === 'pty') {
    try { session.pty.kill(); } catch (_) {}
  } else {
    try { session.channel.end(); } catch (_) {}
    try { session.channel.close(); } catch (_) {}
    sftpProvider.releaseClient(session.authority);
  }
  sessions.delete(id);
  return true;
}

function attachSession(id, onData, onExit) {
  const session = sessions.get(id);
  if (!session) return null;
  if (session.type === 'pty') {
    const dataDisposable = session.pty.onData((data) => onData(data));
    const exitDisposable = session.pty.onExit(({ exitCode, signal }) => onExit({ exitCode, signal }));
    return {
      dispose() {
        try { dataDisposable.dispose(); } catch (_) {}
        try { exitDisposable.dispose(); } catch (_) {}
      }
    };
  }
  let lastExitCode = 0;
  let lastSignal = null;
  let exited = false;
  const onDataFn = (chunk) => onData(chunk.toString('utf8'));
  const onStderrFn = (chunk) => onData(chunk.toString('utf8'));
  const onExitFn = (code, signal) => {
    if (typeof code === 'number') lastExitCode = code;
    if (signal) lastSignal = signal;
  };
  const onCloseFn = () => {
    if (exited) return;
    exited = true;
    onExit({ exitCode: lastExitCode, signal: lastSignal });
  };
  session.channel.on('data', onDataFn);
  session.channel.stderr?.on('data', onStderrFn);
  session.channel.on('exit', onExitFn);
  session.channel.on('close', onCloseFn);
  return {
    dispose() {
      try { session.channel.removeListener('data', onDataFn); } catch (_) {}
      try { session.channel.stderr?.removeListener('data', onStderrFn); } catch (_) {}
      try { session.channel.removeListener('exit', onExitFn); } catch (_) {}
      try { session.channel.removeListener('close', onCloseFn); } catch (_) {}
    }
  };
}

function disposeAll() {
  for (const id of Array.from(sessions.keys())) disposeSession(id);
}

module.exports = {
  spawnSession,
  spawnRemoteSession,
  writeSession,
  resizeSession,
  disposeSession,
  attachSession,
  disposeAll
};
