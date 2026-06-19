const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const knownHostsStore = require('./known-hosts-store');
const { requestHostVerify } = require('../ipc/host-verify-ipc');

let SshClient;
let ftpModule;

function loadSsh() {
  if (!SshClient) SshClient = require('ssh2').Client;
  return SshClient;
}

function loadFtp() {
  if (!ftpModule) ftpModule = require('basic-ftp');
  return ftpModule;
}

function isUsableUnencryptedKey(data) {
  try {
    const ssh2 = require('ssh2');
    const parsed = ssh2.utils.parseKey(data);
    return !(parsed instanceof Error);
  } catch {
    return false;
  }
}

/* All usable default keys in ~/.ssh (in order: id_ed25519 → id_rsa → id_ecdsa). */
async function findDefaultKeys() {
  const dir = path.join(os.homedir(), '.ssh');
  const out = [];
  for (const name of ['id_ed25519', 'id_rsa', 'id_ecdsa']) {
    const full = path.join(dir, name);
    try {
      const data = await fs.promises.readFile(full);
      if (!isUsableUnencryptedKey(data)) continue;
      out.push({ path: full, data });
    } catch {}
  }
  return out;
}

async function readKey(filePath) {
  return fs.promises.readFile(filePath);
}

/* Array of candidate keys to try per authType. password is [null] (no key).
   private-key-auto returns all default keys — so they can be tried in order, like ssh, to find the matching one. */
async function resolveCandidateKeys(profile) {
  if (profile.authType === 'private-key-auto') {
    const keys = await findDefaultKeys();
    if (!keys.length) throw new Error('No default key found in ~/.ssh (id_ed25519/id_rsa/id_ecdsa)');
    return keys.map((k) => k.data);
  }
  if (profile.authType === 'private-key-pem') {
    if (!profile.privateKeyPath) throw new Error('PEM file path is empty.');
    try { return [await readKey(profile.privateKeyPath)]; }
    catch (err) { throw new Error(`Failed to read key file: ${err.message}`); }
  }
  return [null];
}

function buildAuthority(profile) {
  const userPart = profile.username ? encodeURIComponent(profile.username) : '';
  return `sftp://${userPart}@${profile.host}:${profile.port || 22}`;
}

/* The first segment of the SSH public key buffer is the algorithm name (e.g. "ssh-ed25519"). */
function parseHostKeyAlgorithm(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return 'unknown';
  const len = buf.readUInt32BE(0);
  if (buf.length < 4 + len) return 'unknown';
  return buf.slice(4, 4 + len).toString('utf8');
}

function computeFingerprint(buf) {
  const hash = crypto.createHash('sha256').update(buf).digest('base64').replace(/=+$/, '');
  return `SHA256:${hash}`;
}

function buildSshConfig(profile, secret, keyData, hooks = {}) {
  const authority = buildAuthority(profile);
  const config = {
    host: profile.host,
    port: profile.port || 22,
    username: profile.username || '',
    /* Disable ssh2's internal handshake timeout — connectClient's resettable timer manages it instead.
       This excludes the time spent waiting on the host key trust dialog from the timeout. */
    readyTimeout: 0,
    keepaliveInterval: 30000,
    keepaliveCountMax: 3,
    hostVerifier: (keyBuffer, cb) => {
      /* Auto-accept if it matches known-hosts; for new/changed keys, request a dialog from the renderer. */
      try {
        const fingerprint = computeFingerprint(keyBuffer);
        const sha256 = fingerprint.slice('SHA256:'.length);
        const algorithm = parseHostKeyAlgorithm(keyBuffer);
        const known = knownHostsStore.getHostKey(authority);
        if (known && known.sha256 === sha256) { cb(true); return; }
        const kind = known ? 'changed' : 'new';
        hooks.onVerifyStart?.();  /* start waiting for user response → pause the connect timeout */
        requestHostVerify({ authority, algorithm, fingerprint, kind })
          .then((result) => {
            hooks.onVerifyEnd?.();  /* response received → restart the timeout */
            if (result?.decision !== 'trust') { cb(false); return; }
            if (result.remember) {
              try { knownHostsStore.setHostKey(authority, { algorithm, sha256 }); } catch {}
            }
            cb(true);
          })
          .catch(() => { hooks.onVerifyEnd?.(); cb(false); });
      } catch {
        cb(false);
      }
    }
  };
  if (profile.authType === 'password') {
    config.password = secret.password || '';
  } else if (profile.authType === 'private-key-auto' || profile.authType === 'private-key-pem') {
    config.privateKey = keyData;
    if (secret.passphrase) config.passphrase = secret.passphrase;
  }
  return config;
}

