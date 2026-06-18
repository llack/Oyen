const posixPath = require('path').posix;
const sftp = require('./providers/sftp-provider');
const { parseUnifiedDiff } = require('./git-diff-parse');

/* Remote (SFTP) git. Runs git in a remote shell via ssh2 exec — same interface as git-service (local).
   rootPath is an sftp:// URI. Reuses the warm connection pool (sftp-provider).
   Git root detection matches local: only when the selected folder directly contains .git (no upward search). */

/* POSIX shell single-quote escaping — safe even when the path/filename contains arbitrary characters. */
function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/* sftp URI → { authority, path }. path is the remote absolute path. */
function locate(rootPath) {
  const { authority, path } = sftp.parseUri(rootPath);
  return { authority, dir: path || '/' };
}

/* git command builder. core.quotePath=false keeps non-ASCII paths (e.g. Korean) from being octal-escaped. */
function gitCmd(dir, args) {
  return `git -c core.quotePath=false -C ${shq(dir)} ${args}`;
}

async function run(authority, command, stdinData) {
  return sftp.execCommand(authority, command, stdinData);
}

async function isRepo(rootPath) {
  if (!rootPath || !sftp.isUri(rootPath)) return false;
  try {
    const { authority, dir } = locate(rootPath);
    const dotGit = posixPath.join(dir, '.git');
    const r = await run(authority, `test -e ${shq(dotGit)}`);
    return r.code === 0;
  } catch {
    return false;
  }
}

/* Parse the `## main...origin/main [ahead 1, behind 2]` branch header. */
function parseBranchLine(line) {
  const out = { branch: '', tracking: '', ahead: 0, behind: 0 };
  const body = line.replace(/^## /, '');
  if (body.startsWith('No commits yet on ')) {
    out.branch = body.slice('No commits yet on '.length).trim();
    return out;
  }
  if (body.startsWith('HEAD (no branch)')) {
    out.branch = '';
    return out;
  }
  const trackMatch = body.match(/^(.+?)\.\.\.(\S+)(?:\s+\[(.+)\])?$/);
  if (trackMatch) {
    out.branch = trackMatch[1];
    out.tracking = trackMatch[2];
    const meta = trackMatch[3] || '';
    const a = meta.match(/ahead (\d+)/);
    const b = meta.match(/behind (\d+)/);
    if (a) out.ahead = Number(a[1]);
    if (b) out.behind = Number(b[1]);
  } else {
    out.branch = body.trim();
  }
  return out;
}

/* porcelain v1 file line 'XY path' → OYEN file entry. For renames, use the new path. */
function parseFileLine(line) {
  const idx = line[0];
  const wd = line[1];
  let rest = line.slice(3);
  if ((idx === 'R' || idx === 'C') && rest.includes(' -> ')) {
    rest = rest.split(' -> ').pop();
  }
  const filePath = rest;
  const stagedFlag = idx !== ' ' && idx !== '?';
  const unstagedFlag = wd !== ' ';
  let marker = 'M';
  if (idx === '?' || wd === '?') marker = 'U';
  else if (idx === 'D' || wd === 'D') marker = 'D';
  return {
    path: filePath,
    indexStatus: idx,
    workingStatus: wd,
    staged: stagedFlag,
    unstaged: unstagedFlag,
    untracked: idx === '?' || wd === '?',
    marker
  };
}

async function getStatus(rootPath) {
  if (!(await isRepo(rootPath))) {
    return { isRepo: false, branch: '', ahead: 0, behind: 0, files: [] };
  }
  const { authority, dir } = locate(rootPath);
  let r;
  try {
    /* --untracked-files=all: expand a fully-untracked folder into individual files instead of collapsing it to a single line (dir/) (matches VSCode). */
    r = await run(authority, gitCmd(dir, 'status --porcelain=v1 --branch --untracked-files=all'));
  } catch (err) {
    return { isRepo: false, branch: '', ahead: 0, behind: 0, files: [], error: err?.message || String(err) };
  }
  if (r.code !== 0) {
    /* git not installed / corrupted repo, etc. — silently fall back to isRepo:false (matches local). */
    return { isRepo: false, branch: '', ahead: 0, behind: 0, files: [], error: r.stderr || '' };
  }

  let branch = '';
  let tracking = '';
  let ahead = 0;
  let behind = 0;
  const files = [];
  for (const line of r.stdout.split('\n')) {
    if (!line) continue;
    if (line.startsWith('## ')) {
      const b = parseBranchLine(line);
      branch = b.branch;
      tracking = b.tracking;
      ahead = b.ahead;
      behind = b.behind;
    } else {
      files.push(parseFileLine(line));
    }
  }
  return { isRepo: true, branch, ahead, behind, tracking, files };
}

/* On non-zero exit, throw with stderr — so the renderer surfaces the error, same as local (simple-git). */
function ensureOk(r, label) {
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || `${label} failed`);
}

