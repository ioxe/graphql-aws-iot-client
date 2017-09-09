import { ListenerFn } from 'eventemitter3';
import { ExecutionResult } from 'graphql/execution/execute';
import { DocumentNode } from 'graphql/language/ast';
import * as Promise from 'bluebird';
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
    AppPrefix: string;
    region: string;
    connectionParams?: ConnectionParamsOptions;
    timeout?: number;
    reconnect?: boolean;
    reconnectionAttempts?: number;
    connectionCallback?: (error: Error[], result?: any) => void;
    clientId?: string;
}
export interface AWSCredentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
}
export interface Middleware {
    applyMiddleware(options: OperationOptions, next: Function): void;
}
export interface GetCredentialsFn {
    (...args: any[]): Promise<{
        credentials: AWSCredentials;
        clientId?: string;
    }>;
}
export declare class SubscriptionClient {
    client: any;
    operations: Operations;
    private url;
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
    private AppPrefix;
    private split;
    private getCredentialsFn;
    private sigv4utils;
    constructor(url: string, options: ClientOptions, getCredentialsFn: GetCredentialsFn);
    close(isForced?: boolean, closedByUser?: boolean): void;
    request(request: OperationOptions): Observable<ExecutionResult>;
    /**
 * @deprecated This method will become deprecated in the next release.
 * request should be used.
 */
    query(options: OperationOptions): Promise<ExecutionResult>;
    /**
     * @deprecated This method will become deprecated in the next release.
     * request should be used.
     */
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
    private onClose(err);
}
