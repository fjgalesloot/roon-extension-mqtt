const mqtt = require('mqtt');
const fs = require('fs');
var mqttClient, roonCore, roonZones = {};
var debug = false;
var trace = false;
var mqttData = {};

var RoonApi = require("node-roon-api"),
	RoonApiStatus = require("node-roon-api-status"),
	RoonApiTransport = require("node-roon-api-transport"),
	RoonApiSettings = require('node-roon-api-settings'),
	RoonApiBrowse = require('node-roon-api-browse');


function mqttPublishJson(mqttBase, mqttClient, jsonData) {
	if (mqttClient && mqttClient.connected) {
		for (var attribute in jsonData) {
			var attributeTopic = toMqttTopic(attribute);
			if (typeof jsonData[attribute] === 'object') {
				mqttPublishJson(mqttBase + '/' + attributeTopic, mqttClient, jsonData[attribute]);
			} else if (typeof mqttData[mqttBase + '/' + attributeTopic] === 'undefined' || mqttData[mqttBase + '/' + attributeTopic] != jsonData[attribute].toString()) {
				if (trace) { console.log('*** sending MQTT: ' + mqttBase + '/' + attribute + '=' + jsonData[attribute]); }
				mqttData[mqttBase + '/' + attributeTopic] = jsonData[attribute].toString();
				mqttClient.publish(mqttBase + '/' + attributeTopic, jsonData[attribute].toString());
			} else {
				if (trace) { console.log('*** mqtt_publish_JSON nothing to publish to %s', mqttBase); }
			}
		}
	} else {
		if (debug) { console.log('*** mqtt_publish_JSON called but unable to publish. mqtt_client=%s', typeof mqttclient !== 'undefined' ? JSON.stringify(mqttclient) : 'undefined'); }
	}
}

