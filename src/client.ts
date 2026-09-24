import type { Command, Reply } from "./model";
export async function api<T = unknown>(command: Command): Promise<T> {
  const r: Reply<T> = await chrome.runtime.sendMessage(command);
  if (!r)
    throw Error(
      "Extension background is unavailable. Reload the extension and retry.",
    );
  if (!r.ok) throw Error(r.error);
  return r.data;
}
export function download(text: string, name: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
