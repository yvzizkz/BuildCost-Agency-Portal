/**
 * drive.mjs — Google Drive archive client for the bridge (dependency-free).
 *
 * The Drive is a PERSONAL Google One account (40 TB), connected via OAuth (the
 * installed-app loopback flow — see drive_auth.mjs). The bridge holds a long-lived
 * REFRESH TOKEN in bridge/.env (gitignored) and mints short-lived access tokens on
 * demand. Files are created/owned by the user's own account, so they count against
 * their 40 TB — NOT the service account's tiny ~15 GB quota (which would silently
 * 403 once full). Scope is `drive.file`: the app can only touch files IT creates,
 * never the rest of the user's Drive (least privilege).
 *
 * Fail-OPEN by design: driveConfigured() is false until the refresh token exists, so
 * the caller declines gracefully and the rest of the bridge is unaffected.
 *
 * No new npm dependency: OAuth token exchange + Drive REST are plain `fetch`
 * (Node 18+) with a streamed resumable PUT (no full-file buffering for big videos).
 * All secrets come from process.env (loaded from bridge/.env) — never hard-coded.
 */
import fs from "node:fs";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const ROOT_FOLDER_NAME = "BuildCost Agency";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** True only when the OAuth client + refresh token are present. Gate every Drive call on this. */
export function driveConfigured() {
  return Boolean(
    process.env.GDRIVE_OAUTH_CLIENT_ID &&
    process.env.GDRIVE_OAUTH_CLIENT_SECRET &&
    process.env.GDRIVE_OAUTH_REFRESH_TOKEN
  );
}

let _cachedToken = null; // { accessToken, expEpochMs }

/** Exchange the refresh token for a short-lived access token (cached until ~1 min before expiry). */
export async function getAccessToken() {
  if (_cachedToken && _cachedToken.expEpochMs - 60_000 > Date.now()) return _cachedToken.accessToken;
  if (!driveConfigured()) throw new Error("Google Drive is not connected (missing OAuth env).");
  const body = new URLSearchParams({
    client_id: process.env.GDRIVE_OAUTH_CLIENT_ID,
    client_secret: process.env.GDRIVE_OAUTH_CLIENT_SECRET,
    refresh_token: process.env.GDRIVE_OAUTH_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Drive token refresh failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  _cachedToken = { accessToken: j.access_token, expEpochMs: Date.now() + Number(j.expires_in || 3600) * 1000 };
  return _cachedToken.accessToken;
}

async function authed(token, url, opts = {}) {
  return fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
}

/** Find a child folder by name under a parent ('root' if none), creating it if absent. Returns its id. */
async function ensureFolder(token, name, parentId) {
  const parent = parentId || "root";
  const escaped = String(name).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = [
    `mimeType = '${FOLDER_MIME}'`,
    "trashed = false",
    `name = '${escaped}'`,
    `'${parent}' in parents`,
  ].join(" and ");
  const listUrl = `${DRIVE_FILES}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1&spaces=drive`;
  const r = await authed(token, listUrl);
  if (!r.ok) throw new Error(`Drive list failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  if (Array.isArray(j.files) && j.files.length) return j.files[0].id;
  const meta = { name, mimeType: FOLDER_MIME, parents: [parent] };
  const c = await authed(token, `${DRIVE_FILES}?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meta),
  });
  if (!c.ok) throw new Error(`Drive folder create failed (${c.status}): ${(await c.text()).slice(0, 200)}`);
  return (await c.json()).id;
}

/**
 * Ensure a nested folder path under the archive root and return the deepest folder id.
 * Root is GDRIVE_ARCHIVE_FOLDER_ID if set, else a "BuildCost Agency" folder in My Drive.
 */
export async function ensureFolderPath(token, parts) {
  let parentId = process.env.GDRIVE_ARCHIVE_FOLDER_ID
    ? String(process.env.GDRIVE_ARCHIVE_FOLDER_ID)
    : await ensureFolder(token, ROOT_FOLDER_NAME, null);
  for (const part of parts) {
    if (!part) continue;
    parentId = await ensureFolder(token, part, parentId);
  }
  return parentId;
}

/**
 * Resumable upload of a local file (streamed — no full-file buffering, safe for 2 GB+ video).
 * Returns { id, webViewLink, size }.
 */
export async function uploadFile(token, { localPath, name, mimeType, parentId }) {
  const size = fs.statSync(localPath).size;
  const meta = { name, parents: [parentId] };
  const init = await fetch(
    `${DRIVE_UPLOAD}?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink,size`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType || "application/octet-stream",
        "X-Upload-Content-Length": String(size),
      },
      body: JSON.stringify(meta),
    },
  );
  if (!init.ok) throw new Error(`Drive upload init failed (${init.status}): ${(await init.text()).slice(0, 200)}`);
  const sessionUrl = init.headers.get("location");
  if (!sessionUrl) throw new Error("Drive upload: no resumable session URL returned");

  const put = await fetch(sessionUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType || "application/octet-stream", "Content-Length": String(size) },
    body: fs.createReadStream(localPath),
    duplex: "half",
  });
  if (!put.ok) throw new Error(`Drive upload failed (${put.status}): ${(await put.text()).slice(0, 200)}`);
  const j = await put.json();

  let webViewLink = j.webViewLink || null;
  if (!webViewLink && j.id) {
    const m = await authed(token, `${DRIVE_FILES}/${j.id}?fields=id,webViewLink`);
    if (m.ok) webViewLink = (await m.json()).webViewLink || null;
  }
  return { id: j.id, webViewLink, size: Number(j.size || size) };
}
