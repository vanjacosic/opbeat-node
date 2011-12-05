var zlib = require('zlib'),
    utils = require('./utils'),
    parseUrl = require('url').parse,
    uuid = require('node-uuid');

var Client = function Client(options) {
    this.servers = options.servers;
    this.key = options.key;
    this.name = options.name || require('os').hostname();
    this.site = options.site;
    this.root = options.root || process.cwd();
}, _ = Client.prototype;

module.exports.Client = Client;

_.getIdent =
_.get_ident = function getIdent(result) {
    return result.id+'$'+result.checksum;
};

_.process = function process(kwargs) {
    var event_id = uuid().replace(/-/g, ''),
        checksum;

    kwargs['event_id'] = event_id;

    if(!kwargs['checksum']){
        checksum = kwargs['checksum'] = utils.construct_checksum(kwargs);
    } else {
        checksum = kwargs['checksum'];
    }

    kwargs['server_name'] = kwargs['server_name'] || this.name;
    kwargs['site'] = kwargs['site'] || this.site;
    kwargs['extra'] = kwargs['extra'] || {};
    
    // this will happen asynchronously. We don't care about it's response.
    this.send(kwargs);

    return {'id': event_id, 'checksum': checksum};
};

_.send_remote = function send_remote(url, message, headers, callback) {
    url = parseUrl(url);
    var options = {
        host: url.hostname,
        path: url.pathname,
        port: ~~url.port,
        headers: headers,
        method: 'POST',
    }, req = require(url.protocol.slice(0, url.protocol.length-1)).request(options, function(res){
        res.on('data', function(data) {
            console.log(data.toString());
        });
    });

    req.end(message);
};

_.send = function send(kwargs) {
    var self = this;
    zlib.deflate(JSON.stringify(kwargs), function(err, buff) {
        var message = buff.toString('base64');
        //TODO: refactor this to not blast out to all servers at once.
        self.servers.forEach(function(url) {
            var timestamp = new Date().getTime()/1000,
                signature = utils.get_signature(self.key, message, timestamp),
                headers = {
                    'X-Sentry-Auth': utils.get_auth_header(signature, timestamp),
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': message.length,
                };
            
            self.send_remote(url, message, headers);
        });
    });
};

_.createFromText =
_.create_from_text = function createFromText(message, kwargs, callback) {
    if(!callback && typeof kwargs === 'function') {
        callback = kwargs;
        kwargs = {};
    } else {
        kwargs = kwargs || {};
    }
    kwargs['message'] = message;
    kwargs['sentry.interfaces.Message'] = {
        message: message,
        params: {}
    };
    var result = this.process(kwargs);
    if(callback) callback(result);
};

_.createFromError =
_.create_from_exception =
_.create_from_error = function createFromError(err, kwargs, callback) {
    var self = this;
    if(!callback && typeof kwargs === 'function') {
        callback = kwargs;
        kwargs = {};
    } else {
        kwargs = kwargs || {};
    }
    utils.parseStack(err.stack, function(e, frames) {
        kwargs['message'] = err.name+': '+err.message;
        kwargs['sentry.interfaces.Exception'] = {type:err.name, value:err.message};
        kwargs['sentry.interfaces.Stacktrace'] = {frames:frames};
        kwargs['culprit'] = err.name + ' in ' + err.stack.split('\n')[1].match(/^.*?\((.*?):\d+:\d+\)$/)[1].replace(process.cwd()+'/', '');
        var result = self.process(kwargs);
        if(callback) callback(result);
    });
};

module.exports.patchGlobal =
module.exports.patch_global = function patchGlobal(options) {
    var client = new Client(options);
    process.on('uncaughtException', function(err) {
        client.create_from_exception(err, function(result) {
            var util = require('util');
            util.log('uncaughtException: '+client.get_ident(result));
        });
        // client.create_from_exception(err);
    });
};