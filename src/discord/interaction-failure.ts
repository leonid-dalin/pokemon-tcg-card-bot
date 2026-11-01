import { MessageFlags, type Interaction } from "discord.js";
import { OverloadedError } from "../api/limiter.js";

/** Message the failure reporter uses for a settings panel that cannot open part of its UI. */
export const SETTINGS_FAILURE = "The settings panel could not open that control. Try /settings again.";

/** Message the generic reporter must not use for a settings surface. */
export const FAILURE = "Card lookup failed, try again.";

/**
 * Picks the failure wording for an interaction. Settings controls are panel
 * buttons, modals and selects sharing the `st:` prefix, plus the `/settings`
 * command; telling a member their card lookup failed there names the wrong thing.
 */
export function failureMessageFor(interaction: Pick<Interaction, "isChatInputCommand"> & { commandName?: string; customId?: string }): string {
  if (interaction.isChatInputCommand()) {
    return interaction.commandName === "settings" ? SETTINGS_FAILURE : FAILURE;
  }
  return interaction.customId?.startsWith("st:") ? SETTINGS_FAILURE : FAILURE;
}

/** Maps an admission refusal to the hint a member can act on. */
export function overloadHint(error: unknown): number | undefined {
  return error instanceof OverloadedError ? (error.reason === "queue-full" ? 5 : 2) : undefined;
}

export function busyMessage(retryAfterSeconds: number): string {
  return `The card service is busy. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`;
}

/** Reports failure through a reply, deferred-command edit or ephemeral follow-up. */
export async function reportInteractionFailure(interaction: Interaction, error?: unknown, message?: string): Promise<void> {
  const hint = overloadHint(error);
  const content = hint === undefined ? message ?? failureMessageFor(interaction) : busyMessage(hint);
  // Autocomplete has no reply channel, so a refused lookup answers with an empty list.
  if (interaction.isAutocomplete()) {
    await interaction.respond([]).catch(() => {});
    return;
  }
  if (!interaction.isRepliable()) return;
  if (!interaction.deferred && !interaction.replied) {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  } else if (interaction.deferred && !interaction.replied && interaction.isChatInputCommand()) {
    await interaction.editReply({ content });
  } else {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  }
}
