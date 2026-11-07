(() => {
  const system = matchMedia('(prefers-color-scheme: dark)');
  let mode = 'system';
  try { mode = localStorage.getItem('panelTheme') || 'system'; } catch {}
  if (!['system', 'light', 'dark'].includes(mode)) mode = 'system';
  const render = () => {
    document.documentElement.dataset.theme = mode === 'system' ? system.matches ? 'dark' : 'light' : mode;
    const select = document.getElementById('themeSelect'); if (select) select.value = mode;
  };
  render();
  system.addEventListener('change', () => { if (mode === 'system') render(); });
  document.addEventListener('DOMContentLoaded', () => {
    render();
    document.getElementById('themeSelect').addEventListener('change', event => {
      if (!['system', 'light', 'dark'].includes(event.target.value)) return;
      mode = event.target.value; try { localStorage.setItem('panelTheme', mode); } catch {} render();
    });
  });
})();
