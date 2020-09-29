
const mqtt = require('mqtt');
const fs = require('fs');
var mqtt_client, roon_core, roon_zones={};
var debug = false;
var trace = false;
var mqtt_data={};

var RoonApi 			= require("node-roon-api"),
	RoonApiStatus		= require("node-roon-api-status"),
	RoonApiTransport	= require("node-roon-api-transport"),
	RoonApiSettings		= require('node-roon-api-settings'),
	RoonApiBrowse    	= require('node-roon-api-browse');


function mqtt_publish_JSON( mqttbase, mqtt_client, jsondata ) {
	if ( mqtt_client && mqtt_client.connected ) {
//		mqtt_client.publish('roon/online','true');
		for ( var attribute in jsondata ) {
			if ( typeof jsondata[attribute] === 'object' ) {
				mqtt_publish_JSON( mqttbase+'/'+attribute, mqtt_client, jsondata[attribute] );
			} else if ( typeof mqtt_data[mqttbase+'/'+attribute] === 'undefined' || mqtt_data[mqttbase+'/'+attribute] != jsondata[attribute].toString()) {
				if ( trace ) { console.log('*** sending MQTT: '+mqttbase+'/'+attribute+'='+jsondata[attribute]); }
				mqtt_data[mqttbase+'/'+attribute] = jsondata[attribute].toString();
				mqtt_client.publish(mqttbase+'/'+attribute,jsondata[attribute].toString());

			} else {
				if ( debug ) { console.log( '*** mqtt_publish_JSON nothing to publish to %s', mqttbase ); }
			}
		}
	} else {
		if ( debug ) { console.log( '*** mqtt_publish_JSON called but unable to publish. mqtt_client=%s', typeof mqttclient !== 'undefined' ? JSON.stringify(mqttclient) : 'undefined' ); }
	}
}

function mqtt_get_client() {
	try {
		if ( mqtt_client ) { mqtt_client.end(); }
		var protocol = "mqtt://";
		if ( mysettings.mqttprotocol ) { protocol = mysettings.mqttprotocol; }
		options = {};
		options.clean = true;
		options.clientId = "roon-extension-mqtt-" + (Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 5)); //+= "." + hostname;
		options.servername = mysettings.mqttbroker;
		options.will = { topic: 'roon/online', payload: 'false', retain: true };
		if ( mysettings.mqttusername && mysettings.mqttpassword ) {
			options.username = mysettings.mqttusername;
			options.password = mysettings.mqttpassword;
		}
		if ( typeof mysettings.tls_rejectUnauthorized !== 'undefined') {
			options.rejectUnauthorized = mysettings.tls_rejectUnauthorized;
		}
		if ( mysettings.tls_cafile ) {
			try {
				options.ca = fs.readFileSync('config/'+mysettings.tls_cafile);	
			} catch (err) {
				roon_svc_status.set_status("Unable to open CA File (" + err + ")", true);
				return null;
			}
		}		

		if ( debug ) { console.log( '*** trying mqtt connect to %s with options=%s', protocol + mysettings.mqttbroker, JSON.stringify(options)); }
		mqtt_client = mqtt.connect(protocol + mysettings.mqttbroker, options);

		mqtt_client.on('error', function(err) {
	        roon_svc_status.set_status("MQTT Broker Offline (" + err + ")", true);
		});
		
		mqtt_client.on('connect', () => {
			mqtt_client.publish('roon/online','true',{retain: true});
			mqtt_client.subscribe('roon/+/command');
			//mqtt_client.subscribe('roon/browse');
			mqtt_client.subscribe('roon/+/browse/+');
			mqtt_client.subscribe('roon/+/outputs/+/volume/set');
			roon_svc_status.set_status("MQTT Broker Connected", false);
		});

		mqtt_client.on('offline', () => {
			roon_svc_status.set_status("MQTT Broker Offline", true);
		});

		mqtt_client.on('message', function (topic, message ) {
			if ( debug ) { console.log( 'received mqtt packet: topic=%s, message=%s', topic, message); }
			var topic_split = topic.split("/");
			if ( typeof roon_core !== 'undefined' && topic_split[0] === "roon" ) {
				if ( debug ) { console.log('*** we know of zones: %s', Object.keys(roon_zones) );}
				if ( typeof roon_zones[topic_split[1]] === "undefined" ) {
					console.log('*** zone %s not found!', topic_split[1] );
				} else if ( topic_split[2] === 'command' && topic_split.length == 3) {	
					// Control entire zone
					if ( debug ) { console.log('*** sending command %s to zone with id=%s', message, roon_zones[topic_split[1]]["zone_id"] );}
					roon_core.services.RoonApiTransport.control(roon_zones[topic_split[1]]["zone_id"], message.toString());
				} else if ( topic_split[2] === 'command'  && topic_split.length == 4) {				
					// Control single output in zone
					var outputid = roonzone_find_outputid_by_name(topic_split[1],topic_split[3]);
					if ( outputid == null ) {
						console.log('*** output %s not found in zone %s!', topic_split[3], topic_split[1] );
					} else {
						if ( debug ) { console.log('*** sending command %s to output with id=%s in zone=%s', message, outputid, topic_split[1] );}
						roon_core.services.RoonApiTransport.control(outputid, message.toString());					
					}
				} else if (topic_split[2] === 'outputs' && topic_split[4] === 'volume' && topic_split[5] === 'set') {
					if ( debug ) { console.log('*** find output id for zone=%s, output=%s', topic_split[1], topic_split[3]) ;}
					var outputid = roonzone_find_outputid_by_name(topic_split[1],topic_split[3]);
					if ( outputid == null ) {
						console.log('*** output %s not found in zone %s!', topic_split[3], topic_split[1] );
					} else {
						roon_core.services.RoonApiTransport.change_volume(outputid, "absolute", parseInt(message));
					}
				} else if ( topic_split[2] === 'browse' && topic_split.length == 4) {
					let zoneId = roon_zones[topic_split[1]]["zone_id"];
					let hierarchy =  topic_split[3].toString().toLowerCase();
					let action = {};
					try {
						action = JSON.parse(message.toString().toLowerCase());
					} catch (e) {
						console.log('*** no valid JSON in message. Assume only title is passed. message: %s', message.toString() );
						action.title = message.toString().toLowerCase();
					}
					if ( action.title ) { browse_item( zoneId, hierarchy, action ); }
				}
		}
		});
	} catch (err) {
		if ( debug ) { console.log('*** Error connecting: %s', err);}
		roon_svc_status.set_status("MQTT Broker Offline (error)", true);
	}

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
		type:    "label",
		title:   "MQTT Broker settings",
    });

	l.layout.push({
		type:    "dropdown",
		title:   "Protocol",
		values:  [
	        	{ title: "mqtt", value: 'mqtt://' },
        		{ title: "mqtts",   value: 'mqtts://'  }
       		],
		setting: "mqttprotocol",
    });

    l.layout.push({
		type:    "string",
		title:   "Broker Host/IP",
		setting: "mqttbroker",
    });

	l.layout.push({
		type:    "integer",
		title:   "Broker TCP Port",
		setting: "mqttport",
    });

	l.layout.push({
		type:    "label",
		title:   "Authentication (optional)",
    });


    l.layout.push({
		type:    "string",
		title:   "Username",
		setting: "mqttusername",
    });

    l.layout.push({
		type:    "string",
		title:   "Password",
		setting: "mqttpassword",
    });

	l.layout.push({
		type:    "label",
		title:   "TLS options (optional)",
    });

	l.layout.push({
		type:    "dropdown",
		title:   "Validate Certificate Chain ",
		setting: "tls_rejectUnauthorized",
        values:  [
            { title: "No (allow self-signed)", value: false },
            { title: "Yes (more secure)",   value: true  }
        ],
    });
	l.layout.push({
		type:    "string",
		title:   "CA Certificate File",
		description: "test",
		setting: "tls_cafile",
    });


	l.layout.push({
		type:    "label",
		title:   "Logging",
    });

	l.layout.push({
        type:    "dropdown",
        title:   "Debug output",
        values:  [
            { title: "Disable", value: false },
            { title: "Enable",   value: true  }
        ],
        setting: "debug"
    });



   return l;
}
 
