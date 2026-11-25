const PROJECT_ID = "bcoached-889bc";
const FIREBASE_API_KEY = "AIzaSyDYm9hfARUWgQO3bpIlMkJnbDzV7O1OOAo";
const ALLOWED_ORIGIN = "https://brandontaylorfife13-hue.github.io";
let cachedAccessToken = null;
let cachedAccessTokenExpiry = 0;

function response(data, status = 200, origin = ALLOWED_ORIGIN) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type, x-photo-date, x-photo-position, x-photo-name",
      "vary": "Origin",
      "cache-control": "no-store"
    }
  });
}

function base64url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToBytes(pem) {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function getGoogleAccessToken(serviceAccount) {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiry - 60000) return cachedAccessToken;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase.messaging",
    aud: serviceAccount.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = header + "." + claims;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = unsigned + "." + base64url(new Uint8Array(signature));
  const tokenResponse = await fetch(serviceAccount.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error("Google OAuth token exchange failed: " + (tokenData.error_description || tokenData.error || tokenResponse.status));
  }
  cachedAccessToken = tokenData.access_token;
  cachedAccessTokenExpiry = Date.now() + Number(tokenData.expires_in || 3600) * 1000;
  return cachedAccessToken;
}

async function verifyFirebaseUser(idToken) {
  const result = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + FIREBASE_API_KEY, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  const data = await result.json();
  const user = data.users?.[0];
  if (!result.ok || !user?.localId || user.disabled) {
    throw new Error("Firebase sign-in token is invalid or expired. Please sign in again.");
  }
  return user.localId;
}



const FIRESTORE_BASE = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents";
const APP_URL = "https://brandontaylorfife13-hue.github.io/B.COACHED-SCANNER/";
const REMINDER_TIME_ZONE = "Europe/London";

function londonClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: REMINDER_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    date: values.year + "-" + values.month + "-" + values.day,
    weekday: values.weekday,
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

function firestoreValue(value) {
  if (value?.stringValue !== undefined) return value.stringValue;
  if (value?.booleanValue !== undefined) return value.booleanValue;
  if (value?.integerValue !== undefined) return Number(value.integerValue);
  if (value?.doubleValue !== undefined) return Number(value.doubleValue);
  return null;
}