function mqttGetClient() {
	try {
		if (mqttClient) { mqttClient.end(); }
		var protocol = "mqtt://";
		if (mySettings.mqttprotocol) { protocol = mySettings.mqttprotocol; }
		options = {};
		options.clean = true;
		options.clientId = "roon-extension-mqtt-" + (Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 5)); //+= "." + hostname;
		options.servername = mySettings.mqttbroker;
		options.will = { topic: mySettings.mqttroot + '/online', payload: 'false', retain: true };
		if (mySettings.mqttusername && mySettings.mqttpassword) {
			options.username = mySettings.mqttusername;
			options.password = mySettings.mqttpassword;
		}
		if (typeof mySettings.tls_rejectUnauthorized !== 'undefined') {
			options.rejectUnauthorized = mySettings.tls_rejectUnauthorized;
		}
		if (mySettings.tls_cafile) {
			try {
				options.ca = fs.readFileSync('config/' + mySettings.tls_cafile);
			} catch (err) {
				roonSvcStatus.set_status("Unable to open CA File (" + err + ")", true);
				return null;
			}
		}

		if (debug) { console.log('*** trying mqtt connect to %s with options=%s', protocol + mySettings.mqttbroker, JSON.stringify(options)); }
		mqttClient = mqtt.connect(protocol + mySettings.mqttbroker, options);

		mqttClient.on('error', function (err) {
			roonSvcStatus.set_status("MQTT Broker Offline (" + err + ")", true);
		});

		mqttClient.on('connect', () => {
			mqttClient.publish(mySettings.mqttroot + '/online', 'true', { retain: true });
			mqttClient.subscribe(mySettings.mqttroot + '/+/command');
			//mqtt_client.subscribe(mysettings.mqttroot + '/browse');
			mqttClient.subscribe(mySettings.mqttroot + '/+/browse/+');
			mqttClient.subscribe(mySettings.mqttroot + '/+/outputs/+/volume/set');
			mqttClient.subscribe(mySettings.mqttroot + '/+/outputs/add');
			mqttClient.subscribe(mySettings.mqttroot + '/+/outputs/remove');
			roonSvcStatus.set_status("MQTT Broker Connected", false);
		});

		mqttClient.on('offline', () => {
			roonSvcStatus.set_status("MQTT Broker Offline", true);
		});

		mqttClient.on('message', function (topic, message) {
			if (debug) { console.log('received mqtt packet: topic=%s, message=%s', topic, message); }
			let topicSplit = topic.split("/");
			if (typeof roonCore !== 'undefined' && topicSplit[0] === mySettings.mqttroot) {
				if (debug) { console.log('*** we know of zones: %s', Object.keys(roonZones)); }
				let roonZone = roonZoneFindByMqttTopic(topicSplit[1]);
				if (roonZone == null) {
					console.log('*** zone %s not found!', topicSplit[1]);
				} else {
					let zoneName = roonZone["display_name"];
					if (topicSplit[2] === 'command' && topicSplit.length == 3) {
						// Control entire zone
						if (debug) { console.log('*** sending command %s to zone with id=%s', message, roonZone["zone_id"]); }
						roonCore.services.RoonApiTransport.control(roonZone["zone_id"], message.toString());
					} else if (topicSplit[2] === 'command' && topicSplit.length == 4) {
						// Control single output in zone
						let output = roonZoneFindOutputByName(zoneName, topicSplit[3]);
						if (output == null) {
							console.log('*** output %s not found in zone %s!', topicSplit[3], zoneName);
						} else {
							if (debug) { console.log('*** sending command %s to output with id=%s in zone=%s', message, output["output_id"], zoneName); }
							roonCore.services.RoonApiTransport.control(output["output_id"], message.toString());
						}
					} else if (topicSplit[2] === 'outputs' && topicSplit[4] === 'volume' && topicSplit[5] === 'set') {
						if (debug) { console.log('*** find output id for zone=%s, output=%s', zoneName, topicSplit[3]); }
						let output = roonZoneFindOutputByName(zoneName, topicSplit[3]);
						if (output == null) {
							console.log('*** output %s not found in zone %s!', topicSplit[3], zoneName);
						} else if (typeof message === 'undefined' || message == '') {
							console.log('*** no message for volume set command!');
						} else if (message.toString().toLowerCase() == 'mute') {
							roonCore.services.RoonApiTransport.mute(output["output_id"], "mute");
						} else if (message.toString().toLowerCase() == 'unmute') {
							roonCore.services.RoonApiTransport.mute(output["output_id"], "unmute");
						} else if (!isNaN(message)) {
							roonCore.services.RoonApiTransport.change_volume(output["output_id"], "absolute", parseFloat(message.toString()), function () {
								roonCore.services.RoonApiTransport.mute(output["output_id"], "unmute");
							});
						} else if (debug) {
							console.log('*** invalid message for volume/set topic message=%s', message)
						}
					} else if (topicSplit[2] === 'outputs' && topicSplit.length == 4) {
						if (debug) { console.log('*** %s output %s to zone=%s', topicSplit[3], message, zoneName); }
						let output = roonOutputFindByName(message);
						if (output != null) {
							let currentOutputs = [];
							for (var index in roonZone["outputs"]) {
								currentOutputs.push(roonZone["outputs"][index]["output_id"]);
							}
							if (trace) { console.log('*** currentOutputs=%s output["output_id"]=%s', currentOutputs, output["output_id"]); }
							if (topicSplit[3] === 'add') {
								if (!currentOutputs.includes(output["output_id"])) {
									if (roonZone.outputs[Object.keys(roonZone.outputs)[0]].can_group_with_output_ids.includes(output["output_id"])) {
										currentOutputs.push(output["output_id"]);
										roonCore.services.RoonApiTransport.group_outputs(currentOutputs);
									} else if (debug) {
										console.log('*** output %s cannot begrouped in zone %s', message, zoneName);
									}
								} else if (debug) {
									console.log('*** output %s already grouped in zone %s', message, zoneName);
								}
							} else if (topicSplit[3] === 'remove') {
								if (currentOutputs.includes(output["output_id"])) {
									roonCore.services.RoonApiTransport.ungroup_outputs([output["output_id"]]);
								} else if (debug) {
									console.log('*** output %s not found in zone %s', message, zoneName);
								}
							}
						} else if (debug) {
							console.log('*** output %s not found', message);
						}
					} else if (topicSplit[2] === 'browse' && topicSplit.length == 4) {
						let zoneId = roonZone["zone_id"];
						let hierarchy = topicSplit[3].toString().toLowerCase();
						let action = {};
						try {
							action = JSON.parse(message.toString().toLowerCase());
						} catch (e) {
							console.log('*** no valid JSON in message. Assume only title is passed. message: %s', message.toString());
							action.title = message.toString().toLowerCase();
						}
						if (action.title) { browseItem(zoneId, hierarchy, action); }
					} else {
						if (debug) { console.log('*** unkown topic=% message=%s', topic, message,); }
					}
				}
			}
		});
	} catch (err) {
		if (debug) { console.log('*** Error connecting: %s', err); }
		roonSvcStatus.set_status("MQTT Broker Offline (error)", true);
	}

}

