### Telegram to Mumble bridge using Espeak in Node.js

Dependencies:

    npm i mumble node-telegram-bot-api node-espeak node-yaml-config redis ytdl-core google-translate-api

To generate certificates:

    openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem

To install pico:

    sudo apt install libttspico0 libttspico-utils libttspico-data

To install avconv:

    sudo apt install libav-tools

To install and start redis-server:

    sudo apt install redis-server
    sudo systemctl start redis-server

Run with:

    node mumbletg.js
    node tg.js
