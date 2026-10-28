import { MessageFlags, type Interaction } from "discord.js";

const FAILURE = "Card lookup failed, try again.";

/** Reports failure through a reply, deferred-command edit or ephemeral follow-up. */
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
