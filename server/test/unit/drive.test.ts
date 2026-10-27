import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import {
  GoogleDrive,
  DRIVE_SCOPE,
  TOKEN_URL,
  readDriveClient,
  readDriveToken,
  type DriveSettings,
} from "../../src/backups/drive.js";
import { authorizeDrive } from "../../src/backups/drive-auth.js";

async function fixture(t: { after: (work: () => Promise<void>) => void }) {
  const parent = resolve(".tmp");
  await mkdir(parent, { recursive: true });
  const folder = await mkdtemp(join(parent, "drive-unit-"));
  t.after(async () => {
    assert.ok(folder.startsWith(parent + sep));
    await rm(folder, { recursive: true, force: true });
  });
  const settings: DriveSettings = {
    DRIVE_CLIENT_FILE: join(folder, "client.json"),
    DRIVE_TOKEN_FILE: join(folder, "token.json"),
    DRIVE_FOLDER_ID: "test-folder",
    BACKUP_TIMEOUT_MS: 5000,
  };
  await writeFile(
    settings.DRIVE_CLIENT_FILE,
    JSON.stringify({
      installed: {
        client_id: "test.apps.googleusercontent.com",
        client_secret: "secret-value",
        token_uri: "https://evil.invalid/token",
      },
    }),
  );
  await writeFile(
    settings.DRIVE_TOKEN_FILE,
    JSON.stringify({
      client_id: "test.apps.googleusercontent.com",
      refresh_token: "refresh-private",
    }),
  );
  return { folder, settings };
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const oauth = () => json({ access_token: "access-private", expires_in: 3600 });
const session =
  "https://www.googleapis.com/upload/drive/v3/files?upload_id=test";

test("Drive v3: renueva OAuth, sube bloques acotados y consulta metadata sin enviar secretos a otros destinos", async (t) => {
  const f = await fixture(t);
  const file = join(f.folder, "backup.dump");
  const bytes = Buffer.alloc(8 * 1024 * 1024 + 17, 7);
  await writeFile(file, bytes);
  const chunks: Buffer[] = [],
    calls: string[] = [];
  let tokenRequests = 0;
  const http: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    assert.equal(init?.redirect, "error");
    if (url === TOKEN_URL) {
      tokenRequests++;
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("client_secret"), "secret-value");
      assert.equal(body.get("refresh_token"), "refresh-private");
      return oauth();
    }
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer access-private",
    );
    if (url.includes("generateIds")) return json({ ids: ["file-id"] });
    if (init?.method === "POST") {
      assert.deepEqual(JSON.parse(String(init.body)), {
        id: "file-id",
        name: "copy.dump",
        parents: ["test-folder"],
        mimeType: "application/octet-stream",
      });
      return new Response(null, {
        status: 200,
        headers: { location: session },
      });
    }
    if (init?.method === "PUT") {
      chunks.push(Buffer.from(init.body as Uint8Array));
      assert.ok(chunks.at(-1)!.length <= 8 * 1024 * 1024);
      return chunks.length === 1
        ? new Response(null, {
            status: 308,
            headers: { range: "bytes=0-8388607" },
          })
        : json({ id: "file-id" });
    }
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return json({
      id: "file-id",
      size: String(bytes.length),
      md5Checksum: createHash("md5").update(bytes).digest("hex"),
    });
  };
  const drive = new GoogleDrive(f.settings, http, async () => {});
  assert.equal(await drive.generateId(), "file-id");
  await drive.upload("file-id", file, "copy.dump");
  const metadata = await drive.metadata("file-id");
  assert.equal(metadata.size, String(bytes.length));
  assert.deepEqual(Buffer.concat(chunks), bytes);
  assert.equal(tokenRequests, 1);
  await drive.remove("file-id");
  assert.ok(
    calls.every((url) => new URL(url).hostname.endsWith("googleapis.com")),
  );
});

test("Drive recupera una subida tras fallo de red consultando el rango confirmado", async (t) => {
  const f = await fixture(t),
    file = join(f.folder, "copy.dump");
  await writeFile(file, "PGDMPpayload");
  let puts = 0,
    queries = 0;
  const drive = new GoogleDrive(
    f.settings,
    async (url, init) => {
      if (String(url) === TOKEN_URL) return oauth();
      if (init?.method === "POST")
        return new Response(null, { headers: { location: session } });
      if (
        new Headers(init?.headers).get("content-range")?.startsWith("bytes */")
      ) {
        queries++;
        return new Response(null, {
          status: 308,
          headers: { range: "bytes=0-3" },
        });
      }
      if (++puts === 1) throw Error("connection reset");
      assert.equal(
        new Headers(init?.headers).get("content-range"),
        "bytes 4-11/12",
      );
      assert.equal(
        Buffer.from(init?.body as Uint8Array).toString(),
        "Ppayload",
      );
      return json({ id: "file-id" });
    },
    async () => {},
  );
  await drive.upload("file-id", file, "copy.dump");
  assert.equal(queries, 1);
});

test("Drive rechaza sesiones de subida fuera de Google sin enviarles el token", async (t) => {
  const f = await fixture(t),
    file = join(f.folder, "copy.dump");
  await writeFile(file, "PGDMPpayload");
  const calls: string[] = [];
  const drive = new GoogleDrive(f.settings, async (url) => {
    calls.push(String(url));
    return String(url) === TOKEN_URL
      ? oauth()
      : new Response(null, {
          headers: { location: "https://evil.invalid/upload" },
        });
  });
  await assert.rejects(drive.upload("file-id", file, "copy.dump"), /Sesión/);
  assert.ok(!calls.some((url) => url.includes("evil.invalid")));
});