function browse_item(zoneid, hierarchy, action) {
	if ( action && hierarchy ) {
		opts = { hierarchy: hierarchy, pop_all: true, action: action };
		roon_core.services.RoonApiBrowse.browse(opts, (err,r) => load_item_cb(err, r, opts, function(item_key) {
			if ( item_key ) {
				opts = { 
					hierarchy: hierarchy, 
					item_key: item_key,
					zone_or_output_id: zoneid,					
				};
				roon_core.services.RoonApiBrowse.browse(opts, (err, r) => {
					if ( debug ) { 
						console.log('*** RoonApiBrowse.browse control result: err=%s', JSON.stringify(err) );
						console.log('*** RoonApiBrowse.browse control result: r=%s', JSON.stringify(r) );
					}	
				});
			} else if ( debug ) { console.log('*** Requested title: "%s" not found in hierarchy "%s".', action.title, hierarchy );}
		}));
	} else if ( debug ) { console.log('*** Incomplete browse request. hierarchy=%s, action=%s', hierarchy, JSON.stringify(action) );}
}

function load_item_cb( err, r, opts, cb, offset) {
	var querySize = 100;
	if ( !offset ) offset = 0;

	if ( debug ) { 
		console.log('*** RoonApiBrowse.browse result: err=%s', JSON.stringify(err) );
		console.log('*** RoonApiBrowse.browse result: r=%s', JSON.stringify(r) );
	}
	opts.count = querySize;
	opts.offset = offset;
	
	roon_core.services.RoonApiBrowse.load(opts, (err, r) => { 
		if ( debug ) { 
			console.log('*** RoonApiBrowse.load result: err=%s', JSON.stringify(err) );
			console.log('*** RoonApiBrowse.load result: r=%s', JSON.stringify(r) );
		}
		if ( !err ) {
			var foundItem;
			var actionListItem;
			for ( var i in r.items ) {
				var item = r.items[i]
				if ( debug ) { console.log('*** Checking item for requested action=%s item=%s', JSON.stringify(opts.action), JSON.stringify(item) );}
				if ( !opts.action.title && item.hint === 'action' ) {
					// If no action.title is available, play first actionable item
					foundItem = item;
					break;
				}
				else if ( item.title.toLowerCase() === opts.action.title ) {
					foundItem = item;
					break;
				} else {
					if ( !actionListItem && item.hint === 'action_list') {
						actionListItem = item;
					}
				}
			}
			if ( !foundItem && r.items.length == querySize ) {
				load_item_cb( err, r, opts, cb, offset+querySize);
			} else if ( foundItem && foundItem.hint === 'list' ) {
				opts = { 
					hierarchy: opts.hierarchy,
					item_key: foundItem.item_key, 
					action: { 
						title: opts.action.album,
						action: opts.action.action
					}
				};				
				roon_core.services.RoonApiBrowse.browse(opts, (err,r) => load_item_cb(err, r, opts, cb));
			} else if ( !foundItem && actionListItem ) {
				opts = { 
					hierarchy: opts.hierarchy,
					item_key: actionListItem.item_key, 
					action: { 
						title: opts.action.action
					}
				};				
				roon_core.services.RoonApiBrowse.browse(opts, (err,r) => load_item_cb(err, r, opts, cb));
			} else {
				var item_key;
				if ( foundItem ) { item_key = foundItem.item_key; }
				cb && cb(item_key);
			}
		}
	});
}

