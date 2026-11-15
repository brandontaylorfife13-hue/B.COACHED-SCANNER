// Diagnostic step 2: test Firebase App SDK import without Messaging.
importScripts("https://www.gstatic.com/firebasejs/10.12.4/firebase-app-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDYm9hfARUWgQO3bpIlMkJnbDzV7O1OOAo",
  authDomain: "bcoached-889bc.firebaseapp.com",
  projectId: "bcoached-889bc",
  storageBucket: "bcoached-889bc.firebasestorage.app",
  messagingSenderId: "597253859431",
  appId: "1:597253859431:web:18a0fa2c616039d0524cc2"
});

importScripts("https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging-compat.js");

const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || "B.COACHED";
  const options = {
    body: payload.notification?.body || "You have a new coaching update.",
    data: { url: payload.data?.url || "./" }
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const client of list) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) return client.focus();
    }
    return clients.openWindow(target);
  }));
});
