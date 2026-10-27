import { MessageFlags, type Interaction } from "discord.js";

const FAILURE = "Card lookup failed, try again.";

/**
 * Tell the user an interaction failed, whatever state its response is in. A
 * deferred command has to be edited, because a fresh reply is rejected and the
 * user would watch "thinking" until Discord gives up. A deferred button keeps its
 * card message, so the notice goes in an ephemeral follow-up instead.
 */
export async function reportInteractionFailure(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable()) return;
  if (!interaction.deferred && !interaction.replied) {
    await interaction.reply({ content: FAILURE, flags: MessageFlags.Ephemeral });
  } else if (interaction.deferred && !interaction.replied && interaction.isChatInputCommand()) {
    await interaction.editReply({ content: FAILURE });
  } else {
    await interaction.followUp({ content: FAILURE, flags: MessageFlags.Ephemeral });
  }
}
