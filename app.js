const mqtt = require('mqtt');
var mqtt_client, roon_core, roon_zones={};
var debug = true;

var RoonApi 			= require("node-roon-api"),
	RoonApiStatus		= require("node-roon-api-status"),
	RoonApiTransport	= require("node-roon-api-transport"),
	RoonApiSettings		= require('node-roon-api-settings');


function mqtt_publish_JSON( mqttbase, mqtt_client, jsondata ) {
	mqtt_client.publish('roon/online','true');
	for ( var attribute in jsondata ) {
		if ( typeof jsondata[attribute] === 'object' ) {
			mqtt_publish_JSON( mqttbase+'/'+attribute, mqtt_client, jsondata[attribute] );
		} else {
			if ( debug ) { console.log('sending MQTT: '+mqttbase+'/'+attribute+'='+jsondata[attribute]); }
			mqtt_client.publish(mqttbase+'/'+attribute,jsondata[attribute].toString());
		}
	}

}

function mqtt_get_client() {
	mqtt_client = mqtt.connect('mqtt://' + mysettings.mqttbroker);

	mqtt_client.on('connect', () => {
		mqtt_client.publish('roon/online','true');
		roon_svc_status.set_status("MQTT Broker Connected", false);
	});

	mqtt_client.on('offline', () => {
		roon_svc_status.set_status("MQTT Broker Offline", true);
	});
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
	website:             'https://github.com/fjgalesloot/roon-extension-mqtt',

	core_paired: function(core_) {
		roon_core = core_;
		let transport = core_.services.RoonApiTransport;
		transport.subscribe_zones(function(cmd, data) {
			if ( debug ) { console.log('we know of zones: %s', JSON.stringify(roon_zones) );}
			if ( typeof data !== "undefined" ) {
				for ( var zoneevent in data ) {
					if ( debug ) { console.log('zoneevent=%s', zoneevent); }
					if ( zoneevent =='zones_removed' ) {
						for ( var zoneindex in data[zoneevent] ) {
							var zoneid=data[zoneevent][zoneindex];
							zonename = roon_zones[zoneid];
							if ( debug ) { console.log('removed zone with id %s and name %s', zoneid, zonename); }
							mqtt_publish_JSON( 'roon/'+zonename, mqtt_client, { 'state' : 'removed' });
							delete roon_zones[zoneid];
						}
					} else {
						var zones=data[zoneevent];
						for( var index in zones ) {
							var zonedata = zones[index];
							var zonename = zonedata.display_name;
							if ( !roon_zones.hasOwnProperty(zonedata['zone_id']) ) {
								roon_zones[zonedata['zone_id']] = zonename;
							}
							console.log('sending state for zone %s', zonename);
							for ( var attribute in zonedata ) {
								mqtt_publish_JSON( 'roon/'+zonename, mqtt_client, zonedata);
							}
						}
					}
				}
			}
		});
	},

	core_unpaired: function(core_) {
		console.log(_core.core_id,
			core_.display_name,
			core_.display_version,
			"-",
			"LOST");
	}
});

var mysettings = roon.load_config("settings") || {
	mqttbroker: "localhost",
};
var roon_svc_status = new RoonApiStatus(roon);

var roon_svc_settings = new RoonApiSettings(roon, {
    get_settings: function(cb) {
        cb(makelayout(mysettings));
    },
    save_settings: function(req, isdryrun, settings) {
		let l = makelayout(settings.values);
        req.send_complete(l.has_error ? "NotValid" : "Success", { settings: l });

        if (!isdryrun && !l.has_error) {
            mysettings = l.values;
            roon_svc_settings.update_settings(l);
            roon.save_config("settings", mysettings);
        }
        mqtt_get_client();
    }
});

roon.init_services({
	required_services: [ RoonApiTransport ],
	provided_services: [ roon_svc_settings, roon_svc_status ]
});

mqtt_get_client();
roon.start_discovery();
