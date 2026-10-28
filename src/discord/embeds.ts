import { EmbedBuilder } from "discord.js";
import type { EmbedView } from "../render.js";

export function toEmbed(view: EmbedView): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(view.color).setTitle(view.title);
  if (view.url) embed.setURL(view.url);
  if (view.description) embed.setDescription(view.description);
  if (view.fields.length) embed.addFields(view.fields);
  if (view.imageUrl) embed.setImage(view.imageUrl);
  if (view.thumbnailUrl) embed.setThumbnail(view.thumbnailUrl);
  if (view.footer) embed.setFooter({ text: view.footer });
  return embed;
}

export function toEmbeds(views: EmbedView[]): EmbedBuilder[] {
  return views.map(toEmbed);
}
