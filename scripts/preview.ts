import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TcgdexClient } from "../src/api/tcgdex.js";
import { lookupCard, lookupEmbeds } from "../src/lookup.js";
import type { EmbedView } from "../src/render.js";

/**
 * Render real lookups without connecting to Discord. Use it to check a card, a
 * mention and the HTML preview before deploying.
 *
 *   yarn preview "Dragapult ex" "Charizard|sv03.5" "Mega Kangaskhan ex"
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toHtml(views: EmbedView[]): string {
  const cards = views
    .map((view) => {
      const fields = view.fields
        .map(
          (field) =>
            `<div class="field${field.inline ? " inline" : ""}"><dt>${escapeHtml(field.name)}</dt><dd>${escapeHtml(
              field.value,
            ).replace(/\n/g, "<br>")}</dd></div>`,
        )
        .join("");
      const image = view.imageUrl
        ? `<img class="art" src="${escapeHtml(view.imageUrl)}" alt="">`
        : "";
      return `<article class="embed" style="border-left-color:#${view.color.toString(16).padStart(6, "0")}">
  <h2>${escapeHtml(view.title)}</h2>
  ${view.description ? `<p class="desc">${escapeHtml(view.description).replace(/\n/g, "<br>")}</p>` : ""}
  <div class="body">${image}<dl>${fields}</dl></div>
  ${view.footer ? `<footer>${escapeHtml(view.footer)}</footer>` : ""}
</article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Card bot preview</title>
<style>
  body { background:#313338; color:#dbdee1; font:15px/1.4 "gg sans",system-ui,sans-serif; margin:24px; }
  .embed { background:#2b2d31; border-left:4px solid; border-radius:4px; max-width:520px; padding:12px 16px; margin:0 0 24px; }
  h2 { font-size:16px; color:#f2f3f5; margin:0 0 8px; }
  .body { display:flex; gap:16px; align-items:flex-start; }
  .art { width:200px; border-radius:8px; }
  dl { margin:0; display:flex; flex-wrap:wrap; gap:8px; }
  .field { flex:1 1 100%; } .field.inline { flex:1 1 30%; }
  dt { font-size:12px; font-weight:600; color:#f2f3f5; margin:0; }
  dd { margin:0; font-size:14px; }
  footer { font-size:11px; color:#949ba4; margin-top:8px; }
</style></head><body>${cards}</body></html>`;
}

const queries = process.argv.slice(2);
if (queries.length === 0) {
  console.error('usage: yarn preview "Card name" "Card name|setId"');
  process.exit(1);
}

const client = new TcgdexClient();
mkdirSync("preview", { recursive: true });

for (const query of queries) {
  const [name = "", setHint] = query.split("|");
  const lookup = await lookupCard(client, name.trim(), setHint?.trim());
  if (!lookup) {
    console.log(`no match: ${query}`);
    continue;
  }
  const views = lookupEmbeds(lookup);
  console.log(`\n=== ${query} -> ${lookup.card.id} (${lookup.card.name}) ===`);
  console.log(JSON.stringify(views, null, 2));

  const file = join("preview", `${lookup.card.id.replace(/[^a-z0-9.-]/gi, "_")}.html`);
  writeFileSync(file, toHtml(views), "utf8");
  console.log(`wrote ${file}`);
}
