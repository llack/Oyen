import iconEye from '@tabler/icons/outline/eye.svg?raw';
import iconEyeOff from '@tabler/icons/outline/eye-off.svg?raw';
import iconCopy from '@tabler/icons/outline/copy.svg?raw';
import iconCheck from '@tabler/icons/outline/check.svg?raw';
import iconDice from '@tabler/icons/outline/dice-5.svg?raw';
import iconHelp from '@tabler/icons/outline/help-circle.svg?raw';
import { friendlyConnectError } from './dialogs.js';
import { t } from './i18n.js';

const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Generate a random quick-open key. 32-char alphabet with confusable chars (I/O/0/1) removed — 256%32=0, so no modulo bias. */
function genApiKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(12);
  (window.crypto || crypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/* Password input + reveal toggle (eye) button. Linked to its input via data-pw-toggle. */
const pwField = (id) => `
  <div class="pw-field">
    <input id="${id}" class="confirm-input" type="password" autocomplete="new-password" />
    <button type="button" class="pw-toggle" data-pw-toggle="${id}" aria-label="${t('site.btn.togglePassword')}" tabindex="-1">${iconEye}</button>
  </div>`;

/* Connection test — step logs stream into a dark mono panel, then show success/failure when done. */
function connectionTestDialog(profile, secret) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    backdrop.innerHTML = `
      <section class="confirm-dialog large conn-test" role="dialog" aria-modal="true" aria-label="${esc(t('site.test.title'))}">
        <div class="confirm-title">${t('site.test.title')}</div>
        <div class="conn-log" id="connTestLog" aria-live="polite"></div>
        <div class="conn-status running" id="connTestStatus">${esc(t('site.test.running'))}</div>
        <div class="confirm-actions">
          <button class="confirm-btn" data-act="copy" disabled>${t('site.test.copyLog')}</button>
          <button class="confirm-btn primary" data-confirm="ok" disabled>${t('dlg.close')}</button>
        </div>
      </section>
    `;
    const logEl = backdrop.querySelector('#connTestLog');
    const statusEl = backdrop.querySelector('#connTestStatus');
    const okBtn = backdrop.querySelector('[data-confirm="ok"]');
    const copyBtn = backdrop.querySelector('[data-act="copy"]');

    copyBtn.addEventListener('click', async () => {
      if (copyBtn.disabled) return;
      const text = [...logEl.querySelectorAll('.conn-log-line')].map((el) => el.textContent).join('\n');
      try { await navigator.clipboard?.writeText(text); } catch (_) {}
      const orig = copyBtn.textContent;
      copyBtn.textContent = '✓';
      setTimeout(() => { copyBtn.textContent = orig; }, 1200);  /* copy feedback (intentional UX delay) */
    });

    const append = (line) => {
      const div = document.createElement('div');
      div.className = 'conn-log-line';
      div.textContent = line;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    };

    let unsub = null;
    try { unsub = window.oyen?.remote?.onTestLog?.((p) => { if (p?.line) append(p.line); }); } catch (_) {}

    const close = () => {
      if (okBtn.disabled) return;  // can't close while still in progress
      try { unsub?.(); } catch {}
      backdrop.remove();
      window.removeEventListener('keydown', onKey);
      resolve();
    };
    const onKey = (event) => {
      if ((event.key === 'Escape' || event.key === 'Enter') && !okBtn.disabled) { event.preventDefault(); close(); }
    };
    okBtn.addEventListener('click', close);
    document.body.appendChild(backdrop);
    window.addEventListener('keydown', onKey);

    (async () => {
      let result;
      try { result = await window.oyen.remote.testConnection(profile, secret); }
      catch (err) { result = { ok: false, message: err?.message || String(err) }; }
      try { unsub?.(); unsub = null; } catch {}
      const okFlag = !!result?.ok;
      /* Cap the log with a clear closing line — a sense of "done". */
      const done = document.createElement('div');
      done.className = `conn-log-line conn-log-done ${okFlag ? 'ok' : 'fail'}`;
      done.textContent = okFlag ? '──────── ✓ Connected ────────' : '──────── ✗ Connection failed ────────';
      logEl.appendChild(done);
      logEl.scrollTop = logEl.scrollHeight;
      /* Status line — mark + message. */
      statusEl.className = `conn-status ${okFlag ? 'ok' : 'fail'}`;
      const text = okFlag ? (result.message || t('site.test.success')) : friendlyConnectError(result?.message);
      statusEl.innerHTML = `<span class="conn-status-mark">${okFlag ? '✓' : '✗'}</span><span>${esc(text)}</span>`;
      copyBtn.disabled = false;
      okBtn.disabled = false;
      okBtn.focus();
    })();
  });
}