async function stage(rootPath, files) {
  if (!Array.isArray(files) || files.length === 0) return;
  const { authority, dir } = locate(rootPath);
  ensureOk(await run(authority, gitCmd(dir, `add -- ${files.map(shq).join(' ')}`)), 'git add');
}

async function unstage(rootPath, files) {
  if (!Array.isArray(files) || files.length === 0) return;
  const { authority, dir } = locate(rootPath);
  ensureOk(await run(authority, gitCmd(dir, `reset HEAD -- ${files.map(shq).join(' ')}`)), 'git reset');
}

async function discard(rootPath, files, untracked = false) {
  if (!Array.isArray(files) || files.length === 0) return;
  const { authority, dir } = locate(rootPath);
  if (untracked) {
    /* untracked files are deleted directly from the file system (permanent, no trash — remote has no trash). */
    const abs = files.map((rel) => shq(posixPath.join(dir, rel))).join(' ');
    ensureOk(await run(authority, `rm -rf -- ${abs}`), 'rm');
  } else {
    ensureOk(await run(authority, gitCmd(dir, `checkout -- ${files.map(shq).join(' ')}`)), 'git checkout');
  }
}

async function commit(rootPath, message, options = {}) {
  if (!message && !options.amend) {
    const err = new Error('empty commit message');
    err.code = 'EMPTY_MESSAGE';
    throw err;
  }
  const { authority, dir } = locate(rootPath);
  let r;
  if (options.amend && !message) {
    r = await run(authority, gitCmd(dir, 'commit --amend --no-edit'));
  } else {
    const amend = options.amend ? '--amend ' : '';
    /* Pass the message via stdin (-F -) — safe for escaping/newlines. */
    r = await run(authority, gitCmd(dir, `commit ${amend}-F -`), message || '');
  }
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || 'git commit failed');
  return r.stdout;
}

async function push(rootPath) {
  const { authority, dir } = locate(rootPath);
  const r = await run(authority, gitCmd(dir, 'push'));
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || 'git push failed');
  return r.stdout;
}

async function pull(rootPath) {
  const { authority, dir } = locate(rootPath);
  const r = await run(authority, gitCmd(dir, 'pull'));
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || 'git pull failed');
  return r.stdout;
}

async function sync(rootPath) {
  await pull(rootPath);
  await push(rootPath);
}

async function fetch(rootPath) {
  const { authority, dir } = locate(rootPath);
  /* fetch failures (auth, etc.) are silent — fetch is a polling fallback, so don't throw. */
  const r = await run(authority, gitCmd(dir, 'fetch'));
  return r.stdout;
}

async function undoLastCommit(rootPath) {
  const { authority, dir } = locate(rootPath);
  const r = await run(authority, gitCmd(dir, 'reset --soft HEAD~1'));
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || 'git reset failed');
  return r.stdout;
}

async function getDiff(rootPath, file) {
  if (!file) return { hunks: [] };
  if (!(await isRepo(rootPath))) return { hunks: [] };
  try {
    const { authority, dir } = locate(rootPath);
    const r = await run(authority, gitCmd(dir, `diff --no-color -- ${shq(file)}`));
    if (r.code !== 0) return { hunks: [] };
    return parseUnifiedDiff(r.stdout);
  } catch {
    return { hunks: [] };
  }
}

/* Recent commit list (for the history panel, same format as local).
   Fields are separated by the unit separator (\x1f) and commits by the record separator (\x1e) — safe even when the subject contains spaces/special characters. */
async function log(rootPath, limit = 20) {
  if (!(await isRepo(rootPath))) return [];
  try {
    const { authority, dir } = locate(rootPath);
    const fmt = '%H%x1f%an%x1f%aI%x1f%s%x1e';
    const r = await run(authority, gitCmd(dir, `log -n ${Number(limit) || 20} --pretty=format:${shq(fmt)}`));
    if (r.code !== 0) return [];
    return r.stdout
      .split('\x1e')
      .map((rec) => rec.replace(/^\n/, ''))
      .filter((rec) => rec.length)
      .map((rec) => {
        const [hash, author, date, message] = rec.split('\x1f');
        return {
          hash: hash || '',
          shortHash: String(hash || '').slice(0, 7),
          message: message || '',
          author: author || '',
          date: date || ''
        };
      });
  } catch {
    return [];
  }
}

module.exports = { isRepo, getStatus, stage, unstage, discard, commit, push, pull, sync, getDiff, undoLastCommit, fetch, log };
