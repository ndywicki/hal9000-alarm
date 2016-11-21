'use strict';

/*!
 * Hal9000 alarm module
 * Copyright(c) 2016 Nicolas Dyiwkci <nicolas.dywicki@gmail.com>
 * GNU LESSER GENERAL PUBLIC LICENSE
 * Version 3, 29 June 2007
 */

/**
 * Module dependencies
 */

const fs = require('fs');
const join = require('path').join;
const mqtt = require('mqtt');
const five = require("johnny-five");
const Sms = require('sms-freemobile-api');
const process = require('process');

//instantiate sms
const sms = new Sms({
	user: process.env.SMS_USER,
	pass: process.env.SMS_PWD
});
//instantiate johnny-five
const board = new five.Board({
	repl: false
});

//instantiate mongoose
const models = join(__dirname, 'models');
const mongoose = require('mongoose');
// Bootstrap models
fs.readdirSync(models)
  .filter(file => ~file.indexOf('.js'))
  .forEach(file => require(join(models, file)));

//Mongo URL server
const MONGO_URL = process.env.MONGO_URL || 'mongodb://192.168.1.45/hal9000';
// Mongo connection
mongoose.connect(MONGO_URL);

const Alarm = mongoose.model('Alarm');

//private variables
const AlarmStatusEnum = Object.freeze({
	'off': 'off',
	'armed': 'armed',
	'siren': 'siren',
});
const AlarmModeEnum = Object.freeze({
	'perimetric': 'perimetric',
	'full': 'full'
});
const SensorTypeEnum = Object.freeze({
	'sensorMotion': 'sensorMotion',
	'sensorMagnet': 'sensorMagnet'
});

const sensors = [
	{pin: 0, id: 'GPA01', type: SensorTypeEnum.sensorMotion, label: 'Hall d\'entrée'},
	{pin: 1, id: 'GPA02', type: SensorTypeEnum.sensorMotion, label: 'Salon'},
	{pin: 2, id: 'GPA03', type: SensorTypeEnum.sensorMotion, label: 'Chambre'},
	{pin: 3, id: 'GPA04', type: SensorTypeEnum.sensorMagnet, label: 'Porte d\'entrée'},
	{pin: 4, id: 'GPA05', type: SensorTypeEnum.sensorMagnet, label: 'Porte de garage'}
];

//Init alarm status
var alarmMode = AlarmModeEnum.full;
var alarmStatus = AlarmStatusEnum.off;
var alarmTempo = 0;

Alarm.count({}, function(err, count) {
    if(count === 0) {
        //Init alarm configuration
        console.log("First alarm initialisation");
        var alarm = Alarm.updateAlarm(alarmStatus, alarmMode, alarmTempo);
    } else {
    	//Init alarm status
    	console.log("Load alarm status on database");
		Alarm.findOne({}, function (err, alarm) {
		    if (err) {
		        console.log('findOneAndUpdate err:' + err);
		    }
		    alarmMode = alarm.mode;
		    alarmStatus = alarm.status;
		    alarmTempo = alarm.tempo;
		    console.log("Alarm status:"+alarmStatus+" mode:"+alarmMode+" tempo:"+alarmTempo);
		});
    }
});


//MQTT connection
var client = mqtt.connect('mqtt://'+SERVER_IP);
client.on('connect', function() {
	client.subscribe('alarm/commands');
	console.log("MQTT connected");
});
// MQTT topics
var sensorTopic = 'alarm/sensors/';
var eventsTopic = 'alarm/events';

var led;
var alarmTimeout;
var sensorHit = function(pin) {
	return function() {
		var sensor = sensors[pin];
		sensor['value'] = 1;
		console.log("sensor hit=" + sensor.id + " " + sensor.label);
		var topic = sensorTopic + sensor.id;
		client.publish(topic, JSON.stringify(sensor));
		client.publish(eventsTopic, 'Capteur '+ sensor.label+' hit');

		console.log("alarm status:"+alarmStatus+" mode:"+alarmMode+" tempo:"+alarmTempo);
		if(alarmStatus === AlarmStatusEnum.armed) {
			if(alarmMode === AlarmModeEnum.perimetric
				&& sensor.type !== SensorTypeEnum.sensorMagnet) {
				console.log('alarm armed on perimetric mode, no action');
				return;
			}
			console.log('!!Siren on!!');
			//siren on
			alarmTimeout = setTimeout(function() {
				alarmStatus = AlarmStatusEnum.siren;
				led.on();
				Alarm.updateAlarm(alarmStatus, alarmMode, alarmTempo);
				client.publish(eventsTopic, '!!Siren on!!');
				sms.sent('Alarm%20intrusion!');
			}, alarmTempo*1000);
		}
	}
};
var sensorOff = function(pin) {
	return function() {
		//clearTimeout(alarmTimeout);
		var sensor = sensors[pin];
		sensor['value'] = 0;
		console.log("sensor off=" + sensor.id + " " + sensor.label);
		var topic = sensorTopic + sensor.id;
		client.publish(topic, JSON.stringify(sensor));
	}
};


//Main function
board.on("ready", function() {

	//MQTT incoming command
	client.on('message', function(topic, message) {
		console.log('mqtt received topic:'+topic + ' message:'+ message);
		let command;
		try {
 			command = JSON.parse(message);
		} catch (exception) {
			command = null;
		}
		console.log('Input command:'+command);
		if (command) {
			console.log('command:['+JSON.stringify(command)+']');
			if (Number.isInteger(command.tempo)) {
				console.log('tempo:'+command.tempo);
				alarmTempo = command.tempo;
				client.publish(eventsTopic, 'Commande temporisation '+alarmTempo+' sec');
			}
			if(AlarmModeEnum[command.mode]) {
				console.log('mode:'+command.mode);
				alarmMode = command.mode
				client.publish(eventsTopic, 'Commande mode ' + alarmMode);
			}
			if(AlarmStatusEnum[command.status]) {
				console.log('alarm:'+command.status);
				alarmStatus = command.status
				client.publish(eventsTopic, 'Commande alarme ' + alarmStatus);
				if(alarmStatus === AlarmStatusEnum.off) {
					//shutdown siren
					led.off();
				}
			}

			console.log("New alarm status:"+alarmStatus+" mode:"+alarmMode+" tempo:"+alarmTempo);
			Alarm.updateAlarm(alarmStatus, alarmMode, alarmTempo);
		}
	});

	var expander = new five.Expander("MCP23017")
	var virtual = new five.Board.Virtual(expander);

	led = new five.Led({
		board: virtual,
		pin: 8,
	});

	//init input sensors
	sensors.forEach(function(sensor, index, array) {
		console.log("sensor[" + index + "] = " + sensor.id);
		//Enable pull-up resistor for the pin
		expander.pullUp(sensor.pin, this.io.HIGH);
	}, this);
	//Create input buttons and attach the events functions
	for (let pin = 0; pin < sensors.length; pin++) {
		let input = new five.Button({
			pin: pin,
			board: virtual
		});

		input.on("press", (sensorHit)(pin));
		input.on("release", (sensorOff)(pin));
	}
});
