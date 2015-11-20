var express = require('express');
var debug = require('debug')('geocode');
var fb = require('fb');
var moment = require('moment');
var request = require('request');
var Yelp = require('yelp')['default'];
var Parse = require('parse/node').Parse;
var InsightUserClass = Parse.Object.extend('InsightUser');



var g_API_key = ['AIzaSyD4C_0grHO3gWxgCLGbndJy_ejDXbKNDXk', ];
var g_API_key_offset = 0;

var bing_maps_api_key = "AjP-pU7xn-GBz_RLNnVL6oUckIzfj-q90bdJ69_wLtviEa7ZnBf7PHbPicPYPNr7";

var hat = require('hat');
var request = require('request');

var _YELP_CONSUMER_KEY = 'IVF6e5lDT_NR9jNshDV8uQ';
var _YELP_CONSUMER_SECRET = '3LF8pKRq_f6nFYhlo8TGD_GXLOc';
var _YELP_TOKEN = 'sn83YG9PaagNXwIgaEeCdC06Sx8wq_GK';
var _YELP_TOKEN_SECRET = '4K2GBXITOJryAWrpO9abtp01Zp0';

var yelp = new Yelp({
    consumer_key: _YELP_CONSUMER_KEY,
    consumer_secret: _YELP_CONSUMER_SECRET,
    token: _YELP_TOKEN,
    token_secret: _YELP_TOKEN_SECRET,
});


// Number of results returned from Google Places
var RADIUS_SERVER_DEFAULT = '2000';
var THRESHOLD_SERVER_DEFAULT = 10;


/*
 * Haversine calculation utilities
 */
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

/*  
 * Process the relative values of event objects on a logarithmic scale
 * These include:
 *    - Heights
 *
 */
var processRelativeValues = function(array) {
    console.log('Adding quartiles...');
    // Process relative heights
    var smallestDistance = Number(array[0].distance);
    var largestDistance = Number(array[array.length - 1].distance);

    // normalize values to prevent log(0)
    smallestDistance = (smallestDistance === 0) ? 0.0001 : smallestDistance;
    largestDistance = (largestDistance === 0) ? 0.0001 : largestDistance;

    // Get maximum and minimum rankings
    var lowestRanking = Math.min.apply(Math, array.map(function(elem) {
        var val = elem.hasOwnProperty('yelp') ? (elem.hasOwnProperty('rating') ? elem.yelp.rating : 0) : 0
            // return impossible values for highest and lowest for zero values
        return (val === undefined) ? 100 : val;
    }));
    var highestRanking = Math.max.apply(Math, array.map(function(elem) {
        var val = elem.hasOwnProperty('yelp') ? (elem.hasOwnProperty('rating') ? elem.yelp.rating : 0) : 0
            // return impossible values for highest and lowest for zero values
        return (val === undefined) ? -1 : val;
    }));
    // normalize values to prevent log(0)
    lowestRanking = (lowestRanking === 0) ? 0.0001 : lowestRanking;
    highestRanking = (highestRanking === 0) ? 0.0001 : highestRanking;


    array.forEach(function(element) {
        element.quartiles = {};
        // height quartile calc
        element.quartiles.height = (Math.log(largestDistance) - Math.log(element.distance)) / (
            Math.log(largestDistance) - Math.log(smallestDistance)
        );
        // Fix edge cases: infinite quartiles are pushed to 1
        element.quartiles.height = (element.quartiles.height === Infinity) ? 1 : element.quartiles.height;
        // If only one element, put in the center of the screen.
        element.quartiles.height = (isNaN(element.quartiles.height)) ? 0.5 : element.quartiles.height;
        // ranking quartile calc
        if (element.hasOwnProperty('yelp') && element.yelp.hasOwnProperty('rating')) {
            element.quartiles.ranking = (Math.log(highestRanking) - Math.log(element.yelp.rating)) / (
                Math.log(highestRanking) - Math.log(lowestRanking)
            );
            // Fix edge cases: infinite quartiles are pushed to 1
            element.quartiles.ranking = (element.quartiles.ranking === Infinity) ? 1 : element.quartiles.ranking;
            // If only one element, put in the center of the screen.
            element.quartiles.ranking = (isNaN(element.quartiles.ranking)) ? 0 : element.quartiles.ranking;

        }


    });
    console.log('Finished adding quartiles!');
    return array;
};

