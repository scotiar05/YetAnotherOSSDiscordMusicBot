const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { 
    createAudioPlayer, 
    createAudioResource, 
    joinVoiceChannel, 
    NoSubscriberBehavior, 
    AudioPlayerStatus 
} = require('@discordjs/voice');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const execAsync = promisify(exec);

let CONFIG = null;
let FILTERS = null;
let COMMANDS = null;
let ALIAS_MAP = null;

async function loadConfig() {
    try {
        const configPath = path.join(__dirname, 'config.json');
        const configData = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(configData);
        
        // Set up CONFIG with resolved paths
        CONFIG = {
            TOKEN: config.token,
            PREFIX: config.prefix,
            CACHE_DIR: path.join(__dirname, config.cache.directory),
            TEMP_DIR: path.join(__dirname, config.cache.tempDirectory),
            MAX_CACHE_SIZE: config.cache.maxSize,
            MAX_CACHE_AGE: config.cache.maxAge,
            MAX_SONG_DURATION: config.audio.maxSongDuration,
            MAX_QUEUE_SIZE: config.audio.maxQueueSize
        };

        // Set up FILTERS
        FILTERS = config.filters;

        // Set up COMMANDS
        COMMANDS = config.commands;

        // Generate ALIAS_MAP
        ALIAS_MAP = Object.entries(COMMANDS).reduce((map, [main, aliases]) => {
            aliases.forEach(alias => map[alias] = main);
            return map;
        }, Object.create(null));

    } catch (error) {
        console.error('Error loading config:', error);
        throw error;
    }
}

// Cache System
class CacheManager {
    constructor(cacheDir, maxSize, maxAge) {
        this.cacheDir = cacheDir;
        this.maxSize = maxSize;
        this.maxAge = maxAge;
        this.cacheMap = new Map();
    }

    async init() {
        try {
            await fs.mkdir(this.cacheDir, { recursive: true });
            await this.loadCacheMetadata();
            await this.cleanup();
        } catch (error) {
            console.error('Cache initialization error:', error);
        }
    }

    async loadCacheMetadata() {
        try {
            const files = await fs.readdir(this.cacheDir);
            for (const file of files) {
                const stats = await fs.stat(path.join(this.cacheDir, file));
                this.cacheMap.set(file, {
                    size: stats.size,
                    lastAccessed: stats.mtime.getTime()
                });
            }
        } catch (error) {
            console.error('Error loading cache metadata:', error);
        }
    }

    async cleanup() {
        const now = Date.now();
        const entries = Array.from(this.cacheMap.entries());
        
        // Sort by last accessed time (oldest first)
        entries.sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);
        
        let currentSize = entries.reduce((size, [, meta]) => size + meta.size, 0);
        
        for (const [filename, meta] of entries) {
            // Remove if too old or if we need to free up space
            if (now - meta.lastAccessed > this.maxAge || currentSize > this.maxSize) {
                try {
                    await fs.unlink(path.join(this.cacheDir, filename));
                    this.cacheMap.delete(filename);
                    currentSize -= meta.size;
                } catch (error) {
                    console.error(`Error removing cached file ${filename}:`, error);
                }
            }
        }
    }

    generateKey(url) {
        return crypto.createHash('md5').update(url).digest('hex');
    }

    async get(url) {
        const key = this.generateKey(url);
        const filepath = path.join(this.cacheDir, `${key}.mp3`);
        
        try {
            await fs.access(filepath);
            // Update last accessed time
            const stats = await fs.stat(filepath);
            this.cacheMap.set(`${key}.mp3`, {
                size: stats.size,
                lastAccessed: Date.now()
            });
            return filepath;
        } catch {
            return null;
        }
    }

    async set(url, filepath, duration) {
        if (duration > CONFIG.MAX_SONG_DURATION) return null;

        const key = this.generateKey(url);
        const cachedPath = path.join(this.cacheDir, `${key}.mp3`);
        
        try {
            await fs.copyFile(filepath, cachedPath);
            const stats = await fs.stat(cachedPath);
            this.cacheMap.set(`${key}.mp3`, {
                size: stats.size,
                lastAccessed: Date.now()
            });
            
            // Trigger cleanup if cache is too large
            if (this.getCacheSize() > this.maxSize) {
                await this.cleanup();
            }
            
            return cachedPath;
        } catch (error) {
            console.error('Error caching file:', error);
            return null;
        }
    }
    

    getCacheSize() {
        return Array.from(this.cacheMap.values())
            .reduce((total, meta) => total + meta.size, 0);
    }

    async clear() {
        try {
            const files = await fs.readdir(this.cacheDir);
            await Promise.all(files.map(file => 
                fs.unlink(path.join(this.cacheDir, file))
            ));
            this.cacheMap.clear();
        } catch (error) {
            console.error('Error clearing cache:', error);
            throw error;
        }
    }
}

