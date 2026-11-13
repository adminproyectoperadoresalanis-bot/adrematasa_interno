// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/firebase-messaging-sw.js
// ##########################################################################
// Service worker de avisos push (2026-11-13). Copia del de Alanis Operadores.
// - Va en la RAÍZ del sitio (public/), no en public/js/.
// - Se registra con su propio alcance (/firebase-cloud-messaging-push-scope)
//   para no chocar con ningún otro service worker de la app.
// - No guarda nada en caché: no interfiere con la cinta de "nueva versión".
// - La configuración la da Firebase Hosting (/__/firebase/init.js): sin llaves aquí.

importScripts("/__/firebase/9.23.0/firebase-app-compat.js");
importScripts("/__/firebase/9.23.0/firebase-messaging-compat.js");
importScripts("/__/firebase/init.js");

// Al tocar un aviso: si la app ya está abierta, la trae al frente; si no, la abre.
self.addEventListener("notificationclick", function (event) {
  var d = (event.notification && event.notification.data) || {};
  var fcm = d.FCM_MSG || null;
  var link = d.link ||
    (fcm && ((fcm.fcmOptions && fcm.fcmOptions.link) || (fcm.notification && fcm.notification.click_action))) ||
    "/";
  event.stopImmediatePropagation();
  event.notification.close();
  var url = new URL(link, self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (ventanas) {
      for (var i = 0; i < ventanas.length; i++) {
        var w = ventanas[i];
        if (w.url.indexOf(self.location.origin) === 0 && "focus" in w) return w.focus();
      }
      return clients.openWindow(url);
    })
  );
});

firebase.messaging();

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (event) { event.waitUntil(self.clients.claim()); });