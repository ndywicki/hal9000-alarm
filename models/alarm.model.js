'use strict';
/**
 * Module dependencies.
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * Alarm Schema
 */

const AlarmSchema = new Schema({
	_id: Number,
	status: {
		type: String,
		enum: ['off', 'armed', 'siren'],
		default: 'off',
		trim: true,
		required: 'Status cannot be blank'
	},
	mode: {
		type: String,
		enum: ['perimetrique', 'full'],
		default: 'full',
		trim: true,
		required: 'Status cannot be blank'
	},
	tempo: {
		type: Number,
		default: '0',
	}
}, { collection: 'alarm.status' });

/**
 * Methods
 */

AlarmSchema.methods = {};

/**
 * Statics
 */

AlarmSchema.statics = {

  /**
   * Update alarm status
   *
   * @param {status} status
   * @param {mode} mode
   * @param {tempo} tempo
   * @api private
   */
	updateAlarm: function (status, mode, tempo) {
		const alarm = { status: status, mode: mode, tempo: tempo};
    	console.log("Save alarm in database:" + JSON.stringify(alarm));
    	this.findOneAndUpdate({}, alarm, {upsert: true}, function (err, alarm) {
	        if (err) {
	            console.log('findOneAndUpdate err:' + err);
	        }
	        return alarm;
    	});
	}
};

mongoose.model('Alarm', AlarmSchema);
