const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const dotenv = require('dotenv');

dotenv.config();

const prefix = '/'; // Changed prefix to /

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.DirectMessages
  ],
  partials: ['MESSAGE', 'CHANNEL', 'REACTION', 'USER', 'GUILD_MEMBER'],
});

const ROLE_VOTE_POWER = {
  "1361979519367516281": 1,  // 500 points
  "1361979674766610536": 2,  // 1,500 points
  "1361979883533635725": 3,  // 3,000 points
  "1361980132046409889": 5,  // 10,000 points
  "1361980407448338512": 7,  // 20,000 points
  "1361984472006004767": 10, // 30,000 points
  "1361980557176602737": 12, // 40,000 points
  "1361980722373595167": 15, // 50,000 points
  "1361980924195110992": 17, // 100,000 points
  "1361981187060666460": 20, // 250,000 points
};

const Database = require('@replit/database');
const db = new Database();
let currentPoll = null;

class Poll {
  constructor(question, options, duration, durationText) {
    this.question = question;
    this.options = options;
    this.votes = new Map();
    this.voteCounts = new Map();
    this.expiresAt = new Date(Date.now() + duration);
    this.message = null;
    this.updateInterval = null;
    this.isEnded = false;
    this.durationText = durationText;
  }

  async save() {
    await db.set('currentPoll', {
      question: this.question,
      options: this.options,
      votes: Array.from(this.votes.entries()),
      voteCounts: Array.from(this.voteCounts.entries()),
      expiresAt: this.expiresAt.getTime(),
    });
  }

  static async load() {
    const data = await db.get('currentPoll');
    if (!data) return null;

    const poll = new Poll(data.question, data.options, 0);
    poll.votes = new Map(data.votes);
    poll.voteCounts = new Map(data.voteCounts);
    poll.expiresAt = new Date(data.expiresAt);
    if (data.messageId && data.channelId) {
      poll.message = { id: data.messageId, channelId: data.channelId };
    }
    return poll;
  }

  async save() {
    await db.set('currentPoll', {
      question: this.question,
      options: this.options,
      votes: Array.from(this.votes.entries()),
      voteCounts: Array.from(this.voteCounts.entries()),
      expiresAt: this.expiresAt.getTime(),
      messageId: this.message?.id,
      channelId: this.message?.channel.id
    });
  }

