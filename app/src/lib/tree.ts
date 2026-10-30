// Torrent file list → folder tree with aggregated sizes.

export interface TreeNode {
  name: string;
  path: string;
  size: number;
  /** File indexes contained in this node (one for files). */
  files: number[];
  children: TreeNode[];
}

export function buildTree(files: { index: number; path: string; size: number }[]): TreeNode {
  const root: TreeNode = { name: "", path: "", size: 0, files: [], children: [] };
  for (const f of files) {
    const parts = f.path.split(/[\\/]+/).filter(Boolean);
    let node = root;
    node.size += f.size;
    node.files.push(f.index);
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path, size: 0, files: [], children: [] };
        node.children.push(child);
      }
      child.size += f.size;
      child.files.push(f.index);
      node = child;
    });
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => Number(b.children.length > 0) - Number(a.children.length > 0) || a.name.localeCompare(b.name));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

/** "all" | "none" | "some" for a node given the selected file indexes. */
export function nodeState(node: TreeNode, selected: Set<number>): "all" | "none" | "some" {
  const n = node.files.filter((i) => selected.has(i)).length;
  return n === 0 ? "none" : n === node.files.length ? "all" : "some";
}
