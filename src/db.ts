import type { Session, Job } from "./model";
let dbPromise: Promise<IDBDatabase> | undefined;
export function database() {
  return (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("tabcarry", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("sessions", { keyPath: "id" });
      req.result.createObjectStore("jobs", { keyPath: "id" });
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => {
        req.result.close();
        dbPromise = undefined;
      };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(
        new Error(
          "Database upgrade blocked. Close other TabCarry pages and retry.",
        ),
      );
  }));
}
export async function readAll<T>(store: "sessions" | "jobs"): Promise<T[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function read<T>(
  store: "sessions" | "jobs",
  id: string,
): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function writeMany(
  store: "sessions" | "jobs",
  values: (Session | Job)[],
) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error || new Error("Storage transaction aborted"));
    for (const value of values) tx.objectStore(store).put(value);
  });
}
export async function removeMany(store: "sessions" | "jobs", ids: string[]) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    for (const id of ids) tx.objectStore(store).delete(id);
  });
}
export async function update<T extends Session | Job>(
  store: "sessions" | "jobs",
  id: string,
  fn: (value: T) => T,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite"),
      os = tx.objectStore(store),
      r = os.get(id);
    let result: T;
    let failure: unknown;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () =>
      reject(failure || tx.error || new Error("Storage transaction aborted"));
    tx.onerror = () => reject(tx.error);
    r.onsuccess = () => {
      try {
        if (!r.result)
          throw Error("Record no longer exists. Refresh and retry.");
        result = fn(r.result);
        os.put(result);
      } catch (e) {
        failure = e;
        tx.abort();
      }
    };
  });
}