function toMqttTopic(input) {
	return input.replace(/[#\+]/g, '-');
}

function zoneToMqttTopic(input) {
	return toMqttTopic(input.replace(/ \+ [0-9]?/, ''));
}

function roonZoneFindByMqttTopic(zonetopic) {
	for (var zonename in roonZones) {
		if (toMqttTopic(zonename.replace(/ \+ [0-9]?/, '')) == toMqttTopic(zonetopic)) {
			return roonZones[zonename];
		}
	}
	return null;
}

function roonZoneFindById(zoneid) {
	for (var zonename in roonZones) {
		if (roonZones[zonename]["zone_id"] === zoneid) {
			return zonename;
		}
	}
	return null;
}

function roonZoneFindOutputByName(zonename, outputname) {
	for (var output in roonZones[zonename]["outputs"]) {
		if (toMqttTopic(roonZones[zonename]["outputs"][output]["display_name"].toLowerCase()) === toMqttTopic(outputname.toString().toLowerCase())) {
			return roonZones[zonename]["outputs"][output];
		}
	}
	return null;
}

function roonOutputFindByName(outputname) {
	for (var zonename in roonZones) {
		for (var output in roonZones[zonename]["outputs"]) {
			if (roonZones[zonename]["outputs"][output]["display_name"].toLowerCase() === outputname.toString().toLowerCase()) {
				return roonZones[zonename]["outputs"][output];
			}
		}
	}
	return null;
}


function roonZoneJsonChangeOutputs(zoneData) {
	var newOutputs = {};
	for (var index in zoneData["outputs"]) {
		newOutputs[zoneData["outputs"][index]["display_name"]] = JSON.parse(JSON.stringify(zoneData["outputs"][index]));
	}
	zoneData["outputs"] = JSON.parse(JSON.stringify(newOutputs));
	return zoneData;
}

function makeLayout(settings) {
	var l = {
		values: settings,
		layout: [],
		has_error: false
	};
	l.layout.push({
		type: "label",
		title: "MQTT Broker settings",
	});
	l.layout.push({
		type: "dropdown",
		title: "Protocol",
		values: [
			{ title: "mqtt", value: 'mqtt://' },
			{ title: "mqtts", value: 'mqtts://' }
		],
		setting: "mqttprotocol",
	});
	l.layout.push({
		type: "string",
		title: "Broker Host/IP",
		setting: "mqttbroker",
	});
	l.layout.push({
		type: "integer",
		title: "Broker TCP Port",
		setting: "mqttport",
	});
	l.layout.push({
		type: "string",
		title: "MQTT Root Topic",
		setting: "mqttroot",
	});
	l.layout.push({
		type: "label",
		title: "Authentication (optional)",
	});
	l.layout.push({
		type: "string",
		title: "Username",
		setting: "mqttusername",
	});
	l.layout.push({
		type: "string",
		title: "Password",
		setting: "mqttpassword",
	});
	l.layout.push({
		type: "label",
		title: "TLS options (optional)",
	});
	l.layout.push({
		type: "dropdown",
		title: "Validate Certificate Chain ",
		setting: "tls_rejectUnauthorized",
		values: [
			{ title: "No (allow self-signed)", value: false },
			{ title: "Yes (more secure)", value: true }
		],
	});
	l.layout.push({
		type: "string",
		title: "CA Certificate File",
		description: "test",
		setting: "tls_cafile",
	});
	l.layout.push({
		type: "label",
		title: "Logging",
	});
	l.layout.push({
		type: "dropdown",
		title: "Debug output",
		values: [
			{ title: "Disable", value: false },
			{ title: "Enable", value: true }
		],
		setting: "debug"
	});
	return l;
}

function browseItem(zoneId, hierarchy, action) {
	if (action && hierarchy) {
		opts = { hierarchy: hierarchy, pop_all: true, action: action };
		roonCore.services.RoonApiBrowse.browse(opts, (err, r) => loadItemCallback(err, r, opts, function (itemKey) {
			if (itemKey) {
				opts = {
					hierarchy: hierarchy,
					item_key: itemKey,
					zone_or_output_id: zoneId,
				};
				roonCore.services.RoonApiBrowse.browse(opts, (err, r) => {
					if (debug) {
						console.log('*** RoonApiBrowse.browse control result: err=%s', JSON.stringify(err));
						console.log('*** RoonApiBrowse.browse control result: r=%s', JSON.stringify(r));
					}
				});
			} else if (debug) { console.log('*** Requested title: "%s" not found in hierarchy "%s".', action.title, hierarchy); }
		}));
	} else if (debug) { console.log('*** Incomplete browse request. hierarchy=%s, action=%s', hierarchy, JSON.stringify(action)); }
}

function loadItemCallback(err, r, opts, cb, offset) {
	var querySize = 100;
	if (!offset) offset = 0;

	if (debug) {
		console.log('*** RoonApiBrowse.browse result: err=%s', JSON.stringify(err));
		console.log('*** RoonApiBrowse.browse result: r=%s', JSON.stringify(r));
	}
	opts.count = querySize;
	opts.offset = offset;

	roonCore.services.RoonApiBrowse.load(opts, (err, r) => {
		if (debug) {
			console.log('*** RoonApiBrowse.load result: err=%s', JSON.stringify(err));
			console.log('*** RoonApiBrowse.load result: r=%s', JSON.stringify(r));
		}
		if (!err) {
			var foundItem;
			var actionListItem;
			for (var i in r.items) {
				var item = r.items[i]
				if (debug) { console.log('*** Checking item for requested action=%s item=%s', JSON.stringify(opts.action), JSON.stringify(item)); }
				if (!opts.action.title && item.hint === 'action') {
					// If no action.title is available, play first actionable item
					foundItem = item;
					break;
				}
				else if (item.title.toLowerCase() === opts.action.title) {
					foundItem = item;
					break;
				} else {
					if (!actionListItem && item.hint === 'action_list') {
						actionListItem = item;
					}
				}
			}
			if (!foundItem && r.items.length == querySize) {
				loadItemCallback(err, r, opts, cb, offset + querySize);
			} else if (foundItem && foundItem.hint === 'list') {
				opts = {
					hierarchy: opts.hierarchy,
					item_key: foundItem.item_key,
					action: {
						title: opts.action.album,
						action: opts.action.action
					}
				};
				roonCore.services.RoonApiBrowse.browse(opts, (err, r) => loadItemCallback(err, r, opts, cb));
			} else if (!foundItem && actionListItem) {
				opts = {
					hierarchy: opts.hierarchy,
					item_key: actionListItem.item_key,
					action: {
						title: opts.action.action
					}
				};
				roonCore.services.RoonApiBrowse.browse(opts, (err, r) => loadItemCallback(err, r, opts, cb));
			} else {
				var itemKey;
				if (foundItem) { itemKey = foundItem.item_key; }
				cb && cb(itemKey);
			}
		}
	});
}

var roon = new RoonApi({
	extension_id: 'nl.fjgalesloot.mqtt',
	display_name: "MQTT Extension",
	display_version: "2.2.0",
	publisher: 'Floris Jan Galesloot',
	email: 'fjgalesloot@triplew.nl',
	website: 'https://github.com/fjgalesloot/roon-extension-mqtt',

	core_paired: function (core_) {
		roonCore = core_;
		let transport = core_.services.RoonApiTransport;
		transport.subscribe_zones(function (cmd, data) {
			if (debug) { console.log('*** we know of zones: %s', Object.keys(roonZones)); }
			if (typeof data !== "undefined") {
				for (var zoneevent in data) {
					if (debug) { console.log('*** zoneevent=%s', zoneevent); }
					if (zoneevent == 'zones_removed') {
						for (var zoneindex in data[zoneevent]) {
							var zoneid = data[zoneevent][zoneindex];
							zonename = roonZoneFindById(zoneid);
							if (debug) { console.log('*** removed zone with id %s and name %s', zoneid, zonename); }
							mqttPublishJson(mySettings.mqttroot + '/' + zoneToMqttTopic(zonename), mqttClient, { 'state': 'removed' });
							delete roonZones[zonename];
						}
					} else {
						var zones = data[zoneevent];
						for (var index in zones) {
							var zonedata = roonZoneJsonChangeOutputs(zones[index]);
							var zonename = zonedata.display_name || roonZoneFindById(zonedata.zone_id);
							//var regex = '';
							if (zonename) {
								if (zoneevent != 'zones_seek_changed') {
									// zones_seek_changed only passes seek/queue position. Do not refresh zone cache
									roonZones[zonename] = JSON.parse(JSON.stringify(zonedata));
								} else {
									roonZones[zonename].queue_time_remaining = zonedata.queue_time_remaining;
									roonZones[zonename].seek_position = zonedata.seek_position;
								}
								if (trace) { console.log('*** publising(if needed) to zone %s: %s', zonename, JSON.stringify(zonedata)); }
								mqttPublishJson(mySettings.mqttroot + '/' + zoneToMqttTopic(zonename), mqttClient, zonedata);
							}
						}
					}
				}
			}
		});
	},

	core_unpaired: function (core_) {
		console.log(core_.core_id,
			core_.display_name,
			core_.display_version,
			"-",
			"LOST");
	}
});

var saveDefaultSetting = false;
var mySettings = roon.load_config("settings");
if (!mySettings) {
	mySettings = {
		mqttbroker: "localhost",
		mqttprotocol: "mqtt://",
		mqttport: 1883,
		mqttroot: 'roon',
		debug: false,
		tls_rejectUnauthorized: false
	}
	saveDefaultSetting = true;
};

if (typeof mySettings.debug !== 'undefined') {
	debug = mySettings.debug;
} else {
	// Set debug to false when setting is
	mySettings.debug = false;
	saveDefaultSetting = true;
}
if (typeof mySettings.mqttport === 'undefined') {
	mySettings.mqttport = 1883;
	saveDefaultSetting = true;
}
if (typeof mySettings.mqttroot === 'undefined') {
	mySettings.mqttroot = 'roon';
	saveDefaultSetting = true;
} else if (mySettings.mqttroot != toMqttTopic(mySettings.mqttroot)) {
	mySettings.mqttroot = toMqttTopic(mySettings.mqttroot);
	saveDefaultSetting = true;
}
if (typeof mySettings.tls_rejectUnauthorized === 'undefined') {
	mySettings.tls_rejectUnauthorized = false;
	saveDefaultSetting = true;
}

if (saveDefaultSetting) { roon.save_config("settings", mySettings); }
if (debug) { console.log('*** starting with Settings=%s', JSON.stringify(mySettings)); }
var roonSvcStatus = new RoonApiStatus(roon);

var roonSvcSettings = new RoonApiSettings(roon, {
	get_settings: function (cb) {
		cb(makeLayout(mySettings));
	},
	save_settings: function (req, isDryRun, settings) {
		let l = makeLayout(settings.values);
		req.send_complete(l.has_error ? "NotValid" : "Success", { settings: l });

		if (!isDryRun && !l.has_error) {
			mySettings = l.values;
			roonSvcSettings.update_settings(l);
			roon.save_config("settings", mySettings);
		}
		if (typeof mySettings.debug !== 'undefined') {
			debug = mySettings.debug;
		}
		if (debug) { console.log('*** new setting, reconnecting mqtt client. Settings=%s', JSON.stringify(mySettings)); }
		mqttGetClient();
	}
});

roon.init_services({
	required_services: [RoonApiTransport, RoonApiBrowse],
	provided_services: [roonSvcSettings, roonSvcStatus]
});

mqttGetClient();
roon.start_discovery();