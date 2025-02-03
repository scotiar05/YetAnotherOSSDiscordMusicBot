# 🎵 Discord Music Bot (WIP ALPHA)

Modifications coming. I need to remove FFMPEG from the main repo files, add its license in our "releases" page and have a proper "release" (that will have prepackaged FFMPEG, instead of it in being in the repostitory). And much more. WIP

Voice Recognition coming soon as well.

Anyways...:

A feature-rich, high-performance Discord music bot with audio filters, caching system, and extensive command support.

[![Discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg)](https://discord.js.org)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## ✨ Features

- 🎵 High-quality music playback
- 🎚️ 15+ real-time audio filters (nightcore, bass boost, reverb, etc.)
- 📋 Queue management with shuffle and loop modes
- 💾 Smart caching system for faster playback
- 🎮 Intuitive commands with aliases
- 🔊 Volume control
- 🎯 Support for direct URLs and search queries
- ⚡ Quick response times
- 🛠️ Configurable via config.json

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (v16.9.0 or higher)
- [FFmpeg](https://ffmpeg.org/)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/discord-music-bot.git
cd discord-music-bot
```

2. Install dependencies:
```bash
npm install
```

3. Create a `config.json` file:
```json
{
    "token": "YOUR_BOT_TOKEN",
    "prefix": "!",
    "cache": {
        "directory": "cache",
        "maxSize": 1073741824,
        "maxAge": 604800000,
        "tempDirectory": "downloads"
    },
    "audio": {
        "maxSongDuration": 600,
        "maxQueueSize": 100
    }
}
```

4. Start the bot:
```bash
node index.js
```

## 📝 Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| !play | p, play | Play a song or add to queue |
| !pause | pause, hold | Pause current song |
| !resume | r, resume, continue | Resume playback |
| !skip | s, skip, next | Skip current song |
| !stop | stop, leave, dc | Stop playing and clear queue |
| !queue | q, queue, list | Show current queue |
| !loop | l, loop, repeat | Toggle loop mode |
| !shuffle | sh, shuffle, mix | Shuffle the queue |
| !volume | v, vol | Set volume (0-150%) |
| !filter | f, filter | Apply audio filter |
| !filters | filters, fx | List available filters |
| !clearfilters | cf, clearfilters | Remove all active filters |

## 🎛️ Audio Filters

- 🌙 Nightcore
- 🌊 Vaporwave
- 🔊 Bass Boost
- 🎭 Chorus
- 🌟 Flanger
- 🔄 Phaser
- 📻 Lo-fi
- ⚡ Speed (0.8x - 1.2x)
- 🎹 Pitch shift
- 🌌 Reverb
- And more!

## 🛠️ Built With

- [Discord.js](https://discord.js.org/) - Discord API framework
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - Media downloader
- [FFmpeg](https://ffmpeg.org/) - Audio processing
- [@discordjs/voice](https://github.com/discordjs/voice) - Voice implementation
- [node-crypto](https://nodejs.org/api/crypto.html) - Caching system

## 📦 Project Structure

```
discord-music-bot/
├── index.js           # Main bot file
├── config.json        # Configuration file
├── cache/            # Cached audio files
├── downloads/        # Temporary downloads
├── temo/             # Created on its own. Just used as intermediatory directory for temporary files.
└── README.md         # This file
```

## 🔧 Configuration

The `config.json` file supports comprehensive configuration options:

### Basic Configuration
```json
{
    "token": "YOUR_BOT_TOKEN",
    "prefix": "!",
    "cache": {
        "directory": "cache",
        "maxSize": 1073741824,  // 1GB in bytes
        "maxAge": 604800000,    // 7 days in milliseconds
        "tempDirectory": "downloads"
    },
    "audio": {
        "maxSongDuration": 600, // 10 minutes in seconds
        "maxQueueSize": 100     // Maximum songs in queue
    }
}
```

### Audio Filters Configuration
The bot supports extensive audio filtering capabilities. Each filter can be configured with custom FFmpeg parameters:

```json
{
    "filters": {
        "nightcore": {
            "name": "nightcore",
            "ffmpegFilter": "asetrate=44100*1.25,aresample=44100,atempo=0.8",
            "description": "Increase pitch and speed (nightcore effect)"
        },
        "vaporwave": {
            "name": "vaporwave",
            "ffmpegFilter": "asetrate=44100*0.8,aresample=44100,atempo=1.25",
            "description": "Decrease pitch and slow down"
        },
        "bass_boost": {
            "name": "bass_boost",
            "ffmpegFilter": "bass=g=10",
            "description": "Boost bass frequencies"
        }
        // ... and many more filters
    }
}
```

### Command Aliases Configuration
You can customize command aliases to match your preferences:

```json
{
    "commands": {
        "play": ["p", "play"],
        "skip": ["s", "skip", "next"],
        "stop": ["stop", "leave", "disconnect", "dc"],
        "queue": ["q", "queue", "list"],
        "pause": ["pause", "hold"],
        "resume": ["resume", "r", "continue"],
        "nowplaying": ["np", "now", "current"],
        "loop": ["loop", "l", "repeat"],
        "shuffle": ["shuffle", "sh", "mix"],
        "volume": ["v", "vol", "volume"],
        "clear-cache": ["clearcache", "cc"],
        "help": ["h", "help", "commands"],
        "filter": ["filter", "f"],
        "filters": ["filters", "fx"],
        "clearfilters": ["clearfilters", "cf"]
    }
}
```

### Available Audio Filters
The bot includes the following pre-configured audio filters:
- 🎵 **nightcore**: Increase pitch and speed
- 🌊 **vaporwave**: Decrease pitch and slow down
- 💥 **earrape**: Add distortion effect
- 🎭 **reverb**: Add echo effect
- ⏪ **slow**: Slow down the audio (0.8x speed)
- ⏩ **fast**: Speed up the audio (1.2x speed)
- ⬆️ **pitch_up**: Increase pitch
- ⬇️ **pitch_down**: Decrease pitch
- 🔊 **bass_boost**: Boost bass frequencies
- 🎺 **trebble**: Boost high frequencies
- 🎭 **chorus**: Add chorus effect
- 🌀 **flanger**: Add flanger effect
- 🔄 **phaser**: Add phaser effect
- 〰️ **vibrato**: Add vibrato effect
- 📊 **compressor**: Add dynamic range compression

Each filter can be customized by modifying its FFmpeg parameters in the config file.

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Discord.js Community](https://discord.js.org/)
- [FFmpeg Team](https://ffmpeg.org/)
- [yt-dlp Contributors](https://github.com/yt-dlp/yt-dlp/graphs/contributors)
- All open-source libraries used in this project

## 🔒 Security

- Token is stored in config.json (make sure to add it to .gitignore)
- Cache management system prevents disk space issues
- Input validation on all commands
- Rate limiting on resource-intensive operations

## 📊 Performance

- Smart caching reduces bandwidth usage and improves response times
- Efficient queue management
- Optimized audio processing
- Memory usage monitoring
- Automatic cleanup of temporary files

## 🐛 Common Issues & Solutions

### Bot won't join voice channel
- Ensure bot has proper permissions
- Check if you're in a voice channel
- Verify voice channel permissions

### Audio quality issues
- Check your server region
- Verify FFmpeg installation
- Ensure sufficient bandwidth

### Cache issues
- Clear cache using !clear-cache
- Check available disk space
- Verify cache directory permissions

## 📬 Support

For support, please:
1. Check the common issues section above
2. Search through existing GitHub issues
3. Create a new issue with detailed information about your problem

---
