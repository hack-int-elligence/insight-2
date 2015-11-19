var express = require('express');
var sessions = require('client-sessions');
var bodyParser = require('body-parser');
var compression = require('compression');
var path = require('path');

var parseThings = require('./routes/parse');
var geocodeData = require('./routes/geocode');
var facebookData = require('./routes/facebook');

var app = express()

app.engine('.html', require('ejs').__express);
app.set('view engine', 'html');
app.use(compression());
app.use(express.static(path.join(__dirname, 'public')));

app.use(bodyParser.json({
	limit: '1mb'
}));
app.use(bodyParser.urlencoded({
	extended: false,
	limit: '1mb'
}));

// route handlers go here
app.use(parseThings); // order matters!
app.use(geocodeData);
app.use(facebookData);

app.use(function(req, res, next) {
	res.sendStatus(404);
});

app.set('port', process.env.PORT || 3000);

var clientServer = app.listen(app.get('port'), function() {
	console.log('Express server listening on port %d', clientServer.address().port);
});
