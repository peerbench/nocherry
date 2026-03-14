/**
 * Code reference stub for Workers — no filesystem access.
 * Code refs are disabled in the demo template, so this just returns empty objects.
 */

export function codeRef(relPath, startLine, endLine, title) {
  return {
    path: relPath,
    startLine,
    endLine,
    code: '',
    lang: 'text',
    title: title || `${relPath}:${startLine}-${endLine}`,
  };
}
