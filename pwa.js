/* Leclercq des étoiles — appli installable (PWA)
   - enregistre le service worker (hors ligne + mises à jour) ;
   - affiche « Installer l'appli » : installation directe sur Android / ordinateur,
     mode d'emploi pas à pas sur iPhone / iPad. */
(function () {
  'use strict';

  const DISMISS_KEY = 'leclercq-install-dismissed';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  // ---------- Service worker ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => { /* site normal sans appli */ });
    });
  }

  // ---------- Détection ----------
  const ua = navigator.userAgent || '';
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMobile = isIOS || /android|mobile/i.test(ua);
  const isStandalone = () =>
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  if (isStandalone()) document.documentElement.classList.add('is-app');

  let deferredPrompt = null;
  const navBtn = document.getElementById('install-btn');
  const footBtn = document.getElementById('footer-install');
  const banner = document.getElementById('install-banner');
  const sheet = document.getElementById('install-sheet');

  function canInstall() {
    if (isStandalone()) return false;
    return !!deferredPrompt || isIOS;
  }

  function onPublicView() {
    const pv = document.getElementById('public-view');
    return !pv || !pv.hidden;
  }

  function refresh() {
    const ok = canInstall();
    if (navBtn) navBtn.hidden = !ok;
    if (footBtn) footBtn.closest('li').hidden = !ok;
    if (banner) banner.hidden = !(ok && isMobile && onPublicView() && !store.get(DISMISS_KEY));
    document.body.classList.toggle('has-install-banner', !!banner && !banner.hidden);
  }

  async function install() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch { /* ignore */ }
      deferredPrompt = null;
      refresh();
      return;
    }
    if (sheet && typeof sheet.showModal === 'function') {
      sheet.showModal();
    } else if (sheet) {
      sheet.setAttribute('open', '');
    }
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    refresh();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    store.set(DISMISS_KEY, '1');
    refresh();
  });

  [navBtn, footBtn, document.getElementById('install-banner-go')].forEach((b) => b && b.addEventListener('click', install));
  const close = document.getElementById('install-banner-x');
  if (close) close.addEventListener('click', () => { store.set(DISMISS_KEY, '1'); refresh(); });
  if (sheet) {
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet || e.target.closest('[data-close-install]')) sheet.close ? sheet.close() : sheet.removeAttribute('open');
    });
  }

  // La bannière suit le passage site ↔ Espace liste
  const pv = document.getElementById('public-view');
  if (pv && 'MutationObserver' in window) new MutationObserver(refresh).observe(pv, { attributes: true, attributeFilter: ['hidden'] });

  refresh();
})();
