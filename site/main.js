/* Color mode toggle: system → light → dark → system */
(function() {
  const modes = ['system', 'light', 'dark'];
  let current = localStorage.getItem('color-mode') || 'system';

  function apply(mode) {
    document.documentElement.setAttribute('data-color-mode', mode);
    if (mode === 'light') {
      document.documentElement.style.colorScheme = 'light';
    } else if (mode === 'dark') {
      document.documentElement.style.colorScheme = 'dark';
    } else {
      document.documentElement.style.colorScheme = '';
    }
  }

  apply(current);

  document.getElementById('color-mode-toggle')?.addEventListener('click', function() {
    current = modes[(modes.indexOf(current) + 1) % modes.length];
    localStorage.setItem('color-mode', current);
    apply(current);
  });
})();

/* Hub vFadeIn 相当: [data-fade] をスクロールで往復フェードイン。
   Hub と同じ rootMargin (下端 -200px) で、外れたら戻す。 */
(function() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const els = document.querySelectorAll('[data-fade]');
  if (els.length === 0 || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      entry.target.classList.toggle('is-shown', entry.isIntersecting);
    }
  }, { root: null, rootMargin: '9999px 0px -200px 0px', threshold: 0 });
  els.forEach((el) => {
    el.classList.add('fade');
    io.observe(el);
  });
})();

/* Hub vTextUnderline 相当: .u-line のグラデ下線をスクロールで伸ばす */
(function() {
  const els = document.querySelectorAll('.u-line');
  if (els.length === 0 || !('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('is-drawn'));
    return;
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    els.forEach((el) => el.classList.add('is-drawn'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      entry.target.classList.toggle('is-drawn', entry.isIntersecting);
    }
  }, { root: null, rootMargin: '9999px 0px -300px 0px', threshold: 0 });
  els.forEach((el) => io.observe(el));
})();

/* Keep the hero screenshot in sync with the README.
   index.html already carries the current URL so the LCP paints without waiting
   on this request; we only swap when the README has actually moved on. */
fetch('https://raw.githubusercontent.com/notedeck-dev/notedeck/main/README.md')
  .then(r => r.text())
  .then(md => {
    const m = md.match(/<img[^>]+src="(https:\/\/github\.com\/user-attachments\/assets\/[^"]+)"/);
    const img = document.getElementById('hero-screenshot');
    if (m && img && img.src !== m[1]) img.src = m[1];
  })
  .catch(() => {});

/* Resolve direct download URLs from GitHub Releases API */
fetch('https://api.github.com/repos/notedeck-dev/notedeck/releases/latest')
  .then(r => r.json())
  .then(release => {
    const assets = release.assets || [];
    const match = {
      windows: a => a.name.endsWith('-setup.exe'),
      macos:   a => a.name.endsWith('.dmg'),
      linux:   a => a.name.endsWith('.deb'),
      android: a => a.name.endsWith('.apk'),
    };
    if (release.tag_name) {
      const badge = document.getElementById('latest-version');
      if (badge) badge.textContent = release.tag_name;
      const noticeText = document.getElementById('notice-text');
      if (noticeText) noticeText.textContent = `${release.tag_name} をリリースしました`;
      const noticeLink = document.getElementById('notice-link');
      if (noticeLink && release.html_url) noticeLink.href = release.html_url;
    }
    document.querySelectorAll('.platform[data-platform]').forEach(el => {
      const fn = match[el.dataset.platform];
      const asset = fn && assets.find(fn);
      if (asset) el.href = asset.browser_download_url;
    });
  })
  .catch(() => {}); /* fallback: links stay as /releases/latest */

/* Click to copy install commands */
document.querySelectorAll('.install-cmd[data-cmd]').forEach((el) => {
  el.addEventListener('click', () => {
    navigator.clipboard.writeText(el.dataset.cmd);
    const hint = el.querySelector('.copy-hint');
    hint.textContent = 'copied!';
    el.classList.add('copied');
    setTimeout(() => { hint.textContent = 'click to copy'; el.classList.remove('copied'); }, 1500);
  });
});
