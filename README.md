# roon-extension-mqtt
Extension for Roon that publishes status to a MQTT broker

Install:

clone the repository and change to extension directory

run
```
npm install
nodejs .
```

To run as a systemd service, change the provided .service file as necessary and put the service configuration file in /etc/systemd/system.

You can set the hostname or IP address of the MQTT broker in the settings with the Roon application.


# Topics

The extension subscribes to all zone updates and pushes all info it gets from the Zone object found on https://roonlabs.github.io/node-roon-api-transport/Zone.html defined by the node-roon-api-transport service. It prepends the data with "roon/[zone-name]/...".

The MQTT method for the 1 Line Now Playing information for a zone called Zone1 is: `roon/Zone1/now_playing/one_line/line1`.

You can also see all published MQTT methods by uncommenting line 19 in app.js. Be aware that this will create a much larger log file.

## Control

To control a zone or an output, push a MQTT message to a zone/output like the following examples:

Send 'play' command to zone:   `/roon/[zone-name]/command/play`

Send 'play' command to output  `/roon/[zone-name]/[output-name]/play`


Available commands to use are defined by the RoonApiTransport: `play | pause | playpause | stop | previous | next`

## Volume

To set the volume for a zone use the syntax:

Set volume to 65 for output:  `/roon/[zone-name]/outputs/[output-name]/volume/set/65`


