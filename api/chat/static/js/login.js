const DEBUG_POPUPS_STICKY = false;

const API_BASE = '/api/chat';
const AUTH_STORAGE_KEY = 'chatadmin_auth_token';
const CLIENT_ID_KEY = 'chat_client_id';
const LOCK_STORAGE_KEY = 'chatadmin_lock_until';
const AUTH_MODE_KEY = 'chatadmin_auth_mode';

const ENDPOINTS = {
  login: '/login-user',
  signup: '/register',
  reset: '/reset-password',
  confirm_reset: '/confirm-reset'
};

const state = { 
  token: localStorage.getItem(AUTH_STORAGE_KEY) || '', 
  clientId: localStorage.getItem(CLIENT_ID_KEY) || 'default',
  loading: false, 
  resetToken: new URLSearchParams(window.location.search).get('reset_token'),
  authMode: new URLSearchParams(window.location.search).get('reset_token') ? 'set_new_password' : 
            (document.body.dataset.verifySuccess === 'true' ? 'verified' : 
            (document.body.dataset.verifyError === 'true' ? 'verify_error' : 
            (document.body.dataset.authMode ||
            (new URLSearchParams(window.location.search).get('mode') === 'reset' ? 'reset' :
            (sessionStorage.getItem(AUTH_MODE_KEY) || 'login'))))),
  registeredEmail: '',
  loginAttempts: 0
};