/* Log masking — replace the FTP PASS command (> PASS …) with '***', and also any actual secret value (4+ chars) that might leak with '***'. */
function makeMasker(secret) {
  const vals = [secret?.password, secret?.passphrase, secret?.jumpPassword, secret?.jumpPassphrase, secret?.proxyPassword]
    .filter((v) => v && String(v).length >= 4);
  return (m) => {
    let s = String(m).replace(/(\bPASS\s+)\S.*$/i, '$1***');
    for (const v of vals) s = s.split(v).join('***');
    return s;
  };
}

function forwardOut(client, host, port) {
  return new Promise((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, host, port, (err, s) => err ? reject(err) : resolve(s));
  });
}

/* Connect an SSH Client. For private-key-auto, try the default keys in order (on auth failure, move to the next key).
   makeSock: a function that creates a new sock (jump forwardOut) on each attempt. If absent, connect directly.
   On success, return the connected Client; if all attempts fail, throw the last error. */
async function connectClient(profile, secret, makeSock, onLog) {
  const keys = await resolveCandidateKeys(profile);
  const Client = loadSsh();
  let lastErr = null;
  for (let i = 0; i < keys.length; i++) {
    const client = new Client();
    try {
      const sock = makeSock ? await makeSock() : null;
      await new Promise((resolve, reject) => {
        let done = false;
        let timer = null;
        const finish = (err) => {
          if (done) return;
          done = true;
          if (timer) { clearTimeout(timer); timer = null; }
          if (err) reject(err); else resolve();
        };
        /* The timer is resettable — paused while waiting on the host key trust dialog (onVerifyStart),
           then given another 12 seconds after the response (onVerifyEnd). User click time is excluded from the timeout. */
        const armTimer = () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => finish(new Error('Connect timeout')), 12000);
        };
        const pauseTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
        client.once('ready', () => finish());
        client.once('error', (err) => finish(err));
        const config = buildSshConfig(profile, secret, keys[i], {
          onVerifyStart: pauseTimer,
          onVerifyEnd: armTimer
        });
        /* During testing (onLog present), stream ssh2's actual debug logs as-is. Pool connections have no onLog, so they stay quiet. */
        if (onLog) config.debug = (m) => onLog(String(m));
        if (sock) config.sock = sock;
        armTimer();
        try { client.connect(config); }
        catch (err) { finish(err); }
      });
      return client;
    } catch (err) {
      lastErr = err;
      try { client.end(); } catch {}
      /* On auth failure, move to the next candidate key; for anything else (address/timeout, etc.), abort immediately. */
      const isAuth = /authentication methods failed|authentication failed|Permission denied/i.test(err?.message || '');
      if (isAuth && i < keys.length - 1) continue;
      throw err;
    }
  }
  throw lastErr || new Error('Connection failed');
}

/* If a jump host is configured, connect to the jump and return a sock factory for the target. Otherwise null.
   The caller must invoke the returned cleanup when closing the target connection. */
async function openJump(profile, secret, onLog) {
  const jump = profile.jump;
  if (!jump || !jump.host) return null;
  const jumpSecret = { password: secret?.jumpPassword, passphrase: secret?.jumpPassphrase };
  const jumpClient = await connectClient(jump, jumpSecret, null, onLog);
  return {
    client: jumpClient,
    makeSock: () => forwardOut(jumpClient, profile.host, profile.port || 22),
    cleanup: () => { try { jumpClient.end(); } catch {} }
  };
}

