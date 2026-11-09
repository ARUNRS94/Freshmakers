export type Theme = 'light' | 'dark';

const KEY = 'fm_theme';

export function readTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export const applyTheme = (t: Theme) => {
  document.documentElement.dataset.theme = t;
};

export function saveTheme(t: Theme) {
  applyTheme(t);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* storage unavailable: the choice lasts until reload */
  }
}
