import { describe, expect, it } from "vitest";
import { handleVersionAction } from "../src/discord/commands.js";
import { versionActions, versionDetailsEmbed, versionEmbed } from "../src/discord/version-view.js";

function buttonInteraction(customId: string, channelId = "channel-1") {
  const replies: { content?: string; embeds?: unknown[] }[] = [];
  const updates: { embeds?: unknown[] }[] = [];
  const interaction = {
    customId,
    channelId,
    id: "interaction-1",
    reply: async (payload: { content?: string; embeds?: unknown[] }) => void replies.push(payload),
    update: async (payload: { embeds?: unknown[] }) => void updates.push(payload),
  };
  return { interaction, replies, updates };
}

describe("version view", () => {
  it("shows the revision, app version, build date, uptime and rate date", () => {
    const embed = versionEmbed();
    const labels = embed.data.fields?.map((field) => field.name) ?? [];
    expect(labels).toContain("Running revision");
    expect(labels).toContain("App version");
    expect(labels).toContain("Built");
    expect(labels).toContain("Uptime");
    expect(labels).toContain("Exchange-rate data");
  });

  it("offers refresh, details and source", () => {
    const ids = versionActions()[0]?.components.map((button) => button.data.custom_id) ?? [];
    expect(ids).toEqual(["v:refresh", "v:details", "v:source"]);
  });

  it("reports the identity source in the private details", () => {
    const details = versionDetailsEmbed().data.description ?? "";
    expect(details).toContain("Identity source:");
  });
});

describe("version actions", () => {
  it("answers Details privately", async () => {
    const { interaction, replies } = buttonInteraction("v:details");
    await handleVersionAction(interaction as never);
    expect(replies[0]?.embeds?.length).toBe(1);
  });

  it("answers Source privately with the repository link", async () => {
    const { interaction, replies } = buttonInteraction("v:source");
    await handleVersionAction(interaction as never);
    expect(replies[0]?.content).toContain("github.com/leonid-dalin/pokemon-tcg-card-bot");
  });

  it("refreshes the shared card", async () => {
    const { interaction, updates } = buttonInteraction("v:refresh", "channel-refresh");
    await handleVersionAction(interaction as never);
    expect(updates[0]?.embeds?.length).toBe(1);
  });

  it("rate-limits a second refresh on the same card", async () => {
    const first = buttonInteraction("v:refresh", "channel-limited");
    await handleVersionAction(first.interaction as never);
    const second = buttonInteraction("v:refresh", "channel-limited");
    await handleVersionAction(second.interaction as never);
    expect(second.replies[0]?.content).toContain("refreshed a moment ago");
  });
});
