var express = require('express');
var debug = require('debug')('facebook');
var fb = require('fb');
var moment = require('moment');
var request = require('request');
var Parse = require('parse/node').Parse;

var g_API_key = ['AIzaSyD4C_0grHO3gWxgCLGbndJy_ejDXbKNDXk', ];
var g_API_key_offset = 0;


Parse.initialize('selZeqRUEyS0xb2UAAot2AI2pT8a2F7ggqAbyByw', 'xzy1tbgOSU6NNefFJ26RbRacuYyh0E99ikRpmvjO');
var InsightUserClass = Parse.Object.extend('InsightUser');
var InsightCheckinClass = Parse.Object.extend('InsightCheckin');

var hat = require('hat');
var request = require('request');

var FACEBOOK_APP_ID = '674671289335201';
var FACEBOOK_APP_SECRET = 'a7e1c3c097560ba5ae65015405a1f19e';

var THRESHOLD = 10;

var router = express.Router();

// utility
var toRadians = function(angle) {
  return angle * (Math.PI / 180);
};

// calculates true relative heading
var haversineAngle = function(latitude1, longitude1, latitude2, longitude2) {
  var y = Math.sin(toRadians(longitude2 - longitude1)) * Math.cos(toRadians(latitude2));
  var x = Math.cos(toRadians(latitude1)) * Math.sin(toRadians(latitude2)) - Math.sin(toRadians(latitude1)) * Math.cos(toRadians(latitude2)) * Math.cos(toRadians(longitude2 - longitude1));
  var brng = Math.atan2(y, x);
  brng = brng * 180 / Math.PI;

  // normalize bearing to give true heading between 0-360
  // this calculation is moved to inline in order to preserve
  // data important for parallax
  // brng = (brng < 0) ? brng + 360 : brng;

  // return a rounded version
  return Math.round(brng);
};

// calculates true relative distance
var haversineDistance = function(latitude1, longitude1, latitude2, longitude2) {
  var R = 6371000; // the earth's radius in metres
  // azimuth/attitude angles
  // toRadians(latitude1)
  // toRadians(latitude2)
  // toRadians(latitude2 - latitude1)
  // toRadians(longitude2 - longitude1)
  var a = Math.sin(toRadians(latitude2 - latitude1) / 2) * Math.sin(toRadians(latitude2 - latitude1) / 2) +
    Math.cos(toRadians(latitude1)) * Math.cos(toRadians(latitude2)) *
    Math.sin(toRadians(longitude2 - longitude1) / 2) * Math.sin(toRadians(longitude2 - longitude1) / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R * c);
};

/*
 * Sorting utility for arrays of objects
 * Takes an array of objects and a key, and sorts based on the key cast to a number
 */
var sortByKey = function(array, key) {
  return array.sort(function(a, b) {
    var x = Number(a[key]);
    var y = Number(b[key]);
    return ((x < y) ? -1 : ((x > y) ? 1 : 0));
  });
};

/*
 * "Inverts" arrays of locations
 * Converts an array of locations to an object with keys of rounded headings mapping to
 * arrays of locations sorted by distance in increasing order
 */
var invertHeadingsFromArray = function(array) {
  var obj = {},
    singHeading;
  array.forEach(function(element) {
    singHeading = Number(element['heading']);
    // instantiate new array if the key isn't already contained
    if (obj.hasOwnProperty(singHeading)) {
      obj[singHeading].push(element);
    } else {
      obj[singHeading] = [];
      obj[singHeading].push(element);
    }
  });
  // sort each corresponding heading array in the object
  for (var heading in obj) {
    sortByKey(obj[heading], 'distance');
  }
  return obj;
};

var levenshteinDistance = function(a, b) {
  if (a.length == 0) return b.length;
  if (b.length == 0) return a.length;

  var matrix = [];

  // increment along the first column of each row
  var i;
  for (i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  // increment each column in the first row
  var j;
  for (j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (i = 1; i <= b.length; i++) {
    for (j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) == a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, // substitution
          Math.min(matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1)); // deletion
      }
    }
  }

  return matrix[b.length][a.length];
};