export function editRemoteProfileDialog(initial = null, options = {}) {
  const isEdit = !!initial;
  const keyInfo = options.keyInfo || { dir: '~/.ssh', filenames: ['id_ed25519', 'id_rsa', 'id_ecdsa'] };
  /* Quick-open keys already used by other servers — block saving duplicates (the key identifies the profile, so it must be unique). */
  const takenApiKeys = (options.takenApiKeys || []).map((k) => String(k).trim()).filter(Boolean);
  const seed = initial || {
    type: 'sftp',
    name: '',
    host: '',
    port: 22,
    username: '',
    authType: 'password',
    privateKeyPath: '',
    secure: false,
    defaultPath: '',
    os: 'linux',
    apiKey: ''
  };

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    backdrop.innerHTML = `
      <section class="confirm-dialog large" role="dialog" aria-modal="true" aria-label="${isEdit ? t('site.titleEdit') : t('site.titleAdd')}">
        <div class="confirm-title">${isEdit ? t('site.titleEdit') : t('site.titleAdd')}</div>

        <div class="remote-protocol-tabs" role="tablist">
          <button class="remote-protocol-tab" data-proto="sftp" role="tab">SFTP</button>
          <button class="remote-protocol-tab" data-proto="ftp" role="tab">FTP</button>
        </div>
        <select id="rfType" hidden>
          <option value="sftp">SFTP</option>
          <option value="ftp">FTP</option>
        </select>

        <div class="remote-form">
          <label id="rfOsLabel">${t('site.field.os')}</label>
          <div class="remote-os-options" id="rfOsOptions">
            <label class="remote-auth-option"><input type="radio" name="rfOs" value="linux" /><span>Linux</span></label>
            <label class="remote-auth-option"><input type="radio" name="rfOs" value="windows" /><span>Windows</span></label>
            <label class="remote-auth-option"><input type="radio" name="rfOs" value="mac" /><span>macOS</span></label>
          </div>

          <label for="rfName">${t('site.field.label')}</label>
          <input id="rfName" class="confirm-input" type="text" autocomplete="off" spellcheck="false" />

          <div class="apikey-head">
            <label for="rfApiKey">${t('site.field.apiKey')}</label>
            <button type="button" class="apikey-help-btn" id="rfApiKeyHelp" aria-label="${esc(t('site.apiKey.helpAria'))}" aria-expanded="false" tabindex="-1">${iconHelp}</button>
          </div>
          <div class="apikey-field">
            <input id="rfApiKey" class="confirm-input" type="text" autocomplete="off" spellcheck="false" placeholder="${esc(t('site.apiKey.placeholder'))}" />
            <button type="button" class="apikey-icon-btn apikey-copy" id="rfApiKeyCopy" aria-label="${esc(t('site.btn.copyKey'))}" tabindex="-1">${iconCopy}</button>
            <button type="button" class="apikey-icon-btn apikey-gen" id="rfApiKeyGen" aria-label="${esc(t('site.btn.generateKey'))}" tabindex="-1">${iconDice}</button>
          </div>
          <div class="apikey-help full" id="rfApiKeyHelpBox" hidden>
            <div class="apikey-url-head">
              <span>${t('site.apiKey.urlHint')}</span>
              <button type="button" class="apikey-url-copy" id="rfApiKeyUrlCopy" aria-label="${esc(t('site.btn.copyUrl'))}" tabindex="-1">${iconCopy}</button>
            </div>
            <code id="rfApiKeyUrl"></code>
          </div>

          <label for="rfHost">${t('site.field.host')}</label>
          <div class="remote-row-pair">
            <input id="rfHost" class="confirm-input" type="text" autocomplete="off" spellcheck="false" />
            <span class="remote-port-label">${t('site.field.port')}</span>
            <input id="rfPort" class="confirm-input" type="text" inputmode="numeric" maxlength="5" autocomplete="off" />
          </div>

          <label for="rfUser">${t('site.field.user')}</label>
          <input id="rfUser" class="confirm-input" type="text" autocomplete="off" spellcheck="false" />

          <label id="rfAuthLabel" for="rfAuthOptions">${t('site.field.auth')}</label>
          <select class="confirm-input" id="rfAuthOptions"></select>

          <label id="rfPwLabel" for="rfPassword">${t('site.field.password')}</label>
          ${pwField('rfPassword')}

          <label id="rfPemLabel" for="rfPem">${t('site.field.keyFile')}</label>
          <div class="remote-pem-row">
            <input id="rfPem" class="confirm-input" type="text" autocomplete="off" spellcheck="false" placeholder="PEM / OpenSSH / PuTTY(.ppk)" />
            <button class="confirm-btn" id="rfPemPick">${t('site.btn.browse')}</button>
          </div>

          <label id="rfPassLabel" for="rfPassphrase">${t('site.field.passphrase')}</label>
          ${pwField('rfPassphrase')}

          <label id="rfTlsLabel" for="rfSecure">${t('site.field.encryption')}</label>
          <label id="rfTlsCheck" for="rfSecure" style="display: flex; align-items: center; gap: 6px;">
            <input id="rfSecure" type="checkbox" />
            <span>FTPS (TLS)</span>
          </label>

          <label id="rfJumpToggleLabel" for="rfJumpEnable">${t('site.field.jump')}</label>
          <label id="rfJumpCheck" for="rfJumpEnable" style="display: flex; align-items: center; gap: 6px;">
            <input id="rfJumpEnable" type="checkbox" />
            <span>${t('site.jump.enable')}</span>
          </label>

          <div id="rfJumpFields" class="remote-jump-fields">
            <label for="rfJumpHost">${t('site.field.host')}</label>
            <div class="remote-row-pair">
              <input id="rfJumpHost" class="confirm-input" type="text" autocomplete="off" spellcheck="false" />
              <span class="remote-port-label">${t('site.field.port')}</span>
              <input id="rfJumpPort" class="confirm-input" type="text" inputmode="numeric" maxlength="5" autocomplete="off" placeholder="22" />
            </div>

            <label for="rfJumpUser">${t('site.field.user')}</label>
            <input id="rfJumpUser" class="confirm-input" type="text" autocomplete="off" spellcheck="false" />

            <label for="rfJumpAuth">${t('site.field.auth')}</label>
            <select id="rfJumpAuth" class="confirm-input">
              <option value="password">${t('site.auth.password')}</option>
              <option value="private-key-auto">${t('site.auth.savedKey', { dir: keyInfo.dir })}</option>
              <option value="private-key-pem">${t('site.auth.loadKey')}</option>
            </select>

            <label id="rfJumpPwLabel" for="rfJumpPassword">${t('site.field.password')}</label>
            ${pwField('rfJumpPassword')}

            <label id="rfJumpPemLabel" for="rfJumpPem">${t('site.field.keyFile')}</label>
            <div class="remote-pem-row">
              <input id="rfJumpPem" class="confirm-input" type="text" autocomplete="off" spellcheck="false" placeholder="PEM / OpenSSH / PuTTY(.ppk)" />
              <button class="confirm-btn" id="rfJumpPemPick">${t('site.btn.browse')}</button>
            </div>

            <label id="rfJumpPassLabel" for="rfJumpPassphrase">${t('site.field.passphrase')}</label>
            ${pwField('rfJumpPassphrase')}
          </div>
        </div>

        <div class="remote-error" id="rfError"></div>

        <div class="confirm-actions">
          <button class="confirm-btn" data-confirm="cancel">${t('dlg.cancel')}</button>
          <button class="confirm-btn" id="rfTest">${t('site.btn.test')}</button>
          <button class="confirm-btn primary" data-confirm="ok">${t('dlg.save')}</button>
        </div>
      </section>
    `;

    const $ = (id) => backdrop.querySelector(`#${id}`);
    const nameEl = $('rfName');
    const apiKeyEl = $('rfApiKey');
    const apiKeyField = backdrop.querySelector('.apikey-field');
    const apiKeyCopyBtn = $('rfApiKeyCopy');
    const apiKeyUrlEl = $('rfApiKeyUrl');
    /* Show the copy icon only when there's a value, and reflect the actual key into the quick-open URL example in real time. */
    const refreshApiKeyState = () => {
      const key = apiKeyEl.value.trim();
      apiKeyField.classList.toggle('has-value', !!key);
      apiKeyUrlEl.textContent = `oyen-quick://open?key=${key || '<key>'}&path=/var/www/html/index.php`;
    };
    const typeEl = $('rfType');
    const hostEl = $('rfHost');
    const portEl = $('rfPort');
    const userEl = $('rfUser');
    const authOptionsEl = $('rfAuthOptions');
    const pwEl = $('rfPassword');
    const pemEl = $('rfPem');
    const pemPickBtn = $('rfPemPick');
    const passEl = $('rfPassphrase');
    const secureEl = $('rfSecure');
    const osOptionsEl = $('rfOsOptions');
    const jumpEnableEl = $('rfJumpEnable');
    const getOs = () => osOptionsEl.querySelector('input:checked')?.value || 'linux';
    const jumpHostEl = $('rfJumpHost');
    const jumpPortEl = $('rfJumpPort');
    const jumpUserEl = $('rfJumpUser');
    const jumpAuthEl = $('rfJumpAuth');
    const jumpPwEl = $('rfJumpPassword');
    const jumpPemEl = $('rfJumpPem');
    const jumpPemPickBtn = $('rfJumpPemPick');
    const jumpPassEl = $('rfJumpPassphrase');
    const testBtn = $('rfTest');
    const errorEl = $('rfError');

    nameEl.value = seed.name || '';
    apiKeyEl.value = seed.apiKey || '';
    refreshApiKeyState();
    typeEl.value = seed.type === 'ftp' ? 'ftp' : 'sftp';
    hostEl.value = seed.host || '';
    portEl.placeholder = String(typeEl.value === 'sftp' ? 22 : 21);
    portEl.value = isEdit ? (seed.port || '') : '';
    userEl.value = seed.username || '';
    pemEl.value = seed.privateKeyPath || '';
    secureEl.checked = !!seed.secure;
    const seedOs = ['windows', 'mac'].includes(seed.os) ? seed.os : 'linux';
    osOptionsEl.querySelector(`input[value="${seedOs}"]`).checked = true;

    const seedJump = seed.jump || null;
    jumpEnableEl.checked = !!(seedJump && seedJump.host);
    jumpHostEl.value = seedJump?.host || '';
    jumpPortEl.value = seedJump?.port ? String(seedJump.port) : '';
    jumpUserEl.value = seedJump?.username || '';
    jumpAuthEl.value = ['private-key-auto', 'private-key-pem'].includes(seedJump?.authType) ? seedJump.authType : 'password';
    jumpPemEl.value = seedJump?.privateKeyPath || '';

    // Reload stored password/passphrase — only in edit mode and when on the original protocol.
    // Split into a function so it can refill after switching back from another protocol.
    function reloadStoredSecrets() {
      if (!isEdit || typeEl.value !== seed.type) return;
      if (!seed.id || !window.oyen?.remote?.getSecret) return;
      window.oyen.remote.getSecret(seed.id).then((s) => {
        if (typeEl.value !== seed.type) return; // skip if switched again before the response arrived
        if (s?.password && !pwEl.value) pwEl.value = s.password;
        if (s?.passphrase && !passEl.value) passEl.value = s.passphrase;
        if (s?.jumpPassword && !jumpPwEl.value) jumpPwEl.value = s.jumpPassword;
        if (s?.jumpPassphrase && !jumpPassEl.value) jumpPassEl.value = s.jumpPassphrase;
      }).catch(() => {});
    }
    reloadStoredSecrets();

    function authChoices() {
      if (typeEl.value === 'sftp') {
        return [
          { value: 'password', label: t('site.auth.password') },
          { value: 'private-key-auto', label: t('site.auth.savedKey', { dir: keyInfo.dir }) },
          { value: 'private-key-pem', label: t('site.auth.loadKey') }
        ];
      }
      return [{ value: 'password', label: t('site.auth.password') }];
    }

    function renderAuth() {
      const choices = authChoices();
      const prev = seed.authType;
      authOptionsEl.innerHTML = choices.map((c) => `<option value="${c.value}">${c.label}</option>`).join('');
      if (choices.some((c) => c.value === prev)) {
        authOptionsEl.value = prev;
      } else {
        authOptionsEl.value = choices[0]?.value || 'password';
        seed.authType = authOptionsEl.value;
      }
    }

    function getAuth() {
      return authOptionsEl.value || 'password';
    }

    function updateFieldVisibility() {
      errorEl.textContent = '';
      const auth = getAuth();
      const isSftp = typeEl.value === 'sftp';
      const showPw = auth === 'password';
      const showPem = isSftp && auth === 'private-key-pem';
      const showPass = isSftp && auth === 'private-key-pem';
      const showTls = !isSftp;

      $('rfPwLabel').style.display = showPw ? '' : 'none';
      pwEl.parentElement.style.display = showPw ? '' : 'none';
      if (!showPw) pwEl.value = '';
      $('rfPemLabel').style.display = showPem ? '' : 'none';
      pemEl.parentElement.style.display = showPem ? '' : 'none';
      if (!showPem) pemEl.value = '';
      $('rfPassLabel').style.display = showPass ? '' : 'none';
      passEl.parentElement.style.display = showPass ? '' : 'none';
      if (!showPass) passEl.value = '';
      $('rfTlsLabel').style.display = showTls ? '' : 'none';
      $('rfTlsCheck').style.display = showTls ? 'flex' : 'none';
      /* FTP only supports password auth → hide the auth radios (only SFTP has choices). */
      $('rfAuthLabel').style.display = isSftp ? '' : 'none';
      authOptionsEl.style.display = isSftp ? '' : 'none';
      /* OS selection is SFTP-only (for detecting Unix permissions like chmod). Meaningless for FTP. */
      $('rfOsLabel').style.display = isSftp ? '' : 'none';
      osOptionsEl.style.display = isSftp ? '' : 'none';

      /* Jump host (proxy) — SFTP-only. Show the inner fields only when the toggle is on. */
      $('rfJumpToggleLabel').style.display = isSftp ? '' : 'none';
      $('rfJumpCheck').style.display = isSftp ? 'flex' : 'none';
      const showJump = isSftp && jumpEnableEl.checked;
      const jumpFields = $('rfJumpFields');
      jumpFields.style.display = showJump ? '' : 'none';
      if (showJump) {
        const jumpPw = jumpAuthEl.value === 'password';
        const jumpPem = jumpAuthEl.value === 'private-key-pem';
        $('rfJumpPwLabel').style.display = jumpPw ? '' : 'none';
        jumpPwEl.parentElement.style.display = jumpPw ? '' : 'none';
        $('rfJumpPemLabel').style.display = jumpPem ? '' : 'none';
        jumpPemEl.parentElement.style.display = jumpPem ? '' : 'none';
        $('rfJumpPassLabel').style.display = jumpPem ? '' : 'none';
        jumpPassEl.parentElement.style.display = jumpPem ? '' : 'none';
      }
    }

    function updateProtocolTabs() {
      backdrop.querySelectorAll('.remote-protocol-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.proto === typeEl.value);
      });
    }

    backdrop.querySelectorAll('.remote-protocol-tab').forEach((tab) => {
      tab.addEventListener('click', (event) => {
        event.preventDefault();
        if (typeEl.value === tab.dataset.proto) return;
        typeEl.value = tab.dataset.proto;
        typeEl.dispatchEvent(new Event('change'));
      });
    });

    // Remember the last authType per protocol (FTP allows password only, SFTP also allows key auth)
    let lastSftpAuth = seed.type === 'sftp' ? (seed.authType || 'password') : 'password';
    typeEl.addEventListener('change', () => {
      // Password/passphrase/key path are protocol-specific → always clear (avoid confusion)
      pwEl.value = '';
      passEl.value = '';
      pemEl.value = '';

      if (typeEl.value === 'sftp') {
        seed.authType = lastSftpAuth;
        if (!isEdit) portEl.value = '';
      } else if (typeEl.value === 'ftp') {
        const cur = getAuth();
        if (cur !== 'password') lastSftpAuth = cur;
        seed.authType = 'password';
        if (!isEdit) portEl.value = '';
      }
      portEl.placeholder = String(typeEl.value === 'sftp' ? 22 : 21);
      errorEl.textContent = '';
      renderAuth();
      updateFieldVisibility();
      updateProtocolTabs();
      // If we returned to the original protocol, refill the stored password/passphrase + privateKeyPath
      if (isEdit && typeEl.value === seed.type) {
        pemEl.value = seed.privateKeyPath || '';
        reloadStoredSecrets();
      }
    });

    portEl.addEventListener('input', () => {
      const cleaned = portEl.value.replace(/[^0-9]/g, '');
      if (cleaned !== portEl.value) portEl.value = cleaned;
    });

    /* Identifier fields that never contain spaces — strip leading/trailing whitespace live (avoids paste footguns).
       Passwords/passphrases may contain inner spaces → no live trim, only trim on save (collectSecret). */
    [hostEl, userEl, jumpHostEl, jumpUserEl].forEach((el) => {
      el.addEventListener('input', () => {
        const stripped = el.value.replace(/^\s+|\s+$/g, '');
        if (stripped !== el.value) el.value = stripped;
      });
    });

    pemPickBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        const result = await window.oyen?.localFs?.pickFile?.({
          title: t('site.picker.privateKey'),
          filters: [{ name: 'PEM/Key', extensions: ['pem', 'key', 'ppk', '*'] }]
        });
        if (result?.ok && result.path) pemEl.value = result.path;
      } catch (_) {}
    });

    authOptionsEl.addEventListener('change', () => { seed.authType = authOptionsEl.value; updateFieldVisibility(); });
    jumpEnableEl.addEventListener('change', updateFieldVisibility);
    jumpAuthEl.addEventListener('change', updateFieldVisibility);
    jumpPortEl.addEventListener('input', () => {
      const cleaned = jumpPortEl.value.replace(/[^0-9]/g, '');
      if (cleaned !== jumpPortEl.value) jumpPortEl.value = cleaned;
    });
    jumpPemPickBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        const result = await window.oyen?.localFs?.pickFile?.({
          title: t('site.picker.privateKey'),
          filters: [{ name: 'PEM/Key', extensions: ['pem', 'key', 'ppk', '*'] }]
        });
        if (result?.ok && result.path) jumpPemEl.value = result.path;
      } catch (_) {}
    });

    /* Password reveal toggle (eye) — switch input type + swap the icon. */
    backdrop.querySelectorAll('[data-pw-toggle]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        const input = $(btn.dataset.pwToggle);
        if (!input) return;
        const reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        btn.innerHTML = reveal ? iconEyeOff : iconEye;
      });
    });

    /* Quick-open key — random generate / copy only when there's a value / help toggle. */
    apiKeyEl.addEventListener('input', refreshApiKeyState);
    $('rfApiKeyGen').addEventListener('click', (event) => {
      event.preventDefault();
      apiKeyEl.value = genApiKey();
      refreshApiKeyState();
    });
    apiKeyCopyBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      const value = apiKeyEl.value.trim();
      if (!value) return;
      try { await window.oyen?.clipboard?.writeText?.(value); } catch (_) {}
      apiKeyCopyBtn.innerHTML = iconCheck;
      apiKeyCopyBtn.classList.add('copied');
      setTimeout(() => { apiKeyCopyBtn.innerHTML = iconCopy; apiKeyCopyBtn.classList.remove('copied'); }, 1200);  /* copy feedback (intentional UX delay) */
    });
    const apiKeyHelpBtn = $('rfApiKeyHelp');
    const apiKeyHelpBox = $('rfApiKeyHelpBox');
    apiKeyHelpBtn.addEventListener('click', (event) => {
      event.preventDefault();
      const show = apiKeyHelpBox.hidden;
      apiKeyHelpBox.hidden = !show;
      apiKeyHelpBtn.setAttribute('aria-expanded', String(show));
    });
    $('rfApiKeyUrlCopy').addEventListener('click', async (event) => {
      event.preventDefault();
      /* event.currentTarget is reset to null after await → capture the button before awaiting. */
      const btn = event.currentTarget;
      try { await window.oyen?.clipboard?.writeText?.(apiKeyUrlEl.textContent); } catch (_) {}
      btn.innerHTML = iconCheck;
      btn.classList.add('copied');
      setTimeout(() => { btn.innerHTML = iconCopy; btn.classList.remove('copied'); }, 1200);  /* copy feedback (intentional UX delay) */
    });

    /* Jump host applies only with SFTP + toggle ON + a host entered. Otherwise null (removed from the profile). */
    function jumpEnabled() {
      return typeEl.value === 'sftp' && jumpEnableEl.checked && !!jumpHostEl.value.trim();
    }

    function collectProfile() {
      const profile = {
        id: seed.id || (window.crypto?.randomUUID?.() ?? `r${Date.now()}`),
        type: typeEl.value,
        name: nameEl.value.trim(),
        host: hostEl.value.trim(),
        port: Number(portEl.value) || (typeEl.value === 'sftp' ? 22 : 21),
        username: userEl.value.trim(),
        authType: getAuth(),
        privateKeyPath: pemEl.value.trim(),
        secure: !!secureEl.checked,
        defaultPath: seed.defaultPath || '',
        os: getOs(),
        apiKey: apiKeyEl.value.trim()
      };
      profile.jump = jumpEnabled() ? {
        host: jumpHostEl.value.trim(),
        port: Number(jumpPortEl.value) || 22,
        username: jumpUserEl.value.trim(),
        authType: ['private-key-auto', 'private-key-pem'].includes(jumpAuthEl.value) ? jumpAuthEl.value : 'password',
        privateKeyPath: jumpPemEl.value.trim()
      } : null;
      return profile;
    }

    function collectSecret() {
      const auth = getAuth();
      /* Strip leading/trailing whitespace from password/passphrase (prevents auth failures from spaces/newlines dragged in on paste). Inner spaces are preserved. */
      const trimEdge = (v) => String(v || '').replace(/^\s+|\s+$/g, '');
      const out = {};
      if (auth === 'password') out.password = trimEdge(pwEl.value);
      if (auth === 'private-key-pem') out.passphrase = trimEdge(passEl.value);
      if (jumpEnabled()) {
        if (jumpAuthEl.value === 'password') out.jumpPassword = trimEdge(jumpPwEl.value);
        else if (jumpAuthEl.value === 'private-key-pem') out.jumpPassphrase = trimEdge(jumpPassEl.value);
      }
      return out;
    }

    function setError(msg) {
      errorEl.textContent = msg || '';
    }

    function validate(profile, secret) {
      if (!profile.name) return t('site.error.label');
      if (!profile.host) return t('site.error.host');
      if (profile.apiKey && takenApiKeys.includes(profile.apiKey)) return t('site.error.apiKeyDup');
      if (profile.type === 'sftp') {
        if (profile.authType === 'password' && !secret.password) return t('site.error.password');
        if (profile.authType === 'private-key-pem' && !profile.privateKeyPath) return t('site.error.keyFile');
      }
      if (profile.type === 'ftp' && !secret.password) return t('site.error.password');
      if (typeEl.value === 'sftp' && jumpEnableEl.checked) {
        if (!jumpHostEl.value.trim()) return t('site.error.jumpHost');
        if (jumpAuthEl.value === 'private-key-pem' && !jumpPemEl.value.trim()) return t('site.error.jumpKeyFile');
      }
      return '';
    }

    function validateForTest(profile, secret) {
      return validate(profile, secret);
    }

    const saveBtn = backdrop.querySelector('[data-confirm="ok"]');
    let testOpen = false;  /* ignore edit-dialog key input while the test log modal is up */
    testBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      setError('');
      const profile = collectProfile();
      const secret = collectSecret();
      const v = validateForTest(profile, secret);
      if (v) { setError(v); return; }
      testOpen = true;
      testBtn.disabled = true;
      try {
        await connectionTestDialog(profile, secret);
      } finally {
        testOpen = false;
        testBtn.disabled = false;
      }
    });

    const close = (value) => {
      backdrop.remove();
      window.removeEventListener('keydown', onKeyDown);
      resolve(value);
    };

    const submit = () => {
      setError('');
      const profile = collectProfile();
      const secret = collectSecret();
      const v = validate(profile, secret);
      if (v) { setError(v); return; }
      close({ profile, secret });
    };

    const onKeyDown = (event) => {
      if (testOpen) return;  /* if the test log modal is on top, let it handle this */
      if (event.key === 'Escape') { event.preventDefault(); close(null); }
      /* No save/close on Enter — fixed an issue where the window closed by accident while typing. Save only via the [Save] button. */
    };

    backdrop.addEventListener('click', (event) => {
      const button = event.target.closest('[data-confirm]');
      if (!button) return;
      if (button.dataset.confirm === 'ok') submit();
      else close(null);
    });

    document.body.appendChild(backdrop);
    renderAuth();
    updateFieldVisibility();
    updateProtocolTabs();
    nameEl.focus();
    window.addEventListener('keydown', onKeyDown);
  });
}
