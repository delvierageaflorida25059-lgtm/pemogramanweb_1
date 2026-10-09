/**
 * Registrasi Service Worker + deteksi prompt instalasi PWA.
 *
 * Script ini dimuat oleh semua halaman lewat tag <script>.
 * Sengaja vanilla JS tanpa framework supaya sesuai batasan blueprint.
 */

(function registerServiceWorker() {
  'use strict';

  // Service Worker hanya tersedia di HTTPS atau localhost.
  if (!('serviceWorker' in navigator)) return;
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
    return;
  }

  window.addEventListener('load', async function onLoad() {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      });

      // Ada versi baru yang menunggu: suruh service worker langsung aktif.
      registration.addEventListener('updatefound', function onUpdateFound() {
        const installing = registration.installing;
        if (!installing) return;

        installing.addEventListener('statechange', function onStateChange() {
          if (installing.state !== 'installed') return;

          if (navigator.serviceWorker.controller) {
            // Kontrol masih memakai versi lama.
            const event = new CustomEvent('sw:update-available', {
              detail: { registration: registration },
            });
            document.dispatchEvent(event);
          } else {
            // Instalasi pertama, aplikasi sekarang bisa offline.
            document.dispatchEvent(new CustomEvent('sw:installed', {
              detail: { registration: registration },
            }));
          }
        });
      });
    } catch (error) {
      console.warn('[pwa] gagal mendaftarkan service worker:', error.message);
    }
  });
})();

/**
 * Handle prompt instalasi. Chrome hanya mengizinkan satu prompt per aplikasi,
 * jadi tombol install sengaja disembunyikan sebelum event ini benar-benar
 * dipanggil.
 */
(function installPrompt() {
  'use strict';

  var deferredPrompt = null;
  var button = document.getElementById('install-button');

  window.addEventListener('beforeinstallprompt', function onBeforeInstallPrompt(event) {
    // Cegah prompt bawaan browser agar kita bisa menampilkannya sendiri.
    event.preventDefault();
    deferredPrompt = event;

    if (button) button.hidden = false;
  });

  window.addEventListener('appinstalled', function onAppInstalled() {
    if (button) button.hidden = true;
    deferredPrompt = null;
  });

  if (!button) return;

  button.hidden = true;
  button.addEventListener('click', async function onClick() {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    button.hidden = true;

    console.log('[pwa] hasil instalasi:', choice.outcome);
  });
})();