/** Packages **/
import { Client, GatewayIntentBits, Collection, REST, Routes, Events, ActivityType, ChannelType, EmbedBuilder } from 'discord.js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
require('dotenv').config()

/** Environment **/
const production = false; // Change to true when in production

/** Discord client and embeds **/
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.Guilds] });
import { mainEmbed, testEmbed, irrverbsEmbed, studyEmbed, profileEmbed, configurationEmbed, inviteButtons } from './builders';

/** Database **/
import mongo from "./db/mongo";

/** Language **/
import { findOneAndUpdate } from './db/language-schema';
import { loadLanguages, setLanguage } from './language';
import language from './language';

/** Events **/

/** Slash commands **/
const commands = [];
client.commands = new Collection();
const foldersPath = join(__dirname, 'slashcommands');
const commandFolders = readdirSync(foldersPath);

for (const folder of commandFolders) {
	// Grab all the command files from the commands directory you created earlier
	const commandsPath = join(foldersPath, folder);
	const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js'));
	// Grab the SlashCommandBuilder#toJSON() output of each command's data for deployment
	for (const file of commandFiles) {
		const filePath = join(commandsPath, file);
		const command = require(filePath);
		if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command)
			commands.push(command.data.toJSON());
		} else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}

// Construct and prepare an instance of the REST module
let rest;
if (!production) {
    rest = new REST({ version: '10' }).setToken(process.env.TEST_TOKEN);
} else {
    rest = new REST({ version: '10' }).setToken(process.env.PROD_TOKEN);
}

// Deploy the commands
(async () => {
	try {
		console.log(`Started refreshing ${commands.length} application (/) commands.`);

		// The put method is used to fully refresh all commands in the guild with the current set
        const data = await rest.put(
            !production ? Routes.applicationGuildCommands(process.env.TEST_CLIENT_ID, process.env.TEST_GUILD_ID) : Routes.applicationCommands(process.env.PROD_CLIENT_ID),
            { body: commands }
        );

		console.log(`Successfully reloaded ${data.length} application (/) commands.`);
	} catch (error) {
		console.error(error);
	}
})();


client.once(Events.ClientReady, async () => {
    await loadLanguages(client)

    // Connects to the database
    await mongo().then(mongoose => {
        try {
            console.log('Connected to the database');
        } finally {
            mongoose.connection.close();
        }
    })

    // Setups the events
    const testAnswers = require('./events/button')
    const select = require('./events/select')
    testAnswers(client)
    select(client)

    console.log(`Currently in ${client.guilds.cache.size} servers`);

    // Set the bot's presence
    client.user.setPresence({
        activities: [{
            name: `${client.guilds.cache.size} servers`,
            type: ActivityType.Watching
        }],
        status: 'online'
    });
});

client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isChatInputCommand()) return;

	const command = interaction.client.commands.get(interaction.commandName);

	if (!command) {
		console.error(`No command matching ${interaction.commandName} was found.`);
		return;
	}

	try {
		await command.execute(interaction);
	} catch (error) {
		console.error(error);
		if (interaction.replied || interaction.deferred) {
			await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
		} else {
			await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
		}
	}
});

client.on(Events.GuildCreate, async guild => {
    // By default sets the bot language to english
    setLanguage(guild, "english")
    await mongo().then(async(mongoose) => {
        try {
            await findOneAndUpdate({
                _id: guild.id
            }, {
                _id: guild.id,
                language: "english"
            }, {
                upsert: true
            })
        } finally {
            mongoose.connection.close()
        }
    })

    // Sends an infomation message when the bot is added to a server    
    // Find the first channel of the server
    const channel = guild.channels.cache.filter(channel => channel.type == ChannelType.GuildText).first()
    if (!channel) return console.log("Impossible de trouver le premier channel du serveur.")
    
    await channel.send({ 
        embeds: [mainEmbed(guild), testEmbed(guild), irrverbsEmbed(guild), studyEmbed(guild), profileEmbed(guild), configurationEmbed(guild)],
        components: [inviteButtons(guild)]
    })

    // Sends a log message when the bot is added to a server
    const logChannel = client.guilds.cache.get('784075037333520395').channels.cache.get('1119649916617244832') // Test
    //const logChannel = client.guilds.cache.get('791608838209142796').channels.cache.get('943968391323066418') // Production
    if (!logChannel) return console.log("Le channel de logs des nouveaux serveur n'existe pas.")

    const guildOwner = await guild.fetchOwner()
    const newServerEmbed = new EmbedBuilder()
        .setTitle('New server !')
        .setColor("#03fc7b")
        .setDescription("The bot was added on the `" + `${guild.name}` + "` server. \n Server led by : `" + `${guildOwner.displayName}` + "`. They are **" + `${guild.memberCount}` + "** members on it.")
        .setFooter({ text: `The bot is now on ${client.guilds.cache.size} servers` })

    logChannel.send({
        embeds: [newServerEmbed]
    })
})

// Sends a message when the bot is removed from a server
client.on(Events.GuildDelete, async guild => {
    const logChannel = client.guilds.cache.get('784075037333520395').channels.cache.get('1119649916617244832') // Test
    //const logChannel = client.guilds.cache.get('791608838209142796').channels.cache.get('943968391323066418') // Production
    if (!logChannel) return console.log("Le channel de logs des serveur n'existe pas.")

    // Try finding the owner
    let guildOwner = 'Unknown'
    try {
        guildOwner = await guild.fetchOwner()
    } catch (err) {
        console.log("Impossible de trouver le propriétaire du serveur.")
    }

    // Create the embed
    const serverRemovedEmbed = new EmbedBuilder()
        .setTitle('Server removed !')
        .setColor("#fc0303")
        .setDescription("The bot was removed from the `" + `${guild.name}` + "` server. \n Server led by : `" + `${guildOwner.displayName}` + "`. They were **" + `${guild.memberCount}` + "** members on it.")
        .setFooter({ text: `The bot is now on ${client.guilds.cache.size} servers` })

    // Send the embed
    logChannel.send({
        embeds: [serverRemovedEmbed]
    })
})

if(!production) {
    client.login(process.env.TEST_TOKEN)
} else {
    client.login(process.env.PROD_TOKEN)
}