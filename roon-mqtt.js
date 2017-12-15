const mqtt = require('mqtt');
var mqtt_client, roon_core, roon_zones={};
var debug = false;
var trace = false;
var mqtt_data={};

var RoonApi 			= require("node-roon-api"),
	RoonApiStatus		= require("node-roon-api-status"),
	RoonApiTransport	= require("node-roon-api-transport"),
	RoonApiSettings		= require('node-roon-api-settings');


function mqtt_publish_JSON( mqttbase, mqtt_client, jsondata ) {
	mqtt_client.publish('roon/online','true');
	for ( var attribute in jsondata ) {
		if ( typeof jsondata[attribute] === 'object' ) {
			mqtt_publish_JSON( mqttbase+'/'+attribute, mqtt_client, jsondata[attribute] );
		} else if ( typeof mqtt_data[mqttbase+'/'+attribute] === 'undefined' || mqtt_data[mqttbase+'/'+attribute] != jsondata[attribute].toString()) {
			if ( trace ) { console.log('sending MQTT: '+mqttbase+'/'+attribute+'='+jsondata[attribute]); }
			mqtt_data[mqttbase+'/'+attribute] = jsondata[attribute].toString();
			mqtt_client.publish(mqttbase+'/'+attribute,jsondata[attribute].toString());
		}
	}

}

function mqtt_get_client() {
	mqtt_client = mqtt.connect('mqtt://' + mysettings.mqttbroker);

	mqtt_client.on('connect', () => {
		mqtt_client.publish('roon/online','true');
		mqtt_client.subscribe('roon/+/command');
		mqtt_client.subscribe('roon/+/outputs/+/volume/set');
		//mqtt_client.subscribe('roon/#');
		roon_svc_status.set_status("MQTT Broker Connected", false);
		
	});

	mqtt_client.on('offline', () => {
		roon_svc_status.set_status("MQTT Broker Offline", true);
	});
	
	mqtt_client.on('message', function (topic, message ) {
		if ( debug ) { console.log( 'received mqtt packet: topic=%s, message=%s', topic, message); }
		var topic_split = topic.split("/");
		if ( typeof roon_core !== 'undefined' && topic_split[0] === "roon" ) {
			if ( debug ) { console.log('we know of zones: %s', Object.keys(roon_zones) );}
			if ( typeof roon_zones[topic_split[1]] === "undefined" ) {
				console.log('zone %s not found!', topic_split[1] );
			} else if ( topic_split[2] === 'command' && topic_split.length == 3) {	
				// Control entire zone
				if ( debug ) { console.log('sending command %s to zone with id=%s', message, roon_zones[topic_split[1]]["zone_id"] );}
				roon_core.services.RoonApiTransport.control(roon_zones[topic_split[1]]["zone_id"], message.toString());
			} else if ( topic_split[2] === 'command'  && topic_split.length == 4) {				
				// Control single output in zone
				var outputid = roonzone_find_outputid_by_name(topic_split[1],topic_split[3]);
				if ( outputid == null ) {
					console.log('output %s not found in zone %s!', topic_split[3], topic_split[1] );
				} else {
					if ( debug ) { console.log('sending command %s to output with id=%s in zone=%s', message, outputid, topic_split[1] );}
					roon_core.services.RoonApiTransport.control(outputid, message.toString());					
				}
			} else if (topic_split[2] === 'outputs' && topic_split[4] === 'volume' && topic_split[5] === 'set') {
				if ( debug ) { console.log('find output id for zone=%s, output=%s', topic_split[1], topic_split[3]) ;}
				var outputid = roonzone_find_outputid_by_name(topic_split[1],topic_split[3]);
				if ( outputid == null ) {
					console.log('output %s not found in zone %s!', topic_split[3], topic_split[1] );
				} else {
					roon_core.services.RoonApiTransport.change_volume(outputid, "absolute", parseInt(message));
				}
			}
		}
		
	});
}

function roonzone_find_by_id(zoneid) {
	for ( var zonename in roon_zones ) {
		if ( roon_zones[zonename]["zone_id"] === zoneid ) {
			return zonename;
		}
	}
	return null;
}
function roonzone_find_outputid_by_name(zonename,outputname) {
	for ( var output in roon_zones[zonename]["outputs"] ) {
		if ( roon_zones[zonename]["outputs"][output]["display_name"] === outputname ) {
			return roon_zones[zonename]["outputs"][output]["output_id"];
		}
	}
	return null;
	
}
function roonzone_json_changeoutputs( zonedata ) {
	var newoutputs = {};
	for ( var index in zonedata["outputs"] ) {
		newoutputs[zonedata["outputs"][index]["display_name"]] = JSON.parse(JSON.stringify(zonedata["outputs"][index]));
	}
	zonedata["outputs"] = JSON.parse(JSON.stringify(newoutputs));
	return zonedata;
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
			if ( debug ) { console.log('we know of zones: %s', Object.keys(roon_zones) );}
			if ( typeof data !== "undefined" ) {
				for ( var zoneevent in data ) {
					if ( debug ) { console.log('zoneevent=%s', zoneevent); }
					if ( zoneevent =='zones_removed' ) {
						for ( var zoneindex in data[zoneevent] ) {							
							var zoneid=data[zoneevent][zoneindex];
							zonename = roonzone_find_by_id(zoneid);
							if ( debug ) { console.log('removed zone with id %s and name %s', zoneid, zonename); }
							mqtt_publish_JSON( 'roon/'+zonename, mqtt_client, { 'state' : 'removed' });
							delete roon_zones[zonename];
						}
					} else {
						var zones=data[zoneevent];
						for( var index in zones ) {
							var zonedata = roonzone_json_changeoutputs(zones[index]);
							var zonename = zonedata.display_name;
							//var regex = '';
							zonename = zonename.replace(/ \+.*/,'');
							roon_zones[zonename] = JSON.parse(JSON.stringify(zonedata));
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
		console.log(core_.core_id,
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
