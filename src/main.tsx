import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Plus,
  Search,
  Star,
  Archive,
  ArrowUpRight,
  ArrowLeft,
  MoreHorizontal,
  Download,
  Upload,
  Settings,
  Sun,
  Moon,
  Monitor,
  Trash2,
  X,
  Check,
  Copy,
  ChevronDown,
  ChevronRight,
  PanelLeft,
  Layers,
  RotateCcw,
  ShieldCheck,
  Command as CommandIcon,
  ExternalLink,
  LoaderCircle,
} from "lucide-react";
import { api, download } from "./client";
import {
  defaults,
  uid,
  count,
  domain,
  supported,
  matches,
  allTabs,
  errorText,
  type Session,
  type Job,
  type Preferences,
  type Target,
  type SavedTab,
  type Scope,
} from "./model";
import { parseBackup, MAX_BYTES } from "./backup";
import { translator, type Word } from "./i18n";
import "./style.css";
const popup = location.pathname.endsWith("popup.html");
const params = new URLSearchParams(location.search);
const initialTarget: Target = {
  ...(params.has("epoch") ? { epoch: params.get("epoch")! } : {}),
  ...(params.has("window") ? { windowId: Number(params.get("window")) } : {}),
  ...(params.has("tab") ? { tabId: Number(params.get("tab")) } : {}),
};
type Context = {
  target: Target;
  all: number;
  windows: number;
  window: number;
  selected: number;
  excluded: number;
};
type Modal =
  | { kind: "rename"; s: Session }
  | { kind: "erase"; s: Session }
  | { kind: "restore"; s: Session; ids?: string[] }
  | { kind: "import"; text: string; sessions: Session[] }
  | { kind: "settings" }
  | { kind: "privacy" }
  | { kind: "saveClose" }
  | { kind: "current"; tab: SavedTab };
function Logo() {
  return (
    <span className="logo" aria-hidden="true">
      <span />
      <span />
    </span>
  );
}
function Dialog({
  title,
  onClose,
  children,
  busy,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  busy: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button
          className="icon"
          disabled={busy}
          aria-label="Close"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function App() {
  const [preferences, setPreferences] = useState<Preferences>(defaults),
    [sessions, setSessions] = useState<Session[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [context, setContext] = useState<Context>(),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [selectedId, setSelectedId] = useState(""),
    [q, setQ] = useState(""),
    [shelf, setShelf] = useState<"all" | "favorites" | "trash">("all"),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [modal, setModal] = useState<Modal>(),
    [name, setName] = useState(""),
    [mode, setMode] = useState<"original" | "current">("original"),
    [skip, setSkip] = useState(false),
    [mobileDetail, setMobileDetail] = useState(false),
    [listLimit, setListLimit] = useState(100),
    [tabLimit, setTabLimit] = useState(150),
    [undo, setUndo] = useState<Session>();
  const lastSave = useRef({ id: "", at: 0 }),
    lock = useRef(false),
    searchRef = useRef<HTMLInputElement>(null),
    fileRef = useRef<HTMLInputElement>(null),
    targetRef = useRef<Target>(initialTarget),
    request = useRef(0);
  const lang =
    preferences.language === "system"
      ? navigator.language.startsWith("zh")
        ? "zh"
        : "en"
      : preferences.language;
  const t = translator(lang);
  const qty = (n: number, key: "tabs" | "windows" | "sessions") =>
    `${n} ${lang === "en" && n === 1 ? key.slice(0, -1) : t(key)}`;
  const date = (n: number) =>
    new Date(n).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  const refresh = useCallback(async () => {
    const gen = ++request.current;
    const [s, j] = await Promise.all([
      api<Session[]>({ type: "list" }),
      api<Job[]>({ type: "jobs" }),
    ]);
    if (gen === request.current) {
      setSessions(s);
      setJobs(j);
      setLoaded(true);
    }
  }, []);
  const refreshContext = useCallback(async () => {
    try {
      const c = await api<Context>({
        type: "context",
        target: targetRef.current,
      });
      targetRef.current = c.target;
      setContext(c);
    } catch {
      setContext(undefined);
    }
  }, []);
  useEffect(() => {
    void api<Preferences>({ type: "prefs" })
      .then(setPreferences)
      .catch((e) => setError(errorText(e)));
    void refresh().catch((e) => setError(errorText(e)));
    void refreshContext();
    if (chrome.action) void chrome.action.setBadgeText({ text: "" });
    const resume = () => {
      if (!document.hidden) {
        void refresh().catch((e) => setError(errorText(e)));
        void refreshContext();
      }
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    const timer = setInterval(resume, 2000);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [refresh, refreshContext]);
  useEffect(() => {
    document.documentElement.lang = lang;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        preferences.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : preferences.theme);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences.theme, lang]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "f" &&
        !popup &&
        !modal
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && !modal) {
        setSelected(new Set());
        setQ("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal]);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      const element = event.target as Element;
      for (const menu of document.querySelectorAll<HTMLDetailsElement>(
        "details.menu[open]",
      ))
        if (!menu.contains(element) || element.closest("button"))
          menu.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape")
        document
          .querySelectorAll<HTMLDetailsElement>("details.menu[open]")
          .forEach((menu) => (menu.open = false));
    };
    document.addEventListener("click", click);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", click);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const filtered = useMemo(
    () =>
      sessions
        .filter(
          (s) =>
            (shelf === "trash" ? !!s.deletedAt : !s.deletedAt) &&
            (shelf !== "favorites" || s.favorite) &&
            (!q.trim() ||
              allTabs(s).some((tab) => matches(s, tab, q)) ||
              s.name.toLocaleLowerCase().includes(q.toLocaleLowerCase())),
        )
        .sort(
          (a, b) =>
            Number(b.favorite) - Number(a.favorite) ||
            b.createdAt - a.createdAt,
        ),
    [sessions, shelf, q],
  );
  const chosen = filtered.find((s) => s.id === selectedId) || filtered[0];
  useEffect(() => {
    setSelected(new Set());
    setTabLimit(150);
  }, [chosen?.id, q, shelf]);
  useEffect(() => {
    setListLimit(100);
  }, [q, shelf]);
  async function task(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function setting(value: Partial<Preferences>) {
    const result = await api<Preferences>({ type: "prefs", value });
    setPreferences(result);
  }
  async function save(close = false) {
    await task(async () => {
      const now = Date.now();
      if (now - lastSave.current.at > 800)
        lastSave.current = { id: uid(), at: now };
      const result = await api<{
        session: Session;
        closed: number;
        kept: number;
      }>({
        type: close ? "saveClose" : "save",
        scope: preferences.scope,
        target: targetRef.current,
        requestId: lastSave.current.id,
      });
      setNotice(
        `${t("saved")} · ${qty(count(result.session), "tabs")}${close ? ` · ${result.closed} ${lang === "zh" ? "已关闭" : "closed"}, ${result.kept} ${lang === "zh" ? "保留" : "kept"}` : ""}`,
      );
      setSelectedId(result.session.id);
      setShelf("all");
      setQ("");
      setModal(undefined);
      await refresh();
      await refreshContext();
    });
  }
  async function change(
    s: Session,
    patch: { name?: string; favorite?: boolean; deletedAt?: number | null },
  ) {
    const result = await api<Session>({
      type: "change",
      id: s.id,
      revision: s.revision,
      patch,
    });
    await refresh();
    return result;
  }
  async function exportData(ids?: string[]) {
    await task(async () => {
      const text = await api<string>({ type: "export", ids });
      download(text, `TabCarry-${new Date().toISOString().slice(0, 10)}.json`);
      setNotice(t("exported"));
    });
  }
  function restore(s: Session, ids?: string[]) {
    setMode("original");
    setSkip(false);
    setModal({ kind: "restore", s, ids });
  }
  function toggle(ids: string[]) {
    setSelected((old) => {
      const next = new Set(old);
      const remove = ids.every((id) => next.has(id));
      for (const id of ids) remove ? next.delete(id) : next.add(id);
      return next;
    });
  }
  async function openTab(tab: SavedTab, background = false) {
    await task(async () => {
      await api({
        type: "open",
        url: tab.url,
        target: targetRef.current,
        background,
      });
    });
  }
  const scopeCount =
    context?.[
      preferences.scope === "all"
        ? "all"
        : preferences.scope === "window"
          ? "window"
          : "selected"
    ] || 0;
  const ScopeSelect = () => (
    <select
      aria-label={t("savingScope")}
      value={preferences.scope}
      disabled={busy}
      onChange={(e) =>
        void task(() => setting({ scope: e.target.value as Scope }))
      }
    >
      <option value="all">{t("saveAll")}</option>
      <option value="window">{t("saveWindow")}</option>
      <option value="selected">{t("saveSelected")}</option>
    </select>
  );
  function sessionActions(s: Session) {
    return (
      <details className="menu">
        <summary aria-label={t("more")}>
          <MoreHorizontal size={18} />
        </summary>
        <div className="menu-pop">
          <button
            onClick={() => {
              setName(s.name);
              setModal({ kind: "rename", s });
            }}
          >
            <span>{t("rename")}</span>
          </button>
          <button
            onClick={() =>
              void task(async () => {
                await change(s, { favorite: !s.favorite });
              })
            }
          >
            {t(s.favorite ? "unfavorite" : "favorite")}
          </button>
          <button onClick={() => void exportData([s.id])}>
            {t("exportOne")}
          </button>
          <button
            className="danger-text"
            onClick={() =>
              void task(async () => {
                const result = await change(s, { deletedAt: Date.now() });
                setUndo(result);
                setNotice(t("delete"));
              })
            }
          >
            {t("delete")}
          </button>
        </div>
      </details>
    );
  }
  function statusReport(job: Job) {
    const nums = (state: string) =>
      job.items.filter((i) => i.state === state).length;
    const problem = job.items.filter((i) => i.error || i.state === "unknown");
    return (
      <section className="report" key={job.id} aria-live="polite">
        <div className="report-top">
          <strong>
            {t(
              job.status === "running"
                ? "progress"
                : job.status === "interrupted"
                  ? "interrupted"
                  : job.status === "cancelled"
                    ? "cancelled"
                    : "complete",
            )}{" "}
            · {job.name}
          </strong>
          {job.status === "running" ? (
            <button
              className="small"
              onClick={() =>
                void task(async () => {
                  await api({ type: "cancel", id: job.id });
                  await refresh();
                })
              }
            >
              {t("stop")}
            </button>
          ) : (
            <button
              className="icon"
              aria-label={t("dismiss")}
              onClick={() =>
                void task(async () => {
                  await api({ type: "dismissJob", id: job.id });
                  await refresh();
                })
              }
            >
              <X size={16} />
            </button>
          )}
        </div>
        <p>
          {nums("done")} {t("done")} · {nums("skipped")} {t("skipped")} ·{" "}
          {nums("failed")} {t("failed")}
          {nums("unknown") > 0
            ? ` · ${nums("unknown")} ${t("unknown")}`
            : ""} · {nums("pending") + nums("created") + nums("opening")}{" "}
          {t("pending")}
        </p>
        <p className="hint">{t("createdNotLoaded")}</p>
        {nums("unknown") > 0 && (
          <p className="danger-text">{t("reviewUnknown")}</p>
        )}
        {(problem.length > 0 || job.warnings.length > 0) && (
          <details>
            <summary>{t("details")}</summary>
            <ul>
              {problem.map((i) => (
                <li key={i.key}>
                  <b>{i.tab.title}</b>
                  <br />
                  {i.error}
                  <br />
                  <span className="url">{i.tab.url}</span>
                </li>
              ))}
              {job.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}
        {job.status !== "running" &&
          job.items.some((i) =>
            ["pending", "failed", "created"].includes(i.state),
          ) && (
            <button
              className="small"
              disabled={busy}
              onClick={() =>
                void task(async () => {
                  await api({ type: "retry", id: job.id });
                  await refresh();
                })
              }
            >
              {t("retry")}
            </button>
          )}
      </section>
    );
  }
  const modalTitle = modal
    ? t(
        modal.kind === "rename"
          ? "rename"
          : modal.kind === "erase"
            ? "erase"
            : modal.kind === "restore"
              ? "restoreTitle"
              : modal.kind === "import"
                ? "importTitle"
                : modal.kind === "settings"
                  ? "settings"
                  : modal.kind === "privacy"
                    ? "privacy"
                    : modal.kind === "current"
                      ? "currentTab"
                      : "saveClose",
      )
    : "";
  return (
    <div className={popup ? "app popup" : "app"}>
      <header className="topbar">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <Logo />
          <span>TabCarry</span>
        </a>
        {!popup && (
          <div className="search-box">
            <Search size={17} />
            <input
              ref={searchRef}
              aria-label={t("search")}
              placeholder={t("search")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q ? (
              <button
                className="icon"
                aria-label={t("clearSearch")}
                onClick={() => setQ("")}
              >
                <X size={15} />
              </button>
            ) : (
              <kbd>⌘ F</kbd>
            )}
          </div>
        )}
        <button
          className="icon"
          aria-label={t("settings")}
          onClick={() => setModal({ kind: "settings" })}
        >
          <Settings size={19} />
        </button>
      </header>
      {error && (
        <div className="error" role="alert">
          <strong>{t("error")}</strong>
          <p>{error}</p>
          <button className="small" onClick={() => void task(refresh)}>
            {t("refresh")}
          </button>
          <button
            className="icon"
            aria-label={t("close")}
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <Check size={16} />
          <span>{notice}</span>
          {undo && (
            <button
              onClick={() =>
                void task(async () => {
                  await change(undo, { deletedAt: null });
                  setUndo(undefined);
                  setNotice(t("recover"));
                })
              }
            >
              {t("undo")}
            </button>
          )}
          <button
            className="icon"
            aria-label={t("close")}
            onClick={() => {
              setNotice("");
              setUndo(undefined);
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {popup ? (
        <>
          <section className="quick-save">
            <span className="eyebrow">{t("saveScopeCount")}</span>
            <h1>
              {scopeCount} <span>{t("tabs")}</span>
            </h1>
            <p>
              {qty(context?.windows || 0, "windows")} · {t("local")}
            </p>
            <ScopeSelect />
            <button
              className="primary wide"
              disabled={busy || !scopeCount}
              onClick={() => void save()}
            >
              {busy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Plus size={18} />
              )}{" "}
              {t(busy ? "saving" : "save")}
            </button>
          </section>
          <section className="recent">
            <div className="section-label">{t("recent")}</div>
            {sessions
              .filter((s) => !s.deletedAt)
              .slice(0, 5)
              .map((s) => (
                <button
                  className="recent-item"
                  key={s.id}
                  onClick={() => restore(s)}
                >
                  <span>
                    <b>{s.name}</b>
                    <small>
                      {qty(count(s), "tabs")} · {date(s.createdAt)}
                    </small>
                  </span>
                  <ArrowUpRight size={18} />
                </button>
              ))}
            {loaded && !sessions.some((s) => !s.deletedAt) && (
              <p className="muted">{t("emptyBody")}</p>
            )}
          </section>
          {jobs.slice(0, 1).map(statusReport)}
          <footer className="popup-footer">
            <button
              onClick={() =>
                void task(async () => {
                  await api({ type: "library", target: targetRef.current });
                })
              }
            >
              <PanelLeft size={16} />
              {t("openLibrary")}
              <ArrowUpRight size={16} />
            </button>
          </footer>
        </>
      ) : (
        <>
          <div className="workspace-heading">
            <div>
              <span className="eyebrow">{t("tagline")}</span>
              <h1>
                {t("library")}
                <span className="count-badge">
                  {sessions.filter((s) => !s.deletedAt).length}
                </span>
              </h1>
            </div>
            <div className="save-controls">
              <ScopeSelect />
              <button
                className="primary"
                disabled={busy || !scopeCount}
                onClick={() => void save()}
              >
                <Plus size={18} />
                {t(busy ? "saving" : "save")}
                <span className="button-count">{scopeCount}</span>
              </button>
              <details className="menu">
                <summary aria-label={t("more")}>
                  <ChevronDown size={17} />
                </summary>
                <div className="menu-pop">
                  <button
                    disabled={busy || !scopeCount}
                    onClick={() => setModal({ kind: "saveClose" })}
                  >
                    {t("saveClose")}
                  </button>
                </div>
              </details>
            </div>
          </div>
          <main className={`workspace ${mobileDetail ? "show-detail" : ""}`}>
            <aside className="sidebar">
              <div className="shelves">
                {(["all", "favorites", "trash"] as const).map((key) => (
                  <button
                    key={key}
                    className={shelf === key ? "active" : ""}
                    aria-pressed={shelf === key}
                    onClick={() => {
                      setShelf(key);
                      setMobileDetail(false);
                    }}
                  >
                    {key === "all" ? (
                      <Layers size={16} />
                    ) : key === "favorites" ? (
                      <Star size={16} />
                    ) : (
                      <Trash2 size={16} />
                    )}
                    <span>{t(key)}</span>
                  </button>
                ))}
              </div>
              <div className="session-list" aria-label={t("library")}>
                {!loaded ? (
                  <p className="list-note">{t("loading")}</p>
                ) : filtered.length === 0 ? (
                  <p className="list-note">
                    {t(
                      q
                        ? "noResults"
                        : shelf === "trash"
                          ? "noTrash"
                          : shelf === "favorites"
                            ? "noFavorites"
                            : "empty",
                    )}
                  </p>
                ) : (
                  filtered.slice(0, listLimit).map((s) => (
                    <button
                      className={`session-item ${chosen?.id === s.id ? "chosen" : ""}`}
                      key={s.id}
                      onClick={() => {
                        setSelectedId(s.id);
                        setMobileDetail(true);
                      }}
                      aria-current={chosen?.id === s.id ? "true" : undefined}
                    >
                      <span className="session-symbol">
                        <Layers size={18} />
                      </span>
                      <span className="session-text">
                        <b>{s.name}</b>
                        <small>
                          {qty(count(s), "tabs")} · {s.windows.length}{" "}
                          {t("windows")}
                        </small>
                        <time>{date(s.createdAt)}</time>
                      </span>
                      {s.favorite && <Star className="star" size={13} />}
                    </button>
                  ))
                )}
                {filtered.length > listLimit && (
                  <button
                    className="small"
                    onClick={() => setListLimit((n) => n + 100)}
                  >
                    {t("showMore")}
                  </button>
                )}
              </div>
              <div className="backup-actions">
                <button onClick={() => fileRef.current?.click()}>
                  <Upload size={16} />
                  {t("import")}
                </button>
                <button onClick={() => void exportData()}>
                  <Download size={16} />
                  {t("export")}
                </button>
                <div className="local-label">
                  <ShieldCheck size={14} />
                  {t("local")}
                </div>
              </div>
            </aside>
            <section className="detail">
              {jobs.slice(0, 5).map(statusReport)}
              {chosen ? (
                <>
                  <button
                    className="back small"
                    onClick={() => setMobileDetail(false)}
                  >
                    <ArrowLeft size={16} />
                    {t("back")}
                  </button>
                  <div className="detail-head">
                    <div>
                      <span className="eyebrow">{date(chosen.createdAt)}</span>
                      <h2>{chosen.name}</h2>
                      <p>
                        {qty(chosen.windows.length, "windows")} <span>·</span>{" "}
                        {qty(count(chosen), "tabs")}
                        {chosen.deletedAt && <span> · {t("trashNote")}</span>}
                      </p>
                    </div>
                    <div className="detail-actions">
                      {chosen.deletedAt ? (
                        <>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void task(async () => {
                                await change(chosen, { deletedAt: null });
                              })
                            }
                          >
                            <RotateCcw size={16} />
                            {t("recover")}
                          </button>
                          <button
                            className="danger-text"
                            onClick={() =>
                              setModal({ kind: "erase", s: chosen })
                            }
                          >
                            <Trash2 size={16} />
                            {t("erase")}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className={`icon ${chosen.favorite ? "star" : ""}`}
                            aria-label={t(
                              chosen.favorite ? "unfavorite" : "favorite",
                            )}
                            disabled={busy}
                            onClick={() =>
                              void task(async () => {
                                await change(chosen, {
                                  favorite: !chosen.favorite,
                                });
                              })
                            }
                          >
                            <Star size={19} />
                          </button>
                          {sessionActions(chosen)}
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() => restore(chosen)}
                          >
                            <ArrowUpRight size={17} />
                            {t("restore")}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="selection-bar">
                    <label>
                      <input
                        type="checkbox"
                        aria-label={t("selectAll")}
                        checked={
                          allTabs(chosen).filter((tab) =>
                            matches(chosen, tab, q),
                          ).length > 0 &&
                          allTabs(chosen)
                            .filter((tab) => matches(chosen, tab, q))
                            .every((tab) => selected.has(tab.id))
                        }
                        onChange={() =>
                          toggle(
                            allTabs(chosen)
                              .filter((tab) => matches(chosen, tab, q))
                              .map((tab) => tab.id),
                          )
                        }
                      />
                      {selected.size
                        ? `${selected.size} ${t("selected")}`
                        : t("selectAll")}
                    </label>
                    {selected.size > 0 && (
                      <>
                        <button
                          className="small"
                          onClick={() => setSelected(new Set())}
                        >
                          {t("clearSelection")}
                        </button>
                        {!chosen.deletedAt && (
                          <button
                            className="small"
                            onClick={() => restore(chosen, [...selected])}
                          >
                            {t("openSelected")}
                            <ArrowUpRight size={14} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  <div className="tab-list">
                    {(() => {
                      let rendered = 0;
                      return chosen.windows.map((w, wi) => {
                        const matchesHere = w.tabs.filter((tab) =>
                          matches(chosen, tab, q),
                        );
                        const visible = matchesHere.slice(
                          0,
                          Math.max(0, tabLimit - rendered),
                        );
                        rendered += matchesHere.length;
                        if (!visible.length) return null;
                        let prevGroup: string | undefined;
                        return (
                          <section className="window-block" key={w.id}>
                            <div className="window-label">
                              <label>
                                <input
                                  type="checkbox"
                                  aria-label={`${t("checkAll")} ${wi + 1}`}
                                  checked={matchesHere.every((tab) =>
                                    selected.has(tab.id),
                                  )}
                                  onChange={() =>
                                    toggle(matchesHere.map((tab) => tab.id))
                                  }
                                />
                                <Monitor size={15} />
                                {t("window")} {wi + 1}
                              </label>
                              <span>
                                {matchesHere.length}{" "}
                                {t(q ? "matching" : "tabs")}
                              </span>
                            </div>
                            {visible.map((tab) => {
                              const group = w.groups.find(
                                (g) => g.id === tab.groupRef,
                              );
                              const showGroup = group && prevGroup !== group.id;
                              prevGroup = group?.id;
                              return (
                                <React.Fragment key={tab.id}>
                                  {showGroup && (
                                    <div className="group-label">
                                      <span
                                        className={`group-dot color-${group.color}`}
                                      />
                                      <b>{group.title || t("window")}</b>
                                      <button
                                        className="small"
                                        onClick={() =>
                                          toggle(
                                            matchesHere
                                              .filter(
                                                (x) => x.groupRef === group.id,
                                              )
                                              .map((x) => x.id),
                                          )
                                        }
                                      >
                                        {t("selectAll")}
                                      </button>
                                    </div>
                                  )}
                                  <div
                                    className={`tab-row ${selected.has(tab.id) ? "selected" : ""}`}
                                  >
                                    <input
                                      type="checkbox"
                                      aria-label={`${t("selected")}: ${tab.title}`}
                                      checked={selected.has(tab.id)}
                                      onChange={() => toggle([tab.id])}
                                    />
                                    <span
                                      className="favicon"
                                      aria-hidden="true"
                                    >
                                      {domain(tab.url)
                                        .slice(0, 1)
                                        .toUpperCase() || "·"}
                                    </span>
                                    <button
                                      className="tab-link"
                                      title={tab.url}
                                      disabled={
                                        !!chosen.deletedAt ||
                                        !supported(tab.url)
                                      }
                                      onClick={(e) =>
                                        void openTab(
                                          tab,
                                          e.metaKey || e.ctrlKey,
                                        )
                                      }
                                    >
                                      <span>
                                        {tab.title || tab.url}
                                        {tab.pinned && (
                                          <span className="pin">●</span>
                                        )}
                                      </span>
                                      <small>
                                        {domain(tab.url)}
                                        {!supported(tab.url) &&
                                          ` · ${t("unsupported")}`}
                                      </small>
                                    </button>
                                    <button
                                      className="icon row-action"
                                      aria-label={t("copy")}
                                      title={t("copy")}
                                      onClick={() =>
                                        void task(async () => {
                                          await navigator.clipboard.writeText(
                                            tab.url,
                                          );
                                          setNotice(t("copied"));
                                        })
                                      }
                                    >
                                      <Copy size={15} />
                                    </button>
                                    {!chosen.deletedAt &&
                                      supported(tab.url) && (
                                        <details className="menu">
                                          <summary aria-label={t("more")}>
                                            <MoreHorizontal size={17} />
                                          </summary>
                                          <div className="menu-pop">
                                            <button
                                              onClick={() => void openTab(tab)}
                                            >
                                              {t("newTab")}
                                            </button>
                                            <button
                                              onClick={() =>
                                                setModal({
                                                  kind: "current",
                                                  tab,
                                                })
                                              }
                                            >
                                              {t("currentTab")}
                                            </button>
                                          </div>
                                        </details>
                                      )}
                                  </div>
                                </React.Fragment>
                              );
                            })}
                          </section>
                        );
                      });
                    })()}
                    {allTabs(chosen).filter((tab) => matches(chosen, tab, q))
                      .length > tabLimit && (
                      <button
                        className="small load-more"
                        onClick={() => setTabLimit((n) => n + 150)}
                      >
                        {t("showMore")}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="empty">
                  <div className="empty-art">
                    <Logo />
                    <span className="orbit one" />
                    <span className="orbit two" />
                  </div>
                  <h2>
                    {t(
                      q
                        ? "noResults"
                        : shelf === "trash"
                          ? "noTrash"
                          : shelf === "favorites"
                            ? "noFavorites"
                            : "empty",
                    )}
                  </h2>
                  <p>
                    {t(
                      q
                        ? "search"
                        : shelf === "trash"
                          ? "trashNote"
                          : "emptyBody",
                    )}
                  </p>
                  {q ? (
                    <button onClick={() => setQ("")}>{t("clearSearch")}</button>
                  ) : (
                    shelf === "all" && (
                      <button
                        className="primary"
                        disabled={busy || !scopeCount}
                        onClick={() => void save()}
                      >
                        <Plus size={18} />
                        {t("save")}
                      </button>
                    )
                  )}
                </div>
              )}
            </section>
          </main>
          <footer className="main-footer">
            <span>
              <ShieldCheck size={14} />
              {t("localNote")}
            </span>
            <button onClick={() => setModal({ kind: "privacy" })}>
              {t("privacy")}
            </button>
          </footer>
        </>
      )}
      <input
        ref={fileRef}
        className="hidden"
        type="file"
        accept=".json,application/json"
        aria-label={t("import")}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file)
            void task(async () => {
              if (file.size > MAX_BYTES) throw Error("Backup exceeds 25 MB");
              const text = await file.text();
              const parsed = parseBackup(text);
              setModal({ kind: "import", text, sessions: parsed });
            });
        }}
      />
      {modal && (
        <Dialog
          title={modalTitle}
          onClose={() => setModal(undefined)}
          busy={busy}
        >
          {error && (
            <p className="modal-error" role="alert">
              {error}
            </p>
          )}
          {modal.kind === "rename" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void task(async () => {
                  await change(modal.s, { name });
                  setModal(undefined);
                });
              }}
            >
              <label className="field">
                {t("name")}
                <input
                  autoFocus
                  value={name}
                  maxLength={160}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <div className="dialog-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setModal(undefined)}
                >
                  {t("cancel")}
                </button>
                <button className="primary" disabled={busy || !name.trim()}>
                  {t(busy ? "working" : "confirm")}
                </button>
              </div>
            </form>
          )}
          {modal.kind === "restore" && (
            <>
              <p className="muted">
                {modal.s.name} · {modal.ids?.length ?? count(modal.s)}{" "}
                {t("tabs")}
              </p>
              <div className="restore-options">
                {(["original", "current"] as const).map((value) => (
                  <label
                    key={value}
                    className={mode === value ? "option selected" : "option"}
                  >
                    <input
                      type="radio"
                      name="restore-mode"
                      value={value}
                      checked={mode === value}
                      onChange={() => {
                        setMode(value);
                        setSkip(false);
                      }}
                    />
                    <span>
                      <b>{t(value)}</b>
                      <small>
                        {t(value === "original" ? "restoreNote" : "appendNote")}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              {mode === "current" && (
                <label className="checkline">
                  <input
                    type="checkbox"
                    checked={skip}
                    onChange={(e) => setSkip(e.target.checked)}
                  />
                  {t("skip")}
                </label>
              )}
              <p className="hint">{t("network")}</p>
              {(modal.ids?.length ?? count(modal.s)) > 50 && (
                <p className="warning">{t("many")}</p>
              )}
              <div className="dialog-actions">
                <button disabled={busy} onClick={() => setModal(undefined)}>
                  {t("cancel")}
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void task(async () => {
                      await api({
                        type: "restore",
                        id: modal.s.id,
                        options: {
                          mode,
                          target: targetRef.current,
                          tabIds: modal.ids,
                          skipExisting: skip,
                        },
                        requestId: uid(),
                      });
                      setModal(undefined);
                      await refresh();
                    })
                  }
                >
                  <ArrowUpRight size={17} />
                  {t(busy ? "working" : "restore")}
                </button>
              </div>
            </>
          )}
          {modal.kind === "import" && (
            <>
              <p className="import-stat">
                {qty(modal.sessions.length, "sessions")} ·{" "}
                {modal.sessions.reduce((n, s) => n + count(s), 0)} {t("tabs")}
              </p>
              <p>{t("importNote")}</p>
              <div className="dialog-actions">
                <button disabled={busy} onClick={() => setModal(undefined)}>
                  {t("cancel")}
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void task(async () => {
                      const r = await api<{
                        added: number;
                        skipped: number;
                        conflicts: number;
                      }>({ type: "import", text: modal.text });
                      setNotice(
                        `${t("imported")} · ${r.added} ${lang === "zh" ? "新增" : "added"} · ${r.skipped} ${t("skipped")} · ${r.conflicts} ${lang === "zh" ? "冲突另存" : "conflict copies"}`,
                      );
                      setModal(undefined);
                      await refresh();
                    })
                  }
                >
                  {t(busy ? "working" : "import")}
                </button>
              </div>
            </>
          )}
          {["erase", "saveClose", "current"].includes(modal.kind) && (
            <>
              <p>
                {t(
                  modal.kind === "erase"
                    ? "eraseWarning"
                    : modal.kind === "current"
                      ? "currentWarning"
                      : "closeWarning",
                )}
              </p>
              {modal.kind === "saveClose" && (
                <p>
                  {scopeCount} {t("tabs")}
                </p>
              )}
              <div className="dialog-actions">
                <button disabled={busy} onClick={() => setModal(undefined)}>
                  {t("cancel")}
                </button>
                <button
                  className={modal.kind === "current" ? "primary" : "danger"}
                  disabled={busy}
                  onClick={() => {
                    if (modal.kind === "saveClose") void save(true);
                    else if (modal.kind === "erase")
                      void task(async () => {
                        await api({ type: "purge", ids: [modal.s.id] });
                        setModal(undefined);
                        await refresh();
                      });
                    else if (modal.kind === "current")
                      void task(async () => {
                        await api({
                          type: "open",
                          url: modal.tab.url,
                          target: targetRef.current,
                          current: true,
                        });
                        setModal(undefined);
                      });
                  }}
                >
                  {t(busy ? "working" : "confirm")}
                </button>
              </div>
            </>
          )}
          {modal.kind === "settings" && (
            <>
              <label className="field">
                {t("theme")}
                <select
                  value={preferences.theme}
                  onChange={(e) =>
                    void task(() =>
                      setting({
                        theme: e.target.value as Preferences["theme"],
                      }),
                    )
                  }
                >
                  {(["system", "light", "dark"] as const).map((key) => (
                    <option key={key} value={key}>
                      {t(key)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {t("language")}
                <select
                  value={preferences.language}
                  onChange={(e) =>
                    void task(() =>
                      setting({
                        language: e.target.value as Preferences["language"],
                      }),
                    )
                  }
                >
                  <option value="system">{t("system")}</option>
                  <option value="en">English</option>
                  <option value="zh">简体中文</option>
                </select>
              </label>
              <h3>
                <CommandIcon size={16} />
                {t("shortcut")}
              </h3>
              <p className="hint">{t("shortcutBody")}</p>
              <h3>
                <Archive size={16} />
                {t("export")}
              </h3>
              <p className="hint">{t("backupScope")}</p>
              <button onClick={() => void exportData()}>
                <Download size={16} />
                {t("export")}
              </button>
              <p className="version">TabCarry 1.0.0 · {t("local")}</p>
            </>
          )}
          {modal.kind === "privacy" && (
            <>
              <h3>{t("privacyTitle")}</h3>
              <p>{t("privacyBody")}</p>
              <p>{t("about")}</p>
              <p>{t("network")}</p>
            </>
          )}
        </Dialog>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
