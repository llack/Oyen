// Secrets (password/privateKey/passphrase) should live in OS keychain via keytar later.
// This placeholder keeps storage concerns isolated for easy migration.

async function saveSecret(profileId, secretPayload) {
  return { profileId, saved: false, reason: 'keytar-not-wired' };
}

async function loadSecret(profileId) {
  return { profileId, secret: null, reason: 'keytar-not-wired' };
}

module.exports = {
  saveSecret,
  loadSecret
};
