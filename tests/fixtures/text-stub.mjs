
const cards = {
  "sv01-025": { id: "sv01-025", name: "Pikachu", category: "Pokemon", attacks: [{ name: "Zap", damage: "10", cost: [], effect: "Flip a coin." }] },
  "sv01-001": { id: "sv01-001", name: "Caterpie", category: "Pokemon", attacks: [{ name: "Nib", damage: "10", cost: [], effect: "" }] },
};
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.match(/\/cards$/)) return { ok: true, status: 200, json: async () => [{ id: "sv01-025", name: "Pikachu" }, { id: "sv01-001", name: "Caterpie" }] };
  const match = u.match(/\/cards\/([^/]+)$/);
  if (match) {
    const card = cards[decodeURIComponent(match[1])];
    if (!card) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => card };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};