function $(selector, root = document) { return root.querySelector(selector); }
function escapeHtml(str) { return (str || '').replace(/[&<>"']/g, (c) => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c])); }

function setAuthMode(mode) {
  state.authMode = mode;
  sessionStorage.setItem(AUTH_MODE_KEY, mode);
  const urlMap = { login: '/login', signup: '/register', reset: '/reset' };
  const newUrl = urlMap[mode];
  if (newUrl && window.location.pathname !== newUrl) {
    history.pushState(null, '', newUrl);
  }
}
function isLocked() { return Date.now() < Number(localStorage.getItem(LOCK_STORAGE_KEY) || 0); }

function cloneTemplate(id) {
  const tmpl = document.getElementById(id);
  return tmpl ? document.importNode(tmpl.content, true) : null;
}

function renderAuthScreen() {
  const mode = state.authMode;
  
  document.body.className = '';
  if (isLocked()) {
    document.body.classList.add('is-locked');
    return cloneTemplate('tmpl-lock');
  }
  
  if (mode === 'confirm') document.body.classList.add('login-confirm');
  else if (mode === 'verified') document.body.classList.add('login-success');
  else if (mode === 'verify_error') document.body.classList.add('login-error');
  else if (state.loading) document.body.classList.add('login-loading');

  if (mode === 'confirm') {
    const frag = cloneTemplate('tmpl-confirm');
    const emailEl = frag.querySelector('.welcome-msg__email');
    if (emailEl) emailEl.textContent = state.registeredEmail;
    return frag;
  }

  if (mode === 'verified') {
    const frag = cloneTemplate('tmpl-message');
    const title = frag.querySelector('.welcome-msg__title');
    if (title) { title.textContent = 'Вы зарегистрированы'; }
    return frag;
  }

  if (mode === 'verify_error') {
    const frag = cloneTemplate('tmpl-message');
    const title = frag.querySelector('.welcome-msg__title');
    if (title) { title.textContent = 'Ссылка недействительна'; title.classList.add('welcome-msg__title--error'); }
    return frag;
  }

  const templateMap = { 
    signup: 'tmpl-signup', 
    reset: 'tmpl-reset', 
    login: 'tmpl-login',
    set_new_password: 'tmpl-set-new-password'
  };
  return cloneTemplate(templateMap[mode] || 'tmpl-login');
}

function showErrorScreen(message) {
  const app = $('#app');
  document.body.classList.add('login-error');
  const frag = cloneTemplate('tmpl-message');
  const title = frag.querySelector('.welcome-msg__title');
  if (title) title.textContent = message;
  app.innerHTML = '';
  app.appendChild(frag);
  if (!DEBUG_POPUPS_STICKY) {
    setTimeout(() => {
      document.body.classList.remove('login-error');
      state.loading = false;
      renderApp();
    }, 2000);
  }
}

async function attemptLogin(e) {
  if (e) e.preventDefault();
  const mode = state.authMode;
  let payload = {};
  let endpoint = '';

  const container = $('.auth-screen');
  const submitBtn = container ? container.querySelector('.auth-submit') : null;
  const originalBtnText = submitBtn ? submitBtn.innerText : '';

  if (submitBtn) {
    submitBtn.innerText = 'Отправка...';
    submitBtn.disabled = true;
  }

  state.loading = true;

  if (mode === 'login') {
    const email = $('#login-email')?.value.trim();
    const password = $('#login-password')?.value.trim();
    if (!email && !password) {
      if (submitBtn) { submitBtn.innerText = originalBtnText; submitBtn.disabled = false; }
      return showErrorScreen('Введите почту и пароль');
    }
    if (!email) {
      if (submitBtn) { submitBtn.innerText = originalBtnText; submitBtn.disabled = false; }
      return showErrorScreen('Введите почту');
    }
    if (!password) {
      if (submitBtn) { submitBtn.innerText = originalBtnText; submitBtn.disabled = false; }
      return showErrorScreen('Введите пароль');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (submitBtn) { submitBtn.innerText = originalBtnText; submitBtn.disabled = false; }
      return showErrorScreen('Неверный формат почты');
    }
    payload = { email, password };
    endpoint = ENDPOINTS.login;
  } else if (mode === 'signup') {
    const email = $('#signup-email')?.value.trim();
    const password = $('#signup-password')?.value.trim();
    if (!email && !password) {
      if (submitBtn) { submitBtn.innerText = originalBtnText; submitBtn.disabled = false; }
      return showErrorScreen('Введите почту и пароль');
    }
    if (!email) {
      if (submitBtn) { submitBtn.innerText = originalBtnText; submitBtn.disabled = false; }
      return showErrorScreen('Введите почту');
    }
    if (!password) {
      if (submitBtn) { submitBtn.innerText = originalBtnText; submitBtn.disabled = false; }
      return showErrorScreen('Введите пароль');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (submitBtn) { submitBtn.innerText = originalBtnText; submitBtn.disabled = false; }
      return showErrorScreen('Неверный формат почты');
    }
    if (password.length < 6) {
      if (submitBtn) { submitBtn.innerText = originalBtnText; submitBtn.disabled = false; }
      return showErrorScreen('Минимум 6 символов');
    }
    payload = { email, password };
    endpoint = ENDPOINTS.signup;
  } else if (mode === 'reset') {
    const email = $('#reset-email')?.value.trim();
    if (!email) {
      if (submitBtn) { submitBtn.innerText = originalBtnText; submitBtn.disabled = false; }
      return showErrorScreen('Почта обязательна');
    }
    payload = { email };
    endpoint = ENDPOINTS.reset;
  } else if (mode === 'set_new_password') {
    const password = $('#new-password')?.value.trim();
    const confirm = $('#confirm-password')?.value.trim();
    if (!password || password.length < 6) {
      if (submitBtn) { submitBtn.innerText = originalBtnText; submitBtn.disabled = false; }
      return showErrorScreen('Минимум 6 символов');
    }
    if (password !== confirm) {
      if (submitBtn) { submitBtn.innerText = originalBtnText; submitBtn.disabled = false; }
      return showErrorScreen('Пароли не совпадают');
    }
    payload = { token: state.resetToken, password };
    endpoint = ENDPOINTS.confirm_reset;
  }

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok || data.status === 'error') {
      if (submitBtn) {
        submitBtn.innerText = originalBtnText;
        submitBtn.disabled = false;
      }
      
      if (mode === 'login') {
        state.loginAttempts++;
        if (state.loginAttempts >= 5) {
          const lockUntil = Date.now() + 60000;
          localStorage.setItem(LOCK_STORAGE_KEY, lockUntil);
          state.loginAttempts = 0;
          renderApp();
          return;
        }
      }
      
      showErrorScreen(data.detail || data.message || data.error || 'Ошибка');
      return;
    }

    if (mode === 'login') state.loginAttempts = 0;

    if (mode === 'signup') {
      state.loading = false;
      state.registeredEmail = payload.email;
      setAuthMode('confirm');
      renderApp();
    } else if (mode === 'reset') {
      state.loading = false;
      document.body.classList.add('login-success');
      const frag = cloneTemplate('tmpl-message');
      const title = frag.querySelector('.welcome-msg__title');
      if (title) title.textContent = data.message;
      const app = $('#app');
      app.innerHTML = '';
      app.appendChild(frag);
      if (!DEBUG_POPUPS_STICKY) {
        setTimeout(() => { setAuthMode('login'); renderApp(); }, 4000);
      }
    } else if (mode === 'set_new_password') {
      document.body.classList.add('login-success');
      const frag = cloneTemplate('tmpl-message');
      const title = frag.querySelector('.welcome-msg__title');
      if (title) title.textContent = 'Пароль изменен';
      const app = $('#app');
      app.innerHTML = '';
      app.appendChild(frag);
      if (!DEBUG_POPUPS_STICKY) {
        setTimeout(() => { setAuthMode('login'); renderApp(); }, 3000);
      }
    } else {
      localStorage.setItem(AUTH_STORAGE_KEY, data.access_token || data.token || '');
      localStorage.setItem(CLIENT_ID_KEY, data.client_id);
      localStorage.setItem('chat_user_email', payload.email);
      localStorage.setItem('chat_initial_balance', data.balance || 0);
      sessionStorage.clear();
      const keysToRemove = ['chat_user_email', 'chat_initial_balance'];
      keysToRemove.forEach(key => localStorage.removeItem(key));
      document.body.classList.add('login-success');
      const frag = cloneTemplate('tmpl-message');
      const title = frag.querySelector('.welcome-msg__title');
      if (title) title.textContent = 'Добро пожаловать';
      const app = $('#app');
      app.innerHTML = '';
      app.appendChild(frag);
      if (!DEBUG_POPUPS_STICKY) {
        setTimeout(() => { window.location.href = `/admin-v2?client_id=${data.client_id}`; }, 2000);
      }
    }

  } catch (err) {
    if (submitBtn) {
      submitBtn.innerText = originalBtnText;
      submitBtn.disabled = false;
    }
    showErrorScreen('Ошибка сети');
  }
}

async function renderApp() {
  const app = $('#app');
  if (!app) return;

  if (isLocked()) {
    const updateTimer = () => {
      const timerEl = document.getElementById('lock-timer');
      if (!timerEl) return;
      const remaining = Math.ceil((Number(localStorage.getItem(LOCK_STORAGE_KEY)) - Date.now()) / 1000);
      if (remaining <= 0) {
        renderApp();
      } else {
        timerEl.textContent = remaining;
        setTimeout(updateTimer, 1000);
      }
    };
    app.innerHTML = '';
    app.appendChild(renderAuthScreen());
    updateTimer();
    return;
  }

  if (state.authMode === 'set_new_password' && state.resetToken) {
    try {
      const res = await fetch(`${API_BASE}/check-reset-token?token=${state.resetToken}`);
      const data = await res.json();
      if (data.status !== 'success') {
        setAuthMode('reset');
        return showErrorScreen('Ссылка недействительна');
      }
      if (data.apply_token) {
        state.resetToken = data.apply_token;
      }
    } catch (e) {
      console.error("Token check error:", e);
    }
  }

  app.innerHTML = '';
  app.appendChild(renderAuthScreen());
  
  const toSignup = $('#switch-to-signup');
  const toReset = $('#switch-to-reset');
  const toLogin = $('#switch-to-login');
  const confirmBtn = $('#confirm-ok');
  
  if (toSignup) toSignup.onclick = (e) => { e.preventDefault(); setAuthMode('signup'); renderApp(); };
  if (toReset) toReset.onclick = (e) => { e.preventDefault(); setAuthMode('reset'); renderApp(); };
  if (toLogin) toLogin.onclick = (e) => { e.preventDefault(); setAuthMode('login'); renderApp(); };
  if (confirmBtn) confirmBtn.onclick = () => { setAuthMode('login'); renderApp(); };

  if (state.authMode === 'verified' || state.authMode === 'verify_error') {
    if (!DEBUG_POPUPS_STICKY) {
      setTimeout(() => { setAuthMode('login'); renderApp(); }, 3000);
    }
  }

  const loginBtn = $('#login-submit');
  const signupBtn = $('#signup-submit');
  const resetBtn = $('#reset-submit');
  const setPassBtn = $('#set-password-submit');
  if (loginBtn) loginBtn.onclick = (e) => attemptLogin(e);
  if (signupBtn) signupBtn.onclick = (e) => attemptLogin(e);
  if (resetBtn) resetBtn.onclick = (e) => attemptLogin(e);
  if (setPassBtn) setPassBtn.onclick = (e) => attemptLogin(e);

  setTimeout(() => {
    if (document.activeElement) document.activeElement.blur();
  }, 50);



  document.querySelectorAll('.toggle-password-btn').forEach((btn) => {
    btn.onclick = () => {
      const wrapper = btn.closest('.password-input-wrapper');
      const input = wrapper ? wrapper.querySelector('input') : null;
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.classList.toggle('active', isPassword);
    };
  });
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-doc-placeholder]');
  if (!link) return;
  e.preventDefault();
  alert('Документ в процессе написания. Скоро опубликуем.');
});

document.addEventListener('click', (e) => {
  const supportLink = e.target.closest('#open-support-chat');
  if (supportLink) {
    e.preventDefault();
    const widget = window.Mitya || window.MityaWidget;
    if (widget) {
      if (typeof widget.open === 'function') widget.open();
      else if (typeof widget.openChat === 'function') widget.openChat();
      else if (typeof widget.toggle === 'function') widget.toggle();
    } else {
      alert('Чат поддержки загружается, попробуйте через секунду.');
    }
    return;
  }

  const link = e.target.closest('[data-doc-placeholder]');
  if (!link) return;
  e.preventDefault();
  alert('Документ в процессе написания. Скоро опубликуем.');
});

document.addEventListener('DOMContentLoaded', renderApp);
