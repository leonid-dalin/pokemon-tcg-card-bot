
const sets = [
  { id: "base1", name: "Base Set", releaseDate: "1999-01-09" },
  { id: "audit-new", name: "Audit New Set", releaseDate: "2026-01-01" },
];
const details = {
  base1: { id: "base1", name: "Base Set", releaseDate: "1999-01-09", abbreviation: { official: "BS" } },
  "audit-new": { id: "audit-new", name: "Audit New Set", releaseDate: "2026-01-01", abbreviation: { official: "AN" } },
};
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.endsWith("/sets")) return { ok: true, status: 200, json: async () => sets };
  const match = u.match(/\/sets\/([^/]+)$/);
  if (match) {
    const detail = details[decodeURIComponent(match[1])];
    if (!detail) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => detail };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};
