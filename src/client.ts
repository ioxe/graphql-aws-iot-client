import * as Backoff from 'backo2';
import { EventEmitter, ListenerFn } from 'eventemitter3';
const isString = require('lodash.isstring');
const isObject = require('lodash.isobject');
import { ExecutionResult } from 'graphql/execution/execute';
import { print } from 'graphql/language/printer';
import { DocumentNode } from 'graphql/language/ast';
import { getOperationAST } from 'graphql/utilities/getOperationAST';
import $$observable from 'symbol-observable';

import { WS_TIMEOUT } from './defaults';
import MessageTypes from './message-types';

import { SigV4Utils } from './sig4utils'; // For WS URL Signing

import 'paho-mqtt';
declare var Paho: any;
const uuidv4 = require('uuid/v4');

export interface Observer<T> {
  next?: (value: T) => void;
  error?: (error: Error) => void;
  complete?: () => void;
}

export interface Observable<T> {
  subscribe(
    observer: Observer<T>,
  ): {
    unsubscribe: () => void;
  };
}

export interface OperationOptions {
  query?: string | DocumentNode;
  variables?: Object;
  operationName?: string;
  [key: string]: any;
}

export type FormatedError = Error & {
  originalError?: any;
};

export interface Operation {
  options: OperationOptions;
  handler: (error: Error[], result?: any) => void;
}

export interface Operations {
  [id: string]: Operation;
}

// tslint:disable
export type ConnectionParams = {
  [paramName: string]: any;
};
// tslint:enable

export type ConnectionParamsOptions = ConnectionParams | Function;

export interface ClientOptions {
  appPrefix: string; // used as namespace for creation of topics
  region: string;
  connectionParams?: ConnectionParamsOptions;
  getCredentialsFunction: GetCredentialsFunction;
  sigv4utils?: SigV4Utils;
  timeout?: number;
  reconnect?: boolean;
  reconnectionAttempts?: number;
  connectionCallback?: (error: Error[], result?: any) => void;
  clientId?: string;
  debug?: boolean;
}

export interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface Middleware {
  applyMiddleware(options: OperationOptions, next: Function): void;
}

export interface GetCredentialsFunction {
  (...args: any[]): Promise<AWSCredentials>; // method to obtain credentials for connecting and subscribing to AWS IOT Topics
}

export class SubscriptionClient {
  public client: any;
  public operations: Operations;
  private appPrefix: string; // used as namespace for creation of topics
  private iotEndpoint: string; // iot endpoint for region where app is deployed
  private region: string; // region of iot endpoint
  private nextOperationId: number;
  private connectionParams: ConnectionParamsOptions;
  private unsentMessagesQueue: Array<any>; // queued messages while websocket is opening.
  private reconnect: boolean;
  private reconnecting: boolean;
  private reconnectionAttempts: number;
  private backoff: any;
  private connectionCallback: any;
  private eventEmitter: EventEmitter;
  private closedByUser: boolean;
  private wsImpl: any;
  private wasKeepAliveReceived: boolean;
  private tryReconnectTimeoutId: any;
  private checkConnectionIntervalId: any;
  private maxConnectTimeoutId: any;
  private middlewares: Middleware[];
  private maxConnectTimeGenerator: any;
  private timeout: number;
  private clientId: string;
  private uuid: string;
  private status = 'connecting';
  private getCredentialsFunction: GetCredentialsFunction; // method to obtain credentials for connecting and subscribing to AWS IOT Topics
  private sigv4utils: SigV4Utils; // class used to sign credentials and create request url to connect to the web socket
  private debug: boolean;
  constructor(iotEndpoint: string, options: ClientOptions) {
    const {
      connectionCallback = null,
      connectionParams = {},
      timeout = WS_TIMEOUT,
      reconnect = false,
      reconnectionAttempts = Infinity,
    } =
      options || {};

    if (!iotEndpoint) {
      throw new Error('Iot Endpoint Required');
    }

    if (!options.appPrefix) {
      throw new Error('App Prefix Required');
    }

    if (!options.getCredentialsFunction) {
      throw new Error('Get Credentials Function required to generate aws iot signed url.');
    }

    this.iotEndpoint = iotEndpoint;
    this.appPrefix = options.appPrefix;
    this.getCredentialsFunction = options.getCredentialsFunction;

    if (options.sigv4utils) {
      this.sigv4utils = options.sigv4utils;
    } else {
      this.sigv4utils = new SigV4Utils();
    }

    this.connectionParams = connectionParams;
    this.connectionCallback = connectionCallback;
    this.iotEndpoint = iotEndpoint;
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
    this.request = this.request.bind(this);
    this.debug = options.debug;
    this.connect();
  }

