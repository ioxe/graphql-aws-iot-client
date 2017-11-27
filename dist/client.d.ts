import { ListenerFn } from 'eventemitter3';
import { ExecutionResult } from 'graphql/execution/execute';
import { DocumentNode } from 'graphql/language/ast';
import { SigV4Utils } from './sig4utils';
import 'paho-mqtt';
export interface Observer<T> {
    next?: (value: T) => void;
    error?: (error: Error) => void;
    complete?: () => void;
}
export interface Observable<T> {
    subscribe(observer: Observer<T>): {
        unsubscribe: () => void;
    };
}
export interface OperationOptions {
    query?: string | DocumentNode;
    variables?: Object;
    operationName?: string;
    [key: string]: any;
}
export declare type FormatedError = Error & {
    originalError?: any;
};
export interface Operation {
    options: OperationOptions;
    handler: (error: Error[], result?: any) => void;
}
export interface Operations {
    [id: string]: Operation;
}
export declare type ConnectionParams = {
    [paramName: string]: any;
};
export declare type ConnectionParamsOptions = ConnectionParams | Function;
export interface ClientOptions {
    appPrefix: string;
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
    (...args: any[]): Promise<AWSCredentials>;
}
export declare class SubscriptionClient {
    client: any;
    operations: Operations;
    private appPrefix;
    private iotEndpoint;
    private region;
    private nextOperationId;
    private connectionParams;
    private unsentMessagesQueue;
    private reconnect;
    private reconnecting;
    private reconnectionAttempts;
    private backoff;
    private connectionCallback;
    private eventEmitter;
    private closedByUser;
    private wsImpl;
    private wasKeepAliveReceived;
    private tryReconnectTimeoutId;
    private checkConnectionIntervalId;
    private maxConnectTimeoutId;
    private middlewares;
    private maxConnectTimeGenerator;
    private timeout;
    private clientId;
    private uuid;
    private status;
    private getCredentialsFunction;
    private sigv4utils;
    private debug;
    constructor(iotEndpoint: string, options: ClientOptions);
    close(isForced?: boolean, closedByUser?: boolean): void;
    request(request: OperationOptions): Observable<ExecutionResult>;
    query(options: OperationOptions): Promise<ExecutionResult>;
    subscribe(options: OperationOptions, handler: (error: Error[], result?: any) => void): string;
    on(eventName: string, callback: ListenerFn, context?: any): Function;
    onConnected(callback: ListenerFn, context?: any): Function;
    onConnecting(callback: ListenerFn, context?: any): Function;
    onDisconnected(callback: ListenerFn, context?: any): Function;
    onReconnected(callback: ListenerFn, context?: any): Function;
    onReconnecting(callback: ListenerFn, context?: any): Function;
    unsubscribe(opId: string): void;
    unsubscribeAll(): void;
    applyMiddlewares(options: OperationOptions): Promise<OperationOptions>;
    use(middlewares: Middleware[]): SubscriptionClient;
    private executeOperation(options, handler);
    private getObserver<T>(observerOrNext, error?, complete?);
    private createMaxConnectTimeGenerator();
    private clearCheckConnectionInterval();
    private clearMaxConnectTimeout();
    private clearTryReconnectTimeout();
    private checkOperationOptions(options, handler);
    private buildMessage(id, type, payload);
    private formatErrors(errors);
    private sendMessage(id, type, payload);
    private sendMessageRaw(message);
    private generateOperationId();
    private tryReconnect();
    private flushUnsentMessagesQueue();
    private checkConnection();
    private checkMaxConnectTimeout();
    private connect();
    private processReceivedData(receivedData);
    private onClose(reason);
    private hasSubscriptionOperation;
}
