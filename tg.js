var tg = require('node-telegram-bot-api');
var redis = require("redis")
var moment = require('moment');
var yaml_config = require('node-yaml-config');
var client = redis.createClient();
var pub = redis.createClient();

/* Start timer */
var start = process.hrtime();

/* Load config */
var config = yaml_config.load('config.yml');

/* Register Redis errors */
client.on("error", function(err) {
    console.log("Error " + err);
});

console.log("Initialize Telegram Bot.")
const bot = new tg(config.telegram_token, {
    polling: true
});

bot.onText(/\/say/, (msg) => {
    if (msg.text != "/say") {
        var text = msg.from.first_name + ": " + msg.text.replace("/say","");
        pub.publish("mumbleSay", text);
    }
});

bot.onText(/\/sayl/, (msg) => {
    if (msg.text != "/sayl") {
        var text = msg.text.split(' ')[0] + ' ' + msg.from.first_name + ": " + msg.text.replace("/say","");
        pub.publish("mumbleSayl", text);
    }
});

bot.onText(/\/activity/, (msg) => {
    client.multi().get("mumbleLatestVoice").smembers('mumbleUsers').exec((err, reply) => {
        var timeDiff = new Date(reply[0]) - new Date();
        var userCount = reply[1].length;
        var response = "";

        if (userCount == 1) {
            response += "1 client is connected.\n";
        } else {
            response += userCount + " clients are connected.\n";
        }

        if (reply[0] == null) {
            response += "No voice activity recorded.";
        } else if (timeDiff > -500) {
            response += "Latest voice activity is now";
        } else {
            humanizedDuration = moment.duration(timeDiff, "milliseconds").humanize(true);
            response += "Latest voice activity was " + humanizedDuration;
        }

        console.log("[/activity] " + response);
        bot.sendMessage(msg.chat.id, response);
    });
});

bot.onText(/\/clients/, (msg) => {
    client.smembers('mumbleUsers', function(err, values) {
        if (!values.length) {
            console.log("[/clients] " + "No one is online");
            bot.sendMessage(msg.chat.id, "No one is online");
        } else {
            console.log("[/clients] " + values);
            bot.sendMessage(msg.chat.id, values.toString().replace(/,/g,'\n'));
        }
    });
});

bot.onText(/\/uptime/, (msg) => {
    var response = "Bot has been up for ";

    var duration = moment.duration(process.hrtime(start)[0], "seconds").humanize();
    console.log("[/uptime] " + response + duration);
    bot.sendMessage(msg.chat.id, response + duration);
});