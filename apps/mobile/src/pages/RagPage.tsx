import { useState, useEffect, useCallback, useRef } from "react";
import { TopBar } from "../components/TopBar";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  BookOpen, Upload, Trash2, RefreshCw, Search,
  FileText, CheckCircle2, AlertTriangle, Loader, X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { readTextFile } from "../ipc";
import {
  ingestDocument, listDocuments, deleteDocument, searchChunks,
  type RagDocument, type RagChunk,
} from "../store/ragStore";

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Dialog filter extensions must stay in sync with:
 *  - ALLOWED_EXTENSIONS in rag.rs
 *  - rag.supportedFormats i18n key
 */
const DIALOG_EXTENSIONS = [
  "txt", "md", "markdown", "csv", "log",
  "json", "yaml", "yml", "rst", "html", "htm",
  "tex", "org", "toml", "conf", "ini",
];

// ── File ingestion ─────────────────────────────────────────────────────────

async function importFile(): Promise<{ name: string; content: string; path: string } | null> {
  const selected = await openDialog({
    multiple: false,
    filters: [{ name: "Text files", extensions: DIALOG_EXTENSIONS }],
  });
  if (!selected || typeof selected !== "string") return null;

  // Use the typed ipc.ts wrapper instead of raw invoke()
  const content = await readTextFile(selected);
  const name    = selected.split(/[/\\]/).pop() ?? selected;
  return { name, content, path: selected };
}

// ── DocumentRow ────────────────────────────────────────────────────────────

