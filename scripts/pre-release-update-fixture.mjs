import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const fixtureId = "upgrade-proof";
const draft = "Preserve this unsent draft across the release upgrade.";
const prompt = "Queued follow-up: inspect the retained screenshot without modifying files.";
const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function preparePreviousReleaseFixture(target, profile, env) {
  const boot = Bun.spawn([target, "--ui-smoke", "--ui-smoke-auto-close"], {
    cwd: dirname(target), env: { ...env, WHEELJACK_UI_SMOKE_AUTO_CLOSE: "1", WHEELJACK_DESKTOP_VERSION_OVERRIDE: "999.0.0" }, stdout: "ignore", stderr: "ignore",
  });
  let timer;
  try {
    await Promise.race([boot.exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Previous public executable did not finish fixture initialization.")), 90_000); })]);
  } finally { clearTimeout(timer); boot.kill(); }
  const resultPath = join(profile, "ui-smoke-result.json");
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  if (!result.ok) throw new Error(`Previous release initialization failed: ${result.message}`);
  await rm(resultPath);
  const projectPath = join(profile, "upgrade-project");
  const attachmentPath = join(profile, "attachments", "upgrade-proof.png");
  await mkdir(projectPath, { recursive: true });
  await mkdir(dirname(attachmentPath), { recursive: true });
  await writeFile(attachmentPath, imageBytes);
  const db = new Database(join(profile, "wheeljack.sqlite3"));
  try {
    const schema = db.query("PRAGMA user_version").get().user_version;
    if (schema !== 21) throw new Error(`Expected the previous public release to own schema 21; observed ${schema}.`);
    const timestamp = new Date().toISOString();
    const image = { path: attachmentPath, fileName: "upgrade-proof.png", mimeType: "image/png" };
    const data = { adapterId: "codex-cli", sessionId: fixtureId, status: "disconnected", cwd: projectPath,
      chatComposition: { version: 1, draft, attachments: [image], scrollTop: 123, followLatest: false } };
    const payload = { prompt, historyText: prompt, standingRoleApplied: false, imagePaths: [attachmentPath] };
    db.transaction(() => {
      db.run("INSERT INTO projects (id,name,path,created_at,updated_at) VALUES (?,?,?,?,?)", [fixtureId, "Upgrade preservation fixture", projectPath, timestamp, timestamp]);
      db.run("INSERT INTO canvases (id,project_id,name,camera_json,created_at,updated_at) VALUES (?,?,?,?,?,?)", [fixtureId, fixtureId, "Fixture", JSON.stringify({ x: 0, y: 0, scale: 1 }), timestamp, timestamp]);
      db.run("INSERT INTO nodes (id,canvas_id,kind,title,x,y,width,height,z_index,data_json,created_at,updated_at) VALUES (?,?,?,?,0,0,600,400,1,?,?,?)", [fixtureId, fixtureId, "agent_terminal", "Upgrade proof agent", JSON.stringify(data), timestamp, timestamp]);
      db.run("INSERT INTO sessions (id,node_id,node_title,adapter_id,command_json,cwd,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", [fixtureId, fixtureId, "Upgrade proof agent", "codex-cli", "[]", projectPath, "disconnected", timestamp, timestamp]);
      db.run("INSERT INTO session_prompt_deliveries (id,session_id,seq,mode,state,payload_json,created_at,updated_at) VALUES (?,?,1,'next','queued',?,?,?)", [fixtureId, fixtureId, JSON.stringify(payload), timestamp, timestamp]);
      db.run("INSERT INTO session_chunks (session_id,seq,stream,data,created_at) VALUES (?,1,'stdout',?,?)", [fixtureId, Buffer.from("Preserved historical answer."), timestamp]);
    })();
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally { db.close(); }
  return verifyUpgradeFixture(profile, 21);
}

export async function verifyUpgradeFixture(profile, expectedSchema, requireMetadata = false) {
  const db = new Database(join(profile, "wheeljack.sqlite3"), { readonly: true });
  try {
    const schema = db.query("PRAGMA user_version").get().user_version;
    if (expectedSchema !== undefined && schema !== expectedSchema) throw new Error(`Expected schema ${expectedSchema}, observed ${schema}.`);
    if (db.query("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("Upgraded SQLite integrity check failed.");
    if (db.query("PRAGMA foreign_key_check").all().length) throw new Error("Upgraded SQLite contains a broken foreign key.");
    const node = db.query("SELECT data_json FROM nodes WHERE id=?").get(fixtureId);
    const composition = JSON.parse(node?.data_json ?? "{}").chatComposition;
    if (composition?.draft !== draft || composition?.attachments?.length !== 1 || composition.scrollTop !== 123 || composition.followLatest !== false) throw new Error("Unsent draft, attachment metadata, or scroll position changed during upgrade.");
    const imagePath = composition.attachments[0].path;
    if (digest(await readFile(imagePath)) !== digest(imageBytes)) throw new Error("The referenced attachment bytes changed during upgrade.");
    const delivery = db.query("SELECT * FROM session_prompt_deliveries WHERE id=?").get(fixtureId);
    const payload = JSON.parse(delivery?.payload_json ?? "{}");
    if (!((delivery?.state === "queued") || (delivery?.state === "blocked" && delivery.error_code === "session_not_running")) || delivery.session_id !== fixtureId || payload.prompt !== prompt || payload.imagePaths?.[0] !== imagePath || delivery.attempts !== 0 || delivery.delivered_at !== null) throw new Error("The queued follow-up or its image reference changed during upgrade.");
    if (requireMetadata && (delivery.request_session_id !== fixtureId || !delivery.payload_fingerprint)) throw new Error("The candidate did not backfill the pending prompt idempotency fields.");
    const transcript = db.query("SELECT CAST(data AS TEXT) AS text FROM session_chunks WHERE session_id=? AND seq=1").get(fixtureId)?.text;
    if (transcript !== "Preserved historical answer.") throw new Error("Historical transcript changed during upgrade.");
    return { schema, queueState: delivery.state, queueRecoveryReason: delivery.error_code, queuedPromptPreserved: true, draftPreserved: true, attachmentPreserved: true, transcriptPreserved: true, attachmentSha256: digest(imageBytes), fingerprintBackfilled: Boolean(delivery.payload_fingerprint) };
  } finally { db.close(); }
}
