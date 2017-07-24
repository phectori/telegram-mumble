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
var clientb = redis.createClient({
    return_buffers: true
});
var sub = redis.createClient();
var translate = require('google-translate-api');
var ytdl = require('ytdl-core');

/* Load config */
var config = yaml_config.load('config.yml');

/* input stream */
var stream;
var musicStream;

var musicChannels = 1;
var musicGain = 0.1;

var options = {
    key: fs.readFileSync('key.pem'),
    cert: fs.readFileSync('cert.pem'),
};

/* Register Redis errors */
client.on("error", function(err) {
    console.log("Error " + err);
});
clientb.on("error", function(err) {
    console.log("Error " + err);
});

console.log('Connecting to: ' + config.server);
mumble.connect(config.server, options, (error, connection) => {
    if (error) {
        throw new Error(error);
    }

    console.log('Connected');
    connection.authenticate(config.name, config.password);
    connection.on('initialized', () => initialize(connection));
    connection.on('voice-end', onVoiceEnd);

    connection.on('user-disconnect', (user) => {
        console.log("User " + user.name + " disconnected");
        client.zadd("disconnectLog", new Date().getTime(), user.name);

        /* Update current mumble users online */
        client.srem("mumbleUsers", user.name);
    });

    connection.on('user-connect', (user) => {
        console.log("User " + user.name + " connected");
        connection.on('voice-user-' + user.session, (voice) => onUserVoice(voice, user.name));

        client.zadd("connectLog", new Date().getTime(), user.name);

        /* Update current mumble users online */
        client.sadd("mumbleUsers", user.name);
    });
});

var onUserVoice = function(voice, name) {
    clientb.send_command('lpush', ['voice-' + name, voice]);
    clientb.send_command('ltrim', ['voice-' + name, 0, 999]);
    clientb.send_command('expire', ['voice-' + name, 300]);
}

var onVoiceEnd = function(user) {
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
            connection.on('voice-user-' + currentUsers[u].session, (voice) => onUserVoice(voice, currentUsers[u].name));
        }
    }

    if (users.length) {
        client.sadd('mumbleUsers', users);
    }

    stream = connection.inputStream({
        channels: 1,
        sampleRate: 48000,
        gain: 1
    });

    musicStream = connection.inputStream({
        channels: musicChannels,
        sampleRate: 48000,
        gain: musicGain
    });
};

function toSpeech(text) {

    console.log("[Speech] " + text);

    switch (config.tts) {
        case 'espeak':
            ttsEspeak(text);
            break;
        case 'google':
            ttsGoogle(text, config.google.language);
            break;
        case 'pico':
            ttsPico(text);
    }
}

function ttsEspeak(text) {
    var espeak = spawn('espeak', ['-v', config.espeak.language, '-a', '80', '-z', '--stdout', text]);
    var avconv = spawn('avconv', ['-i', 'pipe:0', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '48000', '-f', 'wav', 'pipe:1', '-y']);

    espeak.stdout.pipe(avconv.stdin);
    avconv.stdout.on('data', (data) => {
        stream.write(data);
    });
}

function ttsGoogle(text, language) {
    var url = 'http://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=' + text + '&tl=' + language;

    console.log('[get] ' + url);

    var request = http.get(url, (response) => {
        if (response.statusCode !== 200) {
            console.log(`[googletts] Request Failed.\n` +
                `[googletts] Status Code: ${response.statusCode}`)
        } else {
            var child = spawn('avconv', ['-i', 'pipe:0', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '48000', '-f', 's16le', 'pipe:1', '-y']);

            response.pipe(child.stdin);

            musicStream.cork();

            child.stdout.on('data', (data) => {
                stream.write(data);
            });

            child.stdout.on('finish', (data) => {
                setTimeout(() => {
                    musicStream.uncork();
                }, 2000);
            });
        }
    });
}

function ttsPico(text) {
    var cmd = 'pico2wave -l ' + config.pico.language + ' -w voice.wav' + ' " ' + text + '"';
    cmd = cmd + ' && avconv -i voice.wav -af "volume=0.5" -acodec pcm_s16le -ac 1 -ar 48000 converted.wav -y';

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

function replay(user) {
    musicStream.cork();

    clientb.lrange('voice-' + user, 0, -1, (err, res) => {
        for (var i = res.length - 1; i >= 0; i--) {
            stream.write(res[i]);
        }
    });

    setTimeout(() => {
        musicStream.uncork();
    }, 11000);
}

function youtube(data) {
    var url = data['url']
    var parameter = data['arg'];

    if (url == 'pause') {
        musicStream.cork();
        return;
    } else if (url == 'resume') {
        musicStream.uncork();
        return;
    } else if (url == 'volume') {
        // Check for sanity
        if (parameter <= 0) {
            parameter = 0.01;
        } else if (parameter > 1) {
            parameter = 1;
        }
        musicGain = parameter;
        musicStream.setGain(musicGain);
        console.log('[yt] Youtube volume = ' + musicGain);
        return;
    }

    var avconv = spawn('avconv', ['-i', 'pipe:0', '-acodec', 'pcm_s16le', '-ac', musicChannels, '-ar', '48000', '-f', 's16le', 'pipe:1', '-y']);

    try {
        var yt = ytdl(url);
    } catch (err) {
        console.log('[yt] Youtube error');
    }

    yt.pipe(avconv.stdin);

    avconv.stdout.on('data', (data) => {
        musicStream.write(data);
    });
}

/* Register callback for subscriptions */
sub.on("message", function(channel, message) {

    var object = JSON.parse(message);

    if ("translateTo" in object) {
        console.log("[redis] " + channel + ': "' + message + '"');

        translate(object.text, {
            to: object.translateTo
        }).then(res => {
            console.log("[translate] to " + object.translateTo + ": " + res.text);
            ttsGoogle(res.text, object.lang);
        }).catch(err => {
            console.error(err);
        });
    } else if ("lang" in object) {
        console.log("[redis] " + channel + ': "' + object.text + '"');
        ttsGoogle(object.text, object.lang);
    } else if ("replay" in object) {
        console.log('[redis] replay "' + object.replay + '"');
        replay(object.replay);
    } else if ("youtube" in object) {
        console.log('[redis] youtube "' + JSON.stringify(object.youtube) + '"');
        youtube(object.youtube);
    } else {
        console.log("[redis] " + channel + ': "' + object.text + '"');
        toSpeech(object.text);
    }
});

/* Subscribe to mumbleSay */
sub.subscribe("mumbleSay");
