# roon-extension-mqtt
Roon Extension to integrate Roon into home automation systems by using the MQTT protocol

## Installation

clone the repository and change to extension directory

run
```
npm install
node .
```

To run as a systemd service, change the provided .service file as necessary and put the service configuration file in /etc/systemd/system.

You can set the hostname or IP address of the MQTT broker in the settings with the Roon application.

### Docker
You can also run this extension as a docker container. You'll have to use host networking for the extenstion to work properly with Roon.

Example commands:

for the master (stable) branch:

`docker run -v [volume or host-folder]:/usr/src/app/config/ --network host fjgalesloot/roon-extension-mqtt:latest`


or if you want to for the development (beta) branch: 

`docker run -v [volume or host-folder]:/usr/src/app/config/ --network host fjgalesloot/roon-extension-mqtt:beta`



## Topics

The extension subscribes to all zone updates and pushes all info it gets from the Zone object found on https://roonlabs.github.io/node-roon-api-transport/Zone.html defined by the node-roon-api-transport service. It prepends the data with "roon/[zone-name]/...".

The MQTT topci for the 1 Line Now Playing information for a zone called Zone1 is: `roon/Zone1/now_playing/one_line/line1`.

As the characters +, / and #  are illegal MQTT topic characters, those will be replaced by -. So if the name of a zone is `Kitchen / Living Room` you should use the topic `Kitchen - Living-Room` when subscribing and/or publishing. The same logic applies to the `[output-name]` descibed below. 

The extension will ignore `+ 1` and similar when zones are grouped. So a grouped zone named `Kitchen + 2` will need to be addressed as `Kitchen` when you want to publish or subscribe to topics.

### Control

To control a zone or an output, push a MQTT message to a zone/output like the following examples:

Send 'play' command to zone: publish to `roon/[zone-name]/command/` with message `play`

Send 'play' command to output: publish to `roon/[zone-name]/[output-name]/command` with message `play`

Available commands to use as message are defined by the RoonApiTransport: `play | pause | playpause | stop | previous | next`

### Settings

Settings apply to a zone, to change one push a MQTT message to a zone like the following examples:

Set 'shuffle' for a zone: publish to `roon/[zone-name]/settings/set/shuffle` with message `true` to activate and `false` to deactivate

Allowed messages for shuffle are: `true | false`

Set 'repeat' or 'loop' mode for a zone: publish to `roon/[zone-name]/[output-name]/settings/set/repeat` with message `all`

Allowed messages for repeat are: `disabled | one | all`

### Volume

To set the volume for a zone use the syntax:

Set volume to 65 for output: publish to `roon/[zone-name]/outputs/[output-name]/volume/set`  with message `65`
Mute or Unmute are also supported. Simpy publish the message `mute` or `unmute` to the same topic. When setting the volume the unmute command will also be sent to the output.

_Currently no check for valid volume levels is in place._

### Seek

To change the seek position of the currently playing media in a zone use the syntax:

Set seek position to 80 seconds for zone: publish to `roon/[zone-name]/seek/set`  with message `80`

_Currently no check for valid seek positions is in place._

### Power / Standby

So change the power mode of an output: publish to `roon/[zone-name]/outputs/[output-name]/power` with message `standby` to put the output into standby and `on` to power it on

Allowed messages for power are: `on | standby`

### Browsing

See for possible hierarchies: https://roonlabs.github.io/node-roon-api/RoonApiBrowse.html#~loadresultcallback

To play a specific browse item you can publish the Title of the item to play to a hierarchy topic or publish a JSON object if more control is desired.

Examples (message is case insensitive):

- publish to `roon/[zone-name]/browse/internet_radio` the message containing `radio title` starts playing the internet radion station
- publish to `roon/[zone-name]/browse/playlists` the message containing `playlist title` starts the play list (Play Now)
- publish to `roon/[zone-name]/browse/playlists` the message containing `{"title":"playlist title", "action":"Shuffle"}` starts the playlist shuffled
- publish to `roon/[zone-name]/browse/artists` the message containing `{"title":"artist name", "action":"Start Radio"}` starts Artist Radio
- publish to `roon/[zone-name]/browse/artists` the message containing `{"title":"artist name", "album":"album title", "action":"Shuffled"}` starts the album shuffled
- publish to `roon/[zone-name]/browse/artists` the message containing `{"title":"artist name", "album":"album title", "action":"Queue"}` queues the album
- publish to `roon/[zone-name]/browse/albums` the message containing `album title` starts the first album with the album title (Play Now)
