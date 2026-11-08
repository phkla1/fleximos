/* Shared Web Push helper for the SOS feature — used by the supervisor console
   (incoming SOS) and the operator PWA (SOS acknowledged). Talks to the Ops API's
   /ops/v1/push/* routes and the app's own already-registered service worker.
   Exposes window.flexiPush. All methods degrade gracefully where push is
   unsupported (older browsers, iOS Safari outside an installed PWA). */
(function () {
  "use strict";

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  const supported = () =>
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  // 'unsupported' | 'granted' | 'denied' | 'default'
  const permission = () => (supported() ? Notification.permission : "unsupported");

  async function registration() {
    // Resolves once the app's own service worker is active.
    return navigator.serviceWorker.ready;
  }

  async function currentSubscription() {
    if (!supported()) return null;
    try {
      const reg = await registration();
      return await reg.pushManager.getSubscription();
    } catch {
      return null;
    }
  }

  async function isSubscribed() {
    return (await currentSubscription()) !== null;
  }

  async function serverEnabled(opsBase, token) {
    const res = await fetch(`${opsBase}/ops/v1/push/vapid-public-key`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Could not reach the push service.");
    return res.json(); // { public_key, enabled }
  }

  // Request permission (if needed), subscribe this device, and register it with
  // the server. Throws a human-readable message on any refusal.
  async function enable(opsBase, token) {
    if (!supported()) throw new Error("This browser can't show notifications.");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Notifications are turned off for this site. Allow them in your browser settings, then try again.");

    const key = await serverEnabled(opsBase, token);
    if (!key.enabled || !key.public_key) throw new Error("Push alerts aren't set up on the server yet.");

    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key.public_key)
      });
    }
    const res = await fetch(`${opsBase}/ops/v1/push/subscriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() })
    });
    if (!res.ok) throw new Error("Couldn't register this device for alerts.");
    return true;
  }

  // Unsubscribe this device and tell the server to stop sending to it.
  async function disable(opsBase, token) {
    const sub = await currentSubscription();
    if (sub) {
      try {
        await fetch(`${opsBase}/ops/v1/push/subscriptions`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint })
        });
      } catch {
        /* best-effort; still unsubscribe locally */
      }
      try { await sub.unsubscribe(); } catch { /* ignore */ }
    }
    return false;
  }

  window.flexiPush = { supported, permission, isSubscribed, enable, disable };
})();
