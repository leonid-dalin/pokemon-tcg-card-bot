import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PermissionsBitField } from "discord.js";

/**
 * The invite links carry a permissions integer. It must decode to exactly the
 * permissions the setup guide tells operators to grant, because an integer that
 * omits Embed Links produces a bot that cannot show any card.
 */
const DOCUMENTED = [
  "ViewChannel",
  "SendMessages",
  "SendMessagesInThreads",
  "EmbedLinks",
  "ReadMessageHistory",
  "UseApplicationCommands",
  "ManageMessages",
];

const SETUP = readFileSync(new URL("../docs/setup.md", import.meta.url), "utf8");
const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

function documentedInteger(): string {
  const match = /permissions integer `(\d+)`/.exec(SETUP);
  if (!match?.[1]) throw new Error("docs/setup.md no longer states a permissions integer");
  return match[1];
}

function readmeInteger(): string {
  const match = /oauth2\/authorize\?[^"\s]*permissions=(\d+)/.exec(README);
  if (!match?.[1]) throw new Error("README.md no longer links an invite with permissions");
  return match[1];
}

describe("invite permissions", () => {
  it("decodes to exactly the documented permissions", () => {
    const decoded = new PermissionsBitField(BigInt(documentedInteger())).toArray().sort();
    expect(decoded).toEqual([...DOCUMENTED].sort());
  });

  it("includes Embed Links, without which no card reply can render", () => {
    const flags = new PermissionsBitField(BigInt(documentedInteger()));
    expect(flags.has(PermissionsBitField.Flags.EmbedLinks)).toBe(true);
  });

  it("grants no permission the bot does not need", () => {
    for (const unused of ["AttachFiles", "AddReactions", "BypassSlowmode", "ManageThreads", "Administrator"]) {
      const flags = new PermissionsBitField(BigInt(documentedInteger()));
      expect(flags.has(PermissionsBitField.Flags[unused as keyof typeof PermissionsBitField.Flags]), unused).toBe(false);
    }
  });

  it("uses the same integer in the README invite link", () => {
    expect(readmeInteger()).toBe(documentedInteger());
  });
});
