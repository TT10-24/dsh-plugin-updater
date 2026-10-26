(function () {
  'use strict';

  var root = document.documentElement;
  var toggle = document.getElementById('theme-toggle');
  var themeKey = 'dsh-updater-theme';

  function setTheme(theme) {
    root.dataset.theme = theme;
    if (toggle) {
      toggle.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
      toggle.setAttribute('aria-label', theme === 'light' ? '切换到暗色主题' : '切换到亮色主题');
    }
    try {
      localStorage.setItem(themeKey, theme);
    } catch (error) {
      /* localStorage may be unavailable in private mode */
    }
  }

  if (toggle) {
    toggle.setAttribute('aria-pressed', root.dataset.theme === 'light' ? 'true' : 'false');
    toggle.addEventListener('click', function () {
      setTheme(root.dataset.theme === 'light' ? 'dark' : 'light');
    });
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        var ok = document.execCommand('copy');
        document.body.removeChild(area);
        ok ? resolve() : reject(new Error('copy failed'));
      } catch (error) {
        document.body.removeChild(area);
        reject(error);
      }
    });
  }

  document.querySelectorAll('[data-copy]').forEach(function (button) {
    var original = button.textContent;
    button.addEventListener('click', function () {
      var text = button.getAttribute('data-copy') || '';
      copyText(text)
        .then(function () {
          button.textContent = '已复制';
          button.classList.add('is-copied');
          window.setTimeout(function () {
            button.textContent = original;
            button.classList.remove('is-copied');
          }, 1600);
        })
        .catch(function () {
          button.textContent = '复制失败';
          window.setTimeout(function () {
            button.textContent = original;
          }, 1600);
        });
    });
  });

  var year = document.getElementById('year');
  if (year) {
    year.textContent = String(new Date().getFullYear());
  }
})();
