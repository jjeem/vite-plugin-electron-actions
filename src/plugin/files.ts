export function splitFilePatterns(files: string[]): {
  include: string[];
  exclude: string[];
} {
  const include: string[] = [];
  const exclude: string[] = [];

  for (const pattern of files) {
    if (pattern.startsWith("!")) {
      exclude.push(pattern.slice(1));
    } else {
      include.push(pattern);
    }
  }

  if (include.length === 0) {
    throw new Error(
      "[vite-plugin-electron-actions] files must include at least one glob pattern.",
    );
  }

  return { include, exclude };
}
