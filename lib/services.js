var fs = require('fs');
var ejs = require('ejs');

var Rest = require('sira-rest').Rest;

ejs.filters.q = function(obj) {
    return JSON.stringify(obj, null, 2 );
};

module.exports = function generateServices(template, sapp, moduleName, apiUrl) {
    if (typeof template === 'object') {
        apiUrl = moduleName;
        moduleName = sapp;
        sapp = template;
        template = null;
    }
    template = template || 'angular';
    moduleName = moduleName || 'siras';
    apiUrl = apiUrl || '/';

    var models = describeModels(sapp);

    var servicesTemplate = fs.readFileSync(require.resolve('./templates/' + template + '.template'),
        { encoding: 'utf-8' });

    return ejs.render(servicesTemplate, {
        moduleName: moduleName,
        models: models,
        urlBase: apiUrl.replace(/\/+$/, ''),
        resultful: sapp.get('resultful')
    });
};

function describeModels(sapp) {
    var result = {};
    Rest.buildClasses(sapp).forEach(function(c) {
        var name = c.name;

        if (!c.ctor) {
            // Skip classes that don't have a shared ctor
            // as they are not Sira models
            console.error('Skipping %j as it is not a Sira model', name);
            return;
        }

        // The URL of prototype methods include sharedCtor parameters like ":id"
        // Because all $resource methods are static (non-prototype) in ngResource,
        // the sharedCtor parameters should be added to the parameters
        // of prototype methods.
        c.methods.forEach(function fixArgsOfPrototypeMethods(method) {
            var ctor = method.restClass.ctor;
            if (!ctor || method.sharedMethod.isStatic) return;
            method.accepts = ctor.accepts.concat(method.accepts);
        });

        c.isUser = name.toLowerCase() === 'user';
        result[name] = c;
    });

    return result;
}

