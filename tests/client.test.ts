
import { SubscriptionClient } from '../src/client';

import MessageTypes from '../src/message-types';

import { sigv4utilsMock, createMqttServer, startSubscriptionOperationMessage } from './mocks';

jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;


describe('Initialization', () => {

    it('initializes with valid parameters', () => {
        const subscriptionClient = new SubscriptionClient('iotendpoint', {
            appPrefix: 'TEST',
            region: 'us-west-2',
            sigv4utils: sigv4utilsMock,
            getCredentialsFunction: () => Promise.resolve({ accessKeyId: '12312', secretAccessKey: '1231241' })
        });
        expect(subscriptionClient).toBeDefined();
    });

    it('throws an error if IotEndpoint is missing', () => {
        let error;
        try {
            const subscriptionClient = new SubscriptionClient(null, {
                appPrefix: 'TEST',
                region: 'us-west-2',
                getCredentialsFunction: () => Promise.resolve({ accessKeyId: '12312', secretAccessKey: '1231241' })
            });
        } catch (e) {
            error = e;
        }
        expect(error.message).toEqual('Iot Endpoint Required');
    })

    it('throws an error if app prefix is missing', () => {
        let error;
        try {
            const subscriptionClient = new SubscriptionClient('iotEndpoint', {
                appPrefix: null,
                region: 'us-west-2',
                getCredentialsFunction: () => Promise.resolve({ accessKeyId: '12312', secretAccessKey: '1231241' })
            });
        } catch (e) {
            error = e;
        }
        expect(error.message).toEqual('App Prefix Required');

    });

    it('throws an error if get credentials function is missing', () => {
        let error;
        try {
            const subscriptionClient = new SubscriptionClient('iotEndpoint', {
                appPrefix: 'TEST',
                region: 'us-west-2',
                getCredentialsFunction: null
            });
        } catch (e) {
            error = e;
        }
        expect(error.message).toEqual('Get Credentials Function required to generate aws iot signed url.');

    });
})

describe('Sending Messages', () => {
    let server;

    beforeEach(done => {
        const MockLocalStorage = require('mock-localstorage');
        (global as any).WebSocket = require('ws');
        (global as any).localStorage = new MockLocalStorage();
        (global as any).window = global;

        server = createMqttServer();
        server.on('ready', () => {
            done();
        });
    });

    afterEach(done => {
        if (server) {
            server.close(() => done());
            server = null;
        }
    })

    it('sends connection_init message with no connection params', done => {
        let messages = [];
        server.on('published', function (packet, client) {
            const payloadString = packet.payload.toString('utf-8');
            messages.push(payloadString);
        });
        const subscriptionClient = new SubscriptionClient('iotendpoint', {
            appPrefix: 'TEST',
            region: 'us-west-2',
            getCredentialsFunction: () => Promise.resolve({ accessKeyId: '12312', secretAccessKey: '1231241' }),
            sigv4utils: sigv4utilsMock
        });

        setTimeout(() => {
            const initPayloadDataString = JSON.parse(messages[2]).data;
            const initPayloadData = JSON.parse(initPayloadDataString);
            console.log('paya data');
            console.log(initPayloadData);
            expect(initPayloadData.type).toEqual(MessageTypes.GQL_CONNECTION_INIT)
            done();
        }, 3000)
    });

    it('sends connection_init message with connection params', done => {
        let messages = [];
        const connectionParams = { "auth": "1234" };

        server.on('published', function (packet, client) {
            const payloadString = packet.payload.toString('utf-8');
            messages.push(payloadString);
        });
        const subscriptionClient = new SubscriptionClient('iotendpoint', {
            appPrefix: 'TEST',
            region: 'us-west-2',
            connectionParams,
            getCredentialsFunction: () => Promise.resolve({ accessKeyId: '12312', secretAccessKey: '1231241' }),
            sigv4utils: sigv4utilsMock
        });

        setTimeout(() => {
            const initPayloadDataString = JSON.parse(messages[2]).data;
            const initPayloadData = JSON.parse(initPayloadDataString);
            expect(initPayloadData.payload).toEqual(connectionParams)
            expect(messages.length).toBe(3);
            done();
        }, 3000)
    });

    it('sends expected message for subscription start', done => {
        let messages = [];
        server.on('clientConnected', function () {
            subscriptionClient.request(startSubscriptionOperationMessage).subscribe({
                next(_) { },
                error(err) {
                    console.log(err);
                }
            });
        })
        server.on('published', function (packet, client) {
            const payloadString = packet.payload.toString('utf-8');
            messages.push(payloadString);
        });
        const subscriptionClient = new SubscriptionClient('iotendpoint', {
            appPrefix: 'TEST',
            region: 'us-west-2',
            getCredentialsFunction: () => Promise.resolve({ accessKeyId: '12312', secretAccessKey: '1231241' }),
            sigv4utils: sigv4utilsMock
        });
        setTimeout(() => {
            let parsedMessages = [];
            messages.forEach(m => {
                try {
                    let parsedMessage = JSON.parse(m);
                    parsedMessages.push(parsedMessage)
                } catch (e) { }
            })
            const parsedMessagesWithData = parsedMessages.filter(m => m.data).map(m => JSON.parse(m.data));
            const messageForSubscriptionStart = parsedMessagesWithData.find(m => m.type === MessageTypes.GQL_START);
            expect(messageForSubscriptionStart).toBeDefined();
            done();
        }, 3000)
    });

    it('sends expected message for subscription stop', done => {
        let messages = [];
        server.on('clientConnected', function () {
            const sub = subscriptionClient.request(startSubscriptionOperationMessage).subscribe({
                next(_) { },
                error(err) {
                    console.log(err);
                }
            });

            setTimeout(() => {
                sub.unsubscribe();
            }, 2000)
        })

        server.on('published', function (packet, client) {
            const payloadString = packet.payload.toString('utf-8');
            messages.push(payloadString);
        });
        const subscriptionClient = new SubscriptionClient('iotendpoint', {
            appPrefix: 'TEST',
            region: 'us-west-2',
            getCredentialsFunction: () => Promise.resolve({ accessKeyId: '12312', secretAccessKey: '1231241' }),
            sigv4utils: sigv4utilsMock
        });

        setTimeout(() => {
            let parsedMessages = [];
            messages.forEach(m => {
                try {
                    let parsedMessage = JSON.parse(m);
                    parsedMessages.push(parsedMessage)
                } catch (e) { }
            })
            const parsedMessagesWithData = parsedMessages.filter(m => m.data).map(m => JSON.parse(m.data));
            const messageForSubscriptionStart = parsedMessagesWithData.find(m => m.type === MessageTypes.GQL_STOP);
            expect(messageForSubscriptionStart).toBeDefined();
            done();
        }, 3000)
    });
})

