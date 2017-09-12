"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var util = require('aws-sdk/lib/util');
util.crypto.lib = require('crypto');
util.Buffer = require('buffer').Buffer;
util.domain = require('domain');
util.stream = require('stream');
util.url = require('url');
util.querystring = require('querystring');
util.environment = 'nodejs';
var SigV4Utils = (function () {
    function SigV4Utils() {
    }
    SigV4Utils.prototype.getSignedUrl = function (host, region, credentials) {
        var datetime = util.date.iso8601(new Date()).replace(/[:\-]|\.\d{3}/g, '');
        var date = datetime.substr(0, 8);
        var method = 'GET';
        var protocol = 'wss';
        var uri = '/mqtt';
        var service = 'iotdevicegateway';
        var algorithm = 'AWS4-HMAC-SHA256';
        var credentialScope = date + '/' + region + '/' + service + '/' + 'aws4_request';
        var canonicalQuerystring = 'X-Amz-Algorithm=' + algorithm;
        canonicalQuerystring += '&X-Amz-Credential=' + encodeURIComponent(credentials.accessKeyId + '/' + credentialScope);
        canonicalQuerystring += '&X-Amz-Date=' + datetime;
        canonicalQuerystring += '&X-Amz-SignedHeaders=host';
        var canonicalHeaders = 'host:' + host + '\n';
        var payloadHash = util.crypto.sha256('', 'hex');
        var canonicalRequest = method + '\n' + uri + '\n' + canonicalQuerystring + '\n' + canonicalHeaders + '\nhost\n' + payloadHash;
        var stringToSign = algorithm + '\n' + datetime + '\n' + credentialScope + '\n' + util.crypto.sha256(canonicalRequest, 'hex');
        var signingKey = this.getSignatureKey(credentials.secretAccessKey, date, region, service);
        var signature = util.crypto.hmac(signingKey, stringToSign, 'hex');
        canonicalQuerystring += '&X-Amz-Signature=' + signature;
        if (credentials.sessionToken) {
            canonicalQuerystring += '&X-Amz-Security-Token=' + encodeURIComponent(credentials.sessionToken);
        }
        var requestUrl = protocol + '://' + host + uri + '?' + canonicalQuerystring;
        return requestUrl;
    };
    SigV4Utils.prototype.getSignatureKey = function (key, date, region, service) {
        var kDate = util.crypto.hmac('AWS4' + key, date, 'buffer');
        var kRegion = util.crypto.hmac(kDate, region, 'buffer');
        var kService = util.crypto.hmac(kRegion, service, 'buffer');
        var kCredentials = util.crypto.hmac(kService, 'aws4_request', 'buffer');
        return kCredentials;
    };
    return SigV4Utils;
}());
exports.SigV4Utils = SigV4Utils;
//# sourceMappingURL=sig4utils.js.map