const local = require('./local-provider');
const sftp = require('./sftp-provider');
const ftp = require('./ftp-provider');

function isRemote(p) {
  return sftp.isUri(p) || ftp.isUri(p);
}

function dispatch(p) {
  if (sftp.isUri(p)) return sftp;
  if (ftp.isUri(p)) return ftp;
  return local;
}

function disposeAll() {
  try { sftp.disconnectAll(); } catch {}
  try { ftp.disconnectAll(); } catch {}
}

module.exports = { dispatch, isRemote, local, sftp, ftp, disposeAll };