router.post('/fb_checkin', function(req, res) {
  var FB = require('fb');
  FB.setAccessToken(req.body.authToken);
  var deprecatedFQLQuery = 'SELECT page_id,name,latitude,longitude FROM place WHERE distance(latitude, longitude, ' + req.body.latitude + ', ' + req.body.longitude + ') < 50';
  // generate app access token for search through Pages on the Graph API
  request('https://graph.facebook.com/oauth/access_token?client_id=' + FACEBOOK_APP_ID + '&client_secret=' + FACEBOOK_APP_SECRET + '&grant_type=client_credentials', function(e, r, b) {
    var app_access_token = b.split('=')[1];
    // use generated token
    FB.setAccessToken(app_access_token);
    // run a Pages query search by name and proximity to location (radius based)
    FB.api('v2.1/search', {
      q: req.body.name,
      type: 'page',
      center: req.body.latitude + ',' + req.body.longitude,
      distance: 2000
    }, function(response) {
      if (!response || response.error) {
        console.log(!response ? 'error occurred' : response.error);
        res.send(response.error);
      } else {
        // check to see the place even exists
        if (response.data && response.data.length > 0) {
          // use the first place returned
          var place_details = response.data[0];

          // response.data.sort(function (a, b) {
          //   return (levenshteinDistance(a.name, req.body.name) -
          //     levenshteinDistance(b.name, req.body.name));
          //   // console.log(a,b);
          //   // console.log(levenshteinDistance(a.name, b.name));
          //   // console.log(levenshteinDistance(a.name, req.body.name));
          //   // return levenshteinDistance(a.name, b.name);
          // });
          // console.log(response.data);
          // // console.log(response.data);
          // // if (querylength - firstLength > querylength - secondLength) {
          // //   place_details = response.data[1];
          // // } else {
          // //   place_details = response.data[0];
          // // }
          // place_details = response.data[0];

          var place_id = place_details.id;
          // revert back to client access token for proper scope permissions
          FB.setAccessToken(req.body.authToken);
          // POST a new check in that's private on the timeline
          FB.api('me/feed', 'post', {
            body: 'I just checked in at ' + place_details.name,
            place: place_id,
            privacy: {
              value: 'SELF'
            }
          }, function(checkinResponse) {
            // log out the genereated post ID for reference
            console.log('Facebook check in succesful.')
            console.log(checkinResponse);

            // add check-in data to parse
            var facebookUserId = req.facebookUserId;

            var query = new Parse.Query(InsightUserClass);
            query.equalTo('facebookUserId', req.facebookUserId);
            query.first({
              success: function(currentInsightUser) {
                console.log('Adding in a new check-in location in Parse...');
                var checkins = currentInsightUser.get('checkins');
                console.log(checkins);
                var new_checkins = [];
                var contains_place = false;
                for (var i = 0; i < checkins.length; i++) {
                  if (checkins[i].facebookPlaceId == place_id) {
                    // replace checkins to same location
                    new_checkins.push({
                      position: {
                        latitude: req.body.latitude,
                        longitude: req.body.longitude
                      },
                      name: req.body.name,
                      facebookPlaceId: place_id,
                      timestamp: new moment().unix()
                    });
                    contains_place = true;
                  } else {
                    // keep older checkins
                    new_checkins.push(checkins[i]);
                  }
                }
                if (!contains_place) {
                  new_checkins.push({
                    position: {
                      latitude: req.body.latitude,
                      longitude: req.body.longitude
                    },
                    name: req.body.name,
                    facebookPlaceId: place_id,
                    timestamp: new moment().unix()
                  });
                }
                currentInsightUser.set('checkins', new_checkins);
                currentInsightUser.save(null, {
                  success: function(savedUser) {
                    var newQuuery = new Parse.Query(InsightCheckinClass);
                    query.equalTo('facebookPlaceId', place_id);
                    query.first({
                      success: function(checkinObject) {
                        if (checkinObject) {
                          // object exists => add user to object
                          checkinObject.addUnique('people', place_id);
                          checkinObject.save(null, {
                            success: function(savedCheckin) {
                              console.log('Added check-in for user!');
                              // completed backend bookkeeping and updated the values
                              res.status(200).send(checkinResponse);
                            },
                            error: function(obj, err) {
                              console.log(err);
                              res.send(err);
                            }
                          });
                        } else {
                          // create new object with user added
                          var InsightCheckin = new InsightCheckinClass();
                          InsightCheckin.save({
                            facebookPlaceId: place_id,
                            position: {
                              latitude: req.body.latitude,
                              longitude: req.body.longitude
                            },
                            name: req.body.name,
                            people: [place_id]
                          }, {
                            success: function(savedCheckin) {
                              console.log('Added check-in for user!');
                              // completed backend bookkeeping and updated the values
                              res.status(200).send(checkinResponse);
                            },
                            error: function(obj, err) {
                              console.log(err);
                              res.send(err);
                            }
                          });
                        }
                      },
                      error: function(obj, err) {
                        console.log(err);
                        res.send(err);
                      }
                    });
                  },
                  error: function(obj, err) {
                    console.log('Parse error in uploading check in data.');
                    console.log(err);
                  }
                });
              },
              error: function(obj, err) {
                console.log(err);
                res.send(err);
              }
            });
          });
        } else {
          // if no page found, send back error
          res.status(500).send('No location found for those coordinates. Check-in failed.')
        }
      }
    });
  });
});

