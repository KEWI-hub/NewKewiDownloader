// Path helpers shared by windows and panes.

import { useApp } from "./store";

export function fullPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

/** Where a category's files go when the user hasn't picked a folder explicitly. */
export function folderFor(categoryId: string, fallback: string): string {
  const st = useApp.getState();
  const cat = st.categories.find((c) => c.id === categoryId);
  const s = st.settings?.downloads;
  if (cat?.saveDir) return cat.saveDir;
  if (!s) return fallback;
  if (!s.useCategoryFolders || !cat) return s.defaultDir;
  const sep = s.defaultDir.includes("\\") ? "\\" : "/";
  return `${s.defaultDir.replace(/[\/]+$/, "")}${sep}${cat.name}`;
}