describe('Event emitters', () => {
    let server;

    beforeEach(done => {
        const MockLocalStorage = require('mock-localstorage');
        (global as any).WebSocket = require('ws');
        (global as any).localStorage = new MockLocalStorage();
        (global as any).window = global;

        server = createMqttServer();
        server.on('ready', () => {
            done();
        });
    });

    afterEach(done => {
        if (server) {
            server.close(() => done());
            server = null;
        }
    })

    it('should emit on connected event when client is initialized and is connecting', done => {
        const subscriptionClient = new SubscriptionClient('iotendpoint', {
            appPrefix: 'TEST',
            region: 'us-west-2',
            getCredentialsFunction: () => Promise.resolve({ accessKeyId: '12312', secretAccessKey: '1231241' }),
            sigv4utils: sigv4utilsMock,
        });
        subscriptionClient.onConnecting(() => {
            expect(true).toBe(true);
            done();
        })
    })

    it('should emit on connected event when client is initialized and is connected', done => {
        const subscriptionClient = new SubscriptionClient('iotendpoint', {
            appPrefix: 'TEST',
            region: 'us-west-2',
            getCredentialsFunction: () => Promise.resolve({ accessKeyId: '12312', secretAccessKey: '1231241' }),
            sigv4utils: sigv4utilsMock,
        });
        subscriptionClient.onConnected(() => {
            expect(true).toBe(true);
            done();
        })

        server.on('published', function (packet, client) {
            const payloadString = packet.payload.toString('utf-8');
            let payload;
            try {
                payload = JSON.parse(payloadString);
            } catch (e) { }

            if (payload && payload.data) {
                let data = JSON.parse(payload.data);
                if (data.type === MessageTypes.GQL_CONNECTION_INIT) {
                    var message = {
                        topic: Object.keys(client.subscriptions)[0],
                        payload: JSON.stringify({ type: MessageTypes.GQL_CONNECTION_ACK, payload: {} }),
                        qos: 0, // 0, 1, or 2
                        retain: false // or true
                    };

                    server.publish(message);
                }
            }
        });
    })

    it('should emit an event when the client is disconnected', done => {
        const subscriptionClient = new SubscriptionClient('iotendpoint', {
            appPrefix: 'TEST',
            region: 'us-west-2',
            getCredentialsFunction: () => Promise.resolve({ accessKeyId: '12312', secretAccessKey: '1231241' }),
            sigv4utils: sigv4utilsMock,
        });
        subscriptionClient.onDisconnected(() => {
            expect(true).toBe(true);
            done();
        });
        subscriptionClient.close();
    })

    it('should emit a reconnecting event if disconnect is not forced', done => {
        const subscriptionClient = new SubscriptionClient('iotendpoint', {
            appPrefix: 'TEST',
            region: 'us-west-2',
            reconnect: true,
            reconnectionAttempts: 1,
            getCredentialsFunction: () => Promise.resolve({ accessKeyId: '12312', secretAccessKey: '1231241' }),
            sigv4utils: sigv4utilsMock,
        });
        subscriptionClient.onReconnecting(() => {
            expect(true).toBe(true);
            done();
        });
        subscriptionClient.close(false, true);
    })

    it('should emit a reconnect event if disconnect not forced and server is online responds with ack', done => {
        const subscriptionClient = new SubscriptionClient('iotendpoint', {
            appPrefix: 'TEST',
            region: 'us-west-2',
            reconnect: true,
            reconnectionAttempts: 1,
            getCredentialsFunction: () => Promise.resolve({ accessKeyId: '12312', secretAccessKey: '1231241' }),
            sigv4utils: sigv4utilsMock,
        });
        subscriptionClient.onReconnected(() => {
            expect(true).toBe(true);
            done();
        });
        server.on('published', function (packet, client) {
            const payloadString = packet.payload.toString('utf-8');
            let payload;
            try {
                payload = JSON.parse(payloadString);
            } catch (e) { }

            if (payload && payload.data) {
                let data = JSON.parse(payload.data);
                if (data.type === MessageTypes.GQL_CONNECTION_INIT) {
                    var message = {
                        topic: Object.keys(client.subscriptions)[0],
                        payload: JSON.stringify({ type: MessageTypes.GQL_CONNECTION_ACK, payload: {} }),
                        qos: 0, // 0, 1, or 2
                        retain: false // or true
                    };

                    server.publish(message);
                }
            }
        });
        subscriptionClient.close(false, true);
    })
})


