const BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const DEV_AUTH = import.meta.env.VITE_DEV_AUTH_ENABLED === "true";
const LOGIN_URL = import.meta.env.VITE_AUTH_LOGIN_URL || "";
const CSRF_COOKIE_NAME = import.meta.env.VITE_CSRF_COOKIE_NAME || "legal_csrf";
const CSRF_HEADER_NAME = "X-Legal-CSRF";


function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(";")) {
    const item = part.trim();
    if (item.startsWith(prefix)) return decodeURIComponent(item.slice(prefix.length));
  }
  return "";
}

function isUnsafeMethod(method?: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes((method || "GET").toUpperCase());
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (DEV_AUTH) {
    const tenant = import.meta.env.VITE_DEV_TENANT_ID || "";
    const user = import.meta.env.VITE_DEV_USER_ID || "";
    if (tenant && user) {
      headers["X-Dev-Tenant-Id"] = tenant;
      headers["X-Dev-User-Id"] = user;
    }
  }
  return headers;
}

export type AuthSession = {
  authenticated: true;
  user_id: string;
  tenant_id: string;
  roles: string[];
  auth_source: "EFATA_NATIVE_SESSION" | "DEV";
};

export type LegalCase = {
  id: string;
  case_code: string;
  case_type: string;
  title: string;
  status: string;
  source_system: string;
  confidentiality: string;
};

export type LegalDocument = {
  id: string;
  filename: string;
  mime_type: string;
  sha256: string;
  source_system: string;
  source_status: string;
  review_status: string;
};

export type EvidenceNode = {
  id: string;
  node_type: string;
  title: string;
  payload: Record<string, unknown>;
  source_status: string;
  review_status: string;
};

export type AgentSeat = {
  id: string;
  agent_type: string;
  display_name: string;
  scope_type: string;
  memory_scope: string;
  billing_class: string;
};

export type JudicialBinding = {
  id: string;
  external_process_id: string;
  connection: {
    id: string | null;
    system: string | null;
    name: string | null;
    status: string | null;
  };
};

export type JudicialDocumentRef = {
  id: string;
  external_document_id: string;
  title: string;
  mime_type: string | null;
  document_type: string;
  status: string;
  legal_document_id: string | null;
};

export type CaseBriefing = {
  mode: string;
  external_write_allowed: boolean;
  human_review_required: boolean;
  events: Array<{
    id: string;
    external_event_id: string;
    title: string;
    event_type: string;
    event_at: string | null;
    source_system: string;
  }>;
  documents: JudicialDocumentRef[];
  pending_human_review_count: number;
  summary: {
    recent_event_count: number;
    discovered_document_count: number;
    fetched_document_count: number;
  };
};

export type EfataStatus = {
  mode: string;
  database_access: string;
  m2m_only: boolean;
  capability_contract: string;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  for (const [key, value] of Object.entries(authHeaders())) headers.set(key, value);
  if (!DEV_AUTH && isUnsafeMethod(init.method)) {
    const csrf = readCookie(CSRF_COOKIE_NAME);
    if (csrf) headers.set(CSRF_HEADER_NAME, csrf);
  }

  const response = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...init,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401 && !DEV_AUTH && LOGIN_URL && typeof window !== "undefined") {
      window.location.assign(LOGIN_URL);
    }
    const body = await response.text();
    throw new Error(body || `HTTP_${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const getAuthSession = () => request<AuthSession>("/api/v1/auth/session");
export const listCases = () => request<LegalCase[]>("/api/v1/cases");
export const listDocuments = (caseId: string) =>
  request<LegalDocument[]>(`/api/v1/cases/${caseId}/documents`);
export const getEvidence = (caseId: string) =>
  request<{ nodes: EvidenceNode[]; links: unknown[] }>(`/api/v1/cases/${caseId}/evidence`);
export const listAgents = () => request<AgentSeat[]>("/api/v1/agents");
export const getEfataStatus = () => request<EfataStatus>("/api/v1/integration/efata/status");
export const listJudicialBindings = (caseId: string) =>
  request<JudicialBinding[]>(`/api/v1/cases/${caseId}/judicial/bindings`);
export const listJudicialDocuments = (caseId: string) =>
  request<JudicialDocumentRef[]>(`/api/v1/cases/${caseId}/judicial/documents`);
export const getCaseBriefing = (caseId: string) =>
  request<CaseBriefing>(`/api/v1/cases/${caseId}/agent/briefing`);

export async function syncJudicial(caseId: string, bindingId: string) {
  return request<{
    execution_id: string;
    status: string;
    events_new: number;
    documents_new: number;
    idempotent_replay: boolean;
  }>(`/api/v1/cases/${caseId}/judicial/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      binding_id: bindingId,
      idempotency_key: crypto.randomUUID(),
    }),
  });
}

export async function fetchJudicialDocument(caseId: string, refId: string) {
  return request<{ id: string; status: string; legal_document_id: string | null }>(
    `/api/v1/cases/${caseId}/judicial/documents/fetch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref_id: refId }),
    },
  );
}

export async function uploadDocument(caseId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  form.append("document_type", "OTHER");
  form.append("source_system", "MANUAL");
  return request<{ id: string; sha256: string; review_status: string }>(
    `/api/v1/cases/${caseId}/documents`,
    { method: "POST", body: form },
  );
}