  public close(isForced = true, closedByUser = true) {
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

  public request(request: OperationOptions): Observable<ExecutionResult> {
    const getObserver = this.getObserver.bind(this);
    const executeOperation = this.executeOperation.bind(this);
    const unsubscribe = this.unsubscribe.bind(this);

    let opId: string;

    return {
      [$$observable]() {
        return this;
      },
      subscribe(
        observerOrNext: (Observer<ExecutionResult>) | ((v: ExecutionResult) => void),
        onError?: (error: Error) => void,
        onComplete?: () => void,
      ) {
        const observer = getObserver(observerOrNext, onError, onComplete);
        opId = executeOperation(
          {
            query: request.query,
            variables: request.variables,
            operationName: request.operationName,
            token: request.token,
          },
          function(error: Error[], result: any) {
            if (error === null && result === null) {
              // handles observer.complete is not a function bug for queries react apollo dev tools
              if (observer.complete && observer.complete instanceof Function) {
                observer.complete();
              }
            } else if (error) {
              observer.error(error[0]);
            } else {
              observer.next(result);
            }
          },
        );

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
  public query(options: OperationOptions): Promise<ExecutionResult> {
    return new Promise((resolve, reject) => {
      const handler = (error: Error[], result?: any) => {
        if (result) {
          resolve(result);
        } else {
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
  public subscribe(options: OperationOptions, handler: (error: Error[], result?: any) => void) {
    const legacyHandler = (error: Error[], result?: any) => {
      let operationPayloadData = (result && result.data) || null;
      let operationPayloadErrors = (result && result.errors) || null;

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

  public on(eventName: string, callback: ListenerFn, context?: any): Function {
    const handler = this.eventEmitter.on(eventName, callback, context);

    return () => {
      handler.off(eventName, callback, context);
    };
  }

  public onConnected(callback: ListenerFn, context?: any): Function {
    return this.on('connected', callback, context);
  }

  public onConnecting(callback: ListenerFn, context?: any): Function {
    return this.on('connecting', callback, context);
  }

  public onDisconnected(callback: ListenerFn, context?: any): Function {
    return this.on('disconnected', callback, context);
  }

  public onReconnected(callback: ListenerFn, context?: any): Function {
    return this.on('reconnected', callback, context);
  }

  public onReconnecting(callback: ListenerFn, context?: any): Function {
    return this.on('reconnecting', callback, context);
  }

  public unsubscribe(opId: string) {
    // only send stop message to lambda if its a subscription.
    if (
      this.operations[opId] &&
      this.operations[opId].options &&
      this.operations[opId].options.query &&
      this.hasSubscriptionOperation(this.operations[opId].options as any)
    ) {
      const subscriptionName = (this.operations[opId].options.query as any).definitions[0].selectionSet.selections[0]
        .name.value;
      this.sendMessage(opId, MessageTypes.GQL_STOP, {
        subscriptionName,
      });
      delete this.operations[opId];
    }
  }

  public unsubscribeAll() {
    Object.keys(this.operations).forEach(subId => {
      this.unsubscribe(subId);
    });
  }

  public applyMiddlewares(options: OperationOptions): Promise<OperationOptions> {
    return new Promise((resolve, reject) => {
      const queue = (funcs: Middleware[], scope: any) => {
        const next = (error?: any) => {
          if (error) {
            reject(error);
          } else {
            if (funcs.length > 0) {
              const f = funcs.shift();
              if (f) {
                f.applyMiddleware.apply(scope, [options, next]);
              }
            } else {
              resolve(options);
            }
          }
        };
        next();
      };

      queue([...this.middlewares], this);
    });
  }

  public use(middlewares: Middleware[]): SubscriptionClient {
    middlewares.map(middleware => {
      if (typeof middleware.applyMiddleware === 'function') {
        this.middlewares.push(middleware);
      } else {
        throw new Error('Middleware must implement the applyMiddleware function.');
      }
    });

    return this;
  }

  private executeOperation(options: OperationOptions, handler: (error: Error[], result?: any) => void): string {
    const opId = this.generateOperationId();
    this.operations[opId] = { options: options, handler };
    this.applyMiddlewares(options)
      .then(processedOptions => {
        this.checkOperationOptions(processedOptions, handler);
        if (this.operations[opId]) {
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

  private getObserver<T>(
    observerOrNext: (Observer<T>) | ((v: T) => void),
    error?: (e: Error) => void,
    complete?: () => void,
  ) {
    if (typeof observerOrNext === 'function') {
      return {
        next: (v: T) => observerOrNext(v),
        error: (e: Error) => error && error(e),
        complete: () => complete && complete(),
      };
    }

    return observerOrNext;
  }

  private createMaxConnectTimeGenerator() {
    const minValue = 1000;
    const maxValue = this.timeout;

    return new Backoff({
      min: minValue,
      max: maxValue,
      factor: 1.2,
    });
  }

  private clearCheckConnectionInterval() {
    if (this.checkConnectionIntervalId) {
      clearInterval(this.checkConnectionIntervalId);
      this.checkConnectionIntervalId = null;
    }
  }

  private clearMaxConnectTimeout() {
    if (this.maxConnectTimeoutId) {
      clearTimeout(this.maxConnectTimeoutId);
      this.maxConnectTimeoutId = null;
    }
  }

  private clearTryReconnectTimeout() {
    if (this.tryReconnectTimeoutId) {
      clearTimeout(this.tryReconnectTimeoutId);
      this.tryReconnectTimeoutId = null;
    }
  }

  private checkOperationOptions(options: OperationOptions, handler: (error: Error[], result?: any) => void) {
    const { query, variables, operationName } = options;

    if (!query) {
      throw new Error('Must provide a query.');
    }

    if (!handler) {
      throw new Error('Must provide an handler.');
    }
    if (
      (!isString(query) && !getOperationAST(query as any, operationName)) ||
      (operationName && !isString(operationName)) ||
      (variables && !isObject(variables))
    ) {
      throw new Error(
        'Incorrect option types. query must be a string or a document,' +
          '`operationName` must be a string, and `variables` must be an object.',
      );
    }
  }

  private buildMessage(id: string, type: string, payload: any) {
    const payloadToReturn =
      payload && payload.query
        ? {
            ...payload,
            query: typeof payload.query === 'string' ? payload.query : print(payload.query),
          }
        : payload;

    return {
      id,
      type,
      payload: payloadToReturn,
    };
  }

  // ensure we have an array of errors
  private formatErrors(errors: any): FormatedError[] {
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

    return [
      {
        name: 'FormatedError',
        message: 'Unknown error',
        originalError: errors,
      },
    ];
  }

  private sendMessage(id: string, type: string, payload: any) {
    this.sendMessageRaw(this.buildMessage(id, type, payload));
  }

  // send message, or queue it if connection is not openF
  private sendMessageRaw(message) {
    switch (this.status) {
      case 'connected':
        // sending to graphql api handler as a strin
        const serializedMessage = new Paho.MQTT.Message(JSON.stringify({ data: JSON.stringify(message) }));
        serializedMessage.destinationName = this.appPrefix + '/out'; // topic pattern for each device connected
        this.debug && console.log('Sending message');
        this.debug && console.log(message);
        serializedMessage.retained = false;
        this.client.send(serializedMessage);
        break;
      case 'connecting':
        this.unsentMessagesQueue.push(message);
        break;
      default:
        if (!this.reconnecting) {
          throw new Error(
            'A message was not sent because socket is not connected, is closing or ' +
              'is already closed. Message was: ${JSON.parse(serializedMessage)}.',
          );
        }
    }
  }

  private generateOperationId(): string {
    return String(++this.nextOperationId);
  }

  private tryReconnect() {
    if (!this.reconnect || this.backoff.attempts >= this.reconnectionAttempts) {
      return;
    }

    if (!this.reconnecting) {
      Object.keys(this.operations).forEach(key => {
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

  private flushUnsentMessagesQueue() {
    this.unsentMessagesQueue.forEach(message => {
      this.sendMessageRaw(message);
    });
    this.unsentMessagesQueue = [];
  }

  private checkConnection() {
    if (this.wasKeepAliveReceived) {
      this.wasKeepAliveReceived = false;
      return;
    }

    if (!this.reconnecting) {
      this.close(false, true);
    }
  }

  private checkMaxConnectTimeout() {
    this.clearMaxConnectTimeout();

    // Max timeout trying to connect
    this.maxConnectTimeoutId = setTimeout(() => {
      if (this.status !== 'connected') {
        this.close(false, true);
      }
    }, this.maxConnectTimeGenerator.duration());
  }

  private connect() {
    this.debug && console.log('connecting to socket');
    this.status = 'connecting';
    this.getCredentialsFunction()
      .then(credentials => {
        const requestUrl = this.sigv4utils.getSignedUrl(this.iotEndpoint, this.region, credentials);
        this.clientId = uuidv4();
        this.client = new Paho.MQTT.Client(requestUrl, this.clientId);
        const connectOptions = {
          onSuccess: () => {
            this.status = 'connected';
            this.closedByUser = false;
            this.eventEmitter.emit(this.reconnecting ? 'reconnecting' : 'connecting'); // why here and not earlier?
            const payload: ConnectionParams =
              typeof this.connectionParams === 'function' ? this.connectionParams() : this.connectionParams;
            // Send CONNECTION_INIT message, no need to wait for connection to success (reduce roundtrips)
            const clientIdTopic = this.appPrefix + '/in/' + this.clientId;
            this.debug && console.log('successfully connected');
            this.client.subscribe(clientIdTopic, {
              onSuccess: obj => {
                this.debug && console.log(`subscribing to ${clientIdTopic}`);
                this.sendMessage(undefined, MessageTypes.GQL_CONNECTION_INIT, payload);
                this.flushUnsentMessagesQueue();
              },
              onFailure: obj => {
                this.debug && console.log('subscribe failure', obj);
              },
            });
          },
          useSSL: requestUrl.substring(0, 2) === 'wss',
          timeout: this.timeout,
          mqttVersion: 4,
          onFailure: this.onClose.bind(this),
        };

        this.client.onConnectionLost = this.onClose.bind(this);
        this.client.onMessageArrived = this.processReceivedData.bind(this);
        this.client.connect(connectOptions);
      })
      .catch(err => {
        this.status = 'offline';
        this.debug && console.log('connection error', err);
        this.close(false, false);
      });
  }

  private processReceivedData(receivedData: any) {
    let parsedMessage: any;
    let opId: string;
    try {
      parsedMessage = JSON.parse(receivedData.payloadString);
      opId = parsedMessage.id;
      this.debug && console.log('Received message');
      this.debug && console.log(parsedMessage);
    } catch (e) {
      throw new Error(`Message must be JSON-parseable. Got: ${receivedData.payloadString}`);
    }

    if (
      [MessageTypes.GQL_DATA, MessageTypes.GQL_COMPLETE, MessageTypes.GQL_ERROR].indexOf(parsedMessage.type) !== -1 &&
      !this.operations[opId]
    ) {
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
        const parsedPayload = !parsedMessage.payload.errors
          ? parsedMessage.payload
          : {
              ...parsedMessage.payload,
              errors: this.formatErrors(parsedMessage.payload.errors),
            };
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

  private onClose(reason) {
    this.status = 'closed';
    this.debug && console.log('Socket closed');
    this.debug && console.log(reason);
    if (!this.closedByUser) {
      this.close(false, false);
    }
  }

  private hasSubscriptionOperation = ({ query: { definitions } }) =>
    definitions.some(({ kind, operation }) => kind === 'OperationDefinition' && operation === 'subscription')
}
