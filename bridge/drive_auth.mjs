/**
 * drive_auth.mjs — ONE-TIME Google Drive connection for the bridge.
 *
 * Run once, after creating an OAuth client (Desktop app) in the buildcost-portal GCP
 * project and putting its id/secret in bridge/.env:
 *
 *   GDRIVE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
 *   GDRIVE_OAUTH_CLIENT_SECRET=...
 *
 * Then:   node bridge/drive_auth.mjs
 *
 * It opens Google's consent screen in your browser, captures the auth code on a
 * localhost loopback, exchanges it for a long-lived REFRESH TOKEN, and appends
 *   GDRIVE_OAUTH_REFRESH_TOKEN=...
 * to bridge/.env. After that, restart the bridge and Drive ingest is live.
 *
 * Scope: drive.file — the bridge can only ever touch files IT creates (least privilege);
 * it cannot read the rest of your Drive.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, ".env");
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const PORT = Number(process.env.GDRIVE_OAUTH_PORT || 4773);
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

function loadEnv(p) {
  const out = {};
  let txt;
  try { txt = fs.readFileSync(p, "utf8"); } catch { return out; }
  for (const line of txt.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[t.slice(0, eq).trim()] = v;
  }
  return out;
}

function appendEnv(p, key, value) {
  let txt = "";
  try { txt = fs.readFileSync(p, "utf8"); } catch { /* new file */ }
  if (new RegExp(`^${key}=`, "m").test(txt)) {
    txt = txt.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
  } else {
    if (txt && !txt.endsWith("\n")) txt += "\n";
    txt += `${key}=${value}\n`;
  }
  fs.writeFileSync(p, txt, { mode: 0o600 });
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} "${url}"`, () => {});
}

const env = loadEnv(ENV_PATH);
const CLIENT_ID = env.GDRIVE_OAUTH_CLIENT_ID || process.env.GDRIVE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = env.GDRIVE_OAUTH_CLIENT_SECRET || process.env.GDRIVE_OAUTH_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "\nMissing OAuth client. Put these in bridge/.env first:\n" +
    "  GDRIVE_OAUTH_CLIENT_ID=...apps.googleusercontent.com\n" +
    "  GDRIVE_OAUTH_CLIENT_SECRET=...\n\n" +
    "Create them at: GCP Console > APIs & Services > Credentials > Create credentials >\n" +
    "OAuth client ID > Application type: Desktop app  (project: buildcost-portal).\n" +
    "Also enable the Google Drive API for that project.\n",
  );
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // force a refresh_token even on re-grant
  }).toString();

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT_URI);
  const code = u.searchParams.get("code");
  const err = u.searchParams.get("error");
  if (err) {
    res.end(`Authorization failed: ${err}. You can close this tab.`);
    console.error(`\nAuthorization failed: ${err}\n`);
    server.close();
    process.exit(1);
    return;
  }
  if (!code) { res.end("Waiting for Google authorization…"); return; }
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    const j = await tokenRes.json();
    if (!tokenRes.ok || !j.refresh_token) {
      const why = j.refresh_token ? "" : " (no refresh_token returned — revoke prior access at myaccount.google.com/permissions and retry)";
      res.end("Could not get a refresh token. Check the terminal." + why);
      console.error("\nToken exchange problem:", JSON.stringify(j, null, 2), why, "\n");
      server.close();
      process.exit(1);
      return;
    }
    appendEnv(ENV_PATH, "GDRIVE_OAUTH_REFRESH_TOKEN", j.refresh_token);
    res.end("✅ Google Drive connected. You can close this tab and return to the terminal.");
    console.log(
      "\n✅ Drive connected. GDRIVE_OAUTH_REFRESH_TOKEN written to bridge/.env" +
      "\n   Restart the bridge to pick it up:" +
      "\n     launchctl kickstart -k gui/$(id -u)/com.buildcost.portal-bridge\n",
    );
    server.close();
    process.exit(0);
  } catch (e) {
    res.end("Token exchange failed. Check the terminal.");
    console.error("\nToken exchange failed:", e?.message || e, "\n");
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\nOpening Google consent in your browser…\nIf it doesn't open, paste this URL:\n\n${authUrl}\n`);
  openBrowser(authUrl);
});
