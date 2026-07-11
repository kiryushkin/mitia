/**
 * Устанавливает значение куки.
 */
export const setCookie = (name, value, days) => {
  const d = new Date();
  d.setTime(d.getTime() + days * 86400000);
  document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/;SameSite=Lax`;
};

/**
 * Получает значение куки по имени.
 */
export const getCookie = (name) => {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
};

export const getStorageItem = (key) => {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
};

export const setStorageItem = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // ignore
  }
};
