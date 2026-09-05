import { useEffect, useMemo, useState } from "react";
import {
  fetchJudicialDocument,
  getAuthSession,
  getCaseBriefing,
  getEfataStatus,
  getEvidence,
  listAgents,
  listCases,
  listDocuments,
  listJudicialBindings,
  listJudicialDocuments,
  syncJudicial,
  uploadDocument,
  type AgentSeat,
  type AuthSession,
  type CaseBriefing,
  type EfataStatus,
  type EvidenceNode,
  type JudicialBinding,
  type JudicialDocumentRef,
  type LegalCase,
  type LegalDocument,
} from "./api";

type Tab =
  | "overview"
  | "judicial"
  | "case-agent"
  | "documents"
  | "evidence"
  | "agents"
  | "drafting"
  | "integration";

const tabs: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "Visão geral" },
  { key: "judicial", label: "Judicial Hub" },
  { key: "case-agent", label: "Case Agent" },
  { key: "documents", label: "Documentos" },
  { key: "evidence", label: "Evidências" },
  { key: "agents", label: "Agentes" },
  { key: "drafting", label: "Legal Drafting" },
  { key: "integration", label: "Integrações" },
];

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [cases, setCases] = useState<LegalCase[]>([]);
  const [caseId, setCaseId] = useState("");
  const [documents, setDocuments] = useState<LegalDocument[]>([]);
  const [evidence, setEvidence] = useState<EvidenceNode[]>([]);
  const [agents, setAgents] = useState<AgentSeat[]>([]);
  const [bindings, setBindings] = useState<JudicialBinding[]>([]);
  const [judicialDocs, setJudicialDocs] = useState<JudicialDocumentRef[]>([]);
  const [briefing, setBriefing] = useState<CaseBriefing | null>(null);
  const [integration, setIntegration] = useState<EfataStatus | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  const selected = useMemo(
    () => cases.find((item) => item.id === caseId) || null,
    [cases, caseId],
  );

  async function loadCase(id: string) {
    if (!id) return;
    const [docs, graph, judicialBindings, refs, caseBriefing] = await Promise.all([
      listDocuments(id),
      getEvidence(id),
      listJudicialBindings(id),
      listJudicialDocuments(id),
      getCaseBriefing(id),
    ]);
    setDocuments(docs);
    setEvidence(graph.nodes);
    setBindings(judicialBindings);
    setJudicialDocs(refs);
    setBriefing(caseBriefing);
  }

  async function bootstrap() {
    try {
      setError("");
      const [nativeSession, caseRows, agentRows, efata] = await Promise.all([
        getAuthSession(),
        listCases(),
        listAgents(),
        getEfataStatus(),
      ]);
      setSession(nativeSession);
      setCases(caseRows);
      setAgents(agentRows);
      setIntegration(efata);
      const id = caseId || caseRows[0]?.id || "";
      setCaseId(id);
      if (id) await loadCase(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "LOAD_FAILED");
    }
  }

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!caseId) return;
    void loadCase(caseId).catch((err) =>
      setError(err instanceof Error ? err.message : "CASE_LOAD_FAILED"),
    );
  }, [caseId]);

  async function handleSync() {
    if (!caseId || !bindings[0]) return;
    setBusy(true);
    setSyncMessage("");
    try {
      const result = await syncJudicial(caseId, bindings[0].id);
      setSyncMessage(
        `Sync ${result.status}: ${result.events_new} eventos e ${result.documents_new} documentos novos.`,
      );
      await loadCase(caseId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "JUDICIAL_SYNC_FAILED");
    } finally {
      setBusy(false);
    }
  }

  async function handleFetch(refId: string) {
    if (!caseId) return;
    setBusy(true);
    try {
      await fetchJudicialDocument(caseId, refId);
      await loadCase(caseId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "DOCUMENT_FETCH_FAILED");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-orbit" aria-hidden="true">O</div>
          <div>
            <p className="eyebrow">ORKIO Vertical</p>
            <h1>Legal Administration</h1>
          </div>
        </div>

        <nav>
          {tabs.map((item) => (
            <button
              key={item.key}
              className={tab === item.key ? "active" : ""}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sovereignty">
          <span>Data sovereignty</span>
          <strong>Client DB isolated</strong>
          <small>External DB access: DENY</small>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <span className="field-label">Processo autorizado</span>
            <select value={caseId} onChange={(event) => setCaseId(event.target.value)}>
              {cases.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.case_code} — {item.title}
                </option>
              ))}
            </select>
          </div>
          <div className="status-row">
            <span className="pill">Sessão: {session?.auth_source || "…"}</span>
            <span className="pill">EFATÀ: {integration?.mode || "…"}</span>
            <span className="pill">Judicial: READ-ONLY</span>
          </div>
        </header>

        {error && <div className="error">{error}</div>}
        {syncMessage && <div className="success">{syncMessage}</div>}

        {tab === "overview" && (
          <section>
            <div className="hero">
              <p className="eyebrow">Case Intelligence</p>
              <h2>{selected?.title || "Nenhum processo autorizado"}</h2>
              <p>
                {selected?.case_code} · {selected?.case_type} · {selected?.source_system}
              </p>
            </div>
            <div className="metrics">
              <Metric label="Documentos" value={documents.length} />
              <Metric label="Evidências" value={evidence.length} />
              <Metric label="Eventos judiciais" value={briefing?.summary.recent_event_count || 0} />
              <Metric label="Revisões pendentes" value={briefing?.pending_human_review_count || 0} />
            </div>
            <article className="card governance">
              <h3>Governança operacional</h3>
              <p>Tenant + CaseAccess + Capability</p>
              <p>Evidence-first</p>
              <p>Human Review obrigatório</p>
              <p>Sign / File / Send: bloqueados</p>
            </article>
          </section>
        )}

        {tab === "judicial" && (
          <section className="card">
            <div className="section-head">
              <div>
                <p className="eyebrow">Judicial Integration Hub</p>
                <h2>eproc / MNI — READ-ONLY</h2>
              </div>
              <button className="primary" disabled={busy || bindings.length === 0} onClick={handleSync}>
                {busy ? "Processando…" : "Sincronizar"}
              </button>
            </div>

            {bindings.length === 0 ? (
              <p className="muted">Nenhum vínculo judicial autorizado para este processo.</p>
            ) : (
              <div className="list">
                {bindings.map((binding) => (
                  <div className="list-row" key={binding.id}>
                    <strong>{binding.connection.system} · {binding.connection.name}</strong>
                    <span>{binding.external_process_id}</span>
                    <em>{binding.connection.status}</em>
                  </div>
                ))}
              </div>
            )}

            <h3>Documentos descobertos</h3>
            <div className="list">
              {judicialDocs.map((doc) => (
                <div className="list-row judicial-doc" key={doc.id}>
                  <strong>{doc.title}</strong>
                  <span>{doc.mime_type || "mime desconhecido"} · {doc.status}</span>
                  {doc.status === "DISCOVERED" ? (
                    <button disabled={busy} onClick={() => handleFetch(doc.id)}>
                      Recuperar
                    </button>
                  ) : (
                    <em>Persistido</em>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "case-agent" && (
          <section className="card">
            <p className="eyebrow">Case Agent</p>
            <h2>O que mudou?</h2>
            <div className="notice">
              Resumo determinístico baseado em eventos e documentos persistidos. Nenhuma autoria
              jurídica ou envio externo é inferido automaticamente.
            </div>
            <div className="list">
              {briefing?.events.map((event) => (
                <div className="list-row" key={event.id}>
                  <strong>{event.title}</strong>
                  <span>{event.event_type} · {event.source_system}</span>
                  <time>{event.event_at ? new Date(event.event_at).toLocaleString() : "sem data"}</time>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "documents" && (
          <section className="card">
            <h2>Document Intelligence</h2>
            <input
              type="file"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file || !caseId) return;
                setBusy(true);
                try {
                  await uploadDocument(caseId, file);
                  await loadCase(caseId);
                } finally {
                  setBusy(false);
                }
              }}
            />
            <div className="list">
              {documents.map((doc) => (
                <div className="list-row" key={doc.id}>
                  <strong>{doc.filename}</strong>
                  <span>{doc.source_system} · {doc.review_status}</span>
                  <code>{doc.sha256.slice(0, 16)}…</code>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "evidence" && (
          <section className="card">
            <h2>Evidence Graph</h2>
            <div className="list">
              {evidence.map((node) => (
                <div className="list-row" key={node.id}>
                  <strong>{node.title}</strong>
                  <span>{node.node_type} · {node.source_status}</span>
                  <em>{node.review_status}</em>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "agents" && (
          <section className="card">
            <h2>Executive & Case Agents</h2>
            <div className="agent-grid">
              {agents.map((agent) => (
                <article className="agent-card" key={agent.id}>
                  <strong>{agent.display_name}</strong>
                  <span>{agent.agent_type}</span>
                  <span>{agent.memory_scope}</span>
                  <em>{agent.billing_class}</em>
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === "drafting" && (
          <section className="card">
            <p className="eyebrow">Legal Drafting</p>
            <h2>Evidence-backed drafting</h2>
            <p>
              A Vertical mantém o plano, evidências e quality gate. A execução de inteligência
              pode ser delegada à EFATÀ por contrato M2M quando o modo capability_v1 estiver
              validado no ambiente.
            </p>
            <div className="notice">
              Generate → Human Review → Approve. Sign / File / Send permanecem bloqueados.
            </div>
          </section>
        )}

        {tab === "integration" && (
          <section className="card">
            <h2>Integration Control</h2>
            <dl>
              <dt>EFATÀ mode</dt><dd>{integration?.mode || "unknown"}</dd>
              <dt>M2M only</dt><dd>{String(integration?.m2m_only ?? true)}</dd>
              <dt>EFATÀ database access</dt><dd>{integration?.database_access || "NONE"}</dd>
              <dt>Capability contract</dt><dd>{integration?.capability_contract || "EFATA-CAPABILITY-1"}</dd>
              <dt>Judicial outbound writes</dt><dd>DENY</dd>
            </dl>
          </section>
        )}
      </main>
    </div>
  );
}