// Queue System
class ServerQueue {
    constructor() {
        this.songs = [];
        this.playing = false;
        this.connection = null;
        this.player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play
            }
        });
        this.volume = 1;
        this.loop = false;
        this.activeFilters = new Set();
        this.textChannel = null;
    }

    async addSong(song) {
        if (this.songs.length >= CONFIG.MAX_QUEUE_SIZE) {
            throw new Error('Queue is full');
        }
        this.songs.push(song);
    }

    removeSong(index) {
        if (index >= 0 && index < this.songs.length) {
            return this.songs.splice(index, 1)[0];
        }
        return null;
    }

    clear() {
        this.songs = [];
        this.playing = false;
        this.loop = false;
        if (this.connection) {
            this.connection.destroy();
            this.connection = null;
        }
    }

    shuffle() {
        if (this.songs.length <= 1) return;
        const current = this.songs.shift();
        for (let i = this.songs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.songs[i], this.songs[j]] = [this.songs[j], this.songs[i]];
        }
        this.songs.unshift(current);
    }
}

class QueryCache {
    constructor() {
        this.cache = new Map();
    }

    getKey(query) {
        // Remove all non-alphanumeric characters and convert to lowercase
        return query.toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .trim();
    }

    async set(query, videoData) {
        const key = this.getKey(query);
        this.cache.set(key, {
            url: videoData.webpage_url,
            title: videoData.title,
            duration: videoData.duration,
            timestamp: Date.now()
        });

        // Persist cache to disk
        try {
            const cacheFile = path.join(CONFIG.CACHE_DIR, 'query_cache.json');
            const cacheData = Object.fromEntries(this.cache);
            await fs.writeFile(cacheFile, JSON.stringify(cacheData), 'utf8');
        } catch (error) {
            console.error('Error saving query cache:', error);
        }
    }

    get(query) {
        return this.cache.get(this.getKey(query));
    }

    async loadCache() {
        try {
            const cacheFile = path.join(CONFIG.CACHE_DIR, 'query_cache.json');
            const data = await fs.readFile(cacheFile, 'utf8');
            const cacheData = JSON.parse(data);
            this.cache = new Map(Object.entries(cacheData));
        } catch (error) {
            console.error('Error loading query cache:', error);
            this.cache = new Map();
        }
    }

    // Clean old entries (older than 30 days)
    async cleanup() {
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        for (const [key, data] of this.cache.entries()) {
            if (data.timestamp < thirtyDaysAgo) {
                this.cache.delete(key);
            }
        }
        // Save cleaned cache
        await this.set('', { webpage_url: '', title: '', duration: 0 });
    }
}

// Init query cache
const queryCache = new QueryCache();

// Audio Processing System
class AudioProcessor {
    static async applyFilters(inputPath, outputPath, filters) {
        if (!filters.size) return inputPath;

        const filterString = Array.from(filters)
            .map(filter => FILTERS[filter].ffmpegFilter)
            .join(',');

        try {
            await execAsync(`ffmpeg -i "${inputPath}" -af "${filterString}" -y "${outputPath}"`);
            return outputPath;
        } catch (error) {
            console.error('Error applying filters:', error);
            return inputPath;
        }
    }
    
