/*
 * Telegram to mumble bridge using Espeak.
 */

var mumble = require('mumble'),
    fs = require('fs');
var tg = require('node-telegram-bot-api');
var ESpeak = require('node-espeak');
var yaml_config = require('node-yaml-config');

/* Load config */
var config = yaml_config.load('config.yml');

/* input stream */
var stream;

var options = {
    key: fs.readFileSync('key.pem'),
    cert: fs.readFileSync('cert.pem'),
};

console.log("Initialize Telegram Bot.")
const bot = new tg(config.telegram_token, {
    polling: true
});

console.log('Connecting to: ' + config.server);
mumble.connect(config.server, options, function(error, connection) {
    if (error) {
        throw new Error(error);
    }

    console.log('Connected');
    connection.authenticate(config.name);
    connection.on('initialized', () => generateSpeech(connection));
});

/**
 * Initializes ESpeak and registers its callback.
 *
 * @param      connection  The connection with mumble.
 */
var generateSpeech = function(connection) {
    stream = connection.inputStream({
        channels: 1,
        sampleRate: 22100,
        gain: 1
    });

    ESpeak.initialize();

    ESpeak.setLanguage(config.espeak.language);
    ESpeak.setGender(config.espeak.gender);
    ESpeak.setPitch(config.espeak.pitch);
    ESpeak.setRange(config.espeak.range);
    ESpeak.setGap(config.espeak.gap);
    ESpeak.setRate(config.espeak.rate);
    ESpeak.setVolume(config.espeak.volume);

    ESpeak.onVoice(function(wav, samples, samplerate) {
        stream.write(wav);
    });

    ESpeak.speak(config.introduction);
};

bot.on('message', (msg) => {
    var text = msg.from.first_name + ": " + msg.text;
    ESpeak.speak(text);
    console.log(text);
});
