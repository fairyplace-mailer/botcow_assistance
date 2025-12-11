(function(){
  try {
    var t = localStorage.getItem('theme');
    if (t === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      return;
    }
    if (t === 'light') {
      document.documentElement.removeAttribute('data-theme');
      return;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) {
    // ignore
  }
})();
