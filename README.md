### Telegram to Mumble bridge using Espeak in Node.js

Dependencies:

    npm i mumble node-telegram-bot-api node-espeak node-yaml-config

To generate certificates:

    openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem

To install pico:

    sudo apt-get install libttspico0 libttspico-utils libttspico-data

Run with:

    node mumbletg.js
