/**
 * FELT GeoJSON Uploader — Service Worker
 *
 * Sole responsibility: receive shared GeoJSON files via the Web Share
 * Target API, stash them in CacheStorage, then redirect back to the app.
 * The main page polls for pending files on load and whenever the SW sends
 * a SHARED_FILES message.
 *
 * All other fetch requests are passed straight through (no caching of app
 * shell here — keep it simple and let the browser handle that).
 */

const SHARE_CACHE  = "felt-share-v1";
const PENDING_KEY  = "pending-share";

// ── Lifecycle ────────────────────────────────────────────────────────────────

self.addEventListener("install",  () => self.skipWaiting());
self.addEventListener("activate", e  => e.waitUntil(self.clients.claim()));

// ── Fetch interception ───────────────────────────────────────────────────────

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Only intercept the share-target POST; everything else falls through.
  if (
    event.request.method === "POST" &&
    url.searchParams.has("share-target")
  ) {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // Default: network pass-through (no offline caching for the app shell).
  event.respondWith(fetch(event.request));
});

// ── Share target handler ─────────────────────────────────────────────────────

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();

    // Collect all shared files that look like GeoJSON.
    const rawFiles = formData.getAll("geojson");
    const fileData = [];

    for (const file of rawFiles) {
      if (!(file instanceof File)) continue;
      try {
        const text = await file.text();
        // Quick sanity check before storing.
        JSON.parse(text);
        fileData.push({ name: file.name, content: text });
      } catch (_) {
        // Not valid JSON — skip.
      }
    }

    if (fileData.length > 0) {
      const cache = await caches.open(SHARE_CACHE);
      await cache.put(
        PENDING_KEY,
        new Response(JSON.stringify(fileData), {
          headers: { "Content-Type": "application/json" },
        })
      );

      // Notify any already-open window so it can pick up the files
      // without waiting for a page reload.
      const windows = await self.clients.matchAll({ type: "window" });
      for (const win of windows) {
        win.postMessage({ type: "SHARED_FILES", files: fileData });
      }
    }
  } catch (err) {
    // If anything goes wrong, still redirect so the user lands on the app.
    console.error("[SW] share-target error:", err);
  }

  // Always redirect back to the app root so the browser opens the page.
  const appRoot = new URL("./", self.registration.scope).href;
  return Response.redirect(appRoot, 303);
}

// ── Message handler ──────────────────────────────────────────────────────────

// The main page sends CHECK_SHARE on load to retrieve any pending files
// that arrived before the page was open (e.g. app was launched fresh).
self.addEventListener("message", async event => {
  if (event.data?.type !== "CHECK_SHARE") return;

  const cache    = await caches.open(SHARE_CACHE);
  const response = await cache.match(PENDING_KEY);
  if (!response) return;

  const files = await response.json();
  await cache.delete(PENDING_KEY);

  if (event.source) {
    event.source.postMessage({ type: "SHARED_FILES", files });
  }
});
