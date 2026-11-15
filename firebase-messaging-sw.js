// Firebase Cloud Messaging service worker for B.COACHED.
// Handle notification clicks before loading Firebase Messaging.
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

importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDYm9hfARUWgQO3bpIlMkJnbDzV7O1OOAo",
  authDomain: "bcoached-889bc.firebaseapp.com",
  projectId: "bcoached-889bc",
  storageBucket: "bcoached-889bc.firebasestorage.app",
  messagingSenderId: "597253859431",
  appId: "1:597253859431:web:18a0fa2c616039d0524cc2"
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || "B.COACHED";
  const options = {
    body: payload.notification?.body || "You have a new coaching update.",
    data: { url: payload.data?.url || "./" }
  };
  return self.registration.showNotification(title, options);
});
