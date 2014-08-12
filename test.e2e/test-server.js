/*
 The test server is an HTTP service allowing
 front-end tests running in a browser to setup
 a custom LoopBack instance and generate & access lb-services.js
 */

var _ = require('lodash');
var express = require('express');
var sira = require('sira');
var siraCore = require('sira-core');
var rest = require('sira-rest');
var generator = require('..');
var bodyParser = require('body-parser');
var morgan = require('morgan');
var errorHandler = require('errorhandler');

var port = process.env.PORT || 3838;
var baseUrl;
var apiUrl;
var app = express();

var sapp, router;
var servicesScript;

// Speed up the password hashing algorithm
// for tests using the built-in User model
//loopback.User.settings.saltWorkFactor = 4;

// Save the pre-build models so that we can restore them before every test
//var initialModels = loopback.Model.modelBuilder.models;
//var initialDefinitions = loopback.Model.modelBuilder.definitions;

// Enable all domains to access our server via AJAX
// This way the script running in Karma page can
// talk to our service running on a different host/port.
app.use(require('cors')());
app.use(bodyParser.json());

app.use(morgan('dev'));

/*!
 Sample request
 {
 name: 'siras',
 models: {
 Customer: {
 properties: {
 name: 'string',
 // other properties
 },
 options: {
 }
 }
 // other model objects
 },
 setupFn: (function(app, cb) {
 Customer.create(
 { name: 'a-customer' },
 function(err, customer) {
 if (err) return cb(err);
 cb(null, { customer: customer });
 });
 }).toString()
 }
 */
app.post('/setup', function (req, res, next) {
    var opts = req.body;
    var template = opts.template;
    var name = opts.name;
    var models = opts.models;
    var setupFn = compileSetupFn(name, opts.setupFn);

    if (!name)
        return next(new Error('"name" is a required parameter'));

    if (!models || typeof models !== 'object')
        return next(new Error('"models" must be a valid object'));

    sapp = sira();

    for (var m in models) sapp.registry.define(m, models[m]);

    sapp.disable('model-public');
    sapp.set('auth', opts.enableAuth);
    classic(sapp);

    sapp.boot(function (err) {
        if (err) {
            console.error('app setup function failed', err);
            res.status(500).send(err);
            return;
        }

        router = buildRouter(sapp, {restApiRoot: '/'});

        sapp.model('user').settings.saltWorkFactor = 4;

        setupFn(sapp, function (err, data) {
            if (err) {
                console.error('app setup function failed', err);
                res.status(500).send(err);
                return;
            }

            try {
                servicesScript = generator.services(template, sapp, name, apiUrl);
            } catch (err) {
                console.error('Cannot generate services script:', err.stack);
                servicesScript = 'throw new Error("Error generating services script.");';
            }

            servicesScript += '\nangular.module(' + JSON.stringify(name) + ')' +
                '.value("testData", ' + JSON.stringify(data, null, 2) + ');\n';

            res.status(200).send({ servicesUrl: baseUrl + 'services?' + name });
        });
    });

});

function classic(sapp) {
    var modules = sapp.get('modules') || ['sira-core'];
    modules.forEach(function (m) {
        sapp.phase(sira.boot.module(m));
    });

    if (sapp.enabled('auth')) {
        sapp.phase(require('sira-core').authorizer);
    }

    sapp.phase(sira.boot.database(sapp.get('db') || sapp.get('database')));
}

function buildRouter(sapp, options) {
    options = options || {};

    var router = express.Router();
    router.use(siraCore.veriuser(sapp));
    router.use(options.restApiRoot, rest(sapp));

    return router;
}

function compileSetupFn(name, source) {
    if (!source)
        return function (app, cb) {
            cb();
        };

    var debug = require('debug')('test:' + name);
    /*jshint evil:true */
    return eval('(' + source + ')');
}

app.get('/services', function (req, res, next) {
    res.set('Content-Type', 'application/javascript');
    res.status(200).send(servicesScript);
});

app.use('/api', function (req, res, next) {
    if (!sapp) return next(new Error('Call /setup first.'));
    router(req, res, next);
});

app.use(errorHandler());

app.listen(port, function () {
    port = this.address().port;
    baseUrl = 'http://localhost:' + port + '/';
    console.log('Test server is listening on %s', baseUrl);
    apiUrl = baseUrl + 'api';

    if (process.argv.length > 2) runAndExit(process.argv[2], process.argv.slice(3));
});

function runAndExit(cmd, args) {
    console.log('Running %s %s', cmd, args.join(' '));
    var child = require('child_process').spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', function (err) {
        console.log('child_process.spawn failed', err);
        process.exit(1);
    });
    child.on('exit', function () {
        process.exit();
    });
}
