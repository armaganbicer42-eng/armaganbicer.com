(function () {
  function apply(lang) {
    document.documentElement.setAttribute('lang', lang);

    document.querySelectorAll('[data-lang]').forEach(function (el) {
      el.hidden = el.getAttribute('data-lang') !== lang;
    });

    document.querySelectorAll('[data-lang-btn]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-lang-btn') === lang);
    });

    try { localStorage.setItem('armagan-lang', lang); } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', function () {
    var saved = 'en';
    try { saved = localStorage.getItem('armagan-lang') || 'en'; } catch (e) {}
    apply(saved);

    document.querySelectorAll('[data-lang-btn]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        apply(btn.getAttribute('data-lang-btn'));
      });
    });
  });
})();