var router = express.Router();

router.get('/', function(req, res) {
    res.render('index');
});

router.get('/test', function(req, res) {
    res.render('test');
});

router.post('/insight', function(req, res) {
    var THRESHOLD = req.body.threshold || THRESHOLD_SERVER_DEFAULT;
    // require the google places module inside the route handler to change the config key
    var googleplaces = require('googleplaces')(g_API_key[g_API_key_offset], 'json');
    // announce
    console.log('Making request for latitude ' + Number(req.body.latitude) + ' and longitude ' + Number(req.body.longitude));

    // set radius
    var placeRadius = Number(req.body.radius || RADIUS_SERVER_DEFAULT);


    /* 
     * GOOGLE RADAR SEARCH
     *
     * start a RadarSearch via the Google Places API
     * use default radius as 500m
     * default seach category is 'restaurants'
     */
    var addGoogleRadarSearch = function(existingArray, callback) {
        googleplaces.radarSearch({
            location: [Number(req.body.latitude), Number(req.body.longitude)],
            radius: placeRadius,
            types: req.body.categories || ['restaurant']
        }, function(error, response) {
            if (error) {
                // if there's an error, send back the error
                res.send(error);
            } else {
                /*
                 * Parse API call results, if valid, process/send response
                 */
                var bearing, abs_distance, resultCount = 0;

                var starting_length = existingArray.length;
                var expected_length = starting_length + response.results.length;

                if (response.results.length == 0) {
                    callback(existingArray);
                } else {
                    for (var i = 0; i < response.results.length; i++) {
                        googleplaces.placeDetailsRequest({
                            reference: response.results[i].reference
                        }, function(detailsErr, details) {
                            // call/calculate true heading
                            bearing = haversineAngle(
                                // your location
                                Number(req.body.latitude),
                                Number(req.body.longitude),
                                // location of resulting place
                                details.result.geometry.location.lat,
                                details.result.geometry.location.lng
                            );
                            abs_distance = haversineDistance(
                                // your location
                                Number(req.body.latitude),
                                Number(req.body.longitude),
                                // location of resulting place
                                details.result.geometry.location.lat,
                                details.result.geometry.location.lng
                            );
                            // must have lat/long geometry for insight
                            if (details.result.geometry && abs_distance <= placeRadius) {
                                // resultCount = resultCount + 1;
                                // console.log(resultCount);
                                // push only relevent API response information
                                var new_place_element = {
                                    name: details.result.name,
                                    location: {
                                        latitude: details.result.geometry.location.lat,
                                        longitude: details.result.geometry.location.lng
                                    },
                                    icon: details.result.icon,
                                    place_id: details.result.place_id,
                                    address: details.result.formatted_address,
                                    website: details.result.website,
                                    rating: details.result.rating,
                                    tags: details.result.types,
                                    heading: (bearing < 0) ? bearing + 360 : bearing,
                                    headingRelative: bearing,
                                    distance: abs_distance,
                                    type: 'place',
                                    yelp: {}
                                };
                                var latitude_parameter = String(details.result.geometry.location.lat) + ',' + String(details.result.geometry.location.lng);
                                yelp.search({
                                    term: details.result.name,
                                    ll: latitude_parameter,
                                    sort: 1,
                                    limit: 1,
                                    radius_filter: 50
                                }).then(function(data) {
                                    if (data.businesses.length > 0) {
                                        var yelp_distance_to_result = haversineDistance(details.result.geometry.location.lat,
                                            details.result.geometry.location.lng, data.businesses[0].location.coordinate.latitude,
                                            data.businesses[0].location.coordinate.longitude);
                                        if (yelp_distance_to_result < 100 && details.result.name.indexOf(data.businesses[0].name.split(' ')[0]) > -1) {
                                            var business = data.businesses[0];

                                            new_place_element.yelp.name = business['name'];
                                            new_place_element.yelp.rating = business['rating'];
                                            new_place_element.is_closed = business['is_closed'];
                                            new_place_element.yelp.review_link = business['mobile_url'];

                                            yelp.business(business['id']).then(function(business_data) {
                                                new_place_element.yelp.review_text = business_data['reviews'][0]['excerpt'];
                                                existingArray.push(new_place_element);
                                                if (existingArray.length == expected_length) {
                                                    callback(existingArray);
                                                }
                                            });
                                        } else {
                                            existingArray.push(new_place_element);
                                            if (existingArray.length == expected_length) {
                                                callback(existingArray);
                                            }
                                        }
                                    } else {
                                        existingArray.push(new_place_element);
                                        if (existingArray.length == expected_length) {
                                            callback(existingArray);
                                        }
                                    }
                                });
                            } else {
                                expected_length--;
                            }
                        });
                    }
                }
            }
        });
    };

    var addFacebookEvents = function(existingArray, callback) {
        console.log('Making FB event search request for current latitude ' + Number(req.body.latitude) + ' and longitude ' + Number(req.body.longitude));
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
                        event.type = 'event';
                        // make sure the event is in radius
                        if (event.distance <= Number(radius)) {
                            acceptedEvents.push(event);
                        }
                    }
                }
            }
            var returnArr = existingArray.concat(acceptedEvents);
            console.log('Finished event search with', acceptedEvents.length, 'results!');
            callback(returnArr);
        });
    };

    var addPeopleLocations = function(existingArray, callback) {
        console.log('Getting people locations...');
        var facebookUserId = req.facebookUserId;

        // get friends
        var FB = require('fb');
        FB.setAccessToken(req.body.authToken);
        FB.api('/me/friends', function(response) {
            // array of objects
            var friends = response.data;

            var acceptedEvents = [];

            // expects each of the users to be present
            var expected_length = friends.length;
            console.log('friends:')
            console.log(friends);

            for (var i = 0; i < friends.length; i++) {
                var facebookFriendId = friends[i].id;
                var query = new Parse.Query(InsightUserClass);
                console.log('facebookUserId: ' + facebookFriendId);
                query.equalTo('facebookUserId', facebookFriendId);
                query.first({
                    success: function(user) {
                        if (user) {
                            // user exists in Parse db
                            // position -> location  - latitude, longitude keys
                            // checkins -> three keys: facebook place id, name, and position and timestamp

                            // 1 - check to see whether the user's lastActive timestamp was within X seconds
                            var tolerance = 5 * 60;
                            var checkinTolerance = 7 * 24 * 60 * 60;
                            var current_time = new moment().unix();
                            var lastActive = Number(user.get('lastActive'));
                            var user_location = user.get('position');
                            // Make sure distance of checked-in
                            var user_abs_distance = haversineDistance(
                                // your location
                                Number(req.body.latitude),
                                Number(req.body.longitude),
                                // location of resulting place
                                Number(user_location.latitude),
                                Number(user_location.longitude)
                            );
                            if (user_abs_distance <= placeRadius) {
                                if (current_time - lastActive <= tolerance) {
                                    // within tolerance level for timestamps
                                    var userObject = {};
                                    userObject.name = user.get('facebookUserName');
                                    userObject.location = user_location;
                                    userObject.type = 'people';
                                    userObject.subtype = 'person';

                                    var userBearing = haversineAngle(
                                        // your location
                                        Number(req.body.latitude),
                                        Number(req.body.longitude),
                                        // location of resulting place
                                        Number(user_location.latitude),
                                        Number(user_location.longitude)
                                    );
                                    userObject.headingRelative = userBearing;
                                    userObject.heading = (userBearing < 0) ? userBearing + 360 : userBearing;
                                    userObject.distance = user_abs_distance;

                                    // push the user's current position to the array
                                    console.log('ACCEPTED A USER');
                                    console.log(userObject);
                                    acceptedEvents.push(userObject);
                                }
                            }

                            // 2 - only accept check in objects that have appropriate position object and timestamp
                            var checkins = user.get('checkins');
                            for (var i = 0; i < checkins.length; i++) {
                                var checkinInstance = checkins[i];
                                // Make sure distance of checked-in
                                var checkinObjAbsDistance = haversineDistance(
                                    // your location
                                    Number(req.body.latitude),
                                    Number(req.body.longitude),
                                    // location of resulting place
                                    Number(checkinInstance.position.latitude),
                                    Number(checkinInstance.position.longitude)
                                );
                                if (checkinObjAbsDistance <= placeRadius) {
                                    if (current_time - Number(checkinInstance.timestamp) <= checkinTolerance) {
                                        // accept object - format and add
                                        var checkinPlaceObj = {
                                            name: user.get('facebookUserName'),
                                            location: {
                                                latitude: checkinInstance.position.latitude,
                                                longitude: checkinInstance.position.longitude
                                            },
                                            place_id: user.get('facebookPlaceId'),
                                            type: 'people',
                                            subtype: 'checkin'
                                        };
                                        var checkinInstanceBearing = haversineAngle(
                                            // your location
                                            Number(req.body.latitude),
                                            Number(req.body.longitude),
                                            // location of resulting place
                                            Number(checkinInstance.position.latitude),
                                            Number(checkinInstance.position.longitude)
                                        );
                                        checkinPlaceObj.headingRelative = checkinInstanceBearing;
                                        checkinPlaceObj.heading = (checkinInstanceBearing < 0) ? checkinInstanceBearing + 360 : checkinInstanceBearing;
                                        checkinPlaceObj.distance = checkinObjAbsDistance;

                                        console.log('accepted a user checkin');
                                        console
                                        acceptedEvents.push(checkinPlaceObj);
                                        // increase the expeted count for each checked in object, so that the loop ends
                                        expected_length++;
                                    }
                                }
                                // ignore check-in object, it sucks and does not matter
                                // count does NOT need to be incremented/decremented in this case
                            }

                            if (acceptedEvents.length == expected_length) {
                                // combine the arrays and then return results in the callback
                                var finalArray = existingArray.concat(acceptedEvents);
                                console.log('Successfully found', acceptedEvents.length, 'people!');
                                callback(finalArray);
                            }

                        } else {
                            // ignore, this is a friend who hasn't used the app ever
                            expected_length--;
                            if (acceptedEvents.length == expected_length) {
                                // combine the arrays and then return results in the callback
                                var finalArray = existingArray.concat(acceptedEvents);
                                console.log('Successfully found', acceptedEvents.length, 'people!');
                                callback(finalArray);
                            }
                        }
                    },
                    error: function(err) {
                        console.log('Parse query error!');
                        console.log(err);
                        res.send(err);
                    }
                });
            }
        });
    };
    /* 
     * MASTER REQUEST HANDLER
     *
     * handle the functions/callbacks with requests as necessary
     */
    // for every place reference in the response, gather meta-info
    var placeDetails = [];

    var places_bool = req.body.places === 'true' || req.body.places === true;
    var events_bool = req.body.events === 'true' || req.body.events === true;
    var people_bool = req.body.people === 'true' || req.body.events === true;
    console.log('Places:', places_bool, 'Events:', events_bool, 'People:', people_bool);

    if (places_bool === true && events_bool === false && people_bool === false) {
        addGoogleRadarSearch(placeDetails, function(finalArray) {
            // sort the final array by distance
            sortByKey(finalArray, 'distance');
            // splice the array in half, since we have THRESHOLD * 2 total elements
            // (THRESHOLD) from each
            var splicedArr = finalArray.splice(0, Math.floor(THRESHOLD));
            splicedArr = processRelativeValues(splicedArr);
            res.send(splicedArr);
        });
    } else if (places_bool === false && events_bool === true && people_bool === false) {
        addFacebookEvents(placeDetails, function(finalArray) {
            // sort the final array by distance
            sortByKey(finalArray, 'distance');
            // splice the array in half, since we have THRESHOLD * 2 total elements
            // (THRESHOLD) from each
            var splicedArr = finalArray.splice(0, Math.floor(THRESHOLD));
            splicedArr = processRelativeValues(splicedArr);
            res.send(splicedArr);
        });
    } else if (places_bool === false && events_bool === false && people_bool === true) {
        addPeopleLocations(placeDetails, function(finalArray) {
            // sort the final array by distance
            sortByKey(finalArray, 'distance');
            // splice the array in half, since we have THRESHOLD * 2 total elements
            // (THRESHOLD) from each
            var splicedArr = finalArray.splice(0, Math.floor(THRESHOLD * 2));
            splicedArr = processRelativeValues(splicedArr);
            res.send(splicedArr);
        });
    } else if (places_bool === true && events_bool === false && people_bool === true) {
        addGoogleRadarSearch(placeDetails, function(intermediaryArray) {
            addPeopleLocations(intermediaryArray, function(finalArray) {
                // sort the final array by distance
                sortByKey(finalArray, 'distance');
                // splice the array in half, since we have THRESHOLD * 2 total elements
                // (THRESHOLD) from each
                var splicedArr = finalArray.splice(0, Math.floor(THRESHOLD * 2));
                splicedArr = processRelativeValues(splicedArr);
                res.send(splicedArr);
            });
        });
    } else if (places_bool === true && events_bool === true && people_bool === false) {
        addGoogleRadarSearch(placeDetails, function(intermediaryArray) {
            addFacebookEvents(intermediaryArray, function(finalArray) {
                // sort the final array by distance
                sortByKey(finalArray, 'distance');
                // splice the array in half, since we have THRESHOLD * 2 total elements
                // (THRESHOLD) from each
                var splicedArr = finalArray.splice(0, Math.floor(THRESHOLD * 2));
                splicedArr = processRelativeValues(splicedArr);
                res.send(splicedArr);
            });
        });
    } else if (places_bool === false && events_bool === true && people_bool === true) {
        addFacebookEvents(placeDetails, function(intermediaryArray) {
            addPeopleLocations(intermediaryArray, function(finalArray) {
                // sort the final array by distance
                sortByKey(finalArray, 'distance');
                // splice the array in half, since we have THRESHOLD * 2 total elements
                // (THRESHOLD) from each
                var splicedArr = finalArray.splice(0, Math.floor(THRESHOLD * 2));
                splicedArr = processRelativeValues(splicedArr);
                res.send(splicedArr);
            });
        });
    } else {
        addGoogleRadarSearch(placeDetails, function(intermediaryArray) {
            addFacebookEvents(intermediaryArray, function(intermediaryArrayTheReturn) {
                addPeopleLocations(intermediaryArrayTheReturn, function(finalArray) {
                    // sort the final array by distance
                    sortByKey(finalArray, 'distance');
                    // splice the array in half, since we have THRESHOLD * 2 total elements
                    // (THRESHOLD) from each
                    var splicedArr = finalArray.splice(0, Math.floor(THRESHOLD * 2));
                    splicedArr = processRelativeValues(splicedArr);
                    res.send(splicedArr);
                });
            });
        });
    }
});

