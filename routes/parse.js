var express = require('express');
var debug = require('debug')('facebook');
var moment = require('moment');
var request = require('request');
var hat = require('hat');
var request = require('request');
var Parse = require('parse/node').Parse;

// so insecure...but who cares anyway?
Parse.initialize('selZeqRUEyS0xb2UAAot2AI2pT8a2F7ggqAbyByw', 'xzy1tbgOSU6NNefFJ26RbRacuYyh0E99ikRpmvjO');

var InsightUserClass = Parse.Object.extend('InsightUser');

var router = express.Router();

var FACEBOOK_APP_ID = '674671289335201';
var FACEBOOK_APP_SECRET = 'a7e1c3c097560ba5ae65015405a1f19e';

/* This runs for all POST requests to the server */
router.post('/*', function(req, res, next) {
  // if this is a POST request that contains an authToken, update the Parse object
  if (req.body.environment === 'demo') {
    req.body.latitude = 40.7305476;
    req.body.longitude = -73.9915412;
  }

  if (req.body.authToken) {
    var FB = require('fb');
    FB.setAccessToken(req.body.authToken);
    FB.api('me', function(facebookUserData) {
      // facebookUserData format:
      // name: String, id: String
      var facebookUserId = facebookUserData.id;
      var facebookUserName = facebookUserData.name;
      var lastActive = new moment().unix();

      // first check if the user already exists in the Parse Cloud
      var query = new Parse.Query(InsightUserClass);
      query.equalTo('facebookUserId', facebookUserId);
      // return the first result only (should only be one anyway)
      query.first({
        success: function(user) {
          if (user) {
            user.save({
              lastActive: lastActive,
              position: {
                latitude: req.body.latitude,
                longitude: req.body.longitude
              }
            }, {
              success: function(currentInsightUser) {
                console.log('Updated lastActive timestamp and last location for ' + facebookUserName);
                req.facebookUserId = facebookUserId;
                next();
              },
              error: function(object, err) {
                console.log('Parse save error!');
                console.log(err);
                res.send(err);
              }
            });
          } else {
            // create a new InsightUser object
            InsightUser = new InsightUserClass();
            InsightUser.save({
              facebookUserId: facebookUserId,
              facebookUserName: facebookUserName,
              lastActive: lastActive,
              position: {
                latitude: req.body.latitude,
                longitude: req.body.longitude
              },
              checkins: []
            }, {
              success: function(currentInsightUser) {
                console.log('Created new record and updated lastActive timestamp & last location for ' + facebookUserName);
                req.facebookUserId = facebookUserId;
                next();
              },
              error: function(object, err) {
                console.log('Parse save error!');
                console.log(err);
                res.send(err);
              }
            });
          }
        },
        error: function(err) {
          console.log('Parse query error!');
          console.log(err);
          res.send(err);
        }
      });
    });
  } else {
    next();
  }
});

module.exports = router;