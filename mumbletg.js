/*
 * Telegram to mumble bridge using Espeak.
 */

var mumble = require('mumble'),
    fs = require('fs');
var tg = require('node-telegram-bot-api');
var ESpeak = require('node-espeak');
var yaml_config = require('node-yaml-config');
var exec = require('child_process').exec;
var http = require('http');

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

    if (config.tts == 'espeak') {
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

        //ESpeak.speak(config.introduction);
    }
};

bot.on('message', (msg) => {
    var text = msg.from.first_name + ": " + msg.text;
    console.log(text);

    if (config.tts == 'espeak') {
        ESpeak.speak(text);
    } else if (config.tts == 'google') {
        var url = 'http://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=' + text + '&tl=' + config.google.language;

        var file = fs.createWriteStream("voice.mp3");
        var request = http.get(url, function(response) {
            response.pipe(file);
        });


        exec("avconv -i voice.mp3 -acodec pcm_s16le -ac 1 -ar 22100 voice.wav -y", function(error) {
            if (error) {
                console.log('error while executing command ');
            }
            var file = fs.readFileSync('voice.wav');
            stream.write(file);
        });
    } else {
        var cmd = 'pico2wave -l ' + config.pico.language + ' -w voice.wav' + ' " ' + text + '"';

        exec(cmd, function(error) {
            // command output is in stdout
            if (error) {
                console.log('error while executing command ', cmd);
            }

            var file = fs.readFileSync('voice.wav');

            stream.write(file);
            console.log(text);
        });
    }
});