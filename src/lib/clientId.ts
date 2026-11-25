const CLIENT_ID_KEY = 'haymatch_client_id';
const NICKNAME_KEY = 'haymatch_nickname';
const THEME_KEY = 'haymatch_theme';

export function getOrCreateClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

export function getSavedNickname(): string {
  return localStorage.getItem(NICKNAME_KEY) ?? '';
}

export function saveNickname(name: string): void {
  localStorage.setItem(NICKNAME_KEY, name.trim());
}

export function getSavedTheme(): 'dark' | 'light' {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === 'light' ? 'light' : 'dark';
}

export function saveTheme(theme: 'dark' | 'light'): void {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.setAttribute('data-theme', theme);
}
