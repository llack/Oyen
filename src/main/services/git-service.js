const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs/promises');
const { parseUnifiedDiff } = require('./git-diff-parse');

/* per-root simple-git instance cache. One per baseDir. */
const instances = new Map();

function get(rootPath) {
  const key = path.resolve(rootPath);
  if (!instances.has(key)) {
    instances.set(key, simpleGit({ baseDir: key }));
  }
  return instances.get(key);
}

async function isRepo(rootPath) {
  if (!rootPath) return false;
  try {
    const dotGit = path.join(rootPath, '.git');
    await fs.access(dotGit);
    return true;
  } catch {
    return false;
  }
}

/* Convert simple-git status results into an OYEN-friendly format.
   marker: 'M' | 'U' | 'D' (A is not used — new files are also U).
   staged/unstaged: split out the index/working_dir flags.
*/
async function getStatus(rootPath) {
  if (!(await isRepo(rootPath))) {
    return { isRepo: false, branch: '', ahead: 0, behind: 0, files: [] };
  }
  const git = get(rootPath);
  let status;
  try {
    /* --untracked-files=all: expand a fully-untracked folder into individual files instead of collapsing it to a single line (dir/) (matches VSCode). */
    status = await git.status(['--untracked-files=all']);
  } catch (err) {
    /* If the .git folder exists but the git executable is missing (e.g. git not installed on Windows) or the repo is corrupted,
       silently fall back to isRepo:false — the UI hides the git tab. No notification. */
    return { isRepo: false, branch: '', ahead: 0, behind: 0, files: [], error: err?.message || String(err) };
  }

  const files = (status.files || []).map((f) => {
    const idx = f.index;
    const wd = f.working_dir;
    const stagedFlag = idx !== ' ' && idx !== '?';
    const unstagedFlag = wd !== ' ';
    let marker = 'M';
    if (idx === '?' || wd === '?') marker = 'U';
    else if (idx === 'D' || wd === 'D') marker = 'D';
    else marker = 'M';
    return {
      path: f.path,
      indexStatus: idx,
      workingStatus: wd,
      staged: stagedFlag,
      unstaged: unstagedFlag,
      untracked: idx === '?' || wd === '?',
      marker
    };
  });

  return {
    isRepo: true,
    branch: status.current || '',
    ahead: status.ahead || 0,
    behind: status.behind || 0,
    tracking: status.tracking || '',
    files
  };
}

async function stage(rootPath, files) {
  if (!Array.isArray(files) || files.length === 0) return;
  await get(rootPath).add(files);
}

async function unstage(rootPath, files) {
  if (!Array.isArray(files) || files.length === 0) return;
  /* git reset HEAD -- <files>. Pass the file array to simple-git's reset. */
  await get(rootPath).reset(['HEAD', '--', ...files]);
}

async function discard(rootPath, files, untracked = false) {
  if (!Array.isArray(files) || files.length === 0) return;
  if (untracked) {
    /* untracked files are deleted directly from the file system (permanent, no trash). */
    for (const rel of files) {
      try {
        await fs.unlink(path.join(rootPath, rel));
      } catch {
        /* ignore if it's a directory or already gone */
      }
    }
  } else {
    await get(rootPath).checkout(['--', ...files]);
  }
}

async function commit(rootPath, message, options = {}) {
  if (!message && !options.amend) {
    const err = new Error('empty commit message');
    err.code = 'EMPTY_MESSAGE';
    throw err;
  }
  const opts = {};
  if (options.amend) opts['--amend'] = null;
  return get(rootPath).commit(message || '', undefined, opts);
}

async function push(rootPath) {
  return get(rootPath).push();
}

async function pull(rootPath) {
  return get(rootPath).pull();
}

async function sync(rootPath) {
  /* pull first, then push. On conflict, pull throws → renderer notifies and stops. */
  await pull(rootPath);
  await push(rootPath);
}

/* Return a single-file diff (HEAD vs working tree) as a list of unified diff hunks.
   Each hunk has newStart/newLines/oldStart/oldLines + a per-line type ('add'|'del'|'context'). */
async function undoLastCommit(rootPath) {
  /* --soft: move HEAD back one step only. Changes stay staged. */
  return get(rootPath).reset(['--soft', 'HEAD~1']);
}

async function fetch(rootPath) {
  return get(rootPath).fetch();
}

async function getDiff(rootPath, file) {
  if (!file) return { hunks: [] };
  if (!(await isRepo(rootPath))) return { hunks: [] };
  let raw;
  try {
    /* --no-color: plain unified diff without ANSI codes. path follows --. */
    raw = await get(rootPath).diff(['--no-color', '--', file]);
  } catch {
    return { hunks: [] };
  }
  return parseUnifiedDiff(raw);
}

/* Recent commit list (for the history panel). message=subject (first line), date=author ISO. */
async function log(rootPath, limit = 20) {
  if (!(await isRepo(rootPath))) return [];
  let res;
  try {
    res = await get(rootPath).log({ maxCount: Number(limit) || 20 });
  } catch {
    return [];
  }
  return (res.all || []).map((c) => ({
    hash: c.hash,
    shortHash: String(c.hash || '').slice(0, 7),
    message: c.message || '',
    author: c.author_name || '',
    date: c.date || ''
  }));
}

module.exports = { isRepo, getStatus, stage, unstage, discard, commit, push, pull, sync, getDiff, undoLastCommit, fetch, log };
