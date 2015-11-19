var express = require('express');
var debug = require('debug')('geocode');
var fb = require('fb');
var moment = require('moment');
var request = require('request');

var g_API_key = ['AIzaSyD4C_0grHO3gWxgCLGbndJy_ejDXbKNDXk', ];
var g_API_key_offset = 0;

var bing_maps_api_key = "AjP-pU7xn-GBz_RLNnVL6oUckIzfj-q90bdJ69_wLtviEa7ZnBf7PHbPicPYPNr7";

var hat = require('hat');
var request = require('request');

var YALE_API_BASE_URL = 'https://gw.its.yale.edu';

var YALE_API_KEY = 'l7xx9ebbe4eb200e44679ab221819d1c2b3f';
// TEST URL: https://gw.its.yale.edu/soa-gateway/buildings/feed?type=json?apikey=l7xxd6809c22c97b4f96bb8361a201f71fb3
var FACEBOOK_APP_ID = '674671289335201';
var FACEBOOK_APP_SECRET = 'a7e1c3c097560ba5ae65015405a1f19e';

// Number of results returned from Google Places
var THRESHOLD = 10;

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
 * Gets Yale building data, for YHack demo
 */
var getYaleBuildings = function(callback) {
    var requestUrl = 'https://gw.its.yale.edu/soa-gateway/buildings/feed?type=json&apikey=' + YALE_API_KEY;
    request(requestUrl, function(error, response, body) {
        if (!error && response.statusCode == 200) {
            // JSON of building data is in 'body'
            // contains a lot of information, the keys of which can be standardised based on app needs
            callback(JSON.parse(body)['ServiceResponse']['Buildings']['Building']);
        } else {
            // return empty array so that the rest of the data is unspoiled
            callback([]);
        }
    });
};

var router = express.Router();

router.get('/', function(req, res) {
    res.render('index');
});

router.get('/test', function (req, res) {
    res.render('test');
});

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
                // check to see the place even exists
                if (response.data && response.data.length > 0) {
                    // use the first place returned
                    var place_details = response.data[0];
                    console.log(place_details);
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
                        console.log(checkinResponse);
                        // send back data to the phone, just because I have no use for it and we might as well keep it somewhere
                        res.status(200).send(checkinResponse);
                    });
                } else {
                    // if no page found, send back error
                    res.status(500).send('No location found for those coordinates. Check-in failed.')
                }
            }
        });
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

router.post('/insight', function(req, res) {
    // require the google places module inside the route handler to change the config key
    var googleplaces = require('googleplaces')(g_API_key[g_API_key_offset], 'json');
    // announce
    console.log('Making request for latitude ' + Number(req.body.latitude) + ' and longitude ' + Number(req.body.longitude));

    // set radius
    var placeRadius = Number(req.body.radius || '500');

    /*
     * YALE BUILDINGS
     */
    // add in yale building data - should currently fail and return original data without API key
    var addYaleBuildings = function(existingArray, callback) {
        getYaleBuildings(function(buildingArray) {
            var yaleBDistance, i = 0,
                element, numResults = 0;
            for (i = 0;
                (i < buildingArray.length) && (numResults <= THRESHOLD); i++) {
                element = buildingArray[i];
                // call/calculate true heading
                bearing = haversineAngle(
                    // your location
                    Number(req.body.latitude),
                    Number(req.body.longitude),
                    // location of resulting place
                    Number(element['LATITUDE']),
                    Number(element['LONGITUDE'])
                );
                yaleBDistance = haversineDistance(
                    // your location
                    Number(req.body.latitude),
                    Number(req.body.longitude),
                    // location of resulting place
                    Number(element['LATITUDE']),
                    Number(element['LONGITUDE'])
                );
                if (yaleBDistance <= placeRadius) {
                    element.distance = yaleBDistance;
                    element.heading = (bearing < 0) ? bearing + 360 : bearing;
                    element.headingRelative = bearing;
                    element.name = element['DESCRIPTION'];
                    element.location = {
                        lat: Number(element['LATITUDE']),
                        lng: Number(element['LONGITUDE'])
                    };
                    element.address = element['ADDRESS_1'] + ' ' + element['ADDRESS_2'] + ' ' + element['ADDRESS_3'];
                    existingArray.push(element);
                    numResults++;
                }
            }
            callback(existingArray);
        });
    };


    /*
     * Recrusive asynchronous callback, which calls the final execution
     * callback to end the recursion (called 'callback' - carried down until
     * the bottom out case).
     * Enables dynamic filtering during list population to get true closest   
     * results.
     */
    // add in yale building data - should currently fail and return original data without API key
    var infoCallback = function(response, i, existingArray, itemCount, callback) {
        if (itemCount === THRESHOLD) {
            return callback(existingArray);
        }
        // using the reference field, make individual PlaceDetails requests via the Places API
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
                existingArray.push({
                    name: details.result.name,
                    location: details.result.geometry.location,
                    icon: details.result.icon,
                    place_id: details.result.place_id,
                    address: details.result.formatted_address,
                    website: details.result.website,
                    rating: details.result.rating,
                    reviews: details.result.reviews,
                    tags: details.result.types,
                    heading: (bearing < 0) ? bearing + 360 : bearing,
                    headingRelative: bearing,
                    distance: abs_distance
                });
                if (existingArray.length < (THRESHOLD * 2)) {
                    var returnVal = infoCallback(response, (i + 1), existingArray, (itemCount + 1), callback);
                    return returnVal;
                } else {
                    return existingArray;
                }
            } else {
                var returnVal = infoCallback(response, (i + 1), existingArray, (itemCount + 1), callback);
                return returnVal;
            }
        });
    };

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
                // only gather info for the first <THRESHOLD> references
                // use recursive helper, with given callback
                infoCallback(response, 0, existingArray, 0, callback);
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
    if (req.body.query === undefined || req.body.query === 'all') {
        addYaleBuildings(placeDetails, function(yaleArray) {
            addGoogleRadarSearch(yaleArray, function(finalArray) {
                // sort the final array by distance
                sortByKey(finalArray, 'distance');
                // splice the array in half, since we have THRESHOLD * 2 total elements
                // (THRESHOLD) from each
                var splicedArr = finalArray.splice(0, Math.floor(THRESHOLD));
                res.send(splicedArr);
            });
        });
    } else if (req.body.query === 'yale') {
        addYaleBuildings(placeDetails, function(yaleArray) {
            // sort the final array by distance
            sortByKey(yaleArray, 'distance');
            res.send(yaleArray);
        });
    } else if (req.body.query === 'places') {
        addGoogleRadarSearch(placeDetails, function(placesArray) {
            // sort the final array by distance
            sortByKey(placesArray, 'distance');
            res.send(placesArray);
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