/* HTTP CONNECT proxy — returns a makeSock factory that opens a fresh tunneled socket per attempt (mirrors openJump's makeSock).
   The socket is handed to ssh2 via config.sock and owned by it afterwards, so there's no persistent resource to clean up.
   Note: connectClient awaits makeSock() *outside* its resettable connect timer, so this carries its own timeout. */
function makeProxySock(profile, secret, onLog) {
  const proxy = profile.proxy || {};
  const proxyHost = proxy.host;
  const proxyPort = Number(proxy.port) || 8080;
  const targetHost = profile.host;
  const targetPort = profile.port || 22;
  const log = (m) => { try { onLog?.(String(m)); } catch {} };
  return () => new Promise((resolve, reject) => {
    let settled = false;
    let buf = Buffer.alloc(0);
    const socket = net.connect(proxyPort, proxyHost);
    const timer = setTimeout(() => fail(new Error('Proxy CONNECT timeout')), 12000);
    function fail(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch {}
      reject(err);
    }
    function onData(chunk) {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) return;  /* wait for the full response header */
      const statusLine = buf.slice(0, idx).toString('utf8').split('\r\n')[0];
      log(`< ${statusLine}`);
      const code = Number((/^HTTP\/1\.[01]\s+(\d{3})/.exec(statusLine) || [])[1]) || 0;
      if (code === 200) {
        settled = true;
        clearTimeout(timer);
        socket.removeListener('data', onData);
        socket.removeListener('error', onErr);
        /* Some proxies bundle the SSH banner right after the 200 line — push leftover bytes back so ssh2 reads them. */
        const leftover = buf.slice(idx + 4);
        if (leftover.length) socket.unshift(leftover);
        /* Pause before handoff so no 'data' fires into the void in the gap; ssh2 re-resumes when it attaches its listener. */
        socket.pause();
        resolve(socket);
        return;
      }
      if (code === 407) { fail(new Error('Proxy authentication required (407)')); return; }
      fail(new Error(`Proxy CONNECT failed: ${statusLine || 'no response'}`));
    }
    function onErr(err) { fail(err); }
    socket.once('error', onErr);
    socket.once('connect', () => {
      log(`connected ${proxyHost}:${proxyPort} → CONNECT ${targetHost}:${targetPort}`);
      let req = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n`;
      if (proxy.username) {
        const cred = Buffer.from(`${proxy.username}:${secret?.proxyPassword || ''}`).toString('base64');
        req += `Proxy-Authorization: Basic ${cred}\r\n`;
      }
      req += 'Proxy-Connection: keep-alive\r\n\r\n';
      socket.write(req);
    });
    socket.on('data', onData);
  });
}

async function testSftp(profile, secret, onLog) {
  const mask = makeMasker(secret);
  /* Lines for the encrypted bytes carried by the tunnel (CHANNEL_DATA) are uninformative noise → drop them.
     Keep meaningful channel events like CHANNEL_OPEN/CONFIRMATION/EOF. */
  const log = (m) => {
    const s = mask(String(m));
    if (/CHANNEL_DATA \(r:/i.test(s)) return;
    try { onLog?.(s); } catch {}
  };
  /* With a jump/proxy, the debug output of multiple connections mixes into one log, so prefix [jump]/[proxy]/[target] to distinguish the source. */
  const hasJump = !!profile.jump?.host;
  const hasProxy = !hasJump && !!profile.proxy?.host;  /* jump and proxy are mutually exclusive (one sock source) */
  const jumpLog = hasJump ? (m) => log(`[jump] ${m}`) : log;
  const proxyLog = (m) => log(`[proxy] ${m}`);
  const targetLog = (hasJump || hasProxy) ? (m) => log(`[target] ${m}`) : log;
  let jump = null;
  try {
    if (hasJump) {
      try {
        jump = await openJump(profile, secret, jumpLog);
      } catch (err) {
        return { ok: false, message: `Jump host: ${err?.message || String(err)}` };
      }
    }
    const makeSock = jump?.makeSock || (hasProxy ? makeProxySock(profile, secret, proxyLog) : null);
    const conn = await connectClient(profile, secret, makeSock, targetLog);
    const ver = conn._remoteVer || '';
    try { conn.end(); } catch {}
    /* Warn on a mismatch between the selected OS and the server banner (in the status message only). The banner only reliably distinguishes whether it is Windows. */
    let message = 'SFTP connection OK';
    if (ver && (/windows/i.test(ver) !== (profile.os === 'windows'))) {
      message += ` — Warning: selected OS may differ from the server (server: ${ver})`;
    }
    return { ok: true, message };
  } catch (err) {
    return { ok: false, message: err?.message || String(err) };
  } finally {
    if (jump) jump.cleanup();
  }
}

function ftpAuthority(profile) {
  const userPart = profile.username ? encodeURIComponent(profile.username) : '';
  const proto = profile.secure ? 'ftps' : 'ftp';
  return `${proto}://${userPart}@${profile.host}:${profile.port || 21}`;
}

/* FTPS certificate TOFU — called before login (before sending the password). Trust/storage and change detection
   reuse the same known-hosts store and dialog as the SSH host key. Throws if trust is denied. */
async function verifyFtpsCert(socket, authority) {
  const cert = socket && typeof socket.getPeerCertificate === 'function' ? socket.getPeerCertificate() : null;
  const sha256 = cert && cert.fingerprint256;
  if (!sha256) return;  /* no certificate info (in theory always present for TLS) → pass through */
  const known = knownHostsStore.getHostKey(authority);
  if (known && known.sha256 === sha256) return;
  const kind = known ? 'changed' : 'new';
  const result = await requestHostVerify({ authority, algorithm: 'TLS certificate', fingerprint: sha256, kind });
  if (result?.decision !== 'trust') throw new Error('Certificate not trusted');
  if (result.remember) {
    try { knownHostsStore.setHostKey(authority, { algorithm: 'TLS certificate', sha256 }); } catch {}
  }
}

/* FTP/FTPS connection — break access() apart so that, for FTPS, the certificate TOFU check runs after useTLS and before login.
   If onLog is present, stream protocol logs. On success, return the client with login and default settings done. */
async function connectFtpClient(profile, secret, { timeout = 15000, onLog } = {}) {
  const ftp = loadFtp();
  const client = new ftp.Client(timeout);
  if (onLog) { client.ftp.verbose = true; client.ftp.log = (m) => onLog(m); }
  try {
    const host = profile.host;
    const port = profile.port || 21;
    await client.connect(host, port);
    if (profile.secure) {
      /* Let the handshake pass with rejectUnauthorized:false, and verify the certificate ourselves via TOFU. */
      await client.useTLS({ rejectUnauthorized: false, host });
      const sock = client.ftp.socket;
      try { sock.setTimeout(0); } catch {}  /* pause the idle timeout while waiting on the trust dialog */
      try {
        await verifyFtpsCert(sock, ftpAuthority(profile));
      } finally {
        try { sock.setTimeout(timeout); } catch {}
      }
    }
    await client.sendIgnoringError('OPTS UTF8 ON');
    await client.login(profile.username || 'anonymous', (secret && secret.password) || 'anonymous@');
    await client.useDefaultSettings();
    return client;
  } catch (err) {
    try { client.close(); } catch {}
    throw err;
  }
}

async function testFtp(profile, secret, onLog) {
  const mask = makeMasker(secret);
  const log = (m) => { try { onLog?.(mask(m)); } catch {} };
  let client = null;
  try {
    client = await connectFtpClient(profile, secret, { timeout: 10000, onLog: onLog ? log : undefined });
    return { ok: true, message: 'FTP connection OK' };
  } catch (err) {
    return { ok: false, message: err?.message || String(err) };
  } finally {
    try { client?.close(); } catch {}
  }
}

async function testConnection(profile, secret, onLog) {
  const safe = secret || {};
  if (profile.type === 'sftp') return testSftp(profile, safe, onLog);
  if (profile.type === 'ftp') return testFtp(profile, safe, onLog);
  return { ok: false, message: `Unknown protocol: ${profile.type}` };
}

module.exports = { testConnection, connectClient, openJump, makeProxySock, connectFtpClient };