  async displayPoll(channel) {
    if (this.isEnded) return;

    const embed = new EmbedBuilder()
      .setTitle('🗳️ Active Election Poll')
      .setDescription(`**${this.question}**\n\n*Vote wisely, The future of void is also on your hands!*`)
      .addFields(
        { name: '📋 Candidates', value: this.options.map((opt, i) => `\`${i + 1}\` • ${opt}`).join('\n'), inline: false },
        { name: '📊 Current Results', value: this.getResults(), inline: false },
        { name: '⏰ Time Info', value: `• Expires: ${this.durationText}\n• Remaining: ${Math.max(0, Math.ceil((this.expiresAt.getTime() - Date.now()) / 60000))} minutes`, inline: false },
        { name: '📝 How to Vote', value: '```Type the candidate name to cast your vote.```', inline: false }
      )
      .setColor('#FF6B6B')
      .setTimestamp()
      .setFooter({ text: 'Voting in progress • Your vote matters!' });

    try {
      if (this.message) {
        try {
          await this.message.edit({ embeds: [embed] });
        } catch (error) {
          if (error.code === 10008) { // Unknown Message error
            this.message = await channel.send({ embeds: [embed] });
          } else {
            throw error;
          }
        }
      } else {
        this.message = await channel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error('Error displaying poll:', error);
      this.message = await channel.send({ embeds: [embed] });
      await this.message.pin();
    }
  }

  getResults() {
    return this.options
      .map(opt => `${opt}: ${this.voteCounts.get(opt) || 0} votes`)
      .join('\n') || 'No votes yet';
  }
}

const commands = new Map();

function registerCommand(name, description, handler) {
  commands.set(name, { description, handler });
}

registerCommand('help', 'Shows the list of available commands', async (message) => {
  const embed = new EmbedBuilder()
    .setTitle('Available Commands')
    .setColor('Blue')
    .setDescription(
      Array.from(commands.entries())
        .map(([name, cmd]) => `**${prefix}${name}**: ${cmd.description}`)
        .join('\n')
    );
  await message.channel.send({ embeds: [embed] });
});

registerCommand('poll', 'Create a new poll (Usage: /poll "Question" option1,option2,option3 duration) - Use m for minutes, h for hours, M for months, d for days', async (message) => {
  if (currentPoll) {
    await message.reply('There is already an active poll!');
    return;
  }

  const args = message.content.match(/"([^"]+)"\s+([^"]+)\s+(\d+[mhMd])/);
  if (!args) {
    await message.reply('Invalid format! Use: /poll "Question" option1,option2,option3 duration (e.g., 30m, 24h, 7d)');
    return;
  }

  const question = args[1];
  const options = args[2].split(',').map(opt => opt.trim());
  const duration = args[3];

  let ms;
  const value = parseInt(duration);
  const unit = duration.slice(-1);

  if (!['m', 'h', 'd'].includes(unit)) {
    throw new Error('Invalid duration format! Use m for minutes, h for hours, or d for days');
  }

  switch(unit) {
    case 'm':
      ms = Math.min(value * 60000, 2147483647); // minutes
      break;
    case 'h':
      ms = Math.min(value * 3600000, 2147483647); // hours
      break;
    case 'd':
      ms = Math.min(value * 86400000, 2147483647); // days
      break;
  }

  currentPoll = new Poll(question, options, ms, duration);
  await currentPoll.displayPoll(message.channel);

  setTimeout(async () => {
    if (currentPoll) {
      // Get final vote counts and find winner
      const results = Array.from(currentPoll.voteCounts.entries());
      const winner = results.reduce((max, current) => 
        (current[1] > max[1] ? current : max), ['', 0]);

      // Create results message with vote counts
      const resultsList = results
        .map(([candidate, votes]) => 
          candidate === winner[0] 
            ? `**🏆 ${candidate}: ${votes} votes**` 
            : `${candidate}: ${votes} votes`)
        .join('\n');

      const announcement = new EmbedBuilder()
              .setTitle('🎉 Election Results 🏆')
              .setDescription(`**The votes are in! The results are final!**\n\n🌟 Congratulations to **${winner[0]}** on winning the election! Your leadership will guide us forward!\n\n💫 To all other candidates: Thank you for participating and showing great spirit. Your dedication makes our community stronger!`)
              .addFields(
                { name: '👑 Winner', value: `**${winner[0]}**`, inline: false },
                { name: '📊 Final Vote Count', value: resultsList, inline: false },
              )
              .setColor('#FFD700')
              .setTimestamp()
              .setFooter({ text: 'Thank you for participating in the election!' });

      await message.channel.send({ content: '@everyone', embeds: [announcement] });
      await db.delete('currentPoll');
      currentPoll = null;
    }
  }, ms);
});

registerCommand('deletepoll', 'Delete the active poll (Usage: /deletepoll)', async (message) => {
  if (!currentPoll) {
    await message.reply('There is no active poll to delete!');
    return;
  }

  try {
    if (currentPoll.message) {
      await currentPoll.message.delete().catch(() => {});
    }
    await db.delete('currentPoll');
    currentPoll = null;
    await message.reply('Poll deleted successfully!');
  } catch (error) {
    console.error('Error deleting poll:', error);
    await message.reply('Error deleting poll. Please try again.');
  }
});