test("Drive reintenta cuotas y errores transitorios, renueva ante 401 y limita los intentos", async (t) => {
  const f = await fixture(t);
  let tokens = 0,
    requests = 0;
  const drive = new GoogleDrive(
    f.settings,
    async (url) => {
      if (String(url) === TOKEN_URL) {
        tokens++;
        return oauth();
      }
      requests++;
      if (requests === 1) return new Response(null, { status: 401 });
      if (requests === 2)
        return json(
          { error: { errors: [{ reason: "userRateLimitExceeded" }] } },
          403,
        );
      if (requests === 3) return new Response(null, { status: 503 });
      return json({ id: "file-id" });
    },
    async () => {},
  );
  assert.equal((await drive.metadata("file-id")).id, "file-id");
  assert.equal(tokens, 2);
  assert.equal(requests, 4);
  let failures = 0;
  const unavailable = new GoogleDrive(
    f.settings,
    async (url) => {
      if (String(url) === TOKEN_URL) return oauth();
      failures++;
      return new Response(null, { status: 503 });
    },
    async () => {},
  );
  await assert.rejects(unavailable.metadata("file-id"), /rechazó/);
  assert.equal(failures, 4);
});

test("Drive no filtra respuestas OAuth, persiste rotación y rechaza credenciales incompatibles", async (t) => {
  const f = await fixture(t);
  const denied = new GoogleDrive(f.settings, async () =>
    json({ error: "secret-value refresh-private" }, 400),
  );
  await assert.rejects(
    denied.generateId(),
    (error: Error) =>
      !error.message.includes("private") && /autoriza/.test(error.message),
  );
  const rotated = new GoogleDrive(f.settings, async (url) =>
    String(url) === TOKEN_URL
      ? json({
          access_token: "new-access",
          refresh_token: "rotated-private",
          expires_in: 3600,
        })
      : json({ ids: ["file-id"] }),
  );
  await rotated.generateId();
  assert.equal(
    (
      await readDriveToken(
        f.settings.DRIVE_TOKEN_FILE,
        "test.apps.googleusercontent.com",
      )
    ).refresh_token,
    "rotated-private",
  );
  assert.ok(!(await readdir(f.folder)).some((name) => name.endsWith(".tmp")));
  await assert.rejects(
    readDriveToken(
      f.settings.DRIVE_TOKEN_FILE,
      "other.apps.googleusercontent.com",
    ),
  );
  await writeFile(
    f.settings.DRIVE_CLIENT_FILE,
    JSON.stringify({ web: { client_id: "wrong" } }),
  );
  await assert.rejects(
    readDriveClient(f.settings.DRIVE_CLIENT_FILE),
    /escritorio/,
  );
});

test("OAuth local usa state y PKCE, rechaza callback falso y guarda solamente refresh token", async (t) => {
  const f = await fixture(t);
  let authUrl: URL | undefined;
  const logs: string[] = [];
  let callbackDone: Promise<void> | undefined;
  await authorizeDrive(f.settings, {
    timeoutMs: 3000,
    log: (message) => logs.push(message),
    openBrowser: (url) => {
      authUrl = new URL(url);
      callbackDone = (async () => {
        const callback = new URL(authUrl!.searchParams.get("redirect_uri")!);
        assert.equal(callback.hostname, "127.0.0.1");
        callback.search = new URLSearchParams({
          state: "wrong",
          code: "fake",
        }).toString();
        assert.equal((await fetch(callback)).status, 400);
        callback.searchParams.set("state", authUrl!.searchParams.get("state")!);
        callback.searchParams.set("code", "valid-code");
        assert.equal((await fetch(callback)).status, 200);
      })();
      void callbackDone.catch(() => {});
    },
    http: async (url, init) => {
      assert.equal(String(url), TOKEN_URL);
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("code"), "valid-code");
      assert.equal(
        createHash("sha256")
          .update(body.get("code_verifier")!)
          .digest("base64url"),
        authUrl!.searchParams.get("code_challenge"),
      );
      return json({
        refresh_token: "authorized-private",
        access_token: "never-persist",
        scope: DRIVE_SCOPE,
      });
    },
  });
  await callbackDone;
  assert.equal(authUrl!.searchParams.get("scope"), DRIVE_SCOPE);
  assert.equal(authUrl!.searchParams.get("access_type"), "offline");
  assert.ok(!logs.join().includes("secret-value"));
  const stored = await readFile(f.settings.DRIVE_TOKEN_FILE, "utf8");
  assert.ok(stored.includes("authorized-private"));
  assert.ok(!stored.includes("never-persist"));
});

test("OAuth local cancela al vencer el plazo y conserva la autorización anterior", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    authorizeDrive(f.settings, {
      timeoutMs: 20,
      openBrowser: () => {},
      log: () => {},
    }),
    /venció/,
  );
  assert.equal(
    (
      await readDriveToken(
        f.settings.DRIVE_TOKEN_FILE,
        "test.apps.googleusercontent.com",
      )
    ).refresh_token,
    "refresh-private",
  );
});