    static async downloadSong(query, textChannel, filters = new Set()) {
        let tempFilePath = null;
        
        try {
            const isUrl = query.startsWith('http://') || query.startsWith('https://') || query.includes('.com') || query.includes('.net');
            const searchMsg = await textChannel.send('🔍 Searching for your song...');

            let videoData;
            let cachedQuery = null;

            // Check query cache first if it's not a URL
            if (!isUrl) {
                cachedQuery = queryCache.get(query);
                if (cachedQuery) {
                    await searchMsg.edit(`📀 Found (from cache): "${cachedQuery.title}" (${MessageEmbedFactory.formatDuration(cachedQuery.duration)})`);
                    videoData = {
                        webpage_url: cachedQuery.url,
                        title: cachedQuery.title,
                        duration: cachedQuery.duration
                    };
                }
            }

            // If not in query cache, search using yt-dlp
            if (!cachedQuery) {
                const searchFlag = isUrl ? '' : '--default-search "ytsearch"';
                const { stdout: videoInfo } = await execAsync(
                    `yt-dlp --dump-json ${searchFlag} "${query}" --flat-playlist --no-playlist --format-sort quality`
                );
                videoData = JSON.parse(videoInfo);
                await searchMsg.edit(`📀 Found: "${videoData.title}" (${MessageEmbedFactory.formatDuration(videoData.duration)})`);

                // Cache the query result if it's not a URL
                if (!isUrl) {
                    await queryCache.set(query, videoData);
                }
            }

            // Check file cache if no filters are active
            if (filters.size === 0) {
                const cachedPath = await cacheManager.get(videoData.webpage_url);
                if (cachedPath) {
                    const loadingMsg = await textChannel.send('📂 Found audio in cache! Loading...');
                    await loadingMsg.edit('✨ Preparing cached audio...');
                    return {
                        filepath: cachedPath,
                        title: videoData.title,
                        url: videoData.webpage_url,
                        duration: videoData.duration,
                        filtered: false
                    };
                }
            }

            // Download if not in cache
            const downloadMsg = await textChannel.send('⏳ Starting download...');
            const filename = `${Date.now()}.mp3`;
            tempFilePath = path.join(CONFIG.TEMP_DIR, filename);
            
            // yt-dlp command
            await execAsync(
                `yt-dlp -x --audio-format mp3 --audio-quality 96K ` +
                `--format "bestaudio[acodec=opus]/bestaudio/best" ` +
                `-o "${tempFilePath}" "${videoData.webpage_url}"`
            );
            
            await downloadMsg.edit('📥 Download complete! Processing audio...');

            // If no filters, move directly to cache and return cached path
            if (filters.size === 0) {
                const cachedPath = await cacheManager.set(videoData.webpage_url, tempFilePath, videoData.duration);
                // Clean up temp file after caching
                await fs.unlink(tempFilePath).catch(console.error);
                
                await textChannel.send('✅ Ready to play!');
                return {
                    filepath: cachedPath,
                    title: videoData.title,
                    url: videoData.webpage_url,
                    duration: videoData.duration,
                    filtered: false
                };
            }

            // Handle filters
            if (filters.size > 0) {
                const filterMsg = await textChannel.send('🎛️ Applying audio filters...');
                const filteredFilename = `${Date.now()}_filtered.mp3`;
                const filteredFilepath = path.join(CONFIG.TEMP_DIR, filteredFilename);
                
                const filterNames = Array.from(filters).join(', ');
                await filterMsg.edit(`🎛️ Applying filters: ${filterNames}...`);
                
                const processedFilepath = await this.applyFilters(tempFilePath, filteredFilepath, filters);
                
                // Clean up original temp file
                await fs.unlink(tempFilePath).catch(console.error);
                
                await filterMsg.edit('✨ Audio processing complete!');
                
                return {
                    filepath: processedFilepath,
                    title: videoData.title,
                    url: videoData.webpage_url,
                    duration: videoData.duration,
                    filtered: true
                };
            }
        } catch (error) {
            // Clean up temp file if something goes wrong
            if (tempFilePath) {
                await fs.unlink(tempFilePath).catch(console.error);
            }
            console.error('Error downloading song:', error);
            await textChannel.send('❌ An error occurred while processing your request. Please try again.');
            throw error;
        }
    }
}

// Message Embed Factory
class MessageEmbedFactory {
    static createNowPlayingEmbed(song, queue) {
        return new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🎵 Now Playing')
            .setDescription(song.title)
            .addFields(
                { 
                    name: 'Duration', 
                    value: this.formatDuration(song.duration)
                },
                { 
                    name: 'Loop Mode', 
                    value: queue.loop ? 'Enabled' : 'Disabled' 
                },
                { 
                    name: 'Volume', 
                    value: `${Math.round(queue.volume * 100)}%` 
                }
            );
    }

    static createQueueEmbed(songs) {
        return new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📃 Song Queue')
            .setDescription(
                songs.map((song, index) =>
                    `${index + 1}. ${song.title} (${this.formatDuration(song.duration)})`)
                    .join('\n')
            );
    }

