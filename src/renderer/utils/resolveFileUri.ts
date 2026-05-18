/**
 * Resolve a canvas file-type node's `file` field to a URI Skia can load.
 *
 * Resolution order:
 * - Already a URI (`http://`, `https://`, `file://`) → returned unchanged
 *   (still encoded so unencoded spaces / non-ASCII characters don't trip
 *   Skia's URI parser)
 * - Absolute path (`/...`) → `file://` prefix, encoded
 * - Relative path with `basePath` → resolved against the directory
 *   containing the .canvas file, encoded
 * - Relative path without `basePath` → `null`, so the image hooks render
 *   nothing rather than receive an invalid URI
 *
 * Both rendering paths (`SkiaImageRenderer` live tree, `useCanvasPicture`
 * recorded Picture) must call this same helper so resolved URIs match
 * exactly — see the "two rendering paths must stay in sync" rule in
 * `.claude/rules/canvas.md`.
 */
export function resolveFileUri(file: string, basePath?: string): string | null {
  if (!file) return null;
  // Already a formed URI — pass through. We deliberately don't re-encode
  // because `encodeURI` would double-encode any existing `%xx` sequences.
  if (
    file.startsWith('http://') ||
    file.startsWith('https://') ||
    file.startsWith('file://')
  ) {
    return file;
  }
  // Path-to-URI construction encodes the path so spaces and non-ASCII
  // characters in directory names don't trip Skia's URI parser.
  if (file.startsWith('/')) {
    return `file://${encodeURI(file)}`;
  }
  if (basePath) {
    const trimmed = basePath.replace(/\/+$/, '');
    return `file://${encodeURI(`${trimmed}/${file}`)}`;
  }
  return null;
}