router.post('/fb_likes', function(req, res) {
  var FB = require('fb');
  FB.setAccessToken(req.body.authToken);
  request('https://graph.facebook.com/oauth/access_token?client_id=' + FACEBOOK_APP_ID + '&client_secret=' + FACEBOOK_APP_SECRET + '&grant_type=client_credentials', function(e, r, b) {
    var app_access_token = b.split('=')[1];
    FB.setAccessToken(app_access_token);
    FB.api('/search', {
      q: req.body.name,
      type: 'page',
      center: req.body.latitude + ',' + req.body.longitude,
      distance: '50'
    }, function(response) {
      if (!response || response.error) {
        console.log(!response ? 'error occurred' : response.error);
        res.send(response.error);
      } else {
        if (response.data && response.data.length > 0) {
          var place_details = response.data[0];
          // match the closest location
          for (var i = 0; i < response.data.length; i++) {

          }
          console.log('Finalised location: ');
          console.log(place_details);
          FB.setAccessToken(req.body.authToken);
          FB.api('/' + place_details.id + '?fields=id,name,likes', function(likesResponse) {
            // console.log(likesResponse.data[0].values);
            console.log(likesResponse);
            res.status(200).send(likesResponse);
          });
        } else {
          res.status(500).send('No location found for those coordinates. Check-in failed.');
        }
      }
    });
  });
});

router.post('/list_friends', function(req, res) {
  var FB = require('fb');
  FB.setAccessToken(req.body.authToken);
  FB.api('/me/friends', function(response) {
    console.log(response);
  });
});

router.post('/fb_events', function(req, res) {
  // announce
  console.log('Making FB event request for current latitude ' + Number(req.body.latitude) + ' and longitude ' + Number(req.body.longitude));
  // parse radius
  var radius = req.body.radius || '500';

  var FB = require('fb');
  FB.setAccessToken(req.body.authToken);
  FB.api('me/events', function(events) {
    if (!events || events.error) {
      console.log(!events ? 'error occurred' : events.error);
      res.send(events.error);
    }
    var acceptedEvents = [];
    for (var i = 0; i < events.data.length; i++) {
      var event = events.data[i];
      if (event.place.location && event.place.location.latitude && event.place.location.longitude) {
        // check to see it has geocodable data & build epoch stamp
        var event_time = moment(event.start_time);
        // should be >= current time on the same day
        if (event_time.isAfter() || event_time.isSame(new Date(), 'day')) {
          var bearing = haversineAngle(
            // your location
            Number(req.body.latitude),
            Number(req.body.longitude),
            // location of resulting place
            event.place.location.latitude,
            event.place.location.longitude
          );
          event.heading = (bearing < 0) ? bearing + 360 : bearing;
          event.headingRelative = bearing;
          event.distance = haversineDistance(
            // your location
            Number(req.body.latitude),
            Number(req.body.longitude),
            // location of resulting place
            event.place.location.latitude,
            event.place.location.longitude
          );
          // make sure the event is in radius
          if (event.distance <= Number(radius)) {
            acceptedEvents.push(event);
          }
        }
      }
    }
    // process events before sending
    var responseObj = acceptedEvents;
    // responseObj = invertHeadingsFromArray(acceptedEvents);
    // Sort by distance
    responseObj = sortByKey(responseObj, 'distance');
    res.send(responseObj);
  });
});

module.exports = router;