function DocumentRow({
  doc,
  onDelete,
}: {
  doc: RagDocument;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [deleting,   setDeleting]   = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const date = new Date(doc.createdAt).toLocaleString(undefined, {
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });

  const handleConfirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(doc.id);
      setConfirming(false);
    } catch (e) {
      setDeleteError(typeof e === "string" ? e : t("rag.deleteError"));
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <FileText size={15} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{doc.name}</p>
          <p className="text-xs text-muted-foreground">
            {doc.chunkCount} {t("rag.chunks")} · {(doc.charCount / 1000).toFixed(1)}K {t("rag.chars")} · {date}
          </p>
        </div>
        {confirming ? (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-xs text-red-500">{t("rag.confirmDelete")}</span>
            <button
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="px-2 py-0.5 rounded text-xs bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
            >
              {deleting ? <Loader size={10} className="animate-spin" /> : t("common.confirm")}
            </button>
            <button
              onClick={() => { setConfirming(false); setDeleteError(null); }}
              disabled={deleting}
              className="px-2 py-0.5 rounded text-xs border border-border hover:bg-muted/50 disabled:opacity-50 transition-colors"
            >
              {t("common.cancel")}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
            title={t("common.delete")}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {deleteError && (
        <div className="flex items-center gap-2 px-4 py-2 border-t border-red-200 bg-red-50 text-xs text-red-600">
          <AlertTriangle size={12} />
          {deleteError}
        </div>
      )}
    </div>
  );
}

// ── SearchPreview ──────────────────────────────────────────────────────────

function SearchPreview() {
  const { t } = useTranslation();
  const [query,     setQuery]     = useState("");
  const [results,   setResults]   = useState<RagChunk[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  // Version counter prevents stale responses from overwriting newer results.
  // Each call increments the counter and checks it after awaiting; if the
  // counter has changed, a newer call is in-flight and this response is dropped.
  const searchVersion = useRef(0);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setSearchErr(null); return; }

    // Claim this version slot before the first await
    const version = ++searchVersion.current;

    setSearching(true);
    setSearchErr(null);
    try {
      const r = await searchChunks(q, 4);
      // Discard result if a newer search was already started
      if (version !== searchVersion.current) return;
      setResults(r);
    } catch (e) {
      if (version !== searchVersion.current) return;
      setSearchErr(typeof e === "string" ? e : t("rag.searchError"));
      setResults([]);
    } finally {
      // Only clear the spinner if this is still the active search
      if (version === searchVersion.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => doSearch(query), 400);
    return () => clearTimeout(id);
  }, [query, doSearch]);

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Search size={14} />
        {t("rag.searchPreview")}
      </h2>
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("rag.searchPlaceholder")}
          className="w-full px-3 py-2 pr-8 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {searching && (
          <Loader size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        {query && !searching && (
          <button
            onClick={() => { setQuery(""); setResults([]); setSearchErr(null); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {searchErr && (
        <div className="flex items-center gap-2 text-xs text-red-600">
          <AlertTriangle size={12} /> {searchErr}
        </div>
      )}

      {results.length === 0 && query.trim() && !searching && !searchErr && (
        <p className="text-xs text-muted-foreground">{t("rag.noResults")}</p>
      )}

      <div className="space-y-2 max-h-60 overflow-y-auto">
        {results.map((chunk, i) => (
          <div key={chunk.id} className="p-3 rounded-lg bg-muted/30 border border-border text-xs leading-relaxed">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-semibold text-primary">[{i + 1}]</span>
              {chunk.score !== undefined && (
                <span className="text-[10px] text-muted-foreground">
                  {t("rag.relevance")} {(chunk.score * 100).toFixed(0)}%
                </span>
              )}
            </div>
            {chunk.content}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export function RagPage() {
  const { t } = useTranslation();
  const [docs,         setDocs]         = useState<RagDocument[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [importing,    setImporting]    = useState(false);
  const [importResult, setImportResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setDocs(await listDocuments());
    } catch (e) {
      setLoadError(typeof e === "string" ? e : t("rag.loadError"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleImport = async () => {
    setImporting(true);
    try {
      const file = await importFile();
      // User cancelled the dialog — don't clear the previous result
      if (!file) return;

      // Clear previous result only once we know we have a file to import
      setImportResult(null);
      const { chunkCount } = await ingestDocument(file.name, file.content, file.path);
      setImportResult({
        ok: true,
        msg: t("rag.importSuccess", { name: file.name, count: chunkCount }),
      });
      // Reload list independently so a load() failure doesn't overwrite the success message
      listDocuments().then(setDocs).catch(console.error);
    } catch (e) {
      setImportResult({ ok: false, msg: String(e) });
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (docId: string) => {
    await deleteDocument(docId);
    setDocs((prev) => prev.filter((d) => d.id !== docId));
  };

  return (
    <div className="flex flex-col h-full">
    <TopBar title={t("rag.title")} subtitle={t("rag.desc")} back />
    <div className="flex-1 scrollable p-4 space-y-4 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen size={22} className="text-primary" />
            {t("rag.title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">{t("rag.desc")}</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-muted/60 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {t("common.refresh")}
        </button>
      </div>

      {/* How-it-works banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl border border-primary/20 bg-primary/5">
        <BookOpen size={16} className="text-primary flex-shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
          <p className="font-semibold text-foreground">{t("rag.howTitle")}</p>
          {(t("rag.howSteps", { returnObjects: true }) as string[]).map((s, i) => (
            <p key={i}>• {s}</p>
          ))}
        </div>
      </div>

      {/* Import button + result */}
      <div className="space-y-2">
        <button
          onClick={handleImport}
          disabled={importing}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {importing ? <Loader size={15} className="animate-spin" /> : <Upload size={15} />}
          {importing ? t("rag.importing") : t("rag.import")}
        </button>

        {importResult && (
          <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
            importResult.ok
              ? "bg-green-500/8 border border-green-500/20 text-green-700"
              : "bg-red-500/8 border border-red-500/20 text-red-700"
          }`}>
            {importResult.ok
              ? <CheckCircle2 size={15} className="flex-shrink-0 mt-0.5" />
              : <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />}
            {importResult.msg}
          </div>
        )}
      </div>

      {/* Document list */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">
          {t("rag.documents")}
          {docs.length > 0 && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">({docs.length})</span>
          )}
        </h2>

        {loadError && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/8 border border-red-500/20 text-sm text-red-700">
            <AlertTriangle size={14} className="flex-shrink-0" />
            {loadError}
          </div>
        )}

        {docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 rounded-xl border border-dashed border-border text-muted-foreground text-sm">
            <FileText size={24} className="mb-2 opacity-30" />
            {t("rag.empty")}
          </div>
        ) : (
          <div className="space-y-2">
            {docs.map((doc) => (
              <DocumentRow key={doc.id} doc={doc} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      {/* Search preview (only when docs exist) */}
      {docs.length > 0 && <SearchPreview />}

      {/* Supported formats note */}
      <p className="text-xs text-muted-foreground">{t("rag.supportedFormats")}</p>
    </div>
    </div>
  );
}
