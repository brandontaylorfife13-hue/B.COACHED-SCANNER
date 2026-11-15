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
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
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
    scope: "https://www.googleapis.com/auth/firebase.messaging",
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": ALLOWED_ORIGIN,
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "authorization, content-type",
          "access-control-max-age": "86400",
          "vary": "Origin"
        }
      });
    }
    if (origin !== ALLOWED_ORIGIN) return response({ error: "Origin not allowed." }, 403);
    const url = new URL(request.url);
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
            notification: {
              title: "B.COACHED test notification",
              body: "Great news — your phone is connected to B.COACHED notifications."
            },
            data: { url: "https://brandontaylorfife13-hue.github.io/B.COACHED-SCANNER/" }
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
