export const DEFAULT_FILES = "src/**/*.{js,ts,jsx,tsx}";

export type FilePatternInput = string | readonly string[] | undefined;

export function splitFilePatterns(files: FilePatternInput): {
  include: string[];
  exclude: string[];
} {
  const patterns =
    typeof files === "string" ? [files] : (files ?? [DEFAULT_FILES]);
  const include: string[] = [];
  const exclude: string[] = [];

  for (const pattern of patterns) {
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