var roon = new RoonApi({
	extension_id:        'nl.fjgalesloot.mqtt',
	display_name:        "MQTT Extension",
	display_version:     "2.0.0b",
	publisher:           'Floris Jan Galesloot',
	email:               'fjgalesloot@triplew.nl',
	website:             'https://github.com/fjgalesloot/roon-extension-mqtt',

	core_paired: function(core_) {
		roon_core = core_;
		let transport = core_.services.RoonApiTransport;
		transport.subscribe_zones(function(cmd, data) {
			if ( debug ) { console.log('*** we know of zones: %s', Object.keys(roon_zones) );}
			if ( typeof data !== "undefined" ) {
				for ( var zoneevent in data ) {
					if ( debug ) { console.log('*** zoneevent=%s', zoneevent); }
					if ( zoneevent =='zones_removed' ) {
						for ( var zoneindex in data[zoneevent] ) {							
							var zoneid=data[zoneevent][zoneindex];
							zonename = roonzone_find_by_id(zoneid);
							if ( debug ) { console.log('*** removed zone with id %s and name %s', zoneid, zonename); }
							mqtt_publish_JSON( 'roon/'+zonename, mqtt_client, { 'state' : 'removed' });
							delete roon_zones[zonename];
						}
					} else {
						var zones=data[zoneevent];
						for( var index in zones ) {
							var zonedata = roonzone_json_changeoutputs(zones[index]);
							var zonename = zonedata.display_name || roonzone_find_by_id(zonedata.zone_id);
							//var regex = '';
							if ( zonename ) {
								zonename = zonename.replace(/ \+.*/,'');
								if ( zoneevent !='zones_seek_changed' ) {
									// zones_seek_changed only passes seek/queue position. Do not refresh zone cache
									roon_zones[zonename] = JSON.parse(JSON.stringify(zonedata));
								} else {
									roon_zones[zonename].queue_time_remaining = zonedata.queue_time_remaining;
									roon_zones[zonename].seek_position = zonedata.seek_position;
								}
								if ( debug ) { console.log('*** publising(if needed) to zone %s: %s', zonename, JSON.stringify(zonedata)); }
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

var saveDefaultSetting = false;
var mysettings = roon.load_config("settings");
if ( !mysettings ) {
	mysettings = {
		mqttbroker: "localhost",
		mqttprotocol: "mqtt://",
		mqttport: 1883,
		debug: false,
		tls_rejectUnauthorized: false
	}
	saveDefaultSetting = true;
};

if ( typeof mysettings.debug !== 'undefined' ) {
	debug = mysettings.debug ;
} else {
	// Set debug to false when setting is
	mysettings.debug = false;
	saveDefaultSetting = true;
}
if ( typeof mysettings.mqttport === 'undefined' ) {
	mysettings.mqttport = 1883;
	saveDefaultSetting = true;
}
if ( typeof mysettings.tls_rejectUnauthorized === 'undefined' ) {
	mysettings.tls_rejectUnauthorized = false;
	saveDefaultSetting = true;
}

if ( saveDefaultSetting ) { roon.save_config("settings", mysettings); }
if ( debug ) { console.log('*** starting with Settings=%s', JSON.stringify(mysettings)); }
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
		if ( typeof mysettings.debug !== 'undefined' ) {
			debug = mysettings.debug ;
		}
		if ( debug ) { console.log('*** new setting, reconnecting mqtt client. Settings=%s', JSON.stringify(mysettings)); }
        mqtt_get_client();
    }
});

roon.init_services({
	required_services: [ RoonApiTransport, RoonApiBrowse ],
	provided_services: [ roon_svc_settings, roon_svc_status ]
});

mqtt_get_client();
roon.start_discovery();

