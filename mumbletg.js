/*
 * Telegram to mumble bridge using Espeak.
 */

var mumble = require('mumble'),
    fs = require('fs');
var yaml_config = require('node-yaml-config');
var exec = require('child_process').exec;
var spawn = require('child_process').spawn;
var http = require('http');
var redis = require("redis"),
    client = redis.createClient();
var sub = redis.createClient();

/* Load config */
var config = yaml_config.load('config.yml');

/* input stream */
var stream;

var options = {
    key: fs.readFileSync('key.pem'),
    cert: fs.readFileSync('cert.pem'),
};

/* Register Redis errors */
client.on("error", function(err) {
    console.log("Error " + err);
});

console.log('Connecting to: ' + config.server);
mumble.connect(config.server, options, (error, connection) => {
    if (error) {
        throw new Error(error);
    }

    console.log('Connected');
    connection.authenticate(config.name);
    connection.on('initialized', () => initialize(connection));
    connection.on('voice', onVoice);

    connection.on('user-disconnect', (user) => {
        console.log("User " + user.name + " disconnected");

        client.zadd("disconnectLog", new Date().getTime(), user.name);

        /* Update current mumble users online */
        client.srem("mumbleUsers", user.name);
    });

    connection.on('user-connect', (user) => {
        console.log("User " + user.name + " connected");

        client.zadd("connectLog", new Date().getTime(), user.name);

        /* Update current mumble users online */
        client.sadd("mumbleUsers", user.name);
    });
});

var onVoice = function(voice) {
    if (client.connected) {
        client.set("mumbleLatestVoice", new Date());
    }
};

/**
 * Initializes ESpeak and registers its callback.
 *
 * @param      connection  The connection with mumble.
 */
var initialize = function(connection) {
    client.del('mumbleUsers');
    var users = new Array();
    var currentUsers = connection.users();

    for (var u in currentUsers) {
        if (currentUsers[u].name != config.name) {
            users.push(currentUsers[u].name);
        }
    }

    if (users.length) {
        client.sadd('mumbleUsers', users);
    }

    stream = connection.inputStream({
        channels: 1,
        sampleRate: 22100,
        gain: 1
    });
};

function toSpeech(text) {

    console.log("[Speech] " + text);

    switch (config.tts) {
        case 'espeak':
            ttsEspeak(text);
            break;
        case 'google':
            ttsGoogle(text);
            break;
        case 'pico':
            ttsPico(text);
    }
}

function ttsEspeak(text) {
    var espeak = spawn('espeak', ['-v', config.espeak.language, '-a', '80', '-z', '--stdout', text]);
    var avconv = spawn('avconv', ['-i', 'pipe:0', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '22100', '-f', 'wav', 'pipe:1', '-y']);

    espeak.stdout.pipe(avconv.stdin);
    avconv.stdout.on('data', (data) => {
        stream.write(data);
    });
}

function ttsGoogle(text) {
    var url = 'http://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=' + text + '&tl=' + config.google.language;

    text = text.replace(/^(?=\n)$|^\s*|\s*$|\n\n+/gm, "");

    var request = http.get(url, (response) => {
        if (response.statusCode !== 200) {
            console.log(`Request Failed.\n` +
                `Status Code: ${response.statusCode}`)
        } else {
            var child = spawn('avconv', ['-i', 'pipe:0', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '22100', '-f', 'wav', 'pipe:1', '-y']);

            response.pipe(child.stdin);

            child.stdout.on('data', (data) => {
                stream.write(data);
            });
        }
    });
}

function ttsPico(text) {
    var cmd = 'pico2wave -l ' + config.pico.language + ' -w voice.wav' + ' " ' + text + '"';
    cmd = cmd + ' && avconv -i voice.wav -af "volume=0.5" -acodec pcm_s16le -ac 1 -ar 22100 converted.wav -y';

    exec(cmd, (error) => {
        // command output is in stdout
        if (error) {
            console.log('error while executing command ', cmd);
        }

        var file = fs.readFileSync('converted.wav');

        stream.write(file);
        console.log(text);
    });
}

/* Register callback for subscriptions */
sub.on("message", function(channel, message) {
    console.log("[redis] " + channel + ': "' + message + '"');
    toSpeech(message);
});

/* Subscribe to mumbleSay */
sub.subscribe("mumbleSay");