registerCommand('roles', 'Show voting power for each role', async (message) => {
  const roleInfo = [];
  for (const [roleId, power] of Object.entries(ROLE_VOTE_POWER)) {
    const role = message.guild.roles.cache.get(roleId);
    if (role) {
      roleInfo.push(`${role.name}: ${power} voting power`);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('Role Voting Powers')
    .setDescription(roleInfo.join('\n') || 'No roles configured')
    .setColor('Purple');

  await message.channel.send({ embeds: [embed] });
});

async function handleVote(message) {
  if (!currentPoll || message.author.bot || message.channel.id !== currentPoll.message?.channel.id) return;

  const vote = message.content.trim();

  const sendTemporaryMessage = async (content) => {
    try {
      const msg = await message.channel.send({
        content,
        reference: { messageId: message.id },
        failIfNotExists: false
      });
      setTimeout(() => {
        message.delete().catch(() => {});
        msg.delete().catch(() => {});
      }, 5000);
      return msg;
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  if (!currentPoll.options.includes(vote)) {
    await sendTemporaryMessage("Invalid option! Please vote for one of the listed candidates.");
    return;
  }

  const userId = message.author.id;
  if (currentPoll.votes.has(userId)) {
    await sendTemporaryMessage("You have already voted! Votes cannot be changed.");
    return;
  }

  const member = await message.guild.members.fetch(userId);
  let votePower = 0;
  for (const [roleId, power] of Object.entries(ROLE_VOTE_POWER)) {
    if (member.roles.cache.has(roleId)) {
      votePower = Math.max(votePower, power);
    }
  }

  if (votePower === 0) {
    await sendTemporaryMessage("You don't have any roles with voting power! You need at least one role with voting power to participate in polls.");
    return;
  }

  currentPoll.votes.set(userId, vote);
  currentPoll.voteCounts.set(vote, (currentPoll.voteCounts.get(vote) || 0) + votePower);
  await currentPoll.save();

  // Send vote confirmation first
  const voteEmbed = new EmbedBuilder()
      .setColor('#7289DA')
      .setDescription(`✅ Vote for **${vote}** counted with **${votePower} votes**`);
  await message.reply({ embeds: [voteEmbed] });

  // Delete previous poll message if it exists
  if (currentPoll.message) {
    await currentPoll.message.delete().catch(console.error);
  }

  // Send new poll message last
  await currentPoll.displayPoll(message.channel);
}

client.on('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Load saved poll if exists
  currentPoll = await Poll.load();
  if (currentPoll) {
    // Check if poll hasn't expired
    if (currentPoll.expiresAt > new Date()) {
      const channel = await client.channels.fetch(currentPoll.message?.channel.id).catch(() => null);
      if (channel) {
        await currentPoll.displayPoll(channel);

        // Set up expiration timer for remaining duration
        const remainingTime = currentPoll.expiresAt.getTime() - Date.now();
        setTimeout(async () => {
          if (currentPoll) {
            const results = Array.from(currentPoll.voteCounts.entries());
            const winner = results.reduce((max, current) => 
              (current[1] > max[1] ? current : max), ['', 0]);

            const resultsList = results
              .map(([candidate, votes]) => 
                candidate === winner[0] 
                  ? `**🏆 ${candidate}: ${votes} votes**` 
                  : `${candidate}: ${votes} votes`)
              .join('\n');

            const announcement = new EmbedBuilder()
              .setTitle('🎉 Election Results 🏆')
              .setDescription(`**The votes are in! The results are final!**\n\n🌟 Congratulations to **${winner[0]}** on winning the election! Your leadership will guide us forward!\n\n💫 To all other candidates: Thank you for participating and showing great spirit. Your dedication makes our community stronger!`)
              .addFields(
                { name: '👑 Winner', value: `**${winner[0]}**`, inline: false },
                { name: '📊 Final Vote Count', value: resultsList, inline: false },
              )
              .setColor('#FFD700')
              .setTimestamp()
              .setFooter({ text: 'Thank you for participating in the election!' });

            if (currentPoll.updateInterval) {
              clearInterval(currentPoll.updateInterval);
            }
            currentPoll.isEnded = true;
            if (currentPoll.message) {
              await currentPoll.message.delete().catch(() => {});
            }
            await channel.send({ content: '@everyone', embeds: [announcement] });
            await db.delete('currentPoll');
            currentPoll = null;
          }
        }, remainingTime);
      }
    } else {
      // Poll has expired, clean it up
      await db.delete('currentPoll');
      currentPoll = null;
    }
  }

  try {
    const commands = [
      {
        name: 'help',
        description: 'Shows the list of available commands'
      },
      {
        name: 'poll',
        description: 'Create a new poll',
        options: [
          {
            name: 'question',
            description: 'The poll question',
            type: 3,
            required: true
          },
          {
            name: 'options',
            description: 'Comma-separated list of options',
            type: 3,
            required: true
          },
          {
            name: 'duration',
            description: 'Duration format: ##m (minutes), ##h (hours), ##d (days)',
            type: 3,
            required: true
          }
        ]
      },
      {
        name: 'roles',
        description: 'Show voting power for each role'
      },
      {
        name: 'deletepoll',
        description: 'Delete an active poll',
        options: [
          {
            name: 'messageid',
            description: 'ID of the poll message to delete',
            type: 3,
            required: true
          }
        ]
      }
    ];

    await client.application.commands.set(commands);
    console.log('Slash commands registered successfully');
  } catch (error) {
    console.error('Error registering slash commands:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  // Check if user has the required role for poll management
  const hasPermission = interaction.member.roles.cache.has('1370771579809697945');

  try {
    switch (interaction.commandName) {
      case 'help':
        const embed = new EmbedBuilder()
          .setTitle('Available Commands')
          .setColor('Blue')
          .setDescription(
            Array.from(commands.entries())
              .map(([name, cmd]) => `**/${name}**: ${cmd.description}`)
              .join('\n')
          );
        await interaction.reply({ embeds: [embed] });
        break;

      case 'poll':
        if (!hasPermission) {
          await interaction.reply({ content: 'You do not have permission to create polls!', ephemeral: true });
          return;
        }
        
        if (currentPoll) {
          await interaction.reply('There is already an active poll!');
          return;
        }

        const question = interaction.options.getString('question');
        const options = interaction.options.getString('options').split(',').map(opt => opt.trim());
        const duration = interaction.options.getString('duration');

        let ms;
        const value = parseInt(duration);
        const unit = duration.slice(-1);

        switch(unit) {
          case 'm':
            ms = Math.min(value * 60000, 2147483647); // minutes
            break;
          case 'h':
            ms = Math.min(value * 3600000, 2147483647); // hours
            break;
          case 'd':
            ms = Math.min(value * 86400000, 2147483647); // days
            break;
          default:
            await interaction.reply('Invalid duration format! Use m for minutes, h for hours, or d for days');
            return;
        }

        if (currentPoll && !currentPoll.isEnded) {
          await interaction.reply('There is already an active poll!');
          return;
        }

        currentPoll = new Poll(question, options, ms, duration);
        await currentPoll.displayPoll(interaction.channel);
        await interaction.reply('Poll created successfully!');

        // Set up minute update interval
        currentPoll.updateInterval = setInterval(async () => {
          if (currentPoll && !currentPoll.isEnded) {
            await currentPoll.displayPoll(interaction.channel);
          }
        }, 60000);

        setTimeout(async () => {
          if (currentPoll) {
            // Get final vote counts and find winner
            const results = Array.from(currentPoll.voteCounts.entries());
            const winner = results.reduce((max, current) => 
              (current[1] > max[1] ? current : max), ['', 0]);

            // Create results message with vote counts
            const resultsList = results
              .map(([candidate, votes]) => 
                candidate === winner[0] 
                  ? `**🏆 ${candidate}: ${votes} votes**` 
                  : `${candidate}: ${votes} votes`)
              .join('\n');

            const announcement = new EmbedBuilder()
              .setTitle('🎉 Election Results 🏆')
              .setDescription(`**The votes are in! The results are final!**\n\n🌟 Congratulations to **${winner[0]}** on winning the election! Your leadership will guide us forward!\n\n💫 To all other candidates: Thank you for participating and showing great spirit. Your dedication makes our community stronger!`)
              .addFields(
                { name: '👑 Winner', value: `**${winner[0]}**`, inline: false },
                { name: '📊 Final Vote Count', value: resultsList, inline: false },
              )
              .setColor('#FFD700')
              .setTimestamp()
              .setFooter({ text: 'Thank you for participating in the election!' });

            await interaction.channel.send({ content: '@everyone', embeds: [announcement] });
            await db.delete('currentPoll');
            currentPoll = null;
          }
        }, ms);
        break;

      case 'roles':
        const roleInfo = [];
        for (const [roleId, power] of Object.entries(ROLE_VOTE_POWER)) {
          const role = interaction.guild.roles.cache.get(roleId);
          if (role) {
            roleInfo.push(`${role.name}: ${power} voting power`);
          }
        }

        const rolesEmbed = new EmbedBuilder()
          .setTitle('Role Voting Powers')
          .setDescription(roleInfo.join('\n') || 'No roles configured')
          .setColor('Purple');

        await interaction.reply({ embeds: [rolesEmbed] });
        break;

      case 'deletepoll':
        if (!hasPermission) {
          await interaction.reply({ content: 'You do not have permission to delete polls!', ephemeral: true });
          return;
        }
        
        if (!currentPoll) {
          await interaction.reply('There is no active poll to delete!');
          return;
        }

        try {
          if (currentPoll.message) {
            await currentPoll.message.delete().catch(() => {});
          }
          await db.delete('currentPoll');
          currentPoll = null;
          await interaction.reply('Poll deleted successfully!');
        } catch (error) {
          console.error('Error deleting poll:', error);
          await interaction.reply('Error deleting poll. Please try again.');
        }
        break;
    }
  } catch (error) {
    console.error('Error handling command:', error);
    await interaction.reply({ content: 'An error occurred while executing the command.', ephemeral: true });
  }
});

client.on('messageCreate', async (message) => {
  if (!message.author.bot) {
    await handleVote(message);
  }
});

client.login(process.env.TOKEN);

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});