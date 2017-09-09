import Backoff from 'backo2';
import { EventEmitter } from 'eventemitter3';
const isString = require('lodash.isstring');
const isObject = require('lodash.isobject');
import { print } from 'graphql/language/printer';
import { getOperationAST } from 'graphql/utilities/getOperationAST';
import $$observable from 'symbol-observable';
import { WS_TIMEOUT } from './defaults';
import MessageTypes from './message-types';
import { SigV4Utils } from './sig4utils'; // For WS URL Signing
import 'paho-mqtt';
const uuidv4 = require('uuid/v4');
export class SubscriptionClient {
    constructor(url, options, getCredentialsFn) {
        this.status = 'connecting';
        const { connectionCallback = null, connectionParams = {}, timeout = WS_TIMEOUT, reconnect = false, reconnectionAttempts = Infinity, } = (options || {});
        this.getCredentialsFn = getCredentialsFn;
        if (!this.getCredentialsFn) {
            throw new Error('Get Credentials Function required to connect to the socket');
        }
        this.sigv4utils = new SigV4Utils();
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
        this.eventEmitter = new EventEmitter();
        this.middlewares = [];
        this.client = null;
        this.maxConnectTimeGenerator = this.createMaxConnectTimeGenerator();
        this.AppPrefix = options.AppPrefix || '';
        this.request = this.request.bind(this);
        this.connect();
    }
    close(isForced = true, closedByUser = true) {
        this.closedByUser = closedByUser;
        if (isForced) {
            this.clearCheckConnectionInterval();
            this.clearMaxConnectTimeout();
            this.clearTryReconnectTimeout();
            this.sendMessage(undefined, MessageTypes.GQL_CONNECTION_TERMINATE, null);
        }
        if (this.status === 'connected') {
            this.client.disconnect();
        }
        this.client = null;
        this.eventEmitter.emit('disconnected');
        if (!isForced) {
            this.tryReconnect();
        }
    }
    request(request) {
        const getObserver = this.getObserver.bind(this);
        const executeOperation = this.executeOperation.bind(this);
        const unsubscribe = this.unsubscribe.bind(this);
        let opId;
        return {
            [$$observable]() {
                return this;
            },
            subscribe(observerOrNext, onError, onComplete) {
                const observer = getObserver(observerOrNext, onError, onComplete);
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
                    unsubscribe: () => {
                        if (opId) {
                            unsubscribe(opId);
                            opId = null;
                        }
                    },
                };
            },
        };
    }
    /**
 * @deprecated This method will become deprecated in the next release.
 * request should be used.
 */
    query(options) {
        return new Promise((resolve, reject) => {
            const handler = (error, result) => {
                if (result) {
                    resolve(result);
                }
                else {
                    reject(error);
                }
            };
            // NOTE: as soon as we move into observables, we don't need to wait GQL_COMPLETE for queries and mutations
            this.executeOperation(options, handler);
        });
    }
    /**
     * @deprecated This method will become deprecated in the next release.
     * request should be used.
     */
    subscribe(options, handler) {
        const legacyHandler = (error, result) => {
            let operationPayloadData = result && result.data || null;
            let operationPayloadErrors = result && result.errors || null;
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
    }
    on(eventName, callback, context) {
        const handler = this.eventEmitter.on(eventName, callback, context);
        return () => {
            handler.off(eventName, callback, context);
        };
    }
    onConnected(callback, context) {
        return this.on('connected', callback, context);
    }
    onConnecting(callback, context) {
        return this.on('connecting', callback, context);
    }
    onDisconnected(callback, context) {
        return this.on('disconnected', callback, context);
    }
    onReconnected(callback, context) {
        return this.on('reconnected', callback, context);
    }
    onReconnecting(callback, context) {
        return this.on('reconnecting', callback, context);
    }
    unsubscribe(opId) {
        if (this.operations[opId]) {
            this.sendMessage(opId, MessageTypes.GQL_STOP, { subscriptionName: this.operations[opId].options.subscriptionName });
            delete this.operations[opId];
        }
    }
    unsubscribeAll() {
        Object.keys(this.operations).forEach(subId => {
            this.unsubscribe(subId);
        });
    }
    applyMiddlewares(options) {
        return new Promise((resolve, reject) => {
            const queue = (funcs, scope) => {
                const next = (error) => {
                    if (error) {
                        reject(error);
                    }
                    else {
                        if (funcs.length > 0) {
                            const f = funcs.shift();
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
            queue([...this.middlewares], this);
        });
    }
    use(middlewares) {
        middlewares.map((middleware) => {
            if (typeof middleware.applyMiddleware === 'function') {
                this.middlewares.push(middleware);
            }
            else {
                throw new Error('Middleware must implement the applyMiddleware function.');
            }
        });
        return this;
    }
    executeOperation(options, handler) {
        const opId = this.generateOperationId();
        this.operations[opId] = { options: options, handler };
        this.applyMiddlewares(options)
            .then(processedOptions => {
            this.checkOperationOptions(processedOptions, handler);
            if (this.operations[opId]) {
                processedOptions.subscriptionName = options.query.definitions[0].selectionSet.selections[0].name.value; // how reliable is this and is there a better way. I want the subscription name so i dont have to create another index just to unsubscribe                
                this.operations[opId] = { options: processedOptions, handler };
                this.sendMessage(opId, MessageTypes.GQL_START, processedOptions);
            }
        })
            .catch(error => {
            this.unsubscribe(opId);
            handler(this.formatErrors(error));
        });
        return opId;
    }
    getObserver(observerOrNext, error, complete) {
        if (typeof observerOrNext === 'function') {
            return {
                next: (v) => observerOrNext(v),
                error: (e) => error && error(e),
                complete: () => complete && complete(),
            };
        }
        return observerOrNext;
    }
    createMaxConnectTimeGenerator() {
        const minValue = 1000;
        const maxValue = this.timeout;
        return new Backoff({
            min: minValue,
            max: maxValue,
            factor: 1.2,
        });
    }
    clearCheckConnectionInterval() {
        if (this.checkConnectionIntervalId) {
            clearInterval(this.checkConnectionIntervalId);
            this.checkConnectionIntervalId = null;
        }
    }
    clearMaxConnectTimeout() {
        if (this.maxConnectTimeoutId) {
            clearTimeout(this.maxConnectTimeoutId);
            this.maxConnectTimeoutId = null;
        }
    }
    clearTryReconnectTimeout() {
        if (this.tryReconnectTimeoutId) {
            clearTimeout(this.tryReconnectTimeoutId);
            this.tryReconnectTimeoutId = null;
        }
    }
    checkOperationOptions(options, handler) {
        const { query, variables, operationName } = options;
        if (!query) {
            throw new Error('Must provide a query.');
        }
        if (!handler) {
            throw new Error('Must provide an handler.');
        }
        if ((!isString(query) && !getOperationAST(query, operationName)) ||
            (operationName && !isString(operationName)) ||
            (variables && !isObject(variables))) {
            throw new Error('Incorrect option types. query must be a string or a document,' +
                '`operationName` must be a string, and `variables` must be an object.');
        }
    }
    buildMessage(id, type, payload) {
        const payloadToReturn = payload && payload.query ? Object.assign({}, payload, { query: typeof payload.query === 'string' ? payload.query : print(payload.query) }) :
            payload;
        return {
            id,
            type,
            payload: payloadToReturn,
        };
    }
    // ensure we have an array of errors
    formatErrors(errors) {
        if (Array.isArray(errors)) {
            return errors;
        }
        // TODO  we should not pass ValidationError to callback in the future.
        // ValidationError
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
    }
    sendMessage(id, type, payload) {
        this.sendMessageRaw(this.buildMessage(id, type, payload));
    }
    // send message, or queue it if connection is not open
    sendMessageRaw(message) {
        console.log(message);
        switch (this.status) {
            case 'connected':
                const serializedMessage = new Paho.MQTT.Message(JSON.stringify({ data: JSON.stringify(message) })); // sending to graphql api handler as a string
                serializedMessage.destinationName = this.AppPrefix + '/out'; // topic pattern for each device connected
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
    }
    generateOperationId() {
        return String(++this.nextOperationId);
    }
    tryReconnect() {
        if (!this.reconnect || this.backoff.attempts >= this.reconnectionAttempts) {
            return;
        }
        if (!this.reconnecting) {
            Object.keys(this.operations).forEach((key) => {
                this.unsentMessagesQueue.push(this.buildMessage(key, MessageTypes.GQL_START, this.operations[key].options));
            });
            this.reconnecting = true;
        }
        this.clearTryReconnectTimeout();
        const delay = this.backoff.duration();
        this.tryReconnectTimeoutId = setTimeout(() => {
            this.connect();
        }, delay);
    }
    flushUnsentMessagesQueue() {
        this.unsentMessagesQueue.forEach((message) => {
            this.sendMessageRaw(message);
        });
        this.unsentMessagesQueue = [];
    }
    checkConnection() {
        if (this.wasKeepAliveReceived) {
            this.wasKeepAliveReceived = false;
            return;
        }
        if (!this.reconnecting) {
            this.close(false, true);
        }
    }
    checkMaxConnectTimeout() {
        this.clearMaxConnectTimeout();
        // Max timeout trying to connect
        this.maxConnectTimeoutId = setTimeout(() => {
            if (this.status !== 'connected') {
                this.close(false, true);
            }
        }, this.maxConnectTimeGenerator.duration());
    }
    connect() {
        console.log('connecting to socket');
        this.status = 'connecting';
        this.getCredentialsFn().then(({ credentials, clientId }) => {
            const requestUrl = this.sigv4utils.getSignedUrl(this.url, this.region, credentials);
            if (!clientId) {
                this.clientId = String(Math.random()).replace('.', '');
            }
            else {
                this.clientId = clientId;
            }
            this.client = new Paho.MQTT.Client(requestUrl, this.clientId);
            const connectOptions = {
                onSuccess: () => {
                    console.log('successfully connected');
                    this.status = 'connected';
                    this.closedByUser = false;
                    this.eventEmitter.emit(this.reconnecting ? 'reconnecting' : 'connecting'); // why here and not earlier?
                    const payload = typeof this.connectionParams === 'function' ? this.connectionParams() : this.connectionParams;
                    // Send CONNECTION_INIT message, no need to wait for connection to success (reduce roundtrips)
                    const clientIdTopic = this.AppPrefix + '/in/' + this.clientId;
                    console.log('subscribing to ' + clientIdTopic);
                    this.client.subscribe(clientIdTopic, {
                        onSuccess: (obj) => {
                            console.log('subscribe success');
                            this.sendMessage(undefined, MessageTypes.GQL_CONNECTION_INIT, payload);
                        },
                        onFailure: (obj) => {
                            console.log('subscribe failure');
                            console.log(obj);
                        }
                    });
                    this.flushUnsentMessagesQueue();
                },
                useSSL: true,
                timeout: this.timeout,
                mqttVersion: 4,
                onFailure: this.onClose.bind(this)
            };
            this.client.onConnectionLost = this.onClose.bind(this);
            this.client.onMessageArrived = this.processReceivedData.bind(this);
            this.client.connect(connectOptions);
        })
            .catch(err => {
            this.status = 'offline';
            console.log('connection error');
            console.log(err);
            this.close(false, false);
        });
    }
    processReceivedData(receivedData) {
        let parsedMessage;
        let opId;
        try {
            parsedMessage = JSON.parse(receivedData.payloadString);
            opId = parsedMessage.id;
            console.log('Received message', parsedMessage);
        }
        catch (e) {
            throw new Error(`Message must be JSON-parseable. Got: ${receivedData.payloadString}`);
        }
        if ([MessageTypes.GQL_DATA,
            MessageTypes.GQL_COMPLETE,
            MessageTypes.GQL_ERROR,
        ].indexOf(parsedMessage.type) !== -1 && !this.operations[opId]) {
            this.unsubscribe(opId);
            return;
        }
        switch (parsedMessage.type) {
            case MessageTypes.GQL_CONNECTION_ERROR:
                if (this.connectionCallback) {
                    this.connectionCallback(parsedMessage.payload);
                }
                break;
            case MessageTypes.GQL_CONNECTION_ACK:
                this.eventEmitter.emit(this.reconnecting ? 'reconnected' : 'connected');
                this.reconnecting = false;
                this.backoff.reset();
                this.maxConnectTimeGenerator.reset();
                if (this.connectionCallback) {
                    this.connectionCallback();
                }
                break;
            case MessageTypes.GQL_COMPLETE:
                this.operations[opId].handler(null, null);
                delete this.operations[opId];
                break;
            case MessageTypes.GQL_ERROR:
                this.operations[opId].handler(this.formatErrors(parsedMessage.payload), null);
                delete this.operations[opId];
                break;
            case MessageTypes.GQL_DATA:
                const parsedPayload = !parsedMessage.payload.errors ?
                    parsedMessage.payload : Object.assign({}, parsedMessage.payload, { errors: this.formatErrors(parsedMessage.payload.errors) });
                this.operations[opId].handler(null, parsedPayload);
                break;
            case MessageTypes.GQL_CONNECTION_KEEP_ALIVE:
                const firstKA = typeof this.wasKeepAliveReceived === 'undefined';
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
    }
    onClose(err) {
        this.status = 'closed';
        console.log(err);
        if (!this.closedByUser) {
            this.close(false, false);
        }
    }
}
//# sourceMappingURL=client.js.map