router.post('/directions', function(req, res) {
    // CREATE REQUEST URL
    var request_url = "http://dev.virtualearth.net/REST/v1/Routes?wp.0=" +
        // current location parameters for 0th waypoint
        req.body.currentLocationLatitude + "," + req.body.currentLocationLongitude +
        // destination location parameters for destination (wp 1)
        "&wp.1=" + req.body.destinationLatitude + "," + req.body.destinationLongitude +
        "&routePathOutput=Points&output=json&jsonp=RouteCallback&key=" + bing_maps_api_key;

    // SEND REQUEST
    request(request_url, function(error, response, body) {
        if (!error && response.statusCode == 200) {
            // WARNING - UNREADABLE CODE AHEAD
            // because of a truly intriguing bug within the Bing Maps API, 
            // the callback must be handled in this way, must be named RouteCallback,
            // and can't actually be called anyways once returned.
            // do length - 2 to cut out the end parenthesis
            var directionsObj = response.body.substring(15, response.body.length - 1);
            var routeLegs = JSON.parse(directionsObj)['resourceSets'][0]['resources'][0]['routeLegs'][0];
            var responseObj = {
                destinationDescription: routeLegs['description'],
                steps: []
            };
            // Aggregate each step
            routeLegs['itineraryItems'].forEach(function(element) {
                responseObj['steps'].push({
                    text: element['instruction']['text'],
                    distance: element['travelDistance']
                });
            });
            // object struture:
            // base object has two keys: 'description' describes the destination
            // other key is 'steps', which holds an array of objects with:
            // a key for text (describing the instruction)
            // and distance traveled during that step
            res.send(responseObj);
        } else {
            // Send back the error
            res.send(error);
        }
    });
});

module.exports = router;