async function firestoreRequest(path, accessToken, options = {}) {
  return fetch(FIRESTORE_BASE + path, {
    ...options,
    headers: {
      "authorization": "Bearer " + accessToken,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
}

async function listFirestoreDocuments(path, accessToken) {
  const documents = [];
  let pageToken = "";
  do {
    const query = "?pageSize=1000" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    const result = await firestoreRequest(path + query, accessToken);
    if (!result.ok) {
      throw new Error("Firestore list failed (" + result.status + "): " + (await result.text()).slice(0, 300));
    }
    const data = await result.json();
    documents.push(...(data.documents || []));
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return documents;
}

async function getFirestoreDocument(path, accessToken) {
  const result = await firestoreRequest(path, accessToken);
  if (result.status === 404) return null;
  if (!result.ok) throw new Error("Firestore read failed (" + result.status + "): " + (await result.text()).slice(0, 300));
  return result.json();
}

async function sendPushNotification(deviceToken, accessToken, notification) {
  const result = await fetch("https://fcm.googleapis.com/v1/projects/" + PROJECT_ID + "/messages:send", {
    method: "POST",
    headers: {
      "authorization": "Bearer " + accessToken,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        data: {
          title: notification.title,
          body: notification.body,
          url: APP_URL,
          notificationType: notification.type
        },
        webpush: { headers: { Urgency: "high", TTL: "3600" } }
      }
    })
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) {
    throw new Error(payload.error?.message || "FCM send failed (" + result.status + ")");
  }
  return payload.name;
}

async function sendWeightReminder(deviceToken, accessToken) {
  return sendPushNotification(deviceToken, accessToken, {
    title: "B.COACHED — Daily weigh-in",
    body: "Good morning! It's time to log your weight. Tap here to update your progress.",
    type: "daily-weight-reminder"
  });
}

async function sendCheckinReminder(deviceToken, accessToken) {
  return sendPushNotification(deviceToken, accessToken, {
    title: "B.COACHED — Weekly check-in",
    body: "Your weekly check-in is due. Take a few minutes to update your coach on your progress.",
    type: "weekly-checkin-reminder"
  });
}

async function sendDailyWeightReminders(env) {
  const now = new Date();
  const london = londonClock(now);
  // The Worker is triggered at 05:00 and 06:00 UTC. This check makes it
  // fire once at 06:00 Europe/London in both GMT and BST.
  if (london.hour !== 6) {
    console.log("Daily reminder cron skipped; London time is " + london.hour + ":" + String(london.minute).padStart(2, "0"));
    return;
  }

  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
  if (serviceAccount.project_id !== PROJECT_ID || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("The Firebase service-account secret is missing or belongs to the wrong project.");
  }
  const accessToken = await getGoogleAccessToken(serviceAccount);
  const users = await listFirestoreDocuments("/users", accessToken);
  let eligible = 0, sent = 0, skipped = 0, failed = 0;

  for (const userDoc of users) {
    const fields = userDoc.fields || {};
    const uid = userDoc.name?.split("/").pop();
    if (!uid || firestoreValue(fields.role) !== "client") continue;
    const accountStatus = firestoreValue(fields.accountStatus);
    if (accountStatus === "inactive" || accountStatus === "archived") continue;

    try {
      const encodedUid = encodeURIComponent(uid);
      const [preferences, alreadyLogged, alreadySent] = await Promise.all([
        getFirestoreDocument("/users/" + encodedUid + "/settings/notifications", accessToken),
        getFirestoreDocument("/users/" + encodedUid + "/weights/" + london.date, accessToken),
        getFirestoreDocument("/users/" + encodedUid + "/pushReminderLog/" + london.date, accessToken)
      ]);

      if (preferences?.fields?.weightReminder?.booleanValue === false || alreadyLogged || alreadySent) {
        skipped++;
        continue;
      }

      const tokenDocs = await listFirestoreDocuments("/users/" + encodedUid + "/pushTokens", accessToken);
      const tokens = [...new Set(tokenDocs.map(doc => decodeURIComponent(doc.name?.split("/").pop() || "")).filter(Boolean))];
      if (!tokens.length) {
        skipped++;
        continue;
      }

      eligible++;
      let delivered = 0;
      for (const token of tokens) {
        try {
          await sendWeightReminder(token, accessToken);
          delivered++;
          sent++;
        } catch (error) {
          console.error("Daily weigh-in push failed for user " + uid + ":", error.message);
          failed++;
        }
      }

      // Record the date only after at least one device accepted the push.
      // This prevents duplicate reminders if Cloudflare retries the cron.
      if (delivered > 0) {
        const logPath = "/users/" + encodedUid + "/pushReminderLog/" + london.date;
        const logResult = await firestoreRequest(logPath, accessToken, {
          method: "PATCH",
          body: JSON.stringify({
            fields: {
              date: { stringValue: london.date },
              type: { stringValue: "daily-weight-reminder" },
              deliveredCount: { integerValue: String(delivered) },
              sentAt: { timestampValue: new Date().toISOString() }
            }
          })
        });
        if (!logResult.ok) {
          console.error("Could not record reminder log for user " + uid + ":", (await logResult.text()).slice(0, 300));
        }
      }
    } catch (error) {
      failed++;
      console.error("Daily weigh-in reminder failed for user " + uid + ":", error.message);
    }
  }

  console.log(JSON.stringify({
    type: "daily-weight-reminder",
    date: london.date,
    timeZone: REMINDER_TIME_ZONE,
    eligible,
    sent,
    skipped,
    failed
  }));
}


async function sendSundayCheckinReminders(env) {
  const london = londonClock();
  if (london.weekday !== "Sun" || london.hour !== 18) return;

  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
  if (serviceAccount.project_id !== PROJECT_ID || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("The Firebase service-account secret is missing or belongs to the wrong project.");
  }
  const accessToken = await getGoogleAccessToken(serviceAccount);
  const users = await listFirestoreDocuments("/users", accessToken);
  const today = new Date(london.date + "T12:00:00Z");
  const monday = new Date(today);
  monday.setUTCDate(monday.getUTCDate() - ((today.getUTCDay() + 6) % 7));
  const weekStart = monday.toISOString().slice(0, 10);

  let eligible = 0, sent = 0, skipped = 0, failed = 0;
  for (const userDoc of users) {
    const fields = userDoc.fields || {};
    const uid = userDoc.name?.split("/").pop();
    if (!uid || firestoreValue(fields.role) !== "client") continue;
    const accountStatus = firestoreValue(fields.accountStatus);
    if (accountStatus === "inactive" || accountStatus === "archived") continue;

    try {
      const encodedUid = encodeURIComponent(uid);
      const [preferences, alreadySent, checkins] = await Promise.all([
        getFirestoreDocument("/users/" + encodedUid + "/settings/notifications", accessToken),
        getFirestoreDocument("/users/" + encodedUid + "/pushCheckinReminderLog/" + london.date, accessToken),
        listFirestoreDocuments("/users/" + encodedUid + "/weeklyCheckins", accessToken)
      ]);
      if (preferences?.fields?.checkinReminder?.booleanValue === false || alreadySent) {
        skipped++;
        continue;
      }

      const submittedThisWeek = checkins.some(checkin => {
        const data = checkin.fields || {};
        const weekEnding = firestoreValue(data.weekEnding) || checkin.name?.split("/").pop() || "";
        return typeof weekEnding === "string" && weekEnding >= weekStart && weekEnding <= london.date;
      });
      if (submittedThisWeek) {
        skipped++;
        continue;
      }

      const tokenDocs = await listFirestoreDocuments("/users/" + encodedUid + "/pushTokens", accessToken);
      const tokens = [...new Set(tokenDocs.map(item => decodeURIComponent(item.name?.split("/").pop() || "")).filter(Boolean))];
      if (!tokens.length) {
        skipped++;
        continue;
      }

      eligible++;
      let delivered = 0;
      for (const token of tokens) {
        try {
          await sendCheckinReminder(token, accessToken);
          delivered++;
          sent++;
        } catch (error) {
          failed++;
          console.error("Weekly check-in push failed for user " + uid + ":", error.message);
        }
      }

      if (delivered > 0) {
        const logResult = await firestoreRequest(
          "/users/" + encodedUid + "/pushCheckinReminderLog/" + london.date,
          accessToken,
          {
            method: "PATCH",
            body: JSON.stringify({
              fields: {
                date: { stringValue: london.date },
                type: { stringValue: "weekly-checkin-reminder" },
                deliveredCount: { integerValue: String(delivered) },
                sentAt: { timestampValue: new Date().toISOString() }
              }
            })
          }
        );
        if (!logResult.ok) {
          console.error("Could not record weekly check-in reminder for user " + uid + ":", (await logResult.text()).slice(0, 300));
        }
      }
    } catch (error) {
      failed++;
      console.error("Weekly check-in reminder failed for user " + uid + ":", error.message);
    }
  }

  console.log(JSON.stringify({
    type: "weekly-checkin-reminder",
    date: london.date,
    weekStart,
    timeZone: REMINDER_TIME_ZONE,
    eligible,
    sent,
    skipped,
    failed
  }));
}

export default {
  scheduled(controller, env, ctx) {
    const london = londonClock();
    if (london.hour === 6) ctx.waitUntil(sendDailyWeightReminders(env));
    if (london.weekday === "Sun" && london.hour === 18) ctx.waitUntil(sendSundayCheckinReminders(env));
  },
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": ALLOWED_ORIGIN,
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "authorization, content-type, x-photo-date, x-photo-position, x-photo-name",
          "access-control-max-age": "86400",
          "vary": "Origin"
        }
      });
    }
    if (origin !== ALLOWED_ORIGIN) return response({ error: "Origin not allowed." }, 403);
    const url = new URL(request.url);
    if (url.pathname === "/photo-upload" && request.method === "POST") {
      try {
        if (!env.PHOTO_BUCKET) return response({ error: "Photo storage is not connected. Check the PHOTO_BUCKET binding." }, 503);
        const authorization = request.headers.get("Authorization") || "";
        if (!authorization.startsWith("Bearer ")) return response({ error: "Sign in is required." }, 401);
        const idToken = authorization.slice(7);
        const uid = await verifyFirebaseUser(idToken);
        const userResponse = await fetch(FIRESTORE_BASE + "/users/" + encodeURIComponent(uid), { headers: { authorization: "Bearer " + idToken } });
        if (!userResponse.ok) return response({ error: "Could not verify your B.COACHED account." }, 403);
        const userData = await userResponse.json();
        if (userData.fields?.role?.stringValue !== "client") return response({ error: "Only client accounts can upload progress photos." }, 403);
        const contentType = request.headers.get("Content-Type") || "";
        const size = Number(request.headers.get("Content-Length") || 0);
        if (!contentType.startsWith("image/")) return response({ error: "Please upload an image file." }, 415);
        if (size > 50 * 1024 * 1024) return response({ error: "Photo must be 50 MB or smaller." }, 413);
        const date = (request.headers.get("X-Photo-Date") || "").replace(/[^0-9-]/g, "").slice(0, 10);
        const position = (request.headers.get("X-Photo-Position") || "other").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 20) || "other";
        const name = (request.headers.get("X-Photo-Name") || "photo").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return response({ error: "Choose a valid photo date." }, 400);
        const key = "users/" + uid + "/progressPhotos/" + date + "_" + position + "_" + Date.now() + "_" + name;
        await env.PHOTO_BUCKET.put(key, request.body, { httpMetadata: { contentType } });
        return response({ success: true, key, size }, 200);
      } catch (error) {
        console.error("Progress photo upload failed:", error);
        return response({ error: error.message || "Photo upload failed." }, 500);
      }
    }

    if (url.pathname === "/photo" && request.method === "GET") {
      try {
        if (!env.PHOTO_BUCKET) return response({ error: "Photo storage is not connected." }, 503);
        const authorization = request.headers.get("Authorization") || "";
        if (!authorization.startsWith("Bearer ")) return response({ error: "Sign in is required." }, 401);
        const idToken = authorization.slice(7);
        const uid = await verifyFirebaseUser(idToken);
        const key = url.searchParams.get("key") || "";
        if (!key.startsWith("users/") || !key.includes("/progressPhotos/") || key.includes("..")) return response({ error: "Invalid photo reference." }, 400);
        const ownerUid = key.split("/")[1];
        if (ownerUid !== uid) {
          const userResponse = await fetch(FIRESTORE_BASE + "/users/" + encodeURIComponent(uid), { headers: { authorization: "Bearer " + idToken } });
          if (!userResponse.ok) return response({ error: "Could not verify your account." }, 403);
          const userData = await userResponse.json();
          if (userData.fields?.role?.stringValue !== "coach") return response({ error: "You are not allowed to view this photo." }, 403);
        }
        const object = await env.PHOTO_BUCKET.get(key);
        if (!object) return response({ error: "Photo not found." }, 404);
        return new Response(object.body, { status: 200, headers: {
          "access-control-allow-origin": ALLOWED_ORIGIN,
          "vary": "Origin",
          "content-type": object.httpMetadata?.contentType || "application/octet-stream",
          "cache-control": "private, no-store"
        }});
      } catch (error) {
        console.error("Progress photo retrieval failed:", error);
        return response({ error: error.message || "Could not retrieve photo." }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/send-user-notification") {
      try {
        const authorization = request.headers.get("Authorization") || "";
        if (!authorization.startsWith("Bearer ")) return response({ error: "Sign in is required." }, 401);
        const uid = await verifyFirebaseUser(authorization.slice(7));
        const body = await request.json();
        const recipientUid = typeof body.recipientUid === "string" ? body.recipientUid : "";
        const title = typeof body.title === "string" ? body.title.trim().slice(0, 100) : "";
        const messageBody = typeof body.body === "string" ? body.body.trim().slice(0, 500) : "";
        const type = typeof body.type === "string" ? body.type.trim().slice(0, 60) : "coaching-update";
        if (!recipientUid || recipientUid.length > 128 || !title || !messageBody) {
          return response({ error: "A recipient, title and message are required." }, 400);
        }
        const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
        if (serviceAccount.project_id !== PROJECT_ID || !serviceAccount.client_email || !serviceAccount.private_key) {
          return response({ error: "The Firebase service-account secret is missing or belongs to the wrong project." }, 500);
        }
        const accessToken = await getGoogleAccessToken(serviceAccount);
        const [coachDoc, clientDoc] = await Promise.all([
          getFirestoreDocument("/users/" + encodeURIComponent(uid), accessToken),
          getFirestoreDocument("/users/" + encodeURIComponent(recipientUid), accessToken)
        ]);
        if (coachDoc?.fields?.role?.stringValue !== "coach") {
          return response({ error: "Only a coach account can send client notifications." }, 403);
        }
        if (clientDoc?.fields?.role?.stringValue !== "client") {
          return response({ error: "The notification recipient is not a client account." }, 404);
        }
        const tokenDocs = await listFirestoreDocuments("/users/" + encodeURIComponent(recipientUid) + "/pushTokens", accessToken);
        const tokens = [...new Set(tokenDocs.map(item => decodeURIComponent(item.name?.split("/").pop() || "")).filter(Boolean))];
        if (!tokens.length) return response({ success: true, sent: 0, message: "No registered client devices; the in-app notification was saved." });
        let sent = 0;
        const errors = [];
        for (const token of tokens) {
          try {
            await sendPushNotification(token, accessToken, { title, body: messageBody, type });
            sent++;
          } catch (error) {
            errors.push(error.message);
            console.error("Client notification delivery failed:", error.message);
          }
        }
        return response({ success: sent > 0, sent, failed: errors.length, errors: errors.slice(0, 3) }, sent > 0 ? 200 : 502);
      } catch (error) {
        console.error("Client push notification failed:", error);
        return response({ error: error.message || "Could not send client notification." }, 500);
      }
    }

    if (request.method !== "POST" || url.pathname !== "/send-test") {
      return response({ error: "Not found." }, 404);
    }
    try {
      const authorization = request.headers.get("Authorization") || "";
      if (!authorization.startsWith("Bearer ")) return response({ error: "Sign in is required." }, 401);
      const idToken = authorization.slice(7);
      const uid = await verifyFirebaseUser(idToken);
      const body = await request.json();
      const deviceToken = typeof body.token === "string" ? body.token : "";
      if (!deviceToken || deviceToken.length > 4096) return response({ error: "A valid device token is required." }, 400);

      // Only allow a signed-in user to send to a device token stored under their own account.
      const tokenRecord = await fetch(
        "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID +
        "/databases/(default)/documents/users/" + encodeURIComponent(uid) +
        "/pushTokens/" + encodeURIComponent(deviceToken),
        { headers: { "authorization": "Bearer " + idToken } }
      );
      if (!tokenRecord.ok) {
        if (tokenRecord.status === 404) return response({ error: "This phone is not registered to your account. Enable phone notifications in B.COACHED again." }, 403);
        return response({ error: "Could not verify that this phone belongs to your account." }, 502);
      }

      const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
      if (serviceAccount.project_id !== PROJECT_ID || !serviceAccount.client_email || !serviceAccount.private_key) {
        return response({ error: "The Firebase service-account secret is missing or belongs to the wrong project." }, 500);
      }
      const accessToken = await getGoogleAccessToken(serviceAccount);
      const fcm = await fetch("https://fcm.googleapis.com/v1/projects/" + PROJECT_ID + "/messages:send", {
        method: "POST",
        headers: {
          "authorization": "Bearer " + accessToken,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            // Data-only messages are displayed once by the service worker.
            data: {
              title: "B.COACHED test notification",
              body: "Great news — your phone is connected to B.COACHED notifications.",
              url: "https://brandontaylorfife13-hue.github.io/B.COACHED-SCANNER/"
            }
          }
        })
      });
      const result = await fcm.json();
      if (!fcm.ok) {
        const message = result.error?.message || "Firebase Cloud Messaging rejected the test message.";
        return response({ error: message, code: result.error?.status || "FCM_ERROR" }, fcm.status);
      }
      return response({ success: true, messageId: result.name, uid }, 200);
    } catch (error) {
      return response({ error: error.message || "Unexpected notification service error." }, 500);
    }
  }
};
