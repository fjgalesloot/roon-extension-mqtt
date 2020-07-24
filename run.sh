#!/bin/bash
until env DEBUG="*" node ./roon-mqtt.js ; do
    echo "roon-extension-mqtt terminated with exit code $?.  Restarting.." >&2
    sleep 1
done