describe('Receiving Messages', () => {
    let server;

    beforeEach(done => {
        const MockLocalStorage = require('mock-localstorage');
        (global as any).WebSocket = require('ws');
        (global as any).localStorage = new MockLocalStorage();
        (global as any).window = global;

        server = createMqttServer();
        server.on('ready', () => {
            done();
        });
    });

    afterEach(done => {
        if (server) {
            server.close(() => done());
            server = null;
        }
    })

    it('allows a valid error message', done => {
        server.on('published', function (packet, client) {
            const payloadString = packet.payload.toString('utf-8');
            let payload;
            try {
                payload = JSON.parse(payloadString);
            } catch (e) { }
            if (payload && payload.data) {
                let data = JSON.parse(payload.data);
                if (data.type === MessageTypes.GQL_START) {
                    const message = {
                        topic: Object.keys(client.subscriptions)[0],
                        payload: JSON.stringify({
                            type: MessageTypes.GQL_ERROR,
                            payload: {
                                errors: [{
                                    message: 'Test Error',
                                }],
                            },
                            id: data.id
                        }),
                        qos: 0, // 0, 1, or 2
                        retain: false // or true
                    };
                    server.publish(message);
                }
            }
        });

        const subscriptionClient = new SubscriptionClient('iotendpoint', {
            appPrefix: 'TEST',
            region: 'us-west-2',
            getCredentialsFunction: () => Promise.resolve({ accessKeyId: '12312', secretAccessKey: '1231241' }),
            sigv4utils: sigv4utilsMock,
        });

        subscriptionClient.subscribe(startSubscriptionOperationMessage,
            (error, result) => {
                expect(error.length).toBe(1);
                done();
            },
        );
    });

    it('allows a valid result message', done => {
        const resultMessage = {
            "teamTodoAdded": {
                "id": "c2e60303-3317-41ca-9213-f06f16a602fe",
                "name": "Todo 6",
                "author": "Bob",
                "content": "Todo 6 Content",
                "timestamp": "2017-09-11T23:50:37.969Z",
                "__typename": "Todo"
            }
        };
        server.on('published', function (packet, client) {
            const payloadString = packet.payload.toString('utf-8');
            let payload;
            try {
                payload = JSON.parse(payloadString);
            } catch (e) { }
            if (payload && payload.data) {
                let msg = JSON.parse(payload.data);
                if (msg.type === MessageTypes.GQL_START) {
                    const message = {
                        topic: Object.keys(client.subscriptions)[0],
                        payload: JSON.stringify({
                            payload: {
                                data: resultMessage
                            },
                            type: MessageTypes.GQL_DATA,
                            id: msg.id
                        }),
                        qos: 0, // 0, 1, or 2
                        retain: false // or true
                    };
                    server.publish(message);
                }
            }
        });

        const subscriptionClient = new SubscriptionClient('iotendpoint', {
            appPrefix: 'TEST',
            region: 'us-west-2',
            getCredentialsFunction: () => Promise.resolve({ accessKeyId: '12312', secretAccessKey: '1231241' }),
            sigv4utils: sigv4utilsMock,
        });

        subscriptionClient.subscribe(startSubscriptionOperationMessage,
            (error, result) => {
                expect(result).toEqual(resultMessage);
                expect(error).toBeNull();
                done();
            },
        );
    });

});

