import { describe, expect, it } from "vitest";
import { helpView, HELP_INTRO } from "../src/help.js";
import { commandDefinitions } from "../src/discord/commands.js";
import { parseHelpCommand } from "../src/mentions.js";

const fieldNames = () => helpView().fields.map((field) => field.name);
const fieldValue = (name: string) => helpView().fields.find((field) => field.name === name)?.value ?? "";

describe("helpView", () => {
  it("documents every registered command", () => {
    const documented = helpView().fields.map((field) => `${field.name}\n${field.value}`).join("\n");
    for (const command of commandDefinitions) {
      expect(documented).toContain(`/${command.name}`);
    }
  });

  it("keeps the mention syntax in its own field", () => {
    const mentions = fieldValue("In any message");
    expect(mentions).toContain("[[Card name]]");
    expect(mentions).toContain("[[!Card name]]");
    expect(mentions).toContain("[[Card name|pocket]]");
  });

  it("stays inside the Discord field limits", () => {
    for (const field of helpView().fields) {
      expect(field.name.length).toBeLessThanOrEqual(256);
      expect(field.value.length).toBeLessThanOrEqual(1024);
    }
  });

  it("holds no em dash and no curly quote", () => {
    const text = `${HELP_INTRO}\n${JSON.stringify(helpView())}`;
    expect(text).not.toMatch(/[\u2014\u2013\u201c\u201d\u2018\u2019]/);
  });

  it("gives the details button its own line, since only the asker sees it", () => {
    expect(HELP_INTRO).toContain("Details");
  });
});

describe("parseHelpCommand", () => {
  const selfId = "1564749707740192818";

  it("reads a bare mention", () => {
    expect(parseHelpCommand(`<@${selfId}>`, selfId)).toBe(true);
  });

  it("reads the nickname mention form", () => {
    expect(parseHelpCommand(`<@!${selfId}>`, selfId)).toBe(true);
  });

  it("reads the word help after the mention", () => {
    expect(parseHelpCommand(`<@${selfId}> help`, selfId)).toBe(true);
  });

  it("ignores a mention followed by a question", () => {
    expect(parseHelpCommand(`<@${selfId}> which deck is best`, selfId)).toBe(false);
  });

  it("ignores another bot's mention", () => {
    expect(parseHelpCommand("<@999> help", selfId)).toBe(false);
  });

  it("ignores the word help with no mention", () => {
    expect(parseHelpCommand("help", selfId)).toBe(false);
  });
});
