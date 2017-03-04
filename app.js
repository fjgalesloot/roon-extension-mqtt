const mqtt = require('mqtt');
var mqtt_client;
var core;

var internetradiostations;

var RoonApi = require("node-roon-api"),
	RoonApiStatus		= require("node-roon-api-status"),
	RoonApiTransport	= require("node-roon-api-transport"),
	RoonApiSettings		= require('node-roon-api-settings');


function mqtt_publish_JSON( mqttbase, mqtt_client, jsondata ) {
	mqtt_client.publish('roon/online','true');
	for ( var attribute in jsondata ) {
		if ( typeof jsondata[attribute] === 'object' ) {
			mqtt_publish_JSON( mqttbase+'/'+attribute, mqtt_client, jsondata[attribute] );
		} else {
			//console.log('sending MQTT: '+mqttbase+'/'+attribute+'='+jsondata[attribute]);
			mqtt_client.publish(mqttbase+'/'+attribute,jsondata[attribute].toString());
		}
	}

}

function makelayout(settings) {
    var l = {
        values:    settings,
	layout:    [],
	has_error: false
    };

    l.layout.push({
	type:    "string",
	title:   "MQTT Broker Host/IP",
	setting: "mqttbroker",
    });

   return l;
}


var roon = new RoonApi({
	extension_id:        'nl.fjgalesloot.mqtt',
	display_name:        "MQTT Extension",
	display_version:     "0.1",
	publisher:           'Floris Jan Galesloot',
	email:               'fjgalesloot@triplew.nl',
	//website:             'https://github.com/elvispresley/roon-extension-test'

	core_paired: function(core_) {
		core = core_;
		let transport = core.services.RoonApiTransport;
		transport.subscribe_zones(function(cmd, data) {
			if ( typeof data !== "undefined" ) {
				for( var index in data.zones_changed ) {
					var zone_change = data.zones_changed[index];
					var zone_name = zone_change.display_name;
					console.log('sending state for zone %s', zone_name);
					for ( var attribute in zone_change ) {
						mqtt_publish_JSON( 'roon/'+zone_name, mqtt_client, zone_change);
					}
				}
			}
		});
	},

	core_unpaired: function(core_) {
		console.log(_core.core_id,
			core.display_name,
			core.display_version,
			"-",
			"LOST");
	}
});

var mysettings = roon.load_config("settings") || {
	mqttbroker: "localhost",
};
get_mqtt_client();

var svc_status = new RoonApiStatus(roon);

var svc_settings = new RoonApiSettings(roon, {
    get_settings: function(cb) {
        cb(makelayout(mysettings));
    },
    save_settings: function(req, isdryrun, settings) {
	let l = makelayout(settings.values);
        req.send_complete(l.has_error ? "NotValid" : "Success", { settings: l });

        if (!isdryrun && !l.has_error) {
            mysettings = l.values;
            svc_settings.update_settings(l);
            roon.save_config("settings", mysettings);
        }
        get_mqtt_client();
    }
});

roon.init_services({
	required_services: [ RoonApiTransport ],
	provided_services: [ svc_settings, svc_status ]
});

function get_mqtt_client() {
	mqtt_client = mqtt.connect('mqtt://' + mysettings.mqttbroker);

	mqtt_client.on('connect', () => {
		mqtt_client.publish('roon/online','true');
		svc_status.set_status("MQTT Broker Connected", false);
	});

	mqtt_client.on('offline', () => {
		svc_status.set_status("MQTT Broker Offline", true);
	});
}

roon.start_discovery();