    static createHelpEmbed() {
        return new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🎵 Music Bot Commands')
            .setDescription(`Prefix: ${CONFIG.PREFIX}\nExample: ${CONFIG.PREFIX}play never gonna give you up`)
            .addFields(
                {
                    name: 'Music Control',
                    value: [
                        `play (${COMMANDS.play.join(', ')}) - Play a song or add to queue`,
                        `pause (${COMMANDS.pause.join(', ')}) - Pause current song`,
                        `resume (${COMMANDS.resume.join(', ')}) - Resume playback`,
                        `skip (${COMMANDS.skip.join(', ')}) - Skip current song`,
                        `stop (${COMMANDS.stop.join(', ')}) - Stop playing and clear queue`
                    ].join('\n')
                },
                {
                    name: 'Queue Management',
                    value: [
                        `queue (${COMMANDS.queue.join(', ')}) - Show current queue`,
                        `loop (${COMMANDS.loop.join(', ')}) - Toggle loop mode`,
                        `shuffle (${COMMANDS.shuffle.join(', ')}) - Shuffle the queue`,
                        `nowplaying (${COMMANDS.nowplaying.join(', ')}) - Show current song`,
                        `volume (${COMMANDS.volume.join(', ')}) - Set volume (0-150%)`
                    ].join('\n')
                },
                {
                    name: 'Other',
                    value: [
                        `clear-cache (${COMMANDS['clear-cache'].join(', ')}) - Clear song cache (Admin)`,
                        `help (${COMMANDS.help.join(', ')}) - Show this help message`,
                        'filter <filter> - Apply audio filter',
                        'filters - List available filters',
                        'clearfilters - Remove all active filters'
                    ].join('\n')
                }
            );
    }

    static formatDuration(seconds) {
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }
}

