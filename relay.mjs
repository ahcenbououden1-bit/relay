// Minimal static-IP relay for OpsHub's carrier (Guepex/Yalidine) calls.
//
// Protocol expected by the app (src/lib/carriers/yalidine.server.ts):
//   - The app sends its request to this relay's public URL.
//   - Header "X-Target-Url" holds the REAL destination (Guepex/Yalidine API URL).
//   - Header "X-Relay-Key" holds a shared secret (must match RELAY_KEY below),
//     only checked if RELAY_KEY is set.
//   - This relay forwards method + headers + body to X-Target-Url, and
//     returns the carrier's response (status, headers, body) unchanged.
//
// Deploy this on ANY small IPv4 host (Render free web service, a cheap VPS,
// Oracle Cloud Free Tier, etc). Then set in Lovable secrets:
//   HTTP_PROXY_URL = https://<this-service-public-url>
//   HTTP_PROXY_KEY = <same value as RELAY_KEY below>

import http from "node:http";

const PORT = process.env.PORT || 8787;
const RELAY_KEY = process.env.RELAY_KEY || ""; // set this to a long random string

// Headers that must not be blindly forwarded (hop-by-hop / host-specific).
const STRIP_REQUEST_HEADERS = new Set([
  "host", "connection", "content-length", "x-target-url", "x-relay-key",
]);
const STRIP_RESPONSE_HEADERS = new Set([
  "connection", "transfer-encoding", "content-encoding", "content-length",
]);

const server = http.createServer(async (req, res) => {
  try {
    const targetUrl = req.headers["x-target-url"];
    if (!targetUrl) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "missing X-Target-Url header" }));
      return;
    }

    if (RELAY_KEY) {
      const provided = req.headers["x-relay-key"];
      if (provided !== RELAY_KEY) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid X-Relay-Key" }));
        return;
      }
    }

    // Collect the request body (if any).
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    // Build forwarded headers.
    const fwdHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!STRIP_REQUEST_HEADERS.has(k.toLowerCase())) fwdHeaders[k] = v;
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: fwdHeaders,
      body: body && body.length ? body : undefined,
    });

    const outHeaders = {};
    upstream.headers.forEach((value, key) => {
      if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) outHeaders[key] = value;
    });

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, outHeaders);
    res.end(buf);
  } catch (err) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "relay_error", message: String(err && err.message || err) }));
  }
});

server.listen(PORT, () => {
  console.log(`relay listening on :${PORT} (key ${RELAY_KEY ? "required" : "NOT set — anyone can use this relay!"})`);
});
