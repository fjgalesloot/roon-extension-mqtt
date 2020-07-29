# roon-extension-mqtt
Extension for Roon that publishes status to a MQTT broker

## Installation

clone the repository and change to extension directory

run
```
npm install
nodejs .
```

To run as a systemd service, change the provided .service file as necessary and put the service configuration file in /etc/systemd/system.

You can set the hostname or IP address of the MQTT broker in the settings with the Roon application.

### Docker
You can also run this extension as a docker container. Example command:

`docker run -v [volume or host-folder]:/usr/src/app/config/ fjgalesloot/roon-extension-mqtt:latest`


## Topics

The extension subscribes to all zone updates and pushes all info it gets from the Zone object found on https://roonlabs.github.io/node-roon-api-transport/Zone.html defined by the node-roon-api-transport service. It prepends the data with "roon/[zone-name]/...".

The MQTT topci for the 1 Line Now Playing information for a zone called Zone1 is: `roon/Zone1/now_playing/one_line/line1`.

You can also see all published MQTT methods by uncommenting line 19 in app.js. Be aware that this will create a much larger log file.

### Control

To control a zone or an output, push a MQTT message to a zone/output like the following examples:

Send 'play' command to zone: publish to `roon/[zone-name]/command/` with message `play`

Send 'play' command to output: publish to `roon/[zone-name]/[output-name]/command` with message `play`


Available commands to use as message are defined by the RoonApiTransport: `play | pause | playpause | stop | previous | next`

### Volume

To set the volume for a zone use the syntax:

Set volume to 65 for output: publish to `roon/[zone-name]/outputs/[output-name]/volume/set`  with message `65`

### Browsing (beta only)

See for possible hierarchies: https://roonlabs.github.io/node-roon-api/RoonApiBrowse.html#~loadresultcallback

To play a specific browse item you can publish the Title of the item to play to a hierarchy topic or publish a JSON object if more control is desired.

Examples (message is case insensitive):

- publish to `roon/[zone-name]/internet_radio` the message containing `radio title` starts playing the internet radion station
- publish to `roon/[zone-name]/playlists` the message containing `playlist title` starts the play list (Play Now)
- publish to `roon/[zone-name]/playlists` the message containing `{"title":"playlist title", "action":"Shuffle"}` starts the playlist shuffled
- publish to `roon/[zone-name]/artists` the message containing `{"title":"artist name", "action":"Start Radio"}` starts Artist Radio
- publish to `roon/[zone-name]/artists` the message containing `{"title":"artist name", "album":"album title", "action":"Shuffled"}` starts the album shuffled
- publish to `roon/[zone-name]/artists` the message containing `{"title":"artist name", "album":"album title", "action":"Queue"}` queues the album
- publish to `roon/[zone-name]/albums` the message containing `album title` starts the first album with the album title (Play Now)
