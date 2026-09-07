(function () {
  var id = null;
  try { id = window.localStorage.getItem('effetune_theme'); } catch { /* Use the default theme when storage is unavailable. */ }
  if (typeof id === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(id)) {
    document.documentElement.dataset.theme = id;
  }
})();
