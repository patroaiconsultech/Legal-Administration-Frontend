import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const api = fs.readFileSync("src/api.ts", "utf8");
const app = fs.readFileSync("src/App.tsx", "utf8");
const main = fs.readFileSync("src/main.tsx", "utf8");
const html = fs.readFileSync("index.html", "utf8");

test("frontend calls only the Legal backend and uses canonical native-session cookies", () => {
  assert.match(api, /VITE_API_BASE_URL/);
  assert.doesNotMatch(api, /https?:\/\/[^"'`]*efata/i);
  assert.doesNotMatch(api, /EFATA_SERVICE_TOKEN|CONTROL_PLANE_TOKEN|JUDICIAL_SECRET_/);
  assert.match(api, /credentials:\s*"include"/);
  assert.match(api, /X-Legal-CSRF/);
  assert.match(api, /\/api\/v1\/auth\/session/);
  assert.doesNotMatch(api, /Authorization|Bearer|setAccessToken/);
});

test("judicial workspace is read-only and hides credentials", () => {
  assert.match(api, /\/judicial\/bindings/);
  assert.match(api, /\/judicial\/sync/);
  assert.match(api, /\/judicial\/documents/);
  assert.doesNotMatch(api + app, /idConsultante|senhaConsultante|secret_ref/);
  assert.match(app, /READ-ONLY/);
  assert.match(app, /Judicial Hub/);
});

test("case agent exposes evidence-first change briefing and human review", () => {
  assert.match(api, /\/agent\/briefing/);
  assert.match(app, /O que mudou\?/);
  assert.match(app, /Human Review/);
  assert.match(app, /Sign \/ File \/ Send/);
});

test("EFATA integration is represented as M2M contract state, not direct DB access", () => {
  assert.match(api, /\/api\/v1\/integration\/efata\/status/);
  assert.match(app, /M2M only/);
  assert.match(app, /EFATÀ database access/);
});

test("reconstructed frontend source is clean JSX and HTML", () => {
  assert.doesNotMatch(app + main + html, /\\</);
  assert.doesNotMatch(app + main + html, /```/);
  assert.match(app, /<div className="app-shell">/);
  assert.match(html, /<!doctype html>/i);
});


test("native auth remains a central-session contract, not a second login implementation", () => {
  assert.match(app, /Sessão:/);
  assert.match(api, /VITE_AUTH_LOGIN_URL/);
  assert.doesNotMatch(app + api, /password|senha|login\(/i);
});

test("deployment topology keeps native session same-host via proxy paths", () => {
  const env = fs.readFileSync(".env.example", "utf8");
  const vite = fs.readFileSync("vite.config.ts", "utf8");
  assert.match(env, /VITE_BASE_PATH=\/legal\//);
  assert.match(env, /VITE_API_BASE_URL=\/legal-api/);
  assert.match(vite, /VITE_BASE_PATH/);
});

test("production Docker build requires npm lock and npm ci", () => {
  const docker = fs.readFileSync("Dockerfile", "utf8");
  assert.match(docker, /COPY package\.json package-lock\.json/);
  assert.match(docker, /npm ci/);
  assert.doesNotMatch(docker, /RUN npm install\b/);
});

