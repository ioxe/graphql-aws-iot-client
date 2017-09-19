# graphql-aws-iot-client

WebSocket client for serverless subscriptions, queries and mutations. Compatible with Apollo Client and [graphql-aws-iot-server](https://github.com/ioxe/graphql-aws-iot-server). Adapted from the [Apollo subscriptions-transport-ws](https://github.com/apollographql/subscriptions-transport-ws)


### Apollo module - setting up client in Angular 2 and up example:

Please note to make the client work with the angular cli you need to set crypto to true at node-modules/@angular/cli/models/webpack-configs/common.js (~Line 161). This is required to sign the websocket url. The angular team currently refuses to integrate this modification into their published package. You could make this change as a post install script. You could also have your own custom build config that doesn't use angular cli.

This client supports / has been tested with the full ws transport and not the (deprecated) hybrid transport. If you are using angular 2 and up, you can import the client directly from 'graphql-aws-iot-client/src' to use the typescript code directly rather than the compiled code.

``` ts
import { Inject } from '@angular/core';
import { NgModule } from '@angular/core';

import { ApolloModule } from 'apollo-angular';
import { ApolloClient } from 'apollo-client';

import { SubscriptionClient } from 'graphql-aws-iot-client/src';

import { getCredentialsFunction } from './get-credentials';

import { environment } from '../../environments/environment';
const { region, iotEndpoint, AppPrefix } = environment;


const wsClient = new SubscriptionClient(iotEndpoint, {
    appPrefix: AppPrefix, // used as a topic prefix to namespace app
    region, // required to create signed url (should be region of iotEndpoint url
    reconnect: true,
    getCredentialsFunction,
    debug: true // for logging of socket messages
});

const client: ApolloClient = new ApolloClient({
    dataIdFromObject: (o: any) => o.id,
    networkInterface: wsClient,
    connectToDevTools: true,
});

export function provideClient(): ApolloClient {
    return client;
}

@NgModule({
    imports: [ApolloModule.forRoot(provideClient)],
    exports: [ApolloModule]
})
export class AppApolloModule { }

```
The getCredentials function must be provided so that on every new connection a new signed url will be generated to connect to the socket. This will ensure that the credentials are not expired on reconnect. This function should return a promise with AWS Credentials.

# See full example app at

Source Code
[Demo Code](https://github.com/ioxe/graphql-aws-iot-example)

Demo URL
[Demo URL](https://todo.girishnanda.com)
