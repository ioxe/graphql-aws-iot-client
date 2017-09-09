"use strict";
var __assign = (this && this.__assign) || Object.assign || function(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
    }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
var Backoff = require("backo2");
var eventemitter3_1 = require("eventemitter3");
var isString = require('lodash.isstring');
var isObject = require('lodash.isobject');
var printer_1 = require("graphql/language/printer");
var getOperationAST_1 = require("graphql/utilities/getOperationAST");
var symbol_observable_1 = require("symbol-observable");
var defaults_1 = require("./defaults");
var message_types_1 = require("./message-types");
var sig4utils_1 = require("./sig4utils");
require("paho-mqtt");
var SubscriptionClient = (function () {
    function SubscriptionClient(url, options, getCredentialsFn) {
        this.status = 'connecting';
        var _a = (options || {}), _b = _a.connectionCallback, connectionCallback = _b === void 0 ? null : _b, _c = _a.connectionParams, connectionParams = _c === void 0 ? {} : _c, _d = _a.timeout, timeout = _d === void 0 ? defaults_1.WS_TIMEOUT : _d, _e = _a.reconnect, reconnect = _e === void 0 ? false : _e, _f = _a.reconnectionAttempts, reconnectionAttempts = _f === void 0 ? Infinity : _f;
        this.getCredentialsFn = getCredentialsFn;
        if (!this.getCredentialsFn) {
            throw new Error('Get Credentials Function required to connect to the socket');
        }
        this.sigv4utils = new sig4utils_1.SigV4Utils();
        this.connectionParams = connectionParams;
        this.connectionCallback = connectionCallback;
        this.url = url;
        this.region = options.region;
        this.operations = {};
        this.nextOperationId = 0;
        this.timeout = timeout;
        this.unsentMessagesQueue = [];
        this.reconnect = reconnect;
        this.reconnecting = false;
        this.reconnectionAttempts = reconnectionAttempts;
        this.closedByUser = false;
        this.backoff = new Backoff({ jitter: 0.5 });
        this.eventEmitter = new eventemitter3_1.EventEmitter();
        this.middlewares = [];
        this.client = null;
        this.maxConnectTimeGenerator = this.createMaxConnectTimeGenerator();
        this.AppPrefix = options.AppPrefix || '';
        this.request = this.request.bind(this);
        this.connect();
    }
    SubscriptionClient.prototype.close = function (isForced, closedByUser) {
        if (isForced === void 0) { isForced = true; }
        if (closedByUser === void 0) { closedByUser = true; }
        this.closedByUser = closedByUser;
        if (isForced) {
            this.clearCheckConnectionInterval();
            this.clearMaxConnectTimeout();
            this.clearTryReconnectTimeout();
            this.sendMessage(undefined, message_types_1.default.GQL_CONNECTION_TERMINATE, null);
        }
        if (this.status === 'connected') {
            this.client.disconnect();
        }
        this.client = null;
        this.eventEmitter.emit('disconnected');
        if (!isForced) {
            this.tryReconnect();
        }
    };
    SubscriptionClient.prototype.request = function (request) {
        var getObserver = this.getObserver.bind(this);
        var executeOperation = this.executeOperation.bind(this);
        var unsubscribe = this.unsubscribe.bind(this);
        var opId;
        return _a = {},
            _a[symbol_observable_1.default] = function () {
                return this;
            },
            _a.subscribe = function (observerOrNext, onError, onComplete) {
                var observer = getObserver(observerOrNext, onError, onComplete);
                opId = executeOperation({
                    query: request.query,
                    variables: request.variables,
                    operationName: request.operationName,
                }, function (error, result) {
                    if (error === null && result === null) {
                        observer.complete();
                    }
                    else if (error) {
                        observer.error(error[0]);
                    }
                    else {
                        observer.next(result);
                    }
                });
                return {
                    unsubscribe: function () {
                        if (opId) {
                            unsubscribe(opId);
                            opId = null;
                        }
                    },
                };
            },
            _a;
        var _a;
    };
    SubscriptionClient.prototype.query = function (options) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var handler = function (error, result) {
                if (result) {
                    resolve(result);
                }
                else {
                    reject(error);
                }
            };
            _this.executeOperation(options, handler);
        });
    };
    SubscriptionClient.prototype.subscribe = function (options, handler) {
        var legacyHandler = function (error, result) {
            var operationPayloadData = result && result.data || null;
            var operationPayloadErrors = result && result.errors || null;
            if (error) {
                operationPayloadErrors = error;
                operationPayloadData = null;
            }
            if (error !== null || result !== null) {
                handler(operationPayloadErrors, operationPayloadData);
            }
        };
        if (!handler) {
            throw new Error('Must provide an handler.');
        }
        return this.executeOperation(options, legacyHandler);
    };
    SubscriptionClient.prototype.on = function (eventName, callback, context) {
        var handler = this.eventEmitter.on(eventName, callback, context);
        return function () {
            handler.off(eventName, callback, context);
        };
    };
    SubscriptionClient.prototype.onConnected = function (callback, context) {
        return this.on('connected', callback, context);
    };
    SubscriptionClient.prototype.onConnecting = function (callback, context) {
        return this.on('connecting', callback, context);
    };
    SubscriptionClient.prototype.onDisconnected = function (callback, context) {
        return this.on('disconnected', callback, context);
    };
    SubscriptionClient.prototype.onReconnected = function (callback, context) {
        return this.on('reconnected', callback, context);
    };
    SubscriptionClient.prototype.onReconnecting = function (callback, context) {
        return this.on('reconnecting', callback, context);
    };
    SubscriptionClient.prototype.unsubscribe = function (opId) {
        if (this.operations[opId]) {
            this.sendMessage(opId, message_types_1.default.GQL_STOP, { subscriptionName: this.operations[opId].options.subscriptionName });
            delete this.operations[opId];
        }
    };
    SubscriptionClient.prototype.unsubscribeAll = function () {
        var _this = this;
        Object.keys(this.operations).forEach(function (subId) {
            _this.unsubscribe(subId);
        });
    };
    SubscriptionClient.prototype.applyMiddlewares = function (options) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var queue = function (funcs, scope) {
                var next = function (error) {
                    if (error) {
                        reject(error);
                    }
                    else {
                        if (funcs.length > 0) {
                            var f = funcs.shift();
                            if (f) {
                                f.applyMiddleware.apply(scope, [options, next]);
                            }
                        }
                        else {
                            resolve(options);
                        }
                    }
                };
                next();
            };
            queue(_this.middlewares.slice(), _this);
        });
    };
    SubscriptionClient.prototype.use = function (middlewares) {
        var _this = this;
        middlewares.map(function (middleware) {
            if (typeof middleware.applyMiddleware === 'function') {
                _this.middlewares.push(middleware);
            }
            else {
                throw new Error('Middleware must implement the applyMiddleware function.');
            }
        });
        return this;
    };
    SubscriptionClient.prototype.executeOperation = function (options, handler) {
        var _this = this;
        var opId = this.generateOperationId();
        this.operations[opId] = { options: options, handler: handler };
        this.applyMiddlewares(options)
            .then(function (processedOptions) {
            _this.checkOperationOptions(processedOptions, handler);
            if (_this.operations[opId]) {
                processedOptions.subscriptionName = options.query.definitions[0].selectionSet.selections[0].name.value;
                _this.operations[opId] = { options: processedOptions, handler: handler };
                _this.sendMessage(opId, message_types_1.default.GQL_START, processedOptions);
            }
        })
            .catch(function (error) {
            _this.unsubscribe(opId);
            handler(_this.formatErrors(error));
        });
        return opId;
    };
    SubscriptionClient.prototype.getObserver = function (observerOrNext, error, complete) {
        if (typeof observerOrNext === 'function') {
            return {
                next: function (v) { return observerOrNext(v); },
                error: function (e) { return error && error(e); },
                complete: function () { return complete && complete(); },
            };
        }
        return observerOrNext;
    };
    SubscriptionClient.prototype.createMaxConnectTimeGenerator = function () {
        var minValue = 1000;
        var maxValue = this.timeout;
        return new Backoff({
            min: minValue,
            max: maxValue,
            factor: 1.2,
        });
    };
    SubscriptionClient.prototype.clearCheckConnectionInterval = function () {
        if (this.checkConnectionIntervalId) {
            clearInterval(this.checkConnectionIntervalId);
            this.checkConnectionIntervalId = null;
        }
    };
    SubscriptionClient.prototype.clearMaxConnectTimeout = function () {
        if (this.maxConnectTimeoutId) {
            clearTimeout(this.maxConnectTimeoutId);
            this.maxConnectTimeoutId = null;
        }
    };
    SubscriptionClient.prototype.clearTryReconnectTimeout = function () {
        if (this.tryReconnectTimeoutId) {
            clearTimeout(this.tryReconnectTimeoutId);
            this.tryReconnectTimeoutId = null;
        }
    };
    SubscriptionClient.prototype.checkOperationOptions = function (options, handler) {
        var query = options.query, variables = options.variables, operationName = options.operationName;
        if (!query) {
            throw new Error('Must provide a query.');
        }
        if (!handler) {
            throw new Error('Must provide an handler.');
        }
        if ((!isString(query) && !getOperationAST_1.getOperationAST(query, operationName)) ||
            (operationName && !isString(operationName)) ||
            (variables && !isObject(variables))) {
            throw new Error('Incorrect option types. query must be a string or a document,' +
                '`operationName` must be a string, and `variables` must be an object.');
        }
    };
    SubscriptionClient.prototype.buildMessage = function (id, type, payload) {
        var payloadToReturn = payload && payload.query ? __assign({}, payload, { query: typeof payload.query === 'string' ? payload.query : printer_1.print(payload.query) }) :
            payload;
        return {
            id: id,
            type: type,
            payload: payloadToReturn,
        };
    };
    SubscriptionClient.prototype.formatErrors = function (errors) {
        if (Array.isArray(errors)) {
            return errors;
        }
        if (errors && errors.errors) {
            return this.formatErrors(errors.errors);
        }
        if (errors && errors.message) {
            return [errors];
        }
        return [{
                name: 'FormatedError',
                message: 'Unknown error',
                originalError: errors,
            }];
    };
    SubscriptionClient.prototype.sendMessage = function (id, type, payload) {
        this.sendMessageRaw(this.buildMessage(id, type, payload));
    };
    SubscriptionClient.prototype.sendMessageRaw = function (message) {
        console.log(message);
        switch (this.status) {
            case 'connected':
                var serializedMessage = new Paho.MQTT.Message(JSON.stringify({ data: JSON.stringify(message) }));
                serializedMessage.destinationName = this.AppPrefix + '/out';
                console.log('Sending message');
                console.log(serializedMessage.payloadString);
                serializedMessage.retained = false;
                this.client.send(serializedMessage);
                break;
            case 'connecting':
                this.unsentMessagesQueue.push(message);
                break;
            default:
                if (!this.reconnecting) {
                    throw new Error('A message was not sent because socket is not connected, is closing or ' +
                        'is already closed. Message was: ${JSON.parse(serializedMessage)}.');
                }
        }
    };
    SubscriptionClient.prototype.generateOperationId = function () {
        return String(++this.nextOperationId);
    };
    SubscriptionClient.prototype.tryReconnect = function () {
        var _this = this;
        if (!this.reconnect || this.backoff.attempts >= this.reconnectionAttempts) {
            return;
        }
        if (!this.reconnecting) {
            Object.keys(this.operations).forEach(function (key) {
                _this.unsentMessagesQueue.push(_this.buildMessage(key, message_types_1.default.GQL_START, _this.operations[key].options));
            });
            this.reconnecting = true;
        }
        this.clearTryReconnectTimeout();
        var delay = this.backoff.duration();
        this.tryReconnectTimeoutId = setTimeout(function () {
            _this.connect();
        }, delay);
    };
    SubscriptionClient.prototype.flushUnsentMessagesQueue = function () {
        var _this = this;
        this.unsentMessagesQueue.forEach(function (message) {
            _this.sendMessageRaw(message);
        });
        this.unsentMessagesQueue = [];
    };
    SubscriptionClient.prototype.checkConnection = function () {
        if (this.wasKeepAliveReceived) {
            this.wasKeepAliveReceived = false;
            return;
        }
        if (!this.reconnecting) {
            this.close(false, true);
        }
    };
    SubscriptionClient.prototype.checkMaxConnectTimeout = function () {
        var _this = this;
        this.clearMaxConnectTimeout();
        this.maxConnectTimeoutId = setTimeout(function () {
            if (_this.status !== 'connected') {
                _this.close(false, true);
            }
        }, this.maxConnectTimeGenerator.duration());
    };
    SubscriptionClient.prototype.connect = function () {
        var _this = this;
        console.log('connecting to socket');
        this.status = 'connecting';
        this.getCredentialsFn().then(function (_a) {
            var credentials = _a.credentials, clientId = _a.clientId;
            var requestUrl = _this.sigv4utils.getSignedUrl(_this.url, _this.region, credentials);
            if (!clientId) {
                _this.clientId = String(Math.random()).replace('.', '');
            }
            else {
                _this.clientId = clientId;
            }
            _this.client = new Paho.MQTT.Client(requestUrl, _this.clientId);
            var connectOptions = {
                onSuccess: function () {
                    console.log('successfully connected');
                    _this.status = 'connected';
                    _this.closedByUser = false;
                    _this.eventEmitter.emit(_this.reconnecting ? 'reconnecting' : 'connecting');
                    var payload = typeof _this.connectionParams === 'function' ? _this.connectionParams() : _this.connectionParams;
                    var clientIdTopic = _this.AppPrefix + '/in/' + _this.clientId;
                    console.log('subscribing to ' + clientIdTopic);
                    _this.client.subscribe(clientIdTopic, {
                        onSuccess: function (obj) {
                            console.log('subscribe success');
                            _this.sendMessage(undefined, message_types_1.default.GQL_CONNECTION_INIT, payload);
                        },
                        onFailure: function (obj) {
                            console.log('subscribe failure');
                            console.log(obj);
                        }
                    });
                    _this.flushUnsentMessagesQueue();
                },
                useSSL: true,
                timeout: _this.timeout,
                mqttVersion: 4,
                onFailure: _this.onClose.bind(_this)
            };
            _this.client.onConnectionLost = _this.onClose.bind(_this);
            _this.client.onMessageArrived = _this.processReceivedData.bind(_this);
            _this.client.connect(connectOptions);
        })
            .catch(function (err) {
            _this.status = 'offline';
            console.log('connection error');
            console.log(err);
            _this.close(false, false);
        });
    };
    SubscriptionClient.prototype.processReceivedData = function (receivedData) {
        var parsedMessage;
        var opId;
        try {
            parsedMessage = JSON.parse(receivedData.payloadString);
            opId = parsedMessage.id;
            console.log('Received message', parsedMessage);
        }
        catch (e) {
            throw new Error("Message must be JSON-parseable. Got: " + receivedData.payloadString);
        }
        if ([message_types_1.default.GQL_DATA,
            message_types_1.default.GQL_COMPLETE,
            message_types_1.default.GQL_ERROR,
        ].indexOf(parsedMessage.type) !== -1 && !this.operations[opId]) {
            this.unsubscribe(opId);
            return;
        }
        switch (parsedMessage.type) {
            case message_types_1.default.GQL_CONNECTION_ERROR:
                if (this.connectionCallback) {
                    this.connectionCallback(parsedMessage.payload);
                }
                break;
            case message_types_1.default.GQL_CONNECTION_ACK:
                this.eventEmitter.emit(this.reconnecting ? 'reconnected' : 'connected');
                this.reconnecting = false;
                this.backoff.reset();
                this.maxConnectTimeGenerator.reset();
                if (this.connectionCallback) {
                    this.connectionCallback();
                }
                break;
            case message_types_1.default.GQL_COMPLETE:
                this.operations[opId].handler(null, null);
                delete this.operations[opId];
                break;
            case message_types_1.default.GQL_ERROR:
                this.operations[opId].handler(this.formatErrors(parsedMessage.payload), null);
                delete this.operations[opId];
                break;
            case message_types_1.default.GQL_DATA:
                var parsedPayload = !parsedMessage.payload.errors ?
                    parsedMessage.payload : __assign({}, parsedMessage.payload, { errors: this.formatErrors(parsedMessage.payload.errors) });
                this.operations[opId].handler(null, parsedPayload);
                break;
            case message_types_1.default.GQL_CONNECTION_KEEP_ALIVE:
                var firstKA = typeof this.wasKeepAliveReceived === 'undefined';
                this.wasKeepAliveReceived = true;
                if (firstKA) {
                    this.checkConnection();
                }
                if (this.checkConnectionIntervalId) {
                    clearInterval(this.checkConnectionIntervalId);
                    this.checkConnection();
                }
                this.checkConnectionIntervalId = setInterval(this.checkConnection.bind(this), this.timeout);
                break;
            default:
                throw new Error('Invalid message type!');
        }
    };
    SubscriptionClient.prototype.onClose = function (err) {
        this.status = 'closed';
        console.log(err);
        if (!this.closedByUser) {
            this.close(false, false);
        }
    };
    return SubscriptionClient;
}());
exports.SubscriptionClient = SubscriptionClient;
//# sourceMappingURL=client.js.map