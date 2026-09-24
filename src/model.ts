export type Scope = "all" | "window" | "selected";
export type Target = { windowId?: number; tabId?: number; epoch?: string };
export type SavedTab = {
  id: string;
  url: string;
  title: string;
  order: number;
  pinned: boolean;
  active: boolean;
  groupRef?: string;
};
export type SavedGroup = {
  id: string;
  title: string;
  color: chrome.tabGroups.TabGroup["color"];
  collapsed: boolean;
};
export type SavedWindow = {
  id: string;
  order: number;
  focused: boolean;
  tabs: SavedTab[];
  groups: SavedGroup[];
};
export type Session = {
  id: string;
  schemaVersion: 1;
  name: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  favorite: boolean;
  deletedAt?: number;
  source: "manual" | "import";
  windows: SavedWindow[];
};
export type Preferences = {
  theme: "system" | "light" | "dark";
  language: "system" | "en" | "zh";
  scope: Scope;
};
export const defaults: Preferences = {
  theme: "system",
  language: "system",
  scope: "all",
};
export const uid = () => crypto.randomUUID();
export const allTabs = (s: Session) => s.windows.flatMap((w) => w.tabs);
export const count = (s: Session) => allTabs(s).length;
export const supported = (url: string) => {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};
export const domain = (url: string) => {
  try {
    return new URL(url).hostname || new URL(url).protocol;
  } catch {
    return url;
  }
};
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : String(e);
export const matches = (s: Session, t: SavedTab, q: string) =>
  q
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((word) =>
      `${s.name} ${t.title} ${t.url}`.toLocaleLowerCase().includes(word),
    );
export type RestoreOptions = {
  mode: "original" | "current";
  target: Target;
  tabIds?: string[];
  skipExisting: boolean;
};
export type JobItem = {
  key: string;
  windowRef: string;
  tab: SavedTab;
  state:
    | "pending"
    | "opening"
    | "created"
    | "done"
    | "failed"
    | "skipped"
    | "unknown";
  tabId?: number;
  urlApplied?: boolean;
  error?: string;
};
export type Job = {
  browserEpoch?: string;
  id: string;
  sessionId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  status: "running" | "complete" | "interrupted" | "cancelled";
  cancel: boolean;
  options: RestoreOptions;
  windows: SavedWindow[];
  windowMap: Record<string, number>;
  groupMap: Record<string, number>;
  creatingWindow?: string;
  items: JobItem[];
  warnings: string[];
};
export type Reply<T = unknown> =
  { ok: true; data: T } | { ok: false; error: string };
export type Command =
  | { type: "list" }
  | { type: "jobs" }
  | { type: "prefs"; value?: Partial<Preferences> }
  | { type: "context"; target?: Target }
  | { type: "save"; scope: Scope; target: Target; requestId: string }
  | {
      type: "change";
      id: string;
      revision: number;
      patch: { name?: string; favorite?: boolean; deletedAt?: number | null };
    }
  | { type: "purge"; ids: string[] }
  | { type: "export"; ids?: string[] }
  | { type: "import"; text: string }
  | { type: "restore"; id: string; options: RestoreOptions; requestId: string }
  | { type: "cancel"; id: string }
  | { type: "retry"; id: string }
  | { type: "dismissJob"; id: string }
  | { type: "library"; target: Target }
  | {
      type: "open";
      url: string;
      target: Target;
      current?: boolean;
      background?: boolean;
    }
  | { type: "saveClose"; scope: Scope; target: Target; requestId: string };