// Main Bot Class
class MusicBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildVoiceStates,
            ]
        });
        this.queues = new Map();
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.on('messageCreate', this.handleMessage.bind(this));
        this.client.on('error', this.handleError.bind(this));
        process.on('unhandledRejection', this.handleError.bind(this));
    }

    async handleError(error) {
        console.error('Bot error:', error);
        // Implement error reporting/logging system here if needed
    }

    async handleMessage(message) {
        if (message.author.bot || !message.content.startsWith(CONFIG.PREFIX)) return;

        const args = message.content.slice(CONFIG.PREFIX.length).trim().split(/ +/);
        const alias = args.shift().toLowerCase();
        const command = ALIAS_MAP[alias];

        if (!command) return;

        try {
            await this.executeCommand(command, message, args);
        } catch (error) {
            console.error(`Error executing command ${command}:`, error);
            await message.reply('❌ An error occurred while executing the command.');
        }
    }

    async executeCommand(command, message, args) {
        // Validate voice channel requirements for music commands
        const musicCommands = ['play', 'skip', 'stop', 'pause', 'resume', 'volume'];
        if (musicCommands.includes(command) && !message.member.voice.channel) {
            await message.reply('❌ You need to be in a voice channel to use music commands!');
            return;
        }

        // Get or initialize server queue
        let serverQueue = this.queues.get(message.guild.id);
        if (!serverQueue && command !== 'help') {
            serverQueue = new ServerQueue();
            this.queues.set(message.guild.id, serverQueue);
        }

        // Execute appropriate command handler
        await this.commandHandlers[command].call(this, message, args, serverQueue);
    }

    // Command Handlers
    commandHandlers = {
        async play(message, args, serverQueue) {
            if (!args.length) {
                await message.reply('❌ Please provide a song to play!');
                return;
            }

            try {
                serverQueue.textChannel = message.channel;
                const query = args.join(' ');
                const songInfo = await AudioProcessor.downloadSong(query, message.channel, serverQueue.activeFilters);

                const song = {
                    url: songInfo.url,
                    title: songInfo.title,
                    filepath: songInfo.filepath,
                    duration: songInfo.duration
                };

                await serverQueue.addSong(song);

                if (!serverQueue.playing) {
                    await this.initializePlayback(message, serverQueue);
                } else {
                    await message.reply(`✅ Added to queue: ${song.title}`);
                }
            } catch (error) {
                console.error('Error in play command:', error);
                await message.reply('❌ Error playing the song!');
            }
        },

        async skip(message, args, serverQueue) {
            if (!serverQueue.playing) {
                await message.reply('❌ Nothing is playing!');
                return;
            }
            serverQueue.player.stop();
            await message.reply('⏭️ Skipped the song!');
        },

        async stop(message, args, serverQueue) {
            if (!serverQueue.playing) {
                await message.reply('❌ Nothing is playing!');
                return;
            }
            serverQueue.clear();
            this.queues.delete(message.guild.id);
            await message.reply('⏹️ Stopped the music!');
        },

        async pause(message, args, serverQueue) {
            if (!serverQueue.playing) {
                await message.reply('❌ Nothing is playing!');
                return;
            }
            serverQueue.player.pause();
            await message.reply('⏸️ Paused the music!');
        },

        async resume(message, args, serverQueue) {
            if (serverQueue.player.state.status !== AudioPlayerStatus.Paused) {
                await message.reply('❌ Music is not paused!');
                return;
            }
            serverQueue.player.unpause();
            await message.reply('▶️ Resumed the music!');
        },

        async volume(message, args, serverQueue) {
            if (!serverQueue.playing) {
                await message.reply('❌ Nothing is playing!');
                return;
            }
            const volume = parseInt(args[0]);
            if (isNaN(volume) || volume < 0 || volume > 150) {
                await message.reply('❌ Please provide a volume between 0 and 150!');
                return;
            }
            serverQueue.volume = volume / 100;
            serverQueue.player.state.resource.volume.setVolume(serverQueue.volume);
            await message.reply(`🔊 Volume set to ${volume}%`);
        },

        async loop(message, args, serverQueue) {
            if (!serverQueue.playing) {
                await message.reply('❌ Nothing is playing!');
                return;
            }
            serverQueue.loop = !serverQueue.loop;
            await message.reply(`🔁 Loop mode ${serverQueue.loop ? 'enabled' : 'disabled'}!`);
        },

        async shuffle(message, args, serverQueue) {
            if (!serverQueue.songs.length) {
                await message.reply('❌ Queue is empty!');
                return;
            }
            serverQueue.shuffle();
            await message.reply('🔀 Shuffled the queue!');
        },

        async queue(message, args, serverQueue) {
            if (!serverQueue.songs.length) {
                await message.reply('📃 Queue is empty!');
                return;
            }
            const embed = MessageEmbedFactory.createQueueEmbed(serverQueue.songs);
            await message.reply({ embeds: [embed] });
        },

        async nowplaying(message, args, serverQueue) {
            if (!serverQueue.playing) {
                await message.reply('❌ Nothing is playing!');
                return;
            }
            const embed = MessageEmbedFactory.createNowPlayingEmbed(serverQueue.songs[0], serverQueue);
            await message.reply({ embeds: [embed] });
        },

        async filter(message, args, serverQueue) {
            if (!args.length) {
                await message.reply('❌ Please specify a filter! Use !filters to see available filters.');
                return;
            }

            const filterName = args[0].toLowerCase();
            if (!FILTERS[filterName]) {
                await message.reply('❌ Invalid filter! Use !filters to see available filters.');
                return;
            }

            if (serverQueue.activeFilters.has(filterName)) {
                await message.reply('❌ This filter is already active!');
                return;
            }

            if (!serverQueue.playing) {
                await message.reply('❌ Nothing is playing to apply filters to!');
                return;
            }

            try {
                const currentSong = serverQueue.songs[0];
                serverQueue.activeFilters.add(filterName);

                await message.reply(`🎛️ Applying ${filterName} filter...`);
                const newSongInfo = await AudioProcessor.downloadSong(
                    currentSong.url,
                    message.channel,
                    serverQueue.activeFilters
                );

                currentSong.filepath = newSongInfo.filepath;
                currentSong.filtered = true;

                serverQueue.player.stop();
                await this.playSong(message.guild, currentSong, serverQueue);
                await message.reply(`✅ Applied ${filterName} filter!`);
            } catch (error) {
                console.error('Error applying filter:', error);
                await message.reply('❌ Error applying filter!');
            }
        },

        async clearfilters(message, args, serverQueue) {
            if (!serverQueue.playing) {
                await message.reply('❌ Nothing is playing!');
                return;
            }

            if (serverQueue.activeFilters.size === 0) {
                await message.reply('❌ No active filters!');
                return;
            }

            try {
                const currentSong = serverQueue.songs[0];
                serverQueue.activeFilters.clear();

                await message.reply('🎛️ Clearing all filters...');
                const newSongInfo = await AudioProcessor.downloadSong(
                    currentSong.url,
                    message.channel
                );

                currentSong.filepath = newSongInfo.filepath;
                currentSong.filtered = false;

                serverQueue.player.stop();
                await this.playSong(message.guild, currentSong, serverQueue);
                await message.reply('✅ Cleared all filters!');
            } catch (error) {
                console.error('Error clearing filters:', error);
                await message.reply('❌ Error clearing filters!');
            }
        },

        async filters(message, args, serverQueue) {
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🎛️ Available Filters')
                .setDescription('Use !filter <name> to apply a filter')
                .addFields(
                    Object.entries(FILTERS).map(([key, filter]) => ({
                        name: key,
                        value: `${filter.description}${serverQueue?.activeFilters?.has(key) ? ' (Active)' : ''}`,
                        inline: true
                    }))
                )
                .setFooter({ text: 'Use !clearfilters to remove all active filters' });

            await message.reply({ embeds: [embed] });
        },

        async help(message) {
            const embed = MessageEmbedFactory.createHelpEmbed();
            await message.reply({ embeds: [embed] });
        },

        async 'clear-cache'(message) {
            if (!message.member.permissions.has('ADMINISTRATOR')) {
                await message.reply('❌ You need administrator permissions to clear the cache!');
                return;
            }

            try {
                await cacheManager.clear();
                await message.reply('✅ Cache cleared successfully!');
            } catch (error) {
                console.error('Error clearing cache:', error);
                await message.reply('❌ Error clearing cache!');
            }
        }
    };

    // Playback Management
    async initializePlayback(message, serverQueue) {
        try {
            const connection = joinVoiceChannel({
                channelId: message.member.voice.channel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            serverQueue.connection = connection;
            connection.subscribe(serverQueue.player);

            await this.playSong(message.guild, serverQueue.songs[0], serverQueue);
        } catch (error) {
            console.error('Error initializing playback:', error);
            this.queues.delete(message.guild.id);
            await message.reply('❌ Error joining voice channel!');
            throw error;
        }
    }

    async playSong(guild, song, serverQueue) {
        if (!song) {
            serverQueue.playing = false;
            serverQueue.textChannel = null;
            return;
        }

        try {
            const resource = createAudioResource(song.filepath, {
                inlineVolume: true
            });
            resource.volume.setVolume(serverQueue.volume);

            serverQueue.player.play(resource);
            serverQueue.playing = true;

            const embed = MessageEmbedFactory.createNowPlayingEmbed(song, serverQueue);
            if (serverQueue.textChannel) {
                await serverQueue.textChannel.send({ embeds: [embed] });
            }

            this.setupPlaybackListeners(guild, song, serverQueue);
        } catch (error) {
            console.error('Error playing song:', error);
            if (serverQueue.textChannel) {
                await serverQueue.textChannel.send('❌ Error playing song! Skipping...');
            }
            serverQueue.songs.shift();
            await this.playSong(guild, serverQueue.songs[0], serverQueue);
        }
    }

    setupPlaybackListeners(guild, song, serverQueue) {
        const onStateChange = async (oldState, newState) => {
            if (newState.status === AudioPlayerStatus.Idle && oldState.status !== AudioPlayerStatus.Idle) {
                // Handle song completion
                if (serverQueue.loop) {
                    serverQueue.songs.push(serverQueue.songs[0]);
                }

                // Clean up temp files
                if (!song.filtered) {
                    const cachedPath = await cacheManager.get(song.url);
                    if (!cachedPath && !song.filepath.includes('cache')) {
                        await fs.unlink(song.filepath).catch(console.error);
                    }
                }

                serverQueue.songs.shift();
                await this.playSong(guild, serverQueue.songs[0], serverQueue);
            }
        };

        // Remove existing listeners before adding new ones
        serverQueue.player.removeAllListeners('stateChange');
        serverQueue.player.on('stateChange', onStateChange);
    }
}

let cacheManager = null;

// Main Init
async function init() {
    try {
        await loadConfig();
        // Init cache manager
 cacheManager = new CacheManager(
    CONFIG.CACHE_DIR,
    CONFIG.MAX_CACHE_SIZE,
    CONFIG.MAX_CACHE_AGE
);
        await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
        await cacheManager.init();
        
        const bot = new MusicBot();
        await bot.client.login(CONFIG.TOKEN);
        
        console.log('Bot is ready!');
    } catch (error) {
        console.error('Error initializing bot:', error);
        process.exit(1);
    }
}



// Start the bot
init();