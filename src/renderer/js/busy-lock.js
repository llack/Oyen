let counter = 0;
let spinnerEl = null;

function ensureSpinner() {
  if (spinnerEl) return;
  const wrap = document.createElement('div');
  wrap.id = 'busy-spinner-wrap';
  wrap.innerHTML = '<div class="busy-spinner-inner"></div>';
  document.body.appendChild(wrap);
  spinnerEl = wrap;
  document.addEventListener('mousemove', (event) => {
    if (!spinnerEl) return;
    spinnerEl.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
  });
}

export function isBusy() {
  return counter > 0;
}

export function beginBusy() {
  counter += 1;
  if (counter === 1) {
    ensureSpinner();
    document.body.classList.add('is-busy');
  }
}

export function endBusy() {
  if (counter <= 0) return;
  counter -= 1;
  if (counter === 0) document.body.classList.remove('is-busy');
}

export async function runBusy(fn) {
  beginBusy();
  try {
    return await fn();
  } finally {
    endBusy();